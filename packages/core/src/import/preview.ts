// Duplicates are checked against the Partner book and the market's exclusions, the company first, then its partner
// type. A new company becomes an account, a partner and a market link, a known one only a market link.
import { PARTNER_TYPE_LABELS, PARTNER_TYPES, type PartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { newId } from '../ids';
import type { Market } from '../markets/types';
import { fillEmpty, sectionsOf } from '../partners/accounts';
import type { PartnerChange } from '../partners/changes';
import type {
  AccountFields, ClosedAs, IsoDate, IsoDateTime, Partner, PartnerAccount, PartnerBook, PartnerEntity, TargetCustomerType,
} from '../partners/types';
import { TEXT_MAX } from '../shared/schemas';
import { domainOf, sameCompany } from '../website';
import { columnFor, type ImportColumn, type OutputColumn, type ParsedTable } from './parse-table';

export const TOO_LONG_FOR_CELL = COPY.TOO_LONG_FOR_CELL;

export type Duplicate =
  | { kind: 'linked'; partnerId: string; company: string }
  | { kind: 'existing'; partnerId: string; company: string; closed: ClosedAs | null; signed: boolean }
  | {
    kind: 'other_type'; partnerId: string; accountId: string; company: string;
    /** The type the company already has (the first, when it has several). */
    partnerType: PartnerType;
    /** The account fields the row fills because they are empty on the account (`fillEmpty`); `{}` when none. */
    fill: Partial<AccountFields>;
    /** The account's `updatedAt` when the preview was made: the fill is refused if the account changed since. */
    accountUpdatedAt: IsoDateTime | null;
  }
  | { kind: 'exclusion'; reason: string }
  | { kind: 'in_table'; company: string };

export interface PreviewRow {
  values: Partial<Record<OutputColumn, string>>;
  extra: Record<string, string>;
  /** The row's Source detail column (an agent's proposal gives one per company), or null: then the import writes the hypothesis and date. */
  sourceDetail: string | null;
  /**
   * linked: already a partner of this type and in this market, never imported.
   * existing: already a partner of this type, not in this market: imports as a market link only. One already signed
   *   starts unticked; one closed starts ticked, and stays closed.
   * other_type: the same company as another partner type: a warning, imports as a new partner on that company's account,
   *   filling the account's empty fields from the row.
   */
  duplicate: Duplicate | null;
  /** Why the row cannot be imported (TOO_LONG_FOR_CELL), or null. */
  problem: string | null;
  selected: boolean;
}

export interface ImportSource { marketId: string; hypothesisId: string | null; hypothesisName: string; date: IsoDate }

const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const TARGET_CUSTOMER_TYPE_BY_KEY = new Map<string, TargetCustomerType>([
  ...['enterprise', 'enterprises', 'largeenterprise', 'corporate'].map((k) => [k, 'enterprise'] as const),
  ...['smb', 'smbs', 'sme', 'smes', 'small', 'midmarket', 'kmu'].map((k) => [k, 'smb'] as const),
  ['unknown', 'unknown'],
]);

const PARTNER_TYPE_BY_KEY = new Map<string, PartnerType>([
  ...PARTNER_TYPES.flatMap((t) => [[key(t), t], [key(PARTNER_TYPE_LABELS[t]), t]] as const),
  ['valueaddedreseller', 'var'], ['valueaddeddistributor', 'vad'], ['msp', 'managed'],
  ['managedserviceprovider', 'managed'], ['si', 'system-integrator'], ['systemintegrator', 'system-integrator'],
  ['referralpartner', 'referral'],
]);

/**
 * The trimmed cell, with the Markdown AI tools put around a whole cell removed where it would hide a duplicate: a
 * website `[text](url)` or `<url>` becomes the url; a company in `**…**`, `__…__` or `*…*` loses the emphasis.
 * Every other cell stays as typed.
 */
function unwrap(column: ImportColumn, cell: string): string {
  const value = cell.trim();
  if (column === 'Website') return (/^\[[^\]]*\]\(([^)\s]+)\)$/.exec(value) ?? /^<([^<>\s]+)>$/.exec(value))?.[1] ?? value;
  if (column === 'Company') return (/^(\*\*|__|\*)((?:(?!\1).)+)\1$/.exec(value)?.[2] ?? value).trim();
  return value;
}

/** The account fields, partner fields and desk note a row imports as, before the source and ids are added. */
function contentOf(row: Pick<PreviewRow, 'values' | 'extra'>, partnerType: PartnerType) {
  const v = (column: OutputColumn) => row.values[column] ?? '';
  const comments: string[] = [];
  const note = (label: string, value: string) => { if (value) comments.push(`${label}: ${value}`); };

  note('Existing partnerships', v('Existing partnerships'));
  const typedCustomers = v('Target customer type');
  const targetCustomerType = TARGET_CUSTOMER_TYPE_BY_KEY.get(key(typedCustomers)) ?? 'unknown';
  if (typedCustomers && !TARGET_CUSTOMER_TYPE_BY_KEY.has(key(typedCustomers))) note('Target customer type', typedCustomers);
  // The market decides the partner type; a different one in the table is kept as a note.
  const typedPartner = v('Partner type');
  if (typedPartner && PARTNER_TYPE_BY_KEY.get(key(typedPartner)) !== partnerType) note('Partner type', typedPartner);
  for (const [header, value] of Object.entries(row.extra)) note(header, value);

  return {
    account: {
      company: v('Company'), website: v('Website'), country: v('Country'), vertical: v('Vertical'),
      subVertical: v('Sub-vertical'), targetCustomerType, comments: comments.join('\n'),
    },
    partner: { partnerType, whyItFits: v('Why it fits') },
    evidence: v('Evidence and sources'),
  };
}

function tooLong(row: Pick<PreviewRow, 'values' | 'extra' | 'sourceDetail'>, partnerType: PartnerType): boolean {
  const { account, partner, evidence } = contentOf(row, partnerType);
  return [...Object.values(account), ...Object.values(partner), evidence, row.sourceDetail ?? ''].some((value) => value.length > TEXT_MAX);
}

/**
 * The accounts of the same company (same website, or same name when either has no website): those matched by website
 * first, then those matched by name only. Within each, a company that has a partner type comes before one left with
 * none (a half-saved add), then book order. `sameCompany` isn't transitive, so a row can match "Acme" (no website) by
 * name and "Acme Austria" (acme.at) by website.
 */
function sameAccounts(book: PartnerBook, input: { company: string; website: string }): PartnerAccount[] {
  const domain = domainOf(input.website);
  const byWebsite = (a: PartnerAccount) => domain !== null && domainOf(a.website) === domain;
  const hasTypes = (a: PartnerAccount) => book.partners.some((p) => p.accountId === a.id);
  const matches = book.accounts.filter((account) => sameCompany(account, input));
  const typedFirst = (list: PartnerAccount[]) => [...list.filter(hasTypes), ...list.filter((a) => !hasTypes(a))];
  return [...typedFirst(matches.filter(byWebsite)), ...typedFirst(matches.filter((a) => !byWebsite(a)))];
}

/** The account of the same company, preferring one matched by website over one matched by name only; or null. */
export function findSameAccount(book: PartnerBook, input: { company: string; website: string }): PartnerAccount | null {
  return sameAccounts(book, input)[0] ?? null;
}

/** The first section of `partnerType` on the matching accounts (website matches first), with its account. */
function sameTypeSection(book: PartnerBook, accounts: PartnerAccount[], partnerType: PartnerType) {
  for (const account of accounts) {
    const section = sectionsOf(book, account.id).find((p) => p.partnerType === partnerType);
    if (section) return { account, section };
  }
  return null;
}

/**
 * The section of the same company and partner type, or null: the company's accounts first (website matches first),
 * then a section of that type on any of them. The duplicate check for adding a partner by hand.
 */
export function findSamePartner(
  book: PartnerBook, input: { company: string; website: string; partnerType: PartnerType },
): Partner | null {
  return sameTypeSection(book, sameAccounts(book, input), input.partnerType)?.section ?? null;
}

/** One row per company in the table; duplicates (except the other-type warning) come out unselected, known partners as a link. */
export function previewImport(
  input: { book: PartnerBook; market: Market; table: ParsedTable },
): { rows: PreviewRow[]; droppedNoName: number } {
  const { book, market, table: t } = input;
  const { marketId, partnerType } = market.info;
  const columns = t.headers.map((header) => columnFor(header));
  const rows: PreviewRow[] = [];
  let droppedNoName = 0;

  for (const cells of t.rows) {
    const values: PreviewRow['values'] = {};
    const extra: PreviewRow['extra'] = {};
    let sourceDetail: string | null = null;
    cells.forEach((cell, index) => {
      const column = columns[index];
      const value = column ? unwrap(column, cell) : cell.trim();
      if (!value) return;
      if (column === 'Source detail' && sourceDetail === null) sourceDetail = value;
      else if (column && column !== 'Source detail' && !(column in values)) values[column] = value;
      else extra[t.headers[index]?.trim() || `Column ${index + 1}`] = value;
    });
    if (!values.Company) {
      if (Object.keys(values).length > 0 || Object.keys(extra).length > 0) droppedNoName++;
      continue;
    }

    const company = { company: values.Company, website: values.Website ?? '' };
    const problem = tooLong({ values, extra, sourceDetail }, partnerType) ? TOO_LONG_FOR_CELL : null;
    // A section of this type on any matching account wins; otherwise the best matching account takes the new type.
    const accounts = sameAccounts(book, company);
    const found = sameTypeSection(book, accounts, partnerType);
    const account = found?.account ?? accounts[0];
    const sameType = found?.section;
    const sections = account ? sectionsOf(book, account.id) : [];
    const exclusion = market.exclusions.find((e) => sameCompany(e, company));
    const earlier = rows.find((r) => !r.problem && sameCompany({ company: r.values.Company!, website: r.values.Website ?? '' }, company));
    const otherType = sections.find((p) => p.partnerType !== partnerType);
    const linked = sameType !== undefined && book.marketLinks.some((l) => l.partnerId === sameType.id && l.marketId === marketId);

    // A repeat in the table comes first, so one known partner never gets two links.
    const duplicate: Duplicate | null = earlier ? { kind: 'in_table', company: earlier.values.Company! }
      : account && sameType ? (linked
        ? { kind: 'linked', partnerId: sameType.id, company: account.company }
        : { kind: 'existing', partnerId: sameType.id, company: account.company, closed: sameType.closed, signed: sameType.signedDate !== null })
      : exclusion ? { kind: 'exclusion', reason: exclusion.reason }
      : account && otherType ? {
        kind: 'other_type', partnerId: otherType.id, accountId: account.id, company: account.company,
        partnerType: otherType.partnerType, fill: fillEmpty(account, contentOf({ values, extra }, partnerType).account),
        accountUpdatedAt: account.updatedAt,
      }
      : null;
    const blocked = duplicate !== null && duplicate.kind !== 'existing' && duplicate.kind !== 'other_type';
    // A partner already signed as this type starts unticked; it can still be ticked (owner, spec 6.4).
    const signed = duplicate?.kind === 'existing' && duplicate.signed;
    rows.push({ values, extra, sourceDetail, duplicate, problem, selected: !blocked && !problem && !signed });
  }
  return { rows, droppedNoName };
}

/**
 * Whether a row can be ticked. A row with a problem never; nor one already in this market, repeated in the table or
 * on this market's Exclusions. A partner the book has can be: this type adds this market (a signed one starts
 * unticked), and another type is added on that company. The market's preview and an accepted proposal of new partners
 * share it.
 */
export function canTick(row: PreviewRow): boolean {
  if (row.problem) return false;
  const kind = row.duplicate?.kind;
  return kind !== 'linked' && kind !== 'in_table' && kind !== 'exclusion';
}

/**
 * The changes for one batch (rows with a problem or already in the market never import; unticked rows are skipped).
 * - New company: `add account` and `add partner` (each with a provisional `values.id` from `ids`; its source detail is the
 *   row's Source detail when it has one, else the hypothesis and the date), `add marketLink` for
 *   it, and, when the row has evidence, `add qualification` holding it under Customer base. Later changes name the
 *   provisional ids; applied as one batch (applyPartnerChanges) the rows get their real ids and they follow them.
 * - The same company as another partner type (`other_type`): the same, without `add account`: the partner goes on
 *   that company's account. When the row fills fields empty on that account, an `update account` with them (and the
 *   account's `updatedAt` from the preview, so a change made since is never overwritten) comes before the partner.
 * - Known partner of this type (`existing`): only an `add marketLink` with that partner's id.
 */
export function importChanges(
  rows: PreviewRow[], source: ImportSource, market: Market,
  ids: (e: PartnerEntity) => string = newId,
): PartnerChange[] {
  const { partnerType } = market.info;
  const fromSource = `${source.hypothesisName.trim() || COPY.MARKET_HYPOTHESIS} · ${source.date}`;
  const link = (partnerId: string): PartnerChange => ({
    kind: 'add', entity: 'marketLink', values: { partnerId, marketId: source.marketId, hypothesisId: source.hypothesisId },
  });
  return rows
    .filter((row) => row.selected && !row.problem && row.duplicate?.kind !== 'linked')
    .flatMap((row): PartnerChange[] => {
      if (row.duplicate?.kind === 'existing') return [link(row.duplicate.partnerId)];
      const { account, partner, evidence } = contentOf(row, partnerType);
      const known = row.duplicate?.kind === 'other_type' ? row.duplicate : null;
      const accountId = known?.accountId ?? ids('account');
      const accountChange: PartnerChange[] = !known ? [{ kind: 'add', entity: 'account', values: { id: accountId, ...account } }]
        : Object.keys(known.fill).length > 0
          ? [{ kind: 'update', entity: 'account', id: accountId, patch: known.fill, expectedUpdatedAt: known.accountUpdatedAt }]
          : [];
      const id = ids('partner');
      const sourceDetail = row.sourceDetail ?? fromSource;
      const add: PartnerChange = { kind: 'add', entity: 'partner', values: { id, accountId, ...partner, source: 'ai_search', sourceDetail } };
      // Without evidence there are no desk notes to keep, and no qualification row to write.
      if (!evidence.trim()) return [...accountChange, add, link(id)];
      return [
        ...accountChange, add, link(id),
        {
          kind: 'add', entity: 'qualification',
          values: { partnerId: id, deskNotes: { customerBase: evidence, credibility: '', capability: '', commitment: '' } },
        },
      ];
    });
}

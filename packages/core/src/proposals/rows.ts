// A proposal's rows in the Partners file's Proposals tab (agent proposals design, spec 7.1), in the words the screen
// shows, and read back by those words. People may type in the tab; every reader here is tolerant.
import {
  FOUR_C,
  RECRUITMENT_STEPS,
  STAGE_LABELS,
  STEP_LABELS,
  type FourC,
  type RecruitmentStep,
} from '@partner-desk/method';
import {
  CLOSED_LABELS,
  HYPOTHESIS_STATUS_LABELS,
  MARKET_STATUS_LABELS,
  SHEET_COPY,
} from '@partner-desk/copy';
import type { ImportColumn, ParsedTable } from '../import/parse-table';
import type { HypothesisStatus, MarketStatus } from '../markets/types';
import type { PartnerChange } from '../partners/changes';
import type { ClosedAs, IsoDate, IsoDateTime, Score } from '../partners/types';
import { isoDateSchema } from '../shared/schemas';
import { PROPOSAL_STAGES, targetOf, type ProposalInput, type ProposedCompany } from './input';
import { expiresAt, targetUpdatedAt, type ProposalScene } from './rules';
import type { ProposalField, ProposalItem, ProposalItemStatus, ProposalStatus } from './types';

/** What one item proposes, read back from its What, Proposed and Details cells. */
export type ProposedValue =
  | { field: 'desk'; letter: FourC; score: Score }
  | { field: 'step'; to: RecruitmentStep }
  | { field: 'stage'; to: (typeof PROPOSAL_STAGES)[number] }
  | { field: 'closed'; as: ClosedAs }
  | { field: 'signedDate'; date: IsoDate }
  | { field: 'company'; company: ProposedCompany }
  | { field: 'hypothesisStatus'; to: HypothesisStatus }
  | { field: 'marketStatus'; to: MarketStatus; note: string };

/** A new partner's columns in its Details cell, one "Label: value" line each, in the import table's order and words. */
const COMPANY_COLUMNS = [
  ['website', 'Website'], ['country', 'Country'], ['vertical', 'Vertical'], ['subVertical', 'Sub-vertical'],
  ['targetCustomerType', 'Target customer type'], ['partnerType', 'Partner type'], ['whyItFits', 'Why it fits'],
  ['sourceDetail', 'Source detail'],
] as const satisfies ReadonlyArray<readonly [Exclude<keyof ProposedCompany, 'company'>, ImportColumn]>;

/** The import preview's table for a new partners proposal: the company, then its Details columns. */
const TABLE_HEADERS: ImportColumn[] = ['Company', ...COMPANY_COLUMNS.map(([, label]) => label)];

const STATUS_NOTE = SHEET_COPY.INFO_FIELDS.statusNote;

const key = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/** The code whose label (or the code itself) the words name, ignoring case, spaces and punctuation. */
function byLabel<K extends string, A extends K = K>(labels: Readonly<Record<K, string>>, words: string, allowed?: readonly A[]): A | null {
  const wanted = key(words);
  if (wanted === '') return null;
  const codes = allowed ?? (Object.keys(labels) as A[]);
  return codes.find((code) => key(labels[code]) === wanted || key(code) === wanted) ?? null;
}

/** "Label: value" lines; a value runs on over the lines after it until the next known label. */
function writeDetails(lines: ReadonlyArray<readonly [string, string]>): string {
  return lines.filter(([, value]) => value !== '').map(([label, value]) => `${label}: ${value}`).join('\n');
}

/** Reads `writeDetails`' lines: `labelOf` names the known label a line starts with, or null for a line that runs on. */
function readDetails<K extends string>(details: string, labelOf: (label: string) => K | null): Partial<Record<K, string>> {
  const out: Partial<Record<K, string>> = {};
  let current: K | null = null;
  for (const line of details.replace(/\r\n?/g, '\n').split('\n')) {
    const match = /^([^:\n]+):[ \t]?(.*)$/.exec(line);
    const field = match ? labelOf(match[1]!) : null;
    if (field !== null) {
      current = field;
      out[field] = match![2]!;
    } else if (current !== null) {
      out[current] = `${out[current]}\n${line}`;
    }
  }
  for (const field of Object.keys(out) as K[]) out[field] = out[field]!.trim();
  return out;
}

/**
 * One of the eight labels `writeDetails` writes, by its words (ignoring case, spaces and punctuation), never an import
 * alias: a "Web: …" line inside Why it fits stays part of Why it fits.
 */
const companyField = (label: string) => COMPANY_COLUMNS.find(([, l]) => key(l) === key(label))?.[0] ?? null;
const noteField = (label: string) => (key(label) === key(STATUS_NOTE) ? 'note' as const : null);

const DESK_LETTERS: Readonly<Partial<Record<ProposalField, FourC>>> = Object.fromEntries(FOUR_C.map((c) => [`desk.${c}`, c]));

/** The Proposed words (and Details) read back by their labels; null when they can't be read. */
export function proposedValue(item: ProposalItem): ProposedValue | null {
  const words = item.proposed.trim();
  switch (item.what) {
    case 'desk.customerBase': case 'desk.credibility': case 'desk.capability': case 'desk.commitment': {
      const score = /^[0-3]$/.test(words) ? (Number(words) as Score) : null;
      return score === null ? null : { field: 'desk', letter: DESK_LETTERS[item.what]!, score };
    }
    case 'step': {
      const to = byLabel(STEP_LABELS, words, RECRUITMENT_STEPS);
      return to && { field: 'step', to };
    }
    case 'stage': {
      const to = byLabel(STAGE_LABELS, words, PROPOSAL_STAGES);
      return to && { field: 'stage', to };
    }
    case 'closed': {
      const as = byLabel(CLOSED_LABELS, words);
      return as && { field: 'closed', as };
    }
    case 'signedDate':
      return isoDateSchema.safeParse(words).success ? { field: 'signedDate', date: words } : null;
    case 'company': {
      if (words === '') return null;
      const columns = readDetails(item.details, companyField);
      const company = { company: words, ...Object.fromEntries(COMPANY_COLUMNS.map(([field]) => [field, columns[field] ?? ''])) } as ProposedCompany;
      return { field: 'company', company };
    }
    case 'hypothesisStatus': {
      const to = byLabel(HYPOTHESIS_STATUS_LABELS, words);
      return to && { field: 'hypothesisStatus', to };
    }
    case 'marketStatus': {
      const to = byLabel(MARKET_STATUS_LABELS, words);
      return to && { field: 'marketStatus', to, note: readDetails(item.details, noteField).note ?? '' };
    }
  }
}

type ItemRow = Pick<ProposalItem, 'about' | 'what' | 'proposed' | 'details' | 'evidence'>;

/** About: the company for a partner type, the market's name for a market or new partners, the hypothesis's name. */
function aboutOf(input: ProposalInput, scene: ProposalScene): string {
  switch (input.kind) {
    case 'fourC': case 'stage': case 'close': case 'signed': {
      const accountId = scene.book.partners.find((p) => p.id === input.partnerId)?.accountId;
      return scene.book.accounts.find((a) => a.id === accountId)?.company ?? '';
    }
    case 'partners': case 'marketStatus':
      return scene.market?.info.marketId === input.marketId ? scene.market.info.marketName : '';
    case 'hypothesisStatus':
      return scene.market?.info.marketId === input.marketId
        ? scene.market.hypotheses.find((h) => h.id === input.hypothesisId)?.name ?? ''
        : '';
  }
}

/** The rows' own words: one per letter for 4C, one per company for new partners, else one. */
function itemRows(input: ProposalInput, about: string): ItemRow[] {
  const row = (what: ProposalField, proposed: string, evidence: string, details = ''): ItemRow => ({ about, what, proposed, details, evidence });
  switch (input.kind) {
    case 'fourC':
      return FOUR_C.flatMap((c) => {
        const letter = input.letters[c];
        return letter ? [row(`desk.${c}`, String(letter.score), letter.evidence)] : [];
      });
    case 'stage': {
      const step = (RECRUITMENT_STEPS as readonly string[]).includes(input.to);
      return [step
        ? row('step', STEP_LABELS[input.to as RecruitmentStep], input.reason)
        : row('stage', STAGE_LABELS[input.to as (typeof PROPOSAL_STAGES)[number]], input.reason)];
    }
    case 'close':
      return [row('closed', CLOSED_LABELS[input.as], input.reason)];
    case 'signed':
      return [row('signedDate', input.signedDate, input.reason)];
    case 'partners':
      return input.companies.map((c) => row('company', c.company, input.reason, writeDetails(COMPANY_COLUMNS.map(([field, label]) => [label, c[field]]))));
    case 'hypothesisStatus':
      return [row('hypothesisStatus', HYPOTHESIS_STATUS_LABELS[input.to], input.reason)];
    case 'marketStatus':
      return [row('marketStatus', MARKET_STATUS_LABELS[input.to], input.reason, writeDetails([[STATUS_NOTE, input.note]]))];
  }
}

/**
 * The Proposals rows for a new proposal: adds of `proposalItem`, waiting, with the target's ids and its `updatedAt`
 * now, and the expiry date. `ids` gives each row its id. Check the proposal (`checkProposal`) first.
 */
export function proposalRows(input: ProposalInput, scene: ProposalScene, at: {
  proposalId: string; proposedBy: string; now: IsoDateTime; ids: () => string;
}): PartnerChange[] {
  const base = {
    proposalId: at.proposalId, kind: input.kind, ...targetOf(input, scene.book), proposedBy: at.proposedBy, status: 'waiting',
    proposedOn: at.now, expiresOn: expiresAt(at.now), targetUpdated: targetUpdatedAt(input, scene),
  };
  return itemRows(input, aboutOf(input, scene)).map((row) => ({
    kind: 'add', entity: 'proposalItem', values: { id: at.ids(), ...base, ...row },
  }));
}

/** The items of a new partners proposal the preview's table holds, in order: row i of `proposalTable` is item i here. */
export function companyItems(items: readonly ProposalItem[]): ProposalItem[] {
  return items.filter((item) => item.what === 'company' && proposedValue(item) !== null);
}

/** A new partners proposal as the import preview's table, so accepting runs the same preview a pasted table does. */
export function proposalTable(items: readonly ProposalItem[]): ParsedTable {
  const rows = companyItems(items).map((item) => {
    const value = proposedValue(item);
    const company = value?.field === 'company' ? value.company : null;
    return company ? [company.company, ...COMPANY_COLUMNS.map(([field]) => company[field])] : [];
  });
  return { headers: [...TABLE_HEADERS], rows };
}

/** Each item's new status (and the person's note, when given), against the row as it was read. */
export function statusRows(items: readonly ProposalItem[], to: ProposalItemStatus, now: IsoDateTime, note?: string): PartnerChange[] {
  return items.map((item) => ({
    kind: 'update', entity: 'proposalItem', id: item.id, expectedUpdatedAt: item.updatedAt,
    patch: { status: to, answeredOn: now, ...(note === undefined ? {} : { answerNote: note }) },
  }));
}

/**
 * What the tab's next write sets on rows left Waiting (spec 7.3): one past its Expires on becomes Expired (answered on
 * that date); one whose proposal the index has replaced or withdrawn gets that status; one whose proposal the index
 * doesn't know becomes Not sent (its index write failed, so nobody was shown it). Rows of proposals the index has
 * waiting, and every answered row, stay as they are. Pass the rows already in the file, not the new proposal's.
 */
export function tidyRows(
  items: readonly ProposalItem[],
  index: { waiting: ReadonlySet<string>; known: ReadonlySet<string>; marked?: ReadonlyMap<string, Extract<ProposalStatus, 'replaced' | 'withdrawn'>> },
  now: IsoDateTime,
): PartnerChange[] {
  const update = (item: ProposalItem, patch: Record<string, unknown>): PartnerChange =>
    ({ kind: 'update', entity: 'proposalItem', id: item.id, patch, expectedUpdatedAt: item.updatedAt });
  return items.flatMap((item): PartnerChange[] => {
    if (item.status !== 'waiting') return [];
    const expires = Date.parse(item.expiresOn);
    if (!Number.isNaN(expires) && expires <= Date.parse(now)) return [update(item, { status: 'expired', answeredOn: item.expiresOn })];
    if (index.waiting.has(item.proposalId)) return [];
    const marked = index.marked?.get(item.proposalId);
    if (marked) return [update(item, { status: marked, answeredOn: now })];
    return index.known.has(item.proposalId) ? [] : [update(item, { status: 'not_sent' })];
  });
}

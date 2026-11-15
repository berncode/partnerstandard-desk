import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { applyPartnerChanges, MAX_BATCH, parsePartnerChanges } from '../partners/batch';
import type { PartnerChange } from '../partners/changes';
import type { Partner, PartnerBook } from '../partners/types';
import { TEXT_MAX } from '../shared/schemas';
import { aPartner, anAccount, marketLink, sampleBook, sampleMarket, stamp } from '../test-builders';
import { parseTable, type ParsedTable } from './parse-table';
import { findSameAccount, findSamePartner, importChanges, previewImport, TOO_LONG_FOR_CELL, type PreviewRow } from './preview';

const HEADERS = ['Company', 'Website', 'Country', 'Vertical', 'Sub-vertical', 'Target customer type', 'Partner type',
  'Why it fits', 'Evidence and sources', 'Existing partnerships'];

function parsed(text: string): ParsedTable {
  const out = parseTable(text);
  if (!out.ok) throw new Error(out.message);
  return out.table;
}

const tableOf = (headers: string[], rows: string[][]): ParsedTable => ({ headers, rows });

/** The market is Austria (m_austria00, reseller). Acme is a reseller linked to Germany only; Beta GmbH is a reseller linked to Austria. */
const MARKET_ID = 'm_austria00';
const market = () => {
  const m = sampleMarket();
  m.info = { ...m.info, marketId: MARKET_ID, marketName: 'Austria', partnerType: 'reseller' };
  m.exclusions = [{ id: 'x_1', company: 'Omega AG', website: '', reason: 'Existing partner', updatedAt: null, updatedBy: 'Someone' }];
  return m;
};
/** A company with one section: section `p_<key>` on account `a_<key>`. */
function company(key: string, name: string, website: string, over: Partial<Partner> = {}) {
  return { account: anAccount({ id: `a_${key}`, company: name, website }), partner: aPartner({ id: `p_${key}`, accountId: `a_${key}`, ...over }) };
}
const withCompanies = (companies: Array<ReturnType<typeof company>>) =>
  ({ accounts: companies.map((c) => c.account), partners: companies.map((c) => c.partner) });

const book = (): PartnerBook => sampleBook({
  ...withCompanies([
    company('acme', 'Acme GmbH', 'https://www.acme.at/de', { partnerType: 'reseller' }),
    company('beta', 'Beta GmbH', 'https://beta.at', { partnerType: 'reseller' }),
    company('gamma', 'Gamma AG', 'https://gamma.at', { partnerType: 'referral' }),
  ]),
  marketLinks: [
    marketLink({ id: 'l_1', partnerId: 'p_acme', marketId: 'm_germany00' }),
    marketLink({ id: 'l_2', partnerId: 'p_beta', marketId: MARKET_ID }),
  ],
  people: [], calls: [], qualifications: [],
});
const preview = (table: ParsedTable, b: PartnerBook = book()) => previewImport({ book: b, market: market(), table });

const SOURCE = { marketId: MARKET_ID, hypothesisId: 'h_1', hypothesisName: 'Mid-size ERP resellers', date: '2026-10-21' };

function counter(): (e: string) => string {
  let n = 0;
  return (e) => `${e === 'account' ? 'a' : e === 'partner' ? 'p' : e === 'marketLink' ? 'l' : 'q'}_imp${++n}`;
}

function addValues(change: PartnerChange): Record<string, unknown> {
  if (change.kind !== 'add') throw new Error(`expected add, got ${change.kind}`);
  return change.values;
}
const entities = (changes: PartnerChange[]) => changes.map((c) => (c.kind === 'add' ? c.entity : c.kind));

describe('previewImport', () => {
  it('maps columns by header, ignoring case, spaces and punctuation', () => {
    const t = tableOf(['company NAME', 'url', 'SUB VERTICAL', 'Why it fits?'], [['Delta', 'delta.at', 'Retail', 'Big']]);
    const { rows } = preview(t);
    expect(rows[0]!.values).toEqual({ Company: 'Delta', Website: 'delta.at', 'Sub-vertical': 'Retail', 'Why it fits': 'Big' });
    expect(rows[0]!.extra).toEqual({});
  });

  it('accepts "Name" and "Web" as Company and Website', () => {
    const { rows } = preview(tableOf(['Name', 'Web'], [['Delta', ' delta.at ']]));
    expect(rows[0]!.values).toEqual({ Company: 'Delta', Website: 'delta.at' });
  });

  it('keeps unknown columns as extra', () => {
    const { rows } = preview(tableOf(['Company', 'Employees', ''], [['Delta', '120', '']]));
    expect(rows[0]!.extra).toEqual({ Employees: '120' });
  });

  it('offers a link instead of a new partner when the company exists for this type', () => {
    const { rows } = preview(tableOf(['Company', 'Website'], [['ACME Austria', 'http://acme.at/']]));
    expect(rows[0]).toMatchObject({
      duplicate: { kind: 'existing', partnerId: 'p_acme', company: 'Acme GmbH', closed: null, signed: false }, selected: true,
    });
    const changes = importChanges(rows, SOURCE, market(), counter());
    expect(changes).toHaveLength(1);
    expect(changes[0]).toEqual({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_acme', marketId: MARKET_ID, hypothesisId: 'h_1' } });
  });

  it('imports one link when a known partner is in the table twice', () => {
    const { rows } = preview(tableOf(['Company', 'Website'], [['Acme', 'acme.at'], ['ACME Austria', 'www.acme.at']]));
    expect(rows.map((r) => [r.duplicate?.kind, r.selected])).toEqual([['existing', true], ['in_table', false]]);
    const changes = importChanges(rows, SOURCE, market(), counter());
    expect(entities(changes)).toEqual(['marketLink']);
    const out = applyPartnerChanges(book(), changes, stamp());
    expect(out.ok).toBe(true);
  });

  it('never imports a company already in this market', () => {
    const { rows } = preview(tableOf(['Company', 'Website'], [['Beta', 'https://www.beta.at/']]));
    expect(rows[0]).toMatchObject({ duplicate: { kind: 'linked', partnerId: 'p_beta', company: 'Beta GmbH' }, selected: false });
    // Even when the user ticks it, nothing is imported.
    expect(importChanges(rows.map((r) => ({ ...r, selected: true })), SOURCE, market(), counter())).toEqual([]);
  });

  it('warns about the same company as another partner type', () => {
    const { rows } = preview(tableOf(['Company', 'Website'], [['Gamma', 'gamma.at']]));
    expect(rows[0]).toMatchObject({
      duplicate: { kind: 'other_type', partnerId: 'p_gamma', accountId: 'a_gamma', company: 'Gamma AG', partnerType: 'referral' }, selected: true,
    });
    const changes = importChanges(rows, SOURCE, market(), counter());
    // The new partner type goes on Gamma's account: no second account for the same company.
    expect(entities(changes)).toEqual(['partner', 'marketLink']);
    expect(addValues(changes[0]!)).toMatchObject({ accountId: 'a_gamma', partnerType: 'reseller' });
    const out = applyPartnerChanges(book(), changes, stamp());
    expect(out).toMatchObject({ ok: true });
    if (out.ok) expect(out.value.partners.filter((p) => p.accountId === 'a_gamma').map((p) => p.partnerType)).toEqual(['referral', 'reseller']);
  });

  it('starts a row of a signed partner of this type unticked; ticked, it imports as a link', () => {
    const b = book();
    b.partners = b.partners.map((p) => (p.id === 'p_acme' ? { ...p, stage: 'growth' as const, step: null, signedDate: '2026-03-03' } : p));
    const { rows } = preview(tableOf(['Company', 'Website'], [['Acme', 'acme.at']]), b);
    expect(rows[0]).toMatchObject({ duplicate: { kind: 'existing', partnerId: 'p_acme', closed: null, signed: true }, selected: false });
    expect(importChanges(rows, SOURCE, market(), counter())).toEqual([]);
    const ticked = importChanges(rows.map((r) => ({ ...r, selected: true })), SOURCE, market(), counter());
    expect(ticked).toEqual([{ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_acme', marketId: MARKET_ID, hypothesisId: 'h_1' } }]);
  });

  it('starts a row of a closed partner of this type ticked, and says how it was closed', () => {
    const b = book();
    b.partners = b.partners.map((p) => (p.id === 'p_acme' ? { ...p, closed: 'not_now' as const, closedReason: 'Busy' } : p));
    const { rows } = preview(tableOf(['Company', 'Website'], [['Acme', 'acme.at']]), b);
    expect(rows[0]).toMatchObject({ duplicate: { kind: 'existing', partnerId: 'p_acme', closed: 'not_now', signed: false }, selected: true });
    expect(entities(importChanges(rows, SOURCE, market(), counter()))).toEqual(['marketLink']);
  });

  it('finds the company first: another type on the same account is other_type, the same type on it is existing', () => {
    const b = book();
    b.partners.push(aPartner({ id: 'p_gamma2', accountId: 'a_gamma', partnerType: 'reseller' }));
    const { rows } = preview(tableOf(['Company', 'Website'], [['Gamma', 'gamma.at']]), b);
    expect(rows[0]!.duplicate).toMatchObject({ kind: 'existing', partnerId: 'p_gamma2', company: 'Gamma AG' });
  });

  it('matches www and trailing slash', () => {
    const b = sampleBook({ ...withCompanies([company('a', 'Other name', 'acme.com')]), marketLinks: [], people: [], calls: [], qualifications: [] });
    const { rows } = preview(tableOf(['Company', 'Website'], [['Acme Inc', 'https://www.acme.com/']]), b);
    expect(rows[0]!.duplicate).toMatchObject({ kind: 'existing', partnerId: 'p_a' });
  });

  it('finds a duplicate by domain when the AI wrote Markdown around the company and website', () => {
    const t = parsed('| Company | Website |\n|---|---|\n| **Acme Austria** | [acme.at](https://www.acme.at) |');
    const { rows } = preview(t);
    expect(rows[0]).toMatchObject({
      values: { Company: 'Acme Austria', Website: 'https://www.acme.at' }, duplicate: { kind: 'existing', company: 'Acme GmbH' },
    });
  });

  it.each([
    ['[Delta](https://delta.at/en)', 'https://delta.at/en'], ['<https://delta.at>', 'https://delta.at'],
    [' delta.at ', 'delta.at'], ['see [Delta](https://delta.at)', 'see [Delta](https://delta.at)'],
  ])('stores the website %j as %j', (typed, expected) => {
    const { rows } = preview(tableOf(['Company', 'Website'], [['Delta', typed]]));
    expect(rows[0]!.values.Website).toBe(expected);
  });

  it.each([
    ['**Delta**', 'Delta'], ['__Delta__', 'Delta'], ['*Delta*', 'Delta'], ['** Delta GmbH **', 'Delta GmbH'],
    ['**Delta** and partners', '**Delta** and partners'], ['Delta*', 'Delta*'],
    ['**Delta** and **Gamma**', '**Delta** and **Gamma**'],
  ])('stores the company %j as %j', (typed, expected) => {
    const { rows } = preview(tableOf(['Company', 'Why it fits'], [[typed, '**Keep** as typed']]));
    expect(rows[0]!.values).toEqual({ Company: expected, 'Why it fits': '**Keep** as typed' });
  });

  it('marks an excluded company unselected, with the reason', () => {
    const { rows } = preview(tableOf(['Company', 'Website'], [['omega ag', '']]));
    expect(rows[0]).toMatchObject({ duplicate: { kind: 'exclusion', reason: 'Existing partner' }, selected: false });
  });

  it('marks a second row of the same company as already in this table', () => {
    const t = tableOf(['Company', 'Website'], [['Delta GmbH', 'https://delta.at'], ['Delta', 'delta.at/en']]);
    const { rows } = preview(t);
    expect(rows.map((r) => [r.selected, r.duplicate])).toEqual([
      [true, null],
      [false, { kind: 'in_table', company: 'Delta GmbH' }],
    ]);
  });

  it('drops and counts rows without a company, and skips empty rows', () => {
    const t = tableOf(['Company', 'Website'], [['', 'nameless.at'], ['  ', 'x.at'], ['  ', ' '], ['', ''], ['Delta', 'delta.at']]);
    const out = preview(t);
    expect(out.droppedNoName).toBe(2);
    expect(out.rows.map((r) => r.values.Company)).toEqual(['Delta']);
  });

  it('selects a new company', () => {
    const { rows } = preview(tableOf(['Company'], [['Delta']]));
    expect(rows[0]).toMatchObject({ duplicate: null, problem: null, selected: true });
  });

  it('marks a row with a cell over the text limit as too long, unselected', () => {
    const t = tableOf(['Company', 'Evidence and sources'], [['Delta', 'x'.repeat(TEXT_MAX + 1)], ['Epsilon', 'x'.repeat(TEXT_MAX)]]);
    const { rows } = preview(t);
    expect(rows.map((r) => [r.problem, r.selected])).toEqual([[TOO_LONG_FOR_CELL, false], [null, true]]);
    expect(TOO_LONG_FOR_CELL).toBe(COPY.TOO_LONG_FOR_CELL);
  });

  it('marks a row too long when its comments together go over the text limit', () => {
    const half = 'x'.repeat(TEXT_MAX / 2);
    const t = tableOf(['Company', 'Existing partnerships', 'Notes'], [['Delta', half, half]]);
    expect(preview(t).rows[0]).toMatchObject({ problem: TOO_LONG_FOR_CELL, selected: false });
  });

  it('does not count a too-long row as the first of its company', () => {
    const t = tableOf(['Company', 'Why it fits'], [['Delta', 'x'.repeat(TEXT_MAX + 1)], ['Delta', 'Short']]);
    expect(preview(t).rows.map((r) => r.selected)).toEqual([false, true]);
  });
});

describe('importChanges', () => {
  const fullRow = ['Delta GmbH', ' https://delta.at ', 'Austria', 'Manufacturing', 'Food', 'Mid-market', 'Reseller',
    'Sells ERP to food makers', 'https://delta.at/customers', 'SAP, Microsoft'];

  it('adds an account, a partner and its market link per new company, and a qualification when there is evidence', () => {
    const t = tableOf(HEADERS, [
      fullRow, ['Acme', 'acme.at', '', '', '', '', '', '', '', ''], ['Epsilon', '', '', '', '', '', '', '', 'epsilon.at/about', ''],
      ['Zeta', '', '', '', '', '', '', '', ' ', ''],
    ]);
    const { rows } = preview(t);
    const changes = importChanges(rows, SOURCE, market(), counter());
    expect(entities(changes)).toEqual([
      'account', 'partner', 'marketLink', 'qualification', // Delta
      'marketLink', // Acme exists: a link only
      'account', 'partner', 'marketLink', 'qualification', // Epsilon
      'account', 'partner', 'marketLink', // Zeta has no evidence
    ]);

    expect(addValues(changes[0]!)).toEqual({
      id: 'a_imp1', company: 'Delta GmbH', website: 'https://delta.at', country: 'Austria', vertical: 'Manufacturing',
      subVertical: 'Food', targetCustomerType: 'smb', comments: 'Existing partnerships: SAP, Microsoft',
    });
    expect(addValues(changes[1]!)).toEqual({
      id: 'p_imp2', accountId: 'a_imp1', partnerType: 'reseller', source: 'ai_search',
      sourceDetail: 'Mid-size ERP resellers · 2026-10-21', whyItFits: 'Sells ERP to food makers',
    });
    expect(addValues(changes[2]!)).toEqual({ partnerId: 'p_imp2', marketId: MARKET_ID, hypothesisId: 'h_1' });
    expect(addValues(changes[3]!)).toEqual({
      partnerId: 'p_imp2',
      deskNotes: { customerBase: 'https://delta.at/customers', credibility: '', capability: '', commitment: '' },
    });
    expect(addValues(changes[4]!)).toEqual({ partnerId: 'p_acme', marketId: MARKET_ID, hypothesisId: 'h_1' });
    expect(addValues(changes[6]!).accountId).toBe(addValues(changes[5]!).id);
    expect(addValues(changes[7]!).partnerId).toBe(addValues(changes[6]!).id);
    expect(addValues(changes[8]!).partnerId).toBe(addValues(changes[6]!).id);
    expect(addValues(changes[9]!).company).toBe('Zeta');
  });

  it('skips rows the user unticked, and rows with a problem', () => {
    const t = tableOf(['Company', 'Why it fits'], [['Delta', 'ok'], ['Epsilon', 'x'.repeat(TEXT_MAX + 1)]]);
    const rows: PreviewRow[] = preview(t).rows.map((r) => ({ ...r, selected: true }));
    rows[0]!.selected = false;
    expect(importChanges(rows, SOURCE, market(), counter())).toEqual([]);
  });

  it('puts a null hypothesis on the link and names the market hypothesis in the source', () => {
    const { rows } = preview(tableOf(['Company'], [['Delta']]));
    const changes = importChanges(rows, { ...SOURCE, hypothesisId: null, hypothesisName: '' }, market(), counter());
    expect(addValues(changes[1]!)).toMatchObject({ sourceDetail: 'market hypothesis · 2026-10-21' });
    expect(addValues(changes[2]!)).toMatchObject({ hypothesisId: null });
  });

  it('importChanges uses a row\'s Source detail, else the hypothesis and date', () => {
    const t = tableOf(['Company', 'Source detail', 'Why it fits'], [['Delta', 'Claude, a web search', 'Sells ERP'], ['Epsilon', '', 'x']]);
    const { rows } = preview(t);
    expect(rows.map((r) => [r.values, r.sourceDetail, r.extra])).toEqual([
      [{ Company: 'Delta', 'Why it fits': 'Sells ERP' }, 'Claude, a web search', {}],
      [{ Company: 'Epsilon', 'Why it fits': 'x' }, null, {}],
    ]);
    const changes = importChanges(rows, SOURCE, market(), counter());
    expect(addValues(changes[1]!)).toMatchObject({ source: 'ai_search', sourceDetail: 'Claude, a web search' });
    expect(addValues(changes[4]!)).toMatchObject({ source: 'ai_search', sourceDetail: 'Mid-size ERP resellers · 2026-10-21' });
  });

  it('refuses a Source detail too long for a sheet cell', () => {
    const { rows } = preview(tableOf(['Company', 'Source detail'], [['Delta', 'x'.repeat(TEXT_MAX + 1)]]));
    expect(rows[0]).toMatchObject({ problem: TOO_LONG_FOR_CELL, selected: false });
  });

  it('defaults to fresh ids', () => {
    const { rows } = preview(tableOf(['Company', 'Evidence and sources'], [['Delta', 'delta.at']]));
    const [accountAdd, partnerAdd, link, qualification] = importChanges(rows, SOURCE, market());
    expect(addValues(accountAdd!).id).toMatch(/^a_[a-z0-9]{6}$/);
    expect(addValues(partnerAdd!).id).toMatch(/^p_[a-z0-9]{6}$/);
    expect(addValues(partnerAdd!).accountId).toBe(addValues(accountAdd!).id);
    expect(addValues(link!).partnerId).toBe(addValues(partnerAdd!).id);
    expect(addValues(qualification!).partnerId).toBe(addValues(partnerAdd!).id);
  });

  it.each([
    ['Enterprise', 'enterprise'], ['large enterprise', 'enterprise'], ['Corporate', 'enterprise'],
    ['SMB', 'smb'], ['SME', 'smb'], ['small', 'smb'], ['Mid-market', 'smb'], ['Midmarket', 'smb'], ['KMU', 'smb'],
    ['', 'unknown'], ['Unknown', 'unknown'],
  ])('maps target customer type %j to %s', (typed, expected) => {
    const { rows } = preview(tableOf(['Company', 'Target customer type'], [['Delta', typed]]));
    const values = addValues(importChanges(rows, SOURCE, market(), counter())[0]!);
    expect(values.targetCustomerType).toBe(expected);
    expect(values.comments).toBe('');
  });

  it('keeps an unrecognized target customer type in comments', () => {
    const { rows } = preview(tableOf(['Company', 'Target customer type'], [['Delta', 'Public sector']]));
    const values = addValues(importChanges(rows, SOURCE, market(), counter())[0]!);
    expect(values).toMatchObject({ targetCustomerType: 'unknown', comments: 'Target customer type: Public sector' });
  });

  it('always takes the market partner type, and keeps a different typed one in comments', () => {
    const { rows } = preview(tableOf(['Company', 'Partner type'], [['Delta', 'reseller'], ['Epsilon', 'Referral partner'], ['Zeta', 'Consultancy']]));
    const changes = importChanges(rows, SOURCE, market(), counter());
    const added = (entity: string) => changes.filter((c) => c.kind === 'add' && c.entity === entity).map(addValues);
    expect(added('partner').map((v) => v.partnerType)).toEqual(['reseller', 'reseller', 'reseller']);
    expect(added('account').map((v) => v.comments)).toEqual(['', 'Partner type: Referral partner', 'Partner type: Consultancy']);
  });

  it('puts existing partnerships, unrecognized values and unknown columns into comments, in that order', () => {
    const t = tableOf(['Company', 'Employees', 'Partner type', 'Existing partnerships', 'Target customer type', 'Founded'],
      [['Delta', '120', 'Agency', 'SAP', 'Government', '1999']]);
    const values = addValues(importChanges(preview(t).rows, SOURCE, market(), counter())[0]!);
    expect(values.comments).toBe([
      'Existing partnerships: SAP', 'Target customer type: Government', 'Partner type: Agency', 'Employees: 120', 'Founded: 1999',
    ].join('\n'));
  });

  it('passes formula-looking text through unchanged', () => {
    const t = tableOf(['Company', 'Website', 'Why it fits', 'Evidence and sources', 'Notes'],
      [['=HYPERLINK("http://evil","x")', '+43 1 234 56', '@acme', '-x', '=1+1']]);
    const [accountAdd, partnerAdd, , qualification] = importChanges(preview(t).rows, SOURCE, market(), counter());
    expect(addValues(accountAdd!)).toMatchObject({ company: '=HYPERLINK("http://evil","x")', website: '+43 1 234 56', comments: 'Notes: =1+1' });
    expect(addValues(partnerAdd!)).toMatchObject({ whyItFits: '@acme' });
    expect(addValues(qualification!)).toMatchObject({ deskNotes: { customerBase: '-x' } });
  });

  it('fills the empty fields of the account of another partner type, and leaves filled ones alone', () => {
    const b = book();
    b.accounts = b.accounts.map((a) => (a.id === 'a_gamma'
      ? { ...a, country: '', comments: '', vertical: 'Retail', subVertical: '', targetCustomerType: 'enterprise' as const, updatedAt: '2026-10-20T08:00:00.000Z' }
      : a));
    const t = tableOf(HEADERS, [['Gamma', 'gamma.at', 'Austria', 'Manufacturing', '', 'SMB', '', 'Sells to food makers', 'gamma.at/customers', 'SAP']]);
    const { rows } = preview(t, b);
    expect(rows[0]!.duplicate).toMatchObject({ kind: 'other_type', accountId: 'a_gamma', partnerType: 'referral' });
    const changes = importChanges(rows, SOURCE, market(), counter());
    expect(entities(changes)).toEqual(['update', 'partner', 'marketLink', 'qualification']);
    // Only the empty fields: country and comments. Vertical and target customer type were filled and stay.
    expect(changes[0]).toEqual({
      kind: 'update', entity: 'account', id: 'a_gamma', patch: { country: 'Austria', comments: 'Existing partnerships: SAP' },
      expectedUpdatedAt: '2026-10-20T08:00:00.000Z',
    });
    expect(addValues(changes[1]!)).toMatchObject({ accountId: 'a_gamma', partnerType: 'reseller', whyItFits: 'Sells to food makers' });
    expect(addValues(changes[3]!)).toMatchObject({ partnerId: addValues(changes[1]!).id, deskNotes: { customerBase: 'gamma.at/customers' } });

    const out = applyPartnerChanges(b, changes, stamp());
    if (!out.ok) throw new Error(out.message);
    expect(out.value.accounts.find((a) => a.id === 'a_gamma')).toMatchObject({
      company: 'Gamma AG', website: 'https://gamma.at', country: 'Austria', vertical: 'Retail', targetCustomerType: 'enterprise',
      comments: 'Existing partnerships: SAP',
    });
  });

  it('adds no account update when the row fills nothing on the account of another partner type', () => {
    const { rows } = preview(tableOf(['Company', 'Website', 'Country'], [['Gamma', 'https://gamma.at/en', '']]));
    expect(entities(importChanges(rows, SOURCE, market(), counter()))).toEqual(['partner', 'marketLink']);
  });

  it('fits 25 new companies with evidence, the most the search prompt asks for, in one batch', () => {
    const t = tableOf(['Company', 'Website', 'Evidence and sources'],
      Array.from({ length: 25 }, (_, i) => [`Company ${i}`, `c${i}.example`, `c${i}.example/customers`]));
    const changes = importChanges(preview(t).rows, SOURCE, market(), counter());
    expect(changes).toHaveLength(100);
    expect(MAX_BATCH).toBe(100);
    expect(parsePartnerChanges(changes)).toMatchObject({ ok: true });
    let n = 0;
    const out = applyPartnerChanges(book(), changes, stamp({ newId: (kind) => `${kind}_${++n}` }));
    if (!out.ok) throw new Error(out.message);
    expect(out.value.accounts).toHaveLength(3 + 25);
    expect(out.value.marketLinks.filter((l) => l.marketId === MARKET_ID)).toHaveLength(1 + 25);
  });

  it('applies as one batch: the new account, partner, link and qualification follow the real ids', () => {
    const t = parsed(`| ${HEADERS.join(' | ')} |\n|${HEADERS.map(() => '---').join('|')}|\n| ${fullRow.join(' | ')} |\n| Acme | acme.at |||||||| |`);
    const changes = importChanges(preview(t).rows, SOURCE, market(), counter());
    const out = applyPartnerChanges(book(), changes, stamp({ newId: (kind) => `${kind}_real` }));
    if (!out.ok) throw new Error(out.message);
    const result = out.value;
    expect(result.accounts.find((a) => a.company === 'Delta GmbH')).toMatchObject({ id: 'account_real' });
    expect(result.partners.find((p) => p.accountId === 'account_real')).toMatchObject({ id: 'partner_real', stage: 'recruitment', step: 'researched' });
    expect(result.marketLinks.filter((l) => l.marketId === MARKET_ID).map((l) => l.partnerId).sort()).toEqual(['p_acme', 'p_beta', 'partner_real']);
    expect(result.qualifications[0]).toMatchObject({ partnerId: 'partner_real' });
  });
});

/** Acme (no website, a referral partner) and Acme Austria (acme.at, a reseller): a row "Acme" + acme.at matches both. */
const twoAcmes = () => sampleBook({
  ...withCompanies([company('a', 'Acme', '', { partnerType: 'referral' }), company('b', 'Acme Austria', 'acme.at', { partnerType: 'reseller' })]),
  marketLinks: [], people: [], calls: [], qualifications: [],
});

describe('several accounts match', () => {
  it('prefers the account matched by website over one matched by name only', () => {
    expect(findSameAccount(twoAcmes(), { company: 'Acme', website: 'https://acme.at' })?.id).toBe('a_b');
    expect(findSamePartner(twoAcmes(), { company: 'Acme', website: 'https://acme.at', partnerType: 'reseller' })?.id).toBe('p_b');
    // No section of that type on the website match: a same-type section on the name match still counts.
    expect(findSamePartner(twoAcmes(), { company: 'Acme', website: 'https://acme.at', partnerType: 'referral' })?.id).toBe('p_a');
  });

  it('imports the row as a link to the reseller matched by website, not a second reseller on the other account', () => {
    const { rows } = preview(tableOf(['Company', 'Website'], [['Acme', 'acme.at']]), twoAcmes());
    expect(rows[0]!.duplicate).toMatchObject({ kind: 'existing', partnerId: 'p_b', company: 'Acme Austria' });
    expect(entities(importChanges(rows, SOURCE, market(), counter()))).toEqual(['marketLink']);
  });
});

describe('findSameAccount', () => {
  it('finds the account of the same company typed differently', () => {
    const b = sampleBook(withCompanies([company('a', 'ACME', 'https://acme.com/'), company('b', 'Beta', '')]));
    expect(findSameAccount(b, { company: 'Acme GmbH', website: 'www.acme.com' })?.id).toBe('a_a');
    expect(findSameAccount(b, { company: 'Beta AG', website: 'beta.com' })?.id).toBe('a_b');
    expect(findSameAccount(b, { company: 'Other', website: 'other.com' })).toBeNull();
  });

  it('prefers, among equal matches, the company that has a partner type over one left with none', () => {
    const b = sampleBook(withCompanies([company('a', 'Acme', ''), company('b', 'Acme', '')]));
    // a_a lost its partner type (a half-saved add, or a type removed by hand): it is listed first, but has none.
    b.partners = b.partners.filter((p) => p.accountId !== 'a_a');
    expect(findSameAccount(b, { company: 'Acme', website: '' })?.id).toBe('a_b');
    // A match by website still comes before a match by name only.
    const c = sampleBook(withCompanies([company('a', 'Acme', 'acme.at'), company('b', 'Acme', '')]));
    c.partners = c.partners.filter((p) => p.accountId !== 'a_a');
    expect(findSameAccount(c, { company: 'Acme', website: 'acme.at' })?.id).toBe('a_a');
  });
});

describe('findSamePartner', () => {
  it('finds the section of that type on the company\'s account', () => {
    const b = sampleBook(withCompanies([company('a', 'ACME', 'https://acme.com/', { partnerType: 'referral' })]));
    b.partners.push(aPartner({ id: 'p_a2', accountId: 'a_a', partnerType: 'reseller' }));
    expect(findSamePartner(b, { company: 'Acme GmbH', website: 'www.acme.com', partnerType: 'reseller' })?.id).toBe('p_a2');
    expect(findSamePartner(b, { company: 'Acme GmbH', website: 'www.acme.com', partnerType: 'referral' })?.id).toBe('p_a');
  });

  it('finds the same partner typed differently', () => {
    const b = sampleBook(withCompanies([company('a', 'Acme GmbH', 'acme.com', { partnerType: 'reseller' })]));
    expect(findSamePartner(b, { company: 'ACME GmbH', website: 'www.acme.com', partnerType: 'reseller' })?.id).toBe('p_a');
    expect(findSamePartner(b, { company: 'ACME GmbH', website: 'www.acme.com', partnerType: 'referral' })).toBeNull();
    expect(findSamePartner(b, { company: 'Other', website: 'other.com', partnerType: 'reseller' })).toBeNull();
  });
});

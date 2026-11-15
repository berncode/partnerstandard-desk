import { MAX_BATCH, parseTable, previewImport, TEXT_MAX, type PartnerChange } from '@partner-desk/core';
import { anAccount, marketLink, partner, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { describe, expect, it } from 'vitest';
import {
  canTick, changesFor, importCounts, refusalLines, rowNote, searchPromptFileName, tickedRows, tooManyForOneImport, withTicks,
} from './import-model';

const M = 'm_abcdefghij';

/** Alpha is in this market, Beta a reseller in another market, Contoso a managed service partner. */
function named(id: string, company: string, website: string, over: Parameters<typeof partner>[0] = {}) {
  return {
    account: anAccount({ id: `a_${id}`, company, website, country: 'Austria' }),
    partner: partner({ id, accountId: `a_${id}`, ...over }),
  };
}
const rows = [
  named('p_1', 'Alpha', 'alpha.example'),
  named('p_2', 'Beta', 'beta.example'),
  named('p_3', 'Contoso', 'contoso.example', { partnerType: 'managed' }),
];
const book = () => sampleBook({
  accounts: rows.map((row) => row.account),
  partners: rows.map((row) => row.partner),
  marketLinks: [marketLink({ id: 'l_1', partnerId: 'p_1' }), marketLink({ id: 'l_2', partnerId: 'p_2', marketId: 'm_other00000' })],
  calls: [], people: [], qualifications: [],
});

const TABLE = [
  '| Company | Website | Why it fits | Evidence and sources |',
  '|---|---|---|---|',
  '| Datum Labs | datum.example | Sells IT | datum.example/about |',
  '| Alpha | alpha.example | Here already | |',
  '| Beta | beta.example | Elsewhere | |',
  '| Contoso | contoso.example | Other type | |',
  '| Omega GmbH | omega.example | Excluded | |',
  '| Datum Labs | datum.example | Again | |',
  `| Long GmbH | long.example | ${'x'.repeat(TEXT_MAX + 1)} | |`,
  '| Fourth Coffee | fourth.example | New | |',
].join('\n');

function preview() {
  const parsed = parseTable(TABLE);
  if (!parsed.ok) throw new Error(parsed.message);
  return previewImport({ book: book(), market: sampleMarket(), table: parsed.table }).rows;
}

const byCompany = (company: string, index = 0) => preview().filter((r) => r.values.Company === company)[index]!;
const source = { marketId: M, hypothesisId: null, hypothesisName: '', date: '2026-10-29' };

describe('the search prompt file', () => {
  it('is named after the market, letters and digits only', () => {
    expect(searchPromptFileName('Austria')).toBe('search-prompt-Austria.md');
    expect(searchPromptFileName('DACH / Nordics')).toBe('search-prompt-DACH-Nordics.md');
    expect(searchPromptFileName('Österreich')).toBe('search-prompt-Österreich.md');
    expect(searchPromptFileName(' / ')).toBe('search-prompt-market.md');
  });
});

describe('the preview', () => {
  it('notes each duplicate kind and problem', () => {
    const note = (company: string, index = 0) => rowNote(byCompany(company, index), 'reseller');
    expect(note('Datum Labs')).toBeNull();
    expect(note('Alpha')).toEqual({ text: 'already in this market', problem: false });
    expect(note('Beta')).toEqual({ text: 'already a partner: adds this market', problem: false });
    expect(note('Contoso')).toEqual({ text: 'Contoso is already your managed service provider. This adds Contoso as a reseller.', problem: false });
    expect(note('Omega GmbH')).toEqual({ text: 'excluded: Existing partner', problem: false });
    expect(note('Datum Labs', 1)).toEqual({ text: 'already in this table', problem: false });
    expect(note('Long GmbH')).toEqual({ text: 'Too long for a sheet cell', problem: true });
  });

  it('lets a person tick new companies and partners the book has, never one here, repeated, excluded or too long', () => {
    const tickable = Object.fromEntries(preview().map((r, i) => [`${r.values.Company}${i}`, canTick(r)]));
    expect(tickable).toEqual({
      'Datum Labs0': true, Alpha1: false, Beta2: true, Contoso3: true, 'Omega GmbH4': false, 'Datum Labs5': false, 'Long GmbH6': false,
      'Fourth Coffee7': true,
    });
    // A blocked row stays out even when something marked it selected.
    const forced = preview().map((r) => ({ ...r, selected: true }));
    expect(tickedRows(forced).map((r) => r.values.Company)).toEqual(['Datum Labs', 'Beta', 'Contoso', 'Fourth Coffee']);
  });

  it('keeps the person’s own ticks, but only on rows that can be ticked', () => {
    // Row 0 Datum Labs, 1 Alpha (here already), 2 Beta.
    const { rows } = withTicks({ rows: preview() }, { 0: false, 1: true, 2: false });
    expect(rows.slice(0, 3).map((r) => r.selected)).toEqual([false, false, false]);
    expect(tickedRows(rows).map((r) => r.values.Company)).toEqual(['Contoso', 'Fourth Coffee']);
  });

  it('counts new partners apart from partners that get this market', () => {
    expect(importCounts(preview())).toEqual({ added: 3, linked: 1 });
    expect(importCounts(preview().map((r) => (r.values.Company === 'Beta' ? { ...r, selected: false } : r)))).toEqual({ added: 3, linked: 0 });
  });

  it('names a signed partner and leaves the row unticked, and a closed one without a date', () => {
    const signed = named('p_s', 'Wingtip Digital', 'wingtip.example', { stage: 'growth', step: null, signedDate: '2026-09-15' });
    const closed = named('p_c', 'Proseware Ltd', 'proseware.example', { closed: 'not_now' });
    const parsed = parseTable([
      '| Company | Website |',
      '|---|---|',
      '| Wingtip Digital | wingtip.example |',
      '| Proseware Ltd | proseware.example |',
    ].join('\n'));
    if (!parsed.ok) throw new Error(parsed.message);
    const found = previewImport({
      book: sampleBook({
        accounts: [signed.account, closed.account], partners: [signed.partner, closed.partner],
        people: [], calls: [], qualifications: [], marketLinks: [],
      }),
      market: sampleMarket(), table: parsed.table,
    }).rows;
    expect(found[0]?.selected).toBe(false);
    expect(rowNote(found[0]!, 'reseller')).toEqual({ text: 'Already a signed reseller', problem: false });
    expect(rowNote(found[1]!, 'reseller')).toEqual({ text: 'You closed Proseware Ltd as a reseller (Not now).', problem: false });
  });
});

describe('the changes', () => {
  it('adds new partners with their link (and desk notes), and only a link for a partner the book has', () => {
    const changes = changesFor(preview(), source, sampleMarket());
    expect(changes.map((c) => (c.kind === 'add' ? c.entity : c.kind))).toEqual([
      'account', 'partner', 'marketLink', 'qualification', 'marketLink', 'partner', 'marketLink', 'account', 'partner', 'marketLink',
    ]);
    expect(changes[4]).toEqual({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_2', marketId: M, hypothesisId: null } });
    expect(tooManyForOneImport(changes)).toBe(false);
  });

  it('knows when one import can’t carry them all', () => {
    const many = Array.from({ length: MAX_BATCH + 1 }, (): PartnerChange => ({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_1', marketId: M, hypothesisId: null } }));
    expect(tooManyForOneImport(many)).toBe(true);
    expect(tooManyForOneImport(many.slice(1))).toBe(false);
  });

  it('says nothing was added, naming the company it stopped at and why', () => {
    const changes = changesFor(preview(), source, sampleMarket());
    expect(refusalLines(changes, { valid: 0, message: 'Fix it' }, book())).toEqual(['Nothing was added: Datum Labs couldn’t be added.', 'Fix it']);
    // A desk note or a link names its partner: the new one in the batch, or the one in the book.
    expect(refusalLines(changes, { valid: 2 }, book())).toEqual(['Nothing was added: Datum Labs couldn’t be added.']);
    expect(refusalLines(changes, { valid: 4 }, book())).toEqual(['Nothing was added: Beta couldn’t be added.']);
    expect(refusalLines(changes, { message: 'Google isn’t answering' }, book())).toEqual(['Nothing was added.', 'Google isn’t answering']);
  });
});

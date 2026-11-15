// The encode cases for the Partners and market workbooks.
import { describe, expect, it } from 'vitest';
import type { MarketEntity, PartnerEntity } from '@partner-desk/core';
import { anAccount, aPartner, sampleMarket } from '@partner-desk/core/test-builders';
import { encodeMarket, encodePartnerBook } from './encode';
import { MARKET_LAYOUT, PARTNERS_LAYOUT } from './layouts';
import { MARKET_META, PARTNERS_META, richBook } from './test-fixtures';

const book = richBook();
const pwb = encodePartnerBook(book, PARTNERS_META);
const market = sampleMarket();
const mwb = encodeMarket(market, MARKET_META);
const P = PARTNERS_LAYOUT.tabs;
const M = MARKET_LAYOUT.tabs;

const header = (wb: typeof pwb, tab: string) => wb[tab]![0]!;
const column = (wb: typeof pwb, tab: string, name: string) => wb[tab]!.slice(1).map((row) => row[header(wb, tab).indexOf(name)]);

describe('encodePartnerBook', () => {
  it('creates every tab, in order', () => {
    expect(PARTNERS_LAYOUT.tabOrder).toEqual([
      'Start here', 'Accounts', 'Partners', 'Market links', 'People', 'Calls', 'Qualification', 'Proposals', '_meta',
    ]);
    expect(Object.keys(pwb)).toEqual(PARTNERS_LAYOUT.tabOrder);
  });

  it('lays out the Accounts tab with the company’s facts and comments, one row per company', () => {
    expect(header(pwb, P.account)).toEqual([
      'ID', 'Company', 'Website', 'Country', 'Vertical', 'Sub-vertical', 'Target customer type', 'Comments', 'Updated', 'Updated by',
    ]);
  });

  it('lays out the Partners tab with one row per partner type, naming its company by ID', () => {
    expect(header(pwb, P.partner)).toEqual([
      'ID', 'Partner account', 'Partner type', 'Stage', 'Step', 'Closed', 'Closed reason', 'Source', 'Source detail', 'Why it fits',
      'Desk: Customer base', 'Desk: Credibility', 'Desk: Capability', 'Desk: Commitment',
      'Confirmed: Customer base', 'Confirmed: Credibility', 'Confirmed: Capability', 'Confirmed: Commitment',
      'MAP filled in', 'MAP link', 'Signed date', 'Exited date', 'Exit reason', 'Program', 'Level', 'MAP health', 'Next milestone',
      'Updated', 'Updated by',
    ]);
  });

  it('lays out the other tabs', () => {
    expect(header(pwb, P.marketLink)).toEqual(['ID', 'Partner', 'Market', 'Partner hypothesis', 'Updated', 'Updated by']);
    expect(header(pwb, P.person)).toEqual(['ID', 'Partner account', 'Name', 'Title', 'Email', 'Role', 'Active seller', 'Updated', 'Updated by']);
    expect(header(pwb, P.call)).toEqual([
      'ID', 'Partner', 'Date', 'Kind', 'Revenue Model', 'Cost Drivers', 'Differentiators', 'Strategic Bets', 'Customer Pains',
      'Partnership Experience', 'Notes', 'Updated', 'Updated by',
    ]);
    expect(header(pwb, P.qualification)).toEqual([
      'ID', 'Partner',
      'Desk note: Customer base', 'Desk note: Credibility', 'Desk note: Capability', 'Desk note: Commitment',
      'Confirmed note: Customer base', 'Confirmed note: Credibility', 'Confirmed note: Capability', 'Confirmed note: Commitment',
      'Q1: Customer overlap', 'Q2: Deal fit', 'Q4: MAP agreed',
      'CASO: Culture', 'CASO: Culture note', 'CASO: Additional value', 'CASO: Additional value note',
      'CASO: Sponsorship', 'CASO: Sponsorship note', 'CASO: Aligned objectives', 'CASO: Aligned objectives note',
      'Updated', 'Updated by',
    ]);
  });

  it('starts every entity tab with ID and ends it with Updated and Updated by', () => {
    for (const entity of PARTNERS_LAYOUT.entityOrder) {
      const head = header(pwb, P[entity]);
      expect(head[0], entity).toBe('ID');
      expect(head.slice(-2), entity).toEqual(['Updated', 'Updated by']);
      expect(head).toEqual(PARTNERS_LAYOUT.columns[entity].map((c) => c.header));
    }
    expect(PARTNERS_LAYOUT.entityOrder).toEqual([
      'account', 'partner', 'marketLink', 'person', 'call', 'qualification', 'proposalItem',
    ] satisfies PartnerEntity[]);
  });

  it('writes one row per item', () => {
    expect(pwb[P.account]).toHaveLength(book.accounts.length + 1);
    expect(pwb[P.partner]).toHaveLength(book.partners.length + 1);
    expect(pwb[P.marketLink]).toHaveLength(book.marketLinks.length + 1);
    expect(pwb[P.person]).toHaveLength(book.people.length + 1);
  });

  it('writes a company with its target customer type as a label', () => {
    expect(pwb[P.account]![2]).toEqual([
      'a_2', 'Beta AG', 'beta.at', 'Germany', 'Managed IT', '', 'Enterprise', '', '2026-10-19T16:00:00.000Z', 'Someone',
    ]);
    expect(column(pwb, P.account, 'Comments')).toEqual(['Met at a fair', '', '']);
    expect(column(pwb, P.partner, 'Partner account')).toEqual(['a_1', 'a_2', 'a_1', 'a_4']);
    expect(column(pwb, P.person, 'Partner account')).toEqual(['a_1', 'a_2']);
  });

  it('writes a partner with labels, score numbers, yes or blank, and ISO dates; no company id column', () => {
    expect(pwb[P.partner]![2]).toEqual([
      'p_2', 'a_2', 'Value Added Reseller', 'Growth', '', '', '', 'Research', '', '', 2, 2, 3, 2, 2, 3, 3, 2, 'yes',
      'https://map.partnerstandard.com/p/abc', '2026-10-19', '', '', 'pg_dach0001', 'Preferred', 'At risk', '2026-11-20',
      '2026-10-19T16:00:00.000Z', 'Someone',
    ]);
    expect(column(pwb, P.partner, 'MAP health')).toEqual(['', 'At risk', '', '']);
    expect(column(pwb, P.partner, 'Next milestone')).toEqual(['', '2026-11-20', '', '']);
    expect(column(pwb, P.partner, 'Program')).toEqual(['', 'pg_dach0001', '', '']);
    expect(column(pwb, P.partner, 'Level')).toEqual(['', 'Preferred', '', '']);
    expect(column(pwb, P.partner, 'Source')).toEqual(['Research', 'Research', 'Research', 'Existing partner']);
    expect(column(pwb, P.partner, 'Stage')).toEqual(['Recruitment', 'Growth', 'Recruitment', 'Exit']);
    expect(column(pwb, P.partner, 'Step')).toEqual(['Researched', '', 'Discovery call', '']);
    expect(column(pwb, P.partner, 'Closed')).toEqual(['', '', 'No', '']);
    expect(column(pwb, P.partner, 'Desk: Commitment')).toEqual(['', 2, '', '']);
    expect(column(pwb, P.partner, 'Exited date')).toEqual(['', '', '', '2026-09-30']);
    expect(column(pwb, P.partner, 'Updated by')).toEqual(['Someone', 'Someone', 'Someone', 'Claude for Ruth']);
    expect(pwb[P.partner]!.flat()).not.toContain(book.companyId);
  });

  it('writes CASO answers as labels next to their notes', () => {
    expect(column(pwb, P.qualification, 'CASO: Culture')).toEqual(['Yes']);
    expect(column(pwb, P.qualification, 'CASO: Culture note')).toEqual(['Same pace']);
    expect(column(pwb, P.qualification, 'CASO: Additional value')).toEqual(['']);
    expect(column(pwb, P.marketLink, 'Partner hypothesis')).toEqual(['h_1', '']);
  });

  it('writes formula-looking text as plain strings, unchanged', () => {
    const tricky = { ...book, accounts: [anAccount({ company: '+43 Acme', comments: '@acme -x' })], partners: [aPartner({ whyItFits: '=HYPERLINK("x")' })] };
    const wb = encodePartnerBook(tricky, PARTNERS_META);
    const at = (tab: string, name: string) => wb[tab]![1]![header(pwb, tab).indexOf(name)];
    expect(at(P.account, 'Company')).toBe('+43 Acme');
    expect(at(P.partner, 'Why it fits')).toBe('=HYPERLINK("x")');
    expect(at(P.account, 'Comments')).toBe('@acme -x');
  });

  it('records the schema version and company id', () => {
    expect(pwb['_meta']).toEqual([
      ['key', 'value'], ['schemaVersion', 5], ['companyId', 'co_abcdefghij'], ['createdWith', 'desk.partnerstandard.com'],
    ]);
  });

  it('links back to the app from the start tab', () => {
    expect(pwb[P.start]!.flat()).toContain('https://desk.test/partners');
    expect(pwb[P.start]![0]).toEqual(['PartnerStandard Desk']);
  });

  it('says on the start tab that the file is the app’s database, not to edit by hand', () => {
    const intro = (lines: string[]) => lines.slice(0, 7);
    expect(intro(pwb[P.start]!.flat() as string[])).toEqual([
      'PartnerStandard Desk', '', 'Open your partners in PartnerStandard Desk:', 'https://desk.test/partners', '',
      'This file is part of PartnerStandard Desk’s database. Work in PartnerStandard Desk, not here.',
      'Please don’t edit, move or delete this file by hand. If you are an admin and must change it:',
    ]);
    const market = mwb[M.start]!.flat() as string[];
    expect(market.slice(5, 7)).toEqual(intro(pwb[P.start]!.flat() as string[]).slice(5, 7));
    for (const lines of [pwb[P.start]!.flat(), market]) {
      expect(lines.join('\n')).not.toMatch(/Editing by hand is fine|Add your own columns/);
    }
  });

  it('says on the start tab what the Accounts tab holds', () => {
    expect(pwb[P.start]!.flat()).toContain('• Each company has one row on the Accounts tab, and one row on the Partners tab for each partner type.');
    expect(mwb[M.start]!.flat().join('\n')).not.toContain('Accounts');
  });

  it('says on the start tab that PartnerStandard Desk writes over MAP health and Next milestone', () => {
    expect(pwb[P.start]!.flat()).toContain('• MAP health and Next milestone come from each partner type’s MAP. PartnerStandard Desk writes over them.');
  });

  it('a new Partners file has the Proposals tab with its header and the Start here line', () => {
    expect(header(pwb, P.proposalItem)).toEqual([
      'ID', 'Proposal ID', 'Kind', 'Partner account', 'Partner', 'Market', 'Partner hypothesis', 'About', 'What', 'Proposed', 'Details',
      'Evidence or reason', 'Proposed by', 'Status', 'Answer note', 'Proposed on', 'Answered on', 'Expires on', 'Target updated', 'Updated',
      'Updated by',
    ]);
    expect(pwb[P.proposalItem]).toHaveLength(1);
    const lines = pwb[P.start]!.flat();
    expect(lines).toContain('• The Proposals tab holds what your agents proposed and your answers. PartnerStandard Desk writes it.');
    // Last, after the MAP columns' line.
    expect(lines.at(-1)).toBe('• The Proposals tab holds what your agents proposed and your answers. PartnerStandard Desk writes it.');
    expect(mwb[M.start]!.flat().join('\n')).not.toContain('Proposals');
  });
});

describe('encodeMarket', () => {
  it('creates every tab, in order', () => {
    expect(MARKET_LAYOUT.tabOrder).toEqual(['Start here', 'Market', 'Value proposition', 'Partner hypotheses', 'Exclusions', 'Changes', '_meta']);
    expect(Object.keys(mwb)).toEqual(MARKET_LAYOUT.tabOrder);
    expect(MARKET_LAYOUT.entityOrder).toEqual(['valuePoint', 'hypothesis', 'exclusion', 'change'] satisfies MarketEntity[]);
  });

  it('lays out the entity tabs as Recruitment did, with Updated by last', () => {
    expect(header(mwb, M.valuePoint)).toEqual(['ID', 'Kind', 'Value point', 'State', 'Evidence', 'Check again', 'Updated', 'Updated by']);
    expect(header(mwb, M.hypothesis)).toEqual([
      'ID', 'Name', 'Their side', 'Their evidence', 'Our side', 'Our evidence', 'Value points', 'Companies like this one', 'Status',
      'Check again', 'Updated', 'Updated by',
    ]);
    expect(header(mwb, M.exclusion)).toEqual(['ID', 'Company', 'Website', 'Reason', 'Updated', 'Updated by']);
    expect(header(mwb, M.change)).toEqual(['ID', 'Date', 'About', 'About ID', 'What changed and why', 'Call', 'Updated', 'Updated by']);
    for (const entity of MARKET_LAYOUT.entityOrder) expect(header(mwb, M[entity])).toEqual(MARKET_LAYOUT.columns[entity].map((c) => c.header));
  });

  it('writes rows with labels, lists in one cell and yes or blank', () => {
    expect(mwb[M.valuePoint]).toEqual([
      header(mwb, M.valuePoint),
      ['v_1', 'Margin or fees', '20% margin on licenses', 'Confirmed', 'Call, 2026-10-15', '', '2026-10-15T12:00:00.000Z', 'Someone'],
      ['v_2', 'Services revenue', 'Setup days', 'Assumption', '', 'yes', '', 'Someone'],
    ]);
    expect(column(mwb, M.hypothesis, 'Value points')).toEqual(['v_1, v_2']);
    expect(column(mwb, M.change, 'About')).toEqual(['Partner hypothesis']);
    expect(column(mwb, M.change, 'Call')).toEqual(['k_abc123']);
  });

  it('writes the market as field, value and check-again rows, with Updated and Updated by rows', () => {
    expect(mwb[M.info]).toEqual([
      ['Field', 'Value', 'Check again'],
      ['Market', 'Austria', ''],
      ['Partner type', 'Reseller', ''],
      ['Feeds program', '', ''],
      ['Our product', 'Halden Endpoint', ''],
      ['Our target customers', 'Companies with 20-500 staff', ''],
      ['Why the partner route works', 'Buyers trust local IT firms.', ''],
      ['Must-haves', 'Sells into companies with 20-500 staff', 'yes'],
      ['How the market buys', 'Customer first', ''],
      ['How the market buys: note', '', ''],
      ['Statement', 'In Austria, IT service companies will resell it.', 'yes'],
      ['Expected partners', 12, ''],
      ['Status', 'Partly validated', ''],
      ['Status note', 'Two calls back it up', ''],
      ['Copied from', 'Germany · Reseller', ''],
      ['Updated', '2026-10-20T09:00:00.000Z', ''],
      ['Updated by', 'Someone', ''],
    ]);
  });

  it('writes must-haves one per line', () => {
    const many = encodeMarket(sampleMarket({ info: { ...market.info, mustHaves: ['One', 'Two'] } }), MARKET_META);
    expect(many[M.info]!.find((row) => row[0] === 'Must-haves')?.[1]).toBe('One\nTwo');
  });

  it('records the schema version, market id and company id', () => {
    expect(mwb['_meta']).toEqual([
      ['key', 'value'], ['schemaVersion', 2], ['marketId', 'm_abcdefghij'], ['companyId', 'co_abcdefghij'],
      ['createdWith', 'desk.partnerstandard.com'],
    ]);
  });

  it('links back to the market from the start tab', () => {
    expect(mwb[M.start]!.flat()).toContain('https://desk.test/markets/m_abcdefghij');
  });
});

describe('both workbooks', () => {
  it('only ever emit strings, numbers and booleans, and no em dash', () => {
    for (const wb of [pwb, mwb]) {
      for (const grid of Object.values(wb)) {
        for (const cell of grid.flat()) {
          expect(['string', 'number', 'boolean']).toContain(typeof cell);
          if (typeof cell === 'string') expect(cell).not.toContain('—');
        }
      }
    }
  });
});

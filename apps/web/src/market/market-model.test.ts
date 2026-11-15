import { accountOf, type Partner } from '@partner-desk/core';
import { anAccount, call, marketLink, partner, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { describe, expect, it } from 'vitest';
import {
  attentionOf, callLabel, combinedSaveState, callNotes, changeLogCall, changesNewestFirst, changeSubject, closedChip, laneOf, linkedPartners,
  marketCalls, marketIssues, marketPartners, marketPath, parseFirstPartners, parseTab, pipelineOf, rowKey, toggleValuePoint,
  withEvidence,
} from './market-model';

const M = 'm_abcdefghij';

/** A partner type plus the company it belongs to. Company facts live on the account. */
function named(id: string, company: string, over: Partial<Partner> = {}) {
  return {
    account: anAccount({ id: `a_${id}`, company, website: '' }),
    partner: partner({ id, accountId: `a_${id}`, ...over }),
  };
}

/** A book with partners in every place: two in this market's steps, one signed, one closed, one exited, one elsewhere. */
function book() {
  const rows = [
    named('p_1', 'Alpha'),
    named('p_2', 'Beta', { step: 'map' }),
    named('p_3', 'Gamma', { stage: 'growth', step: null, signedDate: '2026-09-15' }),
    named('p_4', 'Delta', { step: 'discovery_call', closed: 'not_now' }),
    named('p_5', 'Epsilon', { stage: 'exit', step: null, signedDate: '2026-09-01', exitedDate: '2026-10-01' }),
    named('p_6', 'Zeta'),
  ];
  return sampleBook({
    accounts: rows.map((row) => row.account),
    partners: rows.map((row) => row.partner),
    marketLinks: [
      marketLink({ id: 'l_1', partnerId: 'p_1' }),
      marketLink({ id: 'l_2', partnerId: 'p_2', hypothesisId: 'h_1' }),
      marketLink({ id: 'l_3', partnerId: 'p_3', hypothesisId: 'h_1' }),
      marketLink({ id: 'l_4', partnerId: 'p_4' }),
      marketLink({ id: 'l_5', partnerId: 'p_5' }),
      marketLink({ id: 'l_6', partnerId: 'p_6', marketId: 'm_other00000' }),
      // A second link to the same market (a hand edit) does not show the partner twice.
      marketLink({ id: 'l_7', partnerId: 'p_1', hypothesisId: 'h_1' }),
    ],
    calls: [],
  });
}

const names = (cards: Array<{ partner: Partner }>) => cards.map((c) => accountOf(book(), c.partner)?.company ?? '');

describe('the address', () => {
  it('opens a tab from ?tab=, else the Pipeline', () => {
    expect(parseTab('hypotheses')).toBe('hypotheses');
    expect(parseTab('hypothesis')).toBe('hypothesis');
    expect(parseTab(null)).toBe('pipeline');
    expect(parseTab('nonsense')).toBe('pipeline');
    expect(marketPath('m_1', 'pipeline')).toBe('/markets/m_1');
    expect(marketPath('m_1', 'changes')).toBe('/markets/m_1?tab=changes');
  });

  it('reads ?firstPartners= as a count from 1 to 20', () => {
    expect(parseFirstPartners('2')).toBe(2);
    expect(parseFirstPartners(['3', '4'])).toBe(3);
    for (const value of [undefined, '', '0', '21', '-1', '2x', '1000']) expect(parseFirstPartners(value)).toBeNull();
  });
});

describe('the save indicator', () => {
  it('shows saving while either file saves, then an error, then saved', () => {
    expect(combinedSaveState('saved', 'saving')).toBe('saving');
    expect(combinedSaveState('error', 'saved')).toBe('error');
    expect(combinedSaveState('idle', 'saved')).toBe('saved');
    expect(combinedSaveState('idle', 'idle')).toBe('idle');
  });
});

describe('the Pipeline', () => {
  it('lists this market’s partners once each, with the hypothesis of their first link here', () => {
    expect(marketPartners(book(), M).map((m) => [accountOf(book(), m.partner)?.company, m.hypothesisId])).toEqual([
      ['Alpha', null], ['Beta', 'h_1'], ['Gamma', 'h_1'], ['Delta', null], ['Epsilon', null],
    ]);
  });

  it('puts partners in their step, signed ones in Signed, and hides closed and exited ones unless asked', () => {
    const { lanes, hiddenClosed } = pipelineOf(book(), M, { showClosed: false, hypothesis: 'all' });
    expect(lanes.map((l) => [l.title, names(l.cards)])).toEqual([
      ['Researched', ['Alpha']], ['Discovery call', []], ['Qualification', []], ['MAP', ['Beta']], ['Signed', ['Gamma']],
    ]);
    expect(hiddenClosed).toBe(2);
    const all = pipelineOf(book(), M, { showClosed: true, hypothesis: 'all' });
    expect(names(all.lanes.find((l) => l.lane === 'discovery_call')!.cards)).toEqual(['Delta']);
    expect(names(all.lanes.find((l) => l.lane === 'signed')!.cards)).toEqual(['Gamma', 'Epsilon']);
    expect(all.hiddenClosed).toBe(0);
  });

  it('filters by the partner hypothesis the link to this market names', () => {
    const one = pipelineOf(book(), M, { showClosed: false, hypothesis: 'h_1' });
    expect(one.lanes.flatMap((l) => names(l.cards))).toEqual(['Beta', 'Gamma']);
    expect(one.hiddenClosed).toBe(0);
    const none = pipelineOf(book(), M, { showClosed: false, hypothesis: 'none' });
    expect(none.lanes.flatMap((l) => names(l.cards))).toEqual(['Alpha']);
    expect(none.hiddenClosed).toBe(2);
  });

  it('shows a partner in two markets in both pipelines, each with the hypothesis its own link names', () => {
    const OTHER = 'm_other00000';
    const eta = named('p_7', 'Eta', { step: 'qualification' });
    const both = eta.partner;
    const base = book();
    const twoMarkets = sampleBook({
      ...base,
      accounts: [...base.accounts, eta.account],
      partners: [...base.partners, both],
      marketLinks: [
        ...base.marketLinks,
        marketLink({ id: 'l_8', partnerId: 'p_7', marketId: M, hypothesisId: 'h_1' }),
        marketLink({ id: 'l_9', partnerId: 'p_7', marketId: OTHER, hypothesisId: 'h_2' }),
      ],
    });
    const here = marketPartners(twoMarkets, M).find((m) => m.partner.id === 'p_7');
    const there = marketPartners(twoMarkets, OTHER).find((m) => m.partner.id === 'p_7');
    expect(here?.hypothesisId).toBe('h_1');
    expect(there?.hypothesisId).toBe('h_2');
    const lane = (marketId: string, hypothesis: string) => pipelineOf(twoMarkets, marketId, { showClosed: false, hypothesis })
      .lanes.find((l) => l.lane === 'qualification')!.cards.map((c) => [accountOf(twoMarkets, c.partner)?.company ?? '', c.hypothesisId]);
    expect(lane(M, 'h_1')).toEqual([['Eta', 'h_1']]);
    expect(lane(M, 'h_2')).toEqual([]);
    expect(lane(OTHER, 'h_2')).toEqual([['Eta', 'h_2']]);
    expect(lane(OTHER, 'h_1')).toEqual([]);
  });

  it('chips a closed partner with how it closed, and an exited one as Exited', () => {
    const [, , signed, closed, exited] = book().partners;
    expect(closedChip(closed!)).toBe('Not now');
    expect(closedChip(exited!)).toBe('Exited');
    expect(closedChip(signed!)).toBeNull();
    expect(laneOf(exited!)).toBe('signed');
    expect(laneOf(closed!)).toBe('discovery_call');
  });
});

describe('calls and the change log', () => {
  const withCalls = () => ({
    ...book(),
    calls: [
      call({ id: 'k_1', partnerId: 'p_1', date: '2026-10-20' }),
      call({ id: 'k_2', partnerId: 'p_6', date: '2026-10-27' }),
      call({ id: 'k_3', partnerId: 'p_2', date: '2026-10-22', kind: 'follow_up' }),
    ],
  });

  it('lists the calls with this market’s partners, newest first', () => {
    expect(marketCalls(withCalls(), M).map((c) => c.id)).toEqual(['k_3', 'k_1']);
  });

  it('offers the latest call while it is less than 7 days old, and nothing after', () => {
    expect(changeLogCall(withCalls(), M, '2026-10-28')).toBe('k_3');
    expect(changeLogCall(withCalls(), M, '2026-10-29')).toBeNull();
    expect(changeLogCall(book(), M, '2026-10-28')).toBeNull();
  });

  it('names a call by date, company and kind', () => {
    const calls = withCalls();
    expect(callLabel(calls, calls.calls[2]!)).toBe('22 Oct 2026 · Beta · Follow-up');
    expect(callLabel(calls, call({ partnerId: 'p_gone' }))).toBe('10 Oct 2026 · A deleted partner · Discovery');
  });

  it('sorts changes newest first and says what each is about', () => {
    const market = sampleMarket();
    const older = { ...market.changes[0]!, id: 'g_0', date: '2026-10-01' };
    expect(changesNewestFirst([older, market.changes[0]!]).map((c) => c.id)).toEqual(['g_1', 'g_0']);
    expect(changeSubject(market, { entity: 'market', entityId: 'expectedCandidates' })).toBe('Expected partners');
    expect(changeSubject(market, { entity: 'market', entityId: '' })).toBeNull();
    expect(changeSubject(market, { entity: 'value_point', entityId: 'v_1' })).toBe('20% margin on licenses');
    expect(changeSubject(market, { entity: 'hypothesis', entityId: 'h_gone' })).toBe('Since deleted');
  });
});

describe('partner hypotheses', () => {
  it('links the partners whose link here names the hypothesis', () => {
    expect(linkedPartners(book(), M, 'h_1').map((p) => accountOf(book(), p)?.company)).toEqual(['Beta', 'Gamma']);
  });

  it('turns a call’s topics and notes into evidence lines', () => {
    const notes = callNotes(call({ topics: { ...call().topics, customerPains: 'Manual  invoices\ntake days' }, notes: 'More' }));
    expect(notes.map((n) => n.title)).toEqual(['Customer Pains', 'Other notes']);
    expect(withEvidence('', 'A: b')).toBe('A: b');
    expect(withEvidence('First\n', 'A: b')).toBe('First\nA: b');
  });

  it('picks at most four value points', () => {
    expect(toggleValuePoint(['a'], 'a')).toEqual({ ok: true, ids: [] });
    expect(toggleValuePoint(['a', 'b', 'c', 'd'], 'e')).toEqual({ ok: false, message: 'Pick the three or four that matter most' });
  });
});

describe('needs attention', () => {
  it('lists the sheet’s row issues at the top, and puts deleted references on their rows', () => {
    const market = sampleMarket({
      valuePoints: [],
      changes: [{ ...sampleMarket().changes[0]!, callId: 'k_gone' }],
    });
    const attention = attentionOf(market, [
      { tab: 'Exclusions', row: 3, message: 'Website is empty' },
      { tab: 'Market', row: 0, message: 'The "Statement" row is missing' },
    ], sampleBook());
    expect(attention.general).toEqual([
      { where: 'Exclusions tab, row 3', message: 'Website is empty' },
      { where: 'Market tab: a row is missing', message: 'The "Statement" row is missing' },
    ]);
    expect(attention.byRow.get(rowKey('hypothesis', 'h_1'))).toEqual(['A value point it uses was deleted']);
    expect(attention.byRow.get(rowKey('change', 'g_1'))).toEqual(['The call it names was deleted']);
    expect(attentionOf(sampleMarket(), [], sampleBook()).byRow.size).toBe(0);
  });

  it('shows the Market tab’s issues on the Market hypothesis tab', () => {
    expect(marketIssues([{ tab: 'Market', row: 4, message: 'x' }, { tab: 'Changes', row: 2, message: 'y' }])).toEqual(['Market tab, row 4: x']);
  });
});

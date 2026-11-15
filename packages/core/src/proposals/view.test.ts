import { describe, expect, it } from 'vitest';
import type { Market } from '../markets/types';
import type { Partner, PartnerBook } from '../partners/types';
import { aPartner, EARLIER, marketInfo, NOW, proposalItem, sampleBook, sampleMarket } from '../test-builders';
import type { ProposalItem, ProposalStatus } from './types';
import { proposalViews, type ProposalHead } from './view';

const EXPIRES = '2026-10-31T09:00:00.000Z';
const head = (over: Partial<ProposalHead> = {}): ProposalHead => ({
  id: 'prp_abc123', kind: 'fourC', status: 'waiting', createdAt: EARLIER, answeredAt: null, expiresAt: EXPIRES,
  agentName: 'Claude', makerOn: true, ...over,
});
const bookOf = (items: ProposalItem[], partner: Partial<Partner> = {}, more: Partial<PartnerBook> = {}) =>
  sampleBook({ partners: [aPartner(partner)], proposalItems: items, ...more });
const views = (heads: ProposalHead[], book: PartnerBook, now = NOW, markets: Record<string, { market: Market | null; archived: boolean }> = {}) =>
  proposalViews(heads, { book, markets }, now);

const stepItem = (over: Partial<ProposalItem> = {}) => proposalItem({
  kind: 'stage', what: 'step', proposed: 'Qualification', evidence: 'The call went well', ...over,
});
const atDiscovery = { step: 'discovery_call' as const };

describe('proposalViews', () => {
  it('proposalView says changed when the partner row\'s updatedAt differs', () => {
    // Claude proposed Credibility 3 when the row was as of EARLIER; Ruth then set Credibility to 1 by hand.
    const item = proposalItem({ proposed: '3', targetUpdated: EARLIER });
    const changed = bookOf([item], { desk: { customerBase: null, credibility: 1, capability: 3, commitment: null }, updatedAt: '2026-10-20T09:00:00.000Z' });
    const [view] = views([head()], changed);
    expect(view).toMatchObject({
      state: 'changed', cannot: null, answeredLine: null, about: 'Acme GmbH', reason: '', targetUpdatedAt: '2026-10-20T09:00:00.000Z',
      target: { accountId: 'a_abc123', partnerId: 'p_abc123', marketId: null, hypothesisId: null },
    });
    expect(view!.rows).toEqual([{
      itemId: 'r_abc123', what: 'Credibility (desk check)', now: '1', proposed: '3', evidence: 'Ten customers named on their site', status: 'waiting',
    }]);

    expect(views([head()], bookOf([item], { desk: { customerBase: null, credibility: 2, capability: 3, commitment: null } }))[0]!.state).toBe('waiting');
  });

  it('shows a signing date as a day, "3 Nov 2026", now and proposed, while the sheet keeps 2026-11-03', () => {
    const item = proposalItem({ kind: 'signed', what: 'signedDate', proposed: '2026-11-03', evidence: 'Signed yesterday' });
    const [waiting] = views([head({ kind: 'signed' })], bookOf([item], { step: 'map' }));
    expect(waiting!.rows[0]).toMatchObject({ what: 'Signed date', now: '', proposed: '3 Nov 2026' });
    // Signed meanwhile by hand on 25 Oct: the card can't accept, and shows that day too.
    const [signed] = views([head({ kind: 'signed' })], bookOf([item], { stage: 'onboarding', step: null, signedDate: '2026-10-25' }));
    expect(signed!.rows[0]).toMatchObject({ now: '25 Oct 2026', proposed: '3 Nov 2026' });
  });

  it('can\'t say "changed since" when Target updated is empty', () => {
    const item = proposalItem({ proposed: '3', targetUpdated: null });
    const [view] = views([head()], bookOf([item], { updatedAt: '2026-10-20T09:00:00.000Z' }));
    expect(view).toMatchObject({ state: 'waiting', targetUpdatedAt: '2026-10-20T09:00:00.000Z' });
  });

  it('proposalView says cannot, with the rule\'s message, for a removed, closed or signed partner type', () => {
    const item = stepItem();
    const removed = views([head({ kind: 'stage' })], sampleBook({ partners: [], proposalItems: [item] }))[0]!;
    expect(removed).toMatchObject({ state: 'cannot', cannot: 'This item no longer exists', about: 'Acme GmbH', reason: 'The call went well' });
    expect(removed.rows).toEqual([{ itemId: 'r_abc123', what: 'Step', now: '', proposed: 'Qualification', evidence: '', status: 'waiting' }]);

    expect(views([head({ kind: 'stage' })], bookOf([item], { ...atDiscovery, closed: 'no', closedReason: 'No fit' }))[0])
      .toMatchObject({ state: 'cannot', cannot: 'Reopen this partner before you move it.' });
    expect(views([head({ kind: 'stage' })], bookOf([item], { stage: 'onboarding', step: null, signedDate: '2026-10-25' }))[0])
      .toMatchObject({ state: 'cannot', cannot: 'A step only applies in recruitment.' });

    const ok = views([head({ kind: 'stage' })], bookOf([item], atDiscovery))[0]!;
    expect(ok).toMatchObject({ state: 'waiting', cannot: null });
    expect(ok.rows[0]).toMatchObject({ now: 'Discovery call', proposed: 'Qualification' });
  });

  it('says cannot for a proposal whose words can\'t be read any more', () => {
    const [view] = views([head({ kind: 'stage' })], bookOf([stepItem({ proposed: 'Soon' })], atDiscovery));
    expect(view).toMatchObject({ state: 'cannot', cannot: 'This item no longer exists' });
  });

  it('proposalView says already when the market already has the proposed status', () => {
    const item = proposalItem({
      kind: 'marketStatus', accountId: null, partnerId: null, marketId: 'm_abcdefghij', about: 'Austria', what: 'marketStatus',
      proposed: 'Validated', details: 'Status note: Three calls', evidence: 'Calls back it', targetUpdated: '2026-10-20T09:00:00.000Z',
    });
    const book = bookOf([item]);
    const market = (status: 'validated' | 'open', updatedAt = '2026-10-20T09:00:00.000Z') =>
      ({ m_abcdefghij: { market: sampleMarket({ info: marketInfo({ status, updatedAt }) }), archived: false } });
    const at = (status: 'validated' | 'open', updatedAt?: string) => views([head({ kind: 'marketStatus' })], book, NOW, market(status, updatedAt))[0]!;
    expect(at('validated', '2026-10-30T09:00:00.000Z')).toMatchObject({ state: 'already', cannot: null });
    expect(at('validated').rows[0]).toMatchObject({ what: 'Market status', now: 'Validated', proposed: 'Validated', evidence: 'Three calls' });
    expect(at('open')).toMatchObject({ state: 'waiting', about: 'Austria', reason: 'Calls back it' });
    expect(at('open', '2026-10-30T09:00:00.000Z')).toMatchObject({ state: 'changed' });
    expect(views([head({ kind: 'marketStatus' })], book, NOW, { m_abcdefghij: { market: sampleMarket(), archived: true } })[0])
      .toMatchObject({ state: 'cannot', cannot: 'This market is archived.' });
    // This week reads no market file: the card can't tell, so it simply waits.
    expect(views([head({ kind: 'marketStatus' })], book)[0]).toMatchObject({ state: 'waiting', targetUpdatedAt: null });
    expect(views([head({ kind: 'marketStatus' })], book)[0]!.rows[0]).toMatchObject({ now: '' });
  });

  it('proposalViews hides a proposal 30 days after it expired, and shows "Accepted 2 of 4"', () => {
    const item = proposalItem({ expiresOn: EXPIRES });
    const book = bookOf([item]);
    // Waiting in the index, but past its date: expired on screen before the job runs.
    expect(views([head()], book, '2026-11-01T00:00:00.000Z')[0]).toMatchObject({
      state: 'expired', answeredLine: 'Expired: not answered within 30 days.', cannot: null,
    });
    expect(views([head({ status: 'expired', answeredAt: EXPIRES })], book, '2026-11-30T09:00:00.000Z')).toHaveLength(1);
    expect(views([head({ status: 'expired', answeredAt: EXPIRES })], book, '2026-11-30T09:00:01.000Z')).toEqual([]);
    expect(views([head()], book, '2026-11-30T09:00:01.000Z')).toEqual([]);

    const letters = (statuses: ProposalItem['status'][]) => ['customerBase', 'credibility', 'capability', 'commitment'].map((c, i) =>
      proposalItem({ id: `r_${i}`, what: `desk.${c}` as ProposalItem['what'], status: statuses[i]!, answeredOn: statuses[i] === 'waiting' ? null : NOW }));
    const answered = (statuses: ProposalItem['status'][], status: ProposalStatus) =>
      views([head({ status, answeredAt: NOW })], bookOf(letters(statuses)))[0]!;
    expect(answered(['accepted', 'rejected', 'accepted', 'rejected'], 'partly_accepted')).toMatchObject({ state: 'answered', answeredLine: 'Accepted 2 of 4' });
    expect(answered(['accepted', 'accepted', 'accepted', 'accepted'], 'accepted')).toMatchObject({ answeredLine: 'Accepted' });
    expect(answered(['rejected', 'rejected', 'rejected', 'rejected'], 'rejected')).toMatchObject({ answeredLine: 'Rejected' });
    expect(answered(['accepted', 'rejected', 'accepted', 'rejected'], 'partly_accepted').rows.map((r) => r.status))
      .toEqual(['accepted', 'rejected', 'accepted', 'rejected']);
    // The file's answer wins over a waiting index row (the index write failed after the file was written).
    expect(views([head()], bookOf(letters(['accepted', 'accepted', 'rejected', 'rejected'])))[0])
      .toMatchObject({ state: 'answered', answeredLine: 'Accepted 2 of 4' });
    expect(views([head({ status: 'accepted', answeredAt: NOW })], bookOf(letters(['accepted', 'accepted', 'accepted', 'accepted'])), '2026-11-28T10:00:01.000Z'))
      .toEqual([]);
  });

  it('an answered card with no readable answered time shows until 30 days after its expiry, not for ever', () => {
    const answeredItem = proposalItem({ expiresOn: EXPIRES, status: 'accepted', answeredOn: null });
    const book = bookOf([answeredItem]);
    // The rows say accepted, with no time; the index still waits.
    expect(views([head()], book, '2026-11-30T09:00:00.000Z')).toHaveLength(1);
    expect(views([head()], book, '2026-11-30T09:00:01.000Z')).toEqual([]);
    // The index says accepted with no time, the rows still wait.
    const waitingItem = proposalItem({ expiresOn: EXPIRES });
    expect(views([head({ status: 'accepted', answeredAt: null })], bookOf([waitingItem]), '2026-11-30T09:00:00.000Z')).toHaveLength(1);
    expect(views([head({ status: 'accepted', answeredAt: null })], bookOf([waitingItem]), '2026-11-30T09:00:01.000Z')).toEqual([]);
  });

  it('shows only proposals with rows in the book, newest first, and never a withdrawn or replaced one', () => {
    const a = proposalItem({ id: 'r_a', proposalId: 'prp_a', what: 'desk.commitment', proposed: '2' });
    const b = proposalItem({ id: 'r_b', proposalId: 'prp_b', proposed: '3' });
    const book = bookOf([a, b]);
    const heads = [
      head({ id: 'prp_a', createdAt: '2026-10-20T09:00:00.000Z' }), head({ id: 'prp_b', createdAt: '2026-10-25T09:00:00.000Z' }),
      head({ id: 'prp_none', createdAt: '2026-10-26T09:00:00.000Z' }),
    ];
    expect(views(heads, book).map((v) => v.head.id)).toEqual(['prp_b', 'prp_a']);
    expect(views([head({ id: 'prp_a', status: 'withdrawn', answeredAt: NOW }), head({ id: 'prp_b', status: 'replaced', answeredAt: NOW })], book))
      .toEqual([]);
  });

  it('gives a new partners proposal one row per company, about the market', () => {
    const company = (id: string, name: string, details = '') => proposalItem({
      id, kind: 'partners', accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: 'h_1', about: 'Austria',
      what: 'company', proposed: name, details, evidence: 'A web search', targetUpdated: null,
    });
    const book = bookOf([company('r_1', 'Delta IT', 'Why it fits: Sells to clinics'), company('r_2', 'Epsilon')]);
    const [view] = views([head({ kind: 'partners' })], book, NOW, { m_abcdefghij: { market: sampleMarket(), archived: false } });
    expect(view).toMatchObject({
      state: 'waiting', about: 'Austria', reason: 'A web search',
      target: { accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: 'h_1' },
    });
    expect(view!.rows).toEqual([
      { itemId: 'r_1', what: 'New partner', now: '', proposed: 'Delta IT', evidence: 'Sells to clinics', status: 'waiting' },
      { itemId: 'r_2', what: 'New partner', now: '', proposed: 'Epsilon', evidence: '', status: 'waiting' },
    ]);
  });
});

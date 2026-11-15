import { describe, expect, it } from 'vitest';
import type { Market } from '../markets/types';
import type { Partner, PartnerBook } from '../partners/types';
import { aPartner, EARLIER, marketInfo, sampleBook, sampleMarket } from '../test-builders';
import type { ProposalInput } from './input';
import { alreadySo, checkProposal, expiresAt, possibleNow, targetUpdatedAt, type ProposalScene } from './rules';

const bookWith = (over: Partial<Partner> = {}): PartnerBook => sampleBook({ partners: [aPartner(over)] });
const scene = (over: Partial<ProposalScene> = {}): ProposalScene => ({ book: bookWith(), market: sampleMarket(), archived: false, ...over });
const on = (partner: Partial<Partner>) => scene({ book: bookWith(partner) });

const P = { partnerId: 'p_abc123', expectedUpdatedAt: EARLIER };
const stage = (to: Extract<ProposalInput, { kind: 'stage' }>['to']): ProposalInput => ({ kind: 'stage', ...P, to, reason: 'They asked for a call' });
const close = (as: 'not_now' | 'no' = 'no'): ProposalInput => ({ kind: 'close', ...P, as, reason: 'No overlap' });
const signed: ProposalInput = { kind: 'signed', ...P, signedDate: '2026-11-03', reason: 'Signed on Monday' };
const fourC = (letters: Partial<Record<'customerBase' | 'credibility' | 'capability' | 'commitment', 0 | 1 | 2 | 3>>): ProposalInput => ({
  kind: 'fourC', ...P,
  letters: Object.fromEntries(Object.entries(letters).map(([c, score]) => [c, { score, evidence: `${c} evidence` }])),
});
const M = { marketId: 'm_abcdefghij', expectedUpdatedAt: '2026-10-20T09:00:00.000Z', reason: 'Three calls back it' };
const hypothesisStatus = (to: 'draft' | 'holds' | 'dropped', hypothesisId = 'h_1'): ProposalInput => ({ kind: 'hypothesisStatus', ...M, hypothesisId, to });
const marketStatus = (to: 'open' | 'validated' | 'partly_validated' | 'invalidated'): ProposalInput => ({ kind: 'marketStatus', ...M, to, note: 'Three calls' });
const partners = (hypothesisId: string | null = null): ProposalInput => ({
  kind: 'partners', marketId: 'm_abcdefghij', hypothesisId, reason: 'A web search',
  companies: [{ company: 'Delta', website: '', country: '', vertical: '', subVertical: '', partnerType: '', targetCustomerType: '', whyItFits: '', sourceDetail: '' }],
});

const refusal = (message: string) => ({ ok: false, message });
const OK = { ok: true };

describe('checkProposal', () => {
  it('refuses a stage move to exit with "Only a person moves a partner into Exit."', () => {
    expect(checkProposal(stage('exit'), on({ stage: 'expansion', step: null, signedDate: '2026-01-10' })))
      .toEqual(refusal('Only a person moves a partner into Exit.'));
    expect(checkProposal(stage('expansion'), on({ stage: 'growth', step: null, signedDate: '2026-01-10' }))).toEqual(OK);
  });

  it('refuses a step two ahead, a signing of one signed, closing one closed, with the lifecycle\'s message', () => {
    expect(checkProposal(stage('qualification'), scene())).toEqual(refusal('Move one step at a time.'));
    expect(checkProposal(stage('discovery_call'), scene())).toEqual(OK);
    const signedOne = on({ stage: 'onboarding', step: null, signedDate: '2026-01-10' });
    expect(checkProposal(signed, signedOne)).toEqual(refusal('This partner is already signed.'));
    expect(checkProposal(close('no'), on({ closed: 'not_now', closedReason: 'Busy' }))).toEqual(refusal('Closed already as Not now.'));
    expect(checkProposal(close('no'), signedOne)).toEqual(refusal("A signed partner can't be closed. Use Mark exited instead."));
    expect(checkProposal(stage('onboarding'), scene())).toEqual(refusal('Mark this partner signed before you move its stage.'));
    expect(checkProposal(stage('discovery_call'), on({ closed: 'no' }))).toEqual(refusal('Reopen this partner before you move it.'));
    expect(checkProposal(signed, on({ closed: 'no' }))).toEqual(refusal('Reopen this partner before you mark it signed.'));
  });

  it('refuses a closed or exited partner type its 4C scores, and every partner kind once exited', () => {
    expect(checkProposal(fourC({ credibility: 3 }), on({ closed: 'no' }))).toEqual(refusal('Closed already as No.'));
    const exited = on({ stage: 'exit', step: null, signedDate: '2025-01-10', exitedDate: '2026-10-01', exitReason: 'Stopped' });
    for (const input of [fourC({ credibility: 3 }), stage('growth'), close(), signed]) {
      expect(checkProposal(input, exited)).toEqual(refusal('This partner is already marked exited.'));
    }
  });

  it('refuses a proposal equal to what is there now', () => {
    // aPartner: desk Credibility 1 and Capability 3, at Researched.
    expect(checkProposal(fourC({ credibility: 1, capability: 3 }), scene())).toEqual(refusal('It is like this already.'));
    expect(checkProposal(fourC({ credibility: 1, capability: 2 }), scene())).toEqual(OK);
    expect(checkProposal(stage('researched'), scene())).toEqual(refusal('It is like this already.'));
    expect(checkProposal(stage('growth'), on({ stage: 'growth', step: null, signedDate: '2026-01-10' }))).toEqual(refusal('It is like this already.'));
    // sampleMarket: Partly validated, and its hypothesis h_1 holds.
    expect(checkProposal(hypothesisStatus('holds'), scene())).toEqual(refusal('It is like this already.'));
    expect(checkProposal(hypothesisStatus('dropped'), scene())).toEqual(OK);
    expect(checkProposal(marketStatus('partly_validated'), scene())).toEqual(refusal('It is like this already.'));
    expect(checkProposal(marketStatus('validated'), scene())).toEqual(OK);
  });

  it('keeps "already so" apart from "not possible now"', () => {
    expect(possibleNow(stage('researched'), scene())).toEqual(OK);
    expect(alreadySo(stage('researched'), scene())).toBe(true);
    expect(alreadySo(stage('discovery_call'), scene())).toBe(false);
    expect(alreadySo(partners(), scene())).toBe(false);
  });

  it('says a missing partner type, market or hypothesis is gone', () => {
    const gone = refusal('This item no longer exists');
    expect(checkProposal(fourC({ credibility: 3 }), scene({ book: sampleBook({ partners: [] }) }))).toEqual(gone);
    expect(checkProposal(marketStatus('validated'), scene({ market: null }))).toEqual(gone);
    expect(checkProposal(partners(), scene({ market: null }))).toEqual(gone);
    expect(checkProposal(hypothesisStatus('dropped', 'h_gone'), scene())).toEqual(gone);
    expect(checkProposal(partners('h_gone'), scene())).toEqual(gone);
    expect(checkProposal(partners('h_1'), scene())).toEqual(OK);
    const other: Market = sampleMarket({ info: marketInfo({ marketId: 'm_other00000' }) });
    expect(checkProposal(marketStatus('validated'), scene({ market: other }))).toEqual(gone);
  });

  it('refuses new partners and a market status for an archived market', () => {
    const archived = scene({ archived: true });
    expect(checkProposal(partners(), archived)).toEqual(refusal('This market is archived.'));
    expect(checkProposal(marketStatus('validated'), archived)).toEqual(refusal('This market is archived.'));
    expect(checkProposal(hypothesisStatus('dropped'), archived)).toEqual(OK);
  });
});

describe('targetUpdatedAt', () => {
  it('is the partner row\'s, the hypothesis row\'s or the market\'s updatedAt; null for new partners', () => {
    const s = scene({ book: bookWith({ updatedAt: '2026-10-25T08:00:00.000Z' }) });
    expect(targetUpdatedAt(fourC({ credibility: 3 }), s)).toBe('2026-10-25T08:00:00.000Z');
    expect(targetUpdatedAt(close(), s)).toBe('2026-10-25T08:00:00.000Z');
    expect(targetUpdatedAt(hypothesisStatus('dropped'), s)).toBe('2026-10-16T08:30:00.000Z');
    expect(targetUpdatedAt(marketStatus('validated'), s)).toBe('2026-10-20T09:00:00.000Z');
    expect(targetUpdatedAt(partners(), s)).toBeNull();
    expect(targetUpdatedAt(fourC({ credibility: 3 }), scene({ book: sampleBook({ partners: [] }) }))).toBeNull();
  });
});

describe('expiresAt', () => {
  it('expiresAt is 30 days after createdAt', () => {
    expect(expiresAt('2026-11-04T10:15:00.000Z')).toBe('2026-12-04T10:15:00.000Z');
    expect(expiresAt('2026-02-10T00:00:00.000Z')).toBe('2026-03-12T00:00:00.000Z');
  });
});

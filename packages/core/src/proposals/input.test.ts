import { describe, expect, it } from 'vitest';
import { aPartner, sampleBook } from '../test-builders';
import {
  PROPOSAL_EXPIRES_DAYS, PROPOSAL_INDEX_KEEP_DAYS, PROPOSAL_MAX_COMPANIES, PROPOSAL_SHOWN_AFTER_DAYS, PROPOSAL_TEXT_MAX,
  proposalInputSchema, proposedCompanySchema, targetOf, type ProposalInput,
} from './input';

const fourC = (over: Record<string, unknown> = {}) => ({
  kind: 'fourC', partnerId: 'p_abc123', expectedUpdatedAt: null,
  letters: { credibility: { score: 3, evidence: 'Ten customers named on their site' } }, ...over,
});
const partners = (n: number) => ({
  kind: 'partners', marketId: 'm_abcdefghij', hypothesisId: null, reason: 'A web search',
  companies: Array.from({ length: n }, (_, i) => ({ company: `Company ${i}` })),
});
const ok = (input: unknown) => proposalInputSchema.safeParse(input).success;

describe('the proposal constants', () => {
  it('are the spec values', () => {
    expect([PROPOSAL_EXPIRES_DAYS, PROPOSAL_SHOWN_AFTER_DAYS, PROPOSAL_INDEX_KEEP_DAYS]).toEqual([30, 30, 90]);
    expect([PROPOSAL_TEXT_MAX, PROPOSAL_MAX_COMPANIES]).toEqual([2000, 50]);
  });
});

describe('proposalInputSchema', () => {
  it('refuses 51 companies, a score of 4, a reason of 2,001 characters and a confirmed letter', () => {
    expect(ok(partners(50))).toBe(true);
    expect(ok(partners(51))).toBe(false);
    expect(ok(partners(0))).toBe(false);

    expect(ok(fourC())).toBe(true);
    expect(ok(fourC({ letters: { credibility: { score: 4, evidence: 'x' } } }))).toBe(false);

    const stage = { kind: 'stage', partnerId: 'p_abc123', expectedUpdatedAt: null, to: 'discovery_call' };
    expect(ok({ ...stage, reason: 'a'.repeat(2000) })).toBe(true);
    expect(ok({ ...stage, reason: 'a'.repeat(2001) })).toBe(false);
    expect(ok({ ...stage, reason: '   ' })).toBe(false);

    // The confirmed check is never proposable: not beside the letters, not inside one, not as a letter's own field.
    expect(ok(fourC({ confirmed: { credibility: { score: 3, evidence: 'x' } } }))).toBe(false);
    expect(ok(fourC({ letters: { confirmed: { score: 3, evidence: 'x' } } }))).toBe(false);
    expect(ok(fourC({ letters: { credibility: { score: 3, evidence: 'x', check: 'confirmed' } } }))).toBe(false);
  });

  it('wants one to four letters, each with its evidence', () => {
    expect(ok(fourC({ letters: {} }))).toBe(false);
    expect(ok(fourC({ letters: { credibility: { score: 3, evidence: '' } } }))).toBe(false);
    expect(ok(fourC({ letters: { credibility: { score: 3, evidence: 'a'.repeat(2001) } } }))).toBe(false);
    const all = Object.fromEntries(['customerBase', 'credibility', 'capability', 'commitment'].map((c) => [c, { score: 0, evidence: 'x' }]));
    expect(ok(fourC({ letters: all }))).toBe(true);
    expect(ok(fourC({ reason: 'not here' }))).toBe(false);
  });

  it('takes a step, a stage after signing and exit, so the rule can refuse exit in words', () => {
    const stage = (to: string) => ({ kind: 'stage', partnerId: 'p_abc123', expectedUpdatedAt: null, to, reason: 'r' });
    for (const to of ['researched', 'discovery_call', 'qualification', 'map', 'onboarding', 'growth', 'expansion', 'exit']) {
      expect(ok(stage(to))).toBe(true);
    }
    expect(ok(stage('recruitment'))).toBe(false);
  });

  it('reads every other kind strictly', () => {
    const base = { partnerId: 'p_abc123', expectedUpdatedAt: '2026-10-01T09:00:00.000Z', reason: 'r' };
    expect(ok({ kind: 'close', ...base, as: 'not_now' })).toBe(true);
    expect(ok({ kind: 'close', ...base, as: 'later' })).toBe(false);
    expect(ok({ kind: 'signed', ...base, signedDate: '2026-11-03' })).toBe(true);
    expect(ok({ kind: 'signed', ...base, signedDate: '2026-02-30' })).toBe(false);
    const market = { marketId: 'm_abcdefghij', expectedUpdatedAt: null, reason: 'r' };
    expect(ok({ kind: 'hypothesisStatus', ...market, hypothesisId: 'h_1', to: 'holds' })).toBe(true);
    expect(ok({ kind: 'hypothesisStatus', ...market, hypothesisId: 'h_1', to: 'open' })).toBe(false);
    expect(ok({ kind: 'marketStatus', ...market, to: 'validated', note: '' })).toBe(true);
    expect(ok({ kind: 'marketStatus', ...market, to: 'validated', note: 'a'.repeat(2001) })).toBe(false);
    expect(ok({ kind: 'marketStatus', ...market, to: 'validated', note: '', extra: 1 })).toBe(false);
    expect(ok({ kind: 'recordReview', ...base })).toBe(false);
  });
});

describe('proposedCompanySchema', () => {
  it('needs the company; the other columns default to empty, each at most 2,000 characters', () => {
    expect(proposedCompanySchema.parse({ company: 'Acme' })).toEqual({
      company: 'Acme', website: '', country: '', vertical: '', subVertical: '', partnerType: '', targetCustomerType: '',
      whyItFits: '', sourceDetail: '',
    });
    expect(proposedCompanySchema.safeParse({ company: '' }).success).toBe(false);
    expect(proposedCompanySchema.safeParse({ company: 'Acme', whyItFits: 'a'.repeat(2001) }).success).toBe(false);
    expect(proposedCompanySchema.safeParse({ company: 'Acme', employees: 12 }).success).toBe(false);
  });
});

describe('targetOf', () => {
  it('names the account and partner type, or the market and hypothesis', () => {
    const book = sampleBook({ partners: [aPartner()] });
    const input = proposalInputSchema.parse(fourC()) as ProposalInput;
    expect(targetOf(input, book)).toEqual({ accountId: 'a_abc123', partnerId: 'p_abc123', marketId: null, hypothesisId: null });
    expect(targetOf({ ...input, partnerId: 'p_gone' } as ProposalInput, book))
      .toEqual({ accountId: null, partnerId: 'p_gone', marketId: null, hypothesisId: null });
    expect(targetOf(proposalInputSchema.parse(partners(1)), book))
      .toEqual({ accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: null });
    expect(targetOf({ kind: 'hypothesisStatus', marketId: 'm_1', hypothesisId: 'h_1', expectedUpdatedAt: null, to: 'holds', reason: 'r' }, book))
      .toEqual({ accountId: null, partnerId: null, marketId: 'm_1', hypothesisId: 'h_1' });
    expect(targetOf({ kind: 'marketStatus', marketId: 'm_1', expectedUpdatedAt: null, to: 'open', note: '', reason: 'r' }, book))
      .toEqual({ accountId: null, partnerId: null, marketId: 'm_1', hypothesisId: null });
  });
});

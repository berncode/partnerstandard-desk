import { describe, expect, it } from 'vitest';
import { changeSchema, exclusionSchema, hypothesisSchema, marketInfoSchema, valuePointSchema } from './schemas';
import type { Change, Exclusion, Hypothesis, MarketInfo, ValuePoint } from './types';

// Reshaped from Recruitment's sample market (Halden Security, Austria).
const info: MarketInfo = {
  marketId: 'm_abcdefghij', companyId: 'co_abcdefghij', marketName: 'Austria', partnerType: 'reseller',
  ourProduct: 'Halden Endpoint: endpoint security and patching in one small agent',
  ourTargetCustomers: 'Companies with 20-500 staff and no security team of their own',
  whyPartnerRoute: 'Small companies buy their IT from a local IT service company.',
  mustHaves: ['Sells into companies with 20-500 staff', 'Runs a support desk in German'],
  howMarketBuys: 'customer_first', howMarketBuysNote: '', statement: 'In Austria, IT service companies will resell it.',
  expectedCandidates: 15, status: 'partly_validated', statusNote: '', copiedFrom: null, feedsProgramId: null, checkAgain: [],
  updatedAt: '2026-10-09T08:00:00.000Z', updatedBy: 'Ruth',
};
const valuePoint: ValuePoint = {
  id: 'v_1', kind: 'margin_or_fees', text: '25% margin on licenses', state: 'confirmed', evidence: 'Call, 2026-10-08',
  checkAgain: false, updatedAt: '2026-10-08T15:00:00.000Z', updatedBy: 'Ruth',
};
const hypothesis: Hypothesis = {
  id: 'h_1', name: 'Managed IT providers', theirSide: 'a', theirEvidence: '', ourSide: 'b', ourEvidence: '',
  valuePointIds: ['v_1'], lookalike: '', status: 'holds', checkAgain: false, updatedAt: null, updatedBy: 'Ruth',
};
const exclusion: Exclusion = {
  id: 'x_1', company: 'Other GmbH', website: 'other.example', reason: 'Competitor', updatedAt: null, updatedBy: 'Ruth',
};
const change: Change = {
  id: 'g_1', date: '2026-10-08', entity: 'hypothesis', entityId: 'h_1', what: 'Now holds', callId: null,
  updatedAt: null, updatedBy: 'Ruth',
};

describe('market schemas', () => {
  it('refuses a technology partner type for a market', () => {
    expect(marketInfoSchema.safeParse({ ...info, partnerType: 'technology' }).success).toBe(false);
  });
  it('accepts Recruitment fields as they are', () => {
    expect(marketInfoSchema.safeParse(info).success).toBe(true);
    expect(valuePointSchema.safeParse(valuePoint).success).toBe(true);
    expect(hypothesisSchema.safeParse(hypothesis).success).toBe(true);
    expect(exclusionSchema.safeParse(exclusion).success).toBe(true);
    expect(changeSchema.safeParse(change).success).toBe(true);
  });
  it('limits a hypothesis to 4 value points', () => {
    expect(hypothesisSchema.safeParse({ ...hypothesis, valuePointIds: ['a', 'b', 'c', 'd', 'e'] }).success).toBe(false);
  });
});

describe('the program a market feeds', () => {
  it('is an id or nothing', () => {
    expect(marketInfoSchema.safeParse({ ...info, feedsProgramId: 'pg_dach0001' }).success).toBe(true);
    expect(marketInfoSchema.safeParse({ ...info, feedsProgramId: null }).success).toBe(true);
    expect(marketInfoSchema.safeParse({ ...info, feedsProgramId: '' }).success).toBe(false);
  });
});

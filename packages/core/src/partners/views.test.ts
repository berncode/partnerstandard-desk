import { describe, expect, it } from 'vitest';
import { startView, viewOf } from './views';
import type { Partner } from './types';

const NONE = { customerBase: null, credibility: null, capability: null, commitment: null };
function partner(over: Partial<Partner> = {}): Partner {
  return {
    id: 'p_abc123', companyId: 'co_abcdefghij', accountId: 'a_abc123', partnerType: 'reseller', stage: 'recruitment',
    step: 'researched', closed: null, closedReason: '', signedDate: null, exitedDate: null, exitReason: '',
    source: 'research', sourceDetail: '', whyItFits: '', desk: NONE, confirmed: NONE, mapFilled: false, mapLink: '',
    programId: null, level: null, mapHealth: null, mapNextMilestone: null, updatedAt: null, updatedBy: 'Claude for Ruth', ...over,
  };
}
const signed = (over: Partial<Partner> = {}) => partner({ stage: 'growth', step: null, signedDate: '2026-01-01', ...over });

describe('viewOf', () => {
  it('puts a recruit in potential', () => {
    expect(viewOf(partner())).toBe('potential');
  });
  it('puts a closed recruit in closed', () => {
    expect(viewOf(partner({ closed: 'no', closedReason: 'x' }))).toBe('closed');
  });
  it('puts an exited partner in closed', () => {
    expect(viewOf(signed({ stage: 'exit', exitedDate: '2026-06-01' }))).toBe('closed');
  });
  it('puts a partner in exit but not yet exited in active', () => {
    expect(viewOf(signed({ stage: 'exit' }))).toBe('active');
  });
  it('puts a signed partner in active', () => {
    expect(viewOf(signed())).toBe('active');
  });
});

describe('startView', () => {
  it('starts on potential while nothing is active', () => {
    expect(startView([])).toBe('potential');
    expect(startView([partner(), partner({ closed: 'no' })])).toBe('potential');
  });
  it('starts on active when any partner is active', () => {
    expect(startView([partner(), signed()])).toBe('active');
  });
});

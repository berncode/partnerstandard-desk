import { describe, expect, it } from 'vitest';
import { newMapPlan } from './from-record';

describe('newMapPlan', () => {
  it('is empty apart from the info, with 90 days, and keeps no contacts', () => {
    const plan = newMapPlan(
      { partnerId: 'p_abc123', partnerType: 'reseller', contacts: [{ name: 'Ana', title: 'CEO', email: 'ana@acme.example' }] },
    );
    expect(plan).toEqual({
      info: { partnerId: 'p_abc123', partnerType: 'reseller', horizonDays: 90, laterHorizons: [], nextReviewDate: null },
      objectives: [], activities: [], people: [], milestones: [], exitTriggers: [], reviews: [], reviewNumbers: [], reviewItems: [],
    });
  });
});

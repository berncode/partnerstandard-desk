// PartnerStandard Desk's MapChange (no signing, no stage, name, type or closing in plan details) and the stored MAP as the draft.
import { describe, expect, it } from 'vitest';
import { buildSamplePlan } from '@partner-desk/method';
import { mapChangeSchema as planChangeSchema, mapDraftSchema as planDraftSchema, parseMapChange as parsePlanChange } from './change-schema';
import { TODAY } from './test-builders';

describe('parsePlanChange', () => {
  it('accepts well-formed changes', () => {
    expect(parsePlanChange({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' }, expectedUpdatedAt: null }))
      .toEqual({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' }, expectedUpdatedAt: null });
    expect(parsePlanChange({ kind: 'add', entity: 'objective', values: { side: 'partner', statement: 'Grow' } })).not.toBeNull();
    expect(parsePlanChange({ kind: 'delete', entity: 'person', id: 'p_1' })).not.toBeNull();
    expect(parsePlanChange({ kind: 'updateInfo', patch: { nextReviewDate: '2026-12-01', horizonDays: 60 } })).not.toBeNull();
  });

  it('accepts the values the client saw as expected, with the same field rules as patch', () => {
    const change = { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' }, expected: { status: 'blocked' } };
    expect(parsePlanChange(change)).toEqual(change);
    expect(parsePlanChange({ ...change, expected: { status: 'nope' } })).toBeNull();
    expect(parsePlanChange({ ...change, expected: { updatedAt: 'x' } })).toBeNull();
    expect(parsePlanChange({ ...change, expected: { bogus: 1 } })).toBeNull();
    expect(parsePlanChange({ ...change, entity: 'person', patch: { name: 'X' }, expected: { name: 'Y' } })).toBeNull();
  });

  it('rejects malformed or unexpected input', () => {
    expect(parsePlanChange(null)).toBeNull();
    expect(parsePlanChange('delete everything')).toBeNull();
    expect(parsePlanChange({ kind: 'drop', entity: 'activity', id: 'a_1' })).toBeNull();
    expect(parsePlanChange({ kind: 'delete', entity: 'plan', id: 'a_1' })).toBeNull();
    expect(parsePlanChange({ kind: 'delete', entity: 'activity', id: '' })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'finished' } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'activity', id: 'a_1', patch: { isAdmin: true } })).toBeNull();
    expect(parsePlanChange({ kind: 'add', entity: 'person', values: { name: 'Priya', email: 'nope' } })).toBeNull();
    expect(parsePlanChange({ kind: 'updateInfo', patch: { partnerName: 'X', extra: 1 } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'activity', id: 'a'.repeat(65), patch: {} })).toBeNull();
  });
});

describe('planDraftSchema', () => {
  it('accepts a complete plan and rejects a plan without a partner type id', () => {
    const plan = buildSamplePlan(TODAY);
    expect(planDraftSchema.safeParse(plan).success).toBe(true);
    const result = planDraftSchema.safeParse({ ...plan, info: { ...plan.info, partnerId: '' } });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]!.path).toEqual(['info', 'partnerId']);
  });
});

describe('security guarantees', () => {
  it('rejects server-managed fields in add and update', () => {
    expect(parsePlanChange({ kind: 'add', entity: 'activity', values: { title: 'X', id: 'a_evil' } })).toBeNull();
    expect(parsePlanChange({ kind: 'add', entity: 'activity', values: { title: 'X', updatedAt: '2026-01-01T00:00:00.000Z' } })).toBeNull();
    expect(parsePlanChange({ kind: 'add', entity: 'activity', values: { title: 'X', updatedBy: 'Mallory' } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'activity', id: 'a_1', patch: { id: 'a_2' } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'activity', id: 'a_1', patch: { updatedAt: 'x' } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'activity', id: 'a_1', patch: { updatedBy: 'Mallory' } })).toBeNull();
  });

  it('validates add values against the entity schema', () => {
    expect(parsePlanChange({ kind: 'add', entity: 'activity', values: { title: 'X', status: 'finished' } })).toBeNull();
    expect(parsePlanChange({ kind: 'add', entity: 'activity', values: { title: 'X', bogus: 1 } })).toBeNull();
  });

  it('reports invalid patch and add values at their field paths', () => {
    const patchResult = planChangeSchema.safeParse({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'finished' } });
    expect(patchResult.success).toBe(false);
    if (!patchResult.success) expect(patchResult.error.issues[0]!.path).toEqual(['patch', 'status']);

    const addResult = planChangeSchema.safeParse({ kind: 'add', entity: 'person', values: { name: 'Priya', email: 'nope' } });
    expect(addResult.success).toBe(false);
    if (!addResult.success) expect(addResult.error.issues[0]!.path).toEqual(['values', 'email']);
  });
});

describe('planDraftSchema bounds', () => {
  const plan = buildSamplePlan(TODAY);

  it('rejects a duplicate id across collections', () => {
    const firstActivityId = plan.activities[0]!.id;
    const result = planDraftSchema.safeParse({
      ...plan,
      objectives: [{ id: firstActivityId, side: 'us', statement: 'Grow', successMeasure: '' }],
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues.some((issue) => issue.message === 'Duplicate id')).toBe(true);
  });

  it('rejects an id longer than 64 characters', () => {
    const result = planDraftSchema.safeParse({
      ...plan,
      objectives: [{ id: 'o'.repeat(65), side: 'us', statement: 'Grow', successMeasure: '' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an activity updatedBy longer than 200 characters', () => {
    const result = planDraftSchema.safeParse({
      ...plan,
      activities: [{ ...plan.activities[0], updatedBy: 'n'.repeat(201) }],
    });
    expect(result.success).toBe(false);
  });

  it('still accepts the sample plan', () => {
    expect(planDraftSchema.safeParse(plan).success).toBe(true);
  });
});


describe('startHorizon changes', () => {
  const change = {
    kind: 'startHorizon', expectedStartDate: '2026-07-20', expectedHorizon: 0, startDate: '2026-10-20', horizonDays: 60,
    milestones: [{ name: 'Horizon 2: Business review', criteria: 'Results reviewed', day: 60 }],
  };

  it('accepts a well-formed change', () => {
    expect(parsePlanChange(change)).toEqual(change);
    expect(parsePlanChange({ ...change, milestones: [] })).not.toBeNull();
  });

  it('accepts only the offered horizon lengths', () => {
    for (const horizonDays of [30, 60, 90, 120, 180]) expect(parsePlanChange({ ...change, horizonDays })).not.toBeNull();
    for (const horizonDays of [45, 365, 0, '90']) expect(parsePlanChange({ ...change, horizonDays })).toBeNull();
  });

  it('rejects malformed fields and extra keys', () => {
    expect(parsePlanChange({ ...change, startDate: '20 Oct' })).toBeNull();
    expect(parsePlanChange({ ...change, expectedStartDate: undefined })).toBeNull();
    for (const expectedHorizon of [undefined, -1, 1.5, '0', 101]) expect(parsePlanChange({ ...change, expectedHorizon })).toBeNull();
    expect(parsePlanChange({ ...change, milestones: [{ name: 'X', criteria: '', day: 0 }] })).toBeNull();
    expect(parsePlanChange({ ...change, stage: 'finished' })).toBeNull();
    expect(parsePlanChange({ ...change, stage: 'growth' })).toBeNull();
    expect(parsePlanChange({ ...change, pastHorizons: [] })).toBeNull();
    expect(parsePlanChange({ ...change, milestones: [{ name: 'X', criteria: '', day: 1.5 }] })).toBeNull();
    expect(parsePlanChange({ ...change, milestones: [{ name: 'X', criteria: '', day: 30, id: 'm_evil' }] })).toBeNull();
    expect(parsePlanChange({ ...change, milestones: Array.from({ length: 11 }, (_, i) => ({ name: `M${i}`, criteria: '', day: i + 1 })) })).toBeNull();
  });
});

describe('horizon history', () => {
  it('can’t be set through updateInfo', () => {
    expect(parsePlanChange({ kind: 'updateInfo', patch: { pastHorizons: [] } })).toBeNull();
    expect(parsePlanChange({ kind: 'updateInfo', patch: { laterHorizons: [] } })).toBeNull();
  });
});

describe('what the partner record owns', () => {
  it('refuses a stage, name, type, start date or closing in plan details', () => {
    for (const patch of [
      { stage: 'growth' }, { partnerName: 'Renamed' }, { partnerType: 'oem' }, { startDate: '2026-10-01' },
      { closed: 'no' }, { closedReason: 'Not qualified' }, { closed: null, closedReason: '' },
    ]) expect(parsePlanChange({ kind: 'updateInfo', patch }), JSON.stringify(patch)).toBeNull();
  });

  it('refuses recording the signed agreement: the partner page does that', () => {
    const sign = { kind: 'signAgreement', expectedStage: 'recruitment', expectedStartDate: '2026-10-01', signedOn: '2026-10-11', horizonDays: 90, shiftDates: true };
    expect(parsePlanChange(sign)).toBeNull();
  });
});

describe('review changes (plan 9, task 6)', () => {
  it('accepts prep edits of a review, its numbers and its items', () => {
    for (const change of [
      { kind: 'update', entity: 'review', id: 'rv_1', patch: { decisions: 'Run it again', nextHorizonDays: 60, caseId: 'bc_1' } },
      { kind: 'add', entity: 'reviewNumber', values: { reviewId: 'rv_1', key: 'dealsWon', actual: 2, target: 3, source: 'sales' } },
      { kind: 'update', entity: 'reviewNumber', id: 'rn_1', patch: { actual: 12.5, note: 'x', nextTarget: 4 } },
      { kind: 'delete', entity: 'reviewNumber', id: 'rn_1' },
      { kind: 'add', entity: 'reviewItem', values: { reviewId: 'rv_1', kind: 'commitment', title: 'Train sellers', side: 'partner', dueDate: '2027-01-20' } },
      { kind: 'update', entity: 'reviewItem', id: 'ri_1', patch: { answer: 'holds', note: 'Still true' } },
      { kind: 'delete', entity: 'reviewItem', id: 'ri_1' },
    ]) expect(parsePlanChange(change), JSON.stringify(change)).toEqual(change);
  });

  it('keeps what closing, the summary and the prep set to the server', () => {
    // `includeScorecard` decides what the partner sees: only Send summary sets it (`shareSummary`).
    for (const patch of [
      { state: 'held' }, { heldOn: '2026-10-28' }, { horizon: 2 }, { summarySentAt: '2026-10-28T10:00:00.000Z' }, { summarySentTo: 'Lena Ortiz' }, { includeScorecard: true },
      { includeScorecard: false }, { updatedAt: 'x' }, { id: 'rv_2' },
    ]) {
      expect(parsePlanChange({ kind: 'update', entity: 'review', id: 'rv_1', patch }), JSON.stringify(patch)).toBeNull();
    }
    expect(parsePlanChange({ kind: 'update', entity: 'reviewItem', id: 'ri_1', patch: { moved: true } })).toBeNull();
    // A review starts with its prep (`openReview`), never as a bare row, and is never deleted by a typed change: a held
    // review is the partnership's record, and the open-twice cleanup in `openReview` writes to the store itself.
    expect(parsePlanChange({ kind: 'add', entity: 'review', values: { decisions: 'x' } })).toBeNull();
    expect(parsePlanChange({ kind: 'delete', entity: 'review', id: 'rv_1' })).toBeNull();
  });

  it('checks the values against the row rules', () => {
    expect(parsePlanChange({ kind: 'update', entity: 'reviewNumber', id: 'rn_1', patch: { actual: -1 } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'reviewNumber', id: 'rn_1', patch: { key: 'deals' } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'reviewItem', id: 'ri_1', patch: { answer: 'maybe' } })).toBeNull();
    expect(parsePlanChange({ kind: 'update', entity: 'review', id: 'rv_1', patch: { nextHorizonDays: 3 } })).toBeNull();
    // The next horizon starts with one of the lengths "Start next horizon" offers (spec 5.2).
    for (const nextHorizonDays of [7, 45, 365, 730]) {
      expect(parsePlanChange({ kind: 'update', entity: 'review', id: 'rv_1', patch: { nextHorizonDays } })).toBeNull();
    }
    for (const nextHorizonDays of [30, 60, 90, 120, 180]) {
      expect(parsePlanChange({ kind: 'update', entity: 'review', id: 'rv_1', patch: { nextHorizonDays } })).not.toBeNull();
    }
  });
});

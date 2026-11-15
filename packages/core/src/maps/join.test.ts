import { describe, expect, it } from 'vitest';
import { applyMapChange, type MapApplyOutcome, type MapChange, type MapChangeStamp } from './changes';
import { computeHealth } from './derived';
import { joinPlan, planInfoFor } from './join';
import { NOW, makeActivity, makeMapPlan, makeMilestone, makeRecord } from './test-builders';
import type { MapInfo, MapRecord } from './types';

const STARTED = '2026-09-01';
const unsigned: MapRecord = makeRecord({ stage: 'recruitment', signedDate: null });
const map = (laterHorizons: MapInfo['laterHorizons'] = [], horizonDays = 90): MapInfo =>
  ({ ...makeMapPlan().info, horizonDays, laterHorizons });

describe('planInfoFor', () => {
  it('shows a MAP not yet signed in recruitment, counting from the day it was started, with no horizon run', () => {
    expect(planInfoFor(map(), unsigned, STARTED)).toEqual({
      partnerName: 'Acme', partnerType: 'reseller', stage: 'recruitment', startDate: STARTED, horizonDays: 90,
      nextReviewDate: null, pastHorizons: [], closed: null, closedReason: '',
    });
  });

  it('follows the record when a recruitment was closed, and when it is reopened', () => {
    const closed = makeRecord({ stage: 'recruitment', signedDate: null, closed: 'not_now', closedReason: 'Busy until spring' });
    expect(planInfoFor(map(), closed, STARTED)).toMatchObject({ stage: 'recruitment', closed: 'not_now', closedReason: 'Busy until spring' });
    expect(planInfoFor(map(), unsigned, STARTED)).toMatchObject({ stage: 'recruitment', closed: null, closedReason: '' });
  });

  it('starts the first horizon on the signing date, with the MAP’s horizon length and the record’s stage', () => {
    expect(planInfoFor(map([], 60), makeRecord({ signedDate: '2026-10-10', stage: 'onboarding' }), STARTED)).toEqual({
      partnerName: 'Acme', partnerType: 'reseller', stage: 'onboarding', startDate: '2026-10-10', horizonDays: 60,
      nextReviewDate: null, pastHorizons: [], closed: null, closedReason: '',
    });
  });

  it('makes the last later horizon the current one, and the earlier ones past, each with the record’s stage', () => {
    const later = [{ startDate: '2027-01-08', horizonDays: 60 }, { startDate: '2027-03-09', horizonDays: 120 }];
    expect(planInfoFor(map(later), makeRecord({ signedDate: '2026-10-10', stage: 'growth' }), STARTED)).toMatchObject({
      stage: 'growth', startDate: '2027-03-09', horizonDays: 120,
      pastHorizons: [
        { startDate: '2026-10-10', horizonDays: 90, stage: 'growth' },
        { startDate: '2027-01-08', horizonDays: 60, stage: 'growth' },
      ],
    });
  });

  it('shows recruitment again after undo signing, and keeps the later horizons stored (Review Focus 3)', () => {
    const later = [{ startDate: '2027-01-08', horizonDays: 60 }];
    const info = map(later);
    const before = structuredClone(info);
    expect(planInfoFor(info, unsigned, STARTED)).toMatchObject({ stage: 'recruitment', startDate: STARTED, horizonDays: 90, pastHorizons: [] });
    expect(info).toEqual(before);
    // Signed again later: the horizon started before that signing stays stored but is ignored.
    expect(planInfoFor(info, makeRecord({ signedDate: '2027-02-01', stage: 'onboarding' }), STARTED))
      .toMatchObject({ startDate: '2027-02-01', horizonDays: 90, pastHorizons: [] });
    // Signed again on the old date: the stored horizon counts again.
    expect(planInfoFor(info, makeRecord({ signedDate: '2026-10-10' }), STARTED))
      .toMatchObject({ startDate: '2027-01-08', horizonDays: 60, pastHorizons: [{ startDate: '2026-10-10', horizonDays: 90 }] });
  });

  it('never shows a closed recruitment once the record is signed', () => {
    const odd = makeRecord({ closed: 'no', closedReason: 'Hand edit' });
    expect(planInfoFor(map(), odd, STARTED)).toMatchObject({ closed: null, closedReason: '' });
  });

  it('feeds the copied health rules: a MAP before signing has no missed milestones', () => {
    const plan = makeMapPlan({ milestones: [makeMilestone({ id: 'm_1', targetDate: '2026-10-01' })] });
    expect(computeHealth({ plan: joinPlan(plan, unsigned, '2026-10-14'), today: '2026-10-16', lastEventAt: null }).health).toBe('on_track');
    expect(computeHealth({ plan: joinPlan(plan, makeRecord({ signedDate: '2026-09-20' }), STARTED), today: '2026-10-16', lastEventAt: '2026-10-15' }).reasons)
      .toEqual([{ kind: 'milestone_missed', milestoneId: 'm_1' }]);
  });
});

describe('applyMapChange', () => {
  const stamp: MapChangeStamp = { now: NOW, actorName: 'Anna Keller', newId: (entity) => `${entity}_new` };
  const ok = (outcome: MapApplyOutcome) => {
    if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error}: ${outcome.message}`);
    return outcome;
  };
  const start = (over: Partial<Extract<MapChange, { kind: 'startHorizon' }>> = {}): MapChange => ({
    kind: 'startHorizon', expectedStartDate: '2026-07-20', expectedHorizon: 0, startDate: '2026-10-20', horizonDays: 60,
    milestones: [{ name: 'Horizon 2: Business review', criteria: 'Results reviewed', day: 60 }], ...over,
  });
  const signed = makeRecord({ signedDate: '2026-07-20', stage: 'growth' });

  it('refuses to start a horizon while the record is unsigned', () => {
    expect(applyMapChange(makeMapPlan(), start(), stamp, unsigned)).toEqual({
      ok: false, error: 'invalid', message: 'In recruitment no horizon runs yet: record the signed agreement to start onboarding',
    });
    expect(applyMapChange(makeMapPlan(), start({ expectedStartDate: '2026-10-16' }), stamp, unsigned)).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('appends a started horizon to the later horizons and adds its milestones', () => {
    const result = ok(applyMapChange(makeMapPlan(), start(), stamp, signed));
    expect(result.plan.info).toEqual({ ...makeMapPlan().info, laterHorizons: [{ startDate: '2026-10-20', horizonDays: 60 }] });
    expect(result.plan.milestones).toEqual([
      { id: 'milestone_new', name: 'Horizon 2: Business review', targetDate: '2026-12-18', criteria: 'Results reviewed', achievedDate: null },
    ]);
    const twice = applyMapChange(result.plan, start(), stamp, signed);
    expect(twice).toMatchObject({ ok: false, error: 'conflict' });
    const third = ok(applyMapChange(result.plan, start({ expectedStartDate: '2026-10-20', expectedHorizon: 1, startDate: '2026-12-19', milestones: [] }), stamp, signed));
    expect(third.plan.info.laterHorizons).toEqual([{ startDate: '2026-10-20', horizonDays: 60 }, { startDate: '2026-12-19', horizonDays: 60 }]);
  });

  it('keeps a horizon stored from before a later signing, and appends after it', () => {
    const stale = makeMapPlan({ info: { ...makeMapPlan().info, laterHorizons: [{ startDate: '2026-05-01', horizonDays: 30 }] } });
    const result = ok(applyMapChange(stale, start(), stamp, signed));
    expect(result.plan.info.laterHorizons).toEqual([{ startDate: '2026-05-01', horizonDays: 30 }, { startDate: '2026-10-20', horizonDays: 60 }]);
  });

  it('writes a new horizon length to the current horizon, and the next review to the MAP', () => {
    const first = ok(applyMapChange(makeMapPlan(), { kind: 'updateInfo', patch: { horizonDays: 120, nextReviewDate: '2026-12-01' } }, stamp, signed));
    expect(first.plan.info).toMatchObject({ horizonDays: 120, nextReviewDate: '2026-12-01', laterHorizons: [] });
    const later = makeMapPlan({ info: { ...makeMapPlan().info, laterHorizons: [{ startDate: '2026-10-20', horizonDays: 60 }] } });
    const second = ok(applyMapChange(later, { kind: 'updateInfo', patch: { horizonDays: 30 } }, stamp, signed));
    expect(second.plan.info).toMatchObject({ horizonDays: 90, laterHorizons: [{ startDate: '2026-10-20', horizonDays: 30 }] });
    const before = ok(applyMapChange(later, { kind: 'updateInfo', patch: { horizonDays: 30 } }, stamp, unsigned));
    expect(before.plan.info).toMatchObject({ horizonDays: 30, laterHorizons: [{ startDate: '2026-10-20', horizonDays: 60 }] });
  });

  it('validates plan details', () => {
    expect(applyMapChange(makeMapPlan(), { kind: 'updateInfo', patch: { horizonDays: 0 } }, stamp, signed))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { horizonDays: 'Use at least 7 days' } });
  });

  it('changes rows as the MAP app does, leaving the stored info as it was', () => {
    const plan = makeMapPlan({ activities: [makeActivity({ id: 'a_1' })] });
    const result = ok(applyMapChange(plan, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }, stamp, unsigned));
    expect(result.plan.info).toBe(plan.info);
    expect(result.plan.activities[0]).toMatchObject({ status: 'done', completedDate: '2026-10-16', updatedBy: 'Anna Keller' });
    expect(result.touched).toEqual([{ entity: 'activity', id: 'a_1' }]);
  });
});

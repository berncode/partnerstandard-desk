import { describe, expect, it } from 'vitest';
import { toFieldErrors } from '../shared/schemas';
import { activitySchema, mapInfoSchema, mapPersonSchema as personSchema, planInfoSchema } from './schemas';
import { makeMapPlan } from './test-builders';
import type { Activity, PlanInfo } from './types';

const activity: Activity = {
  id: 'a_abc123',
  title: 'Kickoff',
  category: 'other',
  side: 'joint',
  ownerId: null,
  dueDate: '2026-10-20',
  status: 'not_started',
  completedDate: null,
  milestoneId: null,
  note: '',
  updatedAt: null,
  updatedBy: null,
};

const info: PlanInfo = {
  partnerName: 'Acme',
  partnerType: 'reseller',
  stage: 'onboarding',
  startDate: '2026-10-01',
  horizonDays: 90,
  nextReviewDate: null,
  pastHorizons: [], closed: null, closedReason: '',
};

function errorsOf(result: ReturnType<typeof activitySchema.safeParse>) {
  if (result.success) throw new Error('expected validation to fail');
  return toFieldErrors(result.error);
}

describe('schemas', () => {
  it('accepts a valid activity', () => {
    expect(activitySchema.safeParse(activity).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(errorsOf(activitySchema.safeParse({ ...activity, status: 'finished' }))).toHaveProperty('status');
  });

  it('rejects impossible dates', () => {
    expect(errorsOf(activitySchema.safeParse({ ...activity, dueDate: '2026-02-30' }))).toHaveProperty('dueDate');
  });

  it('requires a non-blank title', () => {
    expect(errorsOf(activitySchema.safeParse({ ...activity, title: '   ' })).title).toBe('Activity title is required');
  });

  it('rejects invalid emails on people', () => {
    const result = personSchema.safeParse({
      id: 'p_abc123', side: 'partner', name: 'Priya', title: '', email: 'not-an-email', role: 'other',
    });
    expect(result.success).toBe(false);
  });

  it('limits the plan horizon to 7–730 days', () => {
    expect(planInfoSchema.safeParse(info).success).toBe(true);
    expect(planInfoSchema.safeParse({ ...info, horizonDays: 3 }).success).toBe(false);
    expect(planInfoSchema.safeParse({ ...info, horizonDays: 1000 }).success).toBe(false);
  });

  it('reads an old recruiting stage as recruitment, in the plan and its history', () => {
    const past = [{ startDate: '2026-07-01', horizonDays: 90, stage: 'recruiting' }];
    expect(planInfoSchema.parse({ ...info, stage: 'recruiting', pastHorizons: past })).toMatchObject({
      stage: 'recruitment', pastHorizons: [{ stage: 'recruitment' }],
    });
  });

  it('validates past horizons and reads an old Evaluation stage as Growth', () => {
    const past = [{ startDate: '2026-07-01', horizonDays: 90, stage: 'evaluation' }];
    expect(planInfoSchema.parse({ ...info, stage: 'evaluation', pastHorizons: past })).toMatchObject({
      stage: 'growth', pastHorizons: [{ startDate: '2026-07-01', horizonDays: 90, stage: 'growth' }],
    });
    expect(planInfoSchema.safeParse({ ...info, pastHorizons: [{ startDate: 'July', horizonDays: 90, stage: 'growth' }] }).success).toBe(false);
  });
});

describe('mapInfoSchema', () => {
  const stored = makeMapPlan().info;

  it('accepts the stored info and its later horizons', () => {
    expect(mapInfoSchema.safeParse(stored).success).toBe(true);
    expect(mapInfoSchema.parse({ ...stored, laterHorizons: [{ startDate: '2027-01-08', horizonDays: 60 }] }).laterHorizons)
      .toEqual([{ startDate: '2027-01-08', horizonDays: 60 }]);
  });

  it('rejects a bad later horizon, horizon length or partner type', () => {
    expect(mapInfoSchema.safeParse({ ...stored, laterHorizons: [{ startDate: 'January', horizonDays: 60 }] }).success).toBe(false);
    expect(mapInfoSchema.safeParse({ ...stored, laterHorizons: [{ startDate: '2027-01-08', horizonDays: 3 }] }).success).toBe(false);
    expect(mapInfoSchema.safeParse({ ...stored, horizonDays: 1000 }).success).toBe(false);
    expect(mapInfoSchema.safeParse({ ...stored, partnerType: 'supplier' }).success).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { computeHealth, daysOverdue, daysWithoutProgress, isEmptyMap, milestoneStatus } from './derived';
import { TODAY, makeActivity, makeExitTrigger, makeMilestone, makeObjective, makePerson, makePlan } from './test-builders';

const health = (plan = makePlan(), lastEventAt: string | null = null) =>
  computeHealth({ plan, today: TODAY, lastEventAt });

/** A plan with one open activity and no due date: something to manage, nothing late. */
const planned = (overrides: Parameters<typeof makePlan>[0] = {}) => makePlan({ activities: [makeActivity()], ...overrides });

describe('milestoneStatus', () => {
  it('is achieved when an achieved date is set, even if late', () => {
    expect(milestoneStatus(makeMilestone({ targetDate: '2026-10-01', achievedDate: '2026-10-05' }), TODAY)).toBe('achieved');
  });
  it('is missed when the target date has passed', () => {
    expect(milestoneStatus(makeMilestone({ targetDate: '2026-10-15' }), TODAY)).toBe('missed');
  });
  it('is upcoming on the target date itself', () => {
    expect(milestoneStatus(makeMilestone({ targetDate: TODAY }), TODAY)).toBe('upcoming');
  });
});

describe('milestoneStatus in recruitment', () => {
  it('is never missed before signing: the dates are planned, not due', () => {
    expect(milestoneStatus(makeMilestone({ targetDate: '2026-10-01' }), TODAY, 'recruitment')).toBe('upcoming');
    expect(milestoneStatus(makeMilestone({ targetDate: '2026-10-01', achievedDate: '2026-09-30' }), TODAY, 'recruitment')).toBe('achieved');
    expect(milestoneStatus(makeMilestone({ targetDate: '2026-10-01' }), TODAY, 'onboarding')).toBe('missed');
  });
});

describe('daysOverdue', () => {
  it('ignores done and N/A activities', () => {
    expect(daysOverdue(makeActivity({ dueDate: '2026-10-01', status: 'done', completedDate: '2026-10-02' }), TODAY)).toBe(0);
    expect(daysOverdue(makeActivity({ dueDate: '2026-10-01', status: 'na' }), TODAY)).toBe(0);
  });
  it('counts days past the due date for open activities', () => {
    expect(daysOverdue(makeActivity({ dueDate: '2026-10-06', status: 'in_progress' }), TODAY)).toBe(10);
  });
});

describe('an empty MAP (owner, 2026-10-31)', () => {
  it('is empty with no activity and no milestone, whatever else it holds', () => {
    expect(isEmptyMap(makePlan())).toBe(true);
    expect(isEmptyMap(makePlan({
      objectives: [makeObjective()], people: [makePerson()], exitTriggers: [makeExitTrigger({ status: 'triggered' })],
    }))).toBe(true);
    expect(isEmptyMap(makePlan({ activities: [makeActivity()] }))).toBe(false);
    expect(isEmptyMap(makePlan({ milestones: [makeMilestone()] }))).toBe(false);
  });

  it('has no health: nothing to manage yet, so not on track', () => {
    expect(health()).toEqual({ health: 'empty', reasons: [] });
  });

  it('has no health even when it stalled or an exit trigger fired: those alone are nothing to manage', () => {
    const old = makePlan({ info: { ...makePlan().info, startDate: '2026-08-01' } });
    expect(health(old)).toEqual({ health: 'empty', reasons: [] });
    expect(health(makePlan({ exitTriggers: [makeExitTrigger({ status: 'triggered' })], objectives: [makeObjective()] })))
      .toEqual({ health: 'empty', reasons: [] });
  });

  it('gets a health with its first activity', () => {
    expect(health(makePlan({ activities: [makeActivity()] }))).toEqual({ health: 'on_track', reasons: [] });
    expect(health(makePlan({ activities: [makeActivity({ id: 'a_late01', dueDate: '2026-10-01' })] })).health).toBe('at_risk');
  });

  it('gets a health with its first milestone', () => {
    expect(health(makePlan({ milestones: [makeMilestone()] }))).toEqual({ health: 'on_track', reasons: [] });
    expect(health(makePlan({ milestones: [makeMilestone({ targetDate: '2026-10-01' })] })).health).toBe('at_risk');
  });

  it('counts a stall and exit triggers again once it has something in it', () => {
    const old = planned({ info: { ...makePlan().info, startDate: '2026-08-01' }, exitTriggers: [makeExitTrigger({ status: 'watch' })] });
    expect(health(old).health).toBe('off_track');
  });

  it('keeps the same health after the exit as before: the empty rule holds in every stage', () => {
    expect(health(makePlan({ info: { ...makePlan().info, stage: 'exit' } })).health).toBe('empty');
  });
});

describe('computeHealth', () => {
  it('is on track for a fresh plan with something in it', () => {
    expect(health(planned())).toEqual({ health: 'on_track', reasons: [] });
  });

  it('has nothing to track once a recruitment ended without signing', () => {
    const late = makePlan({ activities: [makeActivity({ dueDate: '2026-09-01' })] });
    expect(health({ ...late, info: { ...late.info, stage: 'recruitment', closed: 'not_now', closedReason: 'Busy' } })).toEqual({ health: 'on_track', reasons: [] });
  });

  it('tolerates 7 days overdue but not 8', () => {
    expect(health(makePlan({ activities: [makeActivity({ dueDate: '2026-10-09' })] })).health).toBe('on_track');
    expect(health(makePlan({ activities: [makeActivity({ id: 'a_late01', dueDate: '2026-10-08' })] }))).toEqual({
      health: 'at_risk',
      reasons: [{ kind: 'overdue', activityId: 'a_late01', days: 8 }],
    });
  });

  it('flags a missed milestone', () => {
    const result = health(makePlan({ milestones: [makeMilestone({ id: 'm_miss01', targetDate: '2026-10-15' })] }));
    expect(result).toEqual({ health: 'at_risk', reasons: [{ kind: 'milestone_missed', milestoneId: 'm_miss01' }] });
  });

  it('is at risk after 14 days without progress and off track after 30', () => {
    const at = (startDate: string) => health(planned({ info: { ...makePlan().info, startDate } }));
    expect(at('2026-10-03').health).toBe('on_track');
    expect(at('2026-10-02')).toEqual({ health: 'at_risk', reasons: [{ kind: 'stalled', days: 14 }] });
    expect(at('2026-09-16')).toEqual({ health: 'off_track', reasons: [{ kind: 'stalled', days: 30 }] });
  });

  it('counts a recent event or activity update as progress', () => {
    const old = planned({ info: { ...makePlan().info, startDate: '2026-09-01' } });
    expect(health(old, '2026-10-15').health).toBe('on_track');
    const touched = { ...old, activities: [makeActivity({ updatedAt: '2026-10-14T08:00:00.000Z' })] };
    expect(health(touched).health).toBe('on_track');
  });

  it('accepts a timestamp as the last event', () => {
    const old = makePlan({ info: { ...makePlan().info, startDate: '2026-09-01' } });
    expect(daysWithoutProgress(old, TODAY, '2026-10-15T23:59:00.000Z')).toBe(1);
    const touched = { ...old, activities: [makeActivity({ updatedAt: '2026-10-14T08:00:00.000Z' })] };
    expect(daysWithoutProgress(touched, TODAY, '2026-10-01T08:00:00.000Z')).toBe(2);
    expect(health(planned({ info: old.info }), '2026-10-15T23:59:00.000Z').health).toBe('on_track');
  });

  it('does not count a future start date as stalled', () => {
    expect(health(planned({ info: { ...makePlan().info, startDate: '2026-11-01' } })).health).toBe('on_track');
  });

  it('maps exit triggers to health', () => {
    expect(health(planned({ exitTriggers: [makeExitTrigger({ status: 'watch' })] })).health).toBe('at_risk');
    expect(health(planned({ exitTriggers: [makeExitTrigger({ status: 'triggered' })] })).health).toBe('off_track');
  });
});

describe('horizons and momentum', () => {
  it('never warns just because the horizon has ended', () => {
    const ended = planned({ info: { ...makePlan().info, startDate: '2026-06-01', horizonDays: 30 } });
    expect(health(ended, '2026-10-15T09:00:00.000Z')).toEqual({ health: 'on_track', reasons: [] });
  });

  it('counts the start of a new horizon as progress', () => {
    const stalled = makePlan({ info: { ...makePlan().info, startDate: '2026-08-01' } });
    expect(daysWithoutProgress(stalled, TODAY, null)).toBe(76);
    const restarted = { ...stalled, info: { ...stalled.info, startDate: TODAY, pastHorizons: [{ startDate: '2026-08-01', horizonDays: 90, stage: 'growth' as const }] } };
    expect(daysWithoutProgress(restarted, TODAY, null)).toBe(0);
  });
});

describe('recruitment: no horizon runs before the agreement is signed', () => {
  const recruiting = (overrides: Parameters<typeof makePlan>[0] = {}) =>
    makePlan({ ...overrides, info: { ...makePlan().info, stage: 'recruitment', startDate: '2026-09-01' } });

  it('doesn’t count missed milestones: their dates only become real at signing', () => {
    const plan = recruiting({ milestones: [makeMilestone({ id: 'm_1', targetDate: '2026-10-01' })] });
    expect(health(plan, '2026-10-15T09:00:00.000Z')).toEqual({ health: 'on_track', reasons: [] });
    expect(health({ ...plan, info: { ...plan.info, stage: 'onboarding' } }, '2026-10-15T09:00:00.000Z').reasons)
      .toEqual([{ kind: 'milestone_missed', milestoneId: 'm_1' }]);
  });

  it('still counts overdue activities, exit triggers and a stall', () => {
    const plan = recruiting({
      activities: [makeActivity({ id: 'a_1', dueDate: '2026-10-01', status: 'in_progress' })],
      exitTriggers: [makeExitTrigger({ id: 'x_1', status: 'watch' })],
    });
    expect(health(plan).reasons).toEqual([
      { kind: 'stalled', days: 45 },
      { kind: 'overdue', activityId: 'a_1', days: 15 },
      { kind: 'exit_trigger', exitTriggerId: 'x_1', status: 'watch' },
    ]);
  });
});

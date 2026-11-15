import { describe, expect, it } from 'vitest';
import { joinPlan, planInfoFor } from './join';
import { mapSummary, nextMapMilestone, summarizeMap } from './summary';
import { NOW, TODAY, makeActivity, makeMapPlan, makeMilestone, makeRecord } from './test-builders';

const START = '2026-10-10';

describe('mapSummary', () => {
  it('is at risk for an activity 8 days overdue', () => {
    const plan = makeMapPlan({ activities: [makeActivity({ dueDate: '2026-10-08', status: 'in_progress' })] });
    expect(mapSummary(plan, makeRecord(), START, TODAY, NOW).health).toBe('at_risk');
  });

  it('keeps no health for an empty MAP (owner, 2026-10-31): the row stays empty, the screens say "Nothing planned yet"', () => {
    expect(mapSummary(makeMapPlan(), makeRecord(), START, TODAY, NOW)).toEqual({ health: null, nextMilestone: null });
    expect(summarizeMap(joinPlan(makeMapPlan(), makeRecord(), START), TODAY, NOW)).toEqual({ health: 'empty', reasons: [], nextMilestone: null });
  });

  it('is on track for a plan with one activity and has no next milestone', () => {
    expect(mapSummary(makeMapPlan({ activities: [makeActivity()] }), makeRecord(), START, TODAY, NOW)).toEqual({ health: 'on_track', nextMilestone: null });
  });

  it('shows "Not signed" rather than empty once the recruitment ended without signing', () => {
    const closed = makeRecord({ stage: 'recruitment', signedDate: null, closed: 'not_now', closedReason: '' });
    expect(summarizeMap(joinPlan(makeMapPlan(), closed, START), TODAY, NOW).health).toBeNull();
  });

  it('gives the earliest upcoming milestone with a target date', () => {
    const plan = makeMapPlan({
      milestones: [
        makeMilestone({ id: 'm_1', targetDate: '2026-12-01' }),
        makeMilestone({ id: 'm_2', targetDate: '2026-11-15' }),
        makeMilestone({ id: 'm_3', targetDate: null }),
        makeMilestone({ id: 'm_4', targetDate: '2026-11-01', achievedDate: '2026-10-15' }),
        makeMilestone({ id: 'm_5', targetDate: '2026-10-01' }),
      ],
    });
    expect(mapSummary(plan, makeRecord(), START, TODAY, NOW).nextMilestone).toBe('2026-11-15');
  });

  it('counts planned milestones before signing, and starts from the unsigned start date', () => {
    const plan = makeMapPlan({ milestones: [makeMilestone({ targetDate: '2026-10-01' })] });
    const s = mapSummary(plan, makeRecord({ stage: 'recruitment', signedDate: null }), '2026-10-16', TODAY, null);
    expect(s).toEqual({ health: 'on_track', nextMilestone: null });
    const later = makeMapPlan({ milestones: [makeMilestone({ targetDate: '2026-10-20' })] });
    expect(mapSummary(later, makeRecord({ stage: 'recruitment', signedDate: null }), '2026-10-16', TODAY, null).nextMilestone).toBe('2026-10-20');
  });

  it('has no health and no next milestone once the recruitment ended without signing', () => {
    const plan = makeMapPlan({
      milestones: [makeMilestone({ targetDate: '2026-11-15' })],
      activities: [makeActivity({ dueDate: '2026-10-01', status: 'in_progress' })],
    });
    const closed = makeRecord({ stage: 'recruitment', signedDate: null, closed: 'no', closedReason: 'Not a fit' });
    expect(mapSummary(plan, closed, START, TODAY, NOW)).toEqual({ health: null, nextMilestone: null });
  });

  it('takes the first by name of two milestones on one date, and never an undated one', () => {
    const plan = makeMapPlan({
      milestones: [makeMilestone({ id: 'm_1', name: 'B', targetDate: '2026-11-15' }), makeMilestone({ id: 'm_2', name: 'A', targetDate: '2026-11-15' }),
        makeMilestone({ id: 'm_3', name: 'Undated', targetDate: null })],
    });
    const joined = { ...plan, info: planInfoFor(plan.info, makeRecord(), START) };
    expect(nextMapMilestone(joined, TODAY)?.name).toBe('A');
    expect(summarizeMap({ ...joined, milestones: [makeMilestone({ targetDate: null })] }, TODAY, NOW).nextMilestone).toBeNull();
  });
});

describe('a closed horizon’s check-ins', () => {
  const past = [{ startDate: '2026-09-01', horizonDays: 90, stage: 'onboarding' as const }, { startDate: '2026-10-02', horizonDays: 90, stage: 'growth' as const }];
  const joinedWith = (milestones: ReturnType<typeof makeMilestone>[], pastHorizons = past) => {
    const plan = makeMapPlan({ milestones });
    const info = planInfoFor(plan.info, makeRecord(), START);
    return { ...plan, info: { ...info, pastHorizons } };
  };
  const leftover = makeMilestone({ id: 'm_h2', name: 'Horizon 2: Day 30 check-in', targetDate: '2026-11-29' });
  const own = makeMilestone({ id: 'm_h3', name: 'Horizon 3: Day 30 check-in', targetDate: '2026-11-30' });

  it('is not next: horizon 3’s own milestone is', () => {
    expect(nextMapMilestone(joinedWith([leftover, own]), TODAY)?.id).toBe('m_h3');
    expect(summarizeMap(joinedWith([leftover, own]), TODAY, NOW).nextMilestone).toBe('2026-11-30');
  });

  it('still counts while its horizon is the running one', () => {
    expect(nextMapMilestone(joinedWith([leftover], past.slice(0, 1)), TODAY)?.id).toBe('m_h2');
  });

  it('still counts a hand-named milestone and a horizon 1 goal', () => {
    const hand = makeMilestone({ id: 'm_hand', name: 'Sign the data deal', targetDate: '2026-11-20' });
    const goal = makeMilestone({ id: 'm_goal', name: 'Day 60: First joint opportunity', targetDate: '2026-11-10' });
    expect(nextMapMilestone(joinedWith([leftover, own, hand]), TODAY)?.id).toBe('m_hand');
    expect(nextMapMilestone(joinedWith([leftover, own, hand, goal]), TODAY)?.id).toBe('m_goal');
  });

  it('is not missed against health once its date passes, but a hand-named missed one is', () => {
    const late = makeMilestone({ id: 'm_old', name: ' horizon 2:  day 30 CHECK-IN ', targetDate: '2026-10-12' });
    expect(summarizeMap(joinedWith([late]), TODAY, NOW).reasons).toEqual([]);
    const hand = makeMilestone({ id: 'm_hand', name: 'Sign the data deal', targetDate: '2026-10-12' });
    expect(summarizeMap(joinedWith([late, hand]), TODAY, NOW).reasons).toEqual([{ kind: 'milestone_missed', milestoneId: 'm_hand' }]);
  });

  it('leaves out a closed horizon’s unheld business review too', () => {
    const review = makeMilestone({ id: 'm_rev', name: 'Horizon 2: Business review', targetDate: '2026-10-12' });
    const upcoming = makeMilestone({ id: 'm_rev2', name: 'Horizon 2: Business review', targetDate: '2026-11-20' });
    expect(summarizeMap(joinedWith([review]), TODAY, NOW).reasons).toEqual([]);
    expect(nextMapMilestone(joinedWith([upcoming, own]), TODAY)?.id).toBe('m_h3');
  });

  it('finds the names of a 60-day horizon (one check-in, then the review)', () => {
    const short = [past[0]!, { startDate: '2026-10-02', horizonDays: 60, stage: 'growth' as const }];
    const c30 = makeMilestone({ id: 'm_c30', name: 'Horizon 2: Day 30 check-in', targetDate: '2026-11-20' });
    const c60 = makeMilestone({ id: 'm_c60', name: 'Horizon 2: Day 60 check-in', targetDate: '2026-11-25' });
    expect(nextMapMilestone(joinedWith([c30, own], short), TODAY)?.id).toBe('m_h3');
    expect(nextMapMilestone(joinedWith([c60], short), TODAY)?.id).toBe('m_c60');
  });

  it('leaves out horizon 1’s business review once horizon 1 is closed, but keeps its goals', () => {
    const one = past.slice(0, 1);
    const review = makeMilestone({ id: 'm_d90', name: 'Day 90: First business review', targetDate: '2026-10-12' });
    const later = makeMilestone({ id: 'm_d90b', name: 'day 90: first business  review', targetDate: '2026-11-20' });
    const goal = makeMilestone({ id: 'm_goal', name: 'Day 60: First joint opportunity', targetDate: '2026-11-25' });
    const missedGoal = makeMilestone({ id: 'm_goal2', name: 'Day 30: Partner enabled', targetDate: '2026-10-12' });
    expect(summarizeMap(joinedWith([review], one), TODAY, NOW).reasons).toEqual([]);
    expect(nextMapMilestone(joinedWith([later, goal], one), TODAY)?.id).toBe('m_goal');
    expect(summarizeMap(joinedWith([missedGoal], one), TODAY, NOW).reasons).toEqual([{ kind: 'milestone_missed', milestoneId: 'm_goal2' }]);
  });
});

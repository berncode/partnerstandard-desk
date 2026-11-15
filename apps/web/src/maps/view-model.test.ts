import { planInfoFor, type JoinedPlan, type MapPlan, type MapRecord } from '@partner-desk/core';
import { makeActivity, makeExitTrigger, makeMilestone, makePerson, makePlan, MAP_TODAY } from '@partner-desk/core/test-builders';
import { buildSamplePlan, buildSampleRecord } from '@partner-desk/method';
import { describe, expect, it } from 'vitest';
import {
  cardOf, DEFAULT_FILTERS, describeReason, dueState, eligibleOwners, filterActivities, groupActivities, horizonLeft, horizonProgress,
  isFiltered, nextStatus, reviewDue, sortByAttention, summarizePlan, type PlanCard,
} from './view-model';

const TODAY = MAP_TODAY;
const sample = buildSamplePlan(TODAY) as MapPlan;
const record = buildSampleRecord(TODAY) as MapRecord;
const joined = (plan: MapPlan, rec: MapRecord = record): JoinedPlan => ({ ...plan, info: planInfoFor(plan.info, rec, TODAY) });

describe('summarizePlan', () => {
  it('summarizes the sample MAP as the MAP app’s dashboard card did', () => {
    const card = summarizePlan('map_sample', 'Brightwave Systems as reseller', joined(sample), TODAY);
    expect(card).toMatchObject({
      mapId: 'map_sample', displayName: 'Brightwave Systems as reseller', stage: 'onboarding', ended: false, health: 'at_risk',
      nextMilestone: { name: 'Day 60: First joint opportunity' }, overdueCount: 1,
    });
    expect(card.progress.label).toBe('Horizon 1 · Day 35 of 90');
    expect(horizonLeft(card.progress)).toBe('Horizon 1 · 56 days left');
  });

  it('before signing reads "Before signing", and "Ended without signing" once the record is closed', () => {
    const unsigned = { ...record, stage: 'recruitment' as const, signedDate: null };
    expect(summarizePlan('m', 'x', joined(sample, unsigned), TODAY).progress.label).toBe('Before signing');
    const closed = summarizePlan('m', 'x', joined(sample, { ...unsigned, closed: 'no', closedReason: 'Not a fit' }), TODAY);
    expect(closed).toMatchObject({ ended: true, health: null, nextMilestone: null, progress: { label: 'Ended without signing' } });
    expect(horizonLeft(closed.progress)).toBe('Ended without signing');
  });

  it('counts from the MAP’s last progress: a MAP changed today of a partner signed long ago is not "no progress"', () => {
    const quiet: MapPlan = { ...sample, objectives: [], activities: [makeActivity()], people: [], milestones: [], exitTriggers: [] };
    const old = { ...record, signedDate: '2026-01-01' };
    const read = { value: quiet, info: planInfoFor(quiet.info, old, TODAY) };
    expect(cardOf({ mapId: 'm', displayName: 'x' }, { ...read, lastProgressAt: `${TODAY}T08:00:00.000Z` }, TODAY).health).toBe('on_track');
    expect(cardOf({ mapId: 'm', displayName: 'x' }, { ...read, lastProgressAt: '2026-09-01T08:00:00.000Z' }, TODAY).health).toBe('off_track');
  });

  it('has no health for an empty MAP, however long ago its last progress (owner, 2026-10-31)', () => {
    const empty: MapPlan = { ...sample, activities: [], milestones: [] };
    const read = { value: empty, info: planInfoFor(empty.info, { ...record, signedDate: '2026-01-01' }, TODAY) };
    expect(cardOf({ mapId: 'm', displayName: 'x' }, { ...read, lastProgressAt: '2026-09-01T08:00:00.000Z' }, TODAY))
      .toMatchObject({ health: 'empty', reasons: [] });
  });

  it('names the next milestone as the partner row keeps it: never an undated one, nor a planned date already past', () => {
    const milestones = [
      { id: 'm_1', name: 'Undated', targetDate: null, criteria: '', achievedDate: null },
      { id: 'm_2', name: 'Planned, past', targetDate: '2026-10-01', criteria: '', achievedDate: null },
    ];
    const unsigned = { ...record, stage: 'recruitment' as const, signedDate: null };
    expect(summarizePlan('m', 'x', joined({ ...sample, milestones }, unsigned), TODAY).nextMilestone).toBeNull();
  });

  it('says when a horizon starts later, or ended', () => {
    const info = planInfoFor(sample.info, record, TODAY);
    expect(horizonProgress({ ...info, startDate: '2026-10-20' }, TODAY).label).toBe('Horizon 1 · Starts in 4 days');
    expect(horizonProgress({ ...info, startDate: '2026-01-01' }, TODAY).label).toMatch(/^Horizon ended \d+ days ago$/);
  });
});

describe('sortByAttention', () => {
  const card = (displayName: string, health: PlanCard['health'], nextDue: string | null) =>
    ({ ...summarizePlan('m', displayName, joined(sample), TODAY), mapId: displayName, health, nextDue });

  it('puts off track first, then at risk, then on track; then the earliest due date; then the name', () => {
    const cards = [card('A', 'on_track', null), card('B', 'at_risk', '2026-11-01'), card('C', 'off_track', null),
      card('D', 'at_risk', '2026-10-20'), card('E', 'on_track', null)];
    expect(sortByAttention(cards).map((c) => c.displayName)).toEqual(['C', 'D', 'B', 'A', 'E']);
  });

  it('puts an empty MAP after on track and before not signed', () => {
    const cards = [card('A', null, null), card('B', 'empty', null), card('C', 'on_track', null), card('D', 'off_track', null)];
    expect(sortByAttention(cards).map((c) => c.displayName)).toEqual(['D', 'C', 'B', 'A']);
  });
});

// The plan page's rules.

describe('reviewDue', () => {
  const info = makePlan().info; // starts 2026-10-10, 90 days: day 90 is 2027-01-07

  it('is due in the last 14 days of the horizon and after it ends', () => {
    expect(reviewDue(info, '2026-12-24')).toBe(false); // day 76
    expect(reviewDue(info, '2026-12-25')).toBe(true); // day 77
    expect(reviewDue(info, '2027-01-07')).toBe(true);
    expect(reviewDue(info, '2027-03-01')).toBe(true);
  });

  it('is never due at exit, before signing, nor for a horizon that hasn’t started', () => {
    expect(reviewDue({ ...info, stage: 'exit' }, '2027-01-07')).toBe(false);
    expect(reviewDue({ ...info, stage: 'recruitment' }, '2027-01-07')).toBe(false);
    expect(reviewDue({ ...info, horizonDays: 10 }, '2026-10-01')).toBe(false);
  });
});

describe('nextStatus', () => {
  it('cycles the common path with one click', () => {
    expect(nextStatus('not_started')).toBe('in_progress');
    expect(nextStatus('in_progress')).toBe('done');
    expect(nextStatus('done')).toBe('not_started');
    expect(nextStatus('blocked')).toBe('in_progress');
    expect(nextStatus('na')).toBe('not_started');
  });
});

describe('groupActivities', () => {
  const m30 = makeMilestone({ id: 'm_30', name: 'Day 30', targetDate: '2026-11-09' });
  const m60 = makeMilestone({ id: 'm_60', name: 'Day 60', targetDate: '2026-12-09' });
  const plan = makePlan({
    milestones: [m60, m30],
    activities: [
      makeActivity({ id: 'a_1', title: 'B', milestoneId: 'm_30', dueDate: '2026-11-01' }),
      makeActivity({ id: 'a_2', title: 'A', milestoneId: 'm_30', dueDate: '2026-11-01' }),
      makeActivity({ id: 'a_3', title: 'C', milestoneId: 'm_30', dueDate: null }),
      makeActivity({ id: 'a_4', title: 'Loose', milestoneId: null }),
      makeActivity({ id: 'a_5', title: 'Dangling', milestoneId: 'm_gone' }),
    ],
  });

  it('orders milestones by date, activities by due date then title, unscheduled last', () => {
    const groups = groupActivities(plan, plan.activities, TODAY);
    expect(groups.map((g) => g.key)).toEqual(['m_30', 'm_60', 'unscheduled']);
    expect(groups[0]!.activities.map((a) => a.id)).toEqual(['a_2', 'a_1', 'a_3']);
    expect(groups[1]!.activities).toEqual([]);
    expect(groups[2]!.activities.map((a) => a.id)).toEqual(['a_5', 'a_4']);
    expect(groups[0]!.status).toBe('upcoming');
  });
});

describe('filters', () => {
  const list = [
    makeActivity({ id: 'a_1', side: 'us', ownerId: 'p_1', status: 'done' }),
    makeActivity({ id: 'a_2', side: 'partner', ownerId: null, status: 'blocked' }),
    makeActivity({ id: 'a_3', side: 'joint', ownerId: 'p_1', status: 'not_started' }),
  ];

  it('always keeps the ids it is told to keep', () => {
    expect(filterActivities(list, { ...DEFAULT_FILTERS, status: 'blocked' }, new Set(['a_1'])).map((a) => a.id)).toEqual(['a_1', 'a_2']);
    expect(filterActivities(list, { ...DEFAULT_FILTERS, side: 'joint' }, new Set()).map((a) => a.id)).toEqual(['a_3']);
  });

  it('filters by side, owner and status', () => {
    expect(filterActivities(list, DEFAULT_FILTERS)).toHaveLength(3);
    expect(filterActivities(list, { ...DEFAULT_FILTERS, side: 'partner' }).map((a) => a.id)).toEqual(['a_2']);
    expect(filterActivities(list, { ...DEFAULT_FILTERS, ownerId: 'none' }).map((a) => a.id)).toEqual(['a_2']);
    expect(filterActivities(list, { ...DEFAULT_FILTERS, ownerId: 'p_1' }).map((a) => a.id)).toEqual(['a_1', 'a_3']);
    expect(filterActivities(list, { ...DEFAULT_FILTERS, status: 'open' }).map((a) => a.id)).toEqual(['a_2', 'a_3']);
    expect(isFiltered(DEFAULT_FILTERS)).toBe(false);
    expect(isFiltered({ ...DEFAULT_FILTERS, status: 'blocked' })).toBe(true);
  });
});

describe('dueState', () => {
  it('describes due dates by urgency', () => {
    expect(dueState(makeActivity({ dueDate: null }), TODAY)).toEqual({ tone: 'none', label: 'No date' });
    expect(dueState(makeActivity({ dueDate: '2026-10-06' }), TODAY)).toEqual({ tone: 'overdue', label: '10 days overdue' });
    expect(dueState(makeActivity({ dueDate: '2026-10-15' }), TODAY)).toEqual({ tone: 'overdue', label: '1 day overdue' });
    expect(dueState(makeActivity({ dueDate: '2026-10-18' }), TODAY)).toEqual({ tone: 'soon', label: 'In 2 days' });
    expect(dueState(makeActivity({ dueDate: '2026-11-20' }), TODAY)).toEqual({ tone: 'later', label: '20 Nov' });
    expect(dueState(makeActivity({ dueDate: '2026-10-06', status: 'done' }), TODAY)).toEqual({ tone: 'done', label: '6 Oct' });
  });
});

describe('people', () => {
  it('lets joint activities be owned by anyone, sided ones only by that side', () => {
    const plan = makePlan({ people: [makePerson({ id: 'p_us' }), makePerson({ id: 'p_pa', side: 'partner', name: 'Priya' })] });
    expect(eligibleOwners(plan, 'us').map((p) => p.id)).toEqual(['p_us']);
    expect(eligibleOwners(plan, 'partner').map((p) => p.id)).toEqual(['p_pa']);
    expect(eligibleOwners(plan, 'joint').map((p) => p.id)).toEqual(['p_us', 'p_pa']);
  });
});

describe('health text', () => {
  it('explains each reason in plain words', () => {
    const plan = joined(sample);
    expect(describeReason(plan, { kind: 'overdue', activityId: 'a_sample4', days: 14 }))
      .toBe('“Load our price list into the Brightwave quoting tool” is 14 days overdue');
    expect(describeReason(plan, { kind: 'stalled', days: 15 })).toBe('No progress for 15 days');
    expect(describeReason(plan, { kind: 'milestone_missed', milestoneId: 'm_sample1' })).toBe('Milestone “Day 30: Partner enabled” was missed');
    const withTrigger = makePlan({ exitTriggers: [makeExitTrigger({ id: 'x_1', condition: 'No deals' })] });
    expect(describeReason(withTrigger, { kind: 'exit_trigger', exitTriggerId: 'x_1', status: 'watch' })).toBe('Exit trigger on watch: No deals');
    expect(describeReason(withTrigger, { kind: 'exit_trigger', exitTriggerId: 'x_1', status: 'triggered' })).toBe('Exit trigger reached: No deals');
    expect(describeReason(withTrigger, { kind: 'overdue', activityId: 'a_gone', days: 1 })).toBe('“An activity” is 1 day overdue');
  });
});

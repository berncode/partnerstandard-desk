// On the joined plan.
import { describe, expect, it } from 'vitest';
import { MOMENTUM_NEXT_STEPS } from '@partner-desk/method';
import { addDays } from './dates';
import {
  alertLines, digestSection, isQuiet, momentumChange, momentumState, momentumSuggestion, nudgesFor, partnerAlertDecision,
  type AlertEvent,
} from './notify-evaluate';
import { makeActivity, makeExitTrigger, makeMilestone, makeObjective, makePerson, makePlan } from './test-builders';
import type { Activity, JoinedPlan as Plan } from './types';

const TODAY = '2026-10-20';
const PLAN = 'pl_0123456789';
const due = (days: number) => addDays(TODAY, days);
const ben = makePerson({ id: 'p_ben001', side: 'us', name: 'Ben Ito', email: 'ben@example.com' });
const lena = makePerson({ id: 'p_lena01', side: 'partner', name: 'Lena Ortiz', email: ' Lena@Example.com ' });
const noEmail = makePerson({ id: 'p_noem01', side: 'us', name: 'No Email', email: null });
const typo = makePerson({ id: 'p_typo01', side: 'us', name: 'Typo', email: 'not-an-address' });

function plan(activities: Partial<Activity>[], extra: Partial<Plan> = {}): Plan {
  return makePlan({
    people: [ben, lena, noEmail, typo],
    activities: activities.map((a, i) => makeActivity({ id: `a_${i}`, title: `Task ${i}`, ownerId: 'p_ben001', ...a })),
    ...extra,
  });
}
const kinds = (p: Plan, dueSoonDays = 3, today = TODAY) => nudgesFor(PLAN, p, today, dueSoonDays).map((n) => [n.activityId, n.kind, n.days]);

describe('a recruitment that ended without signing', () => {
  const ended = (p: Plan): Plan => ({ ...p, info: { ...p.info, stage: 'recruitment', closed: 'no', closedReason: 'Not qualified' } });

  it('reminds nobody of its open activities', () => {
    expect(kinds(ended(plan([{ dueDate: due(1) }, { dueDate: due(-3) }])))).toEqual([]);
  });

  it('never loses momentum', () => {
    expect(momentumState(ended(plan([])), addDays(TODAY, 60), null)).toBe('on_track');
  });
});

describe('after the partner type’s exit (PartnerStandard Desk, ruling R7)', () => {
  const exited = (p: Plan): Plan => ({ ...p, info: { ...p.info, stage: 'exit' } });

  it('reminds nobody of its open activities', () => {
    expect(kinds(plan([{ dueDate: due(1) }, { dueDate: due(-3) }]))).toHaveLength(2);
    expect(kinds(exited(plan([{ dueDate: due(1) }, { dueDate: due(-3) }])))).toEqual([]);
  });

  it('never loses momentum, so no warning goes out and a slip stored before is put right silently', () => {
    expect(momentumState(plan([{}]), addDays(TODAY, 60), null)).not.toBe('on_track');
    expect(momentumState(exited(plan([{}])), addDays(TODAY, 60), null)).toBe('on_track');
    expect(momentumChange(momentumState(exited(plan([{}])), addDays(TODAY, 60), null), 'at_risk')).toBe('store');
  });
});

describe('nudgesFor: due soon', () => {
  it('reminds 1 to 3 days ahead by default, and not on the due date itself', () => {
    expect(kinds(plan([0, 1, 2, 3, 4].map((d) => ({ dueDate: due(d) }))))).toEqual([
      ['a_1', 'due_soon', 1], ['a_2', 'due_soon', 2], ['a_3', 'due_soon', 3],
    ]);
  });

  it('honors the 1-day and 7-day windows', () => {
    const p = plan([1, 2, 7, 8].map((d) => ({ dueDate: due(d) })));
    expect(kinds(p, 1)).toEqual([['a_0', 'due_soon', 1]]);
    expect(kinds(p, 7)).toEqual([['a_0', 'due_soon', 1], ['a_1', 'due_soon', 2], ['a_2', 'due_soon', 7]]);
  });

  it('keys a reminder by plan, activity, person and due date, so it goes out once per due date and owner', () => {
    const key = (p: Plan, today = TODAY) => nudgesFor(PLAN, p, today, 3)[0]!.key;
    const first = key(plan([{ dueDate: '2026-10-23' }]));
    expect(first).toBe(`due_soon:${PLAN}:a_0:p_ben001:2026-10-23`);
    expect(key(plan([{ dueDate: '2026-10-23' }]), '2026-10-21')).toBe(first);
    expect(key(plan([{ dueDate: '2026-10-22' }]))).not.toBe(first);
    expect(key(plan([{ dueDate: '2026-10-23', ownerId: 'p_lena01', side: 'partner' }]))).toBe(`due_soon:${PLAN}:a_0:p_lena01:2026-10-23`);
  });
});

describe('nudgesFor: overdue', () => {
  const keyOn = (daysLate: number) => nudgesFor(PLAN, plan([{ dueDate: '2026-10-19' }]), addDays('2026-10-19', daysLate), 3)[0]!;

  it('reminds the day after the due date, then once a week', () => {
    expect(keyOn(1)).toMatchObject({ kind: 'overdue', days: 1, key: `overdue:${PLAN}:a_0:p_ben001:2026-10-19:0` });
    expect(new Set([1, 2, 3, 4, 5, 6, 7].map((d) => keyOn(d).key)).size).toBe(1);
    expect(keyOn(8).key).toBe(`overdue:${PLAN}:a_0:p_ben001:2026-10-19:1`);
    expect(keyOn(14).key).toBe(keyOn(8).key);
    expect(keyOn(15).key).toBe(`overdue:${PLAN}:a_0:p_ben001:2026-10-19:2`);
  });

  it('stops for done and n/a activities, but not for blocked or in-progress ones', () => {
    const p = plan([
      { status: 'done', dueDate: due(1) }, { status: 'na', dueDate: due(-3) },
      { status: 'blocked', dueDate: due(-3) }, { status: 'in_progress', dueDate: due(2) },
    ]);
    expect(kinds(p)).toEqual([['a_2', 'overdue', 3], ['a_3', 'due_soon', 2]]);
  });
});

describe('nudgesFor: recipients', () => {
  it('needs an owner person with a valid address, and a due date', () => {
    const p = plan([
      { ownerId: null, dueDate: due(1) }, { ownerId: 'p_noem01', dueDate: due(1) }, { ownerId: 'p_gone01', dueDate: due(1) },
      { ownerId: 'p_typo01', dueDate: due(1) }, { dueDate: null },
    ]);
    expect(nudgesFor(PLAN, p, TODAY, 3)).toEqual([]);
  });

  it('reminds owners on either side, with the address as stored in the sheet, tidied', () => {
    const [item] = nudgesFor(PLAN, plan([{ ownerId: 'p_lena01', side: 'partner', dueDate: due(1), title: 'Register first deal' }]), TODAY, 3);
    expect(item).toMatchObject({ email: 'lena@example.com', personId: 'p_lena01', personName: 'Lena Ortiz', title: 'Register first deal', dueDate: due(1), planId: PLAN });
  });
});

describe('momentum', () => {
  const stalled = (days: number) => makePlan({ info: { ...makePlan().info, startDate: addDays(TODAY, -days) }, activities: [makeActivity()] });

  it('reads 14 days without progress as at risk and 30 as off track', () => {
    expect(momentumState(stalled(13), TODAY, null)).toBe('on_track');
    expect(momentumState(stalled(14), TODAY, null)).toBe('at_risk');
    expect(momentumState(stalled(29), TODAY, null)).toBe('at_risk');
    expect(momentumState(stalled(30), TODAY, null)).toBe('off_track');
    expect(momentumState(stalled(40), TODAY, '2026-10-19T10:00:00.000Z')).toBe('on_track');
  });

  it('warns only on a change for the worse, and stores improvements without a warning', () => {
    expect(momentumChange('at_risk', null)).toBe('warn');
    expect(momentumChange('at_risk', 'on_track')).toBe('warn');
    expect(momentumChange('off_track', 'on_track')).toBe('warn');
    expect(momentumChange('off_track', 'at_risk')).toBe('warn');
    expect(momentumChange('at_risk', 'at_risk')).toBe('none');
    expect(momentumChange('on_track', 'on_track')).toBe('none');
    expect(momentumChange('on_track', 'at_risk')).toBe('store');
    expect(momentumChange('at_risk', 'off_track')).toBe('store');
    expect(momentumChange('on_track', null)).toBe('store');
  });

  it('never warns about an empty MAP (owner, 2026-10-31): nothing to manage yet, so nothing stalls', () => {
    const empty = makePlan({ info: { ...makePlan().info, startDate: addDays(TODAY, -40) }, exitTriggers: [makeExitTrigger({ status: 'triggered' })] });
    expect(momentumState(empty, TODAY, null)).toBe('on_track');
    expect(momentumChange(momentumState(empty, TODAY, null), null)).toBe('store');
    expect(momentumChange(momentumState(empty, TODAY, null), 'at_risk')).toBe('store');
    expect(momentumState({ ...empty, milestones: [makeMilestone()] }, TODAY, null)).toBe('off_track');
  });

  it('suggests a next step from the content, the same one for the same plan and day', () => {
    const suggestion = momentumSuggestion(PLAN, TODAY);
    expect(MOMENTUM_NEXT_STEPS).toContain(suggestion);
    expect(momentumSuggestion(PLAN, TODAY)).toBe(suggestion);
    expect(new Set(Array.from({ length: 20 }, (_, i) => momentumSuggestion(PLAN, due(i)))).size).toBeGreaterThan(1);
  });
});

describe('digestSection', () => {
  const RECENT = '2026-10-19T09:00:00.000Z';
  const busy = plan([
    { title: 'Done a week ago', status: 'done', completedDate: due(-7) },
    { title: 'Done yesterday', status: 'done', completedDate: due(-1) },
    { title: 'Done today', status: 'done', completedDate: TODAY },
    { title: 'Done long ago', status: 'done', completedDate: due(-8) },
    { title: 'Due today', dueDate: TODAY },
    { title: 'Due in six days', dueDate: due(6) },
    { title: 'Due in a week', dueDate: due(7) },
    { title: 'Late', dueDate: due(-2) },
    { title: 'Stuck', status: 'blocked' },
  ]);

  it('collects last week’s done items, this week’s due items, overdue and blocked ones', () => {
    const section = digestSection(PLAN, busy, TODAY, RECENT, null);
    expect(section.doneLastWeek.map((a) => a.title)).toEqual(['Done a week ago', 'Done yesterday']);
    expect(section.dueThisWeek).toEqual([{ id: 'a_4', title: 'Due today', dueDate: TODAY }, { id: 'a_5', title: 'Due in six days', dueDate: due(6) }]);
    expect(section.overdue).toEqual([{ id: 'a_7', title: 'Late', days: 2 }]);
    expect(section.blocked).toEqual([{ id: 'a_8', title: 'Stuck' }]);
    expect(section).toMatchObject({ planId: PLAN, partnerName: 'Acme', health: 'on_track', healthChange: null });
  });

  it('shows a health change against the last digest, and none the first time', () => {
    const watched = plan([{ dueDate: due(10) }], { exitTriggers: [makeExitTrigger({ status: 'watch' })] });
    expect(digestSection(PLAN, watched, TODAY, RECENT, null).healthChange).toBeNull();
    expect(digestSection(PLAN, watched, TODAY, RECENT, 'on_track')).toMatchObject({ health: 'at_risk', healthChange: { from: 'on_track', to: 'at_risk' } });
    expect(digestSection(PLAN, watched, TODAY, RECENT, 'at_risk').healthChange).toBeNull();
  });

  it('is quiet when nothing changed and nothing is due', () => {
    const calm = plan([{ dueDate: due(10) }, { status: 'done', completedDate: due(-20) }]);
    expect(isQuiet(digestSection(PLAN, calm, TODAY, RECENT, 'on_track'))).toBe(true);
    expect(isQuiet(digestSection(PLAN, busy, TODAY, RECENT, null))).toBe(false);
    expect(isQuiet(digestSection(PLAN, plan([{ dueDate: due(10) }], { exitTriggers: [makeExitTrigger({ status: 'watch' })] }), TODAY, RECENT, 'on_track'))).toBe(false);
  });

  it('never calls an empty MAP on track, reports no change for it and stays quiet (owner, 2026-10-31)', () => {
    const empty = plan([], { exitTriggers: [makeExitTrigger({ status: 'watch' })], objectives: [makeObjective()] });
    const section = digestSection(PLAN, empty, TODAY, RECENT, 'on_track');
    expect(section).toMatchObject({ health: 'empty', healthChange: null });
    expect(isQuiet(section)).toBe(true);
    expect(digestSection(PLAN, plan([{ dueDate: due(10) }]), TODAY, RECENT, null)).toMatchObject({ health: 'on_track', healthChange: null });
  });
});

describe('partner alerts', () => {
  const ev = (at: string, overrides: Partial<AlertEvent> = {}): AlertEvent => ({
    id: 1, entityType: 'activity', entityId: 'a_0', action: 'status_changed', actorRef: 'cl_lena', at, ...overrides,
  });

  it('instant: waits 15 minutes after the first new change, then covers everything new', () => {
    const events = [ev('2026-10-20T14:00:00.000Z', { id: 7 }), ev('2026-10-20T14:10:00.000Z', { id: 9, entityId: 'a_1' })];
    expect(partnerAlertDecision('instant', events, new Date('2026-10-20T14:14:00.000Z'), false)).toEqual({ send: false });
    expect(partnerAlertDecision('instant', events, new Date('2026-10-20T14:14:59.999Z'), false)).toEqual({ send: false });
    expect(partnerAlertDecision('instant', events, new Date('2026-10-20T14:15:00.000Z'), false)).toEqual({ send: true, throughId: 9 });
  });

  it('moves the cursor to the last event recorded, even when its time is earlier (Decision 12)', () => {
    const events = [ev('2026-10-20T14:10:00.000Z', { id: 9 }), ev('2026-10-20T14:05:00.000Z', { id: 10, entityId: 'a_late' })];
    expect(partnerAlertDecision('instant', events, new Date('2026-10-20T14:25:00.000Z'), false)).toEqual({ send: true, throughId: 10 });
  });

  it('daily: only with the 08:00 work; off: never; nothing new: nothing', () => {
    const events = [ev('2026-10-19T15:00:00.000Z', { id: 4 })];
    const morning = new Date('2026-10-20T08:05:00.000Z');
    expect(partnerAlertDecision('daily', events, morning, false)).toEqual({ send: false });
    expect(partnerAlertDecision('daily', events, morning, true)).toEqual({ send: true, throughId: 4 });
    expect(partnerAlertDecision('off', events, morning, true)).toEqual({ send: false });
    expect(partnerAlertDecision('instant', [], morning, true)).toEqual({ send: false });
  });

  describe('alertLines', () => {
    const p = plan([
      { id: 'a_done', title: 'Register first deal', status: 'done' },
      { id: 'a_prog', title: 'Train the sales team', status: 'in_progress' },
      { id: 'a_note', title: 'Share the logo pack' },
      { id: 'a_new0', title: 'Plan a webinar' },
      { id: 'a_skip', title: 'Joint press release', status: 'na' },
    ], { objectives: [makeObjective({ id: 'o_1', side: 'partner', statement: 'Close 3 deals' })] });
    const names: Record<string, string> = { cl_lena: 'Lena Ortiz', 'email:p_ben001': 'Ben Ito', cl_cara: 'Cara Diaz' };
    const nameOf = (ref: string) => names[ref] ?? 'Someone with a link';

    it('says who did what to which item, one line per item, in the order things first happened', () => {
      expect(alertLines([
        ev('2026-10-20T10:00:00.000Z', { entityId: 'a_prog' }),
        ev('2026-10-20T10:01:00.000Z', { entityId: 'a_done' }),
        ev('2026-10-20T10:02:00.000Z', { entityId: 'a_note', action: 'updated' }),
        ev('2026-10-20T10:03:00.000Z', { entityType: 'objective', entityId: 'o_1', action: 'updated' }),
        ev('2026-10-20T10:04:00.000Z', { entityId: 'a_new0', action: 'created' }),
        ev('2026-10-20T10:05:00.000Z', { entityId: 'a_new0', action: 'status_changed' }),
        ev('2026-10-20T10:06:00.000Z', { entityId: 'a_skip' }),
      ], p, nameOf)).toEqual([
        'Lena Ortiz set “Train the sales team” to in progress',
        'Lena Ortiz marked “Register first deal” done',
        'Lena Ortiz updated “Share the logo pack”',
        'Lena Ortiz updated “Close 3 deals”',
        'Lena Ortiz added “Plan a webinar”',
        'Lena Ortiz marked “Joint press release” not applicable',
      ]);
    });

    it('names everyone who changed an item', () => {
      const two = [ev('2026-10-20T10:00:00.000Z', { entityId: 'a_prog' }), ev('2026-10-20T10:01:00.000Z', { entityId: 'a_prog', actorRef: 'email:p_ben001' })];
      expect(alertLines(two, p, nameOf)).toEqual(['Lena Ortiz and Ben Ito set “Train the sales team” to in progress']);
      const three = [...two, ev('2026-10-20T10:02:00.000Z', { entityId: 'a_prog', actorRef: 'cl_cara' })];
      expect(alertLines(three, p, nameOf)).toEqual(['Lena Ortiz, Ben Ito and Cara Diaz set “Train the sales team” to in progress']);
    });

    it('describes an item that is gone without naming it', () => {
      expect(alertLines([ev('2026-10-20T10:00:00.000Z', { entityId: 'a_gone', action: 'updated' })], p, nameOf)).toEqual(['Lena Ortiz changed an item that was later removed']);
      expect(alertLines([ev('2026-10-20T10:00:00.000Z', { entityId: 'a_gone', action: 'created' })], p, nameOf)).toEqual(['Lena Ortiz added an item that was later removed']);
    });
  });
});

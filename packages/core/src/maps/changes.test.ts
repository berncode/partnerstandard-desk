// No stage, closing or signing tests here: those changes live on the partner record. See join.test.ts for the join.
import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { applyChange, type JoinedApplyOutcome as ApplyOutcome, type MapChangeStamp as ChangeStamp, type JoinedStartHorizonChange as StartHorizonChange } from './changes';
import { NOW, makeActivity, makeMilestone, makePerson, makePlan, makeReview, makeReviewItem, makeReviewNumber } from './test-builders';

const stamp: ChangeStamp = { now: NOW, actorName: 'Anna Keller', newId: (entity) => `${entity}_new` };

function ok(outcome: ApplyOutcome) {
  if (!outcome.ok) throw new Error(`expected ok, got ${outcome.error}: ${outcome.message}`);
  return outcome;
}

const base = makePlan({
  people: [makePerson({ id: 'p_anna01' }), makePerson({ id: 'p_lena01', side: 'partner', name: 'Lena Ortiz' })],
  milestones: [makeMilestone({ id: 'm_day301' })],
  activities: [
    makeActivity({ id: 'a_one001', ownerId: 'p_lena01', milestoneId: 'm_day301', updatedAt: '2026-10-01T09:00:00.000Z' }),
    makeActivity({ id: 'a_two001', ownerId: 'p_anna01' }),
  ],
});

describe('applyChange: add', () => {
  it('adds an activity with defaults, a new id and an edit stamp', () => {
    const result = ok(applyChange(base, { kind: 'add', entity: 'activity', values: { title: 'Joint webinar' } }, stamp));
    expect(result.entityId).toBe('activity_new');
    expect(result.plan.activities.at(-1)).toEqual(
      makeActivity({ id: 'activity_new', title: 'Joint webinar', updatedAt: NOW, updatedBy: 'Anna Keller' }),
    );
    expect(result.touched).toEqual([{ entity: 'activity', id: 'activity_new' }]);
  });

  it('ignores server-managed fields in values', () => {
    const result = ok(applyChange(base, {
      kind: 'add', entity: 'activity', values: { title: 'X', id: 'a_hack01', updatedBy: 'Mallory' },
    }, stamp));
    expect(result.plan.activities.at(-1)).toMatchObject({ id: 'activity_new', updatedBy: 'Anna Keller' });
  });

  it('returns field errors for invalid values', () => {
    const result = applyChange(base, { kind: 'add', entity: 'activity', values: { title: '' } }, stamp);
    expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { title: 'Activity title is required' } });
  });

  it('sets the completed date when added as done', () => {
    const result = ok(applyChange(base, { kind: 'add', entity: 'activity', values: { title: 'X', status: 'done' } }, stamp));
    expect(result.plan.activities.at(-1)?.completedDate).toBe('2026-10-16');
  });
});

describe('applyChange: update', () => {
  it('marks an activity done and stamps it', () => {
    const result = ok(applyChange(base, {
      kind: 'update', entity: 'activity', id: 'a_one001', patch: { status: 'done' }, expectedUpdatedAt: '2026-10-01T09:00:00.000Z',
    }, stamp));
    expect(result.plan.activities[0]).toMatchObject({ status: 'done', completedDate: '2026-10-16', updatedAt: NOW, updatedBy: 'Anna Keller' });
  });

  it('clears the completed date when an activity is reopened', () => {
    const done = { ...base, activities: [makeActivity({ id: 'a_one001', status: 'done', completedDate: '2026-10-10' })] };
    const result = ok(applyChange(done, { kind: 'update', entity: 'activity', id: 'a_one001', patch: { status: 'in_progress' } }, stamp));
    expect(result.plan.activities[0]!.completedDate).toBeNull();
  });

  it('rejects a stale edit as a conflict', () => {
    const result = applyChange(base, {
      kind: 'update', entity: 'activity', id: 'a_one001', patch: { note: 'x' }, expectedUpdatedAt: '2026-09-01T00:00:00.000Z',
    }, stamp);
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
  });

  describe('a hand edit of a patched field', () => {
    const edit = (patch: Record<string, unknown>, expected?: Record<string, unknown>) => applyChange(base, {
      kind: 'update', entity: 'activity', id: 'a_one001', patch, ...(expected ? { expected } : {}),
    }, stamp);
    const current = base.activities[0]!;

    it('conflicts when a patched field no longer has the value the client saw, even with the same Last updated', () => {
      const other = current.status === 'blocked' ? 'done' : 'blocked';
      expect(edit({ status: 'in_progress' }, { status: other })).toMatchObject({ ok: false, error: 'conflict' });
    });

    it('does not conflict when another field was changed by hand', () => {
      const handEdited = { ...base, activities: [{ ...current, note: 'typed in the sheet' }, base.activities[1]!] };
      const result = ok(applyChange(handEdited, {
        kind: 'update', entity: 'activity', id: 'a_one001', patch: { status: 'in_progress' }, expected: { status: current.status },
      }, stamp));
      expect(result.plan.activities[0]).toMatchObject({ status: 'in_progress', note: 'typed in the sheet' });
    });

    it('does not conflict when the client and the sheet agree on the value', () => {
      ok(edit({ note: 'x' }, { note: current.note }));
    });

    it('treats an empty value and a missing one alike', () => {
      const missing = { ...base, activities: [{ ...current, dueDate: undefined } as unknown as typeof current, base.activities[1]!] };
      ok(applyChange(missing, { kind: 'update', entity: 'activity', id: 'a_one001', patch: { dueDate: '2026-12-01' }, expected: { dueDate: null } }, stamp));
      const empty = { ...base, activities: [{ ...current, dueDate: null }, base.activities[1]!] };
      ok(applyChange(empty, { kind: 'update', entity: 'activity', id: 'a_one001', patch: { dueDate: '2026-12-01' }, expected: { dueDate: undefined } }, stamp));
    });

    it('is not checked for a change without expected', () => {
      ok(edit({ status: 'done' }));
    });
  });

  it('cannot change an id', () => {
    const result = ok(applyChange(base, { kind: 'update', entity: 'activity', id: 'a_one001', patch: { id: 'a_other1' } }, stamp));
    expect(result.plan.activities[0]!.id).toBe('a_one001');
  });

  it('reports unknown ids', () => {
    expect(applyChange(base, { kind: 'update', entity: 'activity', id: 'a_nope01', patch: {} }, stamp))
      .toMatchObject({ ok: false, error: 'not_found' });
  });

  it('touches activities owned by a renamed person', () => {
    const result = ok(applyChange(base, { kind: 'update', entity: 'person', id: 'p_lena01', patch: { name: 'Lena Ortiz-Meyer' } }, stamp));
    expect(result.touched).toEqual([{ entity: 'person', id: 'p_lena01' }, { entity: 'activity', id: 'a_one001' }]);
  });

  it('touches the review items a renamed person or milestone is named on, as their activities (owner, 2026-11-01)', () => {
    const plan = { ...base, reviewItems: [makeReviewItem({ id: 'ri_one001', ownerId: 'p_lena01', milestoneId: 'm_day301' }), makeReviewItem({ id: 'ri_two001' })] };
    expect(ok(applyChange(plan, { kind: 'update', entity: 'person', id: 'p_lena01', patch: { name: 'Lena Ortiz-Meyer' } }, stamp)).touched)
      .toEqual([{ entity: 'person', id: 'p_lena01' }, { entity: 'activity', id: 'a_one001' }, { entity: 'reviewItem', id: 'ri_one001' }]);
    expect(ok(applyChange(plan, { kind: 'update', entity: 'milestone', id: 'm_day301', patch: { name: 'Day 45' } }, stamp)).touched)
      .toEqual([{ entity: 'milestone', id: 'm_day301' }, { entity: 'activity', id: 'a_one001' }, { entity: 'reviewItem', id: 'ri_one001' }]);
  });

  it('updates plan info with validation', () => {
    expect(ok(applyChange(base, { kind: 'updateInfo', patch: { nextReviewDate: '2026-12-01' } }, stamp)).plan.info.nextReviewDate).toBe('2026-12-01');
    expect(applyChange(base, { kind: 'updateInfo', patch: { horizonDays: 0 } }, stamp))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { horizonDays: 'Use at least 7 days' } });
  });

  it('does not mutate the input plan', () => {
    const snapshot = structuredClone(base);
    applyChange(base, { kind: 'update', entity: 'activity', id: 'a_one001', patch: { status: 'done' } }, stamp);
    expect(base).toEqual(snapshot);
  });
});

describe('applyChange: delete', () => {
  it('removes a person and clears their ownership', () => {
    const result = ok(applyChange(base, { kind: 'delete', entity: 'person', id: 'p_lena01' }, stamp));
    expect(result.plan.people.map((p) => p.id)).toEqual(['p_anna01']);
    expect(result.plan.activities[0]!.ownerId).toBeNull();
    expect(result.touched).toEqual([{ entity: 'activity', id: 'a_one001' }]);
    expect(result.removed).toEqual({ entity: 'person', id: 'p_lena01' });
  });

  it('removes a milestone and unlinks its activities', () => {
    const result = ok(applyChange(base, { kind: 'delete', entity: 'milestone', id: 'm_day301' }, stamp));
    expect(result.plan.activities[0]!.milestoneId).toBeNull();
  });

  // The Review items tab names its Owner and Milestone as the Activities tab does (owner, 2026-11-01): a name nobody has
  // would read as a problem, so a review item lets go of a deleted person or milestone as an activity does.
  it('clears a deleted person or milestone from the review items that name them', () => {
    const plan = {
      ...base,
      reviewItems: [
        makeReviewItem({ id: 'ri_one001', kind: 'commitment', ownerId: 'p_lena01', milestoneId: 'm_day301' }),
        makeReviewItem({ id: 'ri_two001', kind: 'commitment', ownerId: 'p_anna01' }),
      ],
    };
    const person = ok(applyChange(plan, { kind: 'delete', entity: 'person', id: 'p_lena01' }, stamp));
    expect(person.plan.reviewItems.map((i) => [i.id, i.ownerId, i.milestoneId])).toEqual([['ri_one001', null, 'm_day301'], ['ri_two001', 'p_anna01', null]]);
    expect(person.touched).toEqual([{ entity: 'activity', id: 'a_one001' }, { entity: 'reviewItem', id: 'ri_one001' }]);
    const milestone = ok(applyChange(plan, { kind: 'delete', entity: 'milestone', id: 'm_day301' }, stamp));
    expect(milestone.plan.reviewItems.map((i) => [i.id, i.ownerId, i.milestoneId])).toEqual([['ri_one001', 'p_lena01', null], ['ri_two001', 'p_anna01', null]]);
  });
});

describe('applyChange: duplicate names', () => {
  const nameError = (entity: 'person' | 'milestone', name: string) => ({
    ok: false, error: 'invalid', message: 'Please fix the highlighted fields',
    fieldErrors: { name: `Another ${entity} is already called “${name}”. Add something to tell them apart.` },
  });

  it('rejects adding a person or milestone whose name matches another, ignoring case and spacing', () => {
    expect(applyChange(base, { kind: 'add', entity: 'person', values: { name: '  lena   ORTIZ ' } }, stamp))
      .toEqual(nameError('person', 'lena   ORTIZ'));
    expect(applyChange(base, { kind: 'add', entity: 'milestone', values: { name: 'day 30' } }, stamp))
      .toEqual(nameError('milestone', 'day 30'));
  });

  it('rejects renaming onto another name but allows keeping your own', () => {
    expect(applyChange(base, { kind: 'update', entity: 'person', id: 'p_anna01', patch: { name: 'Lena Ortiz' } }, stamp))
      .toEqual(nameError('person', 'Lena Ortiz'));
    expect(ok(applyChange(base, { kind: 'update', entity: 'person', id: 'p_lena01', patch: { name: 'LENA ORTIZ', title: 'CEO' } }, stamp))
      .plan.people[1]).toMatchObject({ name: 'LENA ORTIZ', title: 'CEO' });
    const two = { ...base, milestones: [...base.milestones, makeMilestone({ id: 'm_day601', name: 'Day 60' })] };
    expect(applyChange(two, { kind: 'update', entity: 'milestone', id: 'm_day601', patch: { name: 'Day  30' } }, stamp))
      .toEqual(nameError('milestone', 'Day  30'));
  });

  it('allows distinct names', () => {
    expect(ok(applyChange(base, { kind: 'add', entity: 'person', values: { name: 'Lena Ortiz (Sales)' } }, stamp)).entityId).toBe('person_new');
  });
});

describe('applyChange: patch-only validation', () => {
  const stamp: ChangeStamp = { now: NOW, actorName: 'Lena Ortiz' };
  // A row typed into the sheet with a blank title: it loads (with an inline hint) but fails the full check.
  const plan = makePlan({ activities: [makeActivity({ id: 'a_1', title: '', status: 'not_started' })] });
  const done = { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } } as const;

  it('checks only the patched and stamped fields when asked', () => {
    expect(applyChange(plan, done, stamp)).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { title: 'Activity title is required' } });
    const outcome = applyChange(plan, done, { ...stamp, validate: 'patch' });
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.plan.activities[0]).toMatchObject({ title: '', status: 'done', completedDate: '2026-10-16', updatedAt: NOW, updatedBy: 'Lena Ortiz' });
    }
  });

  it('still refuses a bad value in a patched field', () => {
    const outcome = applyChange(plan, { kind: 'update', entity: 'activity', id: 'a_1', patch: { dueDate: 'soon' } }, { ...stamp, validate: 'patch' });
    expect(outcome).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { dueDate: expect.any(String) } });
  });

  it('cleans patched text the way the full check does', () => {
    const withObjective = makePlan({ objectives: [{ id: 'o_1', side: 'partner', statement: '', successMeasure: '' }] });
    // successMeasure doesn't trim in the schema; statement does, so it proves the patched field went through it.
    const outcome = applyChange(withObjective, { kind: 'update', entity: 'objective', id: 'o_1', patch: { statement: '  Grow pipeline  ' } }, { ...stamp, validate: 'patch' });
    expect(outcome.ok && outcome.plan.objectives[0]).toMatchObject({ statement: 'Grow pipeline', successMeasure: '' });
  });
});

describe('applyChange: startHorizon', () => {
  const plan = makePlan({
    info: { ...makePlan().info, stage: 'onboarding', startDate: '2026-07-20', horizonDays: 90, pastHorizons: [] },
    people: [makePerson({ id: 'p_anna01' })],
    milestones: [makeMilestone({ id: 'm_day301', name: 'Day 30: Partner enabled', targetDate: '2026-08-19' })],
    activities: [
      makeActivity({ id: 'a_done01', status: 'done', completedDate: '2026-08-01', milestoneId: 'm_day301' }),
      makeActivity({ id: 'a_open01', ownerId: 'p_anna01' }),
    ],
    objectives: [{ id: 'o_1', side: 'us', statement: 'Grow pipeline', successMeasure: '' }],
  });
  const change: StartHorizonChange = {
    kind: 'startHorizon', expectedStartDate: '2026-07-20', expectedHorizon: 0, startDate: '2026-10-20', horizonDays: 60, stage: 'growth',
    milestones: [
      { name: 'Horizon 2: Day 30 check-in', criteria: 'Progress reviewed with both sides', day: 30 },
      { name: 'Horizon 2: Business review', criteria: 'Results reviewed against both sides’ objectives', day: 60 },
    ],
  };
  let n = 0;
  const counting: ChangeStamp = { now: NOW, actorName: 'Anna Keller', newId: (entity) => `${entity}_new${++n}` };

  it('starts the new period, appends the previous one to the history and adds the milestones', () => {
    n = 0;
    const result = ok(applyChange(plan, change, counting));
    expect(result.plan.info).toEqual({
      ...plan.info, startDate: '2026-10-20', horizonDays: 60, stage: 'growth',
      pastHorizons: [{ startDate: '2026-07-20', horizonDays: 90, stage: 'onboarding' }],
    });
    expect(result.plan.milestones.slice(1)).toEqual([
      // Day 1 is the start date, so day 30 is 29 days later and day 60, the horizon's last day, 59 days later.
      { id: 'milestone_new1', name: 'Horizon 2: Day 30 check-in', targetDate: '2026-11-18', criteria: 'Progress reviewed with both sides', achievedDate: null },
      { id: 'milestone_new2', name: 'Horizon 2: Business review', targetDate: '2026-12-18', criteria: 'Results reviewed against both sides’ objectives', achievedDate: null },
    ]);
    expect(result.touched).toEqual([{ entity: 'milestone', id: 'milestone_new1' }, { entity: 'milestone', id: 'milestone_new2' }]);
    expect(result.entityId).toBeNull();
    expect(result.removed).toBeNull();
  });

  it('leaves people, objectives, activities and earlier milestones untouched', () => {
    const result = ok(applyChange(plan, change, counting));
    expect(result.plan.people).toBe(plan.people);
    expect(result.plan.objectives).toBe(plan.objectives);
    expect(result.plan.activities).toBe(plan.activities);
    expect(result.plan.exitTriggers).toBe(plan.exitTriggers);
    expect(result.plan.milestones[0]).toBe(plan.milestones[0]);
  });

  it('works without milestones and keeps an existing history in order', () => {
    const later = { ...plan, info: { ...plan.info, pastHorizons: [{ startDate: '2026-04-21', horizonDays: 90, stage: 'recruitment' as const }] } };
    const result = ok(applyChange(later, { ...change, expectedHorizon: 1, milestones: [] }, counting));
    expect(result.plan.info.pastHorizons).toEqual([
      { startDate: '2026-04-21', horizonDays: 90, stage: 'recruitment' },
      { startDate: '2026-07-20', horizonDays: 90, stage: 'onboarding' },
    ]);
    expect(result.plan.milestones).toBe(plan.milestones);
    expect(result.touched).toEqual([]);
  });

  it('is a conflict when the horizon was started since the change was made', () => {
    expect(applyChange(plan, { ...change, expectedStartDate: '2026-07-19' }, counting)).toMatchObject({ ok: false, error: 'conflict' });
    expect(applyChange(plan, { ...change, expectedHorizon: 1 }, counting)).toMatchObject({ ok: false, error: 'conflict' });
  });

  it('refuses a second start on the same day, with or without milestones, leaving the history as it was', () => {
    for (const milestones of [change.milestones, []]) {
      const first = { ...change, startDate: '2026-07-20', milestones };
      const once = ok(applyChange(plan, first, counting)).plan;
      expect(once.info.startDate).toBe('2026-07-20');
      expect(applyChange(once, first, counting)).toMatchObject({ ok: false, error: 'conflict' });
      expect(once.info.pastHorizons).toHaveLength(1);
    }
  });

  it('refuses recruitment as the new horizon’s stage', () => {
    expect(applyChange(plan, { ...change, stage: 'recruitment' }, counting)).toEqual({
      ok: false, error: 'invalid', message: 'Recruitment isn’t a horizon.', fieldErrors: { stage: 'Recruitment isn’t a horizon.' },
    });
  });

  it('refuses to start a horizon in recruitment: onboarding starts when the agreement is signed', () => {
    const recruiting = { ...plan, info: { ...plan.info, stage: 'recruitment' as const } };
    expect(applyChange(recruiting, change, counting)).toEqual({
      ok: false, error: 'invalid', message: 'In recruitment no horizon runs yet: record the signed agreement to start onboarding',
    });
  });

  it('refuses to start the next horizon before the current one has started', () => {
    const upcoming = { ...plan, info: { ...plan.info, startDate: '2026-11-01' } };
    expect(applyChange(upcoming, { ...change, expectedStartDate: '2026-11-01' }, counting)).toEqual({
      ok: false, error: 'invalid', message: 'The current horizon hasn’t started yet, so the next one can’t start',
    });
  });

  it('refuses a milestone name the plan already has, or two of the same', () => {
    expect(applyChange(plan, { ...change, milestones: [{ name: 'day 30: partner enabled', criteria: '', day: 30 }] }, counting))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { name: expect.stringContaining('day 30: partner enabled') } });
    const twice = [{ name: 'Check-in', criteria: '', day: 10 }, { name: 'Check-in', criteria: '', day: 20 }];
    expect(applyChange(plan, { ...change, milestones: twice }, counting)).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('validates the new period', () => {
    expect(applyChange(plan, { ...change, startDate: 'soon' }, counting)).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { startDate: expect.any(String) } });
    expect(applyChange(plan, { ...change, milestones: [{ name: ' ', criteria: '', day: 30 }] }, counting))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { name: 'Milestone name is required' } });
  });
});

describe('applyChange: reviews', () => {
  const withReviews = makePlan({
    reviews: [makeReview({ id: 'rv_one001' }), makeReview({ id: 'rv_two001', horizon: 2 })],
    reviewNumbers: [makeReviewNumber({ id: 'rn_one001', reviewId: 'rv_one001' }), makeReviewNumber({ id: 'rn_two001', reviewId: 'rv_two001' })],
    reviewItems: [makeReviewItem({ id: 'ri_one001', reviewId: 'rv_one001' }), makeReviewItem({ id: 'ri_two001', reviewId: 'rv_two001' })],
  });

  it('deleting a review deletes its numbers and items', () => {
    const result = ok(applyChange(withReviews, { kind: 'delete', entity: 'review', id: 'rv_one001' }, stamp));
    expect(result.plan.reviews.map((r) => r.id)).toEqual(['rv_two001']);
    expect(result.plan.reviewNumbers.map((r) => r.id)).toEqual(['rn_two001']);
    expect(result.plan.reviewItems.map((r) => r.id)).toEqual(['ri_two001']);
    expect(result.removed).toEqual({ entity: 'review', id: 'rv_one001' });
    expect(result.touched).toEqual([{ entity: 'reviewNumber', id: 'rn_one001' }, { entity: 'reviewItem', id: 'ri_one001' }]);
  });

  it('refuses a new commitment on a held review (a second tab opened before the close), and takes other lines', () => {
    const held = { ...withReviews, reviews: [makeReview({ id: 'rv_one001', state: 'held', heldOn: '2026-10-20' }), withReviews.reviews[1]!] };
    const values = { reviewId: 'rv_one001', kind: 'commitment', title: 'Train sellers', side: 'partner' };
    expect(applyChange(held, { kind: 'add', entity: 'reviewItem', values }, stamp))
      .toEqual({ ok: false, error: 'conflict', message: COPY.REVIEW_ERR_HELD_NO_COMMITMENT });
    // The prep of the next review still takes one, and a held review still takes its notes.
    ok(applyChange(held, { kind: 'add', entity: 'reviewItem', values: { ...values, reviewId: 'rv_two001' } }, stamp));
    ok(applyChange(held, { kind: 'add', entity: 'reviewItem', values: { ...values, kind: 'blocker' } }, stamp));
  });

  it('a review added with no includeScorecard has it false, and is stamped', () => {
    const result = ok(applyChange(withReviews, { kind: 'add', entity: 'review', values: { horizon: 3 } }, stamp));
    const row = result.plan.reviews.at(-1)!;
    expect(row.includeScorecard).toBe(false);
    expect([row.updatedAt, row.updatedBy]).toEqual([NOW, 'Anna Keller']);
  });

  it('updating a review stamps it, and a stale expectedUpdatedAt is a conflict', () => {
    const result = ok(applyChange(withReviews, { kind: 'update', entity: 'review', id: 'rv_one001', patch: { decisions: 'x' }, expectedUpdatedAt: null }, stamp));
    const row = result.plan.reviews[0]!;
    expect([row.decisions, row.updatedAt, row.updatedBy]).toEqual(['x', NOW, 'Anna Keller']);
    const stale = applyChange(result.plan, { kind: 'update', entity: 'review', id: 'rv_one001', patch: { decisions: 'y' }, expectedUpdatedAt: null }, stamp);
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
  });

  it('adding a reviewItem stamps no activity fields', () => {
    const result = ok(applyChange(withReviews, { kind: 'add', entity: 'reviewItem', values: { reviewId: 'rv_one001', kind: 'commitment', title: 'Send it' } }, stamp));
    const row = result.plan.reviewItems.at(-1)!;
    expect(row).toEqual(makeReviewItem({ id: 'reviewItem_new', reviewId: 'rv_one001', kind: 'commitment', title: 'Send it' }));
    expect(row).not.toHaveProperty('updatedAt');
    expect(row).not.toHaveProperty('completedDate');
    expect(row).not.toHaveProperty('status');
  });
});

import { describe, expect, it } from 'vitest';
import { addDays, horizonDayDate } from '../maps/dates';
import { horizonMilestones, suggestedMilestones } from '@partner-desk/method';
import { makeActivity, makeMilestone, makePerson, makePlan, makeReview, makeReviewItem, makeReviewNumber } from '../maps/test-builders';
import type { JoinedPlan } from '../maps/types';
import { COPY } from '@partner-desk/copy';
import { closeReviewChanges, currentHorizon, horizonWork, nearestHorizonLength, prepOf, reviewDateOf, reviewStatus, stageSuggestion } from './rules';

const START = '2026-10-10';
const LAST_DAY = horizonDayDate(START, 90);

const withInfo = (overrides: Partial<JoinedPlan['info']>, rest: Partial<JoinedPlan> = {}) => {
  const base = makePlan();
  return makePlan({ ...rest, info: { ...base.info, ...overrides } });
};

describe('reviewDateOf', () => {
  it('is null before signing, after a recruitment ended without signing, and after the exit', () => {
    expect(reviewDateOf(withInfo({ stage: 'recruitment' }).info)).toBeNull();
    expect(reviewDateOf(withInfo({ stage: 'recruitment', closed: 'no' }).info)).toBeNull();
    expect(reviewDateOf(withInfo({ stage: 'exit' }).info)).toBeNull();
  });
  it("is the horizon's last day when signed with no stored date, and a stored date wins", () => {
    expect(reviewDateOf(withInfo({}).info)).toBe(LAST_DAY);
    expect(reviewDateOf(withInfo({ nextReviewDate: '2026-12-01' }).info)).toBe('2026-12-01');
  });
  it('currentHorizon counts the past horizons plus one', () => {
    expect(currentHorizon(withInfo({}).info)).toBe(1);
    expect(currentHorizon(withInfo({ pastHorizons: [{ startDate: '2026-01-01', horizonDays: 90, stage: 'onboarding' }] }).info)).toBe(2);
  });
});

describe('reviewStatus', () => {
  const plan = withInfo({});
  it('is none when no review can be held', () => {
    expect(reviewStatus(withInfo({ stage: 'exit' }), START)).toEqual({ kind: 'none' });
  });
  it('is later 22 days before, coming 21 days before, overdue one day after', () => {
    expect(reviewStatus(plan, addDays(LAST_DAY, -22))).toEqual({ kind: 'later', date: LAST_DAY });
    expect(reviewStatus(plan, addDays(LAST_DAY, -21))).toEqual({ kind: 'coming', date: LAST_DAY, daysLeft: 21, prepId: null });
    expect(reviewStatus(plan, LAST_DAY)).toMatchObject({ kind: 'coming', daysLeft: 0 });
    expect(reviewStatus(plan, addDays(LAST_DAY, 1))).toEqual({ kind: 'overdue', date: LAST_DAY, daysLate: 1, prepId: null });
  });
  it('gives the prep row of the current horizon, not one of an earlier horizon', () => {
    const current = withInfo({}, { reviews: [makeReview({ id: 'rv_now', horizon: 1 })] });
    expect(reviewStatus(current, LAST_DAY)).toMatchObject({ prepId: 'rv_now' });
    const later = withInfo(
      { pastHorizons: [{ startDate: '2026-01-01', horizonDays: 90, stage: 'onboarding' }] },
      { reviews: [makeReview({ id: 'rv_old', horizon: 1 })] },
    );
    expect(reviewStatus(later, LAST_DAY)).toMatchObject({ prepId: null });
    const held = withInfo({}, { reviews: [makeReview({ id: 'rv_held', horizon: 1, state: 'held', heldOn: START })] });
    expect(reviewStatus(held, LAST_DAY)).toMatchObject({ prepId: null });
  });
});

describe('prepOf', () => {
  it('is the current horizon’s prep: not a held review, not an earlier horizon’s prep', () => {
    expect(prepOf(withInfo({}, { reviews: [makeReview({ id: 'rv_now' })] }))?.id).toBe('rv_now');
    expect(prepOf(withInfo({}, { reviews: [makeReview({ state: 'held', heldOn: START })] }))).toBeNull();
    const later = withInfo({ pastHorizons: [{ startDate: '2026-01-01', horizonDays: 90, stage: 'onboarding' }] }, { reviews: [makeReview()] });
    expect(prepOf(later)).toBeNull();
  });
});

describe('horizonWork', () => {
  const plan = makePlan({
    activities: [
      makeActivity({ id: 'a_open_before', dueDate: '2026-10-01' }),
      makeActivity({ id: 'a_done_before', dueDate: '2026-10-01', status: 'done' }),
      makeActivity({ id: 'a_na_before', dueDate: '2026-10-01', status: 'na' }),
      makeActivity({ id: 'a_in', dueDate: '2026-10-20' }),
      makeActivity({ id: 'a_done_in', dueDate: '2026-10-20', status: 'done' }),
      makeActivity({ id: 'a_na_in', dueDate: '2026-10-20', status: 'na' }),
      makeActivity({ id: 'a_after', dueDate: '2026-12-01' }),
      makeActivity({ id: 'a_nodate' }),
    ],
  });
  it('has activities due from the start to the end, plus open ones due before the start', () => {
    const ids = horizonWork(plan, '2026-11-01').map((a) => a.id);
    expect(ids).toEqual(['a_open_before', 'a_in', 'a_done_in']);
  });
});

describe('closeReviewChanges', () => {
  const HELD_ON = '2026-12-20';
  const TODAY = '2026-12-21';
  const owner = makePerson({ id: 'p_owner' });
  const commitment = (id: string, overrides = {}) => makeReviewItem({
    id, kind: 'commitment', title: `Do ${id}`, side: 'us', ownerId: 'p_owner', dueDate: '2027-01-15', milestoneId: null, ...overrides,
  });
  const base = (items = [commitment('ri_1'), commitment('ri_2', { side: 'partner', ownerId: null })], review = makeReview()) =>
    makePlan({ people: [owner], reviews: [review], reviewItems: items });
  const input = { reviewId: 'rv_test01', heldOn: HELD_ON, today: TODAY };

  it('gives startHorizon, two adds, two moved updates, the held update and the date reset, in that order', () => {
    const result = closeReviewChanges(base(), input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.changes.map((c) => (c.kind === 'updateInfo' || c.kind === 'startHorizon' ? c.kind : `${c.kind}:${c.entity}`));
    expect(kinds).toEqual(['startHorizon', 'add:activity', 'add:activity', 'update:reviewItem', 'update:reviewItem', 'update:review', 'updateInfo']);
    // Which commitment each change comes from, so a store's refusal can be shown on it.
    expect(result.itemOf).toEqual([null, 'ri_1', 'ri_2', 'ri_1', 'ri_2', null, null]);
    const [start, add1, , move1, , held, info] = result.changes as never[] as Array<Record<string, unknown> & { milestones: Array<{ day: number }> }>;
    expect(start).toMatchObject({ expectedStartDate: START, expectedHorizon: 0, startDate: HELD_ON, horizonDays: 90 });
    expect(start!.milestones.length).toBeGreaterThan(0);
    expect(start!.milestones.at(-1)).toMatchObject({ day: 90 });
    expect(add1).toMatchObject({
      values: { title: 'Do ri_1', side: 'us', ownerId: 'p_owner', dueDate: '2027-01-15', milestoneId: null, category: 'other', status: 'not_started' },
    });
    expect(move1).toMatchObject({ id: 'ri_1', patch: { moved: true } });
    expect(held).toMatchObject({ id: 'rv_test01', patch: { state: 'held', heldOn: HELD_ON } });
    expect(info).toEqual({ kind: 'updateInfo', patch: { nextReviewDate: null } });
  });

  it('keeps the targets as a snapshot before the held update: a new row per key without one, a stored target never replaced', () => {
    const typed = makeReviewNumber({ id: 'rn_typed', reviewId: 'rv_test01', key: 'dealsWon', target: 5, actual: 3 });
    const empty = makeReviewNumber({ id: 'rn_empty', reviewId: 'rv_test01', key: 'weBill', target: null, actual: 1000 });
    const other = makeReviewNumber({ id: 'rn_other', reviewId: 'rv_other', key: 'recommend', target: null });
    const plan = { ...base([]), reviewNumbers: [typed, empty, other] };
    const result = closeReviewChanges(plan, { ...input, targets: { dealsWon: 2.5, weBill: 24000, partnerEarns: null, recommend: 8 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const kinds = result.changes.map((c) => (c.kind === 'updateInfo' || c.kind === 'startHorizon' ? c.kind : `${c.kind}:${c.entity}`));
    expect(kinds).toEqual(['startHorizon', 'update:reviewNumber', 'add:reviewNumber', 'update:review', 'updateInfo']);
    expect(result.changes[1]).toEqual({ kind: 'update', entity: 'reviewNumber', id: 'rn_empty', patch: { target: 24000 } });
    expect(result.changes[2]).toEqual({ kind: 'add', entity: 'reviewNumber', values: { reviewId: 'rv_test01', key: 'recommend', target: 8 } });
  });

  it('writes no target rows without targets', () => {
    const result = closeReviewChanges(base([]), { ...input, targets: { dealsWon: null } });
    expect(result.ok && result.changes.some((c) => c.kind !== 'updateInfo' && c.kind !== 'startHorizon' && c.entity === 'reviewNumber')).toBe(false);
  });

  it('uses the review\'s next horizon length', () => {
    const result = closeReviewChanges(base([], makeReview({ nextHorizonDays: 60 })), input);
    expect(result.ok && result.changes[0]).toMatchObject({ kind: 'startHorizon', horizonDays: 60 });
  });

  it('refuses a next horizon length the MAP doesn’t offer (a hand edit of the sheet), with its field', () => {
    for (const nextHorizonDays of [7, 45, 365, 730]) {
      expect(closeReviewChanges(base([], makeReview({ nextHorizonDays })), input))
        .toEqual({ ok: false, fieldErrors: { nextHorizonDays: COPY.REVIEW_ERR_HORIZON_LENGTH } });
    }
  });

  it('skips a commitment already moved, and items of other reviews and kinds', () => {
    const items = [
      commitment('ri_1', { moved: true }), commitment('ri_2'),
      commitment('ri_other', { reviewId: 'rv_other', dueDate: null }), makeReviewItem({ id: 'ri_blocker', kind: 'blocker' }),
    ];
    const result = closeReviewChanges(base(items), input);
    expect(result.ok && result.changes.map((c) => c.kind)).toEqual(['startHorizon', 'add', 'update', 'update', 'updateInfo']);
  });

  it('refuses a held review: it says the review is already held', () => {
    const plan = base([], makeReview({ state: 'held', heldOn: START }));
    expect(closeReviewChanges(plan, input)).toEqual({ ok: false, fieldErrors: { reviewId: COPY.REVIEW_ERR_ALREADY_HELD } });
    // A held review of an earlier horizon says the same; any other refusal keeps its message.
    const later = withInfo(
      { pastHorizons: [{ startDate: '2026-01-01', horizonDays: 90, stage: 'onboarding' }] },
      { reviews: [makeReview({ state: 'held', heldOn: '2026-04-01' })] },
    );
    expect(closeReviewChanges(later, input)).toEqual({ ok: false, fieldErrors: { reviewId: COPY.REVIEW_ERR_ALREADY_HELD } });
    expect(closeReviewChanges(base(), { ...input, reviewId: 'rv_gone' })).toEqual({ ok: false, fieldErrors: { reviewId: COPY.REVIEW_ERR_CANT_CLOSE } });
  });
  it('refuses a review for an earlier horizon, and a review that is not there', () => {
    const plan = withInfo(
      { pastHorizons: [{ startDate: '2026-01-01', horizonDays: 90, stage: 'onboarding' }] },
      { reviews: [makeReview()], people: [owner] },
    );
    expect(closeReviewChanges(plan, input)).toMatchObject({ ok: false, fieldErrors: { reviewId: expect.any(String) } });
    expect(closeReviewChanges(base(), { ...input, reviewId: 'rv_gone' })).toMatchObject({ ok: false, fieldErrors: { reviewId: expect.any(String) } });
  });
  it('refuses when no review can be held now', () => {
    const plan = withInfo({ stage: 'exit' }, { reviews: [makeReview()] });
    expect(closeReviewChanges(plan, input)).toMatchObject({ ok: false, fieldErrors: { reviewId: expect.any(String) } });
  });
  it('refuses a commitment without a title, side or due date, keyed by item id', () => {
    const result = closeReviewChanges(base([commitment('ri_1', { dueDate: null }), commitment('ri_2', { title: ' ' }), commitment('ri_3', { side: null })]), input);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.fieldErrors).sort()).toEqual(['ri_1', 'ri_2', 'ri_3']);
  });
  it('refuses an owner who is not in the MAP\'s people', () => {
    const result = closeReviewChanges(base([commitment('ri_1', { ownerId: 'p_gone' })]), input);
    expect(result).toMatchObject({ ok: false, fieldErrors: { ri_1: expect.any(String) } });
  });
  it('leaves out a suggested milestone whose name the MAP has already, as Start next horizon does', () => {
    const suggested = horizonMilestones({ startDate: HELD_ON, horizonDays: 90, horizon: 2 });
    expect(suggested.length).toBeGreaterThan(1);
    const taken = suggested[0]!.name;
    const plan = { ...base([]), milestones: [makeMilestone({ id: 'm_taken', name: `  ${taken.toUpperCase()} ` })] };
    const result = closeReviewChanges(plan, input);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const start = result.changes[0] as { kind: string; milestones: Array<{ name: string }> };
    expect(start.milestones.map((m) => m.name)).toEqual(suggested.slice(1).map((m) => m.name));
  });
  describe('the closed horizon’s business review milestone', () => {
    const SECOND = { pastHorizons: [{ startDate: '2026-07-12', horizonDays: 90, stage: 'onboarding' as const }] };
    const secondHorizon = (milestones: ReturnType<typeof makeMilestone>[]) =>
      withInfo(SECOND, { people: [owner], reviews: [makeReview({ horizon: 2 })], milestones });
    const madeFor = (horizon: number) => horizonMilestones({ startDate: START, horizonDays: 90, horizon })
      .map((m, i) => makeMilestone({ id: `m_${horizon}_${i}`, name: m.name, targetDate: m.targetDate, criteria: m.criteria }));
    const milestoneUpdates = (changes: unknown[]) => (changes as Array<{ kind: string; entity?: string }>)
      .filter((c) => c.kind === 'update' && c.entity === 'milestone');

    it('is marked achieved on the held-on day, in the same batch before the held update; the other milestones stay', () => {
      const made = madeFor(2);
      const result = closeReviewChanges(secondHorizon(made), input);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const review = made.at(-1)!;
      expect(review.name).toBe('Horizon 2: Business review');
      expect(milestoneUpdates(result.changes)).toEqual([
        { kind: 'update', entity: 'milestone', id: review.id, patch: { achievedDate: HELD_ON } },
      ]);
      const kinds = result.changes.map((c) => (c.kind === 'updateInfo' || c.kind === 'startHorizon' ? c.kind : `${c.kind}:${c.entity}`));
      expect(kinds).toEqual(['startHorizon', 'update:milestone', 'update:review', 'updateInfo']);
      expect(result.itemOf).toEqual([null, null, null, null]);
    });

    it('is found by its name as the horizon’s milestones are made, in any case and spacing', () => {
      const plan = secondHorizon([makeMilestone({ id: 'm_review', name: '  horizon 2: BUSINESS review ' })]);
      const result = closeReviewChanges(plan, input);
      expect(result.ok && milestoneUpdates(result.changes)).toEqual([
        { kind: 'update', entity: 'milestone', id: 'm_review', patch: { achievedDate: HELD_ON } },
      ]);
    });

    it('in horizon 1 is the first business review the MAP suggests', () => {
      const first = suggestedMilestones(START).at(-1)!;
      expect(first.name).toBe('Day 90: First business review');
      const plan = makePlan({
        people: [owner], reviews: [makeReview()],
        milestones: [makeMilestone({ id: 'm_first', name: first.name }), makeMilestone({ id: 'm_day60', name: 'Day 60: First joint opportunity' })],
      });
      const result = closeReviewChanges(plan, input);
      expect(result.ok && milestoneUpdates(result.changes)).toEqual([
        { kind: 'update', entity: 'milestone', id: 'm_first', patch: { achievedDate: HELD_ON } },
      ]);
    });

    it('marks none when two milestones carry its name (a copy made in the sheet): the store would refuse the whole close', () => {
      const made = madeFor(2);
      const copy = makeMilestone({ id: 'm_copy', name: 'Horizon 2: business review ' });
      const result = closeReviewChanges(secondHorizon([...made, copy]), input);
      expect(result.ok).toBe(true);
      expect(result.ok && milestoneUpdates(result.changes)).toEqual([]);
    });

    it('leaves one achieved already, another horizon’s, and a MAP without it as they are', () => {
      const achieved = madeFor(2).map((m) => (m.name === 'Horizon 2: Business review' ? { ...m, achievedDate: '2026-12-01' } : m));
      const other = madeFor(1);
      for (const milestones of [achieved, other, []]) {
        const result = closeReviewChanges(secondHorizon(milestones), input);
        expect(result.ok && milestoneUpdates(result.changes)).toEqual([]);
      }
    });
  });

  it('refuses a commitment title longer than an activity title can be, keyed by item id', () => {
    const ok = closeReviewChanges(base([commitment('ri_1', { title: 'a'.repeat(300) })]), input);
    expect(ok.ok).toBe(true);
    const long = closeReviewChanges(base([commitment('ri_1', { title: 'a'.repeat(301) })]), input);
    expect(long).toEqual({ ok: false, fieldErrors: { ri_1: COPY.REVIEW_ERR_TITLE_LONG } });
  });
  it('refuses a heldOn after today or before the horizon start', () => {
    expect(closeReviewChanges(base(), { ...input, heldOn: '2026-12-22' })).toMatchObject({ ok: false, fieldErrors: { heldOn: expect.any(String) } });
    expect(closeReviewChanges(base(), { ...input, heldOn: '2026-10-09' })).toMatchObject({ ok: false, fieldErrors: { heldOn: expect.any(String) } });
  });
});

describe('stageSuggestion', () => {
  it('suggests growth when an Onboarding partnership closes horizon 1, and nothing else', () => {
    expect(stageSuggestion('onboarding', 1)).toBe('growth');
    expect(stageSuggestion('onboarding', 2)).toBeNull();
    expect(stageSuggestion('growth', 3)).toBeNull();
  });
});

describe('nearestHorizonLength', () => {
  it('is the offered length nearest to a horizon’s days, the longer one on a tie', () => {
    expect([7, 30, 44, 45, 46, 60, 75, 89, 90, 105, 150, 180, 365, 730].map(nearestHorizonLength))
      .toEqual([30, 30, 30, 60, 60, 60, 90, 90, 90, 120, 180, 180, 180, 180]);
  });
});

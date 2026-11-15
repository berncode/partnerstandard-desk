import { describe, expect, it } from 'vitest';
import { addDays } from '../maps/dates';
import { makeActivity, makeExitTrigger, makePlan, makeReview } from '../maps/test-builders';
import type { JoinedPlan } from '../maps/types';
import { anAccount, aPartner, sampleBook } from '../test-builders';
import { RECRUITMENT_WAITING_DAYS, thisWeek, type WeekMap } from './this-week';

// 2026-10-28 is a Wednesday: its week is Monday 2026-10-26 to Sunday 2026-11-01.
const TODAY = '2026-10-28';
const SUNDAY = '2026-11-01';

/** A signed plan whose first horizon starts `startDate` and runs 90 days (the review is on day 90). */
const planWith = (startDate: string, rest: Partial<JoinedPlan> = {}, info: Partial<JoinedPlan['info']> = {}): JoinedPlan => {
  const base = makePlan();
  return { ...base, ...rest, info: { ...base.info, startDate, ...info } };
};
/** A plan whose review is `days` from TODAY. */
const reviewIn = (days: number, rest: Partial<JoinedPlan> = {}) => planWith('2026-01-01', rest, { nextReviewDate: addDays(TODAY, days) });

const weekMap = (over: Partial<WeekMap> = {}): WeekMap => ({
  mapId: 'map_1', partnerId: 'p_abc123', displayName: 'Acme as reseller', plan: planWith('2026-10-10'),
  lastProgressAt: '2026-10-27T09:00:00.000Z', digestHealth: null, unreadable: false, ...over,
});
const run = (maps: WeekMap[], book = sampleBook(), stepMovedAt: Record<string, string> = {}, extra: { now?: string } = {}) =>
  thisWeek({ book, maps, stepMovedAt, today: TODAY, ...extra });

describe('thisWeek: reviews', () => {
  it('has a review 21 days out, not one 22 days out', () => {
    expect(run([weekMap({ plan: reviewIn(21) })]).reviews).toMatchObject([{ mapId: 'map_1', daysLeft: 21, daysLate: null, prep: false }]);
    expect(run([weekMap({ plan: reviewIn(22) })]).reviews).toEqual([]);
  });

  it('has an overdue review with daysLate, and soonest first', () => {
    const out = run([
      weekMap({ mapId: 'map_a', plan: reviewIn(5) }),
      weekMap({ mapId: 'map_b', plan: reviewIn(-3) }),
      weekMap({ mapId: 'map_c', plan: reviewIn(1) }),
    ]).reviews;
    expect(out.map((r) => r.mapId)).toEqual(['map_b', 'map_c', 'map_a']);
    expect(out[0]).toMatchObject({ daysLate: 3, daysLeft: null, date: addDays(TODAY, -3) });
  });

  it('marks a review whose prep is started', () => {
    const plan = reviewIn(10, { reviews: [makeReview({ id: 'rv_1', horizon: 1, state: 'prep' })] });
    expect(run([weekMap({ plan })]).reviews[0]!.prep).toBe(true);
  });

  it('leaves an exited partnership out of every section', () => {
    const exited = planWith('2026-01-01', {
      activities: [makeActivity({ side: 'us', dueDate: '2026-10-20' })],
      exitTriggers: [makeExitTrigger({ status: 'triggered' })],
    }, { stage: 'exit', nextReviewDate: addDays(TODAY, -3) });
    const out = run([weekMap({ plan: exited })], sampleBook({ partners: [] }));
    expect(out).toEqual({ reviews: [], needYou: [], due: [], waiting: [] });
  });

  it('leaves a partnership that is not signed out', () => {
    const unsigned = planWith('2026-10-10', { activities: [makeActivity({ side: 'us', dueDate: '2026-10-20' })] }, { stage: 'recruitment' });
    const out = run([weekMap({ plan: unsigned })]);
    expect(out.reviews).toEqual([]);
    expect(out.needYou).toEqual([]);
    expect(out.due).toEqual([]);
  });

  const NOW = '2026-10-28T12:00:00.000Z';
  const ago = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString();
  /** A plan whose horizon 1 was held with `updatedAt`, and whose next review is `nextIn` days out. */
  const closed = (nextIn: number, over: Partial<ReturnType<typeof makeReview>> = {}) => planWith('2026-10-26', {
    reviews: [makeReview({ id: 'rv_1', horizon: 1, state: 'held', heldOn: '2026-10-26', updatedAt: ago(49), ...over })],
  }, { nextReviewDate: addDays(TODAY, nextIn), pastHorizons: [{ startDate: '2026-07-01', horizonDays: 90, stage: 'onboarding' }] });

  it.each([60, 90])('gives an unsent summary its own line 49 hours after closing, with the next review %i days out', (nextIn) => {
    const out = run([weekMap({ plan: closed(nextIn) })], sampleBook(), {}, { now: NOW }).reviews;
    expect(out).toEqual([{
      mapId: 'map_1', displayName: 'Acme as reseller', date: '2026-10-26', daysLeft: null, daysLate: null, prep: false,
      summaryUnsent: true, heldReviewId: 'rv_1',
    }]);
  });

  it('gives no line 47 hours after closing, nor once the summary is sent', () => {
    expect(run([weekMap({ plan: closed(60, { updatedAt: ago(47) }) })], sampleBook(), {}, { now: NOW }).reviews).toEqual([]);
    expect(run([weekMap({ plan: closed(60, { summarySentAt: '2026-10-27T10:00:00.000Z' }) })], sampleBook(), {}, { now: NOW }).reviews).toEqual([]);
  });

  it('gives one line with both when a review is coming and a summary is unsent', () => {
    const out = run([weekMap({ plan: closed(3) })], sampleBook(), {}, { now: NOW }).reviews;
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ daysLeft: 3, summaryUnsent: true, heldReviewId: 'rv_1' });
  });

  it('counts days when it knows no time', () => {
    const base = (over: Partial<ReturnType<typeof makeReview>>) => closed(60, { updatedAt: null, ...over });
    expect(run([weekMap({ plan: base({}) })]).reviews[0]!.summaryUnsent).toBe(true);
    expect(run([weekMap({ plan: base({ heldOn: '2026-10-27' }) })]).reviews).toEqual([]);
  });
});

describe('thisWeek: due', () => {
  const due = (activities: ReturnType<typeof makeActivity>[]) =>
    run([weekMap({ plan: planWith('2026-10-10', { activities }) })]).due;

  it('has our and joint activities, not the partner side', () => {
    const out = due([
      makeActivity({ id: 'a_us', side: 'us', dueDate: '2026-10-29' }),
      makeActivity({ id: 'a_joint', side: 'joint', dueDate: '2026-10-30' }),
      makeActivity({ id: 'a_partner', side: 'partner', dueDate: '2026-10-29' }),
    ]);
    expect(out[0]!.activities.map((a) => a.activity.id)).toEqual(['a_us', 'a_joint']);
  });

  it('has an activity due Sunday but not next Monday', () => {
    const out = due([
      makeActivity({ id: 'a_sun', side: 'us', dueDate: SUNDAY }),
      makeActivity({ id: 'a_mon', side: 'us', dueDate: addDays(SUNDAY, 1) }),
    ]);
    expect(out[0]!.activities.map((a) => a.activity.id)).toEqual(['a_sun']);
  });

  it('has an activity overdue by 3 days with overdueDays 3, and skips done ones', () => {
    const out = due([
      makeActivity({ id: 'a_late', side: 'us', dueDate: '2026-10-25' }),
      makeActivity({ id: 'a_done', side: 'us', dueDate: '2026-10-20', status: 'done' }),
      makeActivity({ id: 'a_none', side: 'us', dueDate: null }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.activities).toMatchObject([{ overdueDays: 3 }]);
  });

  it('orders groups by the earliest overdue', () => {
    const out = run([
      weekMap({ mapId: 'map_a', plan: planWith('2026-10-10', { activities: [makeActivity({ side: 'us', dueDate: '2026-10-27' })] }) }),
      weekMap({ mapId: 'map_b', plan: planWith('2026-10-10', { activities: [makeActivity({ side: 'us', dueDate: '2026-10-10' })] }) }),
      weekMap({ mapId: 'map_c', plan: planWith('2026-10-10', { activities: [makeActivity({ side: 'us', dueDate: '2026-10-29' })] }) }),
    ]).due;
    expect(out.map((g) => g.mapId)).toEqual(['map_b', 'map_a', 'map_c']);
  });
});

describe('thisWeek: need you', () => {
  it('lists health reasons, off track first', () => {
    const atRisk = planWith('2026-10-10', { activities: [makeActivity({ id: 'a_1', side: 'partner', dueDate: '2026-10-15' })] });
    const offTrack = planWith('2026-10-10', { activities: [makeActivity({ id: 'a_2', side: 'us', dueDate: '2026-10-29' })], exitTriggers: [makeExitTrigger({ id: 'x_1', status: 'triggered', condition: 'No deals' })] });
    const out = run([weekMap({ mapId: 'map_a', plan: atRisk }), weekMap({ mapId: 'map_b', plan: offTrack })]).needYou;
    expect(out.map((n) => n.mapId)).toEqual(['map_b', 'map_a']);
    expect(out[0]!.reasons).toContainEqual({ kind: 'exitTrigger', status: 'triggered', condition: 'No deals' });
    expect(out[1]!.reasons).toContainEqual({
      kind: 'health', health: 'at_risk', reason: { kind: 'overdue', activityId: 'a_1', days: 13 },
    });
  });

  it('leaves a healthy partnership out', () => {
    const plan = planWith('2026-10-10', { activities: [makeActivity({ side: 'us', dueDate: '2026-10-29' })] });
    expect(run([weekMap({ plan })]).needYou).toEqual([]);
  });

  it('gives a healthChanged reason from the digest health, and none with no digest health', () => {
    const plan = planWith('2026-10-10', { activities: [makeActivity({ id: 'a_1', side: 'partner', dueDate: '2026-10-15' })] });
    const changed = run([weekMap({ plan, digestHealth: 'on_track' })]).needYou[0]!;
    expect(changed.reasons).toContainEqual({ kind: 'healthChanged', from: 'on_track', to: 'at_risk' });
    const unknown = run([weekMap({ plan, digestHealth: null })]).needYou[0]!;
    expect(unknown.reasons.some((r) => r.kind === 'healthChanged')).toBe(false);
  });

  it('lists an unreadable MAP with no reasons', () => {
    const out = run([weekMap({ unreadable: true })]).needYou;
    expect(out).toEqual([{ mapId: 'map_1', displayName: 'Acme as reseller', reasons: [] }]);
  });
});

describe('thisWeek: waiting', () => {
  const book = (over: Partial<ReturnType<typeof aPartner>>, updatedAt = '2026-01-01T00:00:00.000Z') =>
    sampleBook({ partners: [aPartner({ id: 'p_1', accountId: 'a_abc123', updatedAt, ...over })], accounts: [anAccount({ id: 'a_abc123', company: 'Acme' })] });
  const moved = (days: number) => `${addDays(TODAY, -days)}T08:00:00.000Z`;

  it('waits at 14 days since the step moved, not at 13', () => {
    expect(RECRUITMENT_WAITING_DAYS).toBe(14);
    const wait = run([], book({ step: 'researched' }), { p_1: moved(14) }).waiting;
    expect(wait).toMatchObject([{ partnerId: 'p_1', name: 'Acme', reason: 'stalled', days: 14 }]);
    expect(run([], book({ step: 'researched' }), { p_1: moved(13) }).waiting).toEqual([]);
  });

  it('counts from the last update when no step event is known', () => {
    expect(run([], book({}, moved(20))).waiting).toMatchObject([{ reason: 'stalled', days: 20 }]);
  });

  it('waits at the MAP step with the MAP not agreed, however recent', () => {
    const out = run([], book({ step: 'map', mapFilled: false }), { p_1: moved(2) }).waiting;
    expect(out).toMatchObject([{ reason: 'mapNotAgreed', days: 2 }]);
    expect(run([], book({ step: 'map', mapFilled: true }), { p_1: moved(2) }).waiting).toEqual([]);
  });

  it('leaves out closed, signed and later-stage partners, and sorts by days', () => {
    const b = sampleBook({
      accounts: [anAccount({ id: 'a_abc123', company: 'Acme' })],
      partners: [
        aPartner({ id: 'p_old', accountId: 'a_abc123', partnerType: 'reseller' }),
        aPartner({ id: 'p_older', accountId: 'a_abc123', partnerType: 'referral' }),
        aPartner({ id: 'p_closed', accountId: 'a_abc123', partnerType: 'technology', closed: 'no' }),
        aPartner({ id: 'p_signed', accountId: 'a_abc123', partnerType: 'integration', stage: 'onboarding', signedDate: '2026-09-01' }),
      ],
    });
    const stepMovedAt = { p_old: moved(15), p_older: moved(40), p_closed: moved(50), p_signed: moved(50) };
    expect(run([], b, stepMovedAt).waiting.map((w) => w.partnerId)).toEqual(['p_older', 'p_old']);
  });
});

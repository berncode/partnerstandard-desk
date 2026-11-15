// Review rules (spec 5.1, 5.3): when a review is due, which work belongs to a horizon, and the MAP changes that
// closing a review produces. Pure: no I/O. The command (task 6) applies the changes.
import { horizonMilestones, suggestedMilestones, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { IsoDate } from '../partners/types';
import type { ScoreTargets } from './scorecard';
import type { MapReview, ReviewNumber, ScoreKey } from './types';
import type { Milestone } from '../maps/types';
import { daysBetween, horizonDayDate } from '../maps/dates';
import type { MapChange } from '../maps/changes';
import { ACTIVITY_TITLE_MAX } from '../maps/schemas';
import { normalizeName } from '../maps/validate';
import { afterExit, endedWithoutSigning, HORIZON_LENGTHS, type Activity, type JoinedPlan, type PlanInfo } from '../maps/types';

/**
 * The length "Start next horizon" offers that is nearest to `days`, the longer one on a tie: a review's default next
 * horizon when the current one runs a length the MAP no longer offers (45 days gives 60, 365 gives 180).
 */
export function nearestHorizonLength(days: number): number {
  let best: number = HORIZON_LENGTHS[0];
  for (const length of HORIZON_LENGTHS) if (Math.abs(length - days) <= Math.abs(best - days)) best = length;
  return best;
}

const isOfferedLength = (days: number): boolean => (HORIZON_LENGTHS as readonly number[]).includes(days);

/** A review shows as coming up this many days before its date. */
export const REVIEW_COMING_DAYS = 21;

/** The horizon the partnership is in, 1-based: the horizon a review closes. */
export const currentHorizon = (info: PlanInfo): number => info.pastHorizons.length + 1;

/**
 * The date of the next review: null before signing (an unsigned plan is in recruitment), after a recruitment ended
 * without signing and after the exit; else the stored date, or the horizon's last day.
 */
export function reviewDateOf(info: PlanInfo): IsoDate | null {
  if (info.stage === 'recruitment' || endedWithoutSigning(info) || afterExit(info)) return null;
  return info.nextReviewDate ?? horizonDayDate(info.startDate, info.horizonDays);
}

export type ReviewStatus =
  | { kind: 'none' }
  | { kind: 'later'; date: IsoDate }
  | { kind: 'coming'; date: IsoDate; daysLeft: number; prepId: string | null }
  | { kind: 'overdue'; date: IsoDate; daysLate: number; prepId: string | null };

/** The prep review of the current horizon, if there is one. */
export const prepOf = (plan: JoinedPlan): MapReview | null =>
  plan.reviews.find((r) => r.state === 'prep' && r.horizon === currentHorizon(plan.info)) ?? null;

export function reviewStatus(plan: JoinedPlan, today: IsoDate): ReviewStatus {
  const date = reviewDateOf(plan.info);
  if (date === null) return { kind: 'none' };
  const prepId = prepOf(plan)?.id ?? null;
  const daysLeft = daysBetween(today, date);
  if (daysLeft < 0) return { kind: 'overdue', date, daysLate: -daysLeft, prepId };
  if (daysLeft <= REVIEW_COMING_DAYS) return { kind: 'coming', date, daysLeft, prepId };
  return { kind: 'later', date };
}

/** Activities due from the horizon's start to `until`, plus open ones due before the start. "Not applicable" is left out. */
export function horizonWork(plan: JoinedPlan, until: IsoDate): Activity[] {
  const start = plan.info.startDate;
  return plan.activities.filter((a) => {
    if (a.status === 'na' || a.dueDate === null) return false;
    if (a.dueDate < start) return a.status !== 'done';
    return a.dueDate <= until;
  });
}

export interface CloseInput {
  reviewId: string;
  heldOn: IsoDate;
  /** The owner's today: a pure function can't read a clock, and a review can't be held in the future. */
  today: IsoDate;
  /**
   * The targets the review is checked against, as the review page shows them (`targetsFor`): kept on its number rows
   * when it closes, so a held review's targets never move with a case changed later (spec 5.3 point 5, 5.5). A key
   * with a target stored already keeps it; a null target writes nothing.
   */
  targets?: ScoreTargets;
}

/**
 * `itemOf` runs alongside `changes`: the commitment a change comes from (its activity, its "moved" mark), else null. A
 * store that refuses one change of the batch says which (`valid`), so the refusal can be shown on its commitment.
 */
export type CloseResult =
  | { ok: true; changes: MapChange[]; itemOf: Array<string | null> }
  | { ok: false; fieldErrors: Record<string, string> };

/**
 * The MAP changes that closing a review makes, in the order to apply them: start the next horizon, turn each
 * commitment into an activity, mark them moved, keep the targets on the number rows, mark the closed horizon's business
 * review milestone achieved, mark the review held, and reset the review date. Closing never moves the stage (spec 5.3).
 */
export function closeReviewChanges(plan: JoinedPlan, input: CloseInput): CloseResult {
  const { info } = plan;
  const review = plan.reviews.find((r) => r.id === input.reviewId);
  // A second close (a double click, a retry, a stale tab) says what happened; any other refusal says it can't now.
  if (review?.state === 'held') return { ok: false, fieldErrors: { reviewId: COPY.REVIEW_ERR_ALREADY_HELD } };
  if (!review || review.state !== 'prep' || review.horizon !== currentHorizon(info) || reviewDateOf(info) === null) {
    return { ok: false, fieldErrors: { reviewId: COPY.REVIEW_ERR_CANT_CLOSE } };
  }
  const fieldErrors: Record<string, string> = {};
  if (input.heldOn > input.today) fieldErrors.heldOn = COPY.REVIEW_ERR_HELD_FUTURE;
  else if (input.heldOn < info.startDate) fieldErrors.heldOn = COPY.REVIEW_ERR_HELD_BEFORE_START;
  // The next horizon starts with a length the MAP offers, as "Start next horizon" does; a hand edit can type another.
  if (!isOfferedLength(review.nextHorizonDays)) fieldErrors.nextHorizonDays = COPY.REVIEW_ERR_HORIZON_LENGTH;

  const commitments = plan.reviewItems.filter((i) => i.kind === 'commitment' && i.reviewId === review.id && !i.moved);
  const people = new Set(plan.people.map((p) => p.id));
  for (const item of commitments) {
    if (item.title.trim() === '') fieldErrors[item.id] = COPY.REVIEW_ERR_NEEDS_TITLE;
    else if (item.title.trim().length > ACTIVITY_TITLE_MAX) fieldErrors[item.id] = COPY.REVIEW_ERR_TITLE_LONG;
    else if (item.side === null) fieldErrors[item.id] = COPY.REVIEW_ERR_NEEDS_SIDE;
    else if (item.dueDate === null) fieldErrors[item.id] = COPY.REVIEW_ERR_NEEDS_DUE;
    else if (item.ownerId !== null && !people.has(item.ownerId)) fieldErrors[item.id] = COPY.REVIEW_ERR_OWNER_GONE;
  }
  if (Object.keys(fieldErrors).length > 0) return { ok: false, fieldErrors };

  // The targets' snapshot: a row without a target gets it, a key without a row gets one.
  const numbers = plan.reviewNumbers.filter((n) => n.reviewId === review.id);
  const snapshot: MapChange[] = [];
  for (const [key, target] of Object.entries(input.targets ?? {}) as Array<[ScoreKey, number | null | undefined]>) {
    if (target === null || target === undefined) continue;
    const row: ReviewNumber | undefined = numbers.find((n) => n.key === key);
    if (!row) snapshot.push({ kind: 'add', entity: 'reviewNumber', values: { reviewId: review.id, key, target } });
    else if (row.target === null) snapshot.push({ kind: 'update', entity: 'reviewNumber', id: row.id, patch: { target } });
  }

  const horizonDays = review.nextHorizonDays;
  // A suggested milestone whose name the MAP has already is left out, as "Start next horizon" leaves it out: the MAP
  // keeps milestones by name, so the store would refuse the whole close.
  const taken = new Set(plan.milestones.map((m) => normalizeName(m.name)));
  const milestones = horizonMilestones({ startDate: input.heldOn, horizonDays, horizon: currentHorizon(info) + 1 })
    .filter((m) => !taken.has(normalizeName(m.name)))
    .map(({ name, criteria, day }) => ({ name, criteria, day }));
  const changes: MapChange[] = [
    {
      kind: 'startHorizon', expectedStartDate: info.startDate, expectedHorizon: info.pastHorizons.length,
      startDate: input.heldOn, horizonDays, milestones,
    },
    ...commitments.map((i): MapChange => ({
      kind: 'add', entity: 'activity',
      values: {
        title: i.title, side: i.side, ownerId: i.ownerId, dueDate: i.dueDate, milestoneId: i.milestoneId,
        category: 'other', status: 'not_started',
      },
    })),
    ...commitments.map((i): MapChange => ({ kind: 'update', entity: 'reviewItem', id: i.id, patch: { moved: true } })),
    ...snapshot,
    ...businessReviewAchieved(plan, review.horizon, input.heldOn),
    { kind: 'update', entity: 'review', id: review.id, patch: { state: 'held', heldOn: input.heldOn } },
    { kind: 'updateInfo', patch: { nextReviewDate: null } },
  ];
  const ids = commitments.map((i) => i.id);
  const itemOf = [null, ...ids, ...ids, ...changes.slice(1 + 2 * ids.length).map(() => null)];
  return { ok: true, changes, itemOf };
}

/**
 * The closed horizon's business review milestone, marked achieved on the day the review was held: the review is that
 * milestone [builder's call, walkthrough 2026-11-01]. Found by its name as the MAP makes it: horizon 1's is the last
 * of the first horizon's suggestions ("Day 90: First business review"), a later horizon's the last of the ones it starts
 * with ("Horizon 2: Business review"). One achieved already, renamed, deleted or there twice is left as it is, and so is every other
 * milestone of the horizon: people decide whether those were reached.
 */
function businessReviewAchieved(plan: JoinedPlan, horizon: number, heldOn: IsoDate): MapChange[] {
  const { startDate, horizonDays } = plan.info;
  const made = horizon === 1 ? suggestedMilestones(startDate) : horizonMilestones({ startDate, horizonDays, horizon });
  const name = normalizeName(made.at(-1)!.name);
  const named: Milestone[] = plan.milestones.filter((m) => normalizeName(m.name) === name);
  // Two rows of that name (a copy made by hand in the sheet): the store refuses an update to either, which would refuse
  // the whole close, and which one is the review isn't known. Neither is marked; the person marks one.
  if (named.length !== 1) return [];
  const milestone = named[0]!;
  if (milestone.achievedDate !== null) return [];
  return [{ kind: 'update', entity: 'milestone', id: milestone.id, patch: { achievedDate: heldOn } }];
}

/** The stage a person may be offered after a review: Growth when an Onboarding partnership closes horizon 1. */
export function stageSuggestion(stage: Stage, horizon: number): Stage | null {
  return stage === 'onboarding' && horizon === 1 ? 'growth' : null;
}

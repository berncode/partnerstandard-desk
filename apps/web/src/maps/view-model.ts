// The plan screens' rules: horizonProgress, reviewDue, the status cycle, grouping, filters, due dates, people, describeReason,
// summarizePlan and sortByAttention, on the joined plan and in COPY's words. A card names its MAP "Acme as reseller", as the
// directory lists it. Pure: no React, no I/O.
import {
  daysBetween, daysOverdue, endedWithoutSigning, horizonDayDate, isOpen, milestoneStatus, nextMapMilestone, summarizeMap,
  type Activity, type ActivitySide, type ActivityStatus, type Health, type HealthReason, type IsoDate, type IsoDateTime, type JoinedPlan,
  type MapHealth, type MapPerson, type Milestone, type MilestoneStatus, type PlanInfo, type Side,
} from '@partner-desk/core';
import { type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { formatMapDate, relativeDay } from './format';

type Plan = JoinedPlan;

export interface HorizonProgress {
  phase: 'recruitment' | 'upcoming' | 'running' | 'ended';
  /** Which horizon this is: 1 for the first. */
  horizon: number;
  day: number;
  total: number;
  /** 0 to 1, for the progress bar. */
  ratio: number;
  endDate: IsoDate;
  label: string;
}

export function horizonProgress(info: PlanInfo, today: IsoDate): HorizonProgress {
  const total = info.horizonDays;
  const horizon = info.pastHorizons.length + 1;
  const endDate = horizonDayDate(info.startDate, total);
  const base = { horizon, total, endDate };
  if (info.stage === 'recruitment') {
    return { ...base, phase: 'recruitment', day: 0, ratio: 0, label: endedWithoutSigning(info) ? COPY.MAP_ENDED_WITHOUT_SIGNING : COPY.MAP_BEFORE_SIGNING_LABEL };
  }
  const elapsed = daysBetween(info.startDate, today);
  if (elapsed < 0) return { ...base, phase: 'upcoming', day: 0, ratio: 0, label: COPY.MAP_HORIZON_STARTS_IN(horizon, -elapsed) };
  const day = elapsed + 1;
  if (day > total) return { ...base, phase: 'ended', day, ratio: 1, label: COPY.MAP_HORIZON_ENDED(day - total) };
  return { ...base, phase: 'running', day, ratio: day / total, label: COPY.MAP_HORIZON_DAY(horizon, day, total) };
}

/** The current horizon and its days left, as the partner's MAP area says it: "Horizon 1 · 62 days left". */
export function horizonLeft(progress: HorizonProgress): string {
  return progress.phase === 'running' ? COPY.MAP_HORIZON_DAYS_LEFT(progress.horizon, progress.total - progress.day + 1) : progress.label;
}

/** How many days before a horizon ends its business review is suggested. */
export const REVIEW_WINDOW_DAYS = 14;

/** The horizon is in its last 14 days or has ended, so its business review is due. Never at exit, nor before signing. */
export function reviewDue(info: PlanInfo, today: IsoDate): boolean {
  if (info.stage === 'exit' || info.stage === 'recruitment') return false;
  const elapsed = daysBetween(info.startDate, today);
  return elapsed >= 0 && elapsed >= info.horizonDays - REVIEW_WINDOW_DAYS;
}

/** One click moves along the common path; Blocked and N/A are picked from the menu. */
export const STATUS_CYCLE: Record<ActivityStatus, ActivityStatus> = {
  not_started: 'in_progress',
  in_progress: 'done',
  done: 'not_started',
  blocked: 'in_progress',
  na: 'not_started',
};

export const nextStatus = (status: ActivityStatus): ActivityStatus => STATUS_CYCLE[status];

const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function byDateThenText<T>(date: (t: T) => IsoDate | null, text: (t: T) => string) {
  return (a: T, b: T) => {
    const da = date(a);
    const db = date(b);
    if (da !== db) {
      if (da === null) return 1;
      if (db === null) return -1;
      return compareText(da, db);
    }
    return compareText(text(a), text(b));
  };
}

export const sortMilestones = (milestones: Milestone[]) => [...milestones].sort(byDateThenText((m) => m.targetDate, (m) => m.name));

export const sortActivities = (activities: Activity[]) => [...activities].sort(byDateThenText((a) => a.dueDate, (a) => a.title));

export interface ActivityGroup {
  /** Milestone id, or 'unscheduled'. */
  key: string;
  milestone: Milestone | null;
  status: MilestoneStatus | null;
  activities: Activity[];
}

/** Every milestone gets a group (even when empty, so activities can be added to it); unscheduled comes last. */
export function groupActivities(plan: Plan, activities: Activity[], today: IsoDate): ActivityGroup[] {
  const known = new Set(plan.milestones.map((m) => m.id));
  const groups: ActivityGroup[] = sortMilestones(plan.milestones).map((milestone) => ({
    key: milestone.id,
    milestone,
    status: milestoneStatus(milestone, today, plan.info.stage),
    activities: sortActivities(activities.filter((a) => a.milestoneId === milestone.id)),
  }));
  groups.push({
    key: 'unscheduled',
    milestone: null,
    status: null,
    activities: sortActivities(activities.filter((a) => a.milestoneId === null || !known.has(a.milestoneId))),
  });
  return groups;
}

export interface ActivityFilters {
  side: ActivitySide | 'all';
  /** A person id, 'all', or 'none' (no owner). */
  ownerId: string;
  status: ActivityStatus | 'open' | 'all';
}

export const DEFAULT_FILTERS: ActivityFilters = { side: 'all', ownerId: 'all', status: 'all' };

/** The activities the filters match, plus any id in `keep` (a just-added activity stays in view). */
export function filterActivities(list: Activity[], f: ActivityFilters, keep: ReadonlySet<string> = new Set()): Activity[] {
  return list.filter(
    (a) =>
      keep.has(a.id) || (
        (f.side === 'all' || a.side === f.side) &&
        (f.ownerId === 'all' || (f.ownerId === 'none' ? a.ownerId === null : a.ownerId === f.ownerId)) &&
        (f.status === 'all' || (f.status === 'open' ? isOpen(a) : a.status === f.status))
      ),
  );
}

export const isFiltered = (f: ActivityFilters) => f.side !== 'all' || f.ownerId !== 'all' || f.status !== 'all';

export type DueTone = 'none' | 'done' | 'overdue' | 'soon' | 'later';

export function dueState(activity: Activity, today: IsoDate): { tone: DueTone; label: string } {
  if (activity.dueDate === null) return { tone: 'none', label: COPY.MAP_NO_DATE };
  if (!isOpen(activity)) return { tone: 'done', label: formatMapDate(activity.dueDate, today) };
  const overdue = daysOverdue(activity, today);
  if (overdue > 0) return { tone: 'overdue', label: COPY.MAP_DAYS_OVERDUE(overdue) };
  const until = daysBetween(today, activity.dueDate);
  return until <= 7
    ? { tone: 'soon', label: relativeDay(activity.dueDate, today) }
    : { tone: 'later', label: formatMapDate(activity.dueDate, today) };
}

export const peopleOnSide = (plan: Pick<Plan, 'people'>, side: Side): MapPerson[] => plan.people.filter((p) => p.side === side);

/** People who may own an activity on `side`: that side's people, or everyone for joint activities. */
export const eligibleOwners = (plan: Pick<Plan, 'people'>, side: ActivitySide): MapPerson[] =>
  side === 'joint' ? plan.people : peopleOnSide(plan, side);

export const personName = (plan: Pick<Plan, 'people'>, id: string | null): string | null =>
  id === null ? null : (plan.people.find((p) => p.id === id)?.name ?? null);

/** Why a MAP is at risk or off track, in a sentence. */
export function describeReason(plan: Plan, reason: HealthReason): string {
  switch (reason.kind) {
    case 'stalled':
      return COPY.MAP_REASON_STALLED(reason.days);
    case 'overdue':
      return COPY.MAP_REASON_OVERDUE(plan.activities.find((a) => a.id === reason.activityId)?.title ?? COPY.MAP_AN_ACTIVITY, reason.days);
    case 'milestone_missed':
      return COPY.MAP_REASON_MISSED(plan.milestones.find((m) => m.id === reason.milestoneId)?.name ?? COPY.MAP_A_MILESTONE);
    case 'exit_trigger': {
      const condition = plan.exitTriggers.find((x) => x.id === reason.exitTriggerId)?.condition ?? COPY.MAP_AN_EXIT_TRIGGER;
      return reason.status === 'triggered' ? COPY.MAP_REASON_TRIGGERED(condition) : COPY.MAP_REASON_WATCH(condition);
    }
  }
}

/** What the Plans page's card and the partner's MAP area show of a MAP. */
export interface PlanCard {
  mapId: string;
  /** "Acme as reseller", as the directory lists it. */
  displayName: string;
  stage: Stage;
  /** The recruitment ended without signing: the card shows "Not signed" in place of the health. */
  ended: boolean;
  /**
   * Core's `summarizeMap` (ruling R6): null once the recruitment ended without signing, `empty` while the MAP has no
   * activity and no milestone ("Nothing planned yet", owner 2026-10-31).
   */
  health: MapHealth | null;
  reasons: HealthReason[];
  progress: HorizonProgress;
  /** Core's `nextMapMilestone`: the one the partner row keeps the date of. */
  nextMilestone: { name: string; targetDate: IsoDate | null } | null;
  overdueCount: number;
  /** Earliest due date among open activities. */
  nextDue: IsoDate | null;
  /** Date of the most recent change, in the sheet or through the app. */
  lastActivityAt: IsoDate | null;
}

/**
 * `lastEventAt`: the MAP's one "last progress" (the commands' `lastProgressAt`, ruling R6). Health and the next
 * milestone are core's `summarizeMap`, the rules the partner row's copy is written with.
 */
export function summarizePlan(
  mapId: string, displayName: string, plan: Plan, today: IsoDate, lastEventAt: IsoDateTime | null = null,
): PlanCard {
  const { health, reasons } = summarizeMap(plan, today, lastEventAt);
  const open = plan.activities.filter(isOpen);
  const dues = open.map((a) => a.dueDate).filter((d): d is IsoDate => d !== null).sort();
  const updates = plan.activities.map((a) => a.updatedAt).filter((d): d is string => d !== null).sort();
  const latest = updates.at(-1) ?? null;
  const milestone = nextMapMilestone(plan, today);
  return {
    mapId,
    displayName,
    stage: plan.info.stage,
    ended: endedWithoutSigning(plan.info),
    health,
    reasons,
    progress: horizonProgress(plan.info, today),
    nextMilestone: milestone ? { name: milestone.name, targetDate: milestone.targetDate } : null,
    overdueCount: open.filter((a) => daysOverdue(a, today) > 0).length,
    nextDue: dues[0] ?? null,
    lastActivityAt: latest ? latest.slice(0, 10) : null,
  };
}

const rank = (health: MapHealth | null): number => (health === null ? 4 : { off_track: 0, at_risk: 1, on_track: 2, empty: 3 }[health]);

/**
 * What needs attention first: off track, at risk, on track, nothing planned yet, then not signed; then the earliest
 * due date; then the name.
 */
export function sortByAttention(cards: PlanCard[]): PlanCard[] {
  return [...cards].sort((a, b) => {
    if (a.health !== b.health) return rank(a.health) - rank(b.health);
    if (a.nextDue !== b.nextDue) {
      if (a.nextDue === null) return 1;
      if (b.nextDue === null) return -1;
      return compareText(a.nextDue, b.nextDue);
    }
    return compareText(a.displayName, b.displayName);
  });
}

/** A MAP as `readMap` gives it: its card, counting progress from its one "last progress" (ruling R6). */
export function cardOf(
  item: { mapId: string; displayName: string }, read: { value: Omit<Plan, 'info'>; info: PlanInfo; lastProgressAt: IsoDateTime }, today: IsoDate,
): PlanCard {
  return summarizePlan(item.mapId, item.displayName, { ...read.value, info: read.info }, today, read.lastProgressAt);
}

/**
 * Whether a MAP that couldn't be read is offered Delete (spec 8): always, unless Google's sign-in is what broke. Then
 * its file can't be moved to the trash, and Reconnect is the way out.
 */
export const mayDeleteAfter = (error: string): boolean => error !== 'auth';

/**
 * What a partner type's Mutual Action Plan area shows: no MAP, the MAP as read now, or (when it couldn't be read)
 * what the partner record last kept of it and why. `plannedStart` is what signing moves its open dates from.
 */
export type MapAreaState =
  | { kind: 'none' }
  | { kind: 'ready'; mapId: string; plannedStart: IsoDate; today: IsoDate; card: PlanCard }
  | {
    kind: 'unread'; mapId: string; displayName: string; plannedStart: IsoDate; today: IsoDate; health: Health | null; nextMilestone: IsoDate | null;
    message: string;
    /** Offered Delete (`mayDeleteAfter`). */
    deletable: boolean;
  };

// On the joined plan (`Plan` is `JoinedPlan`).
import { horizonMilestones, suggestedMilestones, type Stage } from '@partner-desk/method';
import type { IsoDate, IsoDateTime } from '../partners/types';
import { daysBetween } from './dates';
import { normalizeName } from './validate';
import { endedWithoutSigning, type Activity, type JoinedPlan as Plan, type Milestone } from './types';

export const OVERDUE_AT_RISK_DAYS = 7;
export const STALL_AT_RISK_DAYS = 14;
export const STALL_OFF_TRACK_DAYS = 30;

export type MilestoneStatus = 'achieved' | 'missed' | 'upcoming';
/** A MAP's health, as the partner row, the dropdown and the scheduled job keep it. */
export type Health = 'on_track' | 'at_risk' | 'off_track';
/**
 * What a MAP shows for its health: a health, or `empty` while it has nothing to manage yet (`isEmptyMap`, owner
 * 2026-10-31). An empty MAP has no health: screens say "Nothing planned yet", and the partner row keeps none.
 */
export type MapHealth = Health | 'empty';
export type HealthReason =
  | { kind: 'stalled'; days: number }
  | { kind: 'overdue'; activityId: string; days: number }
  | { kind: 'milestone_missed'; milestoneId: string }
  | { kind: 'exit_trigger'; exitTriggerId: string; status: 'watch' | 'triggered' };
export interface HealthResult {
  health: MapHealth;
  reasons: HealthReason[];
}

/**
 * A milestone of a horizon that is over: it belongs to that horizon, so it is neither the MAP's next milestone nor
 * missed against its health once a later horizon runs. Found by name. For each earlier horizon from 2 up it is any
 * milestone `horizonMilestones` makes ("Horizon 2: Day 30 check-in", "Horizon 2: Business review"). For horizon 1 it is
 * only the business review, the last of `suggestedMilestones` ("Day 90: First business review", the one closing a review
 * marks achieved); its other suggestions are real goals and keep counting, as do hand-named milestones. Nothing is
 * changed or deleted: people can still mark or delete it themselves. [builder's call, 2026-11-01]
 */
export function isClosedHorizonMilestone(milestone: Milestone, info: Pick<Plan['info'], 'pastHorizons'>): boolean {
  const name = normalizeName(milestone.name);
  return info.pastHorizons.some((past, i) => {
    if (i === 0) return normalizeName(suggestedMilestones(past.startDate).at(-1)!.name) === name;
    return horizonMilestones({ startDate: past.startDate, horizonDays: past.horizonDays, horizon: i + 1 }).some((m) => normalizeName(m.name) === name);
  });
}

/** In recruitment (`stage`) no horizon runs yet: target dates are planned, not due, so nothing is missed before signing. */
export function milestoneStatus(milestone: Milestone, today: IsoDate, stage?: Stage): MilestoneStatus {
  if (milestone.achievedDate) return 'achieved';
  if (stage !== 'recruitment' && milestone.targetDate && milestone.targetDate < today) return 'missed';
  return 'upcoming';
}

/**
 * A MAP with no activity and no milestone has nothing to manage yet, so it has no health (owner, 2026-10-31).
 * Objectives, people and exit triggers alone don't change that. One activity or milestone gives it a health.
 */
export function isEmptyMap(plan: Pick<Plan, 'activities' | 'milestones'>): boolean {
  return plan.activities.length === 0 && plan.milestones.length === 0;
}

export function isOpen(activity: Activity): boolean {
  return activity.status !== 'done' && activity.status !== 'na';
}

export function daysOverdue(activity: Activity, today: IsoDate): number {
  if (!isOpen(activity) || !activity.dueDate) return 0;
  return Math.max(0, daysBetween(activity.dueDate, today));
}

export function latestActivityUpdate(plan: Plan): IsoDate | null {
  let latest: string | null = null;
  for (const activity of plan.activities) {
    if (activity.updatedAt && (!latest || activity.updatedAt > latest)) latest = activity.updatedAt;
  }
  return latest ? latest.slice(0, 10) : null;
}

/** Progress = plan start, the last app event, or the last "Last updated" stamp in the sheet, whichever is latest. */
export function daysWithoutProgress(plan: Plan, today: IsoDate, lastEventAt: IsoDate | IsoDateTime | null): number {
  const dates = [plan.info.startDate, lastEventAt?.slice(0, 10), latestActivityUpdate(plan)].filter(
    (d): d is string => Boolean(d),
  );
  const latest = dates.reduce((a, b) => (b > a ? b : a));
  return Math.max(0, daysBetween(latest, today));
}

export function computeHealth(input: { plan: Plan; today: IsoDate; lastEventAt: IsoDate | IsoDateTime | null }): HealthResult {
  const { plan, today, lastEventAt } = input;
  // Nothing is due once a recruitment ended without signing: the UI shows "Not signed" in place of the health.
  if (endedWithoutSigning(plan.info)) return { health: 'on_track', reasons: [] };
  // Nothing to manage yet: no stall, no exit trigger makes it at risk, and it isn't on track either (owner, 2026-10-31).
  if (isEmptyMap(plan)) return { health: 'empty', reasons: [] };
  const reasons: HealthReason[] = [];
  let offTrack = false;
  let atRisk = false;

  const stalled = daysWithoutProgress(plan, today, lastEventAt);
  if (stalled >= STALL_OFF_TRACK_DAYS) {
    offTrack = true;
    reasons.push({ kind: 'stalled', days: stalled });
  } else if (stalled >= STALL_AT_RISK_DAYS) {
    atRisk = true;
    reasons.push({ kind: 'stalled', days: stalled });
  }

  for (const activity of plan.activities) {
    const days = daysOverdue(activity, today);
    if (days > OVERDUE_AT_RISK_DAYS) {
      atRisk = true;
      reasons.push({ kind: 'overdue', activityId: activity.id, days });
    }
  }

  for (const milestone of plan.milestones) {
    if (isClosedHorizonMilestone(milestone, plan.info)) continue;
    if (milestoneStatus(milestone, today, plan.info.stage) === 'missed') {
      atRisk = true;
      reasons.push({ kind: 'milestone_missed', milestoneId: milestone.id });
    }
  }

  for (const trigger of plan.exitTriggers) {
    if (trigger.status === 'triggered') offTrack = true;
    if (trigger.status === 'watch') atRisk = true;
    if (trigger.status !== 'ok') reasons.push({ kind: 'exit_trigger', exitTriggerId: trigger.id, status: trigger.status });
  }

  return { health: offTrack ? 'off_track' : atRisk ? 'at_risk' : 'on_track', reasons };
}

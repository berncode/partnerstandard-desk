// On the joined plan (`Plan` is `JoinedPlan`: join the partner record in with `joinPlan` first).
import { MOMENTUM_NEXT_STEPS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { IsoDate, IsoDateTime } from '../partners/types';
import { addDays, daysBetween } from './dates';
import {
  computeHealth, daysOverdue, daysWithoutProgress, isEmptyMap, isOpen, STALL_AT_RISK_DAYS, STALL_OFF_TRACK_DAYS, type Health, type MapHealth,
} from './derived';
import { notifyKeys as keys } from './notify-keys';
import { STATUS_PHRASE, type PartnerAlerts } from './notify-types';
import { afterExit, endedWithoutSigning, type Activity, type JoinedPlan as Plan } from './types';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeAddress = (email: string): string => email.trim().toLowerCase();
export const isAddress = (email: string): boolean => EMAIL.test(email);

// ── Due and overdue reminders (spec §5.2) ─────────────────────────────────

export interface NudgeItem {
  key: string;
  kind: 'due_soon' | 'overdue';
  planId: string;
  activityId: string;
  title: string;
  dueDate: IsoDate;
  /** Days until due, or days overdue. */
  days: number;
  personId: string;
  personName: string;
  email: string;
}

/**
 * One plan's reminders on the owner's local `today`. Due soon is 1 to `dueSoonDays` days ahead: on the due date itself
 * an activity is neither due soon nor overdue (Decision 7). Overdue starts the day after.
 */
export function nudgesFor(planId: string, plan: Plan, today: IsoDate, dueSoonDays: number): NudgeItem[] {
  const items: NudgeItem[] = [];
  // A recruitment that ended without signing has nothing due: nobody is reminded of its open activities. Nor after the
  // partner type's exit (PartnerStandard Desk, ruling R7): the partnership is over, and the email buttons would be refused.
  if (endedWithoutSigning(plan.info) || afterExit(plan.info)) return items;
  for (const activity of plan.activities) {
    if (!isOpen(activity) || !activity.dueDate || !activity.ownerId) continue;
    const person = plan.people.find((p) => p.id === activity.ownerId);
    const email = person?.email ? normalizeAddress(person.email) : '';
    if (!person || !isAddress(email)) continue;
    const until = daysBetween(today, activity.dueDate);
    const base = { planId, activityId: activity.id, title: activity.title, dueDate: activity.dueDate, personId: person.id, personName: person.name, email };
    if (until > 0 && until <= dueSoonDays) {
      items.push({ ...base, kind: 'due_soon', days: until, key: keys.dueSoon(planId, activity.id, person.id, activity.dueDate) });
    } else if (until < 0) {
      items.push({ ...base, kind: 'overdue', days: -until, key: keys.overdue(planId, activity.id, person.id, activity.dueDate, -until) });
    }
  }
  return items;
}

// ── Momentum (spec §5.5) ──────────────────────────────────────────────────

const RANK: Record<Health, number> = { on_track: 0, at_risk: 1, off_track: 2 };

/** Momentum looks at progress only; the full health also counts overdue items, missed milestones and exit triggers. */
export function momentumState(plan: Plan, today: IsoDate, lastEventAt: IsoDateTime | null): Health {
  // Nothing more is expected of a MAP after the exit (PartnerStandard Desk, ruling R7): it never loses momentum.
  if (endedWithoutSigning(plan.info) || afterExit(plan.info)) return 'on_track';
  // An empty MAP has nothing to manage yet (owner, 2026-10-31): it never warns. Kept as on track, inside the job only.
  if (isEmptyMap(plan)) return 'on_track';
  const days = daysWithoutProgress(plan, today, lastEventAt);
  return days >= STALL_OFF_TRACK_DAYS ? 'off_track' : days >= STALL_AT_RISK_DAYS ? 'at_risk' : 'on_track';
}

/** 'warn' on a change for the worse (never-warned counts as on track); 'store' an improvement silently, so a relapse warns again. */
export function momentumChange(current: Health, previous: Health | null): 'warn' | 'store' | 'none' {
  if (RANK[current] > RANK[previous ?? 'on_track']) return 'warn';
  return current === previous ? 'none' : 'store';
}

/** One next step from the methodology content, the same for a plan on a given day. */
export function momentumSuggestion(planId: string, date: IsoDate): string {
  let hash = 0;
  for (const char of `${planId}:${date}`) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return MOMENTUM_NEXT_STEPS[hash % MOMENTUM_NEXT_STEPS.length]!;
}

// ── Weekly digest (spec §5.3) ─────────────────────────────────────────────

export interface DigestSection {
  planId: string;
  partnerName: string;
  /** `empty` for a MAP with nothing to manage yet: it has no health, so no change is reported for it. */
  health: MapHealth;
  healthChange: { from: Health; to: Health } | null;
  doneLastWeek: Array<{ id: string; title: string }>;
  dueThisWeek: Array<{ id: string; title: string; dueDate: IsoDate }>;
  overdue: Array<{ id: string; title: string; days: number }>;
  blocked: Array<{ id: string; title: string }>;
}

const idTitle = ({ id, title }: Activity) => ({ id, title });

/**
 * One plan's part of Monday's digest. "Last week" is the seven days before `today`, so every day is covered exactly once.
 * "This week" is today and the six days after it.
 */
export function digestSection(planId: string, plan: Plan, today: IsoDate, lastEventAt: IsoDateTime | null, previousHealth: Health | null): DigestSection {
  const weekAgo = addDays(today, -7);
  const open = plan.activities.filter(isOpen);
  const health = computeHealth({ plan, today, lastEventAt }).health;
  return {
    planId,
    partnerName: plan.info.partnerName,
    health,
    healthChange: previousHealth !== null && health !== 'empty' && previousHealth !== health ? { from: previousHealth, to: health } : null,
    doneLastWeek: plan.activities
      .filter((a) => a.status === 'done' && a.completedDate !== null && a.completedDate >= weekAgo && a.completedDate < today)
      .map(idTitle),
    dueThisWeek: open
      .flatMap((a) => (a.dueDate !== null && daysBetween(today, a.dueDate) >= 0 && daysBetween(today, a.dueDate) <= 6 ? [{ id: a.id, title: a.title, dueDate: a.dueDate }] : []))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    overdue: open
      .flatMap((a) => (daysOverdue(a, today) >= 1 ? [{ id: a.id, title: a.title, days: daysOverdue(a, today) }] : []))
      .sort((a, b) => b.days - a.days),
    blocked: open.filter((a) => a.status === 'blocked').map(idTitle),
  };
}

/** "Skipped if nothing changed and nothing is due" (spec §5.3). */
export const isQuiet = (s: DigestSection): boolean =>
  s.doneLastWeek.length === 0 && s.dueThisWeek.length === 0 && s.overdue.length === 0 && s.blocked.length === 0 && s.healthChange === null;

// ── Partner activity alerts (spec §5.4) ───────────────────────────────────

/** Instant alerts wait this long after the first new change, so a burst of edits makes one email. */
export const ALERT_DEBOUNCE_MS = 15 * 60_000;

/** A change by a person with a link (the MAP app's collaborator), by id only (plan_events). `id` orders events and moves the cursor (Decision 12). */
export interface AlertEvent {
  id: number;
  entityType: string;
  entityId: string;
  action: 'created' | 'updated' | 'status_changed' | 'deleted';
  actorRef: string;
  at: IsoDateTime;
}

export type AlertDecision = { send: false } | { send: true; throughId: number };

/** `events` are the new changes by people with a link in insert order; `throughId` is the cursor once the alert is sent: the last event's id. */
export function partnerAlertDecision(mode: PartnerAlerts, events: AlertEvent[], now: Date, dailyHour: boolean): AlertDecision {
  if (events.length === 0 || mode === 'off') return { send: false };
  const throughId = events[events.length - 1]!.id;
  if (mode === 'instant') return now.getTime() - Date.parse(events[0]!.at) >= ALERT_DEBOUNCE_MS ? { send: true, throughId } : { send: false };
  return dailyHour ? { send: true, throughId } : { send: false };
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? COPY.MAP_ALERT_SOMEONE;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function whatHappened(group: AlertEvent[], plan: Plan): string {
  const { entityType, entityId } = group[0]!;
  const actions = new Set(group.map((e) => e.action));
  const activity = entityType === 'activity' ? plan.activities.find((a) => a.id === entityId) : undefined;
  // People with a link change only activities and objectives (canChangeMap); anything else is described generally.
  const name = entityType === 'activity' ? activity?.title
    : entityType === 'objective' ? plan.objectives.find((o) => o.id === entityId)?.statement
    : null;
  if (name === null) return 'updated the plan';
  if (name === undefined) return `${actions.has('created') ? 'added' : 'changed'} an item that was later removed`;
  const quoted = `“${name || 'Untitled'}”`;
  if (actions.has('created')) return `added ${quoted}`;
  if (actions.has('status_changed') && activity) {
    if (activity.status === 'done') return `marked ${quoted} done`;
    if (activity.status === 'na') return `marked ${quoted} not applicable`;
    return `set ${quoted} to ${STATUS_PHRASE[activity.status]}`;
  }
  return `updated ${quoted}`;
}

/** One line per changed item, in the order items first changed. Statuses are today's, from the fresh snapshot. */
export function alertLines(events: AlertEvent[], plan: Plan, actorName: (actorRef: string) => string): string[] {
  const groups = new Map<string, AlertEvent[]>();
  for (const event of events) {
    const key = `${event.entityType}:${event.entityId}`;
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  return [...groups.values()].map((group) => `${joinNames([...new Set(group.map((e) => actorName(e.actorRef)))])} ${whatHappened(group, plan)}`);
}

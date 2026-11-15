// This week (spec 4): what needs the partner manager, sorted into four sections. Pure: the command gathers the inputs.
import type { PartnerType } from '@partner-desk/method';
import { addDays, daysBetween, toIsoDate } from '../maps/dates';
import { computeHealth, isOpen, type Health, type HealthReason } from '../maps/derived';
import { afterExit, endedWithoutSigning, type Activity, type JoinedPlan } from '../maps/types';
import { signNudge } from '../partners/lifecycle';
import type { IsoDate, IsoDateTime, PartnerBook } from '../partners/types';
import { reviewStatus } from '../reviews/rules';

/** A partner in Recruitment waits for you when its step hasn't moved for this many days [builder's call]. */
export const RECRUITMENT_WAITING_DAYS = 14;

/** A summary is "unsent" when the review was held this long ago. */
const SUMMARY_REMINDER_HOURS = 48;
const SUMMARY_REMINDER_DAYS = 2;

export interface WeekMap {
  mapId: string;
  partnerId: string;
  displayName: string;
  plan: JoinedPlan;
  /** What its health counts progress from (`lastProgress`). */
  lastProgressAt: IsoDateTime;
  /** The health the Monday digest last reported; null when it never did (or is off). */
  digestHealth: Health | null;
  /** The MAP file couldn't be read: `plan` holds the partner record's facts only. */
  unreadable: boolean;
}

export interface WeekReviewLine {
  mapId: string;
  displayName: string;
  date: IsoDate;
  daysLeft: number | null;
  daysLate: number | null;
  prep: boolean;
  summaryUnsent: boolean;
  /** The held review the summary should be sent from; null when no summary is unsent. */
  heldReviewId: string | null;
}

export type NeedReason =
  | { kind: 'health'; health: Health; reason: HealthReason }
  | { kind: 'exitTrigger'; status: 'watch' | 'triggered'; condition: string }
  | { kind: 'healthChanged'; from: Health; to: Health };

export interface NeedLine {
  mapId: string;
  displayName: string;
  reasons: NeedReason[];
}

export interface DueGroup {
  mapId: string;
  displayName: string;
  activities: Array<{ activity: Activity; overdueDays: number }>;
}

export interface WaitingLine {
  partnerId: string;
  accountId: string;
  name: string;
  partnerType: PartnerType;
  reason: 'stalled' | 'mapNotAgreed';
  days: number | null;
}

export interface ThisWeek {
  reviews: WeekReviewLine[];
  needYou: NeedLine[];
  due: DueGroup[];
  waiting: WaitingLine[];
}

export interface ThisWeekInput {
  book: PartnerBook;
  maps: WeekMap[];
  /** When each partner's step last moved, by partner id. A partner without one counts from its last update. */
  stepMovedAt: Record<string, IsoDateTime>;
  today: IsoDate;
  /**
   * The time now. With it, a held review's summary is unsent 48 hours after the review row was marked held; without
   * it, two days after the held-on date.
   */
  now?: IsoDateTime;
}

/** The Sunday of the Monday-to-Sunday week that holds `today`. */
export function weekEnd(today: IsoDate): IsoDate {
  const day = new Date(`${today}T00:00:00Z`).getUTCDay(); // 0 is Sunday
  return addDays(today, (7 - day) % 7);
}

/** A partnership that is signed and not over: the only kind with reviews, needs and due work. */
const isRunning = (plan: JoinedPlan): boolean =>
  plan.info.stage !== 'recruitment' && !endedWithoutSigning(plan.info) && !afterExit(plan.info);

/** The newest held review, when its summary is unsent and it was held 48 hours ago or more. */
function unsentSummary(plan: JoinedPlan, today: IsoDate, now: IsoDateTime | undefined): { id: string; heldOn: IsoDate } | null {
  const held = plan.reviews.filter((r) => r.state === 'held').sort((a, b) => b.horizon - a.horizon)[0];
  if (!held || held.summarySentAt !== null || held.heldOn === null) return null;
  const old = now !== undefined && held.updatedAt !== null
    ? Date.parse(now) - Date.parse(held.updatedAt) >= SUMMARY_REMINDER_HOURS * 3_600_000
    : daysBetween(held.heldOn, today) >= SUMMARY_REMINDER_DAYS;
  return old ? { id: held.id, heldOn: held.heldOn } : null;
}

/**
 * One line per partnership with a review coming or overdue, or a summary unsent 48 hours after closing (whatever the
 * next review's date). A partnership with both has one line that carries both.
 */
function reviewLines(maps: WeekMap[], today: IsoDate, now: IsoDateTime | undefined): WeekReviewLine[] {
  const lines: WeekReviewLine[] = [];
  for (const m of maps) {
    if (m.unreadable || !isRunning(m.plan)) continue;
    const status = reviewStatus(m.plan, today);
    const unsent = unsentSummary(m.plan, today, now);
    const base = { mapId: m.mapId, displayName: m.displayName, summaryUnsent: unsent !== null, heldReviewId: unsent?.id ?? null };
    if (status.kind === 'coming' || status.kind === 'overdue') {
      lines.push({
        ...base, date: status.date,
        daysLeft: status.kind === 'coming' ? status.daysLeft : null,
        daysLate: status.kind === 'overdue' ? status.daysLate : null,
        prep: status.prepId !== null,
      });
    } else if (unsent) {
      lines.push({ ...base, date: unsent.heldOn, daysLeft: null, daysLate: null, prep: false });
    }
  }
  return lines.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.displayName.localeCompare(b.displayName)));
}

const HEALTH_RANK: Record<string, number> = { off_track: 0, at_risk: 1 };

function needLines(maps: WeekMap[], today: IsoDate): NeedLine[] {
  const lines: Array<NeedLine & { rank: number }> = [];
  for (const m of maps) {
    if (!isRunning(m.plan)) continue;
    const base = { mapId: m.mapId, displayName: m.displayName };
    if (m.unreadable) {
      lines.push({ ...base, reasons: [], rank: 3 });
      continue;
    }
    const { health, reasons } = computeHealth({ plan: m.plan, today, lastEventAt: m.lastProgressAt });
    const out: NeedReason[] = [];
    if (health === 'off_track' || health === 'at_risk') {
      for (const reason of reasons) {
        if (reason.kind === 'exit_trigger') {
          const trigger = m.plan.exitTriggers.find((t) => t.id === reason.exitTriggerId);
          out.push({ kind: 'exitTrigger', status: reason.status, condition: trigger?.condition ?? '' });
        } else out.push({ kind: 'health', health, reason });
      }
    }
    if (health !== 'empty' && m.digestHealth !== null && m.digestHealth !== health) {
      out.push({ kind: 'healthChanged', from: m.digestHealth, to: health });
    }
    if (out.length > 0) lines.push({ ...base, reasons: out, rank: HEALTH_RANK[health] ?? 2 });
  }
  lines.sort((a, b) => a.rank - b.rank || a.displayName.localeCompare(b.displayName));
  return lines.map((line) => ({ mapId: line.mapId, displayName: line.displayName, reasons: line.reasons }));
}

function dueGroups(maps: WeekMap[], today: IsoDate): DueGroup[] {
  const end = weekEnd(today);
  const groups: DueGroup[] = [];
  for (const m of maps) {
    if (m.unreadable || !isRunning(m.plan)) continue;
    const activities = m.plan.activities
      .filter((a) => (a.side === 'us' || a.side === 'joint') && isOpen(a) && a.dueDate !== null && a.dueDate <= end)
      .map((activity) => ({ activity, overdueDays: Math.max(0, daysBetween(activity.dueDate!, today)) }))
      .sort((a, b) => b.overdueDays - a.overdueDays || (a.activity.dueDate! < b.activity.dueDate! ? -1 : 1));
    if (activities.length > 0) groups.push({ mapId: m.mapId, displayName: m.displayName, activities });
  }
  return groups.sort((a, b) =>
    b.activities[0]!.overdueDays - a.activities[0]!.overdueDays || a.displayName.localeCompare(b.displayName));
}

function waitingLines(input: ThisWeekInput): WaitingLine[] {
  const { book, stepMovedAt, today } = input;
  const lines: WaitingLine[] = [];
  for (const p of book.partners) {
    if (p.stage !== 'recruitment' || p.closed !== null || p.signedDate !== null) continue;
    const since = stepMovedAt[p.id] ?? p.updatedAt;
    const days = since === null ? null : Math.max(0, daysBetween(toIsoDate(since), today));
    const mapNotAgreed = p.step === 'map' && signNudge(p) !== null;
    if (!mapNotAgreed && (days === null || days < RECRUITMENT_WAITING_DAYS)) continue;
    const account = book.accounts.find((a) => a.id === p.accountId);
    lines.push({
      partnerId: p.id, accountId: p.accountId, name: account?.company ?? '', partnerType: p.partnerType,
      reason: mapNotAgreed ? 'mapNotAgreed' : 'stalled', days,
    });
  }
  return lines.sort((a, b) => (b.days ?? -1) - (a.days ?? -1) || a.name.localeCompare(b.name));
}

export function thisWeek(input: ThisWeekInput): ThisWeek {
  const { maps, today, now } = input;
  return { reviews: reviewLines(maps, today, now), needYou: needLines(maps, today), due: dueGroups(maps, today), waiting: waitingLines(input) };
}

// The scheduled job's webhook events (agents spec 7.2): `activity.overdue`, `health.changed` and `review.due`, worked
// out from the MAPs the job read anyway, so they cost no Google read. Only for owners with an active webhook subscribed
// to the event, and only for what happened after the webhook was turned on (question 27, 2026-11-03). Ids only, in the
// events, the marks and the logs. Sending them is `deliverDue`'s work, after the MAPs.
import type { Directory, JobMap, WebhookStore, WebhookSubscription } from '@partner-desk/commands';
import {
  afterExit, comingFrom, daysOverdue, endedWithoutSigning, happenedSince, overdueFrom, reviewStatus, summarizeMap, type IsoDate, type IsoDateTime,
  type JoinedPlan, type WebhookEvent,
} from '@partner-desk/core';

/**
 * An activity's overdue and a review's due go out only up to this many days after their date [builder's call]: well
 * inside the 90 days a mark is kept (`MARK_KEEP_MS`), so a mark pruned while the activity is still open can never send
 * it twice. A webhook turned on later still hears only of what happened since (`happenedSince`), inside this window.
 */
export const LATE_WINDOW_DAYS = 30;

export interface TickWebhookDeps {
  webhooks: Pick<WebhookStore, 'subscriptions' | 'enqueue'>;
  directory: Pick<Directory, 'setMapWebhookHealth'>;
  log: (event: string, ids: Record<string, string>) => void;
}

/** One MAP the job read: its directory row, the joined plan, the owner's today, timezone and the MAP's last progress. */
export interface ReadMap { map: JobMap; plan: JoinedPlan; today: IsoDate; timeZone: string; lastEventAt: IsoDateTime }

/**
 * The owner's active webhooks, with their events and since when each is on. One look per owner per run, made only for
 * owners with a MAP read this run. Null when they can't be read: then nothing is queued and nothing stored, and the next
 * read tries again.
 */
async function subscriptionsOf(deps: TickWebhookDeps, userId: string): Promise<WebhookSubscription[] | null> {
  try {
    return await deps.webhooks.subscriptions(userId);
  } catch {
    deps.log('webhook_list_failed', { userId });
    return null;
  }
}

/**
 * Queues the events of each MAP read, owner by owner, until `late()` says the run has no time left; answers the ids of
 * the MAPs it didn't get to, for the run to redo. A failure is logged by ids and never stops the run or another MAP.
 */
export async function queueTickWebhooks(deps: TickWebhookDeps, read: ReadMap[], late: () => boolean): Promise<string[]> {
  const skipped: string[] = [];
  const owners = new Map<string, ReadMap[]>();
  for (const m of read) owners.set(m.map.ownerUserId, [...(owners.get(m.map.ownerUserId) ?? []), m]);
  for (const [userId, maps] of owners) {
    if (late()) {
      skipped.push(...maps.map((m) => m.map.mapId));
      continue;
    }
    const subs = await subscriptionsOf(deps, userId);
    if (subs === null) continue;
    for (const m of maps) {
      try {
        await mapEvents(deps, m, subs);
      } catch {
        // A rule that throws on this MAP's plan: its events wait, and nothing else does.
        deps.log('webhook_map_failed', { mapId: m.map.mapId });
      }
    }
  }
  return skipped;
}

async function mapEvents(deps: TickWebhookDeps, m: ReadMap, subs: WebhookSubscription[]): Promise<void> {
  const { mapId, partnerId, ownerUserId: userId } = m.map;
  const subscribed = (type: WebhookEvent) => subs.some((s) => s.events.includes(type));
  /** True once queued (or already marked as sent). */
  const queue = async (type: WebhookEvent, data: Record<string, string>, markKey?: string, only?: string[]): Promise<boolean> => {
    try {
      await deps.webhooks.enqueue(userId, type, data, markKey, only);
      return true;
    } catch {
      deps.log('webhook_enqueue_failed', { type, userId, mapId });
      return false;
    }
  };

  /**
   * The webhooks subscribed to `type` and on by `from`, the owner's day it happened. When none is, nothing is queued and
   * no mark is made. A webhook turned on later can't be on by that day either, so a mark made without it costs it nothing.
   */
  const receivers = (type: WebhookEvent, from: IsoDate) =>
    subs.filter((s) => s.events.includes(type) && happenedSince(from, s.activeSince, m.timeZone)).map((s) => s.id);

  // Past due in the owner's day and not done, once per activity and due date: the digest's rule (`daysOverdue`). Nothing
  // after a recruitment ended or the exit, as for the reminders: the partnership is over.
  if (subscribed('activity.overdue') && !endedWithoutSigning(m.plan.info) && !afterExit(m.plan.info)) {
    for (const activity of m.plan.activities) {
      const late = daysOverdue(activity, m.today);
      // A late activity has a due date; the check is for the types.
      if (late < 1 || late > LATE_WINDOW_DAYS || activity.dueDate === null) continue;
      const to = receivers('activity.overdue', overdueFrom(activity.dueDate));
      if (to.length === 0) continue;
      await queue('activity.overdue', { mapId, partnerId, activityId: activity.id }, `overdue:${activity.id}:${activity.dueDate}`, to);
    }
  }

  await healthChanged(deps, m, subscribed('health.changed'), () => queue('health.changed', { mapId, partnerId }));

  // As on This week: coming within 21 days, or past and not held (for 30 days). Once per review date, so a moved review
  // comes up again; to the webhooks on by the day it came within 21 days.
  if (subscribed('review.due')) {
    const status = reviewStatus(m.plan, m.today);
    if (status.kind === 'coming' || (status.kind === 'overdue' && status.daysLate <= LATE_WINDOW_DAYS)) {
      const to = receivers('review.due', comingFrom(status.date));
      if (to.length > 0) {
        await queue('review.due', { mapId, partnerId, ...(status.prepId !== null ? { reviewId: status.prepId } : {}) }, `review:${mapId}:${status.date}`, to);
      }
    }
  }
}

/**
 * `health.changed` when the MAP's health differs from the one its owner's webhooks last heard of, then that one is
 * stored. The first health heard of is stored without an event (nothing changed yet). An empty MAP, or a recruitment
 * that ended, has none: it sends nothing and keeps the one heard of, so back to the same health sends nothing and to
 * another sends one (question 27). Without a webhook for it, a stored health is forgotten, so subscribing again starts
 * afresh rather than with a change from long ago. Turn on forgets it too (`turnOnWebhook`), for a webhook turned off and
 * on between two runs.
 */
async function healthChanged(deps: TickWebhookDeps, m: ReadMap, subscribed: boolean, send: () => Promise<boolean>): Promise<void> {
  const stored = m.map.notify.webhookHealth;
  const summarized = summarizeMap(m.plan, m.today, m.lastEventAt).health;
  const health = summarized === 'empty' ? null : summarized;
  if (subscribed && health === null) return;
  const now = subscribed ? health : null;
  if (now === stored) return;
  if (now !== null && stored !== null && !(await send())) return;
  try {
    await deps.directory.setMapWebhookHealth(m.map.mapId, now);
  } catch {
    deps.log('webhook_health_failed', { mapId: m.map.mapId });
  }
}

import type { IsoDate } from '../partners/types';
import type { Health } from './derived';

/**
 * Every dedupe key the tick claims in notification_log (spec §2.4: type + entity + recipient + period).
 * Changing a key's shape makes everything it covered look new, so it would be sent again.
 */
export const notifyKeys = {
  dueSoon: (planId: string, activityId: string, personId: string, dueDate: IsoDate) => `due_soon:${planId}:${activityId}:${personId}:${dueDate}`,
  /** Bucket 0 covers days 1–7 overdue, bucket 1 days 8–14, and so on: the day after, then weekly (spec §5.2). */
  overdue: (planId: string, activityId: string, personId: string, dueDate: IsoDate, daysOverdue: number) =>
    `overdue:${planId}:${activityId}:${personId}:${dueDate}:${Math.floor((daysOverdue - 1) / 7)}`,
  /** Round n is the nth email of a day to this address, one per owner-timezone group (Decision 7). Round 1 has no suffix. */
  nudgeEmail: (email: string, date: IsoDate, round: number) => (round === 1 ? `nudge_email:${email}:${date}` : `nudge_email:${email}:${date}:${round}`),
  digest: (ownerId: string, date: IsoDate) => `digest:${ownerId}:${date}`,
  digestPartner: (planId: string, email: string, date: IsoDate) => `digest_partner:${planId}:${email}:${date}`,
  /** By the cursor's event id since Plan 7 (Decision 12); the old keys held a time, so the two shapes never collide. */
  partnerAlert: (planId: string, throughId: number) => `partner_alert:${planId}:${throughId}`,
  momentum: (planId: string, state: Health, date: IsoDate) => `momentum:${planId}:${state}:${date}`,
  reconnect: (ownerId: string, utcDate: IsoDate) => `reconnect:${ownerId}:${utcDate}`,
  daily: (planId: string, date: IsoDate) => `daily:${planId}:${date}`,
};

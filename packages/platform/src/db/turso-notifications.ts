// The email log, the email preferences and the link holders' changes. Ids, keys, hashes, dates and the recipient's
// address in the log only; never plan content.
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, like, lt, notLike, or, sql } from 'drizzle-orm';
import {
  addressHash, CLAIM_KEEP_MS, DAILY_KEY_PREFIX, SENT_KEEP_MS, staleBefore, type ClaimMeta, type EmailPrefs, type MapEvent, type MapEventLog,
  type NotificationLog,
} from '@partner-desk/commands';
import { notifyKeys, NOTIFICATION_TYPES, type IsoDateTime, type NotificationType } from '@partner-desk/core';
import type { Db } from './client';
import { guarded } from './guarded';
import { emailPrefs, mapEvents, notificationLog } from './schema';

/** Keys per query: well under SQLite's bound-parameter limit. */
const CHUNK = 500;

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

export class TursoNotificationLog implements NotificationLog {
  constructor(private readonly db: Db) {}

  existing(keys: string[], now: IsoDateTime): Promise<Set<string>> {
    return guarded('notification_log_read_failed', async () => {
      const found = new Set<string>();
      for (const part of chunks(keys)) {
        const rows = await this.db.select({ key: notificationLog.dedupeKey }).from(notificationLog).where(and(
          inArray(notificationLog.dedupeKey, part),
          or(isNotNull(notificationLog.sentAt), sql`${notificationLog.claimedAt} >= ${staleBefore(now)}`),
        ));
        for (const row of rows) found.add(row.key);
      }
      return found;
    });
  }

  claim(key: string, meta: ClaimMeta, now: IsoDateTime): Promise<boolean> {
    return guarded('notification_claim_failed', async () => {
      const rows = await this.db.insert(notificationLog)
        .values({ dedupeKey: key, type: meta.type, mapId: meta.mapId, recipientEmail: meta.recipientEmail, claimedAt: now, sentAt: null, resendId: null })
        .onConflictDoUpdate({
          target: notificationLog.dedupeKey,
          set: { type: meta.type, mapId: meta.mapId, recipientEmail: meta.recipientEmail, claimedAt: now },
          // Only an abandoned claim, never sent and older than STALE_CLAIM_MS, may be taken over.
          setWhere: and(isNull(notificationLog.sentAt), lt(notificationLog.claimedAt, staleBefore(now))),
        })
        .returning({ key: notificationLog.dedupeKey });
      return rows.length > 0;
    });
  }

  markSent(key: string, resendId: string | null, at: IsoDateTime): Promise<void> {
    return guarded('notification_mark_failed', async () => {
      await this.db.update(notificationLog).set({ sentAt: at, resendId }).where(eq(notificationLog.dedupeKey, key));
    });
  }

  release(key: string): Promise<void> {
    return guarded('notification_release_failed', async () => {
      await this.db.delete(notificationLog).where(and(eq(notificationLog.dedupeKey, key), isNull(notificationLog.sentAt)));
    });
  }

  /** The owner's prefixes are compared with substr, not LIKE: an id's `_` would match any character. */
  deleteForOwner(ownerUserId: string, mapIds: string[]): Promise<number> {
    return guarded('notification_log_delete_failed', async () => {
      let count = 0;
      for (const part of chunks(mapIds)) {
        const gone = await this.db.delete(notificationLog).where(inArray(notificationLog.mapId, part)).returning({ key: notificationLog.dedupeKey });
        count += gone.length;
      }
      const digest = notifyKeys.digest(ownerUserId, '');
      const reconnect = notifyKeys.reconnect(ownerUserId, '');
      const own = await this.db.delete(notificationLog).where(and(
        isNull(notificationLog.mapId),
        or(
          sql`substr(${notificationLog.dedupeKey}, 1, ${digest.length}) = ${digest}`,
          sql`substr(${notificationLog.dedupeKey}, 1, ${reconnect.length}) = ${reconnect}`,
        ),
      )).returning({ key: notificationLog.dedupeKey });
      return count + own.length;
    });
  }

  prune(now: Date): Promise<number> {
    return guarded('notification_prune_failed', async () => {
      const claimCutoff = new Date(now.getTime() - CLAIM_KEEP_MS).toISOString();
      const sentCutoff = new Date(now.getTime() - SENT_KEEP_MS).toISOString();
      const daily = `${DAILY_KEY_PREFIX}%`;
      const deleted = await this.db.delete(notificationLog).where(or(
        and(like(notificationLog.dedupeKey, daily), lt(notificationLog.claimedAt, claimCutoff)),
        and(notLike(notificationLog.dedupeKey, daily), isNull(notificationLog.sentAt), lt(notificationLog.claimedAt, claimCutoff)),
        and(notLike(notificationLog.dedupeKey, daily), isNotNull(notificationLog.sentAt), lt(notificationLog.sentAt, sentCutoff)),
      )).returning({ key: notificationLog.dedupeKey });
      return deleted.length;
    });
  }
}

export class TursoEmailPrefs implements EmailPrefs {
  constructor(private readonly db: Db) {}

  unsubscribed(emails: string[], type: NotificationType): Promise<Set<string>> {
    return guarded('email_prefs_read_failed', async () => {
      const byHash = new Map<string, string[]>();
      for (const email of emails) {
        const hash = addressHash(email);
        byHash.set(hash, [...(byHash.get(hash) ?? []), email]);
      }
      const found = new Set<string>();
      for (const part of chunks([...byHash.keys()])) {
        const rows = await this.db.select({ hash: emailPrefs.emailHash }).from(emailPrefs)
          .where(and(eq(emailPrefs.type, type), inArray(emailPrefs.emailHash, part)));
        for (const row of rows) for (const email of byHash.get(row.hash) ?? []) found.add(email);
      }
      return found;
    });
  }

  async unsubscribe(emailHash: string, type: NotificationType, at: IsoDateTime): Promise<void> {
    await guarded('email_prefs_write_failed', () => this.db.insert(emailPrefs).values({ emailHash, type, unsubscribedAt: at }).onConflictDoNothing());
  }

  isUnsubscribed(emailHash: string, type: NotificationType): Promise<boolean> {
    return guarded('email_prefs_read_failed', async () => {
      const [row] = await this.db.select({ hash: emailPrefs.emailHash }).from(emailPrefs)
        .where(and(eq(emailPrefs.emailHash, emailHash), eq(emailPrefs.type, type))).limit(1);
      return Boolean(row);
    });
  }

  listForHash(emailHash: string): Promise<Array<{ type: NotificationType; unsubscribedAt: IsoDateTime }>> {
    return guarded('email_prefs_read_failed', async () => {
      const rows = await this.db.select({ type: emailPrefs.type, unsubscribedAt: emailPrefs.unsubscribedAt }).from(emailPrefs)
        .where(eq(emailPrefs.emailHash, emailHash));
      return rows.sort((a, b) => NOTIFICATION_TYPES.indexOf(a.type) - NOTIFICATION_TYPES.indexOf(b.type));
    });
  }

  async resubscribe(emailHash: string, type: NotificationType): Promise<void> {
    await guarded('email_prefs_write_failed', () => this.db.delete(emailPrefs).where(and(eq(emailPrefs.emailHash, emailHash), eq(emailPrefs.type, type))));
  }
}

const ACTIONS = new Set<MapEvent['action']>(['created', 'updated', 'status_changed', 'deleted']);

/** What people with a link changed, for the owner's partner alerts. Ids and codes only. */
export class TursoMapEvents implements MapEventLog {
  constructor(private readonly db: Db) {}

  async record(mapId: string, event: Omit<MapEvent, 'id'>): Promise<void> {
    await guarded('map_events_write_failed', () => this.db.insert(mapEvents).values({ mapId, ...event }));
  }

  since(mapId: string, afterId: number | null): Promise<MapEvent[]> {
    return guarded('map_events_read_failed', async () => {
      const rows = await this.db.select().from(mapEvents)
        .where(afterId === null ? eq(mapEvents.mapId, mapId) : and(eq(mapEvents.mapId, mapId), gt(mapEvents.id, afterId)))
        .orderBy(asc(mapEvents.id));
      return rows.filter((r) => ACTIONS.has(r.action))
        .map((r) => ({ id: r.id, entityType: r.entityType, entityId: r.entityId, action: r.action, actorRef: r.actorRef, at: r.at }));
    });
  }

  latestId(mapId: string): Promise<number | null> {
    return guarded('map_events_read_failed', async () => {
      const [row] = await this.db.select({ id: mapEvents.id }).from(mapEvents).where(eq(mapEvents.mapId, mapId)).orderBy(desc(mapEvents.id)).limit(1);
      return row?.id ?? null;
    });
  }

  /** Account deletion: removes every change of these MAPs. */
  async deleteForMaps(mapIds: string[]): Promise<void> {
    for (const part of chunks(mapIds)) await guarded('map_events_delete_failed', () => this.db.delete(mapEvents).where(inArray(mapEvents.mapId, part)));
  }

  prune(before: IsoDateTime): Promise<number> {
    return guarded('map_events_prune_failed', async () => {
      const gone = await this.db.delete(mapEvents).where(lt(mapEvents.at, before)).returning({ id: mapEvents.id });
      return gone.length;
    });
  }
}

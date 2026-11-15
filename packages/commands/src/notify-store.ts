// The email log and the email preferences. Ids, keys, dates and the recipient's address only, never plan content.
import { notifyKeys, NOTIFICATION_TYPES, type IsoDateTime, type NotificationType } from '@partner-desk/core';
import { hashToken } from './share-tokens';

/** What a log row is for. 'daily' marks a MAP's 08:00 work done for a date; the rest are emails. */
export type LogType = 'nudge_item' | 'nudge_email' | 'digest' | 'partner_alert' | 'momentum' | 'reconnect' | 'daily';
export interface ClaimMeta { type: LogType; mapId: string | null; recipientEmail: string | null }

/** A claim not marked sent after this long belongs to a run that died: a later run may take it over. */
export const STALE_CLAIM_MS = 10 * 60_000;
export const staleBefore = (now: IsoDateTime): IsoDateTime => new Date(Date.parse(now) - STALE_CLAIM_MS).toISOString();

/** Sent rows stay 90 days (spec 7), so a key is never sent twice while anything could still produce it. */
export const SENT_KEEP_MS = 90 * 24 * 60 * 60_000;
/** Daily markers and unsent claims stay a day: after that no run asks for them. */
export const CLAIM_KEEP_MS = 24 * 60 * 60_000;
export const DAILY_KEY_PREFIX = 'daily:';

/** An address's hash, as the email preferences keep it: the unsubscribe link never carries the address. */
export const addressHash = (email: string): string => hashToken(email.trim().toLowerCase());

/** The email log (the MAP app's notification_log): claim before sending, then mark sent or give back. */
export interface NotificationLog {
  /** The keys among `keys` that were sent, or claimed less than STALE_CLAIM_MS before `now`. */
  existing(keys: string[], now: IsoDateTime): Promise<Set<string>>;
  /** True when this caller now holds `key`: it was new, or an abandoned claim was taken over. */
  claim(key: string, meta: ClaimMeta, now: IsoDateTime): Promise<boolean>;
  markSent(key: string, resendId: string | null, at: IsoDateTime): Promise<void>;
  /** Gives an unsent claim back after a failed send, so the next run retries. A sent key is never removed. */
  release(key: string): Promise<void>;
  /** Removes every row of these MAPs, and the owner's own digests and reconnect emails (account deletion). */
  deleteForOwner(ownerUserId: string, mapIds: string[]): Promise<number>;
  /** Housekeeping: sent rows older than 90 days, daily markers and unsent claims over a day old. */
  prune(now: Date): Promise<number>;
}

/** Unsubscribes per address and kind of email. */
export interface EmailPrefs {
  /** Which of `emails` unsubscribed from `type`. */
  unsubscribed(emails: string[], type: NotificationType): Promise<Set<string>>;
  /** Idempotent. By hash: the unsubscribe link never carries the address. */
  unsubscribe(emailHash: string, type: NotificationType, at: IsoDateTime): Promise<void>;
  isUnsubscribed(emailHash: string, type: NotificationType): Promise<boolean>;
  /** The kinds this address unsubscribed from, in NOTIFICATION_TYPES order (Settings). */
  listForHash(emailHash: string): Promise<Array<{ type: NotificationType; unsubscribedAt: IsoDateTime }>>;
  /** Idempotent: removes the unsubscribe, so the emails start again. */
  resubscribe(emailHash: string, type: NotificationType): Promise<void>;
}

interface LogRow extends ClaimMeta { claimedAt: IsoDateTime; sentAt: IsoDateTime | null; resendId: string | null }

const holds = (row: LogRow | undefined, now: IsoDateTime): boolean => !!row && (row.sentAt !== null || row.claimedAt >= staleBefore(now));

function prunable(key: string, row: LogRow, now: Date): boolean {
  const claimCutoff = new Date(now.getTime() - CLAIM_KEEP_MS).toISOString();
  if (key.startsWith(DAILY_KEY_PREFIX)) return row.claimedAt < claimCutoff;
  if (row.sentAt === null) return row.claimedAt < claimCutoff;
  return row.sentAt < new Date(now.getTime() - SENT_KEEP_MS).toISOString();
}

/** The owner's rows that belong to no MAP: their digests, and their reconnect emails. */
export const ownersOwnKey = (key: string, ownerUserId: string): boolean =>
  key.startsWith(notifyKeys.digest(ownerUserId, '')) || key.startsWith(notifyKeys.reconnect(ownerUserId, ''));

export class MemoryNotificationLog implements NotificationLog {
  /** Test helper: the rows, by key. */
  readonly rows = new Map<string, LogRow>();

  async existing(keys: string[], now: IsoDateTime): Promise<Set<string>> {
    return new Set(keys.filter((key) => holds(this.rows.get(key), now)));
  }

  async claim(key: string, meta: ClaimMeta, now: IsoDateTime): Promise<boolean> {
    if (holds(this.rows.get(key), now)) return false;
    this.rows.set(key, { ...meta, claimedAt: now, sentAt: null, resendId: null });
    return true;
  }

  async markSent(key: string, resendId: string | null, at: IsoDateTime): Promise<void> {
    const row = this.rows.get(key);
    if (row) Object.assign(row, { sentAt: at, resendId });
  }

  async release(key: string): Promise<void> {
    if (this.rows.get(key)?.sentAt === null) this.rows.delete(key);
  }

  async deleteForOwner(ownerUserId: string, mapIds: string[]): Promise<number> {
    const wanted = new Set(mapIds);
    let count = 0;
    for (const [key, row] of this.rows) {
      if (!((row.mapId !== null && wanted.has(row.mapId)) || (row.mapId === null && ownersOwnKey(key, ownerUserId)))) continue;
      this.rows.delete(key);
      count += 1;
    }
    return count;
  }

  async prune(now: Date): Promise<number> {
    let count = 0;
    for (const [key, row] of this.rows) {
      if (!prunable(key, row, now)) continue;
      this.rows.delete(key);
      count += 1;
    }
    return count;
  }
}

export class MemoryEmailPrefs implements EmailPrefs {
  private readonly off = new Map<string, IsoDateTime>();

  async unsubscribed(emails: string[], type: NotificationType): Promise<Set<string>> {
    return new Set(emails.filter((email) => this.off.has(`${addressHash(email)}:${type}`)));
  }

  async unsubscribe(emailHash: string, type: NotificationType, at: IsoDateTime): Promise<void> {
    const key = `${emailHash}:${type}`;
    if (!this.off.has(key)) this.off.set(key, at);
  }

  async isUnsubscribed(emailHash: string, type: NotificationType): Promise<boolean> {
    return this.off.has(`${emailHash}:${type}`);
  }

  async listForHash(emailHash: string): Promise<Array<{ type: NotificationType; unsubscribedAt: IsoDateTime }>> {
    return NOTIFICATION_TYPES.flatMap((type) => {
      const unsubscribedAt = this.off.get(`${emailHash}:${type}`);
      return unsubscribedAt ? [{ type, unsubscribedAt }] : [];
    });
  }

  async resubscribe(emailHash: string, type: NotificationType): Promise<void> {
    this.off.delete(`${emailHash}:${type}`);
  }
}

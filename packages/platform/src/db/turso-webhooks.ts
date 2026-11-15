import type {
  ResendOutcome, TargetCheck, WebhookDelivery, WebhookInfo, WebhookStatus, WebhookStore, WebhookSubscription,
} from '@partner-desk/commands';
import {
  DELIVERY_KEEP_MS, MARK_KEEP_MS, randomSuffix, WEBHOOK_EVENTS, WEBHOOK_TEST_EVENT, type WebhookEvent,
} from '@partner-desk/core';
import { symmetricDecrypt, symmetricEncrypt } from 'better-auth/crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { newSecret } from '../webhooks/sign';
import { checkTarget } from '../webhooks/target';
import type { Db } from './client';
import { guarded } from './guarded';
import { webhookDeliveries, webhookMarks, webhooks, workspace, workspaceMembers } from './schema';

/** One delivery handed to a sender by `claimDue`: where it goes, how it is signed, and what it says (ids only). */
export interface DueDelivery {
  /** The event id (`webhook-id`). */
  id: string;
  webhookId: string;
  userId: string;
  url: string;
  /** The signing secret, or null when it can't be decrypted (the key changed): the delivery then fails unsent. */
  secret: string | null;
  type: string;
  data: Record<string, string>;
  occurredAt: string;
  /** Tries made before this one. */
  attempts: number;
}

export interface WebhookOptions {
  /** The key that encrypts the signing secrets: BETTER_AUTH_SECRET, as for the Google tokens. */
  key: string;
  /** WEBHOOKS_ALLOW_PRIVATE (self-hosted only): http and local addresses pass `checkTarget`. */
  allowPrivate: boolean;
  /** Replaces DNS in tests. */
  lookup?: (host: string) => Promise<string[]>;
  now?: () => Date;
}

/** Event types as stored; anything a hand edit or a later version left that this one doesn't know is dropped. */
function eventsOf(json: string): WebhookEvent[] {
  try {
    const list: unknown = JSON.parse(json);
    return Array.isArray(list) ? list.filter((e): e is WebhookEvent => (WEBHOOK_EVENTS as readonly unknown[]).includes(e)) : [];
  } catch {
    return [];
  }
}

function dataOf(json: string): Record<string, string> {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'));
  } catch {
    return {};
  }
}

const info = (row: typeof webhooks.$inferSelect): WebhookInfo => ({
  id: row.id, url: row.url, events: eventsOf(row.events), status: row.status, createdAt: row.createdAt,
});

/**
 * The webhooks, their delivery queue and the marks of events sent once (agents spec 7, 9). Ids and settings only; the
 * signing secret is stored encrypted and returned in plain only by `create` (once, for the person) and `claimDue` (to
 * sign). Every call fails with the operation's name only: its parameters include addresses and secrets.
 */
export class TursoWebhooks implements WebhookStore {
  private readonly now: () => Date;

  constructor(private readonly db: Db, private readonly options: WebhookOptions) {
    this.now = options.now ?? (() => new Date());
  }

  checkTarget(url: string): Promise<TargetCheck> {
    return checkTarget(url, { allowPrivate: this.options.allowPrivate, ...(this.options.lookup ? { lookup: this.options.lookup } : {}) });
  }

  async list(userId: string): Promise<WebhookInfo[]> {
    const rows = await guarded('webhooks_list_failed', () => this.db.select().from(webhooks)
      .where(eq(webhooks.userId, userId)).orderBy(asc(webhooks.createdAt), asc(webhooks.id)));
    return rows.map(info);
  }

  /**
   * The owner's active webhooks (a company server's workspace: every member's), oldest first, each on since its last
   * Turn on, else since it was added.
   */
  async subscriptions(userId: string): Promise<WebhookSubscription[]> {
    const rows = await guarded('webhooks_list_failed', () => this.db.select({
      id: webhooks.id, events: webhooks.events, createdAt: webhooks.createdAt, turnedOnAt: webhooks.turnedOnAt,
    }).from(webhooks).where(and(this.reachedBy(userId), eq(webhooks.status, 'active')))
      .orderBy(asc(webhooks.createdAt), asc(webhooks.id)));
    return rows.map((r) => ({ id: r.id, events: eventsOf(r.events), activeSince: r.turnedOnAt ?? r.createdAt }));
  }

  async create({ userId, url, events }: { userId: string; url: string; events: WebhookEvent[] }): Promise<{ webhook: WebhookInfo; secret: string }> {
    const secret = newSecret();
    const secretEnc = await symmetricEncrypt({ key: this.options.key, data: secret });
    const row = {
      id: `wh_${randomSuffix(16)}`, userId, url, events: JSON.stringify(events), secretEnc, status: 'active' as const,
      createdAt: this.now().toISOString(), firstFailureAt: null, turnedOnAt: null,
    };
    await guarded('webhooks_create_failed', () => this.db.insert(webhooks).values(row));
    return { webhook: info(row), secret };
  }

  /** The webhook and its deliveries in one batch: the deliveries only when the webhook is the person's. */
  async remove(userId: string, id: string): Promise<boolean> {
    const theirs = this.db.select({ id: webhooks.id }).from(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId)));
    const [, gone] = await guarded('webhooks_remove_failed', () => this.db.batch([
      this.db.delete(webhookDeliveries).where(inArray(webhookDeliveries.webhookId, theirs)),
      this.db.delete(webhooks).where(and(eq(webhooks.id, id), eq(webhooks.userId, userId))).returning({ id: webhooks.id }),
    ]));
    return gone.length > 0;
  }

  /**
   * Turning a webhook on that was off, in one batch: drops its waiting deliveries (not done, not given up, tried or not:
   * question 28), ends its failing streak, so the next single failure doesn't turn it off again at once, and records
   * when it was turned on. One that is on already changes nothing and drops nothing. True when the webhook is theirs.
   */
  async setStatus(userId: string, id: string, status: WebhookStatus): Promise<boolean> {
    const theirs = and(eq(webhooks.id, id), eq(webhooks.userId, userId));
    if (status !== 'active') {
      const changed = await guarded('webhooks_status_failed', () => this.db.update(webhooks).set({ status })
        .where(theirs).returning({ id: webhooks.id }));
      return changed.length > 0;
    }
    const off = and(theirs, ne(webhooks.status, 'active'));
    const [, , mine] = await guarded('webhooks_status_failed', () => this.db.batch([
      this.db.delete(webhookDeliveries).where(and(
        inArray(webhookDeliveries.webhookId, this.db.select({ id: webhooks.id }).from(webhooks).where(off)),
        isNull(webhookDeliveries.doneAt), isNull(webhookDeliveries.givenUpAt),
      )),
      this.db.update(webhooks).set({ status, firstFailureAt: null, turnedOnAt: this.now().toISOString() }).where(off),
      this.db.select({ id: webhooks.id }).from(webhooks).where(theirs),
    ]));
    return mine.length > 0;
  }

  /**
   * The webhook's newest deliveries (by when the event happened), only when it is the person's: the event id, time,
   * event and answer code; no body, no address.
   */
  async recentDeliveries(userId: string, id: string, limit: number): Promise<WebhookDelivery[] | null> {
    const [mine] = await guarded('webhooks_deliveries_failed', () => this.db.select({ id: webhooks.id }).from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId))).limit(1));
    if (!mine) return null;
    const rows = await guarded('webhooks_deliveries_failed', () => this.db.select({
      id: webhookDeliveries.id, at: webhookDeliveries.occurredAt, type: webhookDeliveries.type, status: webhookDeliveries.lastStatus,
    }).from(webhookDeliveries).where(eq(webhookDeliveries.webhookId, id))
      .orderBy(desc(webhookDeliveries.occurredAt), desc(webhookDeliveries.id)).limit(limit));
    return rows.map(({ id: eventId, at, type, status }) => ({ id: eventId, at, type, status: status ?? null }));
  }

  /**
   * Send again (question 28): a failed delivery (not done, its last answer 0 or not 2xx: given up, or waiting for its
   * next try) of the person's active webhook is due now again, not given up, its last answer cleared; the same event
   * id, and its tries go on counting. One compare-and-set on the answer and the next try as read: a sender that claimed
   * it meanwhile (the claim clears the answer) or another Send again first leaves it as it is, `sending`.
   */
  async resend(userId: string, webhookId: string, deliveryId: string): Promise<ResendOutcome> {
    const [row] = await guarded('webhooks_resend_failed', () => this.db.select({
      status: webhooks.status, lastStatus: webhookDeliveries.lastStatus, nextTryAt: webhookDeliveries.nextTryAt, doneAt: webhookDeliveries.doneAt,
    }).from(webhookDeliveries).innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId))
      .where(and(eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, webhookId), eq(webhooks.userId, userId))).limit(1));
    if (!row) return 'not_found';
    if (row.status !== 'active') return 'off';
    const { lastStatus, nextTryAt } = row;
    if (row.doneAt !== null || lastStatus === null || (lastStatus >= 200 && lastStatus < 300)) return 'not_failed';
    const changed = await guarded('webhooks_resend_failed', () => this.db.update(webhookDeliveries)
      .set({ nextTryAt: this.now().getTime(), givenUpAt: null, lastStatus: null })
      .where(and(
        eq(webhookDeliveries.id, deliveryId), eq(webhookDeliveries.webhookId, webhookId), eq(webhookDeliveries.lastStatus, lastStatus),
        nextTryAt === null ? isNull(webhookDeliveries.nextTryAt) : eq(webhookDeliveries.nextTryAt, nextTryAt), isNull(webhookDeliveries.doneAt),
      )).returning({ id: webhookDeliveries.id }));
    return changed.length > 0 ? 'queued' : 'sending';
  }

  async enqueue(userId: string, type: WebhookEvent, data: Record<string, string>, markKey?: string, only?: readonly string[]): Promise<void> {
    // To none of them: no mark either, so nothing is spent.
    if (only !== undefined && only.length === 0) return;
    const at = this.now().toISOString();
    if (markKey !== undefined) {
      const marked = await guarded('webhooks_mark_failed', () => this.db.insert(webhookMarks).values({ userId, key: markKey, at })
        .onConflictDoNothing().returning({ key: webhookMarks.key }));
      if (marked.length === 0) return;
    }
    try {
      const subscribed = (await guarded('webhooks_enqueue_failed', () => this.db.select({ id: webhooks.id, events: webhooks.events }).from(webhooks)
        .where(and(this.reachedBy(userId), eq(webhooks.status, 'active')))))
        .filter((w) => eventsOf(w.events).includes(type) && (only === undefined || only.includes(w.id))).map((w) => w.id);
      await this.queue(subscribed, type, data, at);
    } catch (error) {
      // The mark goes again, so the job's next run sends the event instead of skipping it for good.
      if (markKey !== undefined) {
        await this.db.delete(webhookMarks).where(and(eq(webhookMarks.userId, userId), eq(webhookMarks.key, markKey))).catch(() => {});
      }
      throw error;
    }
  }

  async sendTest(userId: string, id: string): Promise<string | null> {
    const [row] = await guarded('webhooks_test_failed', () => this.db.select({ id: webhooks.id }).from(webhooks)
      .where(and(eq(webhooks.id, id), eq(webhooks.userId, userId))).limit(1));
    if (!row) return null;
    return this.queue([row.id], WEBHOOK_TEST_EVENT, { webhookId: row.id }, this.now().toISOString());
  }

  /** One event id for all the webhooks it goes to; due at once. */
  private async queue(webhookIds: string[], type: string, data: Record<string, string>, occurredAt: string): Promise<string> {
    const id = `evt_${randomSuffix(16)}`;
    if (webhookIds.length === 0) return id;
    const nextTryAt = Date.parse(occurredAt);
    await guarded('webhooks_enqueue_failed', () => this.db.insert(webhookDeliveries).values(webhookIds.map((webhookId) => ({
      id, webhookId, type, data: JSON.stringify(data), occurredAt, attempts: 0, nextTryAt,
    }))));
    return id;
  }

  /**
   * Due deliveries (oldest first, at most `limit`), each claimed for this sender alone: its next try moves `leaseMs`
   * on, so another run (the scheduled job, another function's `after`) skips it while it is sent. A sender that dies
   * leaves it due again once the lease runs out. Only deliveries of active webhooks, but a test goes whatever the status.
   * The claim clears the last answer, so Settings shows it waiting and Send again leaves it alone while it is sent.
   */
  async claimDue(nowMs: number, { limit, leaseMs, userId }: { limit: number; leaseMs: number; userId?: string }): Promise<DueDelivery[]> {
    const rows = await guarded('webhooks_due_failed', () => this.db.select({
      id: webhookDeliveries.id, webhookId: webhookDeliveries.webhookId, type: webhookDeliveries.type, data: webhookDeliveries.data,
      occurredAt: webhookDeliveries.occurredAt, attempts: webhookDeliveries.attempts, nextTryAt: webhookDeliveries.nextTryAt,
      userId: webhooks.userId, url: webhooks.url, secretEnc: webhooks.secretEnc,
    }).from(webhookDeliveries).innerJoin(webhooks, eq(webhooks.id, webhookDeliveries.webhookId)).where(and(
      lte(webhookDeliveries.nextTryAt, nowMs),
      or(eq(webhooks.status, 'active'), eq(webhookDeliveries.type, WEBHOOK_TEST_EVENT)),
      ...(userId !== undefined ? [this.reachedBy(userId)] : []),
    )).orderBy(asc(webhookDeliveries.nextTryAt)).limit(limit));
    const claimed: DueDelivery[] = [];
    for (const row of rows) {
      // The last answer goes with the claim: a delivery being sent has no failure to send again.
      const won = await guarded('webhooks_claim_failed', () => this.db.update(webhookDeliveries).set({ nextTryAt: nowMs + leaseMs, lastStatus: null })
        .where(and(eq(webhookDeliveries.id, row.id), eq(webhookDeliveries.webhookId, row.webhookId), eq(webhookDeliveries.nextTryAt, row.nextTryAt!)))
        .returning({ id: webhookDeliveries.id }));
      if (won.length === 0) continue;
      let secret: string | null;
      try {
        secret = await symmetricDecrypt({ key: this.options.key, data: row.secretEnc });
      } catch {
        secret = null;
      }
      claimed.push({
        id: row.id, webhookId: row.webhookId, userId: row.userId, url: row.url, secret, type: row.type, data: dataOf(row.data),
        occurredAt: row.occurredAt, attempts: row.attempts,
      });
    }
    return claimed;
  }

  /** A 2xx answer: the delivery is done, and the webhook's failing streak ends. */
  async markDone(d: Pick<DueDelivery, 'id' | 'webhookId' | 'attempts'>, { status, nowMs }: { status: number; nowMs: number }): Promise<void> {
    await guarded('webhooks_done_failed', () => this.db.batch([
      this.db.update(webhookDeliveries).set({ attempts: d.attempts + 1, lastStatus: status, nextTryAt: null, doneAt: new Date(nowMs).toISOString() })
        .where(and(eq(webhookDeliveries.id, d.id), eq(webhookDeliveries.webhookId, d.webhookId))),
      this.db.update(webhooks).set({ firstFailureAt: null }).where(eq(webhooks.id, d.webhookId)),
    ]));
  }

  /**
   * A failed try (`status` 0 for no answer): tried again at `nextTryAt`, or given up when it is null. The webhook's
   * failing streak starts now unless it already runs; the answer is when it started.
   */
  async markFailed(
    d: Pick<DueDelivery, 'id' | 'webhookId' | 'attempts'>, { status, nowMs, nextTryAt }: { status: number; nowMs: number; nextTryAt: number | null },
  ): Promise<{ firstFailureAt: number }> {
    const [, streak] = await guarded('webhooks_failed_failed', () => this.db.batch([
      this.db.update(webhookDeliveries).set({
        attempts: d.attempts + 1, lastStatus: status, nextTryAt, givenUpAt: nextTryAt === null ? new Date(nowMs).toISOString() : null,
      }).where(and(eq(webhookDeliveries.id, d.id), eq(webhookDeliveries.webhookId, d.webhookId))),
      this.db.update(webhooks).set({ firstFailureAt: sql`coalesce(${webhooks.firstFailureAt}, ${nowMs})` })
        .where(eq(webhooks.id, d.webhookId)).returning({ firstFailureAt: webhooks.firstFailureAt }),
    ]));
    return { firstFailureAt: streak[0]?.firstFailureAt ?? nowMs };
  }

  /** Turns an active webhook off after 3 days of failures (spec 7.4). True when this call turned it off. */
  async turnOffFailing(webhookId: string): Promise<boolean> {
    const changed = await guarded('webhooks_turn_off_failed', () => this.db.update(webhooks).set({ status: 'off_failing' })
      .where(and(eq(webhooks.id, webhookId), eq(webhooks.status, 'active'))).returning({ id: webhooks.id }));
    return changed.length > 0;
  }

  /**
   * Delivered and given-up rows after 7 days, and those of a webhook that is off (never to be sent); marks after 90
   * (spec 7.4). Rows still waiting for an active webhook stay.
   */
  async prune(nowMs: number): Promise<{ deliveries: number; marks: number }> {
    const before = new Date(nowMs - DELIVERY_KEEP_MS).toISOString();
    const turnedOff = this.db.select({ id: webhooks.id }).from(webhooks).where(ne(webhooks.status, 'active'));
    const deliveries = await guarded('webhooks_prune_failed', () => this.db.delete(webhookDeliveries).where(or(
      and(isNotNull(webhookDeliveries.doneAt), lt(webhookDeliveries.doneAt, before)),
      and(isNotNull(webhookDeliveries.givenUpAt), lt(webhookDeliveries.givenUpAt, before)),
      // Never sent: their webhook turned off.
      and(lt(webhookDeliveries.occurredAt, before), inArray(webhookDeliveries.webhookId, turnedOff)),
    )).returning({ id: webhookDeliveries.id }));
    const marks = await guarded('webhooks_prune_failed', () => this.db.delete(webhookMarks)
      .where(lt(webhookMarks.at, new Date(nowMs - MARK_KEEP_MS).toISOString())).returning({ key: webhookMarks.key }));
    return { deliveries: deliveries.length, marks: marks.length };
  }

  /**
   * The webhooks an owner's events reach (plan 15): a person's own; for a company server's workspace key, every current
   * member's. A webhook stays its person's (`user_id`): only the events of the company's work fan out to them.
   */
  private reachedBy(ownerKey: string) {
    return or(
      eq(webhooks.userId, ownerKey),
      and(
        inArray(webhooks.userId, this.db.select({ personId: workspaceMembers.personId }).from(workspaceMembers)),
        sql`EXISTS (SELECT 1 FROM ${workspace} WHERE ${workspace.id} = ${ownerKey})`,
      ),
    );
  }

  /** The person's webhooks, their deliveries and the person's marks (Delete account). */
  async deleteForUser(userId: string): Promise<void> {
    const ids = (await guarded('webhooks_delete_failed', () => this.db.select({ id: webhooks.id }).from(webhooks)
      .where(eq(webhooks.userId, userId)))).map((w) => w.id);
    await guarded('webhooks_delete_failed', () => this.db.batch([
      this.db.delete(webhookDeliveries).where(ids.length > 0 ? inArray(webhookDeliveries.webhookId, ids) : sql`0`),
      this.db.delete(webhooks).where(eq(webhooks.userId, userId)),
      this.db.delete(webhookMarks).where(eq(webhookMarks.userId, userId)),
    ]));
  }
}

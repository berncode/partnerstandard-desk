import { symmetricDecrypt } from 'better-auth/crypto';
import { describe, expect, it } from 'vitest';
import { webhookDeliveries, webhookMarks, webhooks } from './schema';
import { createTestDb } from './test-db';
import { TursoWebhooks } from './turso-webhooks';
import { TursoWorkspace } from './turso-workspace';

const KEY = 'test-secret-at-least-32-characters-long';
const NOW = Date.parse('2026-11-01T09:00:00.000Z');
const DAY = 24 * 60 * 60_000;

/** A clock the test moves by hand. */
function clock(start = NOW) {
  let now = start;
  return { now: () => new Date(now), advance: (ms: number) => { now += ms; } };
}

async function setup(time = clock()) {
  const db = await createTestDb();
  const store = new TursoWebhooks(db, { key: KEY, allowPrivate: false, lookup: async () => ['93.184.215.14'], now: time.now });
  return { db, store, time };
}

const NOW_ISO = new Date(NOW).toISOString();

/** A new webhook of Anna's with one `webhook.test` delivery, tried once at NOW: answered `status`, tried again in `retryMs`, or given up (null). */
async function failedDelivery(store: TursoWebhooks, status: number, retryMs: number | null) {
  const { webhook } = await subscribe(store);
  const id = (await store.sendTest('u_anna', webhook.id))!;
  const [due] = await store.claimDue(NOW, { limit: 1, leaseMs: 60_000 });
  await store.markFailed(due!, { status, nowMs: NOW, nextTryAt: retryMs === null ? null : NOW + retryMs });
  return { webhook, id };
}

const subscribe = (store: TursoWebhooks, userId = 'u_anna', events: Array<'partner.signed' | 'review.due' | 'activity.overdue'> = ['partner.signed']) =>
  store.create({ userId, url: 'https://hooks.example.com/in', events });

describe('TursoWebhooks', () => {
  it('stores the secret encrypted, returns it once, and never lists it', async () => {
    const { db, store } = await setup();
    const { webhook, secret } = await subscribe(store);
    expect(webhook).toEqual({ id: webhook.id, url: 'https://hooks.example.com/in', events: ['partner.signed'], status: 'active', createdAt: '2026-11-01T09:00:00.000Z' });
    expect(webhook.id).toMatch(/^wh_[0-9a-z]{16}$/);
    expect(secret).toMatch(/^whsec_/);
    const [row] = await db.select().from(webhooks);
    expect(row!.secretEnc).not.toContain(secret.slice(6));
    expect(await symmetricDecrypt({ key: KEY, data: row!.secretEnc })).toBe(secret);
    expect(JSON.stringify(await store.list('u_anna'))).not.toContain(secret);
  });

  it('enqueue with the same markKey twice adds one delivery', async () => {
    const { db, store } = await setup();
    await subscribe(store, 'u_anna', ['activity.overdue']);
    await store.enqueue('u_anna', 'activity.overdue', { mapId: 'map_1', activityId: 'act_1' }, 'overdue:act_1:2026-10-30');
    await store.enqueue('u_anna', 'activity.overdue', { mapId: 'map_1', activityId: 'act_1' }, 'overdue:act_1:2026-10-30');
    expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
    expect(await db.select().from(webhookMarks)).toEqual([{ userId: 'u_anna', key: 'overdue:act_1:2026-10-30', at: '2026-11-01T09:00:00.000Z' }]);
    // Another due date is another event.
    await store.enqueue('u_anna', 'activity.overdue', { mapId: 'map_1', activityId: 'act_1' }, 'overdue:act_1:2026-11-05');
    expect(await db.select().from(webhookDeliveries)).toHaveLength(2);
  });

  it('a mark is the person’s own: Ben’s same key still sends his', async () => {
    const { db, store } = await setup();
    await subscribe(store, 'u_anna', ['review.due']);
    await subscribe(store, 'u_ben', ['review.due']);
    await store.enqueue('u_anna', 'review.due', { mapId: 'map_1' }, 'review:rv_1');
    await store.enqueue('u_ben', 'review.due', { mapId: 'map_2' }, 'review:rv_1');
    expect(await db.select().from(webhookDeliveries)).toHaveLength(2);
  });

  it('data holds only the given ids', async () => {
    const { db, store } = await setup();
    const { webhook } = await subscribe(store);
    await store.enqueue('u_anna', 'partner.signed', { accountId: 'acc_1', partnerId: 'ptn_1' });
    const rows = await db.select().from(webhookDeliveries);
    expect(rows).toEqual([{
      id: expect.stringMatching(/^evt_[0-9a-z]{16}$/), webhookId: webhook.id, type: 'partner.signed', data: '{"accountId":"acc_1","partnerId":"ptn_1"}',
      occurredAt: '2026-11-01T09:00:00.000Z', attempts: 0, nextTryAt: NOW, lastStatus: null, doneAt: null, givenUpAt: null,
    }]);
  });

  it('one event to every active webhook subscribed to it, with one event id; none to others', async () => {
    const { db, store } = await setup();
    const a = await subscribe(store, 'u_anna', ['partner.signed']);
    const b = await subscribe(store, 'u_anna', ['partner.signed', 'review.due']);
    await subscribe(store, 'u_anna', ['review.due']);
    const off = await subscribe(store, 'u_anna', ['partner.signed']);
    await store.setStatus('u_anna', off.webhook.id, 'off');
    await subscribe(store, 'u_ben', ['partner.signed']);
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_1' });
    const rows = await db.select().from(webhookDeliveries);
    expect(rows.map((r) => r.webhookId).sort()).toEqual([a.webhook.id, b.webhook.id].sort());
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
  });

  it('remove and setStatus act only on the person’s own webhook', async () => {
    const { store } = await setup();
    const { webhook } = await subscribe(store);
    expect(await store.remove('u_ben', webhook.id)).toBe(false);
    expect(await store.setStatus('u_ben', webhook.id, 'off')).toBe(false);
    expect(await store.sendTest('u_ben', webhook.id)).toBeNull();
    expect((await store.list('u_anna')).map((w) => w.status)).toEqual(['active']);
    expect(await store.remove('u_anna', webhook.id)).toBe(true);
    expect(await store.list('u_anna')).toEqual([]);
  });

  it('remove takes the webhook’s deliveries with it, and Ben’s try touches neither', async () => {
    const { db, store } = await setup();
    const { webhook } = await subscribe(store);
    const other = await subscribe(store);
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_1' });
    expect(await store.remove('u_ben', webhook.id)).toBe(false);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(2);
    expect(await store.remove('u_anna', webhook.id)).toBe(true);
    expect((await db.select().from(webhookDeliveries)).map((d) => d.webhookId)).toEqual([other.webhook.id]);
  });

  it('claimDue hands each due delivery to one sender, with its secret, and not again until its lease runs out', async () => {
    const { store, time } = await setup();
    const { webhook, secret } = await subscribe(store);
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_1' });
    const [first] = await store.claimDue(NOW, { limit: 10, leaseMs: 60_000 });
    expect(first).toMatchObject({ webhookId: webhook.id, userId: 'u_anna', url: 'https://hooks.example.com/in', secret, type: 'partner.signed', data: { partnerId: 'ptn_1' }, attempts: 0 });
    expect(await store.claimDue(NOW, { limit: 10, leaseMs: 60_000 })).toEqual([]);
    time.advance(61_000);
    expect(await store.claimDue(NOW + 61_000, { limit: 10, leaseMs: 60_000 })).toHaveLength(1);
  });

  it('on a company server, the workspace’s event goes to every member’s own webhooks, and to no one else’s (plan 15)', async () => {
    const { db, store } = await setup();
    const ws = new TursoWorkspace(db);
    const key = await ws.key();
    await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
    await ws.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
    const annas = await subscribe(store, 'u_anna', ['partner.signed']);
    const bens = await subscribe(store, 'u_ben', ['partner.signed']);
    await subscribe(store, 'u_gone', ['partner.signed']);
    await store.enqueue(key, 'partner.signed', { partnerId: 'ptn_1' });
    const rows = await db.select().from(webhookDeliveries);
    expect(rows.map((r) => r.webhookId).sort()).toEqual([annas.webhook.id, bens.webhook.id].sort());
    expect(new Set(rows.map((r) => r.id)).size).toBe(1);
    expect((await store.subscriptions(key)).map((w) => w.id).sort()).toEqual([annas.webhook.id, bens.webhook.id].sort());
    // Sending soon for the workspace sends both; each webhook stays its person's.
    expect((await store.claimDue(NOW, { limit: 10, leaseMs: 60_000, userId: key })).map((d) => d.userId).sort()).toEqual(['u_anna', 'u_ben']);
    expect((await store.list('u_ben')).map((w) => w.id)).toEqual([bens.webhook.id]);
    expect(await store.list(key)).toEqual([]);
  });

  it('a removed member’s webhooks hear no more of the workspace, and a key that isn’t a workspace reaches only its person', async () => {
    const { db, store } = await setup();
    const ws = new TursoWorkspace(db);
    const key = await ws.key();
    await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
    await ws.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
    const annas = await subscribe(store, 'u_anna', ['partner.signed']);
    await subscribe(store, 'u_ben', ['partner.signed']);
    await ws.removeMember('u_ben');
    await store.enqueue(key, 'partner.signed', { partnerId: 'ptn_1' });
    await store.enqueue('ws_notthisone', 'partner.signed', { partnerId: 'ptn_2' });
    expect((await db.select().from(webhookDeliveries)).map((r) => r.webhookId)).toEqual([annas.webhook.id]);
  });

  it('claimDue for one person leaves the others’ deliveries', async () => {
    const { store } = await setup();
    await subscribe(store, 'u_anna');
    await subscribe(store, 'u_ben');
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_1' });
    await store.enqueue('u_ben', 'partner.signed', { partnerId: 'ptn_2' });
    expect((await store.claimDue(NOW, { limit: 10, leaseMs: 60_000, userId: 'u_ben' })).map((d) => d.userId)).toEqual(['u_ben']);
  });

  it('prune removes delivered and given-up rows after 7 days and marks after 90', async () => {
    const { db, store } = await setup();
    await subscribe(store, 'u_anna', ['review.due']);
    await store.enqueue('u_anna', 'review.due', { mapId: 'map_1' }, 'review:rv_1');
    const [delivery] = await store.claimDue(NOW, { limit: 1, leaseMs: 60_000 });
    await store.markDone(delivery!, { status: 200, nowMs: NOW });
    await store.enqueue('u_anna', 'review.due', { mapId: 'map_2' });
    await store.prune(NOW + 7 * DAY - 1);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(2);
    await store.prune(NOW + 7 * DAY + 1);
    // The one still waiting stays.
    expect((await db.select().from(webhookDeliveries)).map((r) => r.data)).toEqual(['{"mapId":"map_2"}']);
    expect(await db.select().from(webhookMarks)).toHaveLength(1);
    await store.prune(NOW + 90 * DAY + 1);
    expect(await db.select().from(webhookMarks)).toEqual([]);
  });

  it('prune also removes, after 7 days, what waits for a webhook that is off', async () => {
    const { db, store } = await setup();
    const off = await subscribe(store, 'u_anna', ['review.due']);
    const on = await subscribe(store, 'u_anna', ['review.due']);
    await store.enqueue('u_anna', 'review.due', { mapId: 'map_1' });
    await store.setStatus('u_anna', off.webhook.id, 'off_failing');
    await store.prune(NOW + 7 * DAY + 1);
    expect((await db.select().from(webhookDeliveries)).map((r) => r.webhookId)).toEqual([on.webhook.id]);
  });

  it('deleteForUser removes the person’s webhooks, their deliveries and marks, and only theirs', async () => {
    const { db, store } = await setup();
    await subscribe(store, 'u_anna', ['review.due']);
    const ben = await subscribe(store, 'u_ben', ['review.due']);
    await store.enqueue('u_anna', 'review.due', { mapId: 'map_1' }, 'review:rv_1');
    await store.enqueue('u_ben', 'review.due', { mapId: 'map_2' }, 'review:rv_2');
    await store.deleteForUser('u_anna');
    expect((await db.select().from(webhooks)).map((w) => w.id)).toEqual([ben.webhook.id]);
    expect((await db.select().from(webhookDeliveries)).map((d) => d.webhookId)).toEqual([ben.webhook.id]);
    expect((await db.select().from(webhookMarks)).map((m) => m.userId)).toEqual(['u_ben']);
  });

  it('recentDeliveries answers the newest first, at most the limit, with time, event and answer code only', async () => {
    const { store, time } = await setup();
    const { webhook } = await subscribe(store, 'u_anna', ['partner.signed']);
    const other = await subscribe(store, 'u_anna', ['review.due']);
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_1' });
    const [signed] = await store.claimDue(NOW, { limit: 10, leaseMs: 60_000 });
    await store.markDone(signed!, { status: 204, nowMs: NOW });
    time.advance(60_000);
    await store.sendTest('u_anna', webhook.id);
    const [test] = await store.claimDue(NOW + 60_000, { limit: 10, leaseMs: 60_000 });
    await store.markFailed(test!, { status: 0, nowMs: NOW + 60_000, nextTryAt: NOW + 120_000 });
    time.advance(60_000);
    await store.sendTest('u_anna', webhook.id);
    await store.sendTest('u_anna', other.webhook.id);

    const list = await store.recentDeliveries('u_anna', webhook.id, 10);
    const evt = expect.stringMatching(/^evt_/);
    expect(list).toEqual([
      { id: evt, at: '2026-11-01T09:02:00.000Z', type: 'webhook.test', status: null },
      { id: evt, at: '2026-11-01T09:01:00.000Z', type: 'webhook.test', status: 0 },
      { id: evt, at: '2026-11-01T09:00:00.000Z', type: 'partner.signed', status: 204 },
    ]);
    expect(await store.recentDeliveries('u_anna', webhook.id, 2)).toEqual(list!.slice(0, 2));
    expect(await store.recentDeliveries('u_anna', other.webhook.id, 10)).toEqual([{ id: evt, at: '2026-11-01T09:02:00.000Z', type: 'webhook.test', status: null }]);
  });

  it('recentDeliveries is null for another person’s webhook or a missing one', async () => {
    const { store } = await setup();
    const { webhook } = await subscribe(store);
    await store.sendTest('u_anna', webhook.id);
    expect(await store.recentDeliveries('u_ben', webhook.id, 10)).toBeNull();
    expect(await store.recentDeliveries('u_anna', 'wh_missing', 10)).toBeNull();
    expect(await store.recentDeliveries('u_anna', webhook.id, 10)).toHaveLength(1);
  });

  it('turning a webhook on ends its failing streak; turning it off keeps it', async () => {
    const { db, store } = await setup();
    const { webhook } = await subscribe(store);
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_1' });
    const [due] = await store.claimDue(NOW, { limit: 1, leaseMs: 60_000 });
    await store.markFailed(due!, { status: 500, nowMs: NOW, nextTryAt: NOW + 60_000 });
    expect(await store.turnOffFailing(webhook.id)).toBe(true);
    expect(await store.setStatus('u_anna', webhook.id, 'off')).toBe(true);
    expect((await db.select().from(webhooks))[0]).toMatchObject({ status: 'off', firstFailureAt: NOW });
    expect(await store.setStatus('u_anna', webhook.id, 'active')).toBe(true);
    expect((await db.select().from(webhooks))[0]).toMatchObject({ status: 'active', firstFailureAt: null });
  });

  it('subscriptions answers the person’s active webhooks with when they were turned on', async () => {
    const time = clock();
    const { store } = await setup(time);
    const a = await subscribe(store, 'u_anna', ['activity.overdue']);
    time.advance(DAY);
    const b = await subscribe(store, 'u_anna', ['review.due', 'activity.overdue']);
    const off = await subscribe(store, 'u_anna', ['review.due']);
    await store.setStatus('u_anna', off.webhook.id, 'off');
    await subscribe(store, 'u_ben', ['review.due']);
    // Until a Turn on, a webhook is on since it was added.
    expect(await store.subscriptions('u_anna')).toEqual([
      { id: a.webhook.id, events: ['activity.overdue'], activeSince: '2026-11-01T09:00:00.000Z' },
      { id: b.webhook.id, events: ['review.due', 'activity.overdue'], activeSince: '2026-11-02T09:00:00.000Z' },
    ]);
    time.advance(DAY);
    await store.setStatus('u_anna', a.webhook.id, 'off');
    await store.setStatus('u_anna', a.webhook.id, 'active');
    expect((await store.subscriptions('u_anna')).find((s) => s.id === a.webhook.id))
      .toEqual({ id: a.webhook.id, events: ['activity.overdue'], activeSince: '2026-11-03T09:00:00.000Z' });
    expect((await store.subscriptions('u_ben')).map((s) => s.events)).toEqual([['review.due']]);
    expect(await store.subscriptions('u_cleo')).toEqual([]);
  });

  it('enqueue with only sends to those webhooks alone, and still to none that is off or not subscribed', async () => {
    const { db, store } = await setup();
    const a = await subscribe(store, 'u_anna', ['activity.overdue']);
    await subscribe(store, 'u_anna', ['activity.overdue']);
    const off = await subscribe(store, 'u_anna', ['activity.overdue']);
    await store.setStatus('u_anna', off.webhook.id, 'off');
    const other = await subscribe(store, 'u_anna', ['review.due']);
    const ben = await subscribe(store, 'u_ben', ['activity.overdue']);
    await store.enqueue('u_anna', 'activity.overdue', { activityId: 'act_1' }, 'overdue:act_1:2026-10-30',
      [a.webhook.id, off.webhook.id, other.webhook.id, ben.webhook.id]);
    expect((await db.select().from(webhookDeliveries)).map((d) => d.webhookId)).toEqual([a.webhook.id]);
    expect(await db.select().from(webhookMarks)).toHaveLength(1);
    // Without `only`, as before: every active webhook of the person subscribed to it.
    await store.enqueue('u_anna', 'activity.overdue', { activityId: 'act_2' });
    expect(await db.select().from(webhookDeliveries)).toHaveLength(3);
  });

  it('enqueue with an empty only makes no mark and queues nothing', async () => {
    const { db, store } = await setup();
    await subscribe(store, 'u_anna', ['activity.overdue']);
    await store.enqueue('u_anna', 'activity.overdue', { activityId: 'act_1' }, 'overdue:act_1:2026-10-30', []);
    expect(await db.select().from(webhookDeliveries)).toEqual([]);
    expect(await db.select().from(webhookMarks)).toEqual([]);
    // The same key still goes once a webhook passes.
    await store.enqueue('u_anna', 'activity.overdue', { activityId: 'act_1' }, 'overdue:act_1:2026-10-30');
    expect(await db.select().from(webhookDeliveries)).toHaveLength(1);
  });

  it('turning on records when, only for a webhook that was off', async () => {
    const time = clock();
    const { db, store } = await setup(time);
    const { webhook } = await subscribe(store);
    const turnedOnAt = async () => (await db.select().from(webhooks))[0]!.turnedOnAt;
    expect(await turnedOnAt()).toBeNull();
    // On already: no new "on since".
    time.advance(DAY);
    expect(await store.setStatus('u_anna', webhook.id, 'active')).toBe(true);
    expect(await turnedOnAt()).toBeNull();
    await store.setStatus('u_anna', webhook.id, 'off');
    expect(await turnedOnAt()).toBeNull();
    time.advance(DAY);
    await store.setStatus('u_anna', webhook.id, 'active');
    expect(await turnedOnAt()).toBe('2026-11-03T09:00:00.000Z');
    time.advance(DAY);
    await store.setStatus('u_anna', webhook.id, 'active');
    expect(await turnedOnAt()).toBe('2026-11-03T09:00:00.000Z');
    // Turned off after 3 days of failures, then on again: on since then.
    await store.turnOffFailing(webhook.id);
    time.advance(DAY);
    await store.setStatus('u_anna', webhook.id, 'active');
    expect(await turnedOnAt()).toBe('2026-11-05T09:00:00.000Z');
  });

  it('recentDeliveries gives each delivery’s event id', async () => {
    const { store, time } = await setup();
    const { webhook } = await subscribe(store);
    const first = await store.sendTest('u_anna', webhook.id);
    time.advance(60_000);
    const second = await store.sendTest('u_anna', webhook.id);
    expect((await store.recentDeliveries('u_anna', webhook.id, 10))!.map((d) => d.id)).toEqual([second, first]);
  });

  it('claimDue clears the last answer of what it claims', async () => {
    const { store } = await setup();
    const { webhook } = await subscribe(store);
    await store.sendTest('u_anna', webhook.id);
    const [first] = await store.claimDue(NOW, { limit: 1, leaseMs: 60_000 });
    await store.markFailed(first!, { status: 500, nowMs: NOW, nextTryAt: NOW + 60_000 });
    const answer = async () => (await store.recentDeliveries('u_anna', webhook.id, 10))![0]!.status;
    expect(await answer()).toBe(500);
    const [again] = await store.claimDue(NOW + 60_000, { limit: 1, leaseMs: 60_000 });
    expect(again).toMatchObject({ id: first!.id, attempts: 1 });
    // Being sent: no answer to show yet.
    expect(await answer()).toBeNull();
    await store.markFailed(again!, { status: 502, nowMs: NOW + 60_000, nextTryAt: NOW + 180_000 });
    expect(await answer()).toBe(502);
  });

  it('turning a webhook on drops its waiting deliveries, keeps delivered and given-up ones, and ends its failing streak', async () => {
    const { db, store, time } = await setup();
    const { webhook } = await subscribe(store);
    const other = await subscribe(store);
    const at = () => time.now().getTime();
    // Delivered.
    const delivered = await store.sendTest('u_anna', webhook.id);
    await store.markDone((await store.claimDue(at(), { limit: 1, leaseMs: 60_000 }))[0]!, { status: 200, nowMs: at() });
    time.advance(60_000);
    // Given up.
    const givenUp = await store.sendTest('u_anna', webhook.id);
    await store.markFailed((await store.claimDue(at(), { limit: 1, leaseMs: 60_000 }))[0]!, { status: 500, nowMs: at(), nextTryAt: null });
    time.advance(60_000);
    // Tried, waiting for its next try.
    await store.sendTest('u_anna', webhook.id);
    await store.markFailed((await store.claimDue(at(), { limit: 1, leaseMs: 60_000 }))[0]!, { status: 0, nowMs: at(), nextTryAt: at() + 3_600_000 });
    time.advance(60_000);
    // Never tried yet, and one for the other webhook.
    await store.sendTest('u_anna', webhook.id);
    const others = await store.sendTest('u_anna', other.webhook.id);
    await store.setStatus('u_anna', webhook.id, 'off');
    await store.setStatus('u_anna', other.webhook.id, 'off');
    expect((await db.select().from(webhooks)).find((w) => w.id === webhook.id)!.firstFailureAt).not.toBeNull();

    expect(await store.setStatus('u_anna', webhook.id, 'active')).toBe(true);
    const left = (await db.select().from(webhookDeliveries)).map((d) => `${d.webhookId} ${d.id}`).sort();
    expect(left).toEqual([`${webhook.id} ${delivered}`, `${webhook.id} ${givenUp}`, `${other.webhook.id} ${others}`].sort());
    expect((await db.select().from(webhooks)).find((w) => w.id === webhook.id)).toMatchObject({ status: 'active', firstFailureAt: null });
  });

  it('turning on a webhook that is on already drops nothing', async () => {
    const { db, store, time } = await setup();
    const { webhook } = await subscribe(store);
    await store.sendTest('u_anna', webhook.id);
    await store.markFailed((await store.claimDue(NOW, { limit: 1, leaseMs: 60_000 }))[0]!, { status: 500, nowMs: NOW, nextTryAt: NOW + 60_000 });
    await store.sendTest('u_anna', webhook.id);
    time.advance(DAY);
    // A second click on Turn on, or a stale Settings page.
    expect(await store.setStatus('u_anna', webhook.id, 'active')).toBe(true);
    expect(await db.select().from(webhookDeliveries)).toHaveLength(2);
    expect((await db.select().from(webhooks))[0]).toMatchObject({ status: 'active', turnedOnAt: null, firstFailureAt: NOW });
    // Both still go out.
    expect(await store.claimDue(NOW + DAY, { limit: 10, leaseMs: 60_000 })).toHaveLength(2);
    // Ben's Turn on of Anna's webhook is refused.
    expect(await store.setStatus('u_ben', webhook.id, 'active')).toBe(false);
  });

  it('resend puts a failed delivery back with the same event id: due now, waiting, not given up', async () => {
    const { db, store, time } = await setup();
    const { webhook, id } = await failedDelivery(store, 500, null);
    expect((await db.select().from(webhookDeliveries))[0]).toMatchObject({ lastStatus: 500, nextTryAt: null, givenUpAt: NOW_ISO });
    time.advance(DAY);
    expect(await store.resend('u_anna', webhook.id, id)).toBe('queued');
    expect((await db.select().from(webhookDeliveries))[0]).toMatchObject({ id, lastStatus: null, nextTryAt: NOW + DAY, givenUpAt: null, doneAt: null, attempts: 1 });
    expect((await store.recentDeliveries('u_anna', webhook.id, 10))!.map((d) => ({ id: d.id, status: d.status }))).toEqual([{ id, status: null }]);
    const [due] = await store.claimDue(NOW + DAY, { limit: 10, leaseMs: 60_000 });
    expect(due).toMatchObject({ id, webhookId: webhook.id, attempts: 1 });
  });

  it('resend also takes one waiting for its next try', async () => {
    const { db, store } = await setup();
    const { webhook, id } = await failedDelivery(store, 0, 30 * 60_000);
    expect(await store.resend('u_anna', webhook.id, id)).toBe('queued');
    expect((await db.select().from(webhookDeliveries))[0]).toMatchObject({ lastStatus: null, nextTryAt: NOW, givenUpAt: null, attempts: 1 });
    expect(await store.claimDue(NOW, { limit: 10, leaseMs: 60_000 })).toHaveLength(1);
  });

  it('resend refuses a delivered one, one waiting for its first try, one being sent, one of a webhook turned off, and another person’s', async () => {
    {
      const { store } = await setup();
      const { webhook } = await subscribe(store);
      const id = (await store.sendTest('u_anna', webhook.id))!;
      // Waiting for its first try.
      expect(await store.resend('u_anna', webhook.id, id)).toBe('not_failed');
      await store.markDone((await store.claimDue(NOW, { limit: 1, leaseMs: 60_000 }))[0]!, { status: 200, nowMs: NOW });
      // Delivered.
      expect(await store.resend('u_anna', webhook.id, id)).toBe('not_failed');
    }
    {
      const { store } = await setup();
      const { webhook, id } = await failedDelivery(store, 500, 60_000);
      // Claimed by a sender: its answer is cleared while it is sent.
      expect(await store.claimDue(NOW + 60_000, { limit: 1, leaseMs: 60_000 })).toHaveLength(1);
      expect(await store.resend('u_anna', webhook.id, id)).toBe('not_failed');
    }
    {
      const { db, store } = await setup();
      const { webhook, id } = await failedDelivery(store, 500, null);
      await store.setStatus('u_anna', webhook.id, 'off');
      expect(await store.resend('u_anna', webhook.id, id)).toBe('off');
      expect(await store.resend('u_ben', webhook.id, id)).toBe('not_found');
      expect(await store.resend('u_anna', webhook.id, 'evt_missing')).toBe('not_found');
      expect(await store.resend('u_anna', 'wh_missing', id)).toBe('not_found');
      // Nothing changed.
      expect((await db.select().from(webhookDeliveries))[0]).toMatchObject({ lastStatus: 500, nextTryAt: null, givenUpAt: NOW_ISO });
    }
  });

  it('two Send again of one delivery: the first is queued, the second refused', async () => {
    const { store } = await setup();
    const { webhook, id } = await failedDelivery(store, 503, null);
    expect(await store.resend('u_anna', webhook.id, id)).toBe('queued');
    expect(await store.resend('u_anna', webhook.id, id)).toBe('not_failed');
    expect(await store.claimDue(NOW, { limit: 10, leaseMs: 60_000 })).toHaveLength(1);
  });

  it('two Send again of one delivery at the same moment: exactly one is queued, and the row is sent once', async () => {
    const { store } = await setup();
    const { webhook, id } = await failedDelivery(store, 503, null);
    const outcomes = await Promise.all([store.resend('u_anna', webhook.id, id), store.resend('u_anna', webhook.id, id)]);
    expect(outcomes.filter((o) => o === 'queued')).toHaveLength(1);
    expect(outcomes.filter((o) => o !== 'queued').every((o) => o === 'sending' || o === 'not_failed')).toBe(true);
    expect(await store.claimDue(NOW, { limit: 10, leaseMs: 60_000 })).toHaveLength(1);
    expect(await store.claimDue(NOW, { limit: 10, leaseMs: 60_000 })).toEqual([]);
  });

  it('Send again racing the sender for a row due for its retry: the row is handed out at most once while its lease holds', async () => {
    // Both orders: the sender's claim can land before Send again reads the row, or between its read and its write.
    for (const senderFirst of [true, false]) {
      const { db, store, time } = await setup();
      const { webhook, id } = await failedDelivery(store, 500, 60_000);
      time.advance(90_000);
      const now = NOW + 90_000;
      const claim = () => store.claimDue(now, { limit: 10, leaseMs: 60_000 });
      const resend = () => store.resend('u_anna', webhook.id, id);
      const [resent, claimed] = senderFirst
        ? await Promise.all([claim(), resend()]).then(([c, r]) => [r, c] as const)
        : await Promise.all([resend(), claim()]);
      expect(['queued', 'sending', 'not_failed']).toContain(resent);
      const again = await claim();
      // Whoever went first, one sender holds it: Send again never makes it due again under that sender's lease.
      expect(claimed.length + again.length).toBe(1);
      expect(await store.claimDue(now + 30_000, { limit: 10, leaseMs: 60_000 })).toEqual([]);
      expect((await db.select().from(webhookDeliveries))[0]).toMatchObject({ id, lastStatus: null, doneAt: null });
    }
  });

  it('a failed query names the operation only', async () => {
    const { db, store } = await setup();
    await db.run('DROP TABLE webhooks');
    await expect(store.list('u_anna')).rejects.toThrow(/^webhooks_list_failed$/);
  });
});

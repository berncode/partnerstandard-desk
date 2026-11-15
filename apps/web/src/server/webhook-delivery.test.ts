import { createHmac } from 'node:crypto';
import { schema, TursoWebhooks, type Db } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CLAIM_LEASE_MS, deliverDue, type DeliveryDeps, type WebhookRequest } from './webhook-delivery';

const KEY = 'test-secret-at-least-32-characters-long';
const NOW = new Date('2026-11-01T09:00:00.000Z');
const DAY = 24 * 60 * 60_000;
const URL_IN = 'https://hooks.example.com/in?token=SECRET-QUERY';

let db: Db;
let store: TursoWebhooks;
let lines: Array<[string, Record<string, string>]>;

beforeEach(async () => {
  db = await createTestDb();
  store = new TursoWebhooks(db, { key: KEY, allowPrivate: false, lookup: async () => ['93.184.215.14'], now: () => NOW });
  lines = [];
});

/** A sender that answers `status` (a number, or a function of the request) and notes each request. */
function fakeSend(status: number | ((url: string, request: WebhookRequest) => Promise<number>)) {
  return vi.fn<(url: string, request: WebhookRequest) => Promise<number>>(async (url, request) =>
    typeof status === 'number' ? status : status(url, request));
}

function depsWith(send: ReturnType<typeof fakeSend>, extra: Partial<DeliveryDeps> = {}): DeliveryDeps {
  return {
    store, send, checkTarget: async () => ({ ok: true }), clock: () => NOW.getTime(),
    log: (event, ids) => { lines.push([event, ids]); }, ...extra,
  };
}

async function oneSigned() {
  const made = await store.create({ userId: 'u_anna', url: URL_IN, events: ['partner.signed'] });
  await store.enqueue('u_anna', 'partner.signed', { accountId: 'acc_1', partnerId: 'ptn_1', mapId: 'map_1' });
  return made;
}

const deliveries = () => db.select().from(schema.webhookDeliveries);
const hooks = () => db.select().from(schema.webhooks);
const opts = { deadlineMs: 20_000 };

describe('deliverDue', () => {
  it('a 200 marks done', async () => {
    await oneSigned();
    const send = fakeSend(200);
    expect(await deliverDue(depsWith(send), NOW, opts)).toEqual({ sent: 1, failed: 0, turnedOff: 0 });
    expect(await deliveries()).toEqual([expect.objectContaining({ attempts: 1, lastStatus: 200, doneAt: NOW.toISOString(), nextTryAt: null, givenUpAt: null })]);
    // Done: never sent again.
    expect(await deliverDue(depsWith(send), new Date(NOW.getTime() + DAY), opts)).toEqual({ sent: 0, failed: 0, turnedOff: 0 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('a 500 schedules the next try', async () => {
    await oneSigned();
    expect(await deliverDue(depsWith(fakeSend(500)), NOW, opts)).toEqual({ sent: 0, failed: 1, turnedOff: 0 });
    expect(await deliveries()).toEqual([expect.objectContaining({ attempts: 1, lastStatus: 500, nextTryAt: NOW.getTime() + 60_000, doneAt: null, givenUpAt: null })]);
    expect((await hooks())[0]).toMatchObject({ status: 'active', firstFailureAt: NOW.getTime() });
    // Not before its time.
    const send = fakeSend(200);
    expect(await deliverDue(depsWith(send), new Date(NOW.getTime() + 59_000), opts)).toEqual({ sent: 0, failed: 0, turnedOff: 0 });
    expect(send).not.toHaveBeenCalled();
    // A success clears the failing streak.
    expect(await deliverDue(depsWith(send), new Date(NOW.getTime() + 60_000), opts)).toEqual({ sent: 1, failed: 0, turnedOff: 0 });
    expect((await hooks())[0]).toMatchObject({ status: 'active', firstFailureAt: null });
  });

  it('a 302 counts as a failure and is not followed', async () => {
    await oneSigned();
    // The sender never follows a redirect (postWebhook's own test): its 3xx is the answer.
    const send = fakeSend(302);
    expect(await deliverDue(depsWith(send), NOW, opts)).toEqual({ sent: 0, failed: 1, turnedOff: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await deliveries())[0]).toMatchObject({ lastStatus: 302, doneAt: null, nextTryAt: NOW.getTime() + 60_000 });
  });

  it('a target that now resolves privately fails without a request', async () => {
    await oneSigned();
    const send = fakeSend(200);
    const checkTarget = vi.fn(async () => ({ ok: false as const, reason: 'private_address' as const }));
    expect(await deliverDue(depsWith(send, { checkTarget }), NOW, opts)).toEqual({ sent: 0, failed: 1, turnedOff: 0 });
    expect(checkTarget).toHaveBeenCalledWith(URL_IN);
    expect(send).not.toHaveBeenCalled();
    expect((await deliveries())[0]).toMatchObject({ attempts: 1, lastStatus: 0, nextTryAt: NOW.getTime() + 60_000 });
  });

  it('the request carries the three webhook headers and the JSON body of spec §7.3', async () => {
    const { secret } = await oneSigned();
    const send = fakeSend(204);
    await deliverDue(depsWith(send), NOW, opts);
    const [url, request] = send.mock.calls[0]!;
    expect(url).toBe(URL_IN);
    const [row] = await deliveries();
    const body = JSON.parse(request.body);
    expect(body).toEqual({ type: 'partner.signed', id: row!.id, occurredAt: '2026-11-01T09:00:00.000Z', data: { accountId: 'acc_1', partnerId: 'ptn_1', mapId: 'map_1' } });
    const headers = new Headers(request.headers);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('webhook-id')).toBe(row!.id);
    expect(headers.get('webhook-timestamp')).toBe(String(NOW.getTime() / 1000));
    const expected = createHmac('sha256', Buffer.from(secret.slice(6), 'base64'))
      .update(`${row!.id}.${NOW.getTime() / 1000}.${request.body}`).digest('base64');
    expect(headers.get('webhook-signature')).toBe(`v1,${expected}`);
  });

  it('a delivery sent again keeps its webhook-id and is signed at its new time', async () => {
    let storeNow = NOW.getTime();
    store = new TursoWebhooks(db, { key: KEY, allowPrivate: false, lookup: async () => ['93.184.215.14'], now: () => new Date(storeNow) });
    const { webhook, secret } = await oneSigned();
    const send = fakeSend(500);
    await deliverDue(depsWith(send), NOW, opts);
    const [row] = await deliveries();
    // Send again 30 seconds later, while its first retry (60 s after the failure) isn't due yet: without Send again
    // nothing would go at that time.
    const later = NOW.getTime() + 30_000;
    expect((await deliveries())[0]!.nextTryAt).toBeGreaterThan(later);
    storeNow = later;
    expect(await store.resend('u_anna', webhook.id, row!.id)).toBe('queued');
    expect(await deliverDue(depsWith(send, { clock: () => later }), new Date(later), opts)).toEqual({ sent: 0, failed: 1, turnedOff: 0 });
    expect(send).toHaveBeenCalledTimes(2);
    const [first, second] = send.mock.calls.map(([, request]) => new Headers(request.headers));
    expect(second!.get('webhook-id')).toBe(row!.id);
    expect(second!.get('webhook-id')).toBe(first!.get('webhook-id'));
    expect(first!.get('webhook-timestamp')).toBe(String(NOW.getTime() / 1000));
    expect(second!.get('webhook-timestamp')).toBe(String(later / 1000));
    const key = Buffer.from(secret.slice(6), 'base64');
    for (const [index, headers] of [first!, second!].entries()) {
      const body = send.mock.calls[index]![1].body;
      const expected = createHmac('sha256', key).update(`${headers.get('webhook-id')}.${headers.get('webhook-timestamp')}.${body}`).digest('base64');
      expect(headers.get('webhook-signature')).toBe(`v1,${expected}`);
    }
    expect(second!.get('webhook-signature')).not.toBe(first!.get('webhook-signature'));
    // Its tries go on counting.
    expect((await deliveries())[0]).toMatchObject({ attempts: 2, lastStatus: 500 });
  });

  it('no answer (a timeout or a refused connection) is a failure with status 0, and so is a sender that throws', async () => {
    await oneSigned();
    expect(await deliverDue(depsWith(fakeSend(0)), NOW, opts)).toEqual({ sent: 0, failed: 1, turnedOff: 0 });
    expect((await deliveries())[0]).toMatchObject({ attempts: 1, lastStatus: 0 });
    const throwing = fakeSend(async () => { throw new Error('SECRET socket text'); });
    expect(await deliverDue(depsWith(throwing), new Date(NOW.getTime() + 60_000), opts)).toEqual({ sent: 0, failed: 1, turnedOff: 0 });
    expect((await deliveries())[0]).toMatchObject({ attempts: 2, lastStatus: 0 });
    expect(JSON.stringify(lines)).not.toContain('SECRET');
  });

  it('gives up after the last retry', async () => {
    await oneSigned();
    await db.update(schema.webhookDeliveries).set({ attempts: 6 });
    await deliverDue(depsWith(fakeSend(500)), NOW, opts);
    expect((await deliveries())[0]).toMatchObject({ attempts: 7, nextTryAt: null, givenUpAt: NOW.toISOString(), doneAt: null });
  });

  it('a webhook failing for 3 days turns off, and its waiting deliveries are not sent', async () => {
    const { webhook } = await oneSigned();
    // The only webhook: failing since 3 days ago.
    await db.update(schema.webhooks).set({ firstFailureAt: NOW.getTime() - 3 * DAY });
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_2' });
    const send = fakeSend(500);
    expect(await deliverDue(depsWith(send), NOW, { deadlineMs: 20_000 })).toEqual({ sent: 0, failed: 1, turnedOff: 1 });
    expect(send).toHaveBeenCalledTimes(1);
    expect((await hooks())[0]).toMatchObject({ status: 'off_failing' });
    expect(lines).toContainEqual(['webhook_turned_off', { webhookId: webhook.id }]);
  });

  it('only the given person’s deliveries when asked for one', async () => {
    await oneSigned();
    await store.create({ userId: 'u_ben', url: 'https://ben.example.com/in', events: ['partner.signed'] });
    await store.enqueue('u_ben', 'partner.signed', { partnerId: 'ptn_9' });
    const send = fakeSend(200);
    expect(await deliverDue(depsWith(send), NOW, { deadlineMs: 20_000, userId: 'u_ben' })).toEqual({ sent: 1, failed: 0, turnedOff: 0 });
    expect(send.mock.calls.map(([url]) => url)).toEqual(['https://ben.example.com/in']);
  });

  it('claims, signs and schedules each delivery at the time it is sent, so a late claim holds its full lease', async () => {
    await oneSigned();
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_2' });
    let now = NOW.getTime();
    const claimedAt: number[] = [];
    const leases: Array<number | null> = [];
    const ids: string[] = [];
    const send = fakeSend(async (_url, request) => {
      const [row] = (await deliveries()).filter((d) => d.id === request.headers['webhook-id']);
      ids.push(request.headers['webhook-id']!);
      claimedAt.push(Number(request.headers['webhook-timestamp']) * 1000);
      leases.push(row!.nextTryAt);
      // The first request takes 55 seconds.
      now += 55_000;
      return 500;
    });
    // The run started at NOW; the clock moves on while it sends.
    expect(await deliverDue(depsWith(send, { clock: () => now }), NOW, { deadlineMs: 100_000 })).toEqual({ sent: 0, failed: 2, turnedOff: 0 });
    expect(claimedAt).toEqual([NOW.getTime(), NOW.getTime() + 55_000]);
    // The second was claimed 55 seconds in: its lease runs a full minute from then, not from the run's start.
    expect(leases[1]).toBeGreaterThanOrEqual(NOW.getTime() + 55_000 + CLAIM_LEASE_MS);
    // And its next try counts from when it was tried.
    const second = (await deliveries()).find((d) => d.id === ids[1]);
    expect(second).toMatchObject({ attempts: 1, nextTryAt: NOW.getTime() + 55_000 + 60_000 });
  });

  it('stops at the deadline', async () => {
    await oneSigned();
    await store.enqueue('u_anna', 'partner.signed', { partnerId: 'ptn_2' });
    let now = NOW.getTime();
    const send = fakeSend(async () => { now += 15_000; return 200; });
    expect(await deliverDue(depsWith(send, { clock: () => now }), NOW, { deadlineMs: 10_000 })).toEqual({ sent: 1, failed: 0, turnedOff: 0 });
    // The other one waits for the next run.
    expect((await deliveries()).filter((d) => d.doneAt === null)).toHaveLength(1);
  });

  it('the scheduled job sends everyone’s due deliveries, its own once-only events too, and a mark sent never queues again', async () => {
    await store.create({ userId: 'u_anna', url: URL_IN, events: ['activity.overdue'] });
    await store.create({ userId: 'u_ben', url: 'https://ben.example.com/in', events: ['review.due'] });
    await store.enqueue('u_anna', 'activity.overdue', { mapId: 'map_1', partnerId: 'ptn_1', activityId: 'act_1' }, 'overdue:act_1:2026-10-30');
    await store.enqueue('u_ben', 'review.due', { mapId: 'map_2', partnerId: 'ptn_2' }, 'review:map_2:2026-11-20');
    const send = fakeSend(200);
    // No person given: the job's run.
    expect(await deliverDue(depsWith(send), NOW, opts)).toEqual({ sent: 2, failed: 0, turnedOff: 0 });
    expect(JSON.parse(send.mock.calls[0]![1].body)).toMatchObject({
      type: 'activity.overdue', data: { mapId: 'map_1', partnerId: 'ptn_1', activityId: 'act_1' },
    });
    await store.enqueue('u_anna', 'activity.overdue', { mapId: 'map_1', partnerId: 'ptn_1', activityId: 'act_1' }, 'overdue:act_1:2026-10-30');
    expect(await deliveries()).toHaveLength(2);
    expect(await deliverDue(depsWith(send), NOW, opts)).toEqual({ sent: 0, failed: 0, turnedOff: 0 });
  });

  it('logs ids and the status only: never the address’s query, the body, the answer or the secret', async () => {
    const { secret, webhook } = await oneSigned();
    await deliverDue(depsWith(fakeSend(500)), NOW, opts);
    const [row] = await deliveries();
    expect(lines).toEqual([['webhook_delivery_failed', { webhookId: webhook.id, deliveryId: row!.id, status: '500' }]]);
    const text = JSON.stringify(lines);
    for (const secretText of ['SECRET', secret, 'acc_1', 'hooks.example.com']) expect(text).not.toContain(secretText);
  });
});

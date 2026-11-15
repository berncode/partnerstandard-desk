import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { schema, TursoAgentGrants, TursoApiKeys, type Db } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const state = vi.hoisted(() => ({
  session: null as OwnerSession | null,
  db: null as unknown as import('@partner-desk/platform').Db,
  deps: null as unknown as ReturnType<typeof import('@partner-desk/commands/testing').makeTestDeps>,
}));
vi.mock('@/server/runtime', async () => {
  const platform = await import('@partner-desk/platform');
  return {
    currentOwner: async () => state.session,
    depsFor: () => state.deps,
    actorFor: (session: OwnerSession) => ({
      kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName, ...(session.member ? { member: session.member } : {}),
    }),
    apiKeys: () => new platform.TursoApiKeys(state.db),
    agentGrants: () => new platform.TursoAgentGrants(state.db),
  };
});

const {
  addWebhook, createApiKey, removeWebhook, sendWebhookAgain, sendWebhookTest, turnOffAgent, turnOffApiKey, turnWebhookOff, turnWebhookOn,
  webhookDeliveries,
} = await import('./agents-actions');

const anna: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'google', personId: 'u_anna', member: null };
const URL_IN = 'https://hooks.example.com/in';

/** Anna with her Google account row, and Claude allowed by Anna and by Ben. */
async function seed(db: Db) {
  await db.insert(schema.user).values([
    { id: 'u_anna', name: 'Anna', email: 'anna@example.test' },
    { id: 'u_ben', name: 'Ben', email: 'ben@example.test' },
  ]);
  await db.insert(schema.account).values({
    id: 'acc_google_anna', accountId: 'g_123', providerId: 'google', userId: 'u_anna', accessToken: 'enc-access', refreshToken: 'enc-refresh',
    scope: 'openid email profile https://www.googleapis.com/auth/drive.file',
  });
  await db.insert(schema.oauthClient).values({
    id: 'row_claude', clientId: 'c_claude', name: 'Claude', redirectUris: '["http://127.0.0.1:5000/callback"]', createdAt: new Date('2026-11-01T08:00:00Z'),
  });
  const consent = (id: string, userId: string) => ({
    id, clientId: 'c_claude', userId, scopes: '["pd.read","offline_access"]', createdAt: new Date('2026-11-01T09:00:00Z'), updatedAt: new Date('2026-11-01T09:00:00Z'),
  });
  await db.insert(schema.oauthConsent).values([consent('co_anna', 'u_anna'), consent('co_ben', 'u_ben')]);
  await db.insert(schema.oauthRefreshToken).values({
    id: 'rt_anna', token: 'hash_rt', clientId: 'c_claude', userId: 'u_anna', scopes: '["pd.read"]', createdAt: new Date('2026-11-01T09:00:00Z'),
    expiresAt: new Date('2026-12-01T00:00:00Z'),
  });
}

beforeEach(async () => {
  state.session = anna;
  state.db = await createTestDb();
  state.deps = makeTestDeps();
  await seed(state.db);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API keys', () => {
  it('create key returns the key once; the list shows only its prefix', async () => {
    const made = await createApiKey('  n8n  ', 'change');
    if (!made.ok) throw new Error(made.message);
    expect(made.key).toMatch(/^pd_/);
    expect(made.keys).toEqual([{ id: expect.stringMatching(/^ak_/), name: 'n8n', level: 'change', prefix: made.key.slice(0, 8), createdAt: expect.any(String), lastUsedAt: null }]);
    expect(JSON.stringify(made.keys)).not.toContain(made.key);
    // The key works, and only for Anna.
    expect(await new TursoApiKeys(state.db).verify(made.key)).toMatchObject({ userId: 'u_anna', name: 'n8n', level: 'change' });
    // Turned off, it no longer lists or works.
    const off = await turnOffApiKey(made.keys[0]!.id);
    expect(off).toEqual({ ok: true, keys: [] });
    expect(await new TursoApiKeys(state.db).verify(made.key)).toBeNull();
  });

  it('makes a key at the third level, "Read, change and propose"', async () => {
    const made = await createApiKey('Claude', 'propose');
    if (!made.ok) throw new Error(made.message);
    expect(made.keys).toEqual([expect.objectContaining({ name: 'Claude', level: 'propose' })]);
    expect(await new TursoApiKeys(state.db).verify(made.key)).toMatchObject({ userId: 'u_anna', level: 'propose' });
  });

  it('asks for a name of at most 40 characters and a known level, and makes nothing otherwise', async () => {
    expect(await createApiKey('   ', 'read')).toEqual({ ok: false, message: COPY.FIX_FIELDS, fieldErrors: { name: COPY.API_KEY_NAME_MISSING } });
    expect(await createApiKey('x'.repeat(41), 'read')).toEqual({ ok: false, message: COPY.FIX_FIELDS, fieldErrors: { name: COPY.API_KEY_NAME_LONG(40) } });
    expect(await createApiKey('n8n', 'admin')).toMatchObject({ ok: false, message: COPY.SETTINGS_WRONG });
    expect(await createApiKey(42, 'read')).toMatchObject({ ok: false });
    expect(await new TursoApiKeys(state.db).list('u_anna')).toEqual([]);
  });

  it('a company server’s viewer makes read-only keys alone, and sees their old keys at that level (plan 15)', async () => {
    state.session = { ...anna, owner: { userId: 'ws_aaaaaaaaaa', displayName: 'Anna' }, member: { personId: 'u_anna', role: 'viewer' } };
    await new TursoApiKeys(state.db).create({ userId: 'u_anna', name: 'old script', level: 'propose' });
    expect(await createApiKey('n8n', 'change')).toMatchObject({ ok: false, message: COPY.SETTINGS_WRONG });
    const made = await createApiKey('n8n', 'read');
    if (!made.ok) throw new Error(made.message);
    expect(made.keys.map((k) => [k.name, k.level]).sort()).toEqual([['n8n', 'read'], ['old script', 'read']]);
    // The key belongs to the person, never the workspace.
    expect(await new TursoApiKeys(state.db).list('ws_aaaaaaaaaa')).toEqual([]);
  });

  it('tells a company server’s viewer why adding a webhook is refused (plan 15)', async () => {
    state.session = { ...anna, owner: { userId: 'ws_aaaaaaaaaa', displayName: 'Anna' }, member: { personId: 'u_anna', role: 'viewer' } };
    expect(await addWebhook('https://hooks.example.com/in', ['partner.signed'])).toMatchObject({ ok: false, message: COPY.VIEWER_READ_ONLY });
  });

  it('turns off only the person’s own key', async () => {
    const bens = await new TursoApiKeys(state.db).create({ userId: 'u_ben', name: 'Ben’s script', level: 'read' });
    expect(await turnOffApiKey(bens.id)).toEqual({ ok: true, keys: [] });
    expect(await new TursoApiKeys(state.db).verify(bens.key)).toMatchObject({ userId: 'u_ben' });
  });

  it('answers a signed-out visitor with the signed-out message and changes nothing', async () => {
    state.session = null;
    expect(await createApiKey('n8n', 'read')).toMatchObject({ ok: false, message: COPY.SIGNED_OUT });
    expect(await turnOffAgent('c_claude')).toMatchObject({ ok: false, message: COPY.SIGNED_OUT });
    expect(await addWebhook(URL_IN, ['partner.signed'])).toMatchObject({ ok: false, message: COPY.SIGNED_OUT });
    expect(await new TursoApiKeys(state.db).list('u_anna')).toEqual([]);
    expect(await new TursoAgentGrants(state.db).list('u_anna')).toHaveLength(1);
    expect(state.deps.webhooks.rows).toEqual([]);
  });
});

describe('connected agents', () => {
  it('turn off a grant leaves the Google account row untouched', async () => {
    const fetchSpy = vi.fn(async () => new Response('no'));
    vi.stubGlobal('fetch', fetchSpy);
    const before = await state.db.select().from(schema.account);
    expect(await turnOffAgent('c_claude')).toEqual({ ok: true, agents: [] });
    expect(await state.db.select().from(schema.account)).toEqual(before);
    // Nothing went to Google (no revoke), and Ben's grant to the same app stays.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await new TursoAgentGrants(state.db).list('u_ben')).toHaveLength(1);
    expect(await state.db.select().from(schema.oauthRefreshToken)).toEqual([]);
  });

  it('refuses an id that isn’t one', async () => {
    expect(await turnOffAgent('')).toMatchObject({ ok: false, message: COPY.SETTINGS_WRONG });
    expect(await new TursoAgentGrants(state.db).list('u_anna')).toHaveLength(1);
  });
});

describe('webhooks', () => {
  it('add webhook refuses http and a private address with COPY text', async () => {
    expect(await addWebhook('http://hooks.example.com/in', ['partner.signed']))
      .toEqual({ ok: false, message: COPY.FIX_FIELDS, fieldErrors: { url: COPY.WEBHOOK_URL_HTTPS } });
    expect(await addWebhook('https://10.0.0.5/in', ['partner.signed']))
      .toEqual({ ok: false, message: COPY.FIX_FIELDS, fieldErrors: { url: COPY.WEBHOOK_URL_PRIVATE } });
    expect(await addWebhook(URL_IN, [])).toEqual({ ok: false, message: COPY.FIX_FIELDS, fieldErrors: { events: COPY.WEBHOOK_EVENTS_MISSING } });
    expect(state.deps.webhooks.rows).toEqual([]);
  });

  it('adds a webhook with its secret once, then tests, turns off, turns on and deletes it', async () => {
    const made = await addWebhook(URL_IN, ['partner.signed', 'review.due']);
    if (!made.ok) throw new Error(made.message);
    expect(made.secret).toMatch(/^whsec_/);
    expect(made.webhook).toEqual({ id: expect.stringMatching(/^wh_/), url: URL_IN, events: ['partner.signed', 'review.due'], status: 'active', createdAt: expect.any(String), deliveries: [] });
    const id = made.webhook.id;

    const tested = await sendWebhookTest(id);
    expect(tested).toEqual({ ok: true, deliveries: [{ id: expect.stringMatching(/^evt_/), at: expect.any(String), type: 'webhook.test', status: null }] });
    expect(await webhookDeliveries(id)).toEqual(tested);
    expect(await turnWebhookOff(id)).toMatchObject({ ok: true, webhook: { id, status: 'off' } });
    // Turned on, the test that waited is dropped, and the answer says so.
    expect(await turnWebhookOn(id)).toMatchObject({ ok: true, webhook: { id, status: 'active' }, deliveries: [] });
    expect(await removeWebhook(id)).toEqual({ ok: true });
    expect(state.deps.webhooks.rows).toEqual([]);
    expect(await turnWebhookOff(id)).toEqual({ ok: false, message: COPY.WEBHOOK_GONE });
  });

  it('Send again queues a failed delivery and answers the deliveries with it waiting', async () => {
    const made = await addWebhook(URL_IN, ['partner.signed']);
    if (!made.ok) throw new Error(made.message);
    const id = made.webhook.id;
    await sendWebhookTest(id);
    const [delivery] = state.deps.webhooks.deliveries;
    Object.assign(delivery!, { status: 500, givenUpAt: '2026-11-01T09:00:00.000Z' });
    expect(await sendWebhookAgain(id, delivery!.id)).toEqual({ ok: true, deliveries: [{ id: delivery!.id, at: delivery!.occurredAt, type: 'webhook.test', status: null }] });
    expect(state.deps.events.events.at(-1)).toMatchObject({ command: 'webhooks.resend', entityIds: [id, delivery!.id] });
    // Again at once: it waits, so there is nothing to send again.
    expect(await sendWebhookAgain(id, delivery!.id)).toEqual({ ok: false, message: COPY.WEBHOOK_SEND_AGAIN_NOT_FAILED });
    expect(await sendWebhookAgain(id, 'evt_missing')).toEqual({ ok: false, message: COPY.WEBHOOK_DELIVERY_GONE });
    expect(await sendWebhookAgain(id, 42)).toEqual({ ok: false, message: COPY.FIX_FIELDS });
    state.session = null;
    expect(await sendWebhookAgain(id, delivery!.id)).toMatchObject({ ok: false, message: COPY.SIGNED_OUT });
  });

  it('acts as the signed-in person: another person’s webhook is gone', async () => {
    const bens = await state.deps.webhooks.create({ userId: 'u_ben', url: URL_IN, events: ['partner.signed'] });
    for (const answer of [
      await sendWebhookTest(bens.webhook.id), await turnWebhookOff(bens.webhook.id), await removeWebhook(bens.webhook.id), await webhookDeliveries(bens.webhook.id),
    ]) expect(answer).toEqual({ ok: false, message: COPY.WEBHOOK_GONE });
    const bensTest = await state.deps.webhooks.sendTest('u_ben', bens.webhook.id);
    state.deps.webhooks.deliveries[0]!.status = 500;
    expect(await sendWebhookAgain(bens.webhook.id, bensTest)).toEqual({ ok: false, message: COPY.WEBHOOK_DELIVERY_GONE });
    expect(state.deps.webhooks.deliveries[0]!.status).toBe(500);
    expect(state.deps.webhooks.rows.map((r) => r.status)).toEqual(['active']);
  });
});

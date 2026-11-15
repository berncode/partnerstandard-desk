import { parseEnv, schema, TursoAgentGrants, TursoApiKeys, TursoWorkspace, type Db, type ServerEnv } from '@partner-desk/platform';
import { connectAgent, createTestDb } from '@partner-desk/platform/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ env: null as unknown as ServerEnv, db: null as unknown as Db }));
vi.mock('next/headers', () => ({ headers: async () => new Headers(), cookies: async () => ({ set: () => {}, get: () => undefined }) }));
vi.mock('next/server', () => ({ connection: async () => {}, after: () => {} }));
vi.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`redirect:${url}`); }, unstable_rethrow: () => {} }));
vi.mock('./log', () => ({ log: () => {} }));
vi.mock('@partner-desk/platform', async (orig) => {
  const real = await orig<typeof import('@partner-desk/platform')>();
  return { ...real, serverEnv: () => state.env, createDb: () => state.db };
});

const { resolveAgent } = await import('./agent-auth');
const { getAuth } = await import('./runtime');

const APP = 'http://localhost:3000';
const METADATA = `${APP}/.well-known/oauth-protected-resource/mcp`;

interface TestHelpers {
  createUser(input: { email: string; name: string }): unknown;
  saveUser(user: unknown): Promise<{ id: string }>;
  login(input: { userId: string }): Promise<{ headers: Headers }>;
}

/** A test user (memory storage, as test sign-in makes them) with their session's headers. */
async function person(name: string): Promise<{ userId: string; headers: Headers }> {
  const test = ((await getAuth().$context) as unknown as { test: TestHelpers }).test;
  // Test sign-in's own address: a company server makes no other user (plan 14).
  const user = await test.saveUser(test.createUser({ email: `test-${name.toLowerCase().replace(/[^a-z0-9]/g, '')}@example.test`, name }));
  return { userId: user.id, headers: (await test.login({ userId: user.id })).headers };
}

const call = (token?: string) => new Request(`${APP}/mcp`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });

const companyRows = async () => (await state.db.select({ owner: schema.companies.ownerUserId }).from(schema.companies)).map((r) => r.owner);

/** A token the provider signed itself, with what a test needs in it (the jwt plugin's own signer). */
async function signed(payload: Record<string, unknown>): Promise<string> {
  const api = getAuth().api as unknown as { signJWT(input: { body: { payload: Record<string, unknown> } }): Promise<{ token: string }> };
  const now = Math.floor(Date.now() / 1000);
  return (await api.signJWT({ body: { payload: { iss: `${APP}/api/auth`, aud: `${APP}/mcp`, iat: now, exp: now + 600, ...payload } } })).token;
}

beforeEach(async () => {
  (globalThis as { __partnerDeskShared?: unknown }).__partnerDeskShared = undefined;
  state.db = await createTestDb();
  state.env = parseEnv({ DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), APP_URL: APP, PD_TEST_AUTH: '1' });
});

describe('resolveAgent with an API key', () => {
  it('a pd_ key gives an agent context with the key’s name and level', async () => {
    const anna = await person('Anna');
    const { id, key } = await new TursoApiKeys(state.db).create({ userId: anna.userId, name: 'n8n', level: 'change' });
    const result = await resolveAgent(call(key));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grantKey).toBe(`key:${id}`);
    expect(result.ctx.actor).toEqual({ kind: 'agent', userId: anna.userId, displayName: 'Anna', agentName: 'n8n', level: 'change', via: { kind: 'key', keyId: id } });
    expect(result.ctx.companyId).toBe((await result.ctx.deps.companies.forUser(anna.userId)).companyId);
    // A test user's files are in memory, as their own pages use.
    expect(result.ctx.deps.partnerBooks).toBeDefined();
  });

  it('a key whose user was deleted is 401 and makes no company row', async () => {
    const anna = await person('Anna');
    const { key } = await new TursoApiKeys(state.db).create({ userId: anna.userId, name: 'n8n', level: 'read' });
    await new (await import('@partner-desk/platform')).TursoUserRecords(state.db).deleteUser(anna.userId);
    const result = await resolveAgent(call(key));
    expect(result).toEqual({ ok: false, status: 401, headers: { 'WWW-Authenticate': expect.stringContaining('error="invalid_token"') } });
    expect(await companyRows()).toEqual([]);
  });

  it('an unknown key and a turned off key are 401', async () => {
    const anna = await person('Anna');
    const keys = new TursoApiKeys(state.db);
    const { id, key } = await keys.create({ userId: anna.userId, name: 'n8n', level: 'read' });
    expect((await resolveAgent(call(`pd_${'A'.repeat(43)}`))).ok).toBe(false);
    await keys.revoke(anna.userId, id);
    expect(await resolveAgent(call(key))).toMatchObject({ ok: false, status: 401 });
  });

  it('the 61st request in a minute gives 429 with Retry-After', async () => {
    const anna = await person('Anna');
    const { key } = await new TursoApiKeys(state.db).create({ userId: anna.userId, name: 'n8n', level: 'read' });
    const now = Date.UTC(2026, 10, 1, 8, 0, 15);
    for (let i = 0; i < 60; i += 1) expect((await resolveAgent(call(key), now)).ok).toBe(true);
    expect(await resolveAgent(call(key), now)).toEqual({ ok: false, status: 429, headers: { 'Retry-After': '45' } });
    // The next minute starts afresh.
    expect((await resolveAgent(call(key), now + 45_000)).ok).toBe(true);
  });

  it('on a company server, AGENT_REQUESTS_PER_MINUTE sets the limit: the 300th goes through, the 301st gives 429', async () => {
    state.env = parseEnv({
      DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), APP_URL: APP, PD_TEST_AUTH: '1', EDITION: 'self-hosted', AGENT_REQUESTS_PER_MINUTE: '300',
    });
    const anna = await person('Anna');
    const { key } = await new TursoApiKeys(state.db).create({ userId: anna.userId, name: 'n8n', level: 'read' });
    const now = Date.UTC(2026, 10, 1, 8, 0, 0);
    for (let i = 0; i < 300; i += 1) expect((await resolveAgent(call(key), now)).ok).toBe(true);
    expect(await resolveAgent(call(key), now)).toMatchObject({ ok: false, status: 429 });
  });

  it('each key has its own limit', async () => {
    const anna = await person('Anna');
    const keys = new TursoApiKeys(state.db);
    const first = await keys.create({ userId: anna.userId, name: 'n8n', level: 'read' });
    const second = await keys.create({ userId: anna.userId, name: 'Zapier', level: 'read' });
    const now = Date.UTC(2026, 10, 1, 8, 0, 0);
    for (let i = 0; i < 60; i += 1) await resolveAgent(call(first.key), now);
    expect((await resolveAgent(call(first.key), now)).ok).toBe(false);
    expect((await resolveAgent(call(second.key), now)).ok).toBe(true);
  });
});

describe('resolveAgent on a company server (plan 15)', () => {
  beforeEach(() => {
    state.env = parseEnv({
      DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), APP_URL: APP, PD_TEST_AUTH: '1', EDITION: 'self-hosted', ADMIN_EMAIL: 'anna@halden.example',
    });
  });
  /** A real person (not a test user), made straight in the database. */
  const member = async (id: string, name: string, email: string) => { await state.db.insert(schema.user).values({ id, name, email }); };

  it('acts in the workspace, for the member, with their own key', async () => {
    await member('u_anna', 'Anna', 'anna@halden.example');
    const ws = new TursoWorkspace(state.db);
    await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
    const { id, key } = await new TursoApiKeys(state.db).create({ userId: 'u_anna', name: 'n8n', level: 'change' });
    const result = await resolveAgent(call(key));
    if (!result.ok) throw new Error('refused');
    const workspaceKey = await ws.key();
    expect(result.ctx.actor).toEqual({
      kind: 'agent', userId: workspaceKey, displayName: 'Anna', agentName: 'n8n', level: 'change', via: { kind: 'key', keyId: id },
      member: { personId: 'u_anna', role: 'admin' },
    });
    expect(result.grantKey).toBe(`key:${id}`);
    expect(await companyRows()).toEqual([workspaceKey]);
  });

  it('holds a viewer’s agent to reading, whatever its key says (plan 15)', async () => {
    await member('u_vera', 'Vera', 'vera@halden.example');
    await new TursoWorkspace(state.db).addMember({ personId: 'u_vera', role: 'viewer', addedBy: null });
    const { key } = await new TursoApiKeys(state.db).create({ userId: 'u_vera', name: 'n8n', level: 'propose' });
    const result = await resolveAgent(call(key));
    if (!result.ok) throw new Error('refused');
    expect(result.ctx.actor).toMatchObject({ level: 'read', member: { personId: 'u_vera', role: 'viewer' } });
  });

  it('refuses the key of a person who is no longer a member, and makes no company', async () => {
    await member('u_ben', 'Ben', 'ben@halden.example');
    const { key } = await new TursoApiKeys(state.db).create({ userId: 'u_ben', name: 'n8n', level: 'read' });
    expect(await resolveAgent(call(key))).toEqual({ ok: false, status: 401, headers: { 'WWW-Authenticate': expect.stringContaining('error="invalid_token"') } });
    expect(await companyRows()).toEqual([]);
  });
});

describe('resolveAgent with a token from the allow page', () => {
  it('gives the app’s name and the level allowed: Read only', async () => {
    const anna = await person('Anna');
    const { clientId, accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers, clientName: 'Claude' });
    const result = await resolveAgent(call(accessToken));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grantKey).toBe(`oauth:${clientId}:${anna.userId}`);
    expect(result.ctx.actor).toEqual({ kind: 'agent', userId: anna.userId, displayName: 'Anna', agentName: 'Claude', level: 'read', via: { kind: 'app', clientId } });
  });

  it('gives Read and change when the person allowed it', async () => {
    const anna = await person('Anna');
    const { accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers, allow: 'pd.read pd.change offline_access' });
    expect(await resolveAgent(call(accessToken))).toMatchObject({ ok: true, ctx: { actor: { level: 'change' } } });
  });

  it('a revoked grant’s access token is refused at once', async () => {
    const anna = await person('Anna');
    const { clientId, accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers });
    expect((await resolveAgent(call(accessToken))).ok).toBe(true);
    expect(await new TursoAgentGrants(state.db).revoke(anna.userId, clientId)).toBe(true);
    expect(await resolveAgent(call(accessToken))).toMatchObject({ ok: false, status: 401 });
  });

  it('takes the lower level when the person allowed less since the token was made', async () => {
    const anna = await person('Anna');
    const { accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers, allow: 'pd.read pd.change offline_access' });
    await state.db.update(schema.oauthConsent).set({ scopes: JSON.stringify(['pd.read', 'offline_access']) });
    expect(await resolveAgent(call(accessToken))).toMatchObject({ ok: true, ctx: { actor: { level: 'read' } } });
  });

  it('resolveAgent takes the lower of token and grant, and passes via with the client id or the key id', async () => {
    const anna = await person('Anna');
    const all = 'pd.read pd.change pd.propose offline_access';
    const { clientId, accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers, asked: all, allow: all });
    const actor = async (token: string) => {
      const result = await resolveAgent(call(token));
      if (!result.ok) throw new Error(`refused ${result.status}`);
      return result.ctx.actor;
    };
    expect(await actor(accessToken)).toEqual({
      kind: 'agent', userId: anna.userId, displayName: 'Anna', agentName: 'Claude', level: 'propose', via: { kind: 'app', clientId },
    });
    const grantAt = (scopes: string[]) => state.db.update(schema.oauthConsent).set({ scopes: JSON.stringify(scopes) });
    // The person allowed less since: the grant's level counts.
    await grantAt(['pd.read', 'pd.change', 'offline_access']);
    expect(await actor(accessToken)).toMatchObject({ level: 'change', via: { kind: 'app', clientId } });
    await grantAt(['pd.read', 'offline_access']);
    expect(await actor(accessToken)).toMatchObject({ level: 'read' });
    // The person allowed more since: a token made at less stays at less until the app gets a new one.
    await grantAt(all.split(' '));
    const atChange = await signed({ sub: anna.userId, azp: clientId, scope: 'pd.read pd.change offline_access' });
    const atRead = await signed({ sub: anna.userId, azp: clientId, scope: 'pd.read offline_access' });
    expect(await actor(atChange)).toMatchObject({ level: 'change' });
    expect(await actor(atRead)).toMatchObject({ level: 'read' });

    const { id, key } = await new TursoApiKeys(state.db).create({ userId: anna.userId, name: 'n8n', level: 'propose' });
    expect(await actor(key)).toEqual({
      kind: 'agent', userId: anna.userId, displayName: 'Anna', agentName: 'n8n', level: 'propose', via: { kind: 'key', keyId: id },
    });
  });

  it('a grant allowed at change stays change after pd.propose exists', async () => {
    const anna = await person('Anna');
    const early = 'pd.read pd.change offline_access';
    const { accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers, asked: early, allow: early });
    expect(await resolveAgent(call(accessToken))).toMatchObject({ ok: true, ctx: { actor: { level: 'change' } } });
  });

  it('another person’s grant to the same app doesn’t count', async () => {
    const anna = await person('Anna');
    const ben = await person('Ben');
    const { clientId, accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers });
    // Ben allows the same app; Anna turns hers off.
    await state.db.insert(schema.oauthConsent).values({ id: 'co_ben', clientId, userId: ben.userId, scopes: '["pd.read"]' });
    await new TursoAgentGrants(state.db).revoke(anna.userId, clientId);
    expect((await resolveAgent(call(accessToken))).ok).toBe(false);
  });

  it('a token with neither pd.read nor pd.change is 401', async () => {
    const anna = await person('Anna');
    const { accessToken, scope } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers, allow: 'offline_access' });
    expect(scope).toBe('offline_access');
    expect(await resolveAgent(call(accessToken))).toMatchObject({ ok: false, status: 401 });
  });

  it('a token bound to a key (cnf, DPoP) is 401', async () => {
    const anna = await person('Anna');
    const { clientId } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers });
    const plain = await signed({ sub: anna.userId, azp: clientId, scope: 'pd.read' });
    expect((await resolveAgent(call(plain))).ok).toBe(true);
    const bound = await signed({ sub: anna.userId, azp: clientId, scope: 'pd.read', cnf: { jkt: 'thumbprint' } });
    expect(await resolveAgent(call(bound))).toMatchObject({ ok: false, status: 401 });
  });

  it('a token whose user no longer exists is 401 and makes no company row', async () => {
    const anna = await person('Anna');
    const { accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers });
    // The user row alone goes (as if a delete stopped half way, with the database's links off): the grant is still there.
    await state.db.run('PRAGMA foreign_keys = OFF');
    await state.db.run(`DELETE FROM user WHERE id = '${anna.userId}'`);
    expect(await resolveAgent(call(accessToken))).toMatchObject({ ok: false, status: 401 });
    expect(await companyRows()).toEqual([]);
  });

  it('a changed token, a token for another address and an expired token are 401 with invalid_token', async () => {
    const anna = await person('Anna');
    const { clientId, accessToken } = await connectAgent(getAuth(), { appUrl: APP, headers: anna.headers });
    const expired = await signed({ sub: anna.userId, azp: clientId, scope: 'pd.read', iat: 1, exp: 2 });
    const elsewhere = await signed({ sub: anna.userId, azp: clientId, scope: 'pd.read', aud: 'http://localhost:4000/mcp' });
    for (const token of [`${accessToken.slice(0, -4)}AAAA`, expired, elsewhere, 'not-a-token']) {
      expect(await resolveAgent(call(token))).toEqual({
        ok: false, status: 401, headers: { 'WWW-Authenticate': `Bearer error="invalid_token", resource_metadata="${METADATA}", scope="pd.read pd.change pd.propose offline_access"` },
      });
    }
  });
});

describe('resolveAgent without a credential', () => {
  it('no bearer gives 401 with resource_metadata', async () => {
    const expected = { ok: false, status: 401, headers: { 'WWW-Authenticate': `Bearer resource_metadata="${METADATA}", scope="pd.read pd.change pd.propose offline_access"` } };
    expect(await resolveAgent(call())).toEqual(expected);
    expect(await resolveAgent(new Request(`${APP}/mcp`, { headers: { authorization: 'Basic YTpi' } }))).toEqual(expected);
    expect(await resolveAgent(new Request(`${APP}/mcp`, { headers: { authorization: 'Bearer ' } }))).toEqual(expected);
  });
});

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { Db } from './client';
import { oauthAccessToken, oauthClient, oauthClientResource, oauthConsent, oauthRefreshToken, oauthResource, user } from './schema';
import { createTestDb } from './test-db';
import { levelOf, SCOPE_PROPOSE, TursoAgentGrants } from './turso-agent-grants';

const T = (iso: string) => new Date(iso);

/**
 * Two agent apps, Claude (c_claude) and n8n's helper (c_other), and a third registered by Anna while signed in
 * (c_annas, owned by her). Anna allowed Claude to read and change and c_other to read; Ben allowed Claude to read.
 */
async function seed(): Promise<Db> {
  const db = await createTestDb();
  await db.insert(user).values([
    { id: 'u_anna', name: 'Anna Keller', email: 'anna@example.com' },
    { id: 'u_ben', name: 'Ben Ito', email: 'ben@example.com' },
  ]);
  const client = (id: string, name: string | null, userId: string | null = null) => ({
    id: `row_${id}`, clientId: id, name, userId, redirectUris: '["http://127.0.0.1:5000/callback"]', createdAt: T('2026-11-01T08:00:00Z'),
  });
  await db.insert(oauthClient).values([client('c_claude', 'Claude'), client('c_other', null), client('c_annas', 'Anna’s script', 'u_anna')]);
  await db.insert(oauthResource).values({ id: 'res_1', identifier: 'https://desk.test/mcp', name: 'PartnerStandard Desk' });
  await db.insert(oauthClientResource).values([
    { id: 'cr_1', clientId: 'c_claude', resourceId: 'https://desk.test/mcp' },
    { id: 'cr_2', clientId: 'c_annas', resourceId: 'https://desk.test/mcp' },
  ]);
  const consent = (id: string, clientId: string, userId: string, scopes: string[], at: string) => ({
    id, clientId, userId, scopes: JSON.stringify(scopes), createdAt: T(at), updatedAt: T(at),
  });
  await db.insert(oauthConsent).values([
    consent('co_anna_claude', 'c_claude', 'u_anna', ['pd.read', 'pd.change', 'offline_access'], '2026-11-01T09:00:00Z'),
    consent('co_anna_other', 'c_other', 'u_anna', ['pd.read'], '2026-11-01T10:00:00Z'),
    consent('co_anna_annas', 'c_annas', 'u_anna', ['pd.read'], '2026-11-01T10:30:00Z'),
    consent('co_ben_claude', 'c_claude', 'u_ben', ['pd.read', 'offline_access'], '2026-11-01T11:00:00Z'),
  ]);
  const refresh = (id: string, clientId: string, userId: string, at: string) => ({
    id, token: `hash_${id}`, clientId, userId, scopes: '["pd.read"]', createdAt: T(at), expiresAt: T('2026-12-01T00:00:00Z'),
  });
  await db.insert(oauthRefreshToken).values([
    refresh('rt_anna_claude_1', 'c_claude', 'u_anna', '2026-11-01T09:00:00Z'),
    refresh('rt_anna_claude_2', 'c_claude', 'u_anna', '2026-11-02T14:00:00Z'),
    refresh('rt_ben_claude', 'c_claude', 'u_ben', '2026-11-01T11:00:00Z'),
    refresh('rt_anna_annas', 'c_annas', 'u_anna', '2026-11-01T10:30:00Z'),
  ]);
  // Opaque access tokens: ours are signed and never land here, but a revoke must not leave one if one ever does.
  await db.insert(oauthAccessToken).values([
    { id: 'at_anna_claude', token: 'hash_at_a', clientId: 'c_claude', userId: 'u_anna', refreshId: 'rt_anna_claude_2', scopes: '["pd.read"]' },
    { id: 'at_ben_claude', token: 'hash_at_b', clientId: 'c_claude', userId: 'u_ben', refreshId: 'rt_ben_claude', scopes: '["pd.read"]' },
  ]);
  return db;
}

async function rows(db: Db) {
  const ids = async <T>(query: Promise<T[]>, pick: (row: T) => string) => (await query).map(pick).sort();
  return {
    clients: await ids(db.select({ id: oauthClient.clientId }).from(oauthClient), (r) => r.id),
    clientResources: await ids(db.select({ id: oauthClientResource.id }).from(oauthClientResource), (r) => r.id),
    consents: await ids(db.select({ id: oauthConsent.id }).from(oauthConsent), (r) => r.id),
    refresh: await ids(db.select({ id: oauthRefreshToken.id }).from(oauthRefreshToken), (r) => r.id),
    access: await ids(db.select({ id: oauthAccessToken.id }).from(oauthAccessToken), (r) => r.id),
  };
}

describe('TursoAgentGrants', () => {
  it('lists the apps a person allowed, with the level, when it was allowed and when it was last used', async () => {
    const grants = new TursoAgentGrants(await seed());
    expect(await grants.list('u_anna')).toEqual([
      { clientId: 'c_annas', appName: 'Anna’s script', level: 'read', allowedAt: '2026-11-01T10:30:00.000Z', lastUsedAt: '2026-11-01T10:30:00.000Z' },
      { clientId: 'c_other', appName: '', level: 'read', allowedAt: '2026-11-01T10:00:00.000Z', lastUsedAt: null },
      { clientId: 'c_claude', appName: 'Claude', level: 'change', allowedAt: '2026-11-01T09:00:00.000Z', lastUsedAt: '2026-11-02T14:00:00.000Z' },
    ]);
    expect(await grants.list('u_ben')).toEqual([
      { clientId: 'c_claude', appName: 'Claude', level: 'read', allowedAt: '2026-11-01T11:00:00.000Z', lastUsedAt: '2026-11-01T11:00:00.000Z' },
    ]);
  });

  it('levelOf gives propose only with pd.propose and pd.change', () => {
    expect(SCOPE_PROPOSE).toBe('pd.propose');
    expect(levelOf(['pd.read', 'pd.change', 'pd.propose', 'offline_access'])).toBe('propose');
    expect(levelOf(['pd.change', 'pd.propose'])).toBe('propose');
    expect(levelOf(['pd.read', 'pd.change', 'offline_access'])).toBe('change');
    expect(levelOf(['pd.read', 'offline_access'])).toBe('read');
    // Builder's call: pd.propose without pd.change gives no more than read.
    expect(levelOf(['pd.read', 'pd.propose', 'offline_access'])).toBe('read');
    expect(levelOf(['pd.propose', 'offline_access'])).toBeNull();
    expect(levelOf([])).toBeNull();
  });

  it('a grant allowed at change stays change after pd.propose exists; one allowed at the third level lists as propose', async () => {
    const db = await seed();
    await db.insert(oauthConsent).values({
      id: 'co_ben_annas', clientId: 'c_annas', userId: 'u_ben', scopes: JSON.stringify(['pd.read', 'pd.change', 'pd.propose', 'offline_access']),
      createdAt: T('2026-11-04T09:00:00Z'), updatedAt: T('2026-11-04T09:00:00Z'),
    });
    const grants = new TursoAgentGrants(db);
    expect((await grants.list('u_anna')).find((grant) => grant.clientId === 'c_claude')?.level).toBe('change');
    expect((await grants.list('u_ben')).map((grant) => [grant.clientId, grant.level])).toEqual([['c_annas', 'propose'], ['c_claude', 'read']]);
  });

  it('finds a grant that is on, with the app’s name and the allowed scopes', async () => {
    const grants = new TursoAgentGrants(await seed());
    expect(await grants.find('u_anna', 'c_claude')).toEqual({ appName: 'Claude', scopes: ['pd.read', 'pd.change', 'offline_access'] });
    expect(await grants.find('u_ben', 'c_other')).toBeNull();
    expect(await grants.find('u_anna', 'c_unknown')).toBeNull();
  });

  it('finds no grant for a turned off app', async () => {
    const db = await seed();
    await db.update(oauthClient).set({ disabled: true });
    expect(await new TursoAgentGrants(db).find('u_anna', 'c_claude')).toBeNull();
  });

  it('finds an app by its id, with its name and return addresses, or null when it isn’t registered', async () => {
    const grants = new TursoAgentGrants(await seed());
    expect(await grants.app('c_claude')).toEqual({ name: 'Claude', redirectUris: ['http://127.0.0.1:5000/callback'] });
    expect(await grants.app('c_other')).toEqual({ name: '', redirectUris: ['http://127.0.0.1:5000/callback'] });
    expect(await grants.app('c_unknown')).toBeNull();
  });

  it('reads an app’s return addresses tolerantly: a list, or none', async () => {
    const db = await seed();
    const grants = new TursoAgentGrants(db);
    await db.update(oauthClient).set({ redirectUris: 'not json' }).where(eq(oauthClient.clientId, 'c_claude'));
    expect((await grants.app('c_claude'))?.redirectUris).toEqual([]);
    await db.update(oauthClient).set({ redirectUris: '["https://claude.ai/cb", 7]' }).where(eq(oauthClient.clientId, 'c_claude'));
    expect((await grants.app('c_claude'))?.redirectUris).toEqual(['https://claude.ai/cb']);
  });

  it('revoke removes the client’s tokens for this user only', async () => {
    const db = await seed();
    const grants = new TursoAgentGrants(db);
    expect(await grants.revoke('u_anna', 'c_claude')).toBe(true);
    expect(await rows(db)).toEqual({
      clients: ['c_annas', 'c_claude', 'c_other'],
      clientResources: ['cr_1', 'cr_2'],
      consents: ['co_anna_annas', 'co_anna_other', 'co_ben_claude'],
      refresh: ['rt_anna_annas', 'rt_ben_claude'],
      access: ['at_ben_claude'],
    });
    expect(await grants.find('u_anna', 'c_claude')).toBeNull();
    expect(await grants.find('u_ben', 'c_claude')).not.toBeNull();
    // Already off: nothing to do.
    expect(await grants.revoke('u_anna', 'c_claude')).toBe(false);
  });

  it('Ben can’t turn off Anna’s grant', async () => {
    const db = await seed();
    const before = await rows(db);
    expect(await new TursoAgentGrants(db).revoke('u_ben', 'c_other')).toBe(false);
    expect(await rows(db)).toEqual(before);
  });

  it('deleteForUser removes the person’s grants and tokens, and the apps they registered with every grant to them', async () => {
    const db = await seed();
    await new TursoAgentGrants(db).deleteForUser('u_anna');
    expect(await rows(db)).toEqual({
      clients: ['c_claude', 'c_other'],
      clientResources: ['cr_1'],
      consents: ['co_ben_claude'],
      refresh: ['rt_ben_claude'],
      access: ['at_ben_claude'],
    });
  });

  it('deleteForUser twice is fine', async () => {
    const db = await seed();
    const grants = new TursoAgentGrants(db);
    await grants.deleteForUser('u_ben');
    await grants.deleteForUser('u_ben');
    expect((await rows(db)).consents).toEqual(['co_anna_annas', 'co_anna_claude', 'co_anna_other']);
  });

  it('a failed query names the operation only', async () => {
    const db = await seed();
    await db.run('DROP TABLE oauth_access_token');
    await expect(new TursoAgentGrants(db).revoke('u_anna', 'c_claude')).rejects.toThrow(/^agent_grants_revoke_failed$/);
  });
});

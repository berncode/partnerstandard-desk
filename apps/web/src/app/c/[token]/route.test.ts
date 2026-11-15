import { changeMap, changePartner, openMapLink, readPartners, resolveMapSession, revokeMapLinks, shareMap, startMap, type Actor } from '@partner-desk/commands';
import { makeTestDeps, TEST_NOW } from '@partner-desk/commands/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ deps: null as unknown as ReturnType<typeof import('@partner-desk/commands/testing').makeTestDeps> }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('@/server/runtime', () => ({ appUrl: () => 'https://desk.test', mapAccessDeps: () => state.deps }));

const { GET } = await import('./route');
const call = (token: string) => GET(new Request(`https://desk.test/c/${token}`), { params: Promise.resolve({ token }) });
const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

let mapId: string;
let lena: string;

beforeEach(async () => {
  state.deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
  await readPartners(state.deps, owner, { companyId });
  const account = value(await changePartner(state.deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }));
  const partner = value(await changePartner(state.deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller' } },
  }));
  mapId = value(await startMap(state.deps, owner, { companyId, partnerId: partner.entityId! })).mapId;
  lena = value(await changeMap(state.deps, owner, {
    mapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'other' } },
  })).entityId!;
});

describe('GET /c/[token]', () => {
  it('swaps a good token for a session cookie and drops the token from the address', async () => {
    const { token } = value(await shareMap(state.deps, owner, { mapId, personId: lena }));
    const res = await call(token);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(`https://desk.test/m/${mapId}`);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toMatch(new RegExp(`^pd_m_${mapId}=[A-Za-z0-9_-]{43};`));
    expect(cookie).not.toContain(token);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Secure/i);
    expect(cookie).toMatch(/Path=\//);
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('changes nothing in the plan: opening a link only starts a session', async () => {
    const { token } = value(await shareMap(state.deps, owner, { mapId, personId: lena }));
    const entry = (await state.deps.directory.map(mapId))!;
    const before = await state.deps.maps.read({ fileId: entry.fileId });
    state.deps.events.events.length = 0;
    await call(token);
    await call(token);
    expect(await state.deps.maps.read({ fileId: entry.fileId })).toEqual(before);
    expect(state.deps.events.events).toEqual([]);
    expect(state.deps.mapSessions.rows).toHaveLength(2);
  });

  it('with a session for another person: changes nothing in the plan, and that session stays theirs (MAP app decision 16, plan 8 Review Focus 2)', async () => {
    const ben = value(await changeMap(state.deps, owner, {
      mapId, change: { kind: 'add', entity: 'person', values: { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'other' } },
    })).entityId!;
    const bens = await openMapLink(state.deps, value(await shareMap(state.deps, owner, { mapId, personId: ben })).token);
    if (bens.kind !== 'session') throw new Error('setup');
    const { token } = value(await shareMap(state.deps, owner, { mapId, personId: lena }));
    const entry = (await state.deps.directory.map(mapId))!;
    const before = await state.deps.maps.read({ fileId: entry.fileId });
    state.deps.events.events.length = 0;
    const res = await call(token);
    // The visit gets Lena's own new session; Ben's session is neither used, changed nor ended.
    expect(res.headers.get('set-cookie')).not.toContain(bens.sessionToken);
    expect(await state.deps.maps.read({ fileId: entry.fileId })).toEqual(before);
    expect(state.deps.events.events).toEqual([]);
    const still = await resolveMapSession(state.deps, bens.sessionToken, mapId);
    expect(still).toMatchObject({ kind: 'active', actor: { personId: ben } });
  });

  it('sends a revoked or unknown token to the invalid page, setting no cookie', async () => {
    const { token } = value(await shareMap(state.deps, owner, { mapId, personId: lena }));
    value(await revokeMapLinks(state.deps, owner, { mapId, personId: lena }));
    for (const t of [token, 'not-a-token', 'x'.repeat(43)]) {
      const res = await call(t);
      expect(res.headers.get('location')).toBe('https://desk.test/c/invalid');
      expect(res.headers.get('set-cookie')).toBeNull();
    }
  });

  it('sends an expired link to the renew page, naming the MAP only', async () => {
    const { token } = value(await shareMap(state.deps, owner, { mapId, personId: lena }));
    state.deps.clock = () => new Date(Date.parse(TEST_NOW) + 100 * 86_400_000).toISOString();
    const res = await call(token);
    expect(res.headers.get('location')).toBe(`https://desk.test/c/renew?map=${mapId}`);
    expect(res.headers.get('set-cookie')).toBeNull();
  });
});

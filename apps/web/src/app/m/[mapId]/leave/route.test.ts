import { changeMap, changePartner, endMapSession, openMapLink, readPartners, shareMap, startMap, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ deps: null as unknown as ReturnType<typeof import('@partner-desk/commands/testing').makeTestDeps> }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), connection: async () => {} }));
vi.mock('@/server/runtime', () => ({ appUrl: () => 'https://desk.test', mapAccessDeps: () => state.deps }));

const { GET } = await import('./route');
const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

let mapId: string;
let sessionToken: string;

const call = (to: string, cookie: string | null, id = mapId) => GET(
  new NextRequest(`https://desk.test/m/${id}/leave?to=${to}`, { headers: cookie ? { cookie: `pd_m_${id}=${cookie}` } : {} }),
  { params: Promise.resolve({ mapId: id }) },
);

beforeEach(async () => {
  state.deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
  await readPartners(state.deps, owner, { companyId });
  const account = value(await changePartner(state.deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }));
  const partner = value(await changePartner(state.deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller' } },
  }));
  mapId = value(await startMap(state.deps, owner, { companyId, partnerId: partner.entityId! })).mapId;
  const lena = value(await changeMap(state.deps, owner, {
    mapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'other' } },
  })).entityId!;
  const opened = await openMapLink(state.deps, value(await shareMap(state.deps, owner, { mapId, personId: lena })).token);
  if (opened.kind !== 'session') throw new Error('session');
  sessionToken = opened.sessionToken;
});

describe('GET /m/[mapId]/leave', () => {
  it('clears the cookie of a session that is over and says why', async () => {
    await endMapSession(state.deps, sessionToken, mapId);
    for (const [to, where] of [['invalid', '/c/invalid'], ['removed', '/c/removed'], ['renew', `/c/renew?map=${mapId}`], ['anything', '/c/invalid']]) {
      const res = await call(to!, sessionToken);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(`https://desk.test${where}`);
      expect(res.headers.get('set-cookie')).toMatch(new RegExp(`^pd_m_${mapId}=;.*Max-Age=0`, 'i'));
    }
  });

  it('leaves a working session alone: a link from elsewhere can’t sign anyone out', async () => {
    const res = await call('invalid', sessionToken);
    expect(res.headers.get('location')).toBe(`https://desk.test/m/${mapId}`);
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(state.deps.mapSessions.rows).toHaveLength(1);
  });

  it('sets no cookie without one, or for an id that isn’t a MAP’s', async () => {
    expect((await call('invalid', null)).headers.get('set-cookie')).toBeNull();
    const odd = await call('invalid', 'x', 'x;y');
    expect(odd.headers.get('location')).toBe('https://desk.test/c/invalid');
    expect(odd.headers.get('set-cookie')).toBeNull();
  });
});

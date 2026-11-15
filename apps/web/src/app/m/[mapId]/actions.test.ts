import {
  changeMap, changePartner, openMapLink, readPartners, resolveMapSession, revokeMapLinks, shareMap, startMap, type Actor,
} from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import type { MapChange } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type TestDeps = ReturnType<typeof makeTestDeps>;
const state = vi.hoisted(() => ({
  deps: null as unknown as TestDeps,
  cookies: new Map<string, string>(),
  redirected: null as string | null,
  paused: [] as string[],
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name)! } : undefined),
    delete: (name: string) => { state.cookies.delete(name); },
  }),
}));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { state.redirected = to; throw new Error('NEXT_REDIRECT'); } }));
vi.mock('@/server/runtime', () => ({
  mapAccessDeps: () => state.deps,
  pauseMapForAuth: (id: string) => { state.paused.push(id); },
  // The real resolution through the commands, with the test's tables and the MAP owner's files.
  currentLinkHolder: async (mapId: string) => {
    const token = state.cookies.get(`pd_m_${mapId}`);
    if (!token) return { kind: 'none' };
    const resolved = await resolveMapSession(state.deps, token, mapId);
    if (resolved.kind !== 'active') return resolved;
    return { kind: 'active', actor: resolved.actor, deps: state.deps, ownerName: 'Ruth', ourName: 'Halden', sessionToken: token };
  },
}));

const { leaveMap, mapLinkChange } = await import('./actions');

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

let mapId: string;
let partnerId: string;
let ids: Record<'lena' | 'ben' | 'theirs' | 'ours' | 'joint' | 'ourGoal', string>;

/** Opens Lena's link in this "browser": the cookie the link route sets. */
async function asLena() {
  const { token } = value(await shareMap(state.deps, owner, { mapId, personId: ids.lena }));
  const opened = await openMapLink(state.deps, token);
  if (opened.kind !== 'session') throw new Error('session');
  state.cookies.set(`pd_m_${mapId}`, opened.sessionToken);
  return opened.sessionToken;
}

const stored = async () => {
  const entry = (await state.deps.directory.map(mapId))!;
  const read = await state.deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) throw new Error('read');
  return read.snapshot.value;
};

beforeEach(async () => {
  state.deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
  state.paused = [];
  state.cookies.clear();
  state.redirected = null;
  await readPartners(state.deps, owner, { companyId });
  const account = value(await changePartner(state.deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }));
  partnerId = value(await changePartner(state.deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller' } },
  })).entityId!;
  mapId = value(await startMap(state.deps, owner, { companyId, partnerId })).mapId;
  const add = async (entity: string, values: Record<string, unknown>) =>
    value(await changeMap(state.deps, owner, { mapId, change: { kind: 'add', entity, values } })).entityId!;
  const lena = await add('person', { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'other' });
  const ben = await add('person', { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'other' });
  ids = {
    lena, ben,
    theirs: await add('activity', { title: 'Train our sellers', side: 'partner', ownerId: lena }),
    ours: await add('activity', { title: 'Send the price list', side: 'us', ownerId: ben }),
    joint: await add('activity', { title: 'Kickoff', side: 'joint' }),
    ourGoal: await add('objective', { side: 'us', statement: 'Close three deals', successMeasure: '' }),
  };
});

describe('mapLinkChange', () => {
  it('saves a change on the link holder’s side, as "Lena Ortiz (by link)"', async () => {
    await asLena();
    const out = await mapLinkChange({ mapId, change: { kind: 'update', entity: 'activity', id: ids.theirs, patch: { status: 'in_progress' } } });
    expect(out).toMatchObject({ ok: true });
    const activity = (await stored()).activities.find((a) => a.id === ids.theirs)!;
    expect(activity).toMatchObject({ status: 'in_progress', updatedBy: 'Lena Ortiz (by link)' });
  });

  it('refuses a crafted change for the other side, for plan info, a delete or a horizon, writing nothing, and sends the MAP back', async () => {
    await asLena();
    const before = await stored();
    const crafted: MapChange[] = [
      { kind: 'update', entity: 'activity', id: ids.ours, patch: { status: 'done' } },
      { kind: 'update', entity: 'objective', id: ids.ourGoal, patch: { statement: 'Changed' } },
      { kind: 'add', entity: 'activity', values: { title: 'Sneaky', side: 'us' } },
      { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Sneaky' } },
      { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Sneaky', role: 'other' } },
      { kind: 'updateInfo', patch: { horizonDays: 30 } },
      { kind: 'delete', entity: 'activity', id: ids.theirs },
      { kind: 'update', entity: 'activity', id: ids.joint, patch: { title: 'Renamed' } },
    ];
    for (const change of crafted) {
      const out = await mapLinkChange({ mapId, change });
      expect(out).toMatchObject({ ok: false, error: 'forbidden', snapshot: { value: { activities: expect.any(Array) } } });
    }
    expect(await stored()).toEqual(before);
  });

  it('never takes the MAP, the person or the side from the input', async () => {
    await asLena();
    const before = await stored();
    const out = await mapLinkChange({ mapId, change: { kind: 'update', entity: 'activity', id: ids.ours, patch: { status: 'done' } }, side: 'us' });
    expect(out).toMatchObject({ ok: false, error: 'invalid' });
    expect(await mapLinkChange({ mapId: 'map_9999999999', change: { kind: 'update', entity: 'activity', id: ids.theirs, patch: { status: 'done' } } }))
      .toEqual({ ok: false, error: 'auth', message: COPY.LINK_ACCESS_ENDED });
    expect(await stored()).toEqual(before);
  });

  it('answers that access was removed once the owner revokes it, writing nothing', async () => {
    await asLena();
    value(await revokeMapLinks(state.deps, owner, { mapId, personId: ids.lena }));
    const before = await stored();
    expect(await mapLinkChange({ mapId, change: { kind: 'update', entity: 'activity', id: ids.theirs, patch: { status: 'done' } } }))
      .toEqual({ ok: false, error: 'auth', message: COPY.LINK_ACCESS_REMOVED });
    expect(await stored()).toEqual(before);
  });

  it('ends the session when the partner type was taken out of Partners by hand, never showing the owner’s words', async () => {
    await asLena();
    const book = state.deps.directory.books.get(companyId)!;
    await state.deps.partnerBooks.apply(book, { kind: 'delete', entity: 'partner', id: partnerId }, { now: state.deps.clock(), actor: 'Hand' });
    const out = await mapLinkChange({ mapId, change: { kind: 'update', entity: 'activity', id: ids.theirs, patch: { status: 'done' } } });
    expect(out).toEqual({ ok: false, error: 'auth', message: COPY.LINK_ACCESS_ENDED });
    expect(JSON.stringify(out)).not.toContain('Partners');
    expect(state.deps.mapSessions.rows).toEqual([]);
    expect(state.cookies.has(`pd_m_${mapId}`)).toBe(false);
  });

  it('says the MAP can’t be reached when the owner’s files can’t, never why', async () => {
    await asLena();
    vi.spyOn(state.deps.maps, 'apply').mockResolvedValueOnce({ ok: false, error: 'auth', message: COPY.RECONNECT_TITLE });
    expect(await mapLinkChange({ mapId, change: { kind: 'update', entity: 'activity', id: ids.theirs, patch: { status: 'done' } } }))
      .toEqual({ ok: false, error: 'unavailable', message: COPY.LINK_MAP_UNAVAILABLE });
    // The owner's Google access is broken: the MAP pauses and its owner gets the Reconnect email (after the answer).
    expect(state.paused).toEqual([mapId]);
  });
});

describe('leaveMap (Sign out)', () => {
  it('ends the session here and on our side; the link still opens a new one', async () => {
    const sessionToken = await asLena();
    const form = new FormData();
    form.set('mapId', mapId);
    await expect(leaveMap(form)).rejects.toThrow('NEXT_REDIRECT');
    expect(state.redirected).toBe('/c/signed-out');
    expect(state.cookies.has(`pd_m_${mapId}`)).toBe(false);
    expect(await resolveMapSession(state.deps, sessionToken, mapId)).toEqual({ kind: 'none' });
  });

  it('touches nothing for a MAP id it doesn’t know', async () => {
    await asLena();
    const form = new FormData();
    form.set('mapId', 'x; Path=/');
    await expect(leaveMap(form)).rejects.toThrow('NEXT_REDIRECT');
    expect(state.deps.mapSessions.rows).toHaveLength(1);
  });
});

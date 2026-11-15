import { describe, expect, it } from 'vitest';
import type { MapChange } from '@partner-desk/core';
import type { Actor } from './actor';
import { openMapLink, resolveMapSession, shareMap } from './map-links';
import {
  changeMap, DEFAULT_TIME_ZONE, readMap, mapNotifySettings, ownerToday, readMapForJob, saveMapNotifySettings, saveTimeZone, startMap, timeZoneSetting,
} from './maps';
import { changePartner, readPartners } from './partners';
import { makeTestDeps, TEST_NOW } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const agent: Actor = { kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level: 'change', via: { kind: 'app', clientId: 'c_claude' } };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function setup(now = TEST_NOW) {
  const deps = { ...makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } }), clock: () => now };
  await readPartners(deps, owner, { companyId });
  return deps;
}
type TestDeps = Awaited<ReturnType<typeof setup>>;

async function addPartnerType(deps: TestDeps, company = 'Acme') {
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company } } }));
  const added = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller', whyItFits: 'Fits' } },
  }));
  return added.entityId!;
}

const change = async (deps: TestDeps, actor: Actor, mapId: string, c: MapChange) => changeMap(deps, actor, { mapId, change: c });

async function withMap(deps: TestDeps) {
  const partnerId = await addPartnerType(deps);
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const add = async (entity: 'activity' | 'person' | 'objective', values: Record<string, unknown>) =>
    value(await change(deps, owner, mapId, { kind: 'add', entity, values })).entityId!;
  const lena = await add('person', { side: 'partner', name: 'Lena Ortiz', title: 'Sales lead', email: 'lena@example.com', role: 'sales_lead' });
  const theirs = await add('activity', { title: 'SECRET their task', side: 'partner', ownerId: lena, dueDate: '2026-11-12' });
  return { partnerId, mapId, lena, theirs };
}

async function linkActor(deps: TestDeps, mapId: string, personId: string) {
  const { token } = value(await shareMap(deps, owner, { mapId, personId }));
  const opened = await openMapLink(deps, token);
  if (opened.kind !== 'session') throw new Error('setup');
  const resolved = await resolveMapSession(deps, opened.sessionToken, mapId);
  if (resolved.kind !== 'active') throw new Error('setup');
  return resolved.actor;
}

async function partnerRow(deps: TestDeps, partnerId: string) {
  return value(await readPartners(deps, owner, { companyId })).value.partners.find((p) => p.id === partnerId)!;
}

describe('the owner’s today', () => {
  it('is the date in the owner’s timezone, Europe/Berlin until they choose one', async () => {
    // 23:30 UTC on Oct 27 is already Oct 28 in Berlin, and still Oct 27 in New York.
    const deps = await setup('2026-10-27T23:30:00.000Z');
    expect(DEFAULT_TIME_ZONE).toBe('Europe/Berlin');
    expect(await ownerToday(deps, 'u1')).toBe('2026-10-28');
    value(await saveTimeZone(deps, owner, { timeZone: 'America/New_York' }));
    expect(await ownerToday(deps, 'u1')).toBe('2026-10-27');
    expect(value(await timeZoneSetting(deps, owner, {}))).toEqual({ timeZone: 'America/New_York' });
  });

  it('refuses a zone this runtime doesn’t know, and lets only the person choose it', async () => {
    const deps = await setup();
    expect(await saveTimeZone(deps, owner, { timeZone: 'Mars/Olympus' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await saveTimeZone(deps, agent, { timeZone: 'Europe/Paris' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await saveTimeZone(deps, owner, { timeZone: 'Europe/Paris', userId: 'u2' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(value(await timeZoneSetting(deps, owner, {}))).toEqual({ timeZone: 'Europe/Berlin' });
    expect(deps.events.events.map((e) => e.command)).not.toContain('company.timezone');
  });

  it('starts a new horizon on the owner’s today', async () => {
    const deps = await setup('2026-10-27T23:30:00.000Z');
    const partnerId = await addPartnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-01' } }));
    const out = value(await change(deps, owner, mapId, {
      kind: 'startHorizon', expectedStartDate: '2026-10-01', expectedHorizon: 0, startDate: '2020-01-01', horizonDays: 90, milestones: [],
    }));
    expect(out.info.startDate).toBe('2026-10-28');
  });
});

describe('a company server’s time zone and MAP email settings, by role (plan 15)', () => {
  // 'u1' stands for the workspace key here: every member's actor carries it.
  const member = (role: 'admin' | 'partnerManager' | 'viewer'): Actor => ({
    kind: 'owner', userId: 'u1', displayName: role, member: { personId: `u_${role}`, role },
  });

  it('an admin sets the time zone; every member reads it; only the admin changes it', async () => {
    const deps = await setup();
    value(await saveTimeZone(deps, member('admin'), { timeZone: 'America/New_York' }));
    for (const role of ['admin', 'partnerManager', 'viewer'] as const) {
      expect(value(await timeZoneSetting(deps, member(role), {}))).toEqual({ timeZone: 'America/New_York' });
    }
    for (const role of ['partnerManager', 'viewer'] as const) {
      expect(await saveTimeZone(deps, member(role), { timeZone: 'Europe/Paris' })).toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect(value(await timeZoneSetting(deps, member('viewer'), {}))).toEqual({ timeZone: 'America/New_York' });
  });

  it('a viewer reads a MAP’s email settings and can’t change them; a partner manager can', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    const read = value(await mapNotifySettings(deps, member('viewer'), { mapId }));
    expect(await saveMapNotifySettings(deps, member('viewer'), { mapId, settings: read.settings })).toMatchObject({ ok: false, error: 'forbidden' });
    expect((await saveMapNotifySettings(deps, member('partnerManager'), { mapId, settings: { ...read.settings, dueSoonDays: 7 } })).ok).toBe(true);
    expect(value(await mapNotifySettings(deps, member('viewer'), { mapId })).settings.dueSoonDays).toBe(7);
  });
});

describe('a MAP’s email settings', () => {
  it('read as the MAP app’s defaults, save for the owner only, and record ids only', async () => {
    const deps = await setup();
    const { mapId } = await withMap(deps);
    expect(value(await mapNotifySettings(deps, owner, { mapId }))).toEqual({
      settings: { dueSoonDays: 3, partnerDigest: false, partnerAlerts: 'instant' }, timeZone: 'Europe/Berlin',
    });
    const settings = { dueSoonDays: 7, partnerDigest: true, partnerAlerts: 'daily' } as const;
    expect(value(await saveMapNotifySettings(deps, owner, { mapId, settings }))).toEqual(settings);
    expect((await mapNotifySettings(deps, owner, { mapId })).ok && value(await mapNotifySettings(deps, owner, { mapId })).settings).toEqual(settings);
    expect(deps.events.events.at(-1)).toMatchObject({ command: 'maps.notify', entityIds: [mapId] });
    for (const actor of [stranger, agent]) {
      expect((await saveMapNotifySettings(deps, actor, { mapId, settings })).ok).toBe(false);
      expect((await mapNotifySettings(deps, actor, { mapId })).ok).toBe(false);
    }
    expect(await saveMapNotifySettings(deps, owner, { mapId, settings: { ...settings, dueSoonDays: 5 } })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('turning partner alerts on from off starts after the changes already made', async () => {
    const deps = await setup();
    const { mapId, lena, theirs } = await withMap(deps);
    const off = { dueSoonDays: 3, partnerDigest: false, partnerAlerts: 'off' } as const;
    value(await saveMapNotifySettings(deps, owner, { mapId, settings: off }));
    const actor = await linkActor(deps, mapId, lena);
    value(await change(deps, actor, mapId, { kind: 'update', entity: 'activity', id: theirs, patch: { status: 'done' } }));
    const latest = await deps.mapEvents.latestId(mapId);
    expect(latest).not.toBeNull();
    value(await saveMapNotifySettings(deps, owner, { mapId, settings: { ...off, partnerAlerts: 'instant' } }));
    expect((await deps.directory.mapNotifyState(mapId))!.partnerAlertsThrough).toBe(latest);
  });
});

describe('changes by a person with a link, for partner alerts', () => {
  it('are recorded with ids and codes only; the owner’s are not', async () => {
    const deps = await setup();
    const { mapId, lena, theirs } = await withMap(deps);
    expect(await deps.mapEvents.since(mapId, null)).toEqual([]);
    const actor = await linkActor(deps, mapId, lena);
    value(await change(deps, actor, mapId, { kind: 'update', entity: 'activity', id: theirs, patch: { status: 'in_progress' } }));
    value(await change(deps, actor, mapId, { kind: 'update', entity: 'activity', id: theirs, patch: { note: 'SECRET note' } }));
    const added = value(await change(deps, actor, mapId, { kind: 'add', entity: 'objective', values: { side: 'partner', statement: 'SECRET', successMeasure: '' } }));
    const events = await deps.mapEvents.since(mapId, null);
    expect(events.map(({ entityType, entityId, action, actorRef }) => ({ entityType, entityId, action, actorRef }))).toEqual([
      { entityType: 'activity', entityId: theirs, action: 'status_changed', actorRef: actor.linkId },
      { entityType: 'activity', entityId: theirs, action: 'updated', actorRef: actor.linkId },
      { entityType: 'objective', entityId: added.entityId, action: 'created', actorRef: actor.linkId },
    ]);
    expect(JSON.stringify(events)).not.toContain('SECRET');
    expect(await deps.mapEvents.since(mapId, events[1]!.id)).toHaveLength(1);
  });
});

describe('readMapForJob (the scheduled job’s read and the health refresh, spec 5.7)', () => {
  it('reads the joined MAP with its last progress, and writes the partner row only when its summary changed', async () => {
    const deps = await setup();
    const { mapId, partnerId } = await withMap(deps);
    const before = await partnerRow(deps, partnerId);
    expect(before.mapHealth).toBe('on_track');
    const read = value(await readMapForJob(deps, owner, { mapId }));
    expect(read).toMatchObject({ today: '2026-10-28', refreshed: 'unchanged' });
    expect(read.plan.info.partnerName).toBe('Acme');
    expect(read.lastEventAt).toBe(TEST_NOW);
    // 30 days later with no change: off track, written once.
    const later = { ...deps, clock: () => '2026-12-20T10:00:00.000Z' };
    expect(value(await readMapForJob(later, owner, { mapId })).refreshed).toBe('written');
    expect((await partnerRow(deps, partnerId)).mapHealth).toBe('off_track');
    expect(value(await readMapForJob(later, owner, { mapId })).refreshed).toBe('unchanged');
  });

  it('skips a partner row it can’t read, writes nothing and logs ids only; the next run tries again', async () => {
    const deps = await setup();
    const logged: Array<[string, Record<string, string>]> = [];
    const { mapId, partnerId } = await withMap(deps);
    const later = { ...deps, clock: () => '2026-12-20T10:00:00.000Z', log: (e: string, ids: Record<string, string>) => { logged.push([e, ids]); } };
    // A Partners file it can't read (a renamed tab, Google not answering): nothing is written.
    const writes: unknown[] = [];
    const store = (overrides: Partial<TestDeps['partnerBooks']>) => Object.assign(Object.create(deps.partnerBooks), overrides) as TestDeps['partnerBooks'];
    const recording = (apply: TestDeps['partnerBooks']['apply']): TestDeps['partnerBooks']['apply'] => async (...args) => { writes.push(args[1]); return apply(...args); };
    const unreadable = { ...later, partnerBooks: store({ read: async () => ({ ok: false, error: 'unavailable', message: 'x' }), apply: recording(deps.partnerBooks.apply.bind(deps.partnerBooks)) }) };
    expect(await readMapForJob(unreadable, owner, { mapId })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(writes).toEqual([]);
    // A row changed since it was read: the write is refused as a conflict, nothing is written, ids are logged.
    const stale = { ...later, partnerBooks: store({ apply: recording(async () => ({ ok: false, error: 'conflict', message: 'x' })) }) };
    expect(value(await readMapForJob(stale, owner, { mapId })).refreshed).toBe('failed');
    expect(writes).toEqual([expect.objectContaining({ kind: 'setMapSummary', partnerId, expectedUpdatedAt: expect.any(String) })]);
    expect(logged.at(-1)).toEqual(['map_summary_write_failed', { mapId, partnerId, error: 'conflict' }]);
    expect((await partnerRow(deps, partnerId)).mapHealth).toBe('on_track');
  });

  it('is the owner’s: a stranger and a person with a link get nothing', async () => {
    const deps = await setup();
    const { mapId, lena } = await withMap(deps);
    expect((await readMapForJob(deps, stranger, { mapId })).ok).toBe(false);
    expect((await readMapForJob(deps, await linkActor(deps, mapId, lena), { mapId })).ok).toBe(false);
  });
});

describe('a MAP paused because its owner’s Google access broke', () => {
  it('resumes on the next good read of the MAP, and stays paused while reads fail', async () => {
    const deps = await setup();
    const { mapId } = await withMap(deps);
    expect(await deps.directory.pauseMap(mapId)).toBe(true);
    const read = deps.maps.read.bind(deps.maps);
    deps.maps.read = async () => ({ ok: false, error: 'auth', message: 'Reconnect' });
    expect((await readMap(deps, owner, { mapId })).ok).toBe(false);
    expect((await deps.directory.mapNotifyState(mapId))!.pausedReason).toBe('auth');
    deps.maps.read = read;
    value(await readMap(deps, owner, { mapId }));
    expect((await deps.directory.mapNotifyState(mapId))!.pausedReason).toBeNull();
  });
});

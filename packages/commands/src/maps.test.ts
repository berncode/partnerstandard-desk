import { describe, expect, it, vi } from 'vitest';
import { mapSummary, type MapChange, type MapPlan, type PartnerBook } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Actor } from './actor';
import { openMapLink, resolveMapSession, shareMap } from './map-links';
import { changeMap, deleteMap, fillMap, listMapIds, listMaps, readMap, saveTimeZone, shiftMapDates, startMap } from './maps';
import { listCases } from './cases';
import { changePartner, readPartners, recreatePartnerBook, removePartnerType } from './partners';
import { readCompanyFacts } from './programs';
import { openReview } from './reviews';
import { makeTestDeps, TEST_NOW } from './testing';
import * as commandsPackage from './index';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
const companyId = 'co_aaaaaaaaaa';
const TODAY = TEST_NOW.slice(0, 10);

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  await readPartners(deps, owner, { companyId });
  deps.events.events.length = 0;
  return deps;
}

type TestDeps = Awaited<ReturnType<typeof setup>>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function addPartnerType(deps: TestDeps, partnerType = 'reseller', company = 'Acme') {
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company } } }));
  const added = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType, whyItFits: 'Fits' } },
  }));
  return added.entityId!;
}

async function partnerRow(deps: TestDeps, partnerId: string) {
  return value(await readPartners(deps, owner, { companyId })).value.partners.find((p) => p.id === partnerId);
}

async function stored(deps: TestDeps, mapId: string): Promise<MapPlan> {
  const entry = (await deps.directory.map(mapId))!;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) throw new Error('setup');
  return read.snapshot.value;
}

const change = async (deps: TestDeps, actor: Actor, mapId: string, c: MapChange) => changeMap(deps, actor, { mapId, change: c });

/**
 * A reseller partner type with a MAP holding a person on each side (both with an email), an objective on each side, an
 * activity on each side and a joint one, a milestone and an exit trigger.
 */
async function withMap(deps: TestDeps) {
  const partnerId = await addPartnerType(deps);
  const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
  const add = async (entity: 'objective' | 'activity' | 'person' | 'milestone' | 'exitTrigger', values: Record<string, unknown>) =>
    value(await change(deps, owner, mapId, { kind: 'add', entity, values })).entityId!;
  const lena = await add('person', { side: 'partner', name: 'Lena Ortiz', title: 'Sales lead', email: 'lena@example.com', role: 'sales_lead' });
  const ben = await add('person', { side: 'us', name: 'Ben Ito', title: 'Marketing', email: 'ben@example.com', role: 'marketing_lead' });
  const quiet = await add('person', { side: 'partner', name: 'Quiet Person', title: '', email: null, role: 'other' });
  const ours = await add('objective', { side: 'us', statement: 'SECRET our goal', successMeasure: 'x' });
  const theirs = await add('objective', { side: 'partner', statement: 'SECRET their goal', successMeasure: 'y' });
  const milestone = await add('milestone', { name: 'First deal', targetDate: '2026-12-01', criteria: '' });
  const usActivity = await add('activity', { title: 'SECRET our task', side: 'us', ownerId: ben, dueDate: '2026-11-10' });
  const partnerActivity = await add('activity', { title: 'SECRET their task', side: 'partner', ownerId: lena, dueDate: '2026-11-12' });
  const joint = await add('activity', { title: 'SECRET joint task', side: 'joint', dueDate: '2026-11-15', milestoneId: milestone });
  const trigger = await add('exitTrigger', { condition: 'SECRET no deals', status: 'ok' });
  deps.events.events.length = 0;
  return { partnerId, mapId, lena, ben, quiet, ours, theirs, milestone, usActivity, partnerActivity, joint, trigger };
}

type WithMap = Awaited<ReturnType<typeof withMap>>;

/** A person's link, opened: the actor their session resolves to. */
async function linkActor(deps: TestDeps, mapId: string, personId: string) {
  const { token } = value(await shareMap(deps, owner, { mapId, personId }));
  const opened = await openMapLink(deps, token);
  if (opened.kind !== 'session') throw new Error('setup');
  const resolved = await resolveMapSession(deps, opened.sessionToken, mapId);
  if (resolved.kind !== 'active') throw new Error('setup');
  return { actor: resolved.actor, token, sessionToken: opened.sessionToken };
}

describe('startMap', () => {
  it('makes the MAP file, lists it as "Acme as reseller", writes its health to the partner type once it has something in it, and records ids only', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    const before = await partnerRow(deps, partnerId);
    deps.events.events.length = 0;
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    const entry = (await deps.directory.map(mapId))!;
    expect(entry).toMatchObject({
      ownerUserId: 'u1', companyId, partnerId, partnerType: 'reseller', displayName: 'Acme as reseller', createdAt: TEST_NOW,
      datesMovedFor: null, datesMoveFailedFor: null,
    });
    const plan = await stored(deps, mapId);
    expect(plan.info).toEqual({ partnerId, partnerType: 'reseller', horizonDays: 90, laterHorizons: [], nextReviewDate: null });
    // An empty MAP has no health (owner, 2026-10-31): the row keeps none until the MAP has an activity or a milestone.
    expect(await partnerRow(deps, partnerId)).toEqual(before);
    expect(deps.events.events.filter((e) => e.command.startsWith('maps.'))).toEqual([
      expect.objectContaining({ command: 'maps.start', fileId: entry.fileId, entityIds: [mapId, partnerId] }),
    ]);
    const { entityId } = value(await change(deps, owner, mapId, { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } }));
    expect(await partnerRow(deps, partnerId)).toMatchObject({ mapHealth: 'on_track', mapNextMilestone: null });
    // Empty again: the row's health is cleared, so the list says "Nothing planned yet" again.
    value(await change(deps, owner, mapId, { kind: 'delete', entity: 'activity', id: entityId! }));
    expect(await partnerRow(deps, partnerId)).toMatchObject({ mapHealth: null, mapNextMilestone: null });
  });

  /** Starts a MAP at `now` and answers the day it starts on, as the directory, readMap and listMaps each have it. */
  async function startedAt(now: string, timeZone?: string) {
    const deps = await setup();
    if (timeZone) value(await saveTimeZone(deps, owner, { timeZone }));
    const partnerId = await addPartnerType(deps);
    deps.clock = () => now;
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    const entry = (await deps.directory.map(mapId))!;
    const listed = value(await listMaps(deps, owner, { companyId })).find((m) => m.mapId === mapId)!;
    return { entry, read: value(await readMap(deps, owner, { mapId })), listed };
  }

  it('starts a MAP made at 00:30 in Berlin on Berlin’s date, not UTC’s', async () => {
    // 23:30 UTC on Nov 3 is 00:30 on Nov 4 in Berlin, the owner's timezone until they choose one.
    const { entry, read, listed } = await startedAt('2026-11-03T23:30:00.000Z');
    expect(entry.startedOn).toBe('2026-11-04');
    expect(entry.createdAt).toBe('2026-11-03T23:30:00.000Z');
    expect(read.startedOn).toBe('2026-11-04');
    expect(read.plannedStart).toBe('2026-11-04');
    expect(read.info.startDate).toBe('2026-11-04');
    expect(listed.plannedStart).toBe('2026-11-04');
  });

  it('in summer time too', async () => {
    // 22:30 UTC on Jul 14 is 00:30 on Jul 15 in Berlin (UTC+2).
    const { entry, read, listed } = await startedAt('2026-07-14T22:30:00.000Z');
    expect(entry.startedOn).toBe('2026-07-15');
    expect(read.startedOn).toBe('2026-07-15');
    expect(listed.plannedStart).toBe('2026-07-15');
  });

  it('in the owner’s own timezone', async () => {
    // 06:30 UTC on Nov 4 is still 22:30 on Nov 3 in Los Angeles.
    const { entry, read, listed } = await startedAt('2026-11-04T06:30:00.000Z', 'America/Los_Angeles');
    expect(entry.startedOn).toBe('2026-11-03');
    expect(read.startedOn).toBe('2026-11-03');
    expect(listed.plannedStart).toBe('2026-11-03');
  });

  it('starts one MAP per partner type, and writes nothing for a second', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    value(await startMap(deps, owner, { companyId, partnerId }));
    const create = vi.spyOn(deps.maps, 'create');
    expect(await startMap(deps, owner, { companyId, partnerId })).toEqual({
      ok: false, error: 'invalid', message: COPY.MAP_ALREADY, fieldErrors: { partnerId: COPY.MAP_ALREADY },
    });
    expect(create).not.toHaveBeenCalled();
    expect(await deps.directory.maps(companyId)).toHaveLength(1);
  });

  it('throws away its file when a second start won the race', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    const discard = vi.spyOn(deps.maps, 'discard');
    vi.spyOn(deps.directory, 'mapFor').mockResolvedValueOnce(null);
    value(await startMap(deps, owner, { companyId, partnerId }));
    vi.spyOn(deps.directory, 'mapFor').mockResolvedValueOnce(null);
    expect(await startMap(deps, owner, { companyId, partnerId })).toMatchObject({ ok: false, message: COPY.MAP_ALREADY });
    expect(discard).toHaveBeenCalledTimes(1);
    expect(await deps.directory.maps(companyId)).toHaveLength(1);
  });

  it('refuses a partner type that is not in Partners, another person, and agents below change', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    expect(await startMap(deps, owner, { companyId, partnerId: 'p_missing' })).toMatchObject({ ok: false, fieldErrors: { partnerId: COPY.MAP_TYPE_GONE } });
    expect(await startMap(deps, stranger, { companyId, partnerId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await startMap(deps, stranger, { companyId: 'co_bbbbbbbbbb', partnerId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await startMap(deps, agent('read'), { companyId, partnerId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await startMap(deps, owner, { companyId: 'nope', partnerId })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await deps.directory.maps(companyId)).toEqual([]);
    expect((await startMap(deps, agent('change'), { companyId, partnerId })).ok).toBe(true);
  });
});

describe('one MAP per partner type, within a company (partner type ids are unique only within one)', () => {
  const OTHER = 'co_bbbbbbbbbb';

  /** Anna's company with a partner type; with `sameIdAs`, it has that id, as a copied Partners sheet would. */
  async function theirType(deps: TestDeps, sameIdAs?: string): Promise<string> {
    value(await readPartners(deps, stranger, { companyId: OTHER }));
    const account = value(await changePartner(deps, stranger, { companyId: OTHER, change: { kind: 'add', entity: 'account', values: { company: 'Brightwave' } } }));
    const made = value(await changePartner(deps, stranger, {
      companyId: OTHER, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller', whyItFits: 'Fits' } },
    })).entityId!;
    if (sameIdAs === undefined) return made;
    const book = (await deps.directory.partnerBook(OTHER))!;
    const file = (deps.partnerBooks as unknown as { files: Map<string, PartnerBook> }).files.get(book.fileId)!;
    file.partners = file.partners.map((p) => (p.id === made ? { ...p, id: sameIdAs } : p));
    return sameIdAs;
  }

  it('lets two companies whose partner types share an id each start a MAP', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    await theirType(deps, partnerId);
    const mine = value(await startMap(deps, owner, { companyId, partnerId }));
    const theirs = value(await startMap(deps, stranger, { companyId: OTHER, partnerId }));
    expect(theirs.mapId).not.toBe(mine.mapId);
    expect(await deps.directory.mapFor(companyId, partnerId)).toMatchObject({ mapId: mine.mapId, ownerUserId: 'u1', displayName: 'Acme as reseller' });
    expect(await deps.directory.mapFor(OTHER, partnerId)).toMatchObject({ mapId: theirs.mapId, ownerUserId: 'u2', displayName: 'Brightwave as reseller' });
    // Each company's own signing finds its own MAP.
    value(await changePartner(deps, stranger, { companyId: OTHER, change: { kind: 'markSigned', partnerId, signedDate: '2026-11-07' }, shiftMapDates: true }));
    expect(await deps.directory.map(theirs.mapId)).toMatchObject({ datesMovedFor: '2026-11-07' });
    expect(await deps.directory.map(mine.mapId)).toMatchObject({ datesMovedFor: null });
  });

  it('answers a partner type that is only in another company’s Partners as not there, never as having a MAP', async () => {
    const deps = await setup();
    await addPartnerType(deps);
    const elsewhere = await theirType(deps);
    value(await startMap(deps, stranger, { companyId: OTHER, partnerId: elsewhere }));
    const create = vi.spyOn(deps.maps, 'create');
    const answer = await startMap(deps, owner, { companyId, partnerId: elsewhere });
    expect(answer).toEqual(await startMap(deps, owner, { companyId, partnerId: 'p_missing' }));
    expect(answer).toMatchObject({ ok: false, fieldErrors: { partnerId: COPY.MAP_TYPE_GONE } });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('listMaps and readMap', () => {
  it('lists the company’s MAPs with the partner record’s stage and the summary on the partner row', async () => {
    const deps = await setup();
    const { mapId, partnerId } = await withMap(deps);
    const other = await addPartnerType(deps, 'referral', 'Brightwave');
    expect(value(await listMaps(deps, owner, { companyId }))).toEqual([{
      mapId, partnerId, partnerType: 'reseller', displayName: 'Acme as reseller', createdAt: TEST_NOW, plannedStart: TODAY,
      stage: 'recruitment', signedDate: null, health: 'on_track', nextMilestone: '2026-12-01', datesMoveFailed: false, lastProgressAt: TEST_NOW,
    }]);
    expect(value(await listMaps(deps, owner, { companyId, partnerId: other }))).toEqual([]);
    expect(await listMaps(deps, stranger, { companyId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(value(await listMaps(deps, stranger, { companyId: 'co_bbbbbbbbbb' }))).toEqual([]);
  });

  it('lists the MAPs from the directory alone, even with the Partners file gone, and reads no file', async () => {
    const deps = await setup();
    const { mapId, partnerId } = await withMap(deps);
    const other = await addPartnerType(deps, 'referral', 'Brightwave');
    const read = vi.spyOn(deps.partnerBooks, 'read').mockResolvedValue({ ok: false, error: 'file_not_found', message: 'Gone' });
    const mapRead = vi.spyOn(deps.maps, 'read');
    expect(await listMaps(deps, owner, { companyId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(value(await listMapIds(deps, owner, { companyId }))).toEqual([{ mapId, partnerId, partnerType: 'reseller' }]);
    expect(value(await listMapIds(deps, owner, { companyId, partnerId: other }))).toEqual([]);
    expect(await listMapIds(deps, stranger, { companyId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(value(await listMapIds(deps, stranger, { companyId: 'co_bbbbbbbbbb' }))).toEqual([]);
    expect(await listMapIds(deps, owner, { companyId: 'nope' })).toMatchObject({ ok: false, error: 'invalid' });
    read.mockClear();
    await listMapIds(deps, owner, { companyId });
    expect(read).not.toHaveBeenCalled();
    expect(mapRead).not.toHaveBeenCalled();
  });

  it('reads the MAP joined with the partner record: recruitment from its created date, then horizon 1 from the signing', async () => {
    const deps = await setup();
    const { mapId, partnerId } = await withMap(deps);
    const read = value(await readMap(deps, owner, { mapId }));
    expect(read.record).toEqual({
      partnerName: 'Acme', partnerType: 'reseller', stage: 'recruitment', signedDate: null, closed: null, closedReason: '',
    });
    expect(read.info).toMatchObject({ partnerName: 'Acme', stage: 'recruitment', startDate: TODAY, horizonDays: 90 });
    expect(read.value.objectives).toHaveLength(2);
    expect(read.fileUrl).toMatch(/^memory:\/\//);
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-11-07' } }));
    expect(value(await readMap(deps, owner, { mapId })).info).toMatchObject({ stage: 'onboarding', startDate: '2026-11-07', horizonDays: 90 });
  });

  it('lets an agent read at any level, and answers another person as for a MAP that isn’t there', async () => {
    const deps = await setup();
    const { mapId } = await withMap(deps);
    for (const level of ['read', 'change', 'propose'] as const) expect((await readMap(deps, agent(level), { mapId })).ok).toBe(true);
    const notListed = { ok: false, error: 'file_not_found', message: COPY.MAP_NOT_LISTED };
    expect(await readMap(deps, stranger, { mapId })).toEqual(notListed);
    expect(await readMap(deps, owner, { mapId: 'map_missing' })).toEqual(notListed);
  });

  it('follows a renamed partner in its listing, and says when the partner type is gone from Partners', async () => {
    const deps = await setup();
    const { mapId, partnerId } = await withMap(deps);
    const row = (await partnerRow(deps, partnerId))!;
    value(await changePartner(deps, owner, { companyId, change: { kind: 'update', entity: 'account', id: row.accountId, patch: { company: 'Acme Group' } } }));
    expect(value(await readMap(deps, owner, { mapId })).info.partnerName).toBe('Acme Group');
    expect((await deps.directory.map(mapId))!.displayName).toBe('Acme Group as reseller');
    const book = deps.directory.books.get(companyId)!;
    await deps.partnerBooks.apply(book, { kind: 'delete', entity: 'partner', id: partnerId }, { now: TEST_NOW, actor: 'Hand' });
    expect(await readMap(deps, owner, { mapId })).toMatchObject({ ok: false, message: COPY.MAP_TYPE_GONE });
  });
});

describe('changeMap', () => {
  it('applies the owner’s change, records ids only, and writes the health and next milestone without stamping the row', async () => {
    const deps = await setup();
    const { mapId, partnerId, milestone } = await withMap(deps);
    const before = (await partnerRow(deps, partnerId))!;
    const out = value(await change(deps, owner, mapId, { kind: 'update', entity: 'milestone', id: milestone, patch: { targetDate: '2026-11-20' } }));
    expect(out.snapshot.value.milestones[0]).toMatchObject({ targetDate: '2026-11-20' });
    expect(out.info).toMatchObject({ stage: 'recruitment' });
    const after = (await partnerRow(deps, partnerId))!;
    expect(after).toEqual({ ...before, mapNextMilestone: '2026-11-20' });
    const entry = (await deps.directory.map(mapId))!;
    expect(deps.events.events.filter((e) => e.command === 'maps.change')).toEqual([
      expect.objectContaining({ fileId: entry.fileId, actorKind: 'owner', entityIds: [mapId, milestone] }),
    ]);
  });

  it('answers with what the MAP page joins the MAP with: the record, the day it was started and this change as its last progress', async () => {
    const deps = await setup();
    const { mapId, milestone } = await withMap(deps);
    const read = value(await readMap(deps, owner, { mapId }));
    expect(read.startedOn).toBe(TODAY);
    const out = value(await change(deps, owner, mapId, { kind: 'update', entity: 'milestone', id: milestone, patch: { criteria: 'A deal' } }));
    expect(out.record).toEqual(read.record);
    expect(out.startedOn).toBe(TODAY);
    expect(out.lastProgressAt).toBe(TEST_NOW);
    expect(value(await readMap(deps, owner, { mapId })).lastProgressAt).toBe(TEST_NOW);
  });

  it('starts a new horizon on the server’s today, whatever date a page left open sends', async () => {
    const deps = await setup();
    const { mapId, partnerId } = await withMap(deps);
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-09-01' } }));
    const { info } = value(await readMap(deps, owner, { mapId }));
    const out = value(await change(deps, owner, mapId, {
      kind: 'startHorizon', expectedStartDate: info.startDate, expectedHorizon: 0, startDate: '2026-01-01', horizonDays: 60, milestones: [],
    }));
    expect(out.snapshot.value.info.laterHorizons).toEqual([{ startDate: TODAY, horizonDays: 60 }]);
    expect(out.info).toMatchObject({ startDate: TODAY, horizonDays: 60, pastHorizons: [{ startDate: '2026-09-01', horizonDays: 90 }] });
  });

  it('logs a health write that fails, with ids only, and the change still stands', async () => {
    const deps = await setup();
    const { mapId, partnerId, milestone } = await withMap(deps);
    const log = vi.fn();
    deps.log = log;
    vi.spyOn(deps.partnerBooks, 'apply').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x' });
    expect((await change(deps, owner, mapId, { kind: 'update', entity: 'milestone', id: milestone, patch: { targetDate: '2026-11-21' } })).ok).toBe(true);
    expect(log).toHaveBeenCalledWith('map_summary_write_failed', { mapId, partnerId, error: 'unavailable' });
    vi.spyOn(deps.partnerBooks, 'apply').mockRejectedValueOnce(new Error('Acme SECRET'));
    expect((await change(deps, owner, mapId, { kind: 'update', entity: 'milestone', id: milestone, patch: { targetDate: '2026-11-22' } })).ok).toBe(true);
    expect(log).toHaveBeenLastCalledWith('map_summary_write_failed', { mapId, partnerId, error: 'thrown' });
    expect((await stored(deps, mapId)).milestones[0]!.targetDate).toBe('2026-11-22');
  });

  it('refuses a malformed change, another person, and an agent below change; an agent never deletes', async () => {
    const deps = await setup();
    const { mapId, usActivity } = await withMap(deps);
    const before = await stored(deps, mapId);
    expect(await changeMap(deps, owner, { mapId, change: { kind: 'signAgreement' } })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await change(deps, stranger, mapId, { kind: 'delete', entity: 'activity', id: usActivity })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await change(deps, agent('read'), mapId, { kind: 'update', entity: 'activity', id: usActivity, patch: { status: 'done' } }))
      .toMatchObject({ ok: false, error: 'forbidden' });
    expect(await change(deps, agent('change'), mapId, { kind: 'delete', entity: 'activity', id: usActivity }))
      .toMatchObject({ ok: false, error: 'forbidden', message: COPY.MAP_AGENT_NO_DELETE });
    expect(await stored(deps, mapId)).toEqual(before);
    expect((await change(deps, agent('change'), mapId, { kind: 'update', entity: 'activity', id: usActivity, patch: { status: 'done' } })).ok).toBe(true);
  });

  it('lets an agent at propose change a MAP as one at change does, and never delete', async () => {
    const deps = await setup();
    const { mapId, usActivity } = await withMap(deps);
    expect(await change(deps, agent('propose'), mapId, { kind: 'delete', entity: 'activity', id: usActivity }))
      .toMatchObject({ ok: false, error: 'forbidden', message: COPY.MAP_AGENT_NO_DELETE });
    const done = await change(deps, agent('propose'), mapId, { kind: 'update', entity: 'activity', id: usActivity, patch: { status: 'done' } });
    expect(done.ok).toBe(true);
    expect((await stored(deps, mapId)).activities.find((a) => a.id === usActivity)).toMatchObject({ status: 'done', updatedBy: 'Desk Agent for Ruth' });
  });
});

describe('Review Focus 1: a person with a link changes only their own side', () => {
  /** Every change a link holder on `side` must be refused, with nothing written. */
  function refusedFor(m: WithMap, side: 'us' | 'partner'): Array<[string, MapChange]> {
    const other = side === 'us' ? 'partner' : 'us';
    const otherActivity = side === 'us' ? m.partnerActivity : m.usActivity;
    const ownActivity = side === 'us' ? m.usActivity : m.partnerActivity;
    const otherObjective = side === 'us' ? m.theirs : m.ours;
    const ownObjective = side === 'us' ? m.ours : m.theirs;
    const otherPerson = side === 'us' ? m.lena : m.ben;
    return [
      ['plan info', { kind: 'updateInfo', patch: { horizonDays: 60 } }],
      ['next review', { kind: 'updateInfo', patch: { nextReviewDate: '2026-12-01' } }],
      ['startHorizon', { kind: 'startHorizon', expectedStartDate: TODAY, expectedHorizon: 0, startDate: TODAY, horizonDays: 90, milestones: [] }],
      ...(['objective', 'activity', 'person', 'milestone', 'exitTrigger'] as const).map((entity): [string, MapChange] => {
        const id = { objective: ownObjective, activity: ownActivity, person: otherPerson, milestone: m.milestone, exitTrigger: m.trigger }[entity];
        return [`delete ${entity}`, { kind: 'delete', entity, id }];
      }),
      ['delete joint activity', { kind: 'delete', entity: 'activity', id: m.joint }],
      ['add activity for the other side', { kind: 'add', entity: 'activity', values: { title: 'x', side: other } }],
      ['add joint activity', { kind: 'add', entity: 'activity', values: { title: 'x', side: 'joint' } }],
      ['add activity owned by the other side', { kind: 'add', entity: 'activity', values: { title: 'x', side, ownerId: otherPerson } }],
      ['add activity with a milestone', { kind: 'add', entity: 'activity', values: { title: 'x', side, milestoneId: m.milestone } }],
      ['add objective for the other side', { kind: 'add', entity: 'objective', values: { side: other, statement: 'x', successMeasure: '' } }],
      ['add person', { kind: 'add', entity: 'person', values: { side, name: 'New', title: '', email: null, role: 'other' } }],
      ['add milestone', { kind: 'add', entity: 'milestone', values: { name: 'New', targetDate: null, criteria: '' } }],
      ['add exit trigger', { kind: 'add', entity: 'exitTrigger', values: { condition: 'x', status: 'ok' } }],
      ['update the other side’s activity', { kind: 'update', entity: 'activity', id: otherActivity, patch: { status: 'done' } }],
      ['update the title of their own activity', { kind: 'update', entity: 'activity', id: ownActivity, patch: { title: 'x' } }],
      ['move their own activity to the other side', { kind: 'update', entity: 'activity', id: ownActivity, patch: { side: other } }],
      ['reassign their own activity', { kind: 'update', entity: 'activity', id: ownActivity, patch: { ownerId: otherPerson } }],
      ['update the joint activity’s title', { kind: 'update', entity: 'activity', id: m.joint, patch: { title: 'x' } }],
      ['update the other side’s objective', { kind: 'update', entity: 'objective', id: otherObjective, patch: { statement: 'x' } }],
      ['move their own objective to the other side', { kind: 'update', entity: 'objective', id: ownObjective, patch: { side: other } }],
      ['update a person', { kind: 'update', entity: 'person', id: otherPerson, patch: { name: 'x' } }],
      ['update a milestone', { kind: 'update', entity: 'milestone', id: m.milestone, patch: { name: 'x' } }],
      ['update an exit trigger', { kind: 'update', entity: 'exitTrigger', id: m.trigger, patch: { status: 'triggered' } }],
    ];
  }

  for (const side of ['us', 'partner'] as const) {
    it(`refuses every change for the other side, plan info, a horizon and a delete, for a person on side ${side}`, async () => {
      const deps = await setup();
      const m = await withMap(deps);
      const { actor } = await linkActor(deps, m.mapId, side === 'us' ? m.ben : m.lena);
      const before = await stored(deps, m.mapId);
      const row = await partnerRow(deps, m.partnerId);
      deps.events.events.length = 0;
      const apply = vi.spyOn(deps.maps, 'apply');
      for (const [what, c] of refusedFor(m, side)) {
        const out = await change(deps, actor, m.mapId, c);
        expect(out, what).toMatchObject({ ok: false, error: 'forbidden' });
      }
      expect(apply).not.toHaveBeenCalled();
      expect(await stored(deps, m.mapId)).toEqual(before);
      expect(await partnerRow(deps, m.partnerId)).toEqual(row);
      expect(deps.events.events.filter((e) => e.command === 'maps.change')).toEqual([]);
    });

    it(`lets a person on side ${side} update their side’s and joint activities and objectives, and add their own`, async () => {
      const deps = await setup();
      const m = await withMap(deps);
      const { actor } = await linkActor(deps, m.mapId, side === 'us' ? m.ben : m.lena);
      const ownActivity = side === 'us' ? m.usActivity : m.partnerActivity;
      const ownObjective = side === 'us' ? m.ours : m.theirs;
      const self = side === 'us' ? m.ben : m.lena;
      for (const c of [
        { kind: 'update', entity: 'activity', id: ownActivity, patch: { status: 'done', note: 'n' } },
        { kind: 'update', entity: 'activity', id: m.joint, patch: { status: 'in_progress', dueDate: '2026-11-30' } },
        { kind: 'update', entity: 'objective', id: ownObjective, patch: { statement: 'Better', successMeasure: 'z' } },
        { kind: 'add', entity: 'activity', values: { title: 'Mine', side, ownerId: self, dueDate: '2026-12-01' } },
        { kind: 'add', entity: 'objective', values: { side, statement: 'New', successMeasure: '' } },
      ] as MapChange[]) expect((await change(deps, actor, m.mapId, c)).ok, JSON.stringify(c)).toBe(true);
      const plan = await stored(deps, m.mapId);
      const name = side === 'us' ? 'Ben Ito' : 'Lena Ortiz';
      expect(plan.activities.find((a) => a.id === ownActivity)).toMatchObject({ status: 'done', updatedBy: `${name} (by link)` });
      const events = deps.events.events.filter((e) => e.command === 'maps.change');
      expect(events).toHaveLength(5);
      expect(events[0]).toMatchObject({ actorKind: 'link', actorUserId: 'u1', entityIds: [m.mapId, ownActivity, actor.linkId] });
    });
  }

  it('refuses a link holder’s change to another MAP of the same owner, and to their own after the partner type’s exit', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    const otherType = await addPartnerType(deps, 'referral', 'Brightwave');
    const { mapId: otherMap } = value(await startMap(deps, owner, { companyId, partnerId: otherType }));
    expect(await change(deps, actor, otherMap, { kind: 'add', entity: 'objective', values: { side: 'partner', statement: 'x', successMeasure: '' } }))
      .toMatchObject({ ok: false, error: 'forbidden' });
    expect(await readMap(deps, actor, { mapId: otherMap })).toMatchObject({ ok: false, error: 'forbidden' });
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-10-20' } }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markExited', partnerId: m.partnerId, exitedDate: TODAY, reason: 'Moved on' } }));
    const before = await stored(deps, m.mapId);
    expect(await change(deps, actor, m.mapId, { kind: 'update', entity: 'activity', id: m.partnerActivity, patch: { status: 'done' } }))
      .toEqual({ ok: false, error: 'forbidden', message: COPY.MAP_READ_ONLY_AFTER_EXIT });
    expect(await stored(deps, m.mapId)).toEqual(before);
    const read = value(await readMap(deps, actor, { mapId: m.mapId }));
    expect(read.info.stage).toBe('exit');
    expect(read.fileUrl).toBe('');
    expect((await change(deps, owner, m.mapId, { kind: 'update', entity: 'activity', id: m.partnerActivity, patch: { status: 'done' } })).ok).toBe(true);
  });

  it('checks a link holder’s activity update against the row it was allowed on: a side moved since is a conflict', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    const read = deps.maps.read.bind(deps.maps);
    // The owner moves the activity to our side between the check's read and the write.
    vi.spyOn(deps.maps, 'read').mockImplementationOnce(async (ref) => {
      const out = await read(ref);
      const record = { partnerName: 'Acme', partnerType: 'reseller', stage: 'recruitment', signedDate: null, closed: null, closedReason: '' } as const;
      await deps.maps.apply(ref, { kind: 'update', entity: 'activity', id: m.partnerActivity, patch: { side: 'us' }, record }, { now: '2026-10-28T10:00:01.000Z', actor: 'Ruth' });
      return out;
    });
    expect(await change(deps, actor, m.mapId, { kind: 'update', entity: 'activity', id: m.partnerActivity, patch: { status: 'done' } }))
      .toMatchObject({ ok: false, error: 'conflict' });
    expect((await stored(deps, m.mapId)).activities.find((a) => a.id === m.partnerActivity)).toMatchObject({ side: 'us', status: 'not_started' });
  });
});

describe('Review Focus 1: a person with a link never sees or changes a review', () => {
  /** The MAP signed on 2026-08-15 with a review in prep: one number and one item. */
  async function withReviewRows(deps: TestDeps, m: WithMap) {
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-08-15' } }));
    const { review } = value(await openReview(deps, owner, { mapId: m.mapId }));
    const reviewId = review!.id;
    const number = value(await change(deps, owner, m.mapId, { kind: 'add', entity: 'reviewNumber', values: { reviewId, key: 'dealsWon', actual: 2 } })).entityId!;
    const item = value(await change(deps, owner, m.mapId, {
      kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'blocker', title: 'SECRET blocker', side: 'us' },
    })).entityId!;
    const plan = await stored(deps, m.mapId);
    expect(plan.reviews).toHaveLength(1);
    expect(plan.reviewNumbers).toHaveLength(1);
    deps.events.events.length = 0;
    return { reviewId, number, item };
  }

  it('a link holder’s readMap has no reviews, numbers or items', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    await withReviewRows(deps, m);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    const read = value(await readMap(deps, actor, { mapId: m.mapId }));
    expect(read.value).toMatchObject({ reviews: [], reviewNumbers: [], reviewItems: [] });
    expect(read.value.activities.length).toBeGreaterThan(0);
    // What a link holder's own change gives back (the page and its undo) holds none either.
    const changed = value(await change(deps, actor, m.mapId, { kind: 'update', entity: 'activity', id: m.partnerActivity, patch: { status: 'done' } }));
    expect(changed.snapshot.value).toMatchObject({ reviews: [], reviewNumbers: [], reviewItems: [] });
    // The owner still sees them.
    expect(value(await readMap(deps, owner, { mapId: m.mapId })).value.reviews).toHaveLength(1);
  });

  it('a link holder’s changeMap on a reviewItem is refused and nothing is written', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId, number, item } = await withReviewRows(deps, m);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    const before = await stored(deps, m.mapId);
    const apply = vi.spyOn(deps.maps, 'apply');
    for (const c of [
      { kind: 'update', entity: 'reviewItem', id: item, patch: { note: 'x' } },
      { kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'blocker', title: 'x', side: 'partner' } },
      { kind: 'delete', entity: 'reviewItem', id: item },
      { kind: 'update', entity: 'reviewNumber', id: number, patch: { actual: 9 } },
      { kind: 'update', entity: 'review', id: reviewId, patch: { decisions: 'x' } },
    ] as MapChange[]) {
      expect(await change(deps, actor, m.mapId, c), JSON.stringify(c)).toMatchObject({ ok: false, error: 'forbidden' });
    }
    // Deleting a review is no typed change at all, for anyone (the owner's test below).
    expect(await change(deps, actor, m.mapId, { kind: 'delete', entity: 'review', id: reviewId })).toMatchObject({ ok: false, error: 'invalid' });
    expect(apply).not.toHaveBeenCalled();
    expect(await stored(deps, m.mapId)).toEqual(before);
    expect(deps.events.events.filter((e) => e.command === 'maps.change')).toEqual([]);
  });

  it('nobody deletes a review through changeMap, the owner included: nothing is written', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId } = await withReviewRows(deps, m);
    const before = await stored(deps, m.mapId);
    const apply = vi.spyOn(deps.maps, 'apply');
    for (const actor of [owner, agent('change')]) {
      expect(await change(deps, actor, m.mapId, { kind: 'delete', entity: 'review', id: reviewId })).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(apply).not.toHaveBeenCalled();
    expect(await stored(deps, m.mapId)).toEqual(before);
  });

  it('the owner and an agent at level change edit the prep through changeMap', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { reviewId, item } = await withReviewRows(deps, m);
    value(await change(deps, owner, m.mapId, { kind: 'update', entity: 'reviewItem', id: item, patch: { note: 'Ask finance' } }));
    value(await change(deps, agent('change'), m.mapId, { kind: 'update', entity: 'review', id: reviewId, patch: { relationshipNote: 'Warm' } }));
    const plan = await stored(deps, m.mapId);
    expect(plan.reviewItems.find((i) => i.id === item)).toMatchObject({ note: 'Ask finance' });
    expect(plan.reviews[0]).toMatchObject({ relationshipNote: 'Warm', updatedBy: 'Desk Agent for Ruth' });
    expect(await change(deps, agent('read'), m.mapId, { kind: 'update', entity: 'reviewItem', id: item, patch: { note: 'x' } }))
      .toMatchObject({ ok: false, error: 'forbidden' });
  });
});

describe('a person with a link reaches nothing else', () => {
  it('is refused every other command, and nothing is written', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    const before = await stored(deps, m.mapId);
    const links = deps.mapLinks.rows.length;
    const refusals = [
      await readPartners(deps, actor, { companyId }),
      await changePartner(deps, actor, { companyId, change: { kind: 'update', entity: 'partner', id: m.partnerId, patch: { whyItFits: 'x' } } }),
      await listMaps(deps, actor, { companyId }),
      await startMap(deps, actor, { companyId, partnerId: m.partnerId }),
      await deleteMap(deps, actor, { mapId: m.mapId }),
      await shiftMapDates(deps, actor, { mapId: m.mapId }),
      await shareMap(deps, actor, { mapId: m.mapId, personId: m.lena }),
      await listCases(deps, actor, { companyId }),
      await readCompanyFacts(deps, actor, { companyId }),
    ];
    for (const r of refusals) expect(r.ok).toBe(false);
    expect(await stored(deps, m.mapId)).toEqual(before);
    expect(await deps.directory.map(m.mapId)).not.toBeNull();
    expect(deps.mapLinks.rows).toHaveLength(links);
    expect(await deps.directory.companyFacts(companyId)).toBeNull();
  });
});

describe('deleteMap', () => {
  it('trashes the file, turns the links off, ends the sessions, clears the partner type’s MAP fields and removes the row', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { token, sessionToken } = await linkActor(deps, m.mapId, m.lena);
    const entry = (await deps.directory.map(m.mapId))!;
    const before = (await partnerRow(deps, m.partnerId))!;
    expect(before.mapHealth).not.toBeNull();
    deps.events.events.length = 0;
    expect(value(await deleteMap(deps, owner, { mapId: m.mapId }))).toEqual({ mapId: m.mapId });
    expect(await deps.directory.map(m.mapId)).toBeNull();
    expect(await deps.maps.read({ fileId: entry.fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(deps.mapLinks.rows.every((l) => l.revokedAt !== null)).toBe(true);
    expect(deps.mapSessions.rows).toEqual([]);
    expect(await partnerRow(deps, m.partnerId)).toEqual({ ...before, mapHealth: null, mapNextMilestone: null });
    expect(await openMapLink(deps, token)).toEqual({ kind: 'invalid' });
    expect(await resolveMapSession(deps, sessionToken, m.mapId)).toEqual({ kind: 'none' });
    expect(deps.events.events.filter((e) => e.command === 'maps.delete')).toEqual([
      expect.objectContaining({ command: 'maps.delete', fileId: entry.fileId, entityIds: [m.mapId] }),
    ]);
    // The partner type can start a new MAP.
    expect((await startMap(deps, owner, { companyId, partnerId: m.partnerId })).ok).toBe(true);
  });

  it('is a decision: an agent is refused at every level, and another person can’t tell the MAP is there', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    for (const level of ['read', 'change', 'propose'] as const) expect(await deleteMap(deps, agent(level), { mapId: m.mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await deleteMap(deps, stranger, { mapId: m.mapId })).toMatchObject({ ok: false, message: COPY.MAP_NOT_LISTED });
    expect(await deps.directory.map(m.mapId)).not.toBeNull();
  });
});

describe('Review Focus 4: a link to a MAP that is gone opens nothing, and its session ends', () => {
  const expected = async (deps: TestDeps, partnerId: string) => {
    const p = (await partnerRow(deps, partnerId))!;
    return [partnerId, p.accountId];
  };

  it('a removed partner type, its file trashed or kept', async () => {
    for (const items of ['trash', 'keep'] as const) {
      const deps = await setup();
      const m = await withMap(deps);
      const { token, sessionToken } = await linkActor(deps, m.mapId, m.lena);
      const entry = (await deps.directory.map(m.mapId))!;
      value(await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: await expected(deps, m.partnerId), items }));
      expect(await openMapLink(deps, token)).toEqual({ kind: 'invalid' });
      expect(await resolveMapSession(deps, sessionToken, m.mapId)).toEqual({ kind: 'none' });
      expect(deps.mapSessions.rows).toEqual([]);
      expect(await deps.directory.map(m.mapId)).toBeNull();
      expect((await deps.maps.read({ fileId: entry.fileId })).ok).toBe(items === 'keep');
    }
  });

  it('a deleted owner: their directory rows and links are gone', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { token, sessionToken } = await linkActor(deps, m.mapId, m.lena);
    // What account deletion does to the tables (platform deleteAccount): the links with their sessions, then the rows.
    await deps.mapLinks.deleteForOwner('u1');
    await deps.directory.removeMaps([m.mapId]);
    expect(await openMapLink(deps, token)).toEqual({ kind: 'invalid' });
    expect(await resolveMapSession(deps, sessionToken, m.mapId)).toEqual({ kind: 'none' });
  });

  it('a partner type taken out of Partners by hand: the link holder gets the answer for a MAP that is gone, never the owner’s words', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    const book = deps.directory.books.get(companyId)!;
    await deps.partnerBooks.apply(book, { kind: 'delete', entity: 'partner', id: m.partnerId }, { now: TEST_NOW, actor: 'Hand' });
    const before = await stored(deps, m.mapId);
    const gone = { ok: false, error: 'file_not_found', message: COPY.MAP_NOT_LISTED };
    expect(await readMap(deps, actor, { mapId: m.mapId })).toEqual(gone);
    expect(await change(deps, actor, m.mapId, { kind: 'update', entity: 'activity', id: m.partnerActivity, patch: { status: 'done' } })).toEqual(gone);
    expect(await stored(deps, m.mapId)).toEqual(before);
    // The owner is told what happened.
    expect(await readMap(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, message: COPY.MAP_TYPE_GONE });
  });

  it('a MAP row gone while its links stay (a failure part way): opens nothing and ends the session', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { token, sessionToken } = await linkActor(deps, m.mapId, m.lena);
    await deps.directory.removeMaps([m.mapId]);
    expect(await openMapLink(deps, token)).toEqual({ kind: 'invalid' });
    expect(await resolveMapSession(deps, sessionToken, m.mapId)).toEqual({ kind: 'none' });
    expect(deps.mapSessions.rows).toEqual([]);
  });
});

describe('removing a partner type or the Partners file with a MAP (spec 5.6)', () => {
  const expected = async (deps: TestDeps, partnerId: string) => {
    const p = (await partnerRow(deps, partnerId))!;
    return [partnerId, p.accountId];
  };

  it('asks first, naming the MAP, and writes nothing until then', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { token } = await linkActor(deps, m.mapId, m.lena);
    const r = await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: await expected(deps, m.partnerId) });
    expect(r).toEqual({ ok: false, error: 'invalid', message: COPY.ITEMS_CHOOSE(0, 1), fieldErrors: { items: COPY.ITEMS_CHOOSE(0, 1) } });
    expect(await partnerRow(deps, m.partnerId)).toBeDefined();
    expect(await deps.directory.map(m.mapId)).not.toBeNull();
    expect((await openMapLink(deps, token)).kind).toBe('session');
    expect(await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: [m.partnerId], cases: 'trash' }))
      .toMatchObject({ ok: false, error: 'invalid' });
  });

  it('trash: the file goes to the trash, the row goes, the links are off, and an event names the MAP', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const entry = (await deps.directory.map(m.mapId))!;
    await linkActor(deps, m.mapId, m.lena);
    value(await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: await expected(deps, m.partnerId), items: 'trash' }));
    expect(await partnerRow(deps, m.partnerId)).toBeUndefined();
    expect(await deps.maps.read({ fileId: entry.fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(deps.mapLinks.rows.every((l) => l.revokedAt !== null)).toBe(true);
    expect(deps.events.events.filter((e) => e.command === 'maps.delete')).toEqual([expect.objectContaining({ fileId: entry.fileId, entityIds: [m.mapId] })]);
  });

  it('keep: the row goes and the links are off; the file stays in Drive', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const entry = (await deps.directory.map(m.mapId))!;
    value(await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: await expected(deps, m.partnerId), items: 'keep' }));
    expect(await deps.directory.map(m.mapId)).toBeNull();
    expect((await deps.maps.read({ fileId: entry.fileId })).ok).toBe(true);
  });

  it('turns the links off before the Partners write: a refused write leaves the type, the MAP row and the file', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { token } = await linkActor(deps, m.mapId, m.lena);
    const want = await expected(deps, m.partnerId);
    vi.spyOn(deps.partnerBooks, 'applyMany').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x', valid: 0 });
    expect(await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: want, items: 'trash' })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await deps.directory.map(m.mapId)).not.toBeNull();
    expect(await openMapLink(deps, token)).toEqual({ kind: 'invalid' });
    value(await removePartnerType(deps, owner, { companyId, partnerId: m.partnerId, expected: want, items: 'trash' }));
    expect(await deps.directory.map(m.mapId)).toBeNull();
  });

  it('refuses deleting a partner type with a MAP any other way than Remove', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    expect(await changePartner(deps, owner, { companyId, change: { kind: 'delete', entity: 'partner', id: m.partnerId } }))
      .toEqual({ ok: false, error: 'invalid', message: COPY.MAP_USE_REMOVE });
  });

  it('asks the same for every MAP of the company before a new Partners file', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const other = await addPartnerType(deps, 'referral', 'Brightwave');
    value(await startMap(deps, owner, { companyId, partnerId: other }));
    const { token } = await linkActor(deps, m.mapId, m.lena);
    const entry = (await deps.directory.map(m.mapId))!;
    await deps.partnerBooks.discard({ fileId: deps.directory.books.get(companyId)!.fileId });
    expect(await recreatePartnerBook(deps, owner, { companyId })).toEqual({
      ok: false, error: 'invalid', message: COPY.ITEMS_CHOOSE(0, 2), fieldErrors: { items: COPY.ITEMS_CHOOSE(0, 2) },
    });
    expect(await deps.directory.maps(companyId)).toHaveLength(2);
    expect((await recreatePartnerBook(deps, owner, { companyId, items: 'keep' })).ok).toBe(true);
    expect(await deps.directory.maps(companyId)).toEqual([]);
    expect((await deps.maps.read({ fileId: entry.fileId })).ok).toBe(true);
    expect(await openMapLink(deps, token)).toEqual({ kind: 'invalid' });
  });
});

describe('moving the MAP’s open dates at signing (spec 5.3, ruling R4)', () => {
  async function withDates(deps: TestDeps) {
    const m = await withMap(deps);
    const add = async (entity: 'activity' | 'milestone', values: Record<string, unknown>) =>
      value(await change(deps, owner, m.mapId, { kind: 'add', entity, values })).entityId!;
    const done = await add('activity', { title: 'Done', side: 'us', dueDate: '2026-11-01', status: 'done' });
    const na = await add('activity', { title: 'Not needed', side: 'us', dueDate: '2026-11-01', status: 'na' });
    const undated = await add('activity', { title: 'Undated', side: 'us' });
    const achieved = await add('milestone', { name: 'Kick-off', targetDate: '2026-11-02', criteria: '', achievedDate: '2026-11-02' });
    deps.events.events.length = 0;
    return { ...m, done, na, undated, achieved };
  }

  it('signing with the move moves open activities and milestones not achieved by the days from the planned start', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    const before = await stored(deps, m.mapId);
    const out = value(await changePartner(deps, owner, {
      companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-07' }, shiftMapDates: true,
    }));
    expect(out.mapDates).toEqual({ moved: true, days: 10 });
    const after = await stored(deps, m.mapId);
    const due = (id: string) => after.activities.find((a) => a.id === id)!.dueDate;
    expect([due(m.usActivity), due(m.partnerActivity), due(m.joint)]).toEqual(['2026-11-20', '2026-11-22', '2026-11-25']);
    expect([due(m.done), due(m.na), due(m.undated)]).toEqual(['2026-11-01', '2026-11-01', null]);
    expect(after.milestones.find((x) => x.id === m.milestone)!.targetDate).toBe('2026-12-11');
    expect(after.milestones.find((x) => x.id === m.achieved)!.targetDate).toBe('2026-11-02');
    expect(after.objectives).toEqual(before.objectives);
    expect((await deps.directory.map(m.mapId))).toMatchObject({ datesMovedFor: '2026-11-07', datesMoveFailedFor: null });
    expect((await partnerRow(deps, m.partnerId))).toMatchObject({ stage: 'onboarding', mapNextMilestone: '2026-12-11' });
    // Moved once per signing.
    expect(await shiftMapDates(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, message: COPY.MAP_DATES_MOVED_ALREADY });
  });

  it('signing without the move leaves the MAP alone', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    const before = await stored(deps, m.mapId);
    const out = value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-07' } }));
    expect(out.mapDates).toBeUndefined();
    expect(await stored(deps, m.mapId)).toEqual(before);
  });

  it('a failed move leaves the signing standing, says so, logs ids only, and can be made again from the MAP', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    const log = vi.fn();
    deps.log = log;
    vi.spyOn(deps.maps, 'applyMany').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x' });
    const out = value(await changePartner(deps, owner, {
      companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-07' }, shiftMapDates: true,
    }));
    expect(out.mapDates).toEqual({ moved: false, days: 10 });
    expect(await partnerRow(deps, m.partnerId)).toMatchObject({ stage: 'onboarding', signedDate: '2026-11-07' });
    expect(log).toHaveBeenCalledWith('map_dates_move_failed', { mapId: m.mapId, partnerId: m.partnerId, error: 'unavailable' });
    expect(await deps.directory.map(m.mapId)).toMatchObject({ datesMovedFor: null, datesMoveFailedFor: '2026-11-07' });
    expect(value(await readMap(deps, owner, { mapId: m.mapId })).datesMoveFailed).toBe(true);
    expect(value(await shiftMapDates(deps, owner, { mapId: m.mapId }))).toEqual({ days: 10 });
    expect((await stored(deps, m.mapId)).milestones.find((x) => x.id === m.milestone)!.targetDate).toBe('2026-12-11');
    expect(value(await readMap(deps, owner, { mapId: m.mapId })).datesMoveFailed).toBe(false);
  });

  it('a move that throws leaves the signing standing, is recorded as failed, and is offered again from the MAP', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    const log = vi.fn();
    deps.log = log;
    vi.spyOn(deps.maps, 'applyMany').mockRejectedValueOnce(new Error('socket hang up'));
    const out = value(await changePartner(deps, owner, {
      companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-07' }, shiftMapDates: true,
    }));
    expect(out.mapDates).toEqual({ moved: false, days: 10 });
    expect(await partnerRow(deps, m.partnerId)).toMatchObject({ stage: 'onboarding', signedDate: '2026-11-07' });
    expect(log).toHaveBeenCalledWith('map_dates_move_failed', { mapId: m.mapId, partnerId: m.partnerId, error: 'thrown' });
    expect(await deps.directory.map(m.mapId)).toMatchObject({ datesMovedFor: null, datesMoveFailedFor: '2026-11-07' });
    expect(value(await readMap(deps, owner, { mapId: m.mapId })).datesMoveFailed).toBe(true);
    expect(value(await listMaps(deps, owner, { companyId }))[0]!.datesMoveFailed).toBe(true);
    expect(value(await shiftMapDates(deps, owner, { mapId: m.mapId }))).toEqual({ days: 10 });
    expect((await stored(deps, m.mapId)).milestones.find((x) => x.id === m.milestone)!.targetDate).toBe('2026-12-11');
  });

  it('a move made whose record then fails still says moved, logs ids only, and is never offered or made again', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    const log = vi.fn();
    deps.log = log;
    vi.spyOn(deps.directory, 'setMapDatesMoved').mockRejectedValueOnce(new Error('maps_update_failed'));
    const out = value(await changePartner(deps, owner, {
      companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-07' }, shiftMapDates: true,
    }));
    expect(out.mapDates).toEqual({ moved: true, days: 10 });
    expect(log).toHaveBeenCalledWith('map_dates_move_record_failed', { mapId: m.mapId, partnerId: m.partnerId });
    expect(log).not.toHaveBeenCalledWith('map_dates_move_failed', expect.anything());
    expect((await stored(deps, m.mapId)).milestones.find((x) => x.id === m.milestone)!.targetDate).toBe('2026-12-11');
    expect(value(await readMap(deps, owner, { mapId: m.mapId })).datesMoveFailed).toBe(false);
  });

  it('never offers a move again once one is recorded as done for the signing, even after a failure was recorded for it', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-07' }, shiftMapDates: true }));
    await deps.directory.setMapDatesMoved(m.mapId, { failedFor: '2026-11-07' });
    expect(value(await readMap(deps, owner, { mapId: m.mapId })).datesMoveFailed).toBe(false);
    expect(value(await listMaps(deps, owner, { companyId }))[0]!.datesMoveFailed).toBe(false);
  });

  it('moves from the last signing’s dates after an undo and a new signing', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-07' }, shiftMapDates: true }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'undoSigned', partnerId: m.partnerId } }));
    const out = value(await changePartner(deps, owner, {
      companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-10' }, shiftMapDates: true,
    }));
    expect(out.mapDates).toEqual({ moved: true, days: 3 });
    expect((await stored(deps, m.mapId)).milestones.find((x) => x.id === m.milestone)!.targetDate).toBe('2026-12-14');
  });

  it('refuses the move before signing, by an agent, and on any change but a signing', async () => {
    const deps = await setup();
    const m = await withDates(deps);
    expect(await shiftMapDates(deps, owner, { mapId: m.mapId })).toMatchObject({ ok: false, message: COPY.MAP_DATES_NOT_SIGNED });
    for (const level of ['read', 'change', 'propose'] as const) expect(await shiftMapDates(deps, agent(level), { mapId: m.mapId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await changePartner(deps, owner, { companyId, change: { kind: 'setStep', partnerId: m.partnerId, to: 'map' }, shiftMapDates: true }))
      .toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('fillMap: the guided first MAP (spec 5.2)', () => {
  /** The guided steps' rows: people and milestones by the draft's own ids, which activities name. */
  const draft = {
    horizonDays: 60,
    objectives: [{ side: 'partner', statement: 'SECRET their goal', successMeasure: '' }],
    people: [
      { id: 'd_lena', side: 'partner', name: 'Lena Ortiz', title: 'Sales lead', email: 'lena@example.com', role: 'sales_lead' },
      { id: 'd_ben', side: 'us', name: 'Ben Ito', title: '', email: null, role: 'partner_manager' },
    ],
    milestones: [{ id: 'd_day30', name: 'Day 30: Partner enabled', targetDate: '2026-11-30', criteria: 'Sellers trained' }],
    exitTriggers: [{ condition: 'SECRET no deals', status: 'ok' }],
    activities: [
      { title: 'SECRET their task', category: 'sales', side: 'partner', ownerId: 'd_lena', dueDate: '2026-11-12', milestoneId: 'd_day30' },
      { title: 'SECRET joint task', category: 'other', side: 'joint', ownerId: null, dueDate: null, milestoneId: null },
    ],
  };

  async function started(deps: TestDeps) {
    const partnerId = await addPartnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    deps.events.events.length = 0;
    return { partnerId, mapId };
  }

  it('adds every row in two writes, with the owners and milestones the activities name, and the horizon length', async () => {
    const deps = await setup();
    const { mapId, partnerId } = await started(deps);
    const applyMany = vi.spyOn(deps.maps, 'applyMany');
    expect(await fillMap(deps, owner, { mapId, ...draft })).toEqual({ ok: true, value: { mapId } });
    expect(applyMany).toHaveBeenCalledTimes(2);
    const plan = await stored(deps, mapId);
    expect(plan.info.horizonDays).toBe(60);
    expect(plan.objectives).toMatchObject([{ side: 'partner', statement: 'SECRET their goal' }]);
    expect(plan.exitTriggers).toMatchObject([{ condition: 'SECRET no deals', status: 'ok' }]);
    const lena = plan.people.find((p) => p.name === 'Lena Ortiz')!;
    const day30 = plan.milestones.find((m) => m.name === 'Day 30: Partner enabled')!;
    expect(lena).toMatchObject({ side: 'partner', email: 'lena@example.com', role: 'sales_lead' });
    expect(plan.activities).toMatchObject([
      { title: 'SECRET their task', side: 'partner', ownerId: lena.id, milestoneId: day30.id, status: 'not_started', updatedBy: 'Ruth' },
      { title: 'SECRET joint task', side: 'joint', ownerId: null, milestoneId: null },
    ]);
    expect(plan.people.map((p) => p.id)).not.toContain('d_lena');
    // One event, with ids only; its health and next milestone went onto the partner type's row.
    expect(deps.events.events.map((e) => e.command)).toEqual(['maps.change']);
    expect(JSON.stringify(deps.events.events)).not.toMatch(/SECRET|Lena|example\.com/);
    expect(await partnerRow(deps, partnerId)).toMatchObject({ mapHealth: 'on_track', mapNextMilestone: '2026-11-30' });
  });

  it('refuses a MAP already filled in, so the guided steps never fill one twice', async () => {
    const deps = await setup();
    const { mapId } = await started(deps);
    value(await fillMap(deps, owner, { mapId, ...draft }));
    const before = await stored(deps, mapId);
    expect(await fillMap(deps, owner, { mapId, ...draft })).toMatchObject({ ok: false, error: 'invalid', message: COPY.MAP_FILLED_ALREADY });
    expect(await stored(deps, mapId)).toEqual(before);
  });

  it('checks every row before it writes: a bad one, or a name the draft doesn’t have, writes nothing', async () => {
    const deps = await setup();
    const { mapId } = await started(deps);
    const before = await stored(deps, mapId);
    const bad = { ...draft, activities: [{ ...draft.activities[0]!, title: '' }] };
    expect(await fillMap(deps, owner, { mapId, ...bad })).toMatchObject({ ok: false, error: 'invalid' });
    const unknown = { ...draft, activities: [{ ...draft.activities[0]!, ownerId: 'd_nobody' }] };
    expect(await fillMap(deps, owner, { mapId, ...unknown })).toMatchObject({ ok: false, error: 'invalid' });
    const twice = { ...draft, people: [...draft.people, { ...draft.people[0]!, id: 'd_lena2' }] };
    expect(await fillMap(deps, owner, { mapId, ...twice })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await fillMap(deps, owner, { mapId, ...draft, extra: true })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await stored(deps, mapId)).toEqual(before);
    expect(deps.events.events).toEqual([]);
  });

  it('a fill that stopped after its first write can be made again: the people and milestones it added are used', async () => {
    const deps = await setup();
    const { mapId } = await started(deps);
    const real = deps.maps.applyMany.bind(deps.maps);
    vi.spyOn(deps.maps, 'applyMany')
      .mockImplementationOnce(real)
      .mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Not now' });
    expect(await fillMap(deps, owner, { mapId, ...draft })).toMatchObject({ ok: false, error: 'unavailable' });
    expect((await stored(deps, mapId)).people).toHaveLength(2);
    value(await fillMap(deps, owner, { mapId, ...draft }));
    const plan = await stored(deps, mapId);
    expect(plan.people).toHaveLength(2);
    expect(plan.milestones).toHaveLength(1);
    expect(plan.activities[0]!.ownerId).toBe(plan.people.find((p) => p.name === 'Lena Ortiz')!.id);
  });

  it('is the owner’s or an agent’s with change or propose: a link holder, an agent that only reads and another person are refused', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    expect(await fillMap(deps, actor, { mapId: m.mapId, ...draft })).toMatchObject({ ok: false, error: 'forbidden' });
    const { mapId } = await started(deps);
    expect(await fillMap(deps, agent('read'), { mapId, ...draft })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await fillMap(deps, stranger, { mapId, ...draft })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect((await stored(deps, mapId)).people).toEqual([]);
    value(await fillMap(deps, agent('change'), { mapId, ...draft }));
    // A propose agent may do all a change agent may (agent proposals spec 5.2).
    const other = await started(deps);
    value(await fillMap(deps, agent('propose'), { mapId: other.mapId, ...draft }));
  });
});

describe('the partner row’s MAP summary after a reopen or an undone signing', () => {
  it('a reopen writes the summary again: a MAP with content is never left with no health', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'close', partnerId, as: 'not_now', reason: 'Later' } }));
    // Filled while closed: nothing to track, so the row keeps no health.
    value(await change(deps, owner, mapId, { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } }));
    expect(await partnerRow(deps, partnerId)).toMatchObject({ mapHealth: null });
    const reopened = value(await changePartner(deps, owner, { companyId, change: { kind: 'reopen', partnerId } }));
    expect(await partnerRow(deps, partnerId)).toMatchObject({ mapHealth: 'on_track' });
    // The answer carries the row as written.
    expect(reopened.snapshot.value.partners.find((p) => p.id === partnerId)).toMatchObject({ mapHealth: 'on_track' });
  });

  it('an undone signing writes the summary again: a milestone missed after signing is only planned before it', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    value(await change(deps, owner, mapId, { kind: 'add', entity: 'milestone', values: { name: 'Day 30', targetDate: '2026-01-15', criteria: '' } }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-01-01' } }));
    value(await change(deps, owner, mapId, { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Goal' } }));
    expect(await partnerRow(deps, partnerId)).toMatchObject({ mapHealth: 'at_risk' });
    value(await changePartner(deps, owner, { companyId, change: { kind: 'undoSigned', partnerId } }));
    expect(await partnerRow(deps, partnerId)).toMatchObject({ mapHealth: 'on_track' });
  });

  it('never fails the change when the MAP can’t be read, and logs ids only', async () => {
    const deps = await setup();
    const lines: unknown[] = [];
    deps.log = (event, ids) => { lines.push([event, ids]); };
    const partnerId = await addPartnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'close', partnerId, as: 'no', reason: 'Not a fit' } }));
    vi.spyOn(deps.maps, 'read').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Acme' });
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'reopen', partnerId } })).ok).toBe(true);
    expect(lines).toContainEqual(['map_summary_refresh_failed', { mapId, partnerId, error: 'unavailable' }]);
    expect(JSON.stringify(lines)).not.toMatch(/Acme/);
  });

  it('reads no MAP for a partner type without one', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    value(await changePartner(deps, owner, { companyId, change: { kind: 'close', partnerId, as: 'no', reason: 'Not a fit' } }));
    const read = vi.spyOn(deps.maps, 'read');
    value(await changePartner(deps, owner, { companyId, change: { kind: 'reopen', partnerId } }));
    expect(read).not.toHaveBeenCalled();
  });
});

describe('the MAP’s last change: one "last progress" for every reader (ruling R6)', () => {
  const at = (day: string) => `2026-${day}T09:00:00.000Z`;

  it('is the day it was started until a write, then every write by anyone: owner, link holder, guided steps, date move', async () => {
    const deps = await setup();
    const m = await withMap(deps);
    const entry = await deps.directory.map(m.mapId);
    expect(entry).toMatchObject({ lastChangeAt: TEST_NOW });
    const progress = async () => value(await readMap(deps, owner, { mapId: m.mapId })).lastProgressAt;

    deps.clock = () => at('11-02');
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    value(await change(deps, actor, m.mapId, { kind: 'update', entity: 'objective', id: m.theirs, patch: { successMeasure: 'z' } }));
    expect(await progress()).toBe(at('11-02'));
    expect(value(await listMaps(deps, owner, { companyId }))[0]!.lastProgressAt).toBe(at('11-02'));

    deps.clock = () => at('11-03');
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId: m.partnerId, signedDate: '2026-11-03' }, shiftMapDates: true }));
    expect(await progress()).toBe(at('11-03'));

    const partnerId = await addPartnerType(deps, 'technology', 'Globex');
    deps.clock = () => at('11-04');
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    expect(value(await readMap(deps, owner, { mapId })).lastProgressAt).toBe(at('11-04'));
    expect(await deps.directory.map(mapId)).toMatchObject({ lastChangeAt: null });
    deps.clock = () => at('11-05');
    value(await fillMap(deps, owner, { mapId, horizonDays: 90, objectives: [{ side: 'us', statement: 'Goal', successMeasure: '' }], people: [], milestones: [], exitTriggers: [], activities: [] }));
    expect(value(await readMap(deps, owner, { mapId })).lastProgressAt).toBe(at('11-05'));
  });

  it('a MAP stalled after a change to something other than an activity: the partner row and a reader agree', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    deps.clock = () => at('09-01');
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    value(await change(deps, owner, mapId, { kind: 'add', entity: 'activity', values: { title: 'Kickoff', side: 'joint' } }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'markSigned', partnerId, signedDate: '2026-09-01' } }));
    deps.clock = () => at('10-20');
    value(await change(deps, owner, mapId, { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Goal' } }));
    const row = await partnerRow(deps, partnerId);
    const read = value(await readMap(deps, owner, { mapId }));
    const fresh = mapSummary(read.value, read.record, read.plannedStart, '2026-10-20', read.lastProgressAt);
    expect(row).toMatchObject({ mapHealth: 'on_track' });
    expect(fresh.health).toBe(row!.mapHealth);
  });
});

describe('events and logs hold ids only', () => {
  it('never carries a name, an email or plan text', async () => {
    const deps = await setup();
    const lines: unknown[] = [];
    deps.log = (event, ids) => { lines.push([event, ids]); };
    const m = await withMap(deps);
    const { actor } = await linkActor(deps, m.mapId, m.lena);
    await change(deps, actor, m.mapId, { kind: 'update', entity: 'activity', id: m.partnerActivity, patch: { status: 'done' } });
    await change(deps, actor, m.mapId, { kind: 'update', entity: 'activity', id: m.usActivity, patch: { status: 'done' } });
    vi.spyOn(deps.partnerBooks, 'apply').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Acme' });
    await change(deps, owner, m.mapId, { kind: 'update', entity: 'milestone', id: m.milestone, patch: { targetDate: '2026-11-23' } });
    await deleteMap(deps, owner, { mapId: m.mapId });
    const text = JSON.stringify([deps.events.events, lines]);
    expect(text).not.toMatch(/SECRET|Acme|Lena|Ben Ito|example\.com/);
  });
});

describe('the package', () => {
  it('exports the MAP commands, never the helpers that run only after a command checked access', () => {
    for (const helper of [
      'revokeMapAccess', 'dropMaps', 'mapsOf', 'moveOpenDates', 'recordFor', 'recordIn', 'setSummary', 'writeSummary', 'noteMoveFailed', 'ownMap', 'mapActorOf',
    ]) {
      expect(commandsPackage).not.toHaveProperty(helper);
    }
    for (const command of ['startMap', 'deleteMap', 'shiftMapDates', 'moveDatesAfterSigning', 'ownerToday', 'plannedStart']) {
      expect(commandsPackage).toHaveProperty(command);
    }
  });
});

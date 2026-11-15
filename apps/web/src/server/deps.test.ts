import {
  readPartners, changePartner, createCase, createWebhook, createProgram, deleteCase, deleteMap, deleteProgram, listMaps, listTrash, readCase,
  accessRemoved, changeMap, openMapLink, readCompanyFacts, readProgram, renameCompany, resendWebhookDelivery, restoreFromTrash, shareCase, shareMap, startMap,
  testWebhook, type Actor,
} from '@partner-desk/commands';
import { schema, SqliteWorkFiles, TursoCompanies, TursoFileLock, TursoMapEvents, TursoMapLinks, TursoWorkspace, workspaceAccess, type Db } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import { COPY } from '@partner-desk/copy';
import {
  createMemoryCaseStore, createMemoryCompanyFactsStore, createMemoryMapStore, createMemoryMarketStore, createMemoryPartnerBookStore, createMemoryProgramStore,
  createDatabasePartnerBookStore, createReadCache, MemoryFileLock,
} from '@partner-desk/storage';
import { createSheetMetaCache, GoogleClient } from '@partner-desk/storage/google';
import { FakeGoogle, fakeClient } from '@partner-desk/storage/google/fake';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDeps, storageFor, type Wiring } from './deps';
import { copyFor } from '@partner-desk/copy';
import { untouchableWorkFiles } from './wiring-test-helpers';

/** Anna's company, as the app's `companyFor` finds it: commands refuse any other company id. */
let COMPANY: string;
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const add = { kind: 'add', entity: 'account', values: { company: 'Acme', website: 'acme.com' } } as const;

let db: Db;
let fake: FakeGoogle;
let wiring: Wiring;
let logged: Array<[string, Record<string, string>]>;

/** Hosted never reaches the database edition's files (plan 13, task 10): checked after every test of this file. */
let hostedFiles: ReturnType<typeof untouchableWorkFiles>;
beforeEach(() => { hostedFiles = untouchableWorkFiles(); });
afterEach(() => { expect(hostedFiles.touched).toEqual([]); });

beforeEach(async () => {
  db = await createTestDb();
  COMPANY = (await new TursoCompanies(db).forUser('u_anna')).companyId;
  fake = new FakeGoogle();
  logged = [];
  wiring = {
    db,
    appUrl: 'https://desk.test',
    googleClient: () => fakeClient(fake),
    cache: createReadCache({ ttlMs: 60_000, clock: Date.now }),
    metaCache: createSheetMetaCache({ ttlMs: 600_000, clock: Date.now }),
    memory: {
      partnerBooks: createMemoryPartnerBookStore(), markets: createMemoryMarketStore(),
      programs: createMemoryProgramStore(), companyFacts: createMemoryCompanyFactsStore(), cases: createMemoryCaseStore(),
      maps: createMemoryMapStore(),
    },
    log: (event, ids) => { logged.push([event, ids]); },
    // Hosted: nothing may reach the database edition's files. Any call fails the test (plan 13, task 10).
    workFiles: hostedFiles,
    localLock: new MemoryFileLock(),
    webhooks: { key: 'test-secret-at-least-32-characters-long', allowPrivate: false },
  };
});

describe('storageFor', () => {
  it('keeps a Google account’s files in Google, test users’ in memory, and never memory outside test mode', () => {
    expect(storageFor({ hasGoogleAccount: true, testMode: true, edition: 'hosted' })).toBe('google');
    expect(storageFor({ hasGoogleAccount: true, testMode: false, edition: 'hosted' })).toBe('google');
    expect(storageFor({ hasGoogleAccount: false, testMode: true, edition: 'hosted' })).toBe('memory');
    // A user without a Google row outside test mode still gets Google, whose token provider asks them to reconnect.
    expect(storageFor({ hasGoogleAccount: false, testMode: false, edition: 'hosted' })).toBe('google');
  });
});

describe('buildDeps for a Google account', () => {
  const deps = () => buildDeps(wiring, { userId: anna.userId, storage: 'google' });

  it('makes the Partners workbook in the person’s Drive folder, linking back to this app, and remembers the folder in Turso', async () => {
    const read = await readPartners(deps(), anna, { companyId: COMPANY });
    expect(read.ok).toBe(true);
    expect(JSON.stringify(fake.calls.map((call) => call.body))).toContain('https://desk.test/partners');
    const [folder] = await db.select().from(schema.storageFolders);
    expect(folder).toMatchObject({ userId: anna.userId });
  });

  it('runs a save under the Turso file lock and leaves a Turso write mark', async () => {
    const acquire = vi.spyOn(TursoFileLock.prototype, 'acquire');
    try {
      await readPartners(deps(), anna, { companyId: COMPANY });
      const [book] = await db.select().from(schema.partnerBooks);
      const changed = await changePartner(deps(), anna, { companyId: COMPANY, change: add });
      expect(changed.ok).toBe(true);
      expect(acquire).toHaveBeenCalledWith(book!.fileId);
      expect(await db.select().from(schema.fileWrites)).toEqual([expect.objectContaining({ fileId: book!.fileId })]);
      expect(await db.select().from(schema.fileLocks)).toEqual([]);
    } finally {
      acquire.mockRestore();
    }
  });

  it('serves a second read from the read cache, kept per person', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const [book] = await db.select().from(schema.partnerBooks);
    const callsBefore = fake.calls.length;
    const again = await readPartners(deps(), anna, { companyId: COMPANY });
    expect(again.ok).toBe(true);
    expect(fake.calls.length).toBe(callsBefore);
    expect(wiring.cache.get(`${anna.userId}:${book!.fileId}`)).toBeDefined();
    expect(wiring.cache.get(book!.fileId)).toBeUndefined();
  });

  it('records events in Turso with ids only', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    await changePartner(deps(), anna, { companyId: COMPANY, change: add });
    const events = await db.select().from(schema.events);
    expect(events.map((e) => e.command)).toEqual(['partners.change']);
    expect(events[0]!.id).toMatch(/^ev_[0-9a-z]{16}$/);
    expect(JSON.stringify(events)).not.toContain('Acme');
  });

  it('answers a first read with the full-Drive message when Google refuses the new file for lack of space', async () => {
    // Folders are made as usual; Drive refuses the spreadsheet itself.
    const quota = { error: { code: 403, errors: [{ domain: 'usageLimits', reason: 'storageQuotaExceeded' }] } };
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as { mimeType?: string }) : undefined;
      if (init?.method === 'POST' && body?.mimeType === 'application/vnd.google-apps.spreadsheet') {
        return new Response(JSON.stringify(quota), { status: 403, headers: { 'content-type': 'application/json' } });
      }
      return fake.fetch(input, init);
    };
    wiring.googleClient = () => new GoogleClient({ getAccessToken: async () => 'test-token', fetch, sleep: async () => {}, random: () => 0 });
    const read = await readPartners(deps(), anna, { companyId: COMPANY });
    expect(read).toEqual({ ok: false, error: 'quota', message: COPY.QUOTA_MESSAGE });
    expect(await db.select().from(schema.partnerBooks)).toEqual([]);
  });

  it('keeps Company facts and a program in the person’s Drive, with ids and a label only in Turso', async () => {
    const companies = new TursoCompanies(db);
    await companies.forUser(anna.userId);
    await companies.rename(anna.userId, 'Halden');
    await readPartners(deps(), anna, { companyId: COMPANY });
    expect((await readCompanyFacts(deps(), anna, { companyId: COMPANY })).ok).toBe(true);
    const created = await createProgram(deps(), anna, { companyId: COMPANY, partnerType: 'reseller', from: 'fresh' });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const read = await readProgram(deps(), anna, { programId: created.value.programId });
    expect(read.ok && read.value.value.name).toBe('Halden Reseller Program');
    const [program] = await db.select().from(schema.programs);
    expect(program).toMatchObject({ id: created.value.programId, displayName: 'Reseller', partnerType: 'reseller' });
    expect(await db.select().from(schema.companyFacts)).toHaveLength(1);
    expect(JSON.stringify(await db.select().from(schema.events))).not.toContain('Halden');
  });

  it('keeps a business case in the person’s Drive, with ids, its title and a token hash only in Turso', async () => {
    const companies = new TursoCompanies(db);
    await companies.forUser(anna.userId);
    await companies.rename(anna.userId, 'Halden');
    await readPartners(deps(), anna, { companyId: COMPANY });
    const account = await changePartner(deps(), anna, { companyId: COMPANY, change: add });
    if (!account.ok) throw new Error(JSON.stringify(account));
    const partner = await changePartner(deps(), anna, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'technology' } },
    });
    if (!partner.ok) throw new Error(JSON.stringify(partner));
    const created = await createCase(deps(), anna, { companyId: COMPANY, partnerId: partner.value.entityId });
    if (!created.ok) throw new Error(JSON.stringify(created));
    const { caseId } = created.value;
    const read = await readCase(deps(), anna, { caseId });
    expect(read.ok && read.value.value.partner).toBe('Acme');
    const shared = await shareCase(deps(), anna, { caseId });
    if (!shared.ok) throw new Error(JSON.stringify(shared));
    const [row] = await db.select().from(schema.businessCases);
    expect(row).toMatchObject({ id: caseId, partnerType: 'technology', ownerUserId: anna.userId });
    const [link] = await db.select().from(schema.shareLinks);
    expect(link).toMatchObject({ caseId, ownerUserId: anna.userId, revokedAt: null });
    const turso = JSON.stringify([await db.select().from(schema.businessCases), await db.select().from(schema.shareLinks), await db.select().from(schema.events)]);
    for (const content of ['Halden', 'Acme', shared.value.token]) expect(turso).not.toContain(content);
  });

  it('never touches the memory stores', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const [book] = await db.select().from(schema.partnerBooks);
    expect((await wiring.memory.partnerBooks.read({ fileId: book!.fileId })).ok).toBe(false);
  });
});

describe('buildDeps for a test user', () => {
  it('uses the process’s memory stores and never calls Google', async () => {
    const deps = buildDeps(wiring, { userId: anna.userId, storage: 'memory' });
    const read = await readPartners(deps, anna, { companyId: COMPANY });
    expect(read.ok).toBe(true);
    expect(fake.calls).toEqual([]);
    const [book] = await db.select().from(schema.partnerBooks);
    expect((await wiring.memory.partnerBooks.read({ fileId: book!.fileId })).ok).toBe(true);
  });
});

describe('storageFor on the database edition (plan 13)', () => {
  it('keeps everyone’s files in the database, test users’ and Google accounts’ alike', () => {
    for (const hasGoogleAccount of [true, false]) {
      for (const testMode of [true, false]) expect(storageFor({ hasGoogleAccount, testMode, edition: 'self-hosted' })).toBe('database');
    }
  });
});

describe('buildDeps on the database edition (plan 13)', () => {
  /** The wiring as the self-hosted runtime makes it: the work in this database's `work_files`. */
  function databaseWiring(): Wiring {
    return { ...wiring, workFiles: new SqliteWorkFiles(db), googleClient: () => { throw new Error('the database edition never asks Google'); } };
  }
  const deps = () => buildDeps(databaseWiring(), { userId: anna.userId, storage: 'database' });

  it('gives two members the same partners, and records each change under the person who made it (plan 15)', async () => {
    const ws = new TursoWorkspace(db);
    const settings = { edition: 'self-hosted' as const, adminEmail: 'anna@halden.example', testMode: false };
    const first = await workspaceAccess(ws, { id: 'u_anna', email: 'anna@halden.example' }, settings);
    await ws.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
    const second = await workspaceAccess(ws, { id: 'u_ben', email: 'ben@halden.example' }, settings);
    if (first.kind !== 'member' || second.kind !== 'member') throw new Error('both are members');
    expect(second.userId).toBe(first.userId);
    const key = first.userId;
    const annaInWs: Actor = { kind: 'owner', userId: key, displayName: 'Anna', member: first.member };
    const benInWs: Actor = { kind: 'owner', userId: key, displayName: 'Ben', member: second.member };
    const team = (await new TursoCompanies(db).forUser(key)).companyId;
    const teamDeps = () => buildDeps(databaseWiring(), { userId: key, storage: 'database' });

    // The first read makes the workspace's Partners file.
    expect((await readPartners(teamDeps(), annaInWs, { companyId: team })).ok).toBe(true);
    expect((await changePartner(teamDeps(), annaInWs, { companyId: team, change: add })).ok).toBe(true);
    const seen = await readPartners(teamDeps(), benInWs, { companyId: team });
    expect(seen.ok && seen.value.value.accounts.map((a) => a.company)).toEqual(['Acme']);
    expect((await changePartner(teamDeps(), benInWs, {
      companyId: team, change: { kind: 'add', entity: 'account', values: { company: 'Bolt' } },
    })).ok).toBe(true);

    // One company and one Partners file for the workspace; none made for either person.
    expect((await db.select().from(schema.companies)).map((c) => c.ownerUserId).sort()).toEqual([key, 'u_anna'].sort());
    expect(await db.select().from(schema.partnerBooks)).toHaveLength(1);
    const events = await db.select({ actor: schema.events.actorUserId, command: schema.events.command }).from(schema.events);
    expect(events.filter((e) => e.command === 'partners.change').map((e) => e.actor)).toEqual(['u_anna', 'u_ben']);
  });

  it('brings a deleted case, MAP and program back from the trash, with their old links still off (plan 16)', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const account = await changePartner(deps(), anna, { companyId: COMPANY, change: add });
    if (!account.ok) throw new Error(JSON.stringify(account));
    const partner = await changePartner(deps(), anna, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'technology' } },
    });
    if (!partner.ok) throw new Error(JSON.stringify(partner));
    const partnerId = partner.value.entityId!;
    const made = await createCase(deps(), anna, { companyId: COMPANY, partnerId });
    const started = await startMap(deps(), anna, { companyId: COMPANY, partnerId });
    const program = await createProgram(deps(), anna, { companyId: COMPANY, partnerType: 'reseller', from: 'fresh' });
    if (!made.ok || !started.ok || !program.ok) throw new Error(JSON.stringify([made, started, program]));
    const { caseId } = made.value;
    const oldMapId = started.value.mapId;
    expect((await shareCase(deps(), anna, { caseId })).ok).toBe(true);
    // A partner contact on the MAP with a link: the delete turns it off, and the restore must leave it off.
    const lena = await changeMap(deps(), anna, {
      mapId: oldMapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena Ortiz', title: '', email: 'lena@example.com', role: 'sales_lead' } },
    });
    if (!lena.ok) throw new Error(JSON.stringify(lena));
    const link = await shareMap(deps(), anna, { mapId: oldMapId, personId: lena.value.entityId });
    if (!link.ok) throw new Error(JSON.stringify(link));
    // A colleague with an address and no link: their reminder buttons must not work again after the restore either.
    const ben = await changeMap(deps(), anna, {
      mapId: oldMapId, change: { kind: 'add', entity: 'person', values: { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'marketing_lead' } },
    });
    if (!ben.ok) throw new Error(JSON.stringify(ben));
    expect((await deleteCase(deps(), anna, { caseId })).ok).toBe(true);
    expect((await deleteMap(deps(), anna, { mapId: oldMapId })).ok).toBe(true);
    expect((await deleteProgram(deps(), anna, { programId: program.value.programId })).ok).toBe(true);

    const listed = await listTrash(deps(), anna, {});
    if (!listed.ok) throw new Error(JSON.stringify(listed));
    expect(listed.value.map((i) => [i.kind, i.name, i.blocked])).toEqual(expect.arrayContaining([
      ['businessCase', expect.any(String), null], ['map', 'Acme as technology partner', null], ['program', 'Reseller', null],
    ]));
    for (const item of listed.value) expect((await restoreFromTrash(deps(), anna, { fileId: item.fileId })).ok).toBe(true);

    // Each is listed and reads again, under the id it had.
    expect((await readCase(deps(), anna, { caseId })).ok).toBe(true);
    expect((await readProgram(deps(), anna, { programId: program.value.programId })).ok).toBe(true);
    const maps = await listMaps(deps(), anna, { companyId: COMPANY });
    const mapIds = maps.ok ? maps.value.map((m) => m.mapId) : [];
    // The MAP is back under its own id: every link the delete turned off names it, and stays off.
    expect(mapIds).toEqual([oldMapId]);
    expect((await openMapLink(deps(), link.value.token)).kind).toBe('invalid');
    expect((await db.select().from(schema.mapLinks)).every((l) => l.revokedAt !== null)).toBe(true);
    const links = await new TursoMapLinks(db).listForMap(oldMapId);
    expect(accessRemoved(links, lena.value.entityId!)).toBe(true);
    expect(accessRemoved(links, ben.value.entityId!)).toBe(true);
    // Partner alerts go on after what was alerted before the delete.
    const [restoredMap] = await db.select().from(schema.maps);
    expect(restoredMap!.partnerAlertsThrough).toBe(await new TursoMapEvents(db).latestId(oldMapId));
    // The case's old share link stays off; nothing is left in the trash; a second restore finds nothing.
    expect((await db.select().from(schema.shareLinks)).every((l) => l.revokedAt !== null)).toBe(true);
    expect(await listTrash(deps(), anna, {})).toEqual({ ok: true, value: [] });
    expect(await restoreFromTrash(deps(), anna, { fileId: listed.value[0]!.fileId })).toMatchObject({ ok: false, error: 'not_found' });
    expect((await db.select().from(schema.events)).filter((e) => e.command === 'trash.restore')).toHaveLength(3);
  });

  it('says why a MAP can’t come back: its partner type has a MAP again', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const account = await changePartner(deps(), anna, { companyId: COMPANY, change: add });
    if (!account.ok) throw new Error(JSON.stringify(account));
    const partner = await changePartner(deps(), anna, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'reseller' } },
    });
    if (!partner.ok) throw new Error(JSON.stringify(partner));
    const partnerId = partner.value.entityId!;
    const first = await startMap(deps(), anna, { companyId: COMPANY, partnerId });
    if (!first.ok) throw new Error(JSON.stringify(first));
    expect((await deleteMap(deps(), anna, { mapId: first.value.mapId })).ok).toBe(true);
    expect((await startMap(deps(), anna, { companyId: COMPANY, partnerId })).ok).toBe(true);
    const listed = await listTrash(deps(), anna, {});
    if (!listed.ok) throw new Error(JSON.stringify(listed));
    expect(listed.value[0]).toMatchObject({ kind: 'map', blocked: COPY.MAP_ALREADY });
    expect(await restoreFromTrash(deps(), anna, { fileId: listed.value[0]!.fileId })).toMatchObject({ ok: false, message: COPY.MAP_ALREADY });
    expect(await listTrash(deps(), anna, {})).toMatchObject({ ok: true, value: [expect.objectContaining({ fileId: listed.value[0]!.fileId })] });
  });

  it('two restores of one item at once bring it back once; a viewer restores nothing (plan 16)', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const account = await changePartner(deps(), anna, { companyId: COMPANY, change: add });
    if (!account.ok) throw new Error(JSON.stringify(account));
    const partner = await changePartner(deps(), anna, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'technology' } },
    });
    if (!partner.ok) throw new Error(JSON.stringify(partner));
    const made = await createCase(deps(), anna, { companyId: COMPANY, partnerId: partner.value.entityId! });
    if (!made.ok) throw new Error(JSON.stringify(made));
    expect((await deleteCase(deps(), anna, { caseId: made.value.caseId })).ok).toBe(true);
    const listed = await listTrash(deps(), anna, {});
    const fileId = listed.ok ? listed.value[0]!.fileId : '';
    const viewer: Actor = { ...anna, member: { personId: 'u_vera', role: 'viewer' } };
    expect(await listTrash(deps(), viewer, {})).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await restoreFromTrash(deps(), viewer, { fileId })).toMatchObject({ ok: false, error: 'forbidden' });
    const both = await Promise.all([restoreFromTrash(deps(), anna, { fileId }), restoreFromTrash(deps(), anna, { fileId })]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.find((r) => !r.ok)).toMatchObject({ error: 'not_found' });
    expect((await readCase(deps(), anna, { caseId: made.value.caseId })).ok).toBe(true);
    expect(await db.select().from(schema.businessCases)).toHaveLength(1);
  });

  it('says why a case can’t come back when its partner type is gone from Partners', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const account = await changePartner(deps(), anna, { companyId: COMPANY, change: add });
    if (!account.ok) throw new Error(JSON.stringify(account));
    const partner = await changePartner(deps(), anna, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'technology' } },
    });
    if (!partner.ok) throw new Error(JSON.stringify(partner));
    const partnerId = partner.value.entityId!;
    const made = await createCase(deps(), anna, { companyId: COMPANY, partnerId });
    if (!made.ok) throw new Error(JSON.stringify(made));
    expect((await deleteCase(deps(), anna, { caseId: made.value.caseId })).ok).toBe(true);
    expect((await changePartner(deps(), anna, { companyId: COMPANY, change: { kind: 'delete', entity: 'partner', id: partnerId } })).ok).toBe(true);
    const listed = await listTrash(deps(), anna, {});
    if (!listed.ok) throw new Error(JSON.stringify(listed));
    expect(listed.value[0]).toMatchObject({ kind: 'businessCase', blocked: COPY.MAP_TYPE_GONE });
    expect(await restoreFromTrash(deps(), anna, { fileId: listed.value[0]!.fileId })).toMatchObject({ ok: false, message: COPY.MAP_TYPE_GONE });
  });

  it('a restore that failed while shutting a MAP’s people out leaves no link on, and a retry finishes it (plan 16)', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const account = await changePartner(deps(), anna, { companyId: COMPANY, change: add });
    if (!account.ok) throw new Error(JSON.stringify(account));
    const partner = await changePartner(deps(), anna, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'reseller' } },
    });
    if (!partner.ok) throw new Error(JSON.stringify(partner));
    const started = await startMap(deps(), anna, { companyId: COMPANY, partnerId: partner.value.entityId! });
    if (!started.ok) throw new Error(JSON.stringify(started));
    const { mapId } = started.value;
    expect((await changeMap(deps(), anna, {
      mapId, change: { kind: 'add', entity: 'person', values: { side: 'us', name: 'Ben Ito', title: '', email: 'ben@example.com', role: 'marketing_lead' } },
    })).ok).toBe(true);
    expect((await deleteMap(deps(), anna, { mapId })).ok).toBe(true);
    const listed = await listTrash(deps(), anna, {});
    const fileId = listed.ok ? listed.value[0]!.fileId : '';
    const failing = deps();
    failing.mapLinks = Object.assign(Object.create(Object.getPrototypeOf(failing.mapLinks)), failing.mapLinks, {
      revokeMaps: async () => { throw new Error('map_links_revoke_failed'); },
    });
    await expect(restoreFromTrash(failing, anna, { fileId })).rejects.toThrow();
    // Nothing came back, and the retry turns off the link the first try made.
    expect(await listMaps(deps(), anna, { companyId: COMPANY })).toEqual({ ok: true, value: [] });
    expect((await restoreFromTrash(deps(), anna, { fileId })).ok).toBe(true);
    expect((await db.select().from(schema.mapLinks)).every((l) => l.revokedAt !== null)).toBe(true);
    expect(await db.select().from(schema.mapLinks)).toHaveLength(1);
  });

  it('hosted has no trash to list or restore', async () => {
    const hosted = buildDeps(wiring, { userId: anna.userId, storage: 'google' });
    expect(await listTrash(hosted, anna, {})).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await restoreFromTrash(hosted, anna, { fileId: 'wf_x' })).toMatchObject({ ok: false, error: 'forbidden' });
  });

  it('makes the Partners file in this database, links it to its download, and never calls Google', async () => {
    const read = await readPartners(deps(), anna, { companyId: COMPANY });
    expect(read.ok).toBe(true);
    expect(fake.calls).toEqual([]);
    const [book] = await db.select().from(schema.partnerBooks);
    const [file] = await db.select().from(schema.workFiles);
    expect(file).toMatchObject({ id: book!.fileId, kind: 'partners', companyId: COMPANY, trashedAt: null });
    expect(deps().partnerBooks.urlFor({ fileId: book!.fileId })).toBe(`https://desk.test/files/${book!.fileId}/download`);
    expect((await wiring.memory.partnerBooks.read({ fileId: book!.fileId })).ok).toBe(false);
  });

  it('runs saves to one file one at a time: ten at once all land, none twice', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      changePartner(deps(), anna, { companyId: COMPANY, change: { kind: 'add', entity: 'account', values: { company: `Company ${i}` } } })));
    expect(results.every((r) => r.ok)).toBe(true);
    const read = await readPartners(deps(), anna, { companyId: COMPANY });
    expect(read.ok && read.value.value.accounts).toHaveLength(10);
  });

  it('always trashes, offers downloads and answers in the company server’s words; Google and memory never do (task 12’s review)', () => {
    expect(deps()).toMatchObject({ alwaysTrash: true, words: copyFor('database'), fileExports: expect.any(Object) });
    for (const storage of ['google', 'memory'] as const) {
      const other = buildDeps(wiring, { userId: anna.userId, storage });
      expect([other.alwaysTrash, other.words, other.fileExports]).toEqual([undefined, undefined, undefined]);
    }
  });

  it('serves every read from the file itself: no read cache', async () => {
    await readPartners(deps(), anna, { companyId: COMPANY });
    const [book] = await db.select().from(schema.partnerBooks);
    // Another process saved meanwhile, through its own store on the same database: the next read shows it at once.
    const elsewhere = createDatabasePartnerBookStore({ files: new SqliteWorkFiles(db), appBaseUrl: 'https://desk.test' });
    const saved = await elsewhere.apply({ fileId: book!.fileId }, { kind: 'add', entity: 'account', values: { company: 'Written elsewhere' } }, { now: '2026-11-07T12:00:00.000Z', actor: 'Anna' });
    expect(saved.ok).toBe(true);
    const read = await readPartners(deps(), anna, { companyId: COMPANY });
    expect(read.ok && read.value.value.accounts.map((a) => a.company)).toEqual(['Written elsewhere']);
  });
});

describe('buildDeps for anyone', () => {
  it('renames the person’s company in Turso', async () => {
    const companies = new TursoCompanies(db);
    await companies.forUser(anna.userId);
    const deps = buildDeps(wiring, { userId: anna.userId, storage: 'memory' });
    expect(await renameCompany(deps, anna, { name: 'Halden' })).toMatchObject({ ok: true });
    expect((await companies.forUser(anna.userId)).name).toBe('Halden');
  });

  it('a signing queues the webhook delivery in Turso and asks for it to go out after the answer', async () => {
    const sendSoon = vi.fn();
    wiring.webhooks = { ...wiring.webhooks, afterEnqueue: sendSoon };
    const deps = buildDeps(wiring, { userId: anna.userId, storage: 'memory' });
    const made = await createWebhook(deps, anna, { url: 'https://93.184.215.14/in', events: ['partner.signed'] });
    expect(made.ok).toBe(true);
    await readPartners(deps, anna, { companyId: COMPANY });
    const accountId = (await changePartner(deps, anna, { companyId: COMPANY, change: add }) as { ok: true; value: { entityId: string } }).value.entityId;
    const partner = await changePartner(deps, anna, { companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } } });
    const partnerId = (partner as { ok: true; value: { entityId: string } }).value.entityId;
    expect(sendSoon).not.toHaveBeenCalled();
    expect((await changePartner(deps, anna, { companyId: COMPANY, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-01' } })).ok).toBe(true);
    expect(sendSoon).toHaveBeenCalledWith(anna.userId);
    const rows = await db.select().from(schema.webhookDeliveries);
    expect(rows.map((r) => ({ type: r.type, data: JSON.parse(r.data) }))).toEqual([{ type: 'partner.signed', data: { accountId, partnerId } }]);
  });

  it('Send again asks for the delivery to go out after the answer, and only when it was queued', async () => {
    const sendSoon = vi.fn();
    wiring.webhooks = { ...wiring.webhooks, afterEnqueue: sendSoon };
    const deps = buildDeps(wiring, { userId: anna.userId, storage: 'memory' });
    const made = await createWebhook(deps, anna, { url: 'https://93.184.215.14/in', events: ['partner.signed'] });
    if (!made.ok) throw new Error(made.message);
    const sent = await testWebhook(deps, anna, { webhookId: made.value.webhook.id });
    if (!sent.ok) throw new Error(sent.message);
    sendSoon.mockClear();
    const input = { webhookId: made.value.webhook.id, deliveryId: sent.value.eventId };
    // Waiting for its first try: nothing to send again.
    expect(await resendWebhookDelivery(deps, anna, input)).toMatchObject({ ok: false, error: 'invalid' });
    expect(sendSoon).not.toHaveBeenCalled();
    await db.update(schema.webhookDeliveries).set({ attempts: 1, lastStatus: 500, nextTryAt: null, givenUpAt: '2026-11-01T09:00:00.000Z' });
    expect(await resendWebhookDelivery(deps, anna, input)).toEqual({ ok: true, value: { eventId: sent.value.eventId } });
    expect(sendSoon).toHaveBeenCalledWith(anna.userId);
  });

  it('a failure to schedule the sending is logged and never fails the signing', async () => {
    wiring.webhooks = { ...wiring.webhooks, afterEnqueue: () => { throw new Error('after() outside a request'); } };
    const deps = buildDeps(wiring, { userId: anna.userId, storage: 'memory' });
    expect((await createWebhook(deps, anna, { url: 'https://93.184.215.14/in', events: ['partner.signed'] })).ok).toBe(true);
    await readPartners(deps, anna, { companyId: COMPANY });
    const accountId = (await changePartner(deps, anna, { companyId: COMPANY, change: add }) as { ok: true; value: { entityId: string } }).value.entityId;
    const partner = await changePartner(deps, anna, { companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } } });
    const partnerId = (partner as { ok: true; value: { entityId: string } }).value.entityId;
    expect((await changePartner(deps, anna, { companyId: COMPANY, change: { kind: 'markSigned', partnerId, signedDate: '2026-10-01' } })).ok).toBe(true);
    expect(logged).toContainEqual(['webhook_send_soon_failed', { userId: anna.userId }]);
  });
});

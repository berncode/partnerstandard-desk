import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  changeMarket, changePartner, createCase, createMarket, createProgram, deleteCase, deleteProgram, DuplicateEntry, listCases, listMarkets,
  listPrograms, readCase, readCompanyFacts, readMarket, readPartners, recreatePartnerBook, type Actor,
  deleteMap, listMaps, openMapLink, readMap, resolveMapSession, shareMap, startMap, changeMap,
} from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { businessCases, mapLinks, maps, mapSessions, markets, programs } from './schema';
import { TursoMapLinks } from './turso-map-links';
import { TursoMapSessions } from './turso-map-sessions';
import { createTestDb } from './test-db';
import { TursoDirectory } from './turso-directory';
import { TursoEventSink } from './turso-events';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const COMPANY = 'co_aaaaaaaaaa';
const info = { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' } as const;
const market = (n: number, over: Partial<{ ownerUserId: string; companyId: string }> = {}) => ({
  marketId: `m_${n}`, companyId: COMPANY, ownerUserId: 'u1', fileId: `fm${n}`, displayName: `Market ${n}`, ...over,
});

const program = (n: number, over: Partial<{ ownerUserId: string; companyId: string; partnerType: 'reseller' | 'referral' }> = {}) => ({
  programId: `pg_${n}`, companyId: COMPANY, ownerUserId: 'u1', fileId: `fp${n}`, displayName: `Program ${n}`, partnerType: 'reseller' as const, ...over,
});

const mapRow = (n: number, over: Partial<{ ownerUserId: string; companyId: string; createdAt: string; startedOn: string; partnerId: string }> = {}) => ({
  mapId: `map_${n}`, companyId: COMPANY, ownerUserId: 'u1', fileId: `fmap${n}`, partnerId: `p_${n}`, partnerType: 'reseller' as const,
  displayName: `Acme ${n} as reseller`, createdAt: '2026-10-31T10:00:00.000Z', startedOn: '2026-10-31', ...over,
});

const businessCase = (n: number, over: Partial<{ ownerUserId: string; companyId: string; createdAt: string; partnerId: string }> = {}) => ({
  caseId: `case_${n}`, companyId: COMPANY, ownerUserId: 'u1', fileId: `fc${n}`, partnerId: 'p_1', partnerType: 'reseller' as const,
  displayName: `Case ${n}`, createdAt: '2026-10-30T10:00:00.000Z', ...over,
});

async function setup() {
  const db = await createTestDb();
  const directory = new TursoDirectory(db);
  const deps = { ...makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } }), directory, events: new TursoEventSink(db) };
  return { db, directory, deps };
}

describe('TursoDirectory', () => {
  it('finds a book and a market, and null for an unknown id', async () => {
    const { directory } = await setup();
    expect(await directory.partnerBook(COMPANY)).toBeNull();
    await directory.addPartnerBook({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'fb' });
    await directory.addMarket(market(1));
    expect(await directory.partnerBook(COMPANY)).toEqual({ fileId: 'fb', ownerUserId: 'u1' });
    expect(await directory.market('m_1')).toEqual({ fileId: 'fm1', ownerUserId: 'u1', companyId: COMPANY, displayName: 'Market 1' });
    expect(await directory.market('m_none')).toBeNull();
  });

  it('a second book for a company, or a repeated market id or file id, is a DuplicateEntry', async () => {
    const { directory } = await setup();
    await directory.addPartnerBook({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'fb' });
    await expect(directory.addPartnerBook({ companyId: COMPANY, ownerUserId: 'u2', fileId: 'fb2' })).rejects.toBeInstanceOf(DuplicateEntry);
    await expect(directory.addPartnerBook({ companyId: 'co_bbbbbbbbbb', ownerUserId: 'u2', fileId: 'fb' })).rejects.toBeInstanceOf(DuplicateEntry);
    await directory.addMarket(market(1));
    await expect(directory.addMarket({ ...market(1), fileId: 'other' })).rejects.toBeInstanceOf(DuplicateEntry);
    await expect(directory.addMarket({ ...market(2), fileId: 'fm1' })).rejects.toBeInstanceOf(DuplicateEntry);
    expect(await directory.markets(COMPANY)).toHaveLength(1);
  });

  it('other failures name the operation only', async () => {
    const { db, directory } = await setup();
    await db.run(sql`DROP TABLE markets`);
    const error = await directory.addMarket(market(1)).catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(DuplicateEntry);
    expect((error as Error).message).toBe('markets_add_failed');
  });

  it('markets lists the owner and archived flag, oldest first', async () => {
    const { db, directory } = await setup();
    await directory.addMarket(market(1));
    await directory.addMarket(market(2, { ownerUserId: 'u2' }));
    await directory.addMarket(market(3, { companyId: 'co_bbbbbbbbbb' }));
    await db.update(markets).set({ archivedAt: '2026-10-28T10:00:00.000Z' }).where(sql`id = 'm_2'`);
    expect(await directory.markets(COMPANY)).toEqual([
      { marketId: 'm_1', displayName: 'Market 1', ownerUserId: 'u1', archived: false },
      { marketId: 'm_2', displayName: 'Market 2', ownerUserId: 'u2', archived: true },
    ]);
  });

  it('setArchived sets and clears the archived time of one market', async () => {
    const { db, directory } = await setup();
    await directory.addMarket(market(1));
    await directory.addMarket(market(2));
    await directory.setArchived('m_1', '2026-10-28T10:00:00.000Z');
    expect((await directory.markets(COMPANY)).map((m) => [m.marketId, m.archived])).toEqual([['m_1', true], ['m_2', false]]);
    const [row] = await db.select({ archivedAt: markets.archivedAt }).from(markets).where(sql`id = 'm_1'`);
    expect(row).toEqual({ archivedAt: '2026-10-28T10:00:00.000Z' });
    await directory.setArchived('m_1', null);
    expect((await directory.markets(COMPANY)).map((m) => m.archived)).toEqual([false, false]);
    // An unknown market changes nothing.
    await directory.setArchived('m_none', '2026-10-28T10:00:00.000Z');
    expect((await directory.markets(COMPANY)).map((m) => m.archived)).toEqual([false, false]);
  });

  it('rename changes the listed name of one market, and an unknown id changes nothing', async () => {
    const { directory } = await setup();
    await directory.addMarket(market(1));
    await directory.addMarket(market(2));
    await directory.rename('m_1', 'Germany · Reseller');
    await directory.rename('m_none', 'Nowhere');
    expect((await directory.markets(COMPANY)).map((m) => m.displayName)).toEqual(['Germany · Reseller', 'Market 2']);
    expect(await directory.market('m_1')).toMatchObject({ displayName: 'Germany · Reseller' });
  });

  it('rename failures name the operation only', async () => {
    const { db, directory } = await setup();
    await db.run(sql`DROP TABLE markets`);
    await expect(directory.rename('m_1', 'Secret')).rejects.toThrow(/^markets_rename_failed$/);
  });

  it('a renamed market keeps its new name through changeMarket', async () => {
    const { deps } = await setup();
    await readPartners(deps, owner, { companyId: COMPANY });
    const created = await createMarket(deps, owner, { companyId: COMPANY, info });
    if (!created.ok) throw new Error('setup');
    const changed = await changeMarket(deps, owner, { marketId: created.value.marketId, change: { kind: 'updateInfo', patch: { marketName: 'Germany' } } });
    expect(changed.ok).toBe(true);
    const listed = await listMarkets(deps, owner, { companyId: COMPANY });
    expect(listed.ok && listed.value.map((m) => m.displayName)).toEqual(['Germany · Reseller']);
  });

  it('setArchived failures name the operation only', async () => {
    const { db, directory } = await setup();
    await db.run(sql`DROP TABLE markets`);
    await expect(directory.setArchived('m_1', null)).rejects.toThrow('markets_archive_failed');
  });

  it('replacePartnerBook points the company at a new file, for its owner only', async () => {
    const { directory } = await setup();
    await directory.addPartnerBook({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'old' });
    await expect(directory.replacePartnerBook({ companyId: COMPANY, ownerUserId: 'u2', oldFileId: 'old', fileId: 'new' })).rejects.toBeInstanceOf(DuplicateEntry);
    await expect(directory.replacePartnerBook({ companyId: 'co_bbbbbbbbbb', ownerUserId: 'u1', oldFileId: 'old', fileId: 'new' })).rejects.toBeInstanceOf(DuplicateEntry);
    await directory.replacePartnerBook({ companyId: COMPANY, ownerUserId: 'u1', oldFileId: 'old', fileId: 'new' });
    expect(await directory.partnerBook(COMPANY)).toEqual({ fileId: 'new', ownerUserId: 'u1' });
    // Compare and swap: the old file id is no longer current, so a second replace loses.
    await expect(directory.replacePartnerBook({ companyId: COMPANY, ownerUserId: 'u1', oldFileId: 'old', fileId: 'newer' })).rejects.toBeInstanceOf(DuplicateEntry);
    expect(await directory.partnerBook(COMPANY)).toEqual({ fileId: 'new', ownerUserId: 'u1' });
  });

  it('fileIdsForOwner lists the user’s market and book files and removes nothing', async () => {
    const { directory } = await setup();
    await directory.addPartnerBook({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'fb' });
    await directory.addMarket(market(1));
    await directory.addMarket(market(3, { ownerUserId: 'u2', companyId: 'co_bbbbbbbbbb' }));
    await directory.addProgram(program(1));
    await directory.addCompanyFacts({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'ff' });
    await directory.addBusinessCase(businessCase(1));
    await directory.addBusinessCase(businessCase(2, { ownerUserId: 'u2' }));
    await directory.addMap(mapRow(1));
    await directory.addMap(mapRow(2, { ownerUserId: 'u2' }));
    expect((await directory.fileIdsForOwner('u1')).sort()).toEqual(['fb', 'fc1', 'ff', 'fm1', 'fmap1', 'fp1']);
    expect((await directory.fileIdsForOwner('u1')).sort()).toEqual(['fb', 'fc1', 'ff', 'fm1', 'fmap1', 'fp1']);
    expect(await directory.fileIdsForOwner('nobody')).toEqual([]);
  });

  it('deleteForOwner removes the user’s rows, returns their file ids, and leaves others alone', async () => {
    const { directory } = await setup();
    await directory.addPartnerBook({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'fb' });
    await directory.addPartnerBook({ companyId: 'co_bbbbbbbbbb', ownerUserId: 'u2', fileId: 'fb2' });
    await directory.addMarket(market(1));
    await directory.addMarket(market(2));
    await directory.addMarket(market(3, { ownerUserId: 'u2', companyId: 'co_bbbbbbbbbb' }));
    await directory.addProgram(program(1));
    await directory.addProgram(program(2, { ownerUserId: 'u2', companyId: 'co_bbbbbbbbbb' }));
    await directory.addCompanyFacts({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'ff' });
    await directory.addCompanyFacts({ companyId: 'co_bbbbbbbbbb', ownerUserId: 'u2', fileId: 'ff2' });
    await directory.addBusinessCase(businessCase(1));
    await directory.addBusinessCase(businessCase(2, { ownerUserId: 'u2', companyId: 'co_bbbbbbbbbb' }));
    await directory.addMap(mapRow(1));
    await directory.addMap(mapRow(2, { ownerUserId: 'u2', companyId: 'co_bbbbbbbbbb' }));
    const { fileIds } = await directory.deleteForOwner('u1');
    expect([...fileIds].sort()).toEqual(['fb', 'fc1', 'ff', 'fm1', 'fm2', 'fmap1', 'fp1']);
    expect(await directory.map('map_1')).toBeNull();
    expect(await directory.map('map_2')).not.toBeNull();
    expect(await directory.businessCase('case_1')).toBeNull();
    expect(await directory.businessCase('case_2')).not.toBeNull();
    expect(await directory.program('pg_1')).toBeNull();
    expect(await directory.companyFacts(COMPANY)).toBeNull();
    expect(await directory.program('pg_2')).not.toBeNull();
    expect(await directory.companyFacts('co_bbbbbbbbbb')).not.toBeNull();
    expect(await directory.partnerBook(COMPANY)).toBeNull();
    expect(await directory.market('m_1')).toBeNull();
    expect(await directory.partnerBook('co_bbbbbbbbbb')).not.toBeNull();
    expect(await directory.market('m_3')).not.toBeNull();
    expect(await directory.deleteForOwner('u1')).toEqual({ fileIds: [] });
  });
  it('finds, lists, renames and removes programs; ids, a name and the partner type only', async () => {
    const { directory } = await setup();
    expect(await directory.program('pg_1')).toBeNull();
    await directory.addProgram(program(1));
    await directory.addProgram(program(2, { ownerUserId: 'u2', partnerType: 'referral' }));
    await directory.addProgram(program(3, { companyId: 'co_bbbbbbbbbb' }));
    expect(await directory.program('pg_1')).toEqual({
      fileId: 'fp1', ownerUserId: 'u1', companyId: COMPANY, displayName: 'Program 1', partnerType: 'reseller',
    });
    expect(await directory.programs(COMPANY)).toEqual([
      { programId: 'pg_1', displayName: 'Program 1', ownerUserId: 'u1', partnerType: 'reseller' },
      { programId: 'pg_2', displayName: 'Program 2', ownerUserId: 'u2', partnerType: 'referral' },
    ]);
    await directory.renameProgram('pg_1', 'Reseller · DACH');
    await directory.renameProgram('pg_none', 'Nowhere');
    expect(await directory.program('pg_1')).toMatchObject({ displayName: 'Reseller · DACH' });
    await directory.removeProgram('pg_1');
    await directory.removeProgram('pg_none');
    expect(await directory.program('pg_1')).toBeNull();
    expect((await directory.programs(COMPANY)).map((p) => p.programId)).toEqual(['pg_2']);
  });

  it('a repeated program id or file id, or a second Company facts file, is a DuplicateEntry', async () => {
    const { directory } = await setup();
    await directory.addProgram(program(1));
    await expect(directory.addProgram({ ...program(1), fileId: 'other' })).rejects.toBeInstanceOf(DuplicateEntry);
    await expect(directory.addProgram({ ...program(2), fileId: 'fp1' })).rejects.toBeInstanceOf(DuplicateEntry);
    expect(await directory.companyFacts(COMPANY)).toBeNull();
    await directory.addCompanyFacts({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'ff' });
    expect(await directory.companyFacts(COMPANY)).toEqual({ fileId: 'ff', ownerUserId: 'u1' });
    await expect(directory.addCompanyFacts({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'ff2' })).rejects.toBeInstanceOf(DuplicateEntry);
  });

  it('program and Company facts failures name the operation only', async () => {
    const { db, directory } = await setup();
    await db.run(sql`DROP TABLE programs`);
    await db.run(sql`DROP TABLE company_facts`);
    const added = await directory.addProgram(program(1)).catch((e: unknown) => e);
    expect(added).not.toBeInstanceOf(DuplicateEntry);
    expect((added as Error).message).toBe('programs_add_failed');
    await expect(directory.renameProgram('pg_1', 'Secret')).rejects.toThrow(/^programs_rename_failed$/);
    await expect(directory.removeProgram('pg_1')).rejects.toThrow(/^programs_remove_failed$/);
    await expect(directory.program('pg_1')).rejects.toThrow(/^programs_read_failed$/);
    await expect(directory.programs(COMPANY)).rejects.toThrow(/^programs_list_failed$/);
    await expect(directory.companyFacts(COMPANY)).rejects.toThrow(/^company_facts_read_failed$/);
    const facts = await directory.addCompanyFacts({ companyId: COMPANY, ownerUserId: 'u1', fileId: 'secret' }).catch((e: unknown) => e);
    expect((facts as Error).message).toBe('company_facts_add_failed');
  });

  it('finds, lists newest first, renames and removes business cases; ids, a title, the partner type and a date only', async () => {
    const { directory } = await setup();
    expect(await directory.businessCase('case_1')).toBeNull();
    await directory.addBusinessCase(businessCase(1));
    await directory.addBusinessCase(businessCase(2, { ownerUserId: 'u2', createdAt: '2026-11-01T10:00:00.000Z', partnerId: 'p_2' }));
    await directory.addBusinessCase(businessCase(3));
    await directory.addBusinessCase(businessCase(4, { companyId: 'co_bbbbbbbbbb' }));
    expect(await directory.businessCase('case_1')).toEqual({
      fileId: 'fc1', ownerUserId: 'u1', companyId: COMPANY, partnerId: 'p_1', partnerType: 'reseller', displayName: 'Case 1',
      createdAt: '2026-10-30T10:00:00.000Z',
    });
    // Newest first; two made at the same time: the one listed later first.
    expect(await directory.businessCases(COMPANY)).toEqual([
      { caseId: 'case_2', ownerUserId: 'u2', partnerId: 'p_2', partnerType: 'reseller', displayName: 'Case 2', createdAt: '2026-11-01T10:00:00.000Z' },
      { caseId: 'case_3', ownerUserId: 'u1', partnerId: 'p_1', partnerType: 'reseller', displayName: 'Case 3', createdAt: '2026-10-30T10:00:00.000Z' },
      { caseId: 'case_1', ownerUserId: 'u1', partnerId: 'p_1', partnerType: 'reseller', displayName: 'Case 1', createdAt: '2026-10-30T10:00:00.000Z' },
    ]);
    await directory.renameBusinessCase('case_1', 'Expansion');
    await directory.renameBusinessCase('case_none', 'Nowhere');
    expect(await directory.businessCase('case_1')).toMatchObject({ displayName: 'Expansion' });
    await directory.removeBusinessCases(['case_1', 'case_3', 'case_none']);
    await directory.removeBusinessCases([]);
    expect((await directory.businessCases(COMPANY)).map((c) => c.caseId)).toEqual(['case_2']);
    expect(await directory.businessCase('case_4')).not.toBeNull();
  });

  it('a repeated case id or file id is a DuplicateEntry, and case failures name the operation only', async () => {
    const { db, directory } = await setup();
    await directory.addBusinessCase(businessCase(1));
    await expect(directory.addBusinessCase({ ...businessCase(1), fileId: 'other' })).rejects.toBeInstanceOf(DuplicateEntry);
    await expect(directory.addBusinessCase({ ...businessCase(2), fileId: 'fc1' })).rejects.toBeInstanceOf(DuplicateEntry);
    await db.run(sql`DROP TABLE business_cases`);
    const added = await directory.addBusinessCase(businessCase(3)).catch((e: unknown) => e);
    expect((added as Error).message).toBe('business_cases_add_failed');
    await expect(directory.businessCase('case_1')).rejects.toThrow(/^business_cases_read_failed$/);
    await expect(directory.businessCases(COMPANY)).rejects.toThrow(/^business_cases_list_failed$/);
    await expect(directory.renameBusinessCase('case_1', 'Secret')).rejects.toThrow(/^business_cases_rename_failed$/);
    await expect(directory.removeBusinessCases(['case_1'])).rejects.toThrow(/^business_cases_remove_failed$/);
  });
});

describe('TursoDirectory: MAPs', () => {
  it('finds, lists oldest first, renames and removes MAPs; ids, a name, the partner type and dates only', async () => {
    const { directory } = await setup();
    expect(await directory.map('map_1')).toBeNull();
    expect(await directory.mapFor(COMPANY, 'p_1')).toBeNull();
    await directory.addMap(mapRow(2, { createdAt: '2026-10-31T11:00:00.000Z' }));
    await directory.addMap(mapRow(1));
    await directory.addMap(mapRow(3, { companyId: 'co_bbbbbbbbbb' }));
    const one = {
      fileId: 'fmap1', ownerUserId: 'u1', companyId: COMPANY, partnerId: 'p_1', partnerType: 'reseller', displayName: 'Acme 1 as reseller',
      createdAt: '2026-10-31T10:00:00.000Z', startedOn: '2026-10-31', datesMovedFor: null, datesMoveFailedFor: null, lastChangeAt: null,
    };
    expect(await directory.map('map_1')).toEqual(one);
    expect(await directory.mapFor(COMPANY, 'p_1')).toEqual({ ...one, mapId: 'map_1' });
    expect(await directory.mapFor('co_bbbbbbbbbb', 'p_1')).toBeNull();
    expect((await directory.maps(COMPANY)).map((m) => m.mapId)).toEqual(['map_1', 'map_2']);
    expect((await directory.maps(COMPANY))[0]).toEqual({
      mapId: 'map_1', ownerUserId: 'u1', partnerId: 'p_1', partnerType: 'reseller', displayName: 'Acme 1 as reseller',
      createdAt: '2026-10-31T10:00:00.000Z', startedOn: '2026-10-31', datesMovedFor: null, datesMoveFailedFor: null, lastChangeAt: null,
    });
    await directory.renameMap('map_1', 'Acme Group as reseller');
    await directory.renameMap('map_none', 'Nowhere');
    expect(await directory.map('map_1')).toMatchObject({ displayName: 'Acme Group as reseller' });
    await directory.removeMaps(['map_1', 'map_none']);
    await directory.removeMaps([]);
    expect(await directory.map('map_1')).toBeNull();
    expect((await directory.maps(COMPANY)).map((m) => m.mapId)).toEqual(['map_2']);
  });

  it('keeps a MAP’s start date, and reads a row without one as null', async () => {
    const { db, directory } = await setup();
    // Made at 00:30 in Berlin: the day it starts on is Berlin's, not the UTC date of its created time.
    await directory.addMap(mapRow(1, { createdAt: '2026-11-03T23:30:00.000Z', startedOn: '2026-11-04' }));
    // A MAP made before its start date was kept, as migration 0012 leaves it.
    await db.insert(maps).values({
      id: 'map_2', companyId: COMPANY, ownerUserId: 'u1', fileId: 'fmap2', partnerId: 'p_2', partnerType: 'reseller', displayName: 'Acme 2 as reseller',
      createdAt: '2026-11-03T23:30:00.000Z',
    });
    expect(await directory.map('map_1')).toMatchObject({ createdAt: '2026-11-03T23:30:00.000Z', startedOn: '2026-11-04' });
    expect(await directory.map('map_2')).toMatchObject({ createdAt: '2026-11-03T23:30:00.000Z', startedOn: null });
    expect(await directory.mapFor(COMPANY, 'p_1')).toMatchObject({ startedOn: '2026-11-04' });
    expect(await directory.mapFor(COMPANY, 'p_2')).toMatchObject({ startedOn: null });
    expect((await directory.maps(COMPANY)).map((m) => [m.mapId, m.startedOn])).toEqual([['map_1', '2026-11-04'], ['map_2', null]]);
    expect((await directory.jobMaps()).map((m) => [m.mapId, m.startedOn])).toEqual([['map_1', '2026-11-04'], ['map_2', null]]);
  });

  it('keeps one MAP per partner type: a repeated MAP id, file id or partner type is a DuplicateEntry', async () => {
    const { directory } = await setup();
    await directory.addMap(mapRow(1));
    await expect(directory.addMap({ ...mapRow(1), fileId: 'other', partnerId: 'p_9' })).rejects.toBeInstanceOf(DuplicateEntry);
    await expect(directory.addMap({ ...mapRow(2), fileId: 'fmap1' })).rejects.toBeInstanceOf(DuplicateEntry);
    await expect(directory.addMap({ ...mapRow(2), partnerId: 'p_1' })).rejects.toBeInstanceOf(DuplicateEntry);
    expect(await directory.maps(COMPANY)).toHaveLength(1);
  });

  it('scopes one MAP per partner type to its company: another company may have a partner type with the same id', async () => {
    const { directory } = await setup();
    const OTHER = 'co_bbbbbbbbbb';
    await directory.addMap(mapRow(1));
    await directory.addMap(mapRow(2, { companyId: OTHER, ownerUserId: 'u2', partnerId: 'p_1' }));
    expect(await directory.mapFor(COMPANY, 'p_1')).toMatchObject({ mapId: 'map_1', companyId: COMPANY, ownerUserId: 'u1' });
    expect(await directory.mapFor(OTHER, 'p_1')).toMatchObject({ mapId: 'map_2', companyId: OTHER, ownerUserId: 'u2' });
    await expect(directory.addMap({ ...mapRow(3, { companyId: OTHER, ownerUserId: 'u2' }), partnerId: 'p_1' })).rejects.toBeInstanceOf(DuplicateEntry);
  });

  it('records a move of the open dates, done or failed, and keeps the email state', async () => {
    const { directory } = await setup();
    await directory.addMap(mapRow(1));
    await directory.setMapDatesMoved('map_1', { failedFor: '2026-11-07' });
    expect(await directory.map('map_1')).toMatchObject({ datesMovedFor: null, datesMoveFailedFor: '2026-11-07' });
    await directory.setMapDatesMoved('map_1', { movedFor: '2026-11-07', failedFor: null });
    expect(await directory.map('map_1')).toMatchObject({ datesMovedFor: '2026-11-07', datesMoveFailedFor: null });
    // The last change through PartnerStandard Desk (ruling R6): a time only; an unknown id changes nothing.
    await directory.setMapLastChange('map_1', '2026-11-08T09:00:00.000Z');
    await directory.setMapLastChange('map_none', '2026-11-08T09:00:00.000Z');
    expect(await directory.map('map_1')).toMatchObject({ lastChangeAt: '2026-11-08T09:00:00.000Z' });
    expect((await directory.maps(COMPANY))[0]).toMatchObject({ lastChangeAt: '2026-11-08T09:00:00.000Z' });
    expect(await directory.mapNotifyState('map_1')).toEqual({
      settings: {}, momentumState: null, pausedReason: null, digestHealth: null, webhookHealth: null, partnerAlertsThrough: null,
    });
    await directory.setMapNotifyState('map_1', { settings: { dueSoonDays: 5, partnerAlerts: 'daily' }, momentumState: 'at_risk' });
    await directory.setMapNotifyState('map_1', { pausedReason: 'auth', digestHealth: 'off_track', partnerAlertsThrough: 7 });
    // The webhooks' health has its own setter, a code only; an unknown id changes nothing.
    await directory.setMapWebhookHealth('map_1', 'at_risk');
    await directory.setMapWebhookHealth('map_none', 'at_risk');
    expect(await directory.mapNotifyState('map_1')).toEqual({
      settings: { dueSoonDays: 5, partnerAlerts: 'daily' }, momentumState: 'at_risk', pausedReason: 'auth', digestHealth: 'off_track',
      webhookHealth: 'at_risk', partnerAlertsThrough: 7,
    });
    expect((await directory.jobMaps())[0]!.notify.webhookHealth).toBe('at_risk');
    await directory.setMapWebhookHealth('map_1', null);
    expect((await directory.mapNotifyState('map_1'))!.webhookHealth).toBeNull();
    expect(await directory.mapNotifyState('map_none')).toBeNull();
  });

  it('forgets the webhooks’ health of one person’s MAPs only, and nothing else of their email state', async () => {
    const { directory } = await setup();
    await directory.addMap(mapRow(1));
    await directory.addMap(mapRow(2));
    await directory.addMap(mapRow(3, { ownerUserId: 'u2' }));
    for (const mapId of ['map_1', 'map_2', 'map_3']) await directory.setMapWebhookHealth(mapId, 'at_risk');
    await directory.setMapNotifyState('map_1', { digestHealth: 'off_track' });
    await directory.forgetWebhookHealth('u1');
    expect(await directory.mapNotifyState('map_1')).toMatchObject({ webhookHealth: null, digestHealth: 'off_track' });
    expect((await directory.mapNotifyState('map_2'))!.webhookHealth).toBeNull();
    expect((await directory.mapNotifyState('map_3'))!.webhookHealth).toBe('at_risk');
    await directory.forgetWebhookHealth('u_nobody');
    expect((await directory.mapNotifyState('map_3'))!.webhookHealth).toBe('at_risk');
  });

  it('reads settings that can’t be read as none, and MAP failures name the operation only', async () => {
    const { db, directory } = await setup();
    await directory.addMap(mapRow(1));
    await db.run(sql`UPDATE maps SET notify_settings = 'not json', momentum_state = 'great', digest_health = 'fine', webhook_health = 'meh'`);
    expect(await directory.mapNotifyState('map_1')).toEqual({
      settings: {}, momentumState: null, pausedReason: null, digestHealth: null, webhookHealth: null, partnerAlertsThrough: null,
    });
    await db.run(sql`DROP TABLE maps`);
    const errors = await Promise.all([
      directory.map('map_1'), directory.mapFor(COMPANY, 'p_1'), directory.maps(COMPANY), directory.addMap(mapRow(9)), directory.renameMap('map_1', 'Acme'),
      directory.removeMaps(['map_1']), directory.setMapDatesMoved('map_1', { failedFor: null }), directory.mapNotifyState('map_1'),
      directory.setMapNotifyState('map_1', { pausedReason: null }), directory.jobMaps(), directory.pauseMap('map_1'), directory.resumeMaps(['map_1']),
      directory.setMapWebhookHealth('map_1', 'on_track'), directory.forgetWebhookHealth('u1'),
    ].map((p) => p.then(() => null, (e: unknown) => (e as Error).message)));
    expect(errors).toEqual([
      'maps_read_failed', 'maps_read_failed', 'maps_list_failed', 'maps_add_failed', 'maps_rename_failed', 'maps_remove_failed',
      'maps_update_failed', 'maps_read_failed', 'maps_update_failed', 'maps_list_failed', 'maps_update_failed', 'maps_update_failed',
      'maps_update_failed', 'maps_update_failed',
    ]);
  });

  it('lists every MAP for the scheduled job, oldest first, and pauses and resumes a MAP’s emails once', async () => {
    const { directory } = await setup();
    await directory.addMap(mapRow(2, { createdAt: '2026-10-31T12:00:00.000Z', ownerUserId: 'u2', companyId: 'co_bbbbbbbbbb' }));
    await directory.addMap(mapRow(1));
    await directory.setMapNotifyState('map_1', { settings: { partnerDigest: true } });
    expect((await directory.jobMaps()).map((m) => [m.mapId, m.ownerUserId, m.notify.settings])).toEqual([
      ['map_1', 'u1', { partnerDigest: true }], ['map_2', 'u2', {}],
    ]);
    expect((await directory.jobMaps())[0]).toMatchObject({ fileId: 'fmap1', partnerId: 'p_1', createdAt: '2026-10-31T10:00:00.000Z', lastChangeAt: null });
    expect(await directory.pauseMap('map_1')).toBe(true);
    expect(await directory.pauseMap('map_1')).toBe(false);
    expect(await directory.pauseMap('map_none')).toBe(false);
    expect((await directory.mapNotifyState('map_1'))!.pausedReason).toBe('auth');
    expect(await directory.resumeMaps(['map_1', 'map_2'])).toEqual(['map_1']);
    expect(await directory.resumeMaps([])).toEqual([]);
    expect((await directory.mapNotifyState('map_1'))!.pausedReason).toBeNull();
  });
});

describe('the commands on the Turso directory', () => {
  it('two first reads make one book', async () => {
    const { db, deps } = await setup();
    const discarded: string[] = [];
    const real = deps.partnerBooks;
    let created = 0;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      create: async (...args) => {
        const out = await real.create(...args);
        created++;
        while (created < 2) await new Promise((r) => setTimeout(r, 1));
        return out;
      },
      discard: async (ref) => { discarded.push(ref.fileId); return real.discard(ref); },
    };
    const [a, b] = await Promise.all([readPartners(deps, owner, { companyId: COMPANY }), readPartners(deps, owner, { companyId: COMPANY })]);
    expect(a.ok && b.ok).toBe(true);
    expect(a).toEqual(b);
    expect(created).toBe(2);
    expect(discarded).toHaveLength(1);
    const rows = await db.all<{ file_id: string }>(sql`SELECT file_id FROM partner_books`);
    expect(rows).toHaveLength(1);
    expect(discarded).not.toContain(rows[0]!.file_id);
  });

  it('a stranger is refused the company and gets file_not_found for a market', async () => {
    const { deps } = await setup();
    await readPartners(deps, owner, { companyId: COMPANY });
    const made = await createMarket(deps, owner, { companyId: COMPANY, info });
    if (!made.ok) throw new Error('setup');
    expect(await readPartners(deps, stranger, { companyId: COMPANY })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await readMarket(deps, stranger, { marketId: made.value.marketId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await listMarkets(deps, stranger, { companyId: COMPANY })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await listMarkets(deps, stranger, { companyId: 'co_bbbbbbbbbb' })).toEqual({ ok: true, value: [] });
  });

  it('two recreates at once make one new book', async () => {
    const { db, deps, directory } = await setup();
    await readPartners(deps, owner, { companyId: COMPANY });
    const old = (await directory.partnerBook(COMPANY))!.fileId;
    await deps.partnerBooks.discard({ fileId: old });
    const real = deps.partnerBooks;
    const discarded: string[] = [];
    let created = 0;
    deps.partnerBooks = {
      ...real,
      read: real.read.bind(real),
      create: async (...args) => {
        const out = await real.create(...args);
        created++;
        while (created < 2) await new Promise((r) => setTimeout(r, 1));
        return out;
      },
      discard: async (ref) => { discarded.push(ref.fileId); return real.discard(ref); },
    };
    const [a, b] = await Promise.all([
      recreatePartnerBook(deps, owner, { companyId: COMPANY }),
      recreatePartnerBook(deps, owner, { companyId: COMPANY }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(a).toEqual(b);
    const rows = await db.all<{ file_id: string }>(sql`SELECT file_id FROM partner_books`);
    expect(rows).toHaveLength(1);
    expect(discarded).toHaveLength(1);
    expect(discarded).not.toContain(rows[0]!.file_id);
  });

  it('lists markets and recreates a lost book', async () => {
    const { deps, directory } = await setup();
    await readPartners(deps, owner, { companyId: COMPANY });
    const made = await createMarket(deps, owner, { companyId: COMPANY, info });
    if (!made.ok) throw new Error('setup');
    const list = await listMarkets(deps, owner, { companyId: COMPANY });
    expect(list).toEqual({ ok: true, value: [{ marketId: made.value.marketId, displayName: 'Austria · Reseller', ownerUserId: 'u1', archived: false }] });
    const old = (await directory.partnerBook(COMPANY))!.fileId;
    await deps.partnerBooks.discard({ fileId: old });
    expect((await recreatePartnerBook(deps, owner, { companyId: COMPANY })).ok).toBe(true);
    expect((await directory.partnerBook(COMPANY))!.fileId).not.toBe(old);
    expect((await readPartners(deps, owner, { companyId: COMPANY })).ok).toBe(true);
  });

  it('makes Company facts once, and creates, lists and deletes a program', async () => {
    const { db, deps } = await setup();
    await readPartners(deps, owner, { companyId: COMPANY });
    expect((await readCompanyFacts(deps, owner, { companyId: COMPANY })).ok).toBe(true);
    expect((await readCompanyFacts(deps, owner, { companyId: COMPANY })).ok).toBe(true);
    expect(await db.all(sql`SELECT company_id FROM company_facts`)).toHaveLength(1);
    const created = await createProgram(deps, owner, { companyId: COMPANY, partnerType: 'reseller', from: 'fresh' });
    if (!created.ok) throw new Error('setup');
    const { programId } = created.value;
    expect(await listPrograms(deps, owner, { companyId: COMPANY })).toEqual({ ok: true, value: [{ programId, label: 'Reseller', partnerType: 'reseller' }] });
    expect(await deleteProgram(deps, owner, { programId })).toEqual({ ok: true, value: { programId } });
    expect(await db.select().from(programs)).toEqual([]);
  });

  it('creates, lists, reads and deletes a business case', async () => {
    const { db, deps } = await setup();
    await readPartners(deps, owner, { companyId: COMPANY });
    const account = await changePartner(deps, owner, { companyId: COMPANY, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } });
    if (!account.ok) throw new Error('setup');
    const partner = await changePartner(deps, owner, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'technology' } },
    });
    if (!partner.ok) throw new Error('setup');
    const partnerId = partner.value.entityId!;
    const created = await createCase(deps, owner, { companyId: COMPANY, partnerId });
    if (!created.ok) throw new Error(created.message);
    const { caseId } = created.value;
    const listed = await listCases(deps, owner, { companyId: COMPANY });
    expect(listed).toMatchObject({ ok: true, value: [{ caseId, partnerId, partnerType: 'technology' }] });
    expect(await readCase(deps, stranger, { caseId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect((await readCase(deps, owner, { caseId })).ok).toBe(true);
    expect(await deleteCase(deps, owner, { caseId })).toEqual({ ok: true, value: { caseId } });
    expect(await db.select().from(businessCases)).toEqual([]);
  });

  it('starts, lists, reads, shares and deletes a MAP, and its link opens nothing after', async () => {
    const { db, deps: base } = await setup();
    const deps = { ...base, mapLinks: new TursoMapLinks(db), mapSessions: new TursoMapSessions(db) };
    await readPartners(deps, owner, { companyId: COMPANY });
    const account = await changePartner(deps, owner, { companyId: COMPANY, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } });
    if (!account.ok) throw new Error('setup');
    const partner = await changePartner(deps, owner, {
      companyId: COMPANY, change: { kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'reseller' } },
    });
    if (!partner.ok) throw new Error('setup');
    const partnerId = partner.value.entityId!;
    const started = await startMap(deps, owner, { companyId: COMPANY, partnerId });
    if (!started.ok) throw new Error(started.message);
    const { mapId } = started.value;
    expect(await startMap(deps, owner, { companyId: COMPANY, partnerId })).toMatchObject({ ok: false, fieldErrors: { partnerId: expect.any(String) } });
    expect(await listMaps(deps, owner, { companyId: COMPANY })).toMatchObject({ ok: true, value: [{ mapId, partnerId, displayName: 'Acme as reseller' }] });
    expect(await readMap(deps, stranger, { mapId })).toMatchObject({ ok: false, error: 'file_not_found' });
    const person = await changeMap(deps, owner, {
      mapId, change: { kind: 'add', entity: 'person', values: { side: 'partner', name: 'Lena', title: '', email: 'lena@example.com', role: 'other' } },
    });
    if (!person.ok) throw new Error('setup');
    const shared = await shareMap(deps, owner, { mapId, personId: person.value.entityId });
    if (!shared.ok) throw new Error('setup');
    const opened = await openMapLink(deps, shared.value.token);
    if (opened.kind !== 'session') throw new Error('setup');
    expect((await resolveMapSession(deps, opened.sessionToken, mapId)).kind).toBe('active');
    expect(await deleteMap(deps, owner, { mapId })).toEqual({ ok: true, value: { mapId } });
    expect(await db.select().from(maps)).toEqual([]);
    expect(await db.select().from(mapSessions)).toEqual([]);
    expect((await db.select().from(mapLinks)).every((l) => l.revokedAt !== null)).toBe(true);
    expect(await openMapLink(deps, shared.value.token)).toEqual({ kind: 'invalid' });
  });
});

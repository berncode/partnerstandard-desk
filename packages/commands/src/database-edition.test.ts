// Plan 13, task 9: the commands on the database edition's stores. Deleting a case, a MAP or a program, and replacing an
// old Partners file, put the file in the trash: its row and its content stay, and every screen reads it as gone.
import { describe, expect, it } from 'vitest';
import {
  createDatabaseCaseStore, createDatabaseCompanyFactsStore, createDatabaseMapStore, createDatabaseMarketStore, createDatabasePartnerBookStore,
  createDatabaseProgramStore, MemoryFileLock, MemoryWorkFiles, serializeApplies,
} from '@partner-desk/storage';
import { PARTNERS_LAYOUT, workbookRawAccess, workFilesTarget } from '@partner-desk/storage/test-support';
import type { Actor } from './actor';
import { createCase, deleteCase } from './cases';
import { changeMap, deleteMap, startMap } from './maps';
import { changePartner, readPartners, recreatePartnerBook, removePartnerType } from './partners';
import { createProgram, deleteProgram, readCompanyFacts } from './programs';
import { deleteSectionChanges } from '@partner-desk/core';
import { copyFor } from '@partner-desk/copy';
import { readCase } from './cases';
import { readMap } from './maps';
import { makeTestDeps } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const companyId = 'co_aaaaaaaaaa';

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

/** The commands' test deps, with every file store on the database edition over one port, each save one at a time. */
async function setup() {
  const files = new MemoryWorkFiles();
  const lock = new MemoryFileLock();
  const options = { files, appBaseUrl: 'https://desk.test' };
  const deps = {
    ...makeTestDeps({ companies: { u1: companyId } }),
    alwaysTrash: true,
    words: copyFor('database'),
    partnerBooks: serializeApplies(createDatabasePartnerBookStore(options), lock),
    markets: serializeApplies(createDatabaseMarketStore(options), lock),
    programs: serializeApplies(createDatabaseProgramStore(options), lock),
    companyFacts: serializeApplies(createDatabaseCompanyFactsStore(options), lock),
    cases: serializeApplies(createDatabaseCaseStore(options), lock),
    maps: serializeApplies(createDatabaseMapStore(options), lock),
  };
  await deps.companies.rename('u1', 'Halden');
  await readPartners(deps, owner, { companyId });
  await readCompanyFacts(deps, owner, { companyId });
  return { deps, files };
}

async function partnerType(deps: Awaited<ReturnType<typeof setup>>['deps']) {
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Acme' } } }));
  return value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller', whyItFits: 'Fits' } },
  })).entityId!;
}

/** The rows the screen saw for a partner type, as the remove dialog sends them. */
async function expectedRows(deps: Awaited<ReturnType<typeof setup>>['deps'], partnerId: string) {
  const read = await readPartners(deps, owner, { companyId });
  if (!read.ok) throw new Error('read');
  return deleteSectionChanges(read.value.value, partnerId).flatMap((c) => ('id' in c && typeof c.id === 'string' ? [c.id] : []));
}

/** The row is still there, trashed, with its body: nothing is deleted for good. */
async function expectTrashed(files: MemoryWorkFiles, fileId: string, body: string) {
  expect(await files.read(fileId)).toMatchObject({ trashedAt: expect.any(String), body });
}

describe('the commands on the database edition', () => {
  it('a deleted case goes to the trash with its content, and reads as gone', async () => {
    const { deps, files } = await setup();
    const programId = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'fresh' })).programId;
    const partnerId = await partnerType(deps);
    value(await changePartner(deps, owner, { companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch: { programId } } }));
    const { caseId } = value(await createCase(deps, owner, { companyId, partnerId }));
    const { fileId } = (await deps.directory.businessCase(caseId))!;
    const body = (await files.read(fileId))!.body;
    expect(value(await deleteCase(deps, owner, { caseId }))).toEqual({ caseId });
    await expectTrashed(files, fileId, body);
    expect(await deps.cases.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('a deleted MAP goes to the trash with its content, and reads as gone', async () => {
    const { deps, files } = await setup();
    const partnerId = await partnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    value(await changeMap(deps, owner, { mapId, change: { kind: 'add', entity: 'milestone', values: { name: 'First deal', targetDate: '2026-12-01', criteria: '' } } }));
    const { fileId } = (await deps.directory.map(mapId))!;
    const body = (await files.read(fileId))!.body;
    expect(body).toContain('First deal');
    expect(value(await deleteMap(deps, owner, { mapId }))).toEqual({ mapId });
    await expectTrashed(files, fileId, body);
    expect(await deps.maps.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('a case or MAP no longer listed says so in the company server’s words, never Google Drive’s', async () => {
    const { deps } = await setup();
    const caseAnswer = await readCase(deps, owner, { caseId: 'bc_aaaaaaaaaa' });
    const mapAnswer = await readMap(deps, owner, { mapId: 'map_aaaaaaaaaa' });
    expect(caseAnswer).toMatchObject({ ok: false, error: 'file_not_found', message: copyFor('database').CASE_NOT_LISTED });
    expect(mapAnswer).toMatchObject({ ok: false, error: 'file_not_found', message: copyFor('database').MAP_NOT_LISTED });
    expect(JSON.stringify([caseAnswer, mapAnswer])).not.toMatch(/Google|Drive/);
  });

  it('a deleted program goes to the trash with its content, and reads as gone', async () => {
    const { deps, files } = await setup();
    const { programId } = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'fresh' }));
    const { fileId } = (await deps.directory.program(programId))!;
    const body = (await files.read(fileId))!.body;
    expect(value(await deleteProgram(deps, owner, { programId }))).toEqual({ programId });
    await expectTrashed(files, fileId, body);
    expect(await deps.programs.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('a Partners file of an earlier version is replaced: the old one goes to the trash with its content', async () => {
    const { deps, files } = await setup();
    await partnerType(deps);
    const old = (await deps.directory.partnerBook(companyId))!;
    await workbookRawAccess(workFilesTarget(files), PARTNERS_LAYOUT).setSchemaVersion(old.fileId, 1);
    const body = (await files.read(old.fileId))!.body;
    expect(await readPartners(deps, owner, { companyId })).toMatchObject({ ok: false, error: 'old_version' });
    const made = value(await recreatePartnerBook(deps, owner, { companyId }));
    expect(made.value.accounts).toEqual([]);
    await expectTrashed(files, old.fileId, body);
    expect(await deps.partnerBooks.read({ fileId: old.fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    const now = (await deps.directory.partnerBook(companyId))!;
    expect(now.fileId).not.toBe(old.fileId);
    expect((await files.read(now.fileId))!.trashedAt).toBeNull();
  });

  it('removing a partner type with a case still asks first, and the answer puts the case’s file in the trash', async () => {
    const { deps, files } = await setup();
    const programId = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'fresh' })).programId;
    const partnerId = await partnerType(deps);
    value(await changePartner(deps, owner, { companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch: { programId } } }));
    const { caseId } = value(await createCase(deps, owner, { companyId, partnerId }));
    const { fileId } = (await deps.directory.businessCase(caseId))!;
    const body = (await files.read(fileId))!.body;
    const expected = await expectedRows(deps, partnerId);
    // Nothing goes without a person's answer (task 12's review): the command asks, and nothing is written.
    expect(await removePartnerType(deps, owner, { companyId, partnerId, expected }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { items: expect.any(String) } });
    expect((await files.read(fileId))!.trashedAt).toBeNull();
    expect(await removePartnerType(deps, owner, { companyId, partnerId, expected, items: 'trash' })).toMatchObject({ ok: true });
    await expectTrashed(files, fileId, body);
  });

  it('starting a new Partners file with a MAP still asks first, and even a keep puts the MAP in the trash', async () => {
    const { deps, files } = await setup();
    const partnerId = await partnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    const { fileId } = (await deps.directory.map(mapId))!;
    const body = (await files.read(fileId))!.body;
    const old = (await deps.directory.partnerBook(companyId))!;
    await workbookRawAccess(workFilesTarget(files), PARTNERS_LAYOUT).setSchemaVersion(old.fileId, 1);
    expect(await recreatePartnerBook(deps, owner, { companyId }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { items: expect.any(String) } });
    expect((await files.read(fileId))!.trashedAt).toBeNull();
    expect((await deps.directory.partnerBook(companyId))!.fileId).toBe(old.fileId);
    expect(await recreatePartnerBook(deps, owner, { companyId, items: 'keep' })).toMatchObject({ ok: true });
    await expectTrashed(files, fileId, body);
  });

  it('even an explicit keep goes to the trash on a company server', async () => {
    const { deps, files } = await setup();
    const partnerId = await partnerType(deps);
    const { mapId } = value(await startMap(deps, owner, { companyId, partnerId }));
    const { fileId } = (await deps.directory.map(mapId))!;
    const body = (await files.read(fileId))!.body;
    expect(await removePartnerType(deps, owner, { companyId, partnerId, expected: await expectedRows(deps, partnerId), items: 'keep' })).toMatchObject({ ok: true });
    await expectTrashed(files, fileId, body);
  });
});

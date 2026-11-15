import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { describe, expect, it } from 'vitest';
import { newMapPlan } from '@partner-desk/core';
import { createDatabaseCaseStore, createDatabaseMapStore, createDatabasePartnerBookStore, createDatabaseProgramStore, newWorkFileId } from '@partner-desk/storage';
import { runWorkFilesContract, sampleCase, sampleProgram } from '@partner-desk/storage/contract';
import { createDb } from './client';
import { TursoEventSink } from './turso-events';
import { SqliteTrash, SqliteWorkFiles, trashedWorkFileIds } from './sqlite-work-files';
import { createTestDb } from './test-db';

runWorkFilesContract('sqlite', async () => new SqliteWorkFiles(await createTestDb()));

describe('trashedWorkFileIds (plan 13, task 14)', () => {
  it('lists one company’s trashed files of one kind, oldest first, and nothing else', async () => {
    const db = await createTestDb();
    const files = new SqliteWorkFiles(db);
    const at = '2026-11-07T10:00:00.000Z';
    const make = async (kind: 'partners' | 'market', companyId: string) => {
      const id = newWorkFileId();
      await files.create({ id, kind, companyId, formatVersion: 5, body: '{}', createdAt: at, updatedAt: at });
      return id;
    };
    const [older, newer, kept, market, other] = [await make('partners', 'co_aaaaaaaaaa'), await make('partners', 'co_aaaaaaaaaa'),
      await make('partners', 'co_aaaaaaaaaa'), await make('market', 'co_aaaaaaaaaa'), await make('partners', 'co_bbbbbbbbbb')];
    await files.trash(older, '2026-11-07T11:00:00.000Z');
    await files.trash(newer, '2026-11-07T12:00:00.000Z');
    await files.trash(market, '2026-11-07T11:30:00.000Z');
    await files.trash(other, '2026-11-07T11:30:00.000Z');
    expect(await trashedWorkFileIds(db, 'partners', 'co_aaaaaaaaaa')).toEqual([older, newer]);
    expect(await trashedWorkFileIds(db, 'partners', 'co_aaaaaaaaaa')).not.toContain(kept);
  });
});

describe('SqliteWorkFiles', () => {
  it('two clients on one file, each writing at the revision it read: exactly one write lands', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pd-wf-')), 'test.db');
    const first = createDb(`file:${path}`);
    await migrate(first, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
    const a = new SqliteWorkFiles(first);
    const b = new SqliteWorkFiles(createDb(`file:${path}`));
    const id = newWorkFileId();
    const at = '2026-11-07T10:00:00.000Z';
    await a.create({ id, kind: 'partners', companyId: 'co_race00001', formatVersion: 5, body: '{}', createdAt: at, updatedAt: at });
    const [readA, readB] = await Promise.all([a.read(id), b.read(id)]);
    const wrote = await Promise.all([
      a.write(id, readA!.revision, { body: '{"by":"a"}', formatVersion: 5, updatedAt: at }),
      b.write(id, readB!.revision, { body: '{"by":"b"}', formatVersion: 5, updatedAt: at }),
    ]);
    expect(wrote.filter(Boolean)).toHaveLength(1);
    const after = await a.read(id);
    expect(after!.revision).toBe(1);
    expect(after!.body).toBe(wrote[0] ? '{"by":"a"}' : '{"by":"b"}');
  });

  it('a failed query names the operation only, never the file’s content', async () => {
    const files = new SqliteWorkFiles(await createTestDb());
    const at = '2026-11-07T10:00:00.000Z';
    const row = { id: newWorkFileId(), kind: 'partners' as const, companyId: 'co_secret001', formatVersion: 5, body: '{"Accounts":[["Acme GmbH secret"]]}', createdAt: at, updatedAt: at };
    await files.create(row);
    const error = await files.create(row).then(() => null, (e: unknown) => e as Error);
    expect(error?.message).toBe('work_file_create_failed');
    // Nothing of the driver's error comes along: no cause, and the stack names only the operation.
    expect(error?.cause).toBeUndefined();
    expect(error?.stack ?? '').not.toContain('Acme');
  });
});

describe('SqliteTrash (plan 16, task 1)', () => {
  const owner = { userId: 'u_anna', displayName: 'Anna' };
  async function setUp() {
    const db = await createTestDb();
    const files = new SqliteWorkFiles(db);
    const options = { files, appBaseUrl: 'https://desk.test' };
    const c = sampleCase();
    const caseFile = (await createDatabaseCaseStore(options).create(owner, 'co_aaaaaaaaaa', c)).fileId;
    const mapFile = (await createDatabaseMapStore(options).create(owner, 'co_aaaaaaaaaa', newMapPlan({ partnerId: 'p_acme', partnerType: 'reseller', contacts: [] }), 'Acme')).fileId;
    const programFile = (await createDatabaseProgramStore(options).create(owner, 'co_aaaaaaaaaa', sampleProgram())).fileId;
    const partnersFile = (await createDatabasePartnerBookStore(options).create(owner, 'co_aaaaaaaaaa')).fileId;
    const othersCase = (await createDatabaseCaseStore(options).create(owner, 'co_bbbbbbbbbb', c)).fileId;
    const sink = new TursoEventSink(db);
    /** A person's delete: the file to the trash, and the event that names it. */
    const deleted = async (command: 'cases.delete' | 'maps.delete' | 'programs.delete', fileId: string, id: string, at: string) => {
      await files.trash(fileId, at);
      await sink.record({ id: `ev_${fileId}_${at}`, at, command, actorKind: 'owner', actorUserId: 'u_anna', fileId, entityIds: [id] });
    };
    return { db, files, c, caseFile, mapFile, programFile, partnersFile, othersCase, deleted, trash: new SqliteTrash(db) };
  }

  it('lists one company’s deleted cases, MAPs and programs, the latest first, each read with its former id', async () => {
    const { files, c, caseFile, mapFile, programFile, partnersFile, othersCase, deleted, trash } = await setUp();
    await deleted('cases.delete', caseFile, c.id, '2026-11-09T10:00:00.000Z');
    await deleted('maps.delete', mapFile, 'map_old0000001', '2026-11-09T12:00:00.000Z');
    await deleted('programs.delete', programFile, 'pr_contract001', '2026-11-09T11:00:00.000Z');
    await files.trash(partnersFile, '2026-11-09T13:00:00.000Z');
    await deleted('cases.delete', othersCase, c.id, '2026-11-09T13:00:00.000Z');
    const listed = await trash.list('co_aaaaaaaaaa');
    expect(listed.map((f) => [f.fileId, f.kind, f.trashedAt, f.formerId])).toEqual([
      [mapFile, 'map', '2026-11-09T12:00:00.000Z', 'map_old0000001'], [programFile, 'program', '2026-11-09T11:00:00.000Z', 'pr_contract001'],
      [caseFile, 'businessCase', '2026-11-09T10:00:00.000Z', c.id],
    ]);
    expect(listed[0]!.content).toEqual({ kind: 'map', partnerId: 'p_acme', partnerType: 'reseller', people: [] });
    expect(listed[2]!.content).toMatchObject({ kind: 'businessCase', caseId: c.id, title: c.title });
    expect(await trash.get('co_aaaaaaaaaa', othersCase)).toBeNull();
    expect(await trash.get('co_aaaaaaaaaa', partnersFile)).toBeNull();
  });

  it('leaves out a file trashed when a create failed: no delete names it', async () => {
    const { files, caseFile, trash } = await setUp();
    await files.trash(caseFile, '2026-11-09T10:00:00.000Z');
    expect(await trash.list('co_aaaaaaaaaa')).toEqual([]);
    expect(await trash.get('co_aaaaaaaaaa', caseFile)).toBeNull();
  });

  it('restores a file once: a second restore at the same time finds it gone; trash puts it back', async () => {
    const { files, c, caseFile, deleted, trash } = await setUp();
    await deleted('cases.delete', caseFile, c.id, '2026-11-09T10:00:00.000Z');
    const found = await trash.get('co_aaaaaaaaaa', caseFile);
    expect(found).toMatchObject({ fileId: caseFile, kind: 'businessCase' });
    const both = await Promise.all([trash.restore(caseFile, found!.trashedAt), trash.restore(caseFile, found!.trashedAt)]);
    expect(both.filter(Boolean)).toHaveLength(1);
    expect(await trash.get('co_aaaaaaaaaa', caseFile)).toBeNull();
    expect((await files.read(caseFile))?.trashedAt).toBeNull();
    await trash.trash(caseFile, '2026-11-09T11:00:00.000Z');
    expect((await trash.list('co_aaaaaaaaaa')).map((f) => f.fileId)).toEqual([caseFile]);
  });

  it('lists a body it can’t read, with no content', async () => {
    const { db, c, caseFile, deleted, trash } = await setUp();
    await deleted('cases.delete', caseFile, c.id, '2026-11-09T10:00:00.000Z');
    await db.run(sql`update work_files set body = '{"Case":"x"}' where id = ${caseFile}`);
    expect(await trash.list('co_aaaaaaaaaa')).toEqual([expect.objectContaining({ fileId: caseFile, content: null })]);
  });
});

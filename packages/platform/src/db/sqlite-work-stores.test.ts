import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { describe, expect, it } from 'vitest';
import type { PartnerChange } from '@partner-desk/core';
import {
  createDatabaseCaseStore, createDatabaseCompanyFactsStore, createDatabaseMapStore, createDatabaseMarketStore, createDatabasePartnerBookStore,
  createDatabaseProgramStore, MemoryFileLock, serializeApplies,
} from '@partner-desk/storage';
import {
  runCaseStoreContract, runCompanyFactsStoreContract, runMapStoreContract, runMarketStoreContract, runPartnerBookStoreContract,
  runProgramStoreContract,
} from '@partner-desk/storage/contract';
import {
  MAP_LAYOUT, MARKET_LAYOUT, PARTNERS_LAYOUT, workbookRawAccess, workbookSettingsRawAccess, workFilesTarget,
} from '@partner-desk/storage/test-support';
import { createDb } from './client';
import { SqliteWorkFiles } from './sqlite-work-files';
import { createTestDb } from './test-db';

const owner = { userId: 'u_contract', displayName: 'Anna Keller' };
// One migrated database for each suite: a contract case makes its own files in it.
const files = new SqliteWorkFiles(await createTestDb());
const options = { files, appBaseUrl: 'https://desk.test' };

// With raw access through the same port: every contract case, hand edits included, runs on SQLite too.
const target = workFilesTarget(files);
runPartnerBookStoreContract('database (SQLite)', () => ({ store: createDatabasePartnerBookStore(options), owner, raw: workbookRawAccess(target, PARTNERS_LAYOUT) }));
runMarketStoreContract('database (SQLite)', () => ({ store: createDatabaseMarketStore(options), owner, raw: workbookRawAccess(target, MARKET_LAYOUT) }));
runMapStoreContract('database (SQLite)', () => ({ store: createDatabaseMapStore(options), owner, raw: workbookRawAccess(target, MAP_LAYOUT) }));
runProgramStoreContract('database (SQLite)', () => ({ store: createDatabaseProgramStore(options), owner, raw: workbookSettingsRawAccess(target) }));
runCompanyFactsStoreContract('database (SQLite)', () => ({ store: createDatabaseCompanyFactsStore(options), owner, raw: workbookSettingsRawAccess(target) }));
runCaseStoreContract('database (SQLite)', () => ({ store: createDatabaseCaseStore(options), owner, raw: workbookSettingsRawAccess(target) }));

describe('the database Partners store on SQLite', () => {
  it('ten saves to one file at once, from two clients, through serializeApplies: all land, none twice', async () => {
    const path = join(mkdtempSync(join(tmpdir(), 'pd-stores-')), 'test.db');
    const first = createDb(`file:${path}`);
    await migrate(first, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) });
    const lock = new MemoryFileLock();
    const a = serializeApplies(createDatabasePartnerBookStore({ files: new SqliteWorkFiles(first), appBaseUrl: 'https://desk.test' }), lock);
    const b = serializeApplies(createDatabasePartnerBookStore({ files: new SqliteWorkFiles(createDb(`file:${path}`)), appBaseUrl: 'https://desk.test' }), lock);
    const file = await a.create(owner, 'co_race00001');
    const stamp = { now: '2026-11-07T12:00:00.000Z', actor: 'Anna Keller' };
    const results = await Promise.all(Array.from({ length: 10 }, (_, i) =>
      (i % 2 ? a : b).apply({ fileId: file.fileId }, { kind: 'add', entity: 'account', values: { company: `Company ${i}` } } as PartnerChange, stamp)));
    expect(results.every((r) => r.ok)).toBe(true);
    const read = await a.read({ fileId: file.fileId });
    expect(read.ok && read.snapshot.value.accounts.map((x) => x.company).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `Company ${i}`).sort());
  });
});

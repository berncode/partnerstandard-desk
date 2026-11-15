import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';

const tempUrl = () => `file:${join(mkdtempSync(join(tmpdir(), 'pd-client-')), 'test.db')}`;

describe('createDb on a local file (plan 13, task 4)', () => {
  afterEach(() => {
    vi.doUnmock('@libsql/client');
    vi.resetModules();
  });

  it('opens the file in WAL mode', async () => {
    const { createDb } = await import('./client');
    const db = createDb(tempUrl());
    expect(await db.all(sql`PRAGMA journal_mode`)).toEqual([{ journal_mode: 'wal' }]);
  });

  it('gives every connection a busy timeout of 5000, also one a transaction opens', async () => {
    const { createDb } = await import('./client');
    const db = createDb(tempUrl());
    expect(await db.all(sql`PRAGMA busy_timeout`)).toEqual([{ timeout: 5000 }]);
    // Only the test opens a transaction: the app never holds one across an await. While it holds
    // the pool's one idle connection, a read outside it must open a second connection: that one must wait too.
    const [inside, outside] = await db.transaction(async (tx) => [await tx.all(sql`PRAGMA busy_timeout`), await db.all(sql`PRAGMA busy_timeout`)]);
    expect(inside).toEqual([{ timeout: 5000 }]);
    expect(outside).toEqual([{ timeout: 5000 }]);
  });

  it('has foreign keys on', async () => {
    const { createDb } = await import('./client');
    const db = createDb(tempUrl());
    expect(await db.all(sql`PRAGMA foreign_keys`)).toEqual([{ foreign_keys: 1 }]);
  });

  it('gives a libsql:// database no timeout and no pragma', async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    const createClient = vi.fn(() => ({ execute }));
    vi.doMock('@libsql/client', () => ({ createClient }));
    const { createDb } = await import('./client');
    createDb('libsql://pd-prod.turso.io', 'tok');
    // toStrictEqual: a `timeout: undefined` key would be a change too.
    expect(createClient.mock.calls).toStrictEqual([[{ url: 'libsql://pd-prod.turso.io', authToken: 'tok' }]]);
    expect(execute).not.toHaveBeenCalled();
  });

  it('warns once, with the mode only, when a local file stays out of WAL', async () => {
    const execute = vi.fn(async () => ({ rows: [['delete']] }));
    vi.doMock('@libsql/client', () => ({ createClient: vi.fn(() => ({ execute })) }));
    const { createDb } = await import('./client');
    const warn = vi.fn();
    createDb('file:/data/partner-desk.db', undefined, warn);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith({ event: 'db_wal_off', mode: 'delete' });
  });

  it('warns with the driver’s code when the switch fails (another process holds the file)', async () => {
    const execute = vi.fn(async () => { throw Object.assign(new Error('database is locked: /data/partner-desk.db'), { code: 'SQLITE_BUSY' }); });
    vi.doMock('@libsql/client', () => ({ createClient: vi.fn(() => ({ execute })) }));
    const { createDb } = await import('./client');
    const warn = vi.fn();
    createDb('file:/data/partner-desk.db', undefined, warn);
    await vi.waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(warn).toHaveBeenCalledWith({ event: 'db_wal_off', code: 'SQLITE_BUSY' });
  });

  it('says nothing for WAL, or for a database in memory', async () => {
    const { createDb } = await import('./client');
    const warn = vi.fn();
    const db = createDb(tempUrl(), undefined, warn);
    const memory = createDb('file::memory:', undefined, warn);
    await db.all(sql`SELECT 1`);
    await memory.all(sql`SELECT 1`);
    expect(warn).not.toHaveBeenCalled();
  });
});

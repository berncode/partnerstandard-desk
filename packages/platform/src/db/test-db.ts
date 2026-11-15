import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createDb, type Db } from './client';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/**
 * A fresh, migrated database for one test. A temp file rather than `:memory:`: libSQL can open a new connection
 * for a transaction, and a second connection to `:memory:` is a different, empty database.
 */
export async function createTestDb(): Promise<Db> {
  const dir = mkdtempSync(join(tmpdir(), 'pd-db-'));
  const db = createDb(`file:${join(dir, 'test.db')}`);
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return db;
}

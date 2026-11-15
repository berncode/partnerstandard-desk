import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

/** Drizzle on libSQL, with its client (`$client`) for what Drizzle has no call for: closing it, a bare health read. */
export type Db = LibSQLDatabase<typeof schema> & { $client: Client };

/**
 * How long a connection to a local file waits for another writer before it gives up. The client keeps a pool of
 * connections and opens new ones as needed, so this goes into `createClient`: a `PRAGMA busy_timeout` would reach one
 * connection only (plan 13's spike).
 */
export const LOCAL_BUSY_TIMEOUT_MS = 5000;

/** What `createDb` says when a local file didn't switch to WAL: the mode it got, or the driver's error code. Never content. */
export type LocalDbWarning = { event: 'db_wal_off'; mode?: string; code?: string };

/** One line on the server's log, in the app's own format (`[desk] event { … }`). */
const warnOnLog = (warning: LocalDbWarning): void => {
  const { event, ...fields } = warning;
  console.warn(`[desk] ${event}`, fields);
};

/**
 * `file:…` for local development, tests and the self-hosted edition; `libsql://…` (with a token) for Turso.
 * A local file runs in WAL mode (the file keeps the setting, so once is enough) and waits for another writer instead
 * of failing; Turso is left exactly as it was. Never hold a transaction across an `await` on a local file: the driver
 * is synchronous, and a second writer waiting for the lock blocks the whole process.
 */
export function createDb(url: string, authToken?: string, warn: (warning: LocalDbWarning) => void = warnOnLog): Db {
  if (!url.startsWith('file:')) return drizzle(createClient({ url, authToken }), { schema });
  const client = createClient({ url, authToken, timeout: LOCAL_BUSY_TIMEOUT_MS });
  // Queued ahead of every query this client is asked for (the pool lends its idle connection at once). The app still
  // works in another journal mode, only slower with readers and writers together, so a miss is a warning, not a stop:
  // another process holding the file, or a file system without shared memory ("delete"). In memory it is "memory".
  void client.execute('PRAGMA journal_mode=WAL').then(
    (result) => {
      const mode = String(result.rows[0]?.[0] ?? '').toLowerCase();
      if (mode !== 'wal' && mode !== 'memory') warn({ event: 'db_wal_off', mode });
    },
    (error: unknown) => warn({ event: 'db_wal_off', code: (error as { code?: string }).code ?? 'unknown' }),
  );
  return drizzle(client, { schema });
}

// A company server's start (plan 17, task 1; spec 2026-11-07 §10.2): before it serves, a copy of its database when a
// migration waits, then the migrations. A failure is one log line and the process ends, so the server never serves a
// half-migrated database; the copy stays in /data/backups to put back. Hosted never runs this (instrumentation.ts).
import { resolve } from 'node:path';
import type { StartupResult } from '@partner-desk/platform/startup';
import type { Log } from './log';

export interface CompanyStartDeps {
  databaseUrl: string;
  databaseAuthToken?: string;
  migrationsFolder: string;
  prepare: (input: { url: string; authToken?: string; migrationsFolder: string }) => Promise<StartupResult>;
  log: Log;
  /** Ends the process: the server must not start. */
  exit: (code: number) => void;
}

/**
 * The migrations' folder. The standalone server runs from `apps/web` (its server.js changes into its own folder), and
 * `next dev` from `apps/web` too; the build copies `packages/platform/drizzle` beside it (next.config.ts).
 */
export const migrationsFolder = (cwd: string = process.cwd()): string => resolve(cwd, '../../packages/platform/drizzle');

/** True when the start went well and the server may serve. */
export async function startCompanyServer(deps: CompanyStartDeps): Promise<boolean> {
  try {
    const result = await deps.prepare({ url: deps.databaseUrl, authToken: deps.databaseAuthToken, migrationsFolder: deps.migrationsFolder });
    if (result.migrated > 0) {
      deps.log('database_migrated', { migrations: String(result.migrated), ...(result.backup ? { backup: result.backup } : {}) });
    }
    return true;
  } catch (error) {
    // The error's message only: a migration's message names tables and columns, never a row's content.
    deps.log('database_start_failed', { reason: error instanceof Error ? error.message.slice(0, 300) : 'unknown' });
    deps.exit(1);
    return false;
  }
}

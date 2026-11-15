// A company server's database at start (plan 17, task 1; spec 2026-11-07 §10.2): before the server listens, a copy of
// the database when a migration waits, then the migrations. A failed migration throws: the caller logs it and exits, so
// the server never starts on a half-migrated database, and the copy stays to put back. Its paths come from the settings at run
// time, so the build traces none of them (`turbopackIgnore`); next.config.ts ships the migrations.
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { sql } from 'drizzle-orm';
import { createDb, type Db } from './client';

/** The start-up copies kept: the newest five [builder's call, spec §10.2]. */
export const BACKUPS_KEPT = 5;

export interface StartupResult {
  /** Migrations run now. */
  migrated: number;
  /** The copy made before them, or null when none was needed (nothing waited, or a new database). */
  backup: string | null;
}

const journalTags = (folder: string): string[] =>
  (JSON.parse(readFileSync(/*turbopackIgnore: true*/ join(folder, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> }).entries.map((e) => e.tag);

/** A start-up copy's name: `<database>-<last migration, or none>-<time>.db`. Anything else in the folder isn't ours. */
const copyPattern = (name: string): RegExp =>
  new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(none|\\d{4}_[A-Za-z0-9_]+)-(\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z)\\.db$`);

/**
 * Copies the database file aside when a migration waits on it, migrates, and keeps the newest five copies. A new,
 * empty database gets no copy, and neither does a remote one (`libsql://`: its host keeps its own). A database newer
 * than this app (a downgrade) is refused: the app's code doesn't know its tables. `now` names the copy.
 */
export async function prepareDatabase({ url, authToken, migrationsFolder, now = new Date() }: {
  url: string; authToken?: string; migrationsFolder: string; now?: Date;
}): Promise<StartupResult> {
  const db = createDb(url, authToken);
  try {
    const tags = journalTags(migrationsFolder);
    const tables = (await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`)).map((t) => t.name);
    const applied = tables.includes('__drizzle_migrations')
      ? Number((await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM __drizzle_migrations`))[0]?.n ?? 0)
      : 0;
    const waiting = tags.length - applied;
    if (waiting < 0) throw new Error(`database_newer_than_app: it has ${applied} migrations, this version knows ${tags.length}`);
    if (waiting === 0) return { migrated: 0, backup: null };
    // Anything in it is worth a copy, also a database made another way (no migrations recorded, tables there).
    const hasData = tables.some((name) => name !== '__drizzle_migrations');
    // The file SQLite really opened: the address may be relative or %-encoded.
    const file = url.startsWith('file:')
      ? String((await db.all<{ file: string }>(sql`SELECT file FROM pragma_database_list WHERE name = 'main'`))[0]?.file ?? '')
      : '';
    const backup = hasData && file !== '' ? await copyBefore(db, file, applied > 0 ? tags[applied - 1]! : 'none', now) : null;
    await migrate(db, { migrationsFolder });
    return { migrated: waiting, backup };
  } finally {
    db.$client.close();
  }
}

/**
 * A whole copy of the database in `backups/` beside it, before the migration named after `tag` and later ones. When
 * the newest copy is already of this state (made after the database last changed), that copy serves again: a container
 * that restarts on a failing migration doesn't copy the same file over and over, pushing the older copies out.
 */
async function copyBefore(db: Db, file: string, tag: string, now: Date): Promise<string> {
  const folder = join(dirname(file), 'backups');
  const name = basename(file, '.db');
  mkdirSync(/*turbopackIgnore: true*/ folder, { recursive: true });
  const pattern = copyPattern(name);
  const copies = readdirSync(/*turbopackIgnore: true*/ folder)
    .map((f) => ({ f, m: pattern.exec(f) }))
    .filter((c): c is { f: string; m: RegExpExecArray } => c.m !== null)
    .sort((a, b) => a.m[2]!.localeCompare(b.m[2]!));
  const newest = copies.at(-1);
  if (newest && newest.m[1] === tag) {
    const copied = mtimeOf(join(folder, newest.f));
    if (copied !== null && copied >= Math.max(mtimeOf(file) ?? 0, mtimeOf(`${file}-wal`) ?? 0)) return join(folder, newest.f);
  }
  const backup = join(folder, `${name}-${tag}-${now.toISOString().replace(/[:.]/g, '-')}.db`);
  // VACUUM INTO: a whole, consistent copy, with what is still in the WAL file (plan 13). Made under
  // another name and renamed once whole, so a copy cut short (a full disk, a stop) never passes for a good one.
  const unfinished = `${backup}.part`;
  rmSync(/*turbopackIgnore: true*/ unfinished, { force: true });
  await db.run(sql`VACUUM INTO ${unfinished}`);
  renameSync(/*turbopackIgnore: true*/ unfinished, backup);
  // The newest five by the time in their names, and always the one just made, whatever the clock said.
  const older = copies.filter((c) => join(folder, c.f) !== backup);
  for (const old of older.slice(0, Math.max(0, older.length - (BACKUPS_KEPT - 1)))) {
    rmSync(/*turbopackIgnore: true*/ join(folder, old.f), { force: true });
  }
  return backup;
}

const mtimeOf = (path: string): number | null => {
  try {
    return statSync(/*turbopackIgnore: true*/ path).mtimeMs;
  } catch {
    return null;
  }
};

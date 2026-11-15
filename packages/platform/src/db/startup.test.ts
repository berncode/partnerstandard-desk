import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, utimesSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { describe, expect, it } from 'vitest';
import { createDb } from './client';
import { BACKUPS_KEPT, prepareDatabase } from './startup';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));
const NOW = new Date('2026-11-09T21:00:00.000Z');

/** A copy of the migrations folder whose journal stops before its last `drop` entries. */
function folderWithout(drop: number): string {
  const dir = mkdtempSync(join(tmpdir(), 'pd-migrations-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: unknown[] };
  writeFileSync(path, JSON.stringify({ ...journal, entries: journal.entries.slice(0, journal.entries.length - drop) }));
  return dir;
}

/** The migrations as a next release might have them, with `broken` more after the last, each one that fails last. */
function folderWithBroken(good: number): string {
  const dir = folderWithout(0);
  const journalPath = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<Record<string, unknown>> };
  for (let i = 0; i <= good; i++) {
    const tag = i < good ? `999${i}_good` : '9999_broken';
    journal.entries.push({ ...journal.entries.at(-1)!, idx: journal.entries.length, tag, when: Date.now() + 1000 + i });
    writeFileSync(join(dir, `${tag}.sql`), i < good ? `CREATE TABLE good_${i} (x text);` : 'ALTER TABLE no_such_table ADD x text;');
  }
  writeFileSync(journalPath, JSON.stringify(journal));
  return dir;
}

const copiesIn = (dir: string): string[] => readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.db')).sort();

async function oldDatabase(url: string): Promise<void> {
  const old = createDb(url);
  await migrate(old, { migrationsFolder: folderWithout(1) });
  await old.run(sql`INSERT INTO companies (id, owner_user_id, name, created_at) VALUES ('co_1', 'u1', 'Halden', 'x')`);
  old.$client.close();
}

function newFile(): { url: string; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'pd-start-'));
  return { url: `file:${join(dir, 'partner-desk.db')}`, dir };
}

describe('prepareDatabase (plan 17, task 1)', () => {
  it('migrates a new database with no copy, and does nothing the second time', async () => {
    const { url, dir } = newFile();
    expect(await prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: NOW })).toMatchObject({ backup: null });
    expect(await prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: NOW })).toEqual({ migrated: 0, backup: null });
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('copies the database aside before a waiting migration, with what it holds, then migrates', async () => {
    const { url, dir } = newFile();
    const old = createDb(url);
    await migrate(old, { migrationsFolder: folderWithout(1) });
    await old.run(sql`INSERT INTO companies (id, owner_user_id, name, created_at) VALUES ('co_1', 'u1', 'Halden', 'x')`);
    old.$client.close();

    const out = await prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: NOW });
    expect(out.migrated).toBe(1);
    expect(out.backup).toMatch(/backups\/partner-desk-0017_proposal_maker_person-2026-11-09T21-00-00-000Z\.db$/);
    const copy = createDb(`file:${out.backup}`);
    expect(await copy.all(sql`SELECT name FROM companies`)).toEqual([{ name: 'Halden' }]);
    copy.$client.close();
    const now = createDb(url);
    expect(await now.all(sql`SELECT count(*) AS n FROM __drizzle_migrations`)).toEqual([{ n: readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).length }]);
    now.$client.close();
    expect(readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.db'))).toHaveLength(1);
  });

  it('keeps the newest five copies', async () => {
    const { url, dir } = newFile();
    mkdirSync(join(dir, 'backups'));
    for (let day = 1; day <= 7; day++) writeFileSync(join(dir, 'backups', `partner-desk-0015_work_files-2026-11-0${day}T08-00-00-000Z.db`), '');
    const old = createDb(url);
    await migrate(old, { migrationsFolder: folderWithout(1) });
    old.$client.close();
    await prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: NOW });
    const kept = readdirSync(join(dir, 'backups')).sort();
    expect(kept).toHaveLength(BACKUPS_KEPT);
    expect(kept.at(-1)).toContain('2026-11-09T21-00-00-000Z');
    expect(kept[0]).toContain('2026-11-04');
  });

  it('throws on a migration that fails, leaving the copy and the database as they were', async () => {
    const { url, dir } = newFile();
    const old = createDb(url);
    await migrate(old, { migrationsFolder: MIGRATIONS });
    await old.run(sql`INSERT INTO companies (id, owner_user_id, name, created_at) VALUES ('co_1', 'u1', 'Halden', 'x')`);
    old.$client.close();
    // A next release whose new migration can't run.
    const broken = folderWithout(0);
    const journalPath = join(broken, 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<Record<string, unknown>> };
    journal.entries.push({ ...journal.entries.at(-1)!, idx: journal.entries.length, tag: '9999_broken', when: Date.now() + 1000 });
    writeFileSync(journalPath, JSON.stringify(journal));
    writeFileSync(join(broken, '9999_broken.sql'), 'ALTER TABLE no_such_table ADD x text;');

    await expect(prepareDatabase({ url, migrationsFolder: broken, now: NOW })).rejects.toThrow();
    expect(readdirSync(join(dir, 'backups')).filter((f) => f.endsWith('.db'))).toHaveLength(1);
    const after = createDb(url);
    expect(await after.all(sql`SELECT name FROM companies`)).toEqual([{ name: 'Halden' }]);
    after.$client.close();
  });

  it('a failing migration after a good one leaves neither: the database is as it was, migrations and tables', async () => {
    const { url, dir } = newFile();
    const db = createDb(url);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    const before = await db.all(sql`SELECT count(*) AS n FROM __drizzle_migrations`);
    db.$client.close();
    await expect(prepareDatabase({ url, migrationsFolder: folderWithBroken(1), now: NOW })).rejects.toThrow();
    const after = createDb(url);
    expect(await after.all(sql`SELECT count(*) AS n FROM __drizzle_migrations`)).toEqual(before);
    expect(await after.all(sql`SELECT name FROM sqlite_master WHERE name = 'good_0'`)).toEqual([]);
    after.$client.close();
    expect(copiesIn(dir)).toHaveLength(1);
  });

  it('a restart on the same failing migration keeps the copy it made, and makes no more', async () => {
    const { url, dir } = newFile();
    await oldDatabase(url);
    mkdirSync(join(dir, 'backups'));
    for (let day = 1; day <= 4; day++) writeFileSync(join(dir, 'backups', `partner-desk-0014_x-2026-11-0${day}T08-00-00-000Z.db`), '');
    const broken = folderWithBroken(0);
    // The failing release's own journal ends with 9999_broken; the database waits on 0018 and it.
    await expect(prepareDatabase({ url, migrationsFolder: broken, now: NOW })).rejects.toThrow();
    for (let i = 1; i <= 6; i++) {
      await expect(prepareDatabase({ url, migrationsFolder: broken, now: new Date(NOW.getTime() + i * 60_000) })).rejects.toThrow();
    }
    const copies = copiesIn(dir);
    expect(copies).toHaveLength(5);
    expect(copies.filter((f) => f.includes('0017_proposal_maker_person'))).toEqual(['partner-desk-0017_proposal_maker_person-2026-11-09T21-00-00-000Z.db']);
  });

  it('a change after the copy gets a new copy at the next start', async () => {
    const { url, dir } = newFile();
    await oldDatabase(url);
    await expect(prepareDatabase({ url, migrationsFolder: folderWithBroken(0), now: NOW })).rejects.toThrow();
    const later = (Date.now() + 10_000) / 1000;
    utimesSync(join(dir, 'partner-desk.db'), later, later);
    await expect(prepareDatabase({ url, migrationsFolder: folderWithBroken(0), now: new Date(NOW.getTime() + 60_000) })).rejects.toThrow();
    expect(copiesIn(dir)).toHaveLength(2);
  });

  it('never removes a file that is not one of its copies, and never the copy just made, whatever the clock says', async () => {
    const { url, dir } = newFile();
    await oldDatabase(url);
    mkdirSync(join(dir, 'backups'));
    writeFileSync(join(dir, 'backups', 'partner-desk-before-upgrade.db'), 'mine');
    for (let day = 1; day <= 7; day++) writeFileSync(join(dir, 'backups', `partner-desk-0015_work_files-2026-11-0${day}T08-00-00-000Z.db`), '');
    const out = await prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: new Date('1970-01-02T00:00:00.000Z') });
    expect(existsSync(out.backup!)).toBe(true);
    expect(existsSync(join(dir, 'backups', 'partner-desk-before-upgrade.db'))).toBe(true);
    expect(copiesIn(dir).filter((f) => f !== 'partner-desk-before-upgrade.db')).toHaveLength(BACKUPS_KEPT);
  });

  it('copies a database whose path is %-encoded in its address, or holds a quote', async () => {
    for (const folderName of ['my desk', "o'brien"]) {
      // The real path: on a Mac the temp folder is a link (/var to /private/var), and SQLite names the file it opened
      // from a %-encoded address by its real path.
      const dir = join(realpathSync(mkdtempSync(join(tmpdir(), 'pd-start-'))), folderName);
      mkdirSync(dir);
      const plain = `file:${join(dir, 'partner-desk.db')}`;
      await oldDatabase(plain);
      const url = folderName === 'my desk' ? plain.replace(' ', '%20') : plain;
      const out = await prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: NOW });
      expect(out).toMatchObject({ migrated: 1 });
      expect(out.backup).toBe(join(dir, 'backups', 'partner-desk-0017_proposal_maker_person-2026-11-09T21-00-00-000Z.db'));
      expect(existsSync(out.backup!)).toBe(true);
    }
  });

  it('copies a database made another way, with tables and no migrations recorded, as "none"', async () => {
    const { url, dir } = newFile();
    const db = createDb(url);
    await db.run(sql`CREATE TABLE companies (id text)`);
    db.$client.close();
    await expect(prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: NOW })).rejects.toThrow();
    expect(copiesIn(dir)).toEqual(['partner-desk-none-2026-11-09T21-00-00-000Z.db']);
  });

  it('refuses a database from a newer version, and leaves it alone', async () => {
    const { url, dir } = newFile();
    const db = createDb(url);
    await migrate(db, { migrationsFolder: MIGRATIONS });
    db.$client.close();
    await expect(prepareDatabase({ url, migrationsFolder: folderWithout(1), now: NOW })).rejects.toThrow(/database_newer_than_app/);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('a copy cut short is never taken for a good one: only a whole copy gets the name', async () => {
    const { url, dir } = newFile();
    await oldDatabase(url);
    mkdirSync(join(dir, 'backups'));
    // What a copy stopped half-way leaves behind.
    writeFileSync(join(dir, 'backups', 'partner-desk-0017_proposal_maker_person-2026-11-09T21-00-00-000Z.db.part'), 'half');
    const out = await prepareDatabase({ url, migrationsFolder: MIGRATIONS, now: NOW });
    expect(readdirSync(join(dir, 'backups'))).toEqual(['partner-desk-0017_proposal_maker_person-2026-11-09T21-00-00-000Z.db']);
    const copy = createDb(`file:${out.backup}`);
    expect(await copy.all(sql`SELECT name FROM companies`)).toEqual([{ name: 'Halden' }]);
    copy.$client.close();
  });
});

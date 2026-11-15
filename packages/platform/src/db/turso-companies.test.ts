import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { renameCompany, type Deps } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { companies } from './schema';
import { createTestDb } from './test-db';
import { TursoCompanies } from './turso-companies';

describe('TursoCompanies', () => {
  it('forUser makes one company per user, also when called twice at once', async () => {
    const db = await createTestDb();
    const repo = new TursoCompanies(db);
    const [a, b, c] = await Promise.all([repo.forUser('u1'), repo.forUser('u1'), repo.forUser('u1')]);
    expect(a.companyId).toMatch(/^co_[0-9a-z]{10}$/);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(await db.select().from(companies)).toHaveLength(1);
    expect((await repo.forUser('u2')).companyId).not.toBe(a.companyId);
    expect(await repo.forUser('u1')).toEqual(a);
  });

  it('nameOf reads the name and never makes a company (the partner’s page, ruling R8)', async () => {
    const db = await createTestDb();
    const repo = new TursoCompanies(db);
    expect(await repo.nameOf('u1')).toBeNull();
    expect(await db.select().from(companies)).toHaveLength(0);
    await repo.forUser('u1');
    expect(await repo.nameOf('u1')).toBe('');
    await repo.rename('u1', 'Acme');
    expect(await repo.nameOf('u1')).toBe('Acme');
    expect(await repo.nameOf('u2')).toBeNull();
    expect(await db.select().from(companies)).toHaveLength(1);
  });

  it('renames only that user’s company', async () => {
    const repo = new TursoCompanies(await createTestDb());
    const mine = await repo.forUser('u1');
    const other = await repo.forUser('u2');
    expect(mine.name).toBe('');
    await repo.rename('u1', 'Acme');
    expect(await repo.forUser('u1')).toEqual({ companyId: mine.companyId, name: 'Acme' });
    expect(await repo.forUser('u2')).toEqual(other);
  });

  it('is the commands’ companies port: renameCompany saves the cleaned name here', async () => {
    const repo = new TursoCompanies(await createTestDb());
    const deps: Deps = { ...makeTestDeps(), companies: repo };
    await repo.forUser('u1');
    expect(await renameCompany(deps, { kind: 'owner', userId: 'u1', displayName: 'Ruth' }, { name: ' Acme ' })).toMatchObject({ ok: true });
    expect((await repo.forUser('u1')).name).toBe('Acme');
  });

  it('deletes a user’s company and then makes a fresh one on the next call', async () => {
    const db = await createTestDb();
    const repo = new TursoCompanies(db);
    const first = await repo.forUser('u1');
    await repo.forUser('u2');
    await repo.deleteForUser('u1');
    await repo.deleteForUser('u1');
    expect(await db.select().from(companies)).toHaveLength(1);
    expect((await repo.forUser('u1')).companyId).not.toBe(first.companyId);
  });

  it('fails with an error that names the operation only', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE companies`);
    const error = await new TursoCompanies(db).forUser('u_secret').catch((e: unknown) => e);
    expect((error as Error).message).toBe('companies_read_failed');
    const del = await new TursoCompanies(db).deleteForUser('u_secret').catch((e: unknown) => e);
    expect((del as Error).message).toBe('companies_delete_failed');
  });
});

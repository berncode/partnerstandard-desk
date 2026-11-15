import { describe, expect, it, vi } from 'vitest';
import { migrationsFolder, startCompanyServer, type CompanyStartDeps } from './company-start';

function deps(prepare: CompanyStartDeps['prepare']) {
  const logged: Array<[string, Record<string, string>]> = [];
  const exit = vi.fn();
  return { logged, exit, deps: { databaseUrl: 'file:/data/partner-desk.db', migrationsFolder: '/m', prepare, log: (e: string, ids: Record<string, string>) => { logged.push([e, ids]); }, exit } };
}

describe('startCompanyServer', () => {
  it('migrates and says so, with the copy it made', async () => {
    const prepare = vi.fn(async () => ({ migrated: 2, backup: '/data/backups/partner-desk-0017-x.db' }));
    const { deps: d, logged, exit } = deps(prepare);
    expect(await startCompanyServer(d)).toBe(true);
    expect(prepare).toHaveBeenCalledWith({ url: 'file:/data/partner-desk.db', authToken: undefined, migrationsFolder: '/m' });
    expect(logged).toEqual([['database_migrated', { migrations: '2', backup: '/data/backups/partner-desk-0017-x.db' }]]);
    expect(exit).not.toHaveBeenCalled();
  });

  it('nothing waiting: no log line', async () => {
    const { deps: d, logged } = deps(async () => ({ migrated: 0, backup: null }));
    expect(await startCompanyServer(d)).toBe(true);
    expect(logged).toEqual([]);
  });

  it('a failed migration: one log line and the process ends with 1', async () => {
    const { deps: d, logged, exit } = deps(async () => { throw new Error('no such column: x'); });
    expect(await startCompanyServer(d)).toBe(false);
    expect(logged).toEqual([['database_start_failed', { reason: 'no such column: x' }]]);
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe('migrationsFolder', () => {
  it('is the platform package’s drizzle folder, two levels up from apps/web', () => {
    expect(migrationsFolder('/app/apps/web')).toBe('/app/packages/platform/drizzle');
  });
});

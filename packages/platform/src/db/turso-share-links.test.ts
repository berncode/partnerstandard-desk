// Share links: owner ids, several cases at once, and the link that works now.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { ShareLinks } from '@partner-desk/commands';
import { shareLinks } from './schema';
import { createTestDb } from './test-db';
import { TursoShareLinks } from './turso-share-links';

const link = (id: string, ownerUserId: string, caseId: string, tokenHash: string, createdAt = '2026-10-25T10:00:00.000Z') =>
  ({ id, ownerUserId, caseId, tokenHash, createdAt });

describe('TursoShareLinks', () => {
  it('fits the commands’ ShareLinks', async () => {
    const links: ShareLinks = new TursoShareLinks(await createTestDb());
    expect(await links.findActive('hash-none')).toBeNull();
  });

  it('finds a link by its token hash until it is turned off', async () => {
    const links = new TursoShareLinks(await createTestDb());
    await links.create(link('sl_a', 'u_1', 'case_a', 'hash-a'));
    expect(await links.findActive('hash-a')).toEqual({ ownerUserId: 'u_1', caseId: 'case_a' });
    expect(await links.findActive('hash-b')).toBeNull();
    await links.revokeCases('u_1', ['case_a'], '2026-10-25T11:00:00.000Z');
    expect(await links.findActive('hash-a')).toBeNull();
  });

  it('turns off every link of these cases of one owner, and only those, and keeps the first time', async () => {
    const db = await createTestDb();
    const links = new TursoShareLinks(db);
    await links.create(link('sl_a1', 'u_1', 'case_a', 'hash-a1'));
    await links.create(link('sl_a2', 'u_1', 'case_a', 'hash-a2'));
    await links.create(link('sl_b', 'u_1', 'case_b', 'hash-b'));
    await links.create(link('sl_c', 'u_1', 'case_c', 'hash-c'));
    await links.create(link('sl_other', 'u_2', 'case_a', 'hash-other'));
    await links.revokeCases('u_1', ['case_a', 'case_c'], '2026-10-25T11:00:00.000Z');
    await links.revokeCases('u_1', ['case_a'], '2026-10-25T12:00:00.000Z');
    await links.revokeCases('u_1', [], '2026-10-25T12:00:00.000Z');
    expect(await links.findActive('hash-a1')).toBeNull();
    expect(await links.findActive('hash-a2')).toBeNull();
    expect(await links.findActive('hash-c')).toBeNull();
    expect(await links.findActive('hash-b')).toEqual({ ownerUserId: 'u_1', caseId: 'case_b' });
    expect(await links.findActive('hash-other')).toEqual({ ownerUserId: 'u_2', caseId: 'case_a' });
    const [row] = await db.select().from(shareLinks).where(sql`id = 'sl_a1'`);
    expect(row!.revokedAt).toBe('2026-10-25T11:00:00.000Z');
  });

  it('says when the case’s working link was made, and null when none works', async () => {
    const links = new TursoShareLinks(await createTestDb());
    expect(await links.activeFor('u_1', 'case_a')).toBeNull();
    await links.create(link('sl_a1', 'u_1', 'case_a', 'hash-a1', '2026-10-25T10:00:00.000Z'));
    await links.revokeCases('u_1', ['case_a'], '2026-10-25T11:00:00.000Z');
    await links.create(link('sl_a2', 'u_1', 'case_a', 'hash-a2', '2026-10-25T11:00:00.000Z'));
    expect(await links.activeFor('u_1', 'case_a')).toEqual({ createdAt: '2026-10-25T11:00:00.000Z' });
    expect(await links.activeFor('u_2', 'case_a')).toBeNull();
    await links.revokeCases('u_1', ['case_a'], '2026-10-25T12:00:00.000Z');
    expect(await links.activeFor('u_1', 'case_a')).toBeNull();
  });

  it('deletes every link of one owner, and only theirs', async () => {
    const db = await createTestDb();
    const links = new TursoShareLinks(db);
    await links.create(link('sl_a', 'u_1', 'case_a', 'hash-a'));
    await links.create(link('sl_b', 'u_1', 'case_b', 'hash-b'));
    await links.create(link('sl_c', 'u_10', 'case_c', 'hash-c'));
    await links.deleteForOwner('u_1');
    await links.deleteForOwner('u_1');
    expect((await db.select().from(shareLinks)).map((r) => r.id)).toEqual(['sl_c']);
  });

  it('never keeps two links with the same token hash', async () => {
    const links = new TursoShareLinks(await createTestDb());
    await links.create(link('sl_a', 'u_1', 'case_a', 'hash-a'));
    await expect(links.create(link('sl_b', 'u_2', 'case_b', 'hash-a'))).rejects.toThrow(/^share_links_create_failed$/);
  });

  it('fails with an error that names the operation only', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE share_links`);
    const links = new TursoShareLinks(db);
    const errors = await Promise.all([
      links.create(link('sl_a', 'u_secret', 'case_a', 'hash-secret')).catch((e: unknown) => e),
      links.findActive('hash-secret').catch((e: unknown) => e),
      links.revokeCases('u_secret', ['case_a'], '2026-10-25T11:00:00.000Z').catch((e: unknown) => e),
      links.deleteForOwner('u_secret').catch((e: unknown) => e),
      links.activeFor('u_secret', 'case_a').catch((e: unknown) => e),
    ]);
    expect(errors.map((e) => (e as Error).message)).toEqual([
      'share_links_create_failed', 'share_links_find_failed', 'share_links_revoke_failed', 'share_links_delete_failed', 'share_links_active_failed',
    ]);
  });
});

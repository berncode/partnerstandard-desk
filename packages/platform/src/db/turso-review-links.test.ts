// The review summary links (reviews spec 5.6), in the shape of the business case's share links (turso-share-links.test.ts).
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { ReviewLinks } from '@partner-desk/commands';
import { reviewLinks } from './schema';
import { createTestDb } from './test-db';
import { TursoReviewLinks } from './turso-review-links';

const link = (id: string, ownerUserId: string, mapId: string, reviewId: string, tokenHash: string, createdAt = '2026-10-31T10:00:00.000Z') =>
  ({ id, ownerUserId, mapId, reviewId, tokenHash, createdAt });

describe('TursoReviewLinks', () => {
  it('fits the commands’ ReviewLinks', async () => {
    const links: ReviewLinks = new TursoReviewLinks(await createTestDb());
    expect(await links.findActive('hash-none')).toBeNull();
  });

  it('finds a link by its token hash until it is turned off', async () => {
    const links = new TursoReviewLinks(await createTestDb());
    await links.create(link('rl_a', 'u_1', 'map_a', 'rv_a', 'hash-a'));
    expect(await links.findActive('hash-a')).toEqual({ ownerUserId: 'u_1', mapId: 'map_a', reviewId: 'rv_a' });
    expect(await links.findActive('hash-b')).toBeNull();
    await links.revokeReview('u_1', 'map_a', 'rv_a', '2026-10-31T11:00:00.000Z');
    expect(await links.findActive('hash-a')).toBeNull();
  });

  it('turns off one review’s links of one owner, and only those, and keeps the first time', async () => {
    const db = await createTestDb();
    const links = new TursoReviewLinks(db);
    await links.create(link('rl_1', 'u_1', 'map_a', 'rv_1', 'hash-1'));
    await links.create(link('rl_2', 'u_1', 'map_a', 'rv_2', 'hash-2'));
    await links.create(link('rl_other', 'u_2', 'map_a', 'rv_1', 'hash-other'));
    await links.revokeReview('u_1', 'map_a', 'rv_1', '2026-10-31T11:00:00.000Z');
    await links.revokeReview('u_1', 'map_a', 'rv_1', '2026-10-31T12:00:00.000Z');
    expect(await links.findActive('hash-1')).toBeNull();
    expect(await links.findActive('hash-2')).toEqual({ ownerUserId: 'u_1', mapId: 'map_a', reviewId: 'rv_2' });
    expect(await links.findActive('hash-other')).toEqual({ ownerUserId: 'u_2', mapId: 'map_a', reviewId: 'rv_1' });
    const [row] = await db.select().from(reviewLinks).where(sql`id = 'rl_1'`);
    expect(row!.revokedAt).toBe('2026-10-31T11:00:00.000Z');
  });

  it('turns off every link of these MAPs of one owner, and only those (a MAP deleted, its partner type removed)', async () => {
    const links = new TursoReviewLinks(await createTestDb());
    await links.create(link('rl_a1', 'u_1', 'map_a', 'rv_1', 'hash-a1'));
    await links.create(link('rl_a2', 'u_1', 'map_a', 'rv_2', 'hash-a2'));
    await links.create(link('rl_b', 'u_1', 'map_b', 'rv_3', 'hash-b'));
    await links.create(link('rl_c', 'u_1', 'map_c', 'rv_4', 'hash-c'));
    await links.create(link('rl_other', 'u_2', 'map_a', 'rv_5', 'hash-other'));
    await links.revokeMaps('u_1', ['map_a', 'map_c'], '2026-10-31T11:00:00.000Z');
    await links.revokeMaps('u_1', [], '2026-10-31T11:00:00.000Z');
    expect(await links.findActive('hash-a1')).toBeNull();
    expect(await links.findActive('hash-a2')).toBeNull();
    expect(await links.findActive('hash-c')).toBeNull();
    expect(await links.findActive('hash-b')).toEqual({ ownerUserId: 'u_1', mapId: 'map_b', reviewId: 'rv_3' });
    expect(await links.findActive('hash-other')).toEqual({ ownerUserId: 'u_2', mapId: 'map_a', reviewId: 'rv_5' });
  });

  it('says when the review’s working link was made, and null when none works', async () => {
    const links = new TursoReviewLinks(await createTestDb());
    expect(await links.activeFor('u_1', 'map_a', 'rv_1')).toBeNull();
    await links.create(link('rl_1', 'u_1', 'map_a', 'rv_1', 'hash-1', '2026-10-31T10:00:00.000Z'));
    await links.revokeReview('u_1', 'map_a', 'rv_1', '2026-10-31T11:00:00.000Z');
    await links.create(link('rl_2', 'u_1', 'map_a', 'rv_1', 'hash-2', '2026-10-31T11:00:00.000Z'));
    expect(await links.activeFor('u_1', 'map_a', 'rv_1')).toEqual({ createdAt: '2026-10-31T11:00:00.000Z' });
    expect(await links.activeFor('u_2', 'map_a', 'rv_1')).toBeNull();
    expect(await links.activeFor('u_1', 'map_b', 'rv_1')).toBeNull();
  });

  it('deletes every link of one owner, and only theirs', async () => {
    const db = await createTestDb();
    const links = new TursoReviewLinks(db);
    await links.create(link('rl_a', 'u_1', 'map_a', 'rv_1', 'hash-a'));
    await links.create(link('rl_b', 'u_1', 'map_b', 'rv_2', 'hash-b'));
    await links.create(link('rl_c', 'u_10', 'map_c', 'rv_3', 'hash-c'));
    await links.deleteForOwner('u_1');
    await links.deleteForOwner('u_1');
    expect((await db.select().from(reviewLinks)).map((r) => r.id)).toEqual(['rl_c']);
  });

  it('never keeps two links with the same token hash', async () => {
    const links = new TursoReviewLinks(await createTestDb());
    await links.create(link('rl_a', 'u_1', 'map_a', 'rv_1', 'hash-a'));
    await expect(links.create(link('rl_b', 'u_2', 'map_b', 'rv_2', 'hash-a'))).rejects.toThrow(/^review_links_create_failed$/);
  });

  it('holds ids, the token’s hash and two times only: no content', async () => {
    const db = await createTestDb();
    await new TursoReviewLinks(db).create(link('rl_a', 'u_1', 'map_a', 'rv_1', 'hash-a'));
    const [row] = await db.select().from(reviewLinks);
    expect(Object.keys(row!).sort()).toEqual(['createdAt', 'id', 'mapId', 'ownerUserId', 'reviewId', 'revokedAt', 'tokenHash']);
  });

  it('fails with an error that names the operation only', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE review_links`);
    const links = new TursoReviewLinks(db);
    const errors = await Promise.all([
      links.create(link('rl_a', 'u_secret', 'map_a', 'rv_1', 'hash-secret')).catch((e: unknown) => e),
      links.findActive('hash-secret').catch((e: unknown) => e),
      links.revokeReview('u_secret', 'map_a', 'rv_1', '2026-10-31T11:00:00.000Z').catch((e: unknown) => e),
      links.revokeMaps('u_secret', ['map_a'], '2026-10-31T11:00:00.000Z').catch((e: unknown) => e),
      links.deleteForOwner('u_secret').catch((e: unknown) => e),
      links.activeFor('u_secret', 'map_a', 'rv_1').catch((e: unknown) => e),
    ]);
    expect(errors.map((e) => (e as Error).message)).toEqual([
      'review_links_create_failed', 'review_links_find_failed', 'review_links_revoke_failed', 'review_links_revoke_failed',
      'review_links_delete_failed', 'review_links_active_failed',
    ]);
  });
});

// The shared contract on the Turso tables, and their errors.
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { describeMapAccessContract, describeRateLimiterContract } from '@partner-desk/commands/contract';
import { createTestDb } from './test-db';
import { TursoMapLinks } from './turso-map-links';
import { TursoMapSessions } from './turso-map-sessions';
import { TursoRateLimiter } from './turso-rate-limits';

describeMapAccessContract('turso', async () => {
  const db = await createTestDb();
  return { links: new TursoMapLinks(db), sessions: new TursoMapSessions(db) };
});
describeRateLimiterContract('turso', async () => new TursoRateLimiter(await createTestDb()));

describe('the MAP link tables', () => {
  it('fail with an error that names the operation only, never a hash or an id', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE map_links`);
    await db.run(sql`DROP TABLE map_sessions`);
    await db.run(sql`DROP TABLE rate_limits`);
    const links = new TursoMapLinks(db);
    const sessions = new TursoMapSessions(db);
    const limiter = new TursoRateLimiter(db);
    const secret = 'hash-secret';
    const link = { id: 'ml_1', mapId: 'map_1', ownerUserId: 'u_secret', personId: 'p_1', side: 'partner', emailHash: secret, tokenHash: secret, createdAt: 'x' } as const;
    const errors = await Promise.all([
      links.create(link), links.get('ml_1'), links.findByTokenHash(secret), links.listForMap('map_1'), links.touch('ml_1', 'x'),
      links.revokePerson('map_1', 'p_1', 'x'), links.revokeMaps(['map_1'], 'x'), links.deleteForOwner('u_secret'),
      sessions.create({ id: 'ms_1', linkId: 'ml_1', mapId: 'map_1', tokenHash: secret, expiresAt: 'x' }), sessions.findByTokenHash(secret),
      sessions.extend('ms_1', 'x'), sessions.delete('ms_1'), sessions.deleteForMaps(['map_1']), sessions.deleteExpired('x'),
      limiter.hit(secret, 1, 1000, 1), limiter.prune(1),
    ].map((p) => p.then(() => null, (e: unknown) => (e as Error).message)));
    expect(errors).toEqual([
      'map_links_create_failed', 'map_links_read_failed', 'map_links_read_failed', 'map_links_list_failed', 'map_links_touch_failed',
      'map_links_revoke_failed', 'map_links_revoke_failed', 'map_links_delete_failed',
      'map_sessions_create_failed', 'map_sessions_read_failed', 'map_sessions_extend_failed', 'map_sessions_delete_failed',
      'map_sessions_delete_failed', 'map_sessions_prune_failed',
      'rate_limit_hit_failed', 'rate_limit_prune_failed',
    ]);
  });
});

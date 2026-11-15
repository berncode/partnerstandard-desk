// For PartnerStandard Desk's split tables: links (with owner ids and address hashes), sessions (with token hashes), and the rate limiter.
import { describe, expect, it } from 'vitest';
import type { MapLink, MapLinks, MapSessions, RateLimiter } from './directory';

const T0 = '2026-10-19T10:00:00.000Z';
type NewLink = Omit<MapLink, 'lastUsedAt' | 'revokedAt'> & { tokenHash: string };
const link = (overrides: Partial<NewLink> = {}): NewLink => ({
  id: 'ml_1', mapId: 'map_1', ownerUserId: 'u_1', personId: 'p_1', side: 'partner', emailHash: 'email-1', tokenHash: 'hash-1', createdAt: T0,
  ...overrides,
});
const session = (id: string, linkId: string, mapId: string, expiresAt = '2026-11-18T10:00:00.000Z') =>
  ({ id, linkId, mapId, tokenHash: `token-${id}`, expiresAt });

/** Every MapLinks and MapSessions pair (one database) must pass this suite. */
export function describeMapAccessContract(name: string, make: () => Promise<{ links: MapLinks; sessions: MapSessions }>) {
  describe(`MapLinks and MapSessions contract: ${name}`, () => {
    it('adds a link and finds it by id and token hash, without returning the token hash', async () => {
      const { links } = await make();
      await links.create(link());
      const stored = {
        id: 'ml_1', mapId: 'map_1', ownerUserId: 'u_1', personId: 'p_1', side: 'partner', emailHash: 'email-1', createdAt: T0, lastUsedAt: null, revokedAt: null,
      };
      expect(await links.get('ml_1')).toEqual(stored);
      expect(await links.findByTokenHash('hash-1')).toEqual(stored);
      expect(await links.get('ml_missing')).toBeNull();
      expect(await links.findByTokenHash('nope')).toBeNull();
    });

    it('refuses a second link with the same token hash', async () => {
      const { links } = await make();
      await links.create(link());
      await expect(links.create(link({ id: 'ml_2' }))).rejects.toThrow();
    });

    it('lists a MAP’s links oldest first, revoked ones included', async () => {
      const { links } = await make();
      await links.create(link({ id: 'ml_b', tokenHash: 'h-b', createdAt: '2026-10-19T11:00:00.000Z' }));
      await links.create(link({ id: 'ml_a', tokenHash: 'h-a', createdAt: '2026-10-19T09:00:00.000Z' }));
      await links.create(link({ id: 'ml_x', tokenHash: 'h-x', mapId: 'map_2' }));
      await links.revokePerson('map_1', 'p_1', T0);
      expect((await links.listForMap('map_1')).map((l) => [l.id, l.revokedAt])).toEqual([['ml_a', T0], ['ml_b', T0]]);
    });

    it('records the last use', async () => {
      const { links } = await make();
      await links.create(link());
      await links.touch('ml_1', '2026-10-20T08:00:00.000Z');
      expect((await links.get('ml_1'))?.lastUsedAt).toBe('2026-10-20T08:00:00.000Z');
    });

    it('revokes every working link of one person on one MAP, and only those', async () => {
      const { links } = await make();
      await links.create(link({ id: 'ml_1', tokenHash: 'h1' }));
      await links.create(link({ id: 'ml_2', tokenHash: 'h2' }));
      await links.create(link({ id: 'ml_3', tokenHash: 'h3', personId: 'p_2' }));
      await links.create(link({ id: 'ml_4', tokenHash: 'h4', mapId: 'map_2' }));
      expect(await links.revokePerson('map_1', 'p_1', T0)).toBe(2);
      expect(await links.revokePerson('map_1', 'p_1', '2026-10-21T00:00:00.000Z')).toBe(0);
      expect((await links.get('ml_1'))?.revokedAt).toBe(T0);
      expect((await links.get('ml_3'))?.revokedAt).toBeNull();
      expect((await links.get('ml_4'))?.revokedAt).toBeNull();
    });

    it('revokes every link of these MAPs, keeping the time of one already off', async () => {
      const { links } = await make();
      await links.create(link({ id: 'ml_1', tokenHash: 'h1' }));
      await links.create(link({ id: 'ml_2', tokenHash: 'h2', mapId: 'map_2' }));
      await links.create(link({ id: 'ml_3', tokenHash: 'h3', mapId: 'map_3' }));
      await links.revokePerson('map_1', 'p_1', T0);
      await links.revokeMaps(['map_1', 'map_2'], '2026-10-21T00:00:00.000Z');
      await links.revokeMaps([], '2026-10-22T00:00:00.000Z');
      expect((await links.get('ml_1'))?.revokedAt).toBe(T0);
      expect((await links.get('ml_2'))?.revokedAt).toBe('2026-10-21T00:00:00.000Z');
      expect((await links.get('ml_3'))?.revokedAt).toBeNull();
    });

    it('deletes every link of one owner with its sessions, and nothing of another owner', async () => {
      const { links, sessions } = await make();
      await links.create(link({ id: 'ml_1', tokenHash: 'h1' }));
      await links.create(link({ id: 'ml_2', tokenHash: 'h2', mapId: 'map_2' }));
      await links.create(link({ id: 'ml_10', tokenHash: 'h10', ownerUserId: 'u_10', mapId: 'map_10' }));
      await links.revokePerson('map_2', 'p_1', T0);
      await sessions.create(session('ms_1', 'ml_1', 'map_1'));
      await sessions.create(session('ms_2', 'ml_2', 'map_2'));
      await sessions.create(session('ms_10', 'ml_10', 'map_10'));
      await links.deleteForOwner('u_1');
      await links.deleteForOwner('u_1');
      expect(await links.get('ml_1')).toBeNull();
      expect(await links.get('ml_2')).toBeNull();
      expect(await sessions.findByTokenHash('token-ms_1')).toBeNull();
      expect(await sessions.findByTokenHash('token-ms_2')).toBeNull();
      expect(await links.get('ml_10')).not.toBeNull();
      expect(await sessions.findByTokenHash('token-ms_10')).not.toBeNull();
    });

    it('stores, finds by token hash, extends and ends a session, never giving back its hash', async () => {
      const { sessions } = await make();
      await sessions.create(session('ms_1', 'ml_1', 'map_1'));
      expect(await sessions.findByTokenHash('token-ms_1')).toEqual({ id: 'ms_1', linkId: 'ml_1', mapId: 'map_1', expiresAt: '2026-11-18T10:00:00.000Z' });
      await sessions.extend('ms_1', '2026-11-20T10:00:00.000Z');
      expect((await sessions.findByTokenHash('token-ms_1'))?.expiresAt).toBe('2026-11-20T10:00:00.000Z');
      expect(await sessions.findByTokenHash('other')).toBeNull();
      await expect(sessions.create(session('ms_1', 'ml_2', 'map_2'))).rejects.toThrow();
      await sessions.delete('ms_1');
      await sessions.delete('ms_1');
      expect(await sessions.findByTokenHash('token-ms_1')).toBeNull();
    });

    it('ends every session of these MAPs, and only theirs', async () => {
      const { sessions } = await make();
      await sessions.create(session('ms_1', 'ml_1', 'map_1'));
      await sessions.create(session('ms_2', 'ml_2', 'map_2'));
      await sessions.create(session('ms_3', 'ml_3', 'map_3'));
      await sessions.deleteForMaps(['map_1', 'map_2']);
      await sessions.deleteForMaps([]);
      expect(await sessions.findByTokenHash('token-ms_1')).toBeNull();
      expect(await sessions.findByTokenHash('token-ms_2')).toBeNull();
      expect(await sessions.findByTokenHash('token-ms_3')).not.toBeNull();
    });

    it('deletes sessions that expired before now, and keeps the rest', async () => {
      const { sessions } = await make();
      await sessions.create(session('ms_old', 'ml_1', 'map_1', '2026-10-19T09:59:59.999Z'));
      await sessions.create(session('ms_now', 'ml_1', 'map_1', T0));
      await sessions.create(session('ms_new', 'ml_2', 'map_1'));
      expect(await sessions.deleteExpired(T0)).toBe(1);
      expect(await sessions.findByTokenHash('token-ms_old')).toBeNull();
      expect(await sessions.findByTokenHash('token-ms_now')).not.toBeNull();
      expect(await sessions.findByTokenHash('token-ms_new')).not.toBeNull();
      expect(await sessions.deleteExpired(T0)).toBe(0);
    });
  });
}

/** Every RateLimiter must pass this suite. */
export function describeRateLimiterContract(name: string, make: () => RateLimiter | Promise<RateLimiter>) {
  describe(`RateLimiter contract: ${name}`, () => {
    it('allows `limit` hits in a window, then refuses until the next window', async () => {
      const limiter = await make();
      const results = [];
      for (let i = 0; i < 4; i++) results.push(await limiter.hit('k', 3, 1000, 10_000 + i));
      expect(results).toEqual([true, true, true, false]);
      expect(await limiter.hit('other', 3, 1000, 10_100)).toBe(true);
      expect(await limiter.hit('k', 3, 1000, 11_000)).toBe(true);
    });

    it('prunes counters whose window started before a time, and keeps counting the rest', async () => {
      const limiter = await make();
      await limiter.hit('old', 2, 1000, 1_500);
      await limiter.hit('new', 2, 1000, 5_200);
      expect(await limiter.prune(5_000)).toBe(1);
      expect(await limiter.prune(5_000)).toBe(0);
      expect(await limiter.hit('new', 2, 1000, 5_300)).toBe(true);
      expect(await limiter.hit('new', 2, 1000, 5_400)).toBe(false);
    });
  });
}

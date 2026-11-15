import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { addressHash } from '@partner-desk/commands';
import { createTestDb } from './test-db';
import { TursoCompanies } from './turso-companies';
import { TursoEmailPrefs, TursoMapEvents, TursoNotificationLog } from './turso-notifications';

const NOW = '2026-11-03T07:30:00.000Z';
const later = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();

describe('TursoNotificationLog (the email log)', () => {
  it('claims a key once, lets an abandoned claim be taken over, keeps a sent key, and gives back an unsent one', async () => {
    const log = new TursoNotificationLog(await createTestDb());
    const meta = { type: 'momentum', mapId: 'map_1', recipientEmail: 'ben@example.com' } as const;
    expect(await log.claim('momentum:map_1', meta, NOW)).toBe(true);
    expect(await log.claim('momentum:map_1', meta, NOW)).toBe(false);
    expect(await log.existing(['momentum:map_1', 'other'], NOW)).toEqual(new Set(['momentum:map_1']));
    // Eleven minutes later the claim is abandoned: another run may take it.
    expect(await log.claim('momentum:map_1', meta, later(NOW, 11 * 60_000))).toBe(true);
    await log.markSent('momentum:map_1', 'email_1', NOW);
    await log.release('momentum:map_1');
    expect(await log.claim('momentum:map_1', meta, later(NOW, 3_600_000))).toBe(false);
    expect(await log.claim('digest:u1:2026-11-03', { ...meta, type: 'digest', mapId: null }, NOW)).toBe(true);
    await log.release('digest:u1:2026-11-03');
    expect(await log.existing(['digest:u1:2026-11-03'], NOW)).toEqual(new Set());
  });

  it('prunes sent rows after 90 days and claims after a day; account deletion removes the owner’s MAPs’ rows and digests', async () => {
    const log = new TursoNotificationLog(await createTestDb());
    const meta = (mapId: string | null) => ({ type: 'digest', mapId, recipientEmail: 'x@example.com' }) as const;
    await log.claim('a', meta('map_1'), NOW);
    await log.markSent('a', null, NOW);
    await log.claim('daily:map_1:2026-11-03', { type: 'daily', mapId: 'map_1', recipientEmail: null }, NOW);
    await log.claim('digest:u1:2026-11-03', meta(null), NOW);
    await log.markSent('digest:u1:2026-11-03', null, NOW);
    await log.claim('digest:u2:2026-11-03', meta(null), NOW);
    await log.markSent('digest:u2:2026-11-03', null, NOW);
    expect(await log.prune(new Date(later(NOW, 2 * 86_400_000)))).toBe(1);
    expect(await log.prune(new Date(later(NOW, 91 * 86_400_000)))).toBe(3);

    await log.claim('b', meta('map_1'), NOW);
    await log.claim('c', meta('map_2'), NOW);
    await log.claim('digest:u1:2026-11-04', meta(null), NOW);
    await log.claim('reconnect:u1:2026-11-04', { type: 'reconnect', mapId: 'map_1', recipientEmail: 'x@example.com' }, NOW);
    expect(await log.deleteForOwner('u1', ['map_1'])).toBe(3);
    expect(await log.existing(['b', 'c', 'digest:u1:2026-11-04', 'reconnect:u1:2026-11-04'], NOW)).toEqual(new Set(['c']));
  });

  it('names the operation only when the database fails', async () => {
    const db = await createTestDb();
    const log = new TursoNotificationLog(db);
    await db.run(sql`DROP TABLE notification_log`);
    await expect(log.claim('k', { type: 'daily', mapId: 'map_1', recipientEmail: 'secret@example.com' }, NOW)).rejects.toThrow(/^notification_claim_failed$/);
  });
});

describe('TursoEmailPrefs', () => {
  it('unsubscribes by the address’s hash, per kind, and back again', async () => {
    const db = await createTestDb();
    const prefs = new TursoEmailPrefs(db);
    await prefs.unsubscribe(addressHash('Lena@Example.com'), 'digest', NOW);
    await prefs.unsubscribe(addressHash('lena@example.com'), 'digest', later(NOW, 1000));
    expect(await prefs.unsubscribed(['lena@example.com', 'ben@example.com'], 'digest')).toEqual(new Set(['lena@example.com']));
    expect(await prefs.unsubscribed(['lena@example.com'], 'nudges')).toEqual(new Set());
    expect(await prefs.isUnsubscribed(addressHash('lena@example.com'), 'digest')).toBe(true);
    expect(await prefs.listForHash(addressHash('lena@example.com'))).toEqual([{ type: 'digest', unsubscribedAt: NOW }]);
    await prefs.resubscribe(addressHash('lena@example.com'), 'digest');
    expect(await prefs.isUnsubscribed(addressHash('lena@example.com'), 'digest')).toBe(false);
    // Hashes only: no address is stored.
    const rows = await db.run(sql`SELECT * FROM email_prefs`);
    expect(JSON.stringify(rows.rows)).not.toContain('example.com');
  });
});

describe('TursoMapEvents (link holders’ changes, for partner alerts)', () => {
  it('records ids and codes, lists them after a cursor in order, and prunes old ones', async () => {
    const events = new TursoMapEvents(await createTestDb());
    expect(await events.latestId('map_1')).toBeNull();
    const event = { entityType: 'activity', entityId: 'act_1', action: 'status_changed', actorRef: 'ml_1', at: NOW } as const;
    await events.record('map_1', event);
    await events.record('map_2', { ...event, at: later(NOW, 1000) });
    await events.record('map_1', { ...event, action: 'updated', at: later(NOW, 2000) });
    const all = await events.since('map_1', null);
    expect(all.map((e) => e.action)).toEqual(['status_changed', 'updated']);
    expect(all[0]).toEqual({ id: all[0]!.id, ...event });
    expect(await events.since('map_1', all[0]!.id)).toHaveLength(1);
    expect(await events.latestId('map_1')).toBe(all[1]!.id);
    expect(await events.prune(later(NOW, 1500))).toBe(2);
    expect(await events.since('map_1', null)).toHaveLength(1);
  });
});

describe('TursoCompanies: the owner’s timezone', () => {
  it('is null until chosen, and saving it makes the company on first use', async () => {
    const companies = new TursoCompanies(await createTestDb());
    expect(await companies.timeZoneOf('u1')).toBeNull();
    await companies.setTimeZone('u1', 'America/New_York');
    expect(await companies.timeZoneOf('u1')).toBe('America/New_York');
    await companies.rename('u1', 'Acme');
    expect(await companies.forUser('u1')).toMatchObject({ name: 'Acme' });
    expect(await companies.timeZoneOf('u1')).toBe('America/New_York');
  });
});

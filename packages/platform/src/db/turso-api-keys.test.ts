import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { apiKeys } from './schema';
import { createTestDb } from './test-db';
import { TursoApiKeys } from './turso-api-keys';

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** A clock the test moves by hand. */
function clock(start = '2026-11-01T08:00:00.000Z') {
  let now = new Date(start).getTime();
  return { now: () => new Date(now), advance: (ms: number) => { now += ms; } };
}

describe('TursoApiKeys', () => {
  it('a key verifies once made and stores only its hash and prefix', async () => {
    const db = await createTestDb();
    const keys = new TursoApiKeys(db, clock().now);
    const { id, key } = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'change' });

    expect(key).toMatch(/^pd_[A-Za-z0-9_-]{43}$/);
    expect(id).toMatch(/^ak_[0-9a-z]{16}$/);
    expect(await keys.verify(key)).toEqual({ id, userId: 'u_anna', name: 'n8n', level: 'change' });

    const rows = await db.select().from(apiKeys);
    expect(rows).toEqual([{
      id, userId: 'u_anna', name: 'n8n', level: 'change', keyHash: sha256(key), prefix: key.slice(0, 8),
      createdAt: '2026-11-01T08:00:00.000Z', lastUsedAt: '2026-11-01T08:00:00.000Z', revokedAt: null,
    }]);
    expect(JSON.stringify(rows)).not.toContain(key);
  });

  it('an API key made at propose verifies at propose; one made at change stays change', async () => {
    const db = await createTestDb();
    const keys = new TursoApiKeys(db, clock().now);
    const proposer = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'propose' });
    const changer = await keys.create({ userId: 'u_anna', name: 'Zapier', level: 'change' });
    expect(await keys.verify(proposer.key)).toEqual({ id: proposer.id, userId: 'u_anna', name: 'n8n', level: 'propose' });
    expect(await keys.verify(changer.key)).toEqual({ id: changer.id, userId: 'u_anna', name: 'Zapier', level: 'change' });
    expect((await keys.list('u_anna')).map((key) => [key.name, key.level]).sort()).toEqual([['Zapier', 'change'], ['n8n', 'propose']]);
  });

  it('two keys are never the same', async () => {
    const keys = new TursoApiKeys(await createTestDb());
    const a = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    const b = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    expect(a.key).not.toBe(b.key);
    expect(a.id).not.toBe(b.id);
  });

  it('an unknown key, a changed key and a key without the prefix do not verify', async () => {
    const keys = new TursoApiKeys(await createTestDb());
    const { key } = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    expect(await keys.verify(`${key.slice(0, -1)}${key.endsWith('A') ? 'B' : 'A'}`)).toBeNull();
    expect(await keys.verify(key.slice(3))).toBeNull();
    expect(await keys.verify('')).toBeNull();
  });

  it('a revoked key no longer verifies', async () => {
    const keys = new TursoApiKeys(await createTestDb());
    const { id, key } = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    expect(await keys.revoke('u_anna', id)).toBe(true);
    expect(await keys.verify(key)).toBeNull();
    // Once is enough: a second Turn off changes nothing.
    expect(await keys.revoke('u_anna', id)).toBe(false);
  });

  it('Ben can’t revoke Anna’s key', async () => {
    const keys = new TursoApiKeys(await createTestDb());
    const { id, key } = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    expect(await keys.revoke('u_ben', id)).toBe(false);
    expect(await keys.verify(key)).not.toBeNull();
  });

  it('marks the last use at most once a minute', async () => {
    const db = await createTestDb();
    const time = clock();
    const keys = new TursoApiKeys(db, time.now);
    const { key } = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    const lastUsed = async () => (await db.select({ at: apiKeys.lastUsedAt }).from(apiKeys))[0]?.at;
    expect(await lastUsed()).toBeNull();

    await keys.verify(key);
    expect(await lastUsed()).toBe('2026-11-01T08:00:00.000Z');
    time.advance(30_000);
    await keys.verify(key);
    expect(await lastUsed()).toBe('2026-11-01T08:00:00.000Z');
    time.advance(31_000);
    await keys.verify(key);
    expect(await lastUsed()).toBe('2026-11-01T08:01:01.000Z');
  });

  it('lists a person’s keys that are on, newest first, without hash or key', async () => {
    const time = clock();
    const keys = new TursoApiKeys(await createTestDb(), time.now);
    const first = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    time.advance(1000);
    const second = await keys.create({ userId: 'u_anna', name: 'Zapier', level: 'change' });
    const off = await keys.create({ userId: 'u_anna', name: 'Old', level: 'read' });
    await keys.revoke('u_anna', off.id);
    await keys.create({ userId: 'u_ben', name: 'Ben’s', level: 'read' });

    const list = await keys.list('u_anna');
    expect(list.map((k) => k.id)).toEqual([second.id, first.id]);
    expect(list[0]).toEqual({
      id: second.id, name: 'Zapier', level: 'change', prefix: second.key.slice(0, 8), createdAt: '2026-11-01T08:00:01.000Z', lastUsedAt: null,
    });
  });

  it('deleteForUser removes every key of the person, turned off or not, and only theirs', async () => {
    const db = await createTestDb();
    const keys = new TursoApiKeys(db);
    const off = await keys.create({ userId: 'u_anna', name: 'Old', level: 'read' });
    await keys.revoke('u_anna', off.id);
    await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    const ben = await keys.create({ userId: 'u_ben', name: 'n8n', level: 'read' });
    await keys.deleteForUser('u_anna');
    expect((await db.select({ id: apiKeys.id }).from(apiKeys)).map((r) => r.id)).toEqual([ben.id]);
  });

  it('a failed query names the operation only', async () => {
    const db = await createTestDb();
    const keys = new TursoApiKeys(db);
    const { key } = await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    await db.run('DROP TABLE api_keys');
    await expect(keys.verify(key)).rejects.toThrow(/^api_keys_verify_failed$/);
  });
});

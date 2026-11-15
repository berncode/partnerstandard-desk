import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { account, session, user } from './schema';
import { createTestDb } from './test-db';
import { TursoUserRecords } from './turso-users';

async function seed() {
  const db = await createTestDb();
  await db.insert(user).values([
    { id: 'u_1', name: 'Anna Keller', email: 'anna@example.com' },
    { id: 'u_10', name: 'Ben Ito', email: 'ben@example.com' },
  ]);
  await db.insert(session).values([
    { id: 's_1', token: 'tok-1', userId: 'u_1', expiresAt: new Date('2026-11-20T00:00:00.000Z') },
    { id: 's_10', token: 'tok-10', userId: 'u_10', expiresAt: new Date('2026-11-20T00:00:00.000Z') },
  ]);
  await db.insert(account).values([
    { id: 'acc_1', accountId: 'sub-1', providerId: 'google', userId: 'u_1', accessToken: 'enc-a', refreshToken: 'enc-r', scope: 'openid' },
    { id: 'acc_10', accountId: 'sub-10', providerId: 'google', userId: 'u_10', accessToken: 'enc-a10', refreshToken: 'enc-r10', scope: 'openid' },
  ]);
  return db;
}

describe('TursoUserRecords', () => {
  it('deletes one user with their sessions and accounts, and leaves everyone else', async () => {
    const db = await seed();
    const users = new TursoUserRecords(db);
    await users.deleteUser('u_1');
    await users.deleteUser('u_1');
    expect((await db.select({ id: user.id }).from(user)).map((r) => r.id)).toEqual(['u_10']);
    expect((await db.select({ id: session.id }).from(session)).map((r) => r.id)).toEqual(['s_10']);
    expect((await db.select({ id: account.id }).from(account)).map((r) => r.id)).toEqual(['acc_10']);
  });

  it('deletes nothing when one of the deletes fails, so the user can still sign in and retry', async () => {
    const db = await seed();
    await db.run(sql`CREATE TRIGGER user_delete_fails BEFORE DELETE ON user BEGIN SELECT RAISE(ABORT, 'anna@example.com'); END`);
    const error = await new TursoUserRecords(db).deleteUser('u_1').catch((e: unknown) => e);
    expect((error as Error).message).toBe('user_delete_failed');
    expect((await db.select({ id: user.id }).from(user)).map((r) => r.id).sort()).toEqual(['u_1', 'u_10']);
    expect((await db.select({ id: session.id }).from(session)).map((r) => r.id).sort()).toEqual(['s_1', 's_10']);
    expect((await db.select({ id: account.id }).from(account)).map((r) => r.id).sort()).toEqual(['acc_1', 'acc_10']);
  });
});

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { verification } from '../db/auth-schema';
import { pruneExpiredVerifications } from './verifications';

describe('pruneExpiredVerifications (plan 14)', () => {
  it('deletes the rows past their time, and keeps the rest', async () => {
    const db = await createTestDb();
    const now = new Date('2026-11-08T12:00:00.000Z');
    const row = (id: string, expiresAt: Date) => ({ id, identifier: `magic-link:${id}`, value: '{}', expiresAt, createdAt: now, updatedAt: now });
    await db.insert(verification).values([row('old', new Date('2026-11-08T11:00:00.000Z')), row('live', new Date('2026-11-08T12:10:00.000Z'))]);
    expect(await pruneExpiredVerifications(db, now)).toBe(1);
    expect(await db.all(sql`select id from verification`)).toEqual([{ id: 'live' }]);
  });
});

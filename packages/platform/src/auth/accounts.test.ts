import { describe, expect, it } from 'vitest';
import { ReconnectRequired, TokenUnavailable } from '@partner-desk/storage';
import type { Db } from '../db/client';
import { account, user } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { accountRow, accountRowForToken, refreshFailure, userContact, userDisplayName, userExists } from './accounts';

async function withAccounts(...providers: string[]) {
  const db = await createTestDb();
  await db.insert(user).values({ id: 'u_1', name: 'Anna Keller', email: 'anna@example.com' });
  for (const [i, providerId] of providers.entries()) {
    await db.insert(account).values({ id: `acc_${i}`, accountId: `sub-${i}`, providerId, userId: 'u_1', scope: 'openid' });
  }
  return db;
}

describe('accountRow', () => {
  it('finds a user’s Google account row, and nothing for other providers or users', async () => {
    expect(await accountRow(await withAccounts('google'), 'u_1')).toEqual({ id: 'acc_0', scope: 'openid' });
    expect(await accountRow(await withAccounts('credential'), 'u_1')).toBeNull();
    expect(await accountRow(await withAccounts(), 'u_1')).toBeNull();
    expect(await accountRow(await withAccounts('google'), 'u_2')).toBeNull();
  });
});

describe('userExists', () => {
  it('says whether the user is still there (a deleted account is gone)', async () => {
    const db = await withAccounts();
    expect(await userExists(db, 'u_1')).toBe(true);
    expect(await userExists(db, 'u_2')).toBe(false);
  });
});

describe('userDisplayName', () => {
  it('names the user by their name, else their email, and nobody once the account is gone', async () => {
    const db = await withAccounts();
    expect(await userDisplayName(db, 'u_1')).toBe('Anna Keller');
    await db.insert(user).values({ id: 'u_3', name: '', email: 'noname@example.com' });
    expect(await userDisplayName(db, 'u_3')).toBe('noname@example.com');
    expect(await userDisplayName(db, 'u_2')).toBeNull();
  });
});

describe('userContact', () => {
  it('gives the name and address a MAP’s emails go out with, and nothing once the account is gone', async () => {
    const db = await withAccounts();
    expect(await userContact(db, 'u_1')).toEqual({ name: 'Anna Keller', email: 'anna@example.com' });
    await db.insert(user).values({ id: 'u_3', name: '', email: 'noname@example.com' });
    expect(await userContact(db, 'u_3')).toEqual({ name: 'noname@example.com', email: 'noname@example.com' });
    expect(await userContact(db, 'u_2')).toBeNull();
  });
});

describe('the failure helpers', () => {
  it('accountRowForToken says try later when the database fails twice', async () => {
    const broken = { select: () => { throw new Error('down'); } } as unknown as Db;
    await expect(accountRowForToken(broken, 'u_1')).rejects.toBeInstanceOf(TokenUnavailable);
  });

  it('refreshFailure blames the grant when the database answers, the database when it does not', async () => {
    const db = await withAccounts('google');
    expect(await refreshFailure(db, 'u_1')).toBeInstanceOf(ReconnectRequired);
    const broken = { select: () => { throw new Error('down'); } } as unknown as Db;
    expect(await refreshFailure(broken, 'u_1')).toBeInstanceOf(TokenUnavailable);
  });
});

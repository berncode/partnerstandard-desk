import { and, eq } from 'drizzle-orm';
import { ReconnectRequired, TokenUnavailable } from '@partner-desk/storage';
import type { Db } from '../db/client';
import { account, user } from '../db/schema';

/** The user's Better Auth Google account row (id and stored scope), or null. */
export async function accountRow(db: Db, userId: string): Promise<{ id: string; scope: string | null } | null> {
  const [row] = await db.select({ id: account.id, scope: account.scope }).from(account)
    .where(and(eq(account.userId, userId), eq(account.providerId, 'google'))).limit(1);
  return row ?? null;
}

/** Whether the user is still there: a deleted account is gone, and so are the links to its cases. */
export async function userExists(db: Db, userId: string): Promise<boolean> {
  const [row] = await db.select({ id: user.id }).from(user).where(eq(user.id, userId)).limit(1);
  return row !== undefined;
}

/**
 * The name a user goes by on screen (their name, else their email), or null when the account is gone: a link holder's
 * MAP page names the person who shared it.
 */
export async function userDisplayName(db: Db, userId: string): Promise<string | null> {
  const [row] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  return row ? row.name || row.email : null;
}

/** The owner's name (else their address) and address, for the MAP's emails; null once the account is gone. */
export async function userContact(db: Db, userId: string): Promise<{ name: string; email: string } | null> {
  const [row] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, userId)).limit(1);
  return row ? { name: row.name || row.email, email: row.email } : null;
}

/** accountRow for the token provider, asked twice: one database blip must not look like a lost grant. */
export async function accountRowForToken(db: Db, userId: string): Promise<{ id: string; scope: string | null } | null> {
  try {
    return await accountRow(db, userId);
  } catch {
    try {
      return await accountRow(db, userId);
    } catch {
      throw new TokenUnavailable();
    }
  }
}

/**
 * Why Better Auth's getAccessToken failed. It hides the cause, so the database is asked again. No answer means the
 * database was the problem: try later. An answer means the refresh itself was refused: reconnect.
 */
export async function refreshFailure(db: Db, userId: string): Promise<ReconnectRequired | TokenUnavailable> {
  try {
    await accountRow(db, userId);
  } catch {
    return new TokenUnavailable();
  }
  return new ReconnectRequired();
}

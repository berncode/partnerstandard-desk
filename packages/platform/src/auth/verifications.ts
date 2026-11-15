import { lt } from 'drizzle-orm';
import type { Db } from '../db/client';
import { guarded } from '../db/guarded';
import { verification } from '../db/auth-schema';

/**
 * Deletes Better Auth's verification rows past their time: sign-in links nobody used, each holding the address it was
 * asked for (plan 14, task 4's review). Better Auth only removes a row when the same link is looked up again, which
 * never happens for an address that may not sign in. Says how many went.
 */
export async function pruneExpiredVerifications(db: Db, now: Date): Promise<number> {
  const gone = await guarded('verification_prune_failed', () => db.delete(verification).where(lt(verification.expiresAt, now)).returning({ id: verification.id }));
  return gone.length;
}

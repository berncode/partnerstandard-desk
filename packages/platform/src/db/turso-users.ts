import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { guarded } from './guarded';
import { account, session, user } from './schema';

/** The Better Auth rows the app removes itself (account deletion). */
export class TursoUserRecords {
  constructor(private readonly db: Db) {}

  /**
   * Removes the user with their sessions and accounts (and so their encrypted tokens). Idempotent. Sessions and
   * accounts go first, so nothing is left behind even where the database doesn't enforce the cascade. One batch,
   * which libSQL runs as a transaction: a user row left without its account could never sign in again, so a failure
   * must leave all three as they were.
   */
  deleteUser(userId: string): Promise<void> {
    return guarded('user_delete_failed', async () => {
      await this.db.batch([
        this.db.delete(session).where(eq(session.userId, userId)),
        this.db.delete(account).where(eq(account.userId, userId)),
        this.db.delete(user).where(eq(user.id, userId)),
      ]);
    });
  }
}

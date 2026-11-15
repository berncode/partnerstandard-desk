// Share links: owner ids, several cases at once, and the link that works now.
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { ShareLink, ShareLinks } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { shareLinks } from './schema';

/** The share_links table. Every call fails with the operation's name only: its parameters include token hashes. */
export class TursoShareLinks implements ShareLinks {
  constructor(private readonly db: Db) {}

  async create(link: ShareLink): Promise<void> {
    await guarded('share_links_create_failed', () => this.db.insert(shareLinks).values(link));
  }

  async findActive(tokenHash: string): Promise<{ ownerUserId: string; caseId: string } | null> {
    const [row] = await guarded('share_links_find_failed', () => this.db.select({ ownerUserId: shareLinks.ownerUserId, caseId: shareLinks.caseId })
      .from(shareLinks).where(and(eq(shareLinks.tokenHash, tokenHash), isNull(shareLinks.revokedAt))).limit(1));
    return row ?? null;
  }

  async revokeCases(ownerUserId: string, caseIds: string[], at: string): Promise<void> {
    if (caseIds.length === 0) return;
    await guarded('share_links_revoke_failed', () => this.db.update(shareLinks).set({ revokedAt: at })
      .where(and(eq(shareLinks.ownerUserId, ownerUserId), inArray(shareLinks.caseId, caseIds), isNull(shareLinks.revokedAt))));
  }

  /** Every link of the user, turned off or not (account deletion). */
  async deleteForOwner(userId: string): Promise<void> {
    await guarded('share_links_delete_failed', () => this.db.delete(shareLinks).where(eq(shareLinks.ownerUserId, userId)));
  }

  async activeFor(ownerUserId: string, caseId: string): Promise<{ createdAt: string } | null> {
    const [row] = await guarded('share_links_active_failed', () => this.db.select({ createdAt: shareLinks.createdAt }).from(shareLinks)
      .where(and(eq(shareLinks.ownerUserId, ownerUserId), eq(shareLinks.caseId, caseId), isNull(shareLinks.revokedAt)))
      .orderBy(desc(shareLinks.createdAt)).limit(1));
    return row ?? null;
  }
}

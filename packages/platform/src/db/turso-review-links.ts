// The review summary links (reviews spec 5.6, 7), in the shape of the business case's share links (turso-share-links.ts).
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { ReviewLink, ReviewLinks } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { reviewLinks } from './schema';

/** The review_links table. Every call fails with the operation's name only: its parameters include token hashes. */
export class TursoReviewLinks implements ReviewLinks {
  constructor(private readonly db: Db) {}

  async create(link: ReviewLink): Promise<void> {
    await guarded('review_links_create_failed', () => this.db.insert(reviewLinks).values(link));
  }

  async findActive(tokenHash: string): Promise<{ ownerUserId: string; mapId: string; reviewId: string } | null> {
    const [row] = await guarded('review_links_find_failed', () => this.db
      .select({ ownerUserId: reviewLinks.ownerUserId, mapId: reviewLinks.mapId, reviewId: reviewLinks.reviewId })
      .from(reviewLinks).where(and(eq(reviewLinks.tokenHash, tokenHash), isNull(reviewLinks.revokedAt))).limit(1));
    return row ?? null;
  }

  async revokeReview(ownerUserId: string, mapId: string, reviewId: string, at: string): Promise<void> {
    await guarded('review_links_revoke_failed', () => this.db.update(reviewLinks).set({ revokedAt: at }).where(and(
      eq(reviewLinks.ownerUserId, ownerUserId), eq(reviewLinks.mapId, mapId), eq(reviewLinks.reviewId, reviewId), isNull(reviewLinks.revokedAt),
    )));
  }

  async revokeMaps(ownerUserId: string, mapIds: string[], at: string): Promise<void> {
    if (mapIds.length === 0) return;
    await guarded('review_links_revoke_failed', () => this.db.update(reviewLinks).set({ revokedAt: at })
      .where(and(eq(reviewLinks.ownerUserId, ownerUserId), inArray(reviewLinks.mapId, mapIds), isNull(reviewLinks.revokedAt))));
  }

  /** Every link of the user, turned off or not (account deletion). */
  async deleteForOwner(userId: string): Promise<void> {
    await guarded('review_links_delete_failed', () => this.db.delete(reviewLinks).where(eq(reviewLinks.ownerUserId, userId)));
  }

  async activeFor(ownerUserId: string, mapId: string, reviewId: string): Promise<{ createdAt: string } | null> {
    const [row] = await guarded('review_links_active_failed', () => this.db.select({ createdAt: reviewLinks.createdAt }).from(reviewLinks)
      .where(and(eq(reviewLinks.ownerUserId, ownerUserId), eq(reviewLinks.mapId, mapId), eq(reviewLinks.reviewId, reviewId), isNull(reviewLinks.revokedAt)))
      .orderBy(desc(reviewLinks.createdAt)).limit(1));
    return row ?? null;
  }
}

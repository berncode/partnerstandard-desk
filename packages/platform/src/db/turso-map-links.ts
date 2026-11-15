// The MAP links: owner ids, the address kept as a hash only, sessions in their own table and class (turso-map-sessions.ts).
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { MapLink, MapLinks } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { mapLinks, mapSessions } from './schema';

/** Every column but the token hash, which never leaves this module. */
const LINK = {
  id: mapLinks.id, mapId: mapLinks.mapId, ownerUserId: mapLinks.ownerUserId, personId: mapLinks.personId, side: mapLinks.side,
  emailHash: mapLinks.emailHash, createdAt: mapLinks.createdAt, lastUsedAt: mapLinks.lastUsedAt, revokedAt: mapLinks.revokedAt,
};

/** The map_links table. Every call fails with the operation's name only: its parameters include hashes. */
export class TursoMapLinks implements MapLinks {
  constructor(private readonly db: Db) {}

  async create(link: Omit<MapLink, 'lastUsedAt' | 'revokedAt'> & { tokenHash: string }): Promise<void> {
    await guarded('map_links_create_failed', () => this.db.insert(mapLinks).values({ ...link, lastUsedAt: null, revokedAt: null }));
  }

  async get(id: string): Promise<MapLink | null> {
    const [row] = await guarded('map_links_read_failed', () => this.db.select(LINK).from(mapLinks).where(eq(mapLinks.id, id)).limit(1));
    return row ?? null;
  }

  async findByTokenHash(tokenHash: string): Promise<MapLink | null> {
    const [row] = await guarded('map_links_read_failed', () => this.db.select(LINK).from(mapLinks).where(eq(mapLinks.tokenHash, tokenHash)).limit(1));
    return row ?? null;
  }

  async listForMap(mapId: string): Promise<MapLink[]> {
    return guarded('map_links_list_failed', () => this.db.select(LINK).from(mapLinks).where(eq(mapLinks.mapId, mapId))
      .orderBy(asc(mapLinks.createdAt), asc(mapLinks.id)));
  }

  async touch(id: string, at: string): Promise<void> {
    await guarded('map_links_touch_failed', () => this.db.update(mapLinks).set({ lastUsedAt: at }).where(eq(mapLinks.id, id)));
  }

  async revokePerson(mapId: string, personId: string, at: string): Promise<number> {
    const revoked = await guarded('map_links_revoke_failed', () => this.db.update(mapLinks).set({ revokedAt: at })
      .where(and(eq(mapLinks.mapId, mapId), eq(mapLinks.personId, personId), isNull(mapLinks.revokedAt)))
      .returning({ id: mapLinks.id }));
    return revoked.length;
  }

  async revokeMaps(mapIds: string[], at: string): Promise<void> {
    if (mapIds.length === 0) return;
    await guarded('map_links_revoke_failed', () => this.db.update(mapLinks).set({ revokedAt: at })
      .where(and(inArray(mapLinks.mapId, mapIds), isNull(mapLinks.revokedAt))));
  }

  /** Account deletion: the user's links and, first, their sessions (a session whose link is gone could never be found). */
  async deleteForOwner(userId: string): Promise<void> {
    await guarded('map_links_delete_failed', async () => {
      const owned = this.db.select({ id: mapLinks.id }).from(mapLinks).where(eq(mapLinks.ownerUserId, userId));
      await this.db.delete(mapSessions).where(inArray(mapSessions.linkId, owned));
      await this.db.delete(mapLinks).where(eq(mapLinks.ownerUserId, userId));
    });
  }
}

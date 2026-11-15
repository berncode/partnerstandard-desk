// The MAP link sessions: their own id, the token's hash in its own column, and the MAP's id for ending a MAP's sessions.
import { eq, inArray, lt } from 'drizzle-orm';
import type { MapSession, MapSessions } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { mapSessions } from './schema';

const SESSION = { id: mapSessions.id, linkId: mapSessions.linkId, mapId: mapSessions.mapId, expiresAt: mapSessions.expiresAt };

/** The map_sessions table. Every call fails with the operation's name only: its parameters include token hashes. */
export class TursoMapSessions implements MapSessions {
  constructor(private readonly db: Db) {}

  async create(session: MapSession & { tokenHash: string }): Promise<void> {
    await guarded('map_sessions_create_failed', () => this.db.insert(mapSessions).values(session));
  }

  async findByTokenHash(tokenHash: string): Promise<MapSession | null> {
    const [row] = await guarded('map_sessions_read_failed', () => this.db.select(SESSION).from(mapSessions)
      .where(eq(mapSessions.tokenHash, tokenHash)).limit(1));
    return row ?? null;
  }

  async extend(id: string, expiresAt: string): Promise<void> {
    await guarded('map_sessions_extend_failed', () => this.db.update(mapSessions).set({ expiresAt }).where(eq(mapSessions.id, id)));
  }

  async delete(id: string): Promise<void> {
    await guarded('map_sessions_delete_failed', () => this.db.delete(mapSessions).where(eq(mapSessions.id, id)));
  }

  async deleteForMaps(mapIds: string[]): Promise<void> {
    if (mapIds.length === 0) return;
    await guarded('map_sessions_delete_failed', () => this.db.delete(mapSessions).where(inArray(mapSessions.mapId, mapIds)));
  }

  async deleteExpired(now: string): Promise<number> {
    const deleted = await guarded('map_sessions_prune_failed', () => this.db.delete(mapSessions).where(lt(mapSessions.expiresAt, now))
      .returning({ id: mapSessions.id }));
    return deleted.length;
  }
}

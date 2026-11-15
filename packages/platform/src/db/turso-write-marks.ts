import { eq, inArray, lt, sql } from 'drizzle-orm';
import type { Db } from './client';
import { guarded } from './guarded';
import { fileWrites } from './schema';

/** When each file was last written by us, so a read can tell it may be looking at a stale copy. */
export class TursoWriteMarks {
  constructor(private readonly db: Db) {}

  async mark(fileId: string, atMs: number): Promise<void> {
    await this.db.insert(fileWrites).values({ fileId, writtenAt: atMs }).onConflictDoUpdate({
      target: fileWrites.fileId,
      set: { writtenAt: sql`max(${fileWrites.writtenAt}, excluded.written_at)` },
    });
  }

  async latest(fileId: string): Promise<number | null> {
    const rows = await this.db.select({ writtenAt: fileWrites.writtenAt }).from(fileWrites).where(eq(fileWrites.fileId, fileId));
    return rows[0]?.writtenAt ?? null;
  }

  /** Forgets these files' marks (account deletion). */
  async deleteForFiles(fileIds: readonly string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await guarded('file_writes_delete_failed', () => this.db.delete(fileWrites).where(inArray(fileWrites.fileId, [...fileIds])));
  }

  prune(beforeMs: number): Promise<number> {
    return guarded('file_writes_prune_failed', async () => {
      const deleted = await this.db.delete(fileWrites).where(lt(fileWrites.writtenAt, beforeMs)).returning({ fileId: fileWrites.fileId });
      return deleted.length;
    });
  }
}

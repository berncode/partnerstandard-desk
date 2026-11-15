import { eq } from 'drizzle-orm';
import type { Db } from './client';
import { guarded } from './guarded';
import { storageFolders } from './schema';

/** The Drive folder id of each user, one provider only. */
export class TursoFolderStore {
  constructor(private readonly db: Db) {}

  async get(userId: string): Promise<string | null> {
    const [row] = await this.db.select({ folderId: storageFolders.folderId }).from(storageFolders).where(eq(storageFolders.userId, userId)).limit(1);
    return row?.folderId ?? null;
  }

  async set(userId: string, folderId: string): Promise<void> {
    await this.db.insert(storageFolders).values({ userId, folderId }).onConflictDoUpdate({ target: storageFolders.userId, set: { folderId } });
  }

  /** Account deletion: forgets this user's folder id. The folder in Drive stays. */
  async delete(userId: string): Promise<void> {
    await guarded('storage_folders_delete_failed', () => this.db.delete(storageFolders).where(eq(storageFolders.userId, userId)));
  }
}

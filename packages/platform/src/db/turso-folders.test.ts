import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { storageFolders } from './schema';
import { createTestDb } from './test-db';
import { TursoFolderStore } from './turso-folders';

describe('TursoFolderStore', () => {
  it('remembers one folder per user', async () => {
    const folders = new TursoFolderStore(await createTestDb());
    expect(await folders.get('u_1')).toBeNull();
    await folders.set('u_1', 'folder-a');
    await folders.set('u_1', 'folder-b');
    expect(await folders.get('u_1')).toBe('folder-b');
    expect(await folders.get('u_2')).toBeNull();
  });

  it('forgets one user’s folder, and only theirs', async () => {
    const db = await createTestDb();
    const folders = new TursoFolderStore(db);
    await folders.set('u_1', 'g-1');
    await folders.set('u_10', 'g-10');
    await folders.delete('u_1');
    await folders.delete('u_1');
    expect(await folders.get('u_1')).toBeNull();
    expect(await folders.get('u_10')).toBe('g-10');
    expect(await db.select().from(storageFolders)).toHaveLength(1);
  });

  it('fails a delete with an error that names the operation only', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE storage_folders`);
    const error = await new TursoFolderStore(db).delete('u_secret').catch((e: unknown) => e);
    expect((error as Error).message).toBe('storage_folders_delete_failed');
  });
});

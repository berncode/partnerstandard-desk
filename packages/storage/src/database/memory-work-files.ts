import type { WorkFileRow, WorkFiles, WorkFileWrite } from './work-files';

/** The `work_files` port in memory: for storage's own tests. The app uses the SQLite one (packages/platform). */
export class MemoryWorkFiles implements WorkFiles {
  private readonly rows = new Map<string, WorkFileRow>();

  async create(row: Omit<WorkFileRow, 'trashedAt' | 'revision'>): Promise<void> {
    if (this.rows.has(row.id)) throw new Error('work_file_create_failed');
    this.rows.set(row.id, { ...row, revision: 0, trashedAt: null });
  }

  async read(id: string): Promise<WorkFileRow | null> {
    const row = this.rows.get(id);
    return row ? { ...row } : null;
  }

  async write(id: string, revision: number, next: WorkFileWrite): Promise<boolean> {
    const row = this.rows.get(id);
    if (!row || row.trashedAt !== null || row.revision !== revision) return false;
    // The same three fields the SQLite port sets, and nothing else a caller's object may carry.
    this.rows.set(id, { ...row, body: next.body, formatVersion: next.formatVersion, updatedAt: next.updatedAt, revision: revision + 1 });
    return true;
  }

  async trash(id: string, at: string): Promise<void> {
    const row = this.rows.get(id);
    if (row && row.trashedAt === null) this.rows.set(id, { ...row, trashedAt: at });
  }

  async restore(id: string): Promise<void> {
    const row = this.rows.get(id);
    if (row) this.rows.set(id, { ...row, trashedAt: null });
  }
}

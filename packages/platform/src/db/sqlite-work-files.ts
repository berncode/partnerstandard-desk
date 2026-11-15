import { and, desc, eq, inArray, isNotNull, isNull, type SQL } from 'drizzle-orm';
import type { Trash, TrashedFile } from '@partner-desk/commands';
import { readTrashed, TRASH_KINDS, type TrashKind, type WorkFileRow, type WorkFiles, type WorkFileWrite } from '@partner-desk/storage';
import type { Db } from './client';
import { guarded } from './guarded';
import { events, workFiles } from './schema';

/**
 * The self-hosted edition's files in its own SQLite database (plan 13, task 5). Every call is one statement, never a
 * transaction (the driver is synchronous). Every call is `guarded`: the driver's error carries the
 * query's values, here a file's whole content, which must never reach a log.
 */
export class SqliteWorkFiles implements WorkFiles {
  constructor(private readonly db: Db) {}

  async create(row: Omit<WorkFileRow, 'trashedAt' | 'revision'>): Promise<void> {
    await guarded('work_file_create_failed', () => this.db.insert(workFiles).values({ ...row, revision: 0, trashedAt: null }));
  }

  async read(id: string): Promise<WorkFileRow | null> {
    const [row] = await guarded('work_file_read_failed', () => this.db.select().from(workFiles).where(eq(workFiles.id, id)).limit(1));
    return row ?? null;
  }

  async write(id: string, revision: number, next: WorkFileWrite): Promise<boolean> {
    const result = await guarded('work_file_write_failed', () => this.db.update(workFiles)
      .set({ body: next.body, formatVersion: next.formatVersion, updatedAt: next.updatedAt, revision: revision + 1 })
      .where(and(eq(workFiles.id, id), eq(workFiles.revision, revision), isNull(workFiles.trashedAt))));
    return result.rowsAffected === 1;
  }

  async trash(id: string, at: string): Promise<void> {
    await guarded('work_file_trash_failed', () => this.db.update(workFiles).set({ trashedAt: at })
      .where(and(eq(workFiles.id, id), isNull(workFiles.trashedAt))));
  }

  async restore(id: string): Promise<void> {
    await guarded('work_file_restore_failed', () => this.db.update(workFiles).set({ trashedAt: null }).where(eq(workFiles.id, id)));
  }
}

/**
 * The ids of a company's files of one kind that are in the trash, oldest first. Only ids: never a body. For the e2e
 * test seed.
 */
export async function trashedWorkFileIds(db: Db, kind: WorkFileRow['kind'], companyId: string): Promise<string[]> {
  const rows = await guarded('work_file_list_failed', () => db.select({ id: workFiles.id }).from(workFiles)
    .where(and(eq(workFiles.kind, kind), eq(workFiles.companyId, companyId), isNotNull(workFiles.trashedAt)))
    .orderBy(workFiles.trashedAt));
  return rows.map((row) => row.id);
}


/** The commands whose event names a deleted item's file: the trash lists only what a person deleted. */
const DELETES = ['cases.delete', 'maps.delete', 'programs.delete'] as const;

type TrashRow = { id: string; kind: string; body: string; trashedAt: string | null; createdAt: string };

/**
 * A company's trash on a company server (plan 16): its cases, MAPs and programs a person deleted, each body read for
 * what it is, with the id it had (from its delete's event). Never a Partners or Company facts file (one per company:
 * restoring one would make two), never a market (archived, not trashed), never a file trashed after a failed create
 * (no delete names it). Another company's files are never listed or restored here.
 */
export class SqliteTrash implements Trash {
  constructor(private readonly db: Db) {}

  async list(companyId: string): Promise<TrashedFile[]> {
    return this.withFormerIds(await guarded('trash_list_failed', () => this.trashedRows(eq(workFiles.companyId, companyId))));
  }

  async get(companyId: string, fileId: string): Promise<TrashedFile | null> {
    const rows = await guarded('trash_list_failed', () => this.trashedRows(and(eq(workFiles.companyId, companyId), eq(workFiles.id, fileId))!));
    return (await this.withFormerIds(rows))[0] ?? null;
  }

  /** One statement: only the restore that finds it still trashed as it was takes it out. */
  async restore(fileId: string, trashedAt: string): Promise<boolean> {
    const done = await guarded('work_file_restore_failed', () => this.db.update(workFiles).set({ trashedAt: null })
      .where(and(eq(workFiles.id, fileId), eq(workFiles.trashedAt, trashedAt))).returning({ id: workFiles.id }));
    return done.length > 0;
  }

  trash(fileId: string, at: string): Promise<void> {
    return new SqliteWorkFiles(this.db).trash(fileId, at);
  }

  private trashedRows(where: SQL): Promise<TrashRow[]> {
    return this.db.select({
      id: workFiles.id, kind: workFiles.kind, body: workFiles.body, trashedAt: workFiles.trashedAt, createdAt: workFiles.createdAt,
    }).from(workFiles).where(and(where, isNotNull(workFiles.trashedAt), inArray(workFiles.kind, [...TRASH_KINDS])))
      .orderBy(desc(workFiles.trashedAt), desc(workFiles.id));
  }

  /** Each row with the id its latest delete named; a row no delete names is left out. */
  private async withFormerIds(rows: TrashRow[]): Promise<TrashedFile[]> {
    if (rows.length === 0) return [];
    const deletes = await guarded('trash_list_failed', () => this.db.select({ fileId: events.fileId, entityIds: events.entityIds, at: events.at })
      .from(events).where(and(inArray(events.fileId, rows.map((r) => r.id)), inArray(events.command, [...DELETES])))
      .orderBy(desc(events.at)));
    const formerIds = new Map<string, string>();
    for (const d of deletes) if (!formerIds.has(d.fileId)) formerIds.set(d.fileId, d.entityIds.split(',')[0] ?? '');
    return rows.flatMap((row) => {
      const formerId = formerIds.get(row.id);
      if (!formerId) return [];
      const kind = row.kind as TrashKind;
      return [{ fileId: row.id, kind, trashedAt: row.trashedAt ?? '', createdAt: row.createdAt, formerId, content: readTrashed(kind, row.body) }];
    });
  }
}

// The database edition's row-by-row store (plan 13, task 6): the same workbook the Google adapter keeps in Sheets, as
// JSON in one `work_files` row, planned by the same shared planner (`../workbook/writer`). A save reads the row with
// its revision, plans in memory, and writes with one statement that lands only at that revision; when someone saved in
// between, it reads and plans again. No transaction is held across an await. The app runs saves
// to one file one at a time through `serializeApplies`, as for every store.
import type { ChangeStamp } from '@partner-desk/core';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import type { Cell, Workbook } from '../sheet-codec/grid';
import { CURRENT_SCHEMA_VERSIONS } from '../sheet-codec/version';
import type { ApplyManyResult, ApplyResult, CreatedFile, FileRef, ReadResult, StoreError } from '../types';
import { applyWrites, decodeFailure, planChanges, type ChangesPlan, type RowWrite, type WorkbookSpec } from '../workbook/writer';
import { newWorkFileId, WORK_FILE_ID, type WorkFileKind, type WorkFileRow, type WorkFiles } from './work-files';

export interface DatabaseStoreOptions {
  files: WorkFiles;
  /** Where the app runs (APP_URL), for the link on the Start here tab and the download address. Required: a self-hosted
   * file must never link to the hosted app. */
  appBaseUrl: string;
  /** The time a new file is made at. Saves use their stamp's time. */
  clock?: () => string;
  /** The id a new file gets. Tests pass their own. */
  newId?: () => string;
}

/** Saves a revision clash plans again this many times before it answers `conflict`. */
export const SAVE_ATTEMPTS = 5;

export const FILE_NOT_FOUND: StoreError = { ok: false, error: 'file_not_found', message: COPY.FILE_GONE };
export const DATABASE_UNAVAILABLE: StoreError = { ok: false, error: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE };
export const FILE_DAMAGED: StoreError & { tab: string } = { ok: false, error: 'structure', message: COPY.DB_FILE_DAMAGED, tab: '' };
export const CLASHED: StoreError = { ok: false, error: 'conflict', message: COPY.SHEET_CHANGED_MESSAGE };

/** A cell as the codec holds one: text, a number, true or false, or empty. */
const isCell = (value: unknown): value is Cell =>
  value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));

/** The row's body as a workbook, or null when it isn't one (a disk or backup problem: never written over). */
export function parseBody(body: string): Workbook | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  for (const grid of Object.values(parsed)) {
    if (!Array.isArray(grid) || !grid.every((row) => Array.isArray(row) && row.every(isCell))) return null;
  }
  return parsed as Workbook;
}

/** The address that opens a database file: its spreadsheet download (task 12), never a Drive link. */
export const downloadUrl = (appBaseUrl: string, fileId: string) => `${appBaseUrl}/files/${fileId}/download`;

export type LoadedFile = { ok: true; row: WorkFileRow; wb: Workbook } | StoreError;

/**
 * A database file of `kind`, read for a read or a save: gone when there is no row, it is trashed or it is another kind;
 * damaged when its body isn't a workbook; `unavailable` when the database failed. Shared by both kinds of store.
 */
export async function loadWorkFile(files: WorkFiles, kind: WorkFileKind, fileId: string): Promise<LoadedFile> {
  if (!WORK_FILE_ID.test(fileId)) return FILE_NOT_FOUND;
  let row: WorkFileRow | null;
  try {
    row = await files.read(fileId);
  } catch {
    return DATABASE_UNAVAILABLE;
  }
  if (!row || row.trashedAt !== null || row.kind !== kind) return FILE_NOT_FOUND;
  const wb = parseBody(row.body);
  return wb ? { ok: true, row, wb } : FILE_DAMAGED;
}

/** Sets a file's trashed time; the row and its body stay. Best effort: never throws, as on Drive. */
export async function trashWorkFile(files: WorkFiles, fileId: string, clock: () => string): Promise<void> {
  if (!WORK_FILE_ID.test(fileId)) return;
  try {
    await files.trash(fileId, clock());
  } catch {
    // Best effort: the caller's work stands.
  }
}

export class DatabaseWorkbookStore<T, C, E extends string> {
  protected readonly files: WorkFiles;
  protected readonly appBaseUrl: string;
  private readonly clock: () => string;
  private readonly makeId: () => string;

  constructor(private readonly spec: WorkbookSpec<T, C, E>, private readonly kind: WorkFileKind, options: DatabaseStoreOptions) {
    this.files = options.files;
    this.appBaseUrl = options.appBaseUrl.replace(/\/+$/, '');
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.makeId = options.newId ?? (() => newWorkFileId());
  }

  urlFor(ref: FileRef): string {
    return downloadUrl(this.appBaseUrl, ref.fileId);
  }

  /**
   * Makes the file holding `wb`, at this kind's current format version. A failure throws `StoreFailure('unavailable')`,
   * as the Google store's create does: the commands treat anything else as a bug.
   */
  protected async createFile(companyId: string, wb: Workbook): Promise<CreatedFile> {
    try {
      const id = this.makeId();
      const now = this.clock();
      await this.files.create({ id, kind: this.kind, companyId, formatVersion: CURRENT_SCHEMA_VERSIONS[this.kind], body: JSON.stringify(wb), createdAt: now, updatedAt: now });
      return { fileId: id, fileUrl: this.urlFor({ fileId: id }) };
    } catch {
      throw new StoreFailure('unavailable', COPY.DB_UNAVAILABLE_MESSAGE);
    }
  }

  async read(ref: FileRef): Promise<ReadResult<T>> {
    const loaded = await this.load(ref);
    return loaded.ok ? this.snapshot(loaded.wb) : loaded;
  }

  async apply(ref: FileRef, change: C, stamp: ChangeStamp): Promise<ApplyResult<T>> {
    // One change keeps a provisional id, as on Google. A batch (an import) replaces those ids with new ones.
    const result = await this.write(ref, stamp, (wb) => planChanges(this.spec, wb, [change], stamp, (_entity, provisional) => provisional));
    if (result.ok) return { ok: true, snapshot: result.snapshot, entityId: result.entityIds[0] ?? null };
    const { error, message, tab, fieldErrors } = result;
    return { ok: false, error, message, ...(tab === undefined ? {} : { tab }), ...(fieldErrors === undefined ? {} : { fieldErrors }) };
  }

  async applyMany(ref: FileRef, changes: C[], stamp: ChangeStamp): Promise<ApplyManyResult<T>> {
    return this.write(ref, stamp, (wb) => planChanges(this.spec, wb, changes, stamp));
  }

  /** Throws away a file this app just made: to the trash, as every delete (nothing is deleted for good). Never throws. */
  async discard(ref: FileRef): Promise<void> {
    await this.moveToTrash(ref);
  }

  /** Sets the file's trashed time; the row and its body stay. Best effort: never throws. */
  protected moveToTrash(ref: FileRef): Promise<void> {
    return trashWorkFile(this.files, ref.fileId, this.clock);
  }

  private load(ref: FileRef): Promise<LoadedFile> {
    return loadWorkFile(this.files, this.kind, ref.fileId);
  }

  /**
   * A tab an upgrade's writes add whose name another tab has in other letters: refused, naming that tab, as the Google
   * store does. Sheets and Excel take such names as one, so the body must never hold both: its download (task 12)
   * would be a spreadsheet no tool opens. Nothing is written.
   */
  private nameTaken(wb: Workbook, writes: RowWrite[]): StoreError | null {
    const { layout } = this.spec;
    for (const tab of new Set(writes.map((w) => w.tab))) {
      if (Object.hasOwn(wb, tab) || !layout.entityOrder.some((e) => layout.tabs[e] === tab)) continue;
      const theirs = Object.keys(wb).find((title) => title.toLowerCase() === tab.toLowerCase());
      if (theirs !== undefined) return { ok: false, error: 'structure', message: SHEET_COPY.ISSUES.TAB_NAME_TAKEN(theirs, tab), tab: theirs };
    }
    return null;
  }

  private snapshot(wb: Workbook): ReadResult<T> {
    const decoded = this.spec.decode(wb);
    if (!decoded.ok) return decodeFailure(decoded.error);
    return { ok: true, snapshot: { value: decoded.value.value, issues: decoded.value.issues } };
  }

  /**
   * Reads the row, plans against it (the planner upgrades an older file first), applies the writes in memory and
   * writes the body at the revision read. A clash reads and plans again; a refusal or a file that can't be read writes
   * nothing.
   */
  private async write(ref: FileRef, stamp: ChangeStamp, plan: (wb: Workbook) => ChangesPlan<T, E>): Promise<ApplyManyResult<T>> {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const loaded = await this.load(ref);
      if (!loaded.ok) return loaded;
      const planned = plan(loaded.wb);
      if (!planned.ok) return planned;
      const taken = this.nameTaken(loaded.wb, planned.writes);
      if (taken) return taken;
      // The plan and its writes are made from the same body in memory, so a throw here is a planner bug: it goes up, as
      // on Google, and nothing is written.
      const next = applyWrites(loaded.wb, planned.writes);
      let wrote: boolean;
      try {
        wrote = await this.files.write(ref.fileId, loaded.row.revision, {
          body: JSON.stringify(next), formatVersion: CURRENT_SCHEMA_VERSIONS[this.kind], updatedAt: stamp.now,
        });
      } catch {
        return DATABASE_UNAVAILABLE;
      }
      if (!wrote) continue;
      const read = this.snapshot(next);
      return read.ok ? { ok: true, snapshot: read.snapshot, entityIds: planned.entityIds } : read;
    }
    return CLASHED;
  }
}

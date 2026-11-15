// The database edition's whole-file store (plan 13, task 7): a Company facts, program or business case workbook as
// JSON in one `work_files` row, read and saved with the same shared spec as on Google (`../workbook/file-specs`). A
// save reads the row with its revision, checks the save (`planSave`: a stale copy, a changed file, a record that isn't
// valid), applies its row writes to the tabs the file is read from, and writes the body at that revision; the other
// tabs (the Program Sheet, the Public page, anything else) are kept as they are. A clash reads and checks again.
import type { ChangeStamp, IsoDateTime } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import type { Workbook } from '../sheet-codec/grid';
import { applyRowWrites, type Grids } from '../sheet-codec/program-layout';
import { CURRENT_SCHEMA_VERSIONS } from '../sheet-codec/version';
import type { ApplyManyResult, ApplyResult, CreatedFile, FileRef, ReadResult } from '../types';
import { oneSave, planSave } from '../whole-save';
import type { FileSpec } from '../workbook/file-specs';
import { newWorkFileId, type WorkFileKind, type WorkFiles } from './work-files';
import {
  CLASHED, DATABASE_UNAVAILABLE, downloadUrl, loadWorkFile, SAVE_ATTEMPTS, trashWorkFile, type DatabaseStoreOptions, type LoadedFile,
} from './workbook-store';

/** The tabs a file is read from, as Google would load them: only those it has. */
export function readTabsOf(wb: Workbook, readTabs: readonly string[]): Grids {
  return Object.fromEntries(readTabs.filter((tab) => Object.hasOwn(wb, tab)).map((tab) => [tab, wb[tab]!]));
}

export class DatabaseSettingsFileStore<T extends { id: string; updatedAt: string }, C> {
  protected readonly files: WorkFiles;
  protected readonly appBaseUrl: string;
  private readonly clock: () => IsoDateTime;
  private readonly makeId: () => string;

  constructor(private readonly spec: FileSpec<T, C>, private readonly kind: WorkFileKind, options: DatabaseStoreOptions) {
    this.files = options.files;
    this.appBaseUrl = options.appBaseUrl.replace(/\/+$/, '');
    this.clock = options.clock ?? (() => new Date().toISOString());
    this.makeId = options.newId ?? (() => newWorkFileId());
  }

  urlFor(ref: FileRef): string {
    return downloadUrl(this.appBaseUrl, ref.fileId);
  }

  protected now(): IsoDateTime {
    return this.clock();
  }

  /**
   * Makes the file holding `grids`, after the same check as Google (a record that isn't valid is refused, nothing made).
   * A database failure throws `StoreFailure('unavailable')`, as the Google store's create does.
   */
  protected async createFile(companyId: string, value: T, grids: Workbook): Promise<CreatedFile> {
    const parsed = this.spec.save.parse(value);
    if (!parsed.ok) throw new StoreFailure('invalid', parsed.issues[0]?.message ?? COPY.FIX_FIELDS);
    try {
      const id = this.makeId();
      const now = this.clock();
      await this.files.create({ id, kind: this.kind, companyId, formatVersion: CURRENT_SCHEMA_VERSIONS[this.kind], body: JSON.stringify(grids), createdAt: now, updatedAt: now });
      return { fileId: id, fileUrl: this.urlFor({ fileId: id }) };
    } catch {
      throw new StoreFailure('unavailable', COPY.DB_UNAVAILABLE_MESSAGE);
    }
  }

  async read(ref: FileRef): Promise<ReadResult<T>> {
    const loaded = await this.load(ref);
    if (!loaded.ok) return loaded;
    const book = this.spec.read(readTabsOf(loaded.wb, this.spec.readTabs));
    return book.ok ? { ok: true, snapshot: { value: book.value, issues: book.issues } } : book;
  }

  async apply(ref: FileRef, change: C, stamp: ChangeStamp): Promise<ApplyResult<T>> {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const loaded = await this.load(ref);
      if (!loaded.ok) return loaded;
      const book = this.spec.read(readTabsOf(loaded.wb, this.spec.readTabs));
      if (!book.ok) return book;
      const planned = planSave(this.spec.save, book.value, change, stamp);
      if (!planned.ok) return planned;
      const written = applyRowWrites(readTabsOf(loaded.wb, this.spec.readTabs), book.writes(planned.value));
      // The data tabs as written, every other tab as it was.
      const next: Workbook = { ...loaded.wb, ...(written as Workbook) };
      let wrote: boolean;
      try {
        wrote = await this.files.write(ref.fileId, loaded.row.revision, {
          body: JSON.stringify(next), formatVersion: CURRENT_SCHEMA_VERSIONS[this.kind], updatedAt: stamp.now,
        });
      } catch {
        return DATABASE_UNAVAILABLE;
      }
      if (!wrote) continue;
      const after = this.spec.read(readTabsOf(next, this.spec.readTabs));
      return after.ok ? { ok: true, snapshot: { value: after.value, issues: after.issues }, entityId: null } : after;
    }
    return CLASHED;
  }

  /** At most one save, as on Google: a batch of whole-record saves means nothing. None reads the file. */
  async applyMany(ref: FileRef, changes: C[], stamp: ChangeStamp): Promise<ApplyManyResult<T>> {
    const batch = oneSave(changes);
    if (!batch.ok) return { ...batch, valid: 0 };
    if (batch.change === null) {
      const read = await this.read(ref);
      return read.ok ? { ok: true, snapshot: read.snapshot, entityIds: [] } : read;
    }
    const result = await this.apply(ref, batch.change, stamp);
    return result.ok ? { ok: true, snapshot: result.snapshot, entityIds: [null] } : { ...result, valid: 0 };
  }

  /** Throws away a file this app just made: to the trash, as every delete. Never throws. */
  async discard(ref: FileRef): Promise<void> {
    await this.moveToTrash(ref);
  }

  protected moveToTrash(ref: FileRef): Promise<void> {
    return trashWorkFile(this.files, ref.fileId, this.clock);
  }

  protected load(ref: FileRef): Promise<LoadedFile> {
    return loadWorkFile(this.files, this.kind, ref.fileId);
  }
}

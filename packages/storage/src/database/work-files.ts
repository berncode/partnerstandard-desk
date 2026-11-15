// The database edition's files (plan 13, spec 2026-11-07 §6.1): one row per file, holding the same workbook the sheet
// codec makes for Google Drive, as JSON. Storage talks to the table only through this port; packages/platform
// implements it with Drizzle, as the Google adapter's folders go through FolderStore.
import type { WorkbookKind } from '../sheet-codec/version';

export type WorkFileKind = WorkbookKind;

export interface WorkFileRow {
  id: string;
  kind: WorkFileKind;
  companyId: string;
  /** The same format versions as the Drive files (`CURRENT_SCHEMA_VERSIONS`). */
  formatVersion: number;
  /** Goes up by one on every save: a save writes only if nobody saved since it read (spec §6.2). */
  revision: number;
  /** The workbook as JSON: tab name to rows of cells. */
  body: string;
  createdAt: string;
  updatedAt: string;
  /** Set when the file is deleted; the row stays (deleting means trash). */
  trashedAt: string | null;
}

export interface WorkFileWrite {
  body: string;
  formatVersion: number;
  updatedAt: string;
}

export interface WorkFiles {
  /** A new file at revision 0. */
  create(row: Omit<WorkFileRow, 'trashedAt' | 'revision'>): Promise<void>;
  /** The row, trashed or not; null when there is none. */
  read(id: string): Promise<WorkFileRow | null>;
  /**
   * One statement: writes the body if the row is there, not trashed, and still at `revision`; the revision goes up by
   * one. False when it wasn't written (someone saved in between, or the row is gone or trashed). Never a transaction:
   * the driver is synchronous, and a held lock freezes the process.
   */
  write(id: string, revision: number, next: WorkFileWrite): Promise<boolean>;
  /** Sets `trashedAt`; the row and its body stay. A missing or already trashed row is left as it is. */
  trash(id: string, at: string): Promise<void>;
  /** Clears `trashedAt`. A missing row is left as it is. */
  restore(id: string): Promise<void>;
}

/**
 * A new file id: `wf_` and the first 20 hex characters of a random UUID (about 74 random bits: two of a UUID's characters
 * are fixed), URL-safe, so it fits wherever a Drive file id goes today.
 */
export function newWorkFileId(random: () => string = () => crypto.randomUUID()): string {
  const hex = random().replaceAll('-', '').slice(0, 20);
  if (!/^[0-9a-f]{20}$/.test(hex)) throw new Error('work_file_id_failed');
  return `wf_${hex}`;
}

export const WORK_FILE_ID = /^wf_[a-z0-9]{20}$/;

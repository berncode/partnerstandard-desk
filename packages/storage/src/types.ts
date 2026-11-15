import type {
  BusinessCase, ChangeStamp, CompanyFacts, MapChange, MapPlan, MapRecord, Market, MarketChange, PartnerBook, PartnerChange, Program,
  SheetContent,
} from '@partner-desk/core';
import type { ExclusiveScope } from './serialize';

export interface OwnerContext {
  userId: string;
  displayName: string;
}

export interface FileRef {
  fileId: string;
}

export interface CreatedFile {
  fileId: string;
  fileUrl: string;
}

/** A row that could not be read. Ids and positions only, never the row's content. */
export type RowIssue = { tab: string; row: number; message: string };

export interface Snapshot<T> {
  value: T;
  issues: RowIssue[];
}

export type StoreErrorCode =
  | 'file_not_found' | 'structure' | 'not_found' | 'invalid' | 'conflict' | 'forbidden'
  /** The owner's Google account must be reconnected (refresh token revoked or expired). */
  | 'auth'
  /** The owner's Google Drive is full. They can free space outside the app, then try again. */
  | 'quota'
  /** Google kept failing (429/5xx) after retries, or another save held the file too long. */
  | 'unavailable'
  /**
   * A Partners file made by an earlier format version (version 1, before partner accounts). It is not read or upgraded:
   * the app offers a new file and moves this one to the trash (`PartnerBookStore.trash`).
   */
  | 'old_version';

/** Carries ids and codes only. `message` comes from COPY. */
export interface StoreError {
  ok: false;
  error: StoreErrorCode;
  message: string;
  tab?: string;
  fieldErrors?: Record<string, string>;
}

export type ReadResult<T> = { ok: true; snapshot: Snapshot<T> } | StoreError;
export type ApplyResult<T> = { ok: true; snapshot: Snapshot<T>; entityId: string | null } | StoreError;
export type ApplyManyResult<T> =
  | { ok: true; snapshot: Snapshot<T>; entityIds: Array<string | null> }
  /** `valid`: when a change was refused, how many came before it. */
  | (StoreError & { valid?: number });

/** One file per aggregate. The same shape for the Partner book and the Market. */
export interface FileStore<T, C> {
  read(ref: FileRef): Promise<ReadResult<T>>;
  /** The link that opens the file. */
  urlFor(ref: FileRef): string;
  /** Applies one change to the file as it is now. The conflict check compares the change's `expectedUpdatedAt` with the row's. */
  apply(ref: FileRef, change: C, stamp: ChangeStamp): Promise<ApplyResult<T>>;
  /** Applies a batch (an import) as one write, all or nothing. When any change is refused, nothing is written. */
  applyMany(ref: FileRef, changes: C[], stamp: ChangeStamp): Promise<ApplyManyResult<T>>;
  /** Throws away a file this app just made. Best effort: never throws, including for a file that is already gone. */
  discard(ref: FileRef): Promise<void>;
}

export interface PartnerBookStore extends FileStore<PartnerBook, PartnerChange> {
  create(owner: OwnerContext, companyId: string): Promise<CreatedFile>;
  /**
   * Moves a Partners file to the person's Drive trash, where they can still restore it (an old file the app replaced).
   * Never deletes for good. Best effort: never throws, including for a file that is already gone.
   */
  trash(ref: FileRef): Promise<void>;
  /**
   * Runs `work` while no other `exclusive` of this file and `scope` runs, on any instance: `serializeApplies` holds the
   * file lock under the key `<fileId>:<scope>`. The file's own applies keep their own key, so `work` may read and write
   * the file. Not had within the lock's wait: `unavailable`, and `work` doesn't run. A store not wrapped has none; the
   * caller then runs `work` itself. For a read, a check and a write that must not interleave (agent proposals: one
   * waiting per target, kind and agent).
   */
  exclusive?<R>(ref: FileRef, scope: ExclusiveScope, work: () => Promise<R>): Promise<R | StoreError>;
}

export interface MarketStore extends FileStore<Market, MarketChange> {
  create(owner: OwnerContext, market: Market): Promise<CreatedFile>;
}

/**
 * A program is saved whole (Program Designer's way: its lists are short and edited together). `base` is the program
 * as the screen read it. The save is refused with a conflict when the file's Updated is not `expectedUpdatedAt` (null
 * expects a program never saved since it was made, Updated empty), or when the program read from the file now is
 * not `base`: someone edited the sheet by hand meanwhile, and a whole save would write over it.
 */
export type ProgramChange = { kind: 'save'; program: Program; base: Program; expectedUpdatedAt: string | null };
/** Company facts are saved whole, with the same conflict checks as a program. */
export type CompanyFactsChange = { kind: 'save'; facts: CompanyFacts; base: CompanyFacts; expectedUpdatedAt: string | null };

/**
 * One file per program. `applyMany` takes at most one save (a batch of whole-record saves means nothing); more is
 * refused as invalid, nothing written.
 */
export interface ProgramStore extends FileStore<Program, ProgramChange> {
  /** Makes the program's file holding `program` as given (its Updated too), in the person's PartnerStandard Desk folder. */
  create(owner: OwnerContext, companyId: string, program: Program): Promise<CreatedFile>;
  /** Moves the file to the person's Drive trash, where they can still restore it. Best effort: never throws. */
  trash(ref: FileRef): Promise<void>;
  /**
   * Rewrites the Program Sheet and Public page tabs from `sheet` and `publicText` (publicPlain's text), with the
   * output note. Never touches the tabs the program is read from. Throws StoreFailure when it can't.
   */
  writeOutputs(ref: FileRef, sheet: SheetContent, publicText: string): Promise<void>;
}

/** One Company facts file per company. `applyMany` takes at most one save, as for a program. */
export interface CompanyFactsStore extends FileStore<CompanyFacts, CompanyFactsChange> {
  create(owner: OwnerContext, companyId: string, facts: CompanyFacts): Promise<CreatedFile>;
}

/** A business case is saved whole, with the same conflict checks as a program. */
export type CaseChange = { kind: 'save'; case: BusinessCase; base: BusinessCase; expectedUpdatedAt: string | null };

/** One file per business case. `applyMany` takes at most one save, as for a program. */
export interface CaseStore extends FileStore<BusinessCase, CaseChange> {
  /** Makes the case's file holding `c` as given (its Updated too), in the person's PartnerStandard Desk folder. */
  create(owner: OwnerContext, companyId: string, c: BusinessCase): Promise<CreatedFile>;
  /** Moves the file to the person's Drive trash, where they can still restore it. Best effort: never throws. */
  trash(ref: FileRef): Promise<void>;
}

/**
 * A change to a MAP's file: the MAP app's typed change (`MapChange`), with the partner record's facts it is applied
 * against. `applyMapChange` joins `record` in; the store never reads the Partners file. `validate` is how much of an
 * updated row to check (`MapChangeStamp.validate`), chosen by the server for a person with a link, never by client input.
 * `newId`, for an add only, is the id the new row gets: chosen by the server (`newMapEntityId`), never by client input,
 * so a later change in the same batch can name the row (a review's prep: the review and its items in one write).
 */
export type MapFileChange = MapChange & { record: MapRecord; validate?: 'row' | 'patch'; newId?: string };

/**
 * One file per MAP. Changes are applied row by row, as for the Partners file: an activity's `expectedUpdatedAt` is
 * checked against the row as the file holds it now. A batch is all or nothing; an add in it can be named by a later
 * change only when the server chose its id (`MapFileChange.newId`): else a MAP row's id is made when it is added.
 */
export interface MapStore extends FileStore<MapPlan, MapFileChange> {
  /** Makes the MAP's file holding `plan`, named after `partnerName` and its partner type, in the person's PartnerStandard Desk folder. */
  create(owner: OwnerContext, companyId: string, plan: MapPlan, partnerName: string): Promise<CreatedFile>;
  /** Moves the file to the person's Drive trash, where they can still restore it. Best effort: never throws. */
  trash(ref: FileRef): Promise<void>;
}

export type EntityName = string;

/**
 * Lets an adapter's own tests edit its file by hand, so the contract can check hand-edit safety. The memory stores
 * give none; those cases are skipped for them.
 */
export interface RawAccess {
  /** The whole file as the adapter keeps it, to compare before and after. */
  dump(fileId: string): Promise<unknown>;
  /** The rows of one entity's tab, as the file holds them, found by id. Null when there is no such row. */
  rowOf(fileId: string, entity: EntityName, id: string): Promise<unknown>;
  /** Ids of the rows in one entity's tab, in file order, unreadable rows included. */
  rowIds(fileId: string, entity: EntityName): Promise<string[]>;
  /** Makes one row unreadable by hand (for example a stage nobody can read). Its id stays. */
  breakRow(fileId: string, entity: EntityName, id: string): Promise<void>;
  /** Removes the tab that holds one entity, and says which tab that was. */
  removeTab(fileId: string, entity: EntityName): Promise<{ tab: string }>;
  /** Renames the tab that holds one entity to `to`, and says which tab that was. */
  renameTab(fileId: string, entity: EntityName, to: string): Promise<{ tab: string }>;
  /**
   * Makes one value in an otherwise readable row unreadable by hand (for example a score nobody can read). The row
   * stays in the snapshot with that value empty, and the snapshot reports an issue. `field` is a path such as
   * 'desk.credibility'. Entity 'info' with id 'info' is the Market's details.
   */
  breakField(fileId: string, entity: EntityName, id: string, field: string): Promise<void>;
  /** The raw stored value of one field of one row, as the file holds it (an unreadable value comes back as it was typed). */
  fieldOf(fileId: string, entity: EntityName, id: string, field: string): Promise<unknown>;
  /** Types a value into one plain field of a row by hand, as a person does in the sheet (`value` is the domain value). */
  editField(fileId: string, entity: EntityName, id: string, field: string, value: unknown): Promise<void>;
  /** Types `typed` into one field's cell exactly as a person types it, with no encoding (for example "12k"). */
  typeCell(fileId: string, entity: EntityName, id: string, field: string, typed: string | number): Promise<void>;
  /** Deletes one row by hand, as a person deletes a sheet row: the rows below move up. */
  deleteRow(fileId: string, entity: EntityName, id: string): Promise<void>;
  /** Types a value into one part of a structured field by hand (for example 'desk' and 'capability'). */
  editSubField(fileId: string, entity: EntityName, id: string, field: string, sub: string, value: unknown): Promise<void>;
  /**
   * Adds a column of the user's own to one entity's tab with a note on each row named in `notes`, and one more row
   * that holds only a note (no id, nothing else).
   */
  addUserNotes(fileId: string, entity: EntityName, column: string, notes: Record<string, string>, extraRowNote: string): Promise<void>;
  /** The user's notes in that column, per row in file order. `id` is null for a row without one. */
  userNotes(fileId: string, entity: EntityName, column: string): Promise<Array<{ id: string | null; note: string }>>;
  /** Types a new row by hand, leaving its id empty. `values` are domain values, as in an add. */
  typeRowWithoutId(fileId: string, entity: EntityName, values: Record<string, unknown>): Promise<void>;
  /** Copy-pastes a row to the end of its tab, id included. */
  copyRow(fileId: string, entity: EntityName, id: string): Promise<void>;
  /** Sets the format version in `_meta`, as an older build of the app left the file. */
  setSchemaVersion(fileId: string, version: number): Promise<void>;
  /** Adds a tab of the person's own, after every other tab, holding `rows`. */
  addTab(fileId: string, title: string, rows: unknown[][]): Promise<void>;
  /** Every row of a tab as the file holds it, by the tab's title; null when the file has no such tab. */
  tabRows(fileId: string, title: string): Promise<unknown[][] | null>;
}

/**
 * Hand edits on a Company facts or program file (Program Designer's layout), for the contract's hand-edit cases. Tabs
 * and columns are named as a person sees them. The memory stores give none; those cases are skipped for them.
 */
export interface SettingsRawAccess {
  /** Every tab of the file, by title, as the file holds it. */
  dump(fileId: string): Promise<Record<string, unknown[][]>>;
  /** The rows of a tab below its header, as header → cell, in file order. Rows with nothing in them are left out. */
  rows(fileId: string, tab: string): Promise<Array<Record<string, unknown>>>;
  /** Types a row below everything else in the tab, by header. A header the tab doesn't have becomes a new column. */
  typeRow(fileId: string, tab: string, values: Record<string, unknown>): Promise<void>;
  /** Types a value into one cell: row `index` of `rows()` (0-based), under `column` (a new column if there is none). */
  typeCell(fileId: string, tab: string, index: number, column: string, value: unknown): Promise<void>;
  /** Types a value into the Value cell of a Setting / Value tab's row for `setting`. */
  typeSetting(fileId: string, tab: string, setting: string, value: unknown): Promise<void>;
  renameTab(fileId: string, from: string, to: string): Promise<void>;
}

export interface ContractHarness<S, R = RawAccess> {
  store: S;
  owner: OwnerContext;
  raw?: R;
}

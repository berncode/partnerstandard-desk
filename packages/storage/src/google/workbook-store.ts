// One store over both workbooks, driven by a WorkbookSpec. A file in the Drive trash reads as gone (the Recruitment app kept reading it).
import type { ChangeStamp, IsoDateTime } from '@partner-desk/core';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import { withQuery } from '../http/retry';
import { CREATED_WITH } from '../sheet-codec/encode';
import type { Cell, Workbook } from '../sheet-codec/grid';
import type { ApplyManyResult, ApplyResult, CreatedFile, FileRef, OwnerContext, ReadResult, StoreError } from '../types';
import { cellRange, rowRange, tabRange } from './a1';
import { DRIVE_API, GoogleApiError, SHEETS_API, type GoogleClient } from './client';
import { toStoreError } from './errors';
import { driveFolder, type FolderStore } from './folders';
import type { SheetMeta, SheetMetaCache } from './meta-cache';
import { appendRows, rowChecks } from './row-checks';
import { addEntityTabRequests, entityDropdowns, setupRequests } from './setup';
import { applyWrites, decodeFailure, planChanges, type ChangesPlan, type RowWrite, type WorkbookSpec } from '../workbook/writer';

export interface GoogleStoreOptions {
  client: GoogleClient;
  folders: FolderStore;
  /** Unused for now: the codec reads dates without a "today". Kept so callers can pass the app clock. */
  clock?: () => IsoDateTime;
  /** Tab ids per file, shared by every store in the process. Without it, every load asks Google for them. */
  metaCache?: SheetMetaCache;
  /** Where the app runs, for the link on the Start here tab. Defaults to the hosted app. */
  appBaseUrl?: string;
}

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
/** Google file ids are URL-safe. Anything else never reaches Google's API. */
const GOOGLE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
/** Google's row count for a tab whose layout doesn't say. */
const DEFAULT_ROWS = 1000;
/** Google's column count for a tab whose layout doesn't say. */
const DEFAULT_COLUMNS = 26;
/** Rows a tab grows by beyond what a write needs, so a long run of imports grows it rarely. */
const GROW_HEADROOM = 500;
/** Every values read: raw values, and dates as serial numbers (the codec reads them as UTC). */
const UNFORMATTED = { majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' };

const FILE_NOT_FOUND: StoreError = { ok: false, error: 'file_not_found', message: COPY.FILE_GONE };

interface SpreadsheetMeta {
  sheets?: Array<{ properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number; columnCount?: number } } }>;
}

interface BatchGetResponse {
  valueRanges?: Array<{ values?: unknown[][] }>;
}

interface LoadedSheet {
  wb: Workbook;
  sheetIds: Map<string, number>;
  /** Rows in each tab's grid. Google refuses writes past them. */
  rowCounts: Map<string, number>;
  /** Columns in each tab's grid, as for rows. */
  columnCounts: Map<string, number>;
  /** The tab ids came from the layout cache, so Google may no longer know one of them. */
  cached: boolean;
}

const toCell = (value: unknown): Cell =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : value == null ? null : String(value);

/** Writes never hold null: a blank cell is written as '' (null would mean "leave unchanged" to Sheets). */
const toRaw = (grid: Cell[][]) => grid.map((row) => row.map((cell) => (cell === null ? '' : cell)));

/**
 * A workbook store on the person's Google Drive: one spreadsheet per file, in "PartnerStandard / PartnerStandard Desk".
 * Every value is written with valueInputOption RAW, so no text is ever read as a formula. The store opens the file id it
 * is given and never uses the ids in `_meta` to decide access: commands check the directory first.
 * Run applies through `serializeApplies`: the writer's adapter contract allows one apply per file at a time.
 */
export class GoogleWorkbookStore<T, C, E extends string> {
  protected readonly client: GoogleClient;
  protected readonly appBaseUrl: string;
  private readonly folders: FolderStore;
  private readonly metaCache: SheetMetaCache | null;
  /** Every tab the codec reads (the Start here tab is for people). */
  private readonly readTabs: string[];

  constructor(private readonly spec: WorkbookSpec<T, C, E>, options: GoogleStoreOptions) {
    this.client = options.client;
    this.folders = options.folders;
    this.metaCache = options.metaCache ?? null;
    this.appBaseUrl = options.appBaseUrl ?? `https://${CREATED_WITH}`;
    this.readTabs = spec.layout.tabOrder.filter((tab) => tab !== spec.layout.tabs.start);
  }

  urlFor(ref: FileRef): string {
    return `https://docs.google.com/spreadsheets/d/${ref.fileId}/edit`;
  }

  /** Makes the spreadsheet in the person's folder, sets it up and writes `wb`. Anything made is trashed if a step fails. */
  protected async createFile(owner: OwnerContext, name: string, wb: Workbook): Promise<CreatedFile> {
    let fileId: string | null = null;
    try {
      const folderId = await driveFolder(this.client, this.folders, owner.userId);
      fileId = (await this.client.post<{ id: string }>(withQuery(DRIVE_API, { fields: 'id' }), {
        name, mimeType: SHEET_MIME, parents: [folderId],
      })).id;
      // Not retried on 5xx (client default): a repeated addSheet would be refused.
      await this.client.post(`${SHEETS_API}/${fileId}:batchUpdate`, { requests: setupRequests(this.spec.layout, wb) });
      await this.client.post(`${SHEETS_API}/${fileId}/values:batchUpdate`, {
        valueInputOption: 'RAW',
        data: this.spec.layout.tabOrder.map((title) => ({ range: tabRange(title), values: toRaw(wb[title]!) })),
      }, { idempotent: true });
      return { fileId, fileUrl: this.urlFor({ fileId }) };
    } catch (error) {
      if (fileId) await this.trashQuietly(fileId);
      // Anything outside Google (the folder record's database, say) is "try again later" too, never a raw driver error.
      if (!(error instanceof StoreFailure || error instanceof GoogleApiError)) throw new StoreFailure('unavailable', COPY.UNAVAILABLE_MESSAGE);
      const failure = toStoreError(error);
      throw new StoreFailure(failure.error, failure.message);
    }
  }

  async read(ref: FileRef): Promise<ReadResult<T>> {
    if (!GOOGLE_FILE_ID.test(ref.fileId)) return FILE_NOT_FOUND;
    try {
      return this.snapshot((await this.load(ref.fileId)).wb);
    } catch (error) {
      return toStoreError(error);
    }
  }

  async apply(ref: FileRef, change: C, stamp: ChangeStamp): Promise<ApplyResult<T>> {
    // One change keeps a provisional id. A batch (an import) still replaces those ids with new ones.
    const result = await this.write(ref, (wb) => planChanges(this.spec, wb, [change], stamp, (_entity, provisional) => provisional));
    if (result.ok) return { ok: true, snapshot: result.snapshot, entityId: result.entityIds[0] ?? null };
    // One change: the failure without a batch's count.
    const { error, message, tab, fieldErrors } = result;
    return { ok: false, error, message, ...(tab === undefined ? {} : { tab }), ...(fieldErrors === undefined ? {} : { fieldErrors }) };
  }

  async applyMany(ref: FileRef, changes: C[], stamp: ChangeStamp): Promise<ApplyManyResult<T>> {
    return this.write(ref, (wb) => planChanges(this.spec, wb, changes, stamp));
  }

  /** Moves the file to the person's Drive trash, where they can still recover it. Best effort: never throws. */
  async discard(ref: FileRef): Promise<void> {
    await this.moveToTrash(ref);
  }

  /**
   * Moves the file to the person's Drive trash with files.update (drive.file: the app made the file), and forgets its
   * cached layout, so the next read finds it gone. Best effort: never throws.
   */
  protected async moveToTrash(ref: FileRef): Promise<void> {
    if (!GOOGLE_FILE_ID.test(ref.fileId)) return;
    this.metaCache?.drop(ref.fileId);
    await this.trashQuietly(ref.fileId);
  }

  private snapshot(wb: Workbook): ReadResult<T> {
    const decoded = this.spec.decode(wb);
    if (!decoded.ok) return decodeFailure(decoded.error);
    return { ok: true, snapshot: { value: decoded.value.value, issues: decoded.value.issues } };
  }

  /**
   * Reads the file afresh, plans against it, checks the rows the plan will write still hold what was read
   * (row-checks.ts), then writes them in one values write (plus one request for the row deletes, if any). When rows moved meanwhile it
   * reads and plans once more; a plan that names a row only by its position fails with a conflict instead, and so does
   * a plan whose cells were already written when its deletes found a row moved (planning again would write them twice).
   */
  private async write(ref: FileRef, plan: (wb: Workbook) => ChangesPlan<T, E>): Promise<ApplyManyResult<T>> {
    if (!GOOGLE_FILE_ID.test(ref.fileId)) return FILE_NOT_FOUND;
    try {
      for (let attempt = 0; attempt < 2; attempt++) {
        const loaded = await this.load(ref.fileId);
        const planned = plan(loaded.wb);
        if (!planned.ok) return planned;
        const taken = this.nameTaken(loaded, planned.writes);
        if (taken) return taken;
        // Once cells are written, planning again would write them a second time (an append twice): a conflict instead.
        let wrote = false;
        try {
          await this.growTabs(ref.fileId, loaded, planned.writes, planned.columns);
          if (!(await this.rowsStillMatch(ref.fileId, loaded.wb, planned.writes))) {
            if (planned.positional) break;
            continue;
          }
          await this.writeCells(ref.fileId, loaded, planned.writes);
          wrote = planned.writes.some((w) => w.op !== 'delete' && w.cells.length > 0);
        } catch (error) {
          // A cached layout can be out of date (a tab with fewer rows now, or made again by hand). Google refused the
          // request, so nothing was written: read the layout again and plan once more.
          if (!(loaded.cached && error instanceof GoogleApiError && error.kind === 'bad_request')) throw error;
          this.metaCache?.drop(ref.fileId);
          if (planned.positional) break;
          continue;
        }
        if (!(await this.deleteRows(ref.fileId, loaded, planned.writes))) { // moved during the write
          if (planned.positional || wrote) break;
          continue;
        }
        const read = this.snapshot(applyWrites(loaded.wb, planned.writes));
        return read.ok ? { ok: true, snapshot: read.snapshot, entityIds: planned.entityIds } : read;
      }
      return { ok: false, error: 'conflict', message: COPY.SHEET_CHANGED_MESSAGE };
    } catch (error) {
      return toStoreError(error);
    }
  }

  /**
   * A tab the writes must add (a format upgrade's new tab) whose name a tab of the person's own has in other letters
   * ("proposals" for Proposals): Google takes the two as one name and would refuse the add, and every save after it.
   * A structure failure naming the person's tab instead, before anything is written (seen in the real Drive
   * upgrade from 4 to 5). Null when every new tab's name is free.
   */
  private nameTaken(loaded: LoadedSheet, writes: RowWrite[]): StoreError | null {
    const { layout } = this.spec;
    for (const tab of new Set(writes.map((w) => w.tab))) {
      if (loaded.sheetIds.has(tab) || !layout.entityOrder.some((e) => layout.tabs[e] === tab)) continue;
      const theirs = [...loaded.sheetIds.keys()].find((title) => title.toLowerCase() === tab.toLowerCase());
      if (theirs !== undefined) return { ok: false, error: 'structure', message: SHEET_COPY.ISSUES.TAB_NAME_TAKEN(theirs, tab), tab: theirs };
    }
    return null;
  }

  /**
   * Makes each entity tab the writes go to that the file doesn't have (a format upgrade's new tab, such as a MAP's
   * Reviews), at its place in the layout's order. Grows each tab the writes reach past the end of (Google makes a tab
   * 1000 rows and 26 columns and refuses writes past its grid): columns to the last one written (an upgrade's new
   * column), rows with headroom, and gives the new columns and the new rows of an entity tab their dropdowns: one
   * batchUpdate, before anything is checked or written. A new empty tab, extra empty rows or columns, or a dropdown on
   * an empty column, are harmless if the apply goes no further: the next save fills the empty tab's header.
   */
  private async growTabs(fileId: string, loaded: LoadedSheet, writes: RowWrite[], columns: Record<E, Record<string, number>>): Promise<void> {
    const { layout } = this.spec;
    const needed = new Map<string, number>();
    const neededColumns = new Map<string, number>();
    const appended = appendRows(loaded.wb, writes);
    for (const w of writes) {
      const row = w.op === 'append' ? appended.get(w)! : w.row;
      needed.set(w.tab, Math.max(needed.get(w.tab) ?? 0, row));
      if (w.op !== 'delete') for (const cell of w.cells) neededColumns.set(w.tab, Math.max(neededColumns.get(w.tab) ?? 0, cell.col + 1));
    }
    const requests: unknown[] = [];
    let nextId = Math.max(-1, ...loaded.sheetIds.values()) + 1;
    let madeTabs = false;
    for (const tab of needed.keys()) {
      const entity = layout.entityOrder.find((e) => layout.tabs[e] === tab);
      if (entity === undefined || loaded.sheetIds.has(tab)) continue;
      const sheetId = nextId++;
      requests.push(...addEntityTabRequests(layout, entity, sheetId, Math.min(layout.tabOrder.indexOf(tab), loaded.sheetIds.size)));
      loaded.sheetIds.set(tab, sheetId);
      loaded.rowCounts.set(tab, DEFAULT_ROWS);
      loaded.columnCounts.set(tab, Math.max(DEFAULT_COLUMNS, layout.columns[entity].length));
      madeTabs = true;
    }
    // Columns first: the dropdowns for new rows below may sit in a new column.
    const widened = new Map<string, number>();
    for (const [tab, cols] of neededColumns) {
      const have = loaded.columnCounts.get(tab) ?? DEFAULT_COLUMNS;
      const sheetId = loaded.sheetIds.get(tab);
      if (cols <= have || sheetId === undefined) continue;
      requests.push({ appendDimension: { sheetId, dimension: 'COLUMNS', length: cols - have } });
      // A list column the grow adds (an upgrade's Level) gets its dropdown on the rows the tab already has.
      const entity = layout.entityOrder.find((e) => layout.tabs[e] === tab);
      if (entity) {
        const isNew = (key: string) => (columns[entity][key] !== undefined && columns[entity][key]! >= have ? columns[entity][key] : undefined);
        requests.push(...entityDropdowns(layout, entity, sheetId, [1, loaded.rowCounts.get(tab) ?? DEFAULT_ROWS], isNew));
      }
      widened.set(tab, cols);
    }
    const grown = new Map<string, number>();
    for (const [tab, rows] of needed) {
      const have = loaded.rowCounts.get(tab) ?? DEFAULT_ROWS;
      const sheetId = loaded.sheetIds.get(tab);
      if (rows <= have || sheetId === undefined) continue;
      const length = rows - have + GROW_HEADROOM;
      requests.push({ appendDimension: { sheetId, dimension: 'ROWS', length } });
      const entity = layout.entityOrder.find((e) => layout.tabs[e] === tab);
      if (entity) requests.push(...entityDropdowns(layout, entity, sheetId, [have, have + length], (key) => columns[entity][key]));
      grown.set(tab, have + length);
    }
    if (requests.length === 0) return;
    // Not retried: a second appendDimension would add the rows twice, a second addSheet would be refused.
    await this.client.post(`${SHEETS_API}/${fileId}:batchUpdate`, { requests });
    for (const [tab, rows] of grown) loaded.rowCounts.set(tab, rows);
    for (const [tab, cols] of widened) loaded.columnCounts.set(tab, cols);
    // A file missing a tab is never cached (fetchMeta); the next load asks Google for the layout with the new tabs.
    if (madeTabs) this.metaCache?.drop(fileId);
    else this.adjustCachedRows(fileId, Object.fromEntries(grown), Object.fromEntries(widened));
  }

  /** Puts new row (and column) counts into the cached layout, if there is one. */
  private adjustCachedRows(fileId: string, rowCounts: Record<string, number>, columnCounts: Record<string, number> = {}): void {
    const meta = this.metaCache?.get(fileId);
    if (!meta) return;
    const widened = Object.keys(columnCounts).length > 0 ? { columnCounts: { ...meta.columnCounts, ...columnCounts } } : {};
    this.metaCache!.set(fileId, { ...meta, rowCounts: { ...meta.rowCounts, ...rowCounts }, ...widened });
  }

  /** The adapter contract's checks (row-checks.ts), in one batchGet. */
  private async rowsStillMatch(fileId: string, expected: Workbook, writes: RowWrite[]): Promise<boolean> {
    const checks = rowChecks(expected, writes);
    if (checks.length === 0) return true;
    const response = await this.client.get<BatchGetResponse>(withQuery(`${SHEETS_API}/${fileId}/values:batchGet`, {
      ranges: checks.map((c) => (c.fromCol === c.toCol ? cellRange(c.tab, c.row, c.fromCol) : rowRange(c.tab, c.row, c.fromCol, c.toCol))),
      ...UNFORMATTED,
    }));
    return checks.every((c, i) => c.matches(response.valueRanges?.[i]?.values));
  }

  /** Cell writes in one RAW values:batchUpdate. Deletes are left to `deleteRows`; the writer always puts them last. */
  private async writeCells(fileId: string, loaded: LoadedSheet, writes: RowWrite[]): Promise<void> {
    const data: Array<{ range: string; values: Cell[][] }> = [];
    const appended = appendRows(loaded.wb, writes);
    for (const w of writes) {
      if (w.op === 'delete' || w.cells.length === 0) continue;
      const row = w.op === 'append' ? appended.get(w)! : w.row;
      const cols = w.cells.map((c) => c.col);
      const from = Math.min(...cols);
      const to = Math.max(...cols);
      // null between written cells means "leave this cell alone"; a blank value is written as ''.
      const values: Cell[] = Array.from({ length: to - from + 1 }, () => null);
      for (const cell of w.cells) values[cell.col - from] = cell.value ?? '';
      data.push({ range: rowRange(w.tab, row, from, to), values: [values] });
    }
    // Re-writing the same cells is harmless, so a retried 5xx is safe here; a retried row delete is not.
    if (data.length > 0) {
      await this.client.post(`${SHEETS_API}/${fileId}/values:batchUpdate`, { valueInputOption: 'RAW', data }, { idempotent: true });
    }
  }

  /**
   * Deletes the plan's rows, if any, in one batchUpdate: Google applies all of its requests or none. The cell writes
   * above can take a while (retries), so every row's ID is checked again just before deleting. Returns false,
   * deleting nothing, when a row moved meanwhile. The writer orders the deletes so each row number holds when its
   * request runs (bottom row first within a tab).
   */
  private async deleteRows(fileId: string, loaded: LoadedSheet, writes: RowWrite[]): Promise<boolean> {
    const deletes = writes.filter((w): w is Extract<RowWrite, { op: 'delete' }> => w.op === 'delete');
    if (deletes.length === 0) return true;
    const tabs = [...new Set(deletes.map((d) => d.tab))];
    const known = (sheetIds: Map<string, number>) => tabs.every((tab) => sheetIds.has(tab));
    let sheetIds = known(loaded.sheetIds) ? loaded.sheetIds : await this.freshSheetIds(fileId, tabs);
    // Checked against the sheet as this apply's cell writes left it.
    if (!(await this.rowsStillMatch(fileId, applyWrites(loaded.wb, writes.filter((w) => w.op !== 'delete')), deletes))) return false;
    try {
      await this.deleteDimensions(fileId, sheetIds, deletes);
    } catch (error) {
      if (!(loaded.cached && sheetIds === loaded.sheetIds && error instanceof GoogleApiError && error.kind === 'bad_request')) throw error;
      // Google doesn't know a cached tab id (a tab was made again by hand). A refused batchUpdate changed nothing,
      // so it is sent once more with the ids Google has now.
      sheetIds = await this.freshSheetIds(fileId, tabs);
      await this.deleteDimensions(fileId, sheetIds, deletes);
    }
    // Deleting a row takes it out of the grid too.
    const shrunk: Record<string, number> = {};
    for (const tab of tabs) {
      const rows = loaded.rowCounts.get(tab);
      if (rows !== undefined) shrunk[tab] = rows - deletes.filter((d) => d.tab === tab).length;
    }
    this.adjustCachedRows(fileId, shrunk);
    return true;
  }

  /** One batchUpdate, its requests in the writer's order. Not retried: a repeated row delete would delete another row. */
  private deleteDimensions(fileId: string, sheetIds: Map<string, number>, deletes: Array<Extract<RowWrite, { op: 'delete' }>>): Promise<unknown> {
    return this.client.post(`${SHEETS_API}/${fileId}:batchUpdate`, {
      requests: deletes.map((d) => ({
        deleteDimension: { range: { sheetId: sheetIds.get(d.tab)!, dimension: 'ROWS', startIndex: d.row - 1, endIndex: d.row } },
      })),
    });
  }

  /** The `tabs`' sheetIds as Google has them now, with the cached layout dropped first. */
  private async freshSheetIds(fileId: string, tabs: string[]): Promise<Map<string, number>> {
    this.metaCache?.drop(fileId);
    const fresh = (await this.fetchMeta(fileId)).sheetIds;
    const out = new Map<string, number>();
    for (const tab of tabs) {
      const sheetId = fresh[tab];
      if (sheetId === undefined) throw new StoreFailure('structure', SHEET_COPY.ISSUES.MISSING_TAB(tab));
      out.set(tab, sheetId);
    }
    return out;
  }

  /** The spreadsheet's layout (cached), then every tab the codec reads in one batchGet. Values are never cached. */
  private async load(fileId: string): Promise<LoadedSheet> {
    const cached = this.metaCache?.get(fileId);
    if (cached) {
      try {
        return await this.loadTabs(fileId, cached, true);
      } catch (error) {
        // Google can't parse a range: a cached tab was renamed or deleted by hand. Ask for the layout again, once.
        if (!(error instanceof GoogleApiError && error.kind === 'bad_request')) throw error;
      }
    }
    return this.loadTabs(fileId, await this.fetchMeta(fileId), false);
  }

  /**
   * The layout as Google has it now, and whether the file is in the Drive trash (Google still serves a trashed
   * spreadsheet by id; to us it is gone). Cached only when every tab the codec reads is there; otherwise forgotten.
   * The trash is checked with the layout, so at most once per layout cache period.
   */
  private async fetchMeta(fileId: string): Promise<SheetMeta> {
    const [file, response] = await Promise.all([
      this.client.get<{ trashed?: boolean }>(withQuery(`${DRIVE_API}/${fileId}`, { fields: 'id,trashed' })),
      this.client.get<SpreadsheetMeta>(withQuery(`${SHEETS_API}/${fileId}`, {
        fields: 'sheets.properties(sheetId,title,gridProperties.rowCount,gridProperties.columnCount)',
      })),
    ]);
    if (file.trashed) {
      this.metaCache?.drop(fileId);
      throw new StoreFailure('file_not_found', COPY.FILE_GONE);
    }
    const sheets = response.sheets ?? [];
    const meta: SheetMeta = {
      sheetIds: Object.fromEntries(sheets.map((s) => [s.properties.title, s.properties.sheetId])),
      rowCounts: Object.fromEntries(sheets.map((s) => [s.properties.title, s.properties.gridProperties?.rowCount ?? DEFAULT_ROWS])),
      columnCounts: Object.fromEntries(sheets.map((s) => [s.properties.title, s.properties.gridProperties?.columnCount ?? DEFAULT_COLUMNS])),
    };
    if (this.readTabs.every((tab) => Object.hasOwn(meta.sheetIds, tab))) this.metaCache?.set(fileId, meta);
    else this.metaCache?.drop(fileId);
    return meta;
  }

  /** Every tab that `meta` has and the codec reads, in one batchGet. */
  private async loadTabs(fileId: string, meta: SheetMeta, cached: boolean): Promise<LoadedSheet> {
    const sheetIds = new Map(Object.entries(meta.sheetIds));
    const rowCounts = new Map(Object.entries(meta.rowCounts));
    const columnCounts = new Map(Object.entries(meta.columnCounts ?? {}));
    const tabs = this.readTabs.filter((t) => sheetIds.has(t));
    const wb: Workbook = {};
    if (tabs.length > 0) {
      const response = await this.client.get<BatchGetResponse>(withQuery(`${SHEETS_API}/${fileId}/values:batchGet`, {
        ranges: tabs.map(tabRange),
        ...UNFORMATTED,
      }));
      tabs.forEach((title, i) => {
        wb[title] = (response.valueRanges?.[i]?.values ?? []).map((row) => row.map(toCell));
      });
    }
    return { wb, sheetIds, rowCounts, columnCounts, cached };
  }

  private async trashQuietly(fileId: string): Promise<void> {
    try {
      await this.client.patch(`${DRIVE_API}/${fileId}`, { trashed: true }, { idempotent: true });
    } catch {
      // Best effort: a half-made sheet in the person's Drive is untidy, not harmful.
    }
  }
}

// Company facts and program spreadsheets on PartnerStandard Desk's Google client, folder and layout cache. One file
// per record, found by the file id the directory holds (Program Designer found them by Drive appProperties).
import { renameKeepingPrefix } from './rename';
import { OUTPUT_NOTE, programLabel, type ChangeStamp, type CompanyFacts, type IsoDateTime, type Program, type SheetContent } from '@partner-desk/core';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import { withQuery } from '../http/retry';
import type { Cell, Workbook } from '../sheet-codec/grid';
import {
  applyRowWrites, freshCompanyFactsGrids, freshProgramGrids, META_TAB, PROGRAM_SHEET_TAB, PUBLIC_TAB, type Grids, type RowWrite,
} from '../sheet-codec/program-layout';
import { noteTime, publicTabFormat, publicTabValues, sheetTabFormat, sheetTabValues } from '../sheet-codec/program-output';
import type {
  ApplyManyResult, ApplyResult, CompanyFactsChange, CompanyFactsStore, CreatedFile, FileRef, OwnerContext, ProgramChange,
  ProgramStore, ReadResult, StoreError,
} from '../types';
import { oneSave, planSave } from '../whole-save';
import { rowRange, tabRange } from './a1';
import { DRIVE_API, GoogleApiError, SHEETS_API, type GoogleClient } from './client';
import { toStoreError } from './errors';
import { driveFolder } from './folders';
import type { SheetMeta } from './meta-cache';
import { addTabRequests, settingsFileSetupRequests } from './setup';
import type { GoogleStoreOptions } from './workbook-store';
import { COMPANY_FACTS_SPEC, PROGRAM_SPEC, type FileSpec } from '../workbook/file-specs';

const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
/** Google file ids are URL-safe. Anything else never reaches Google's API. */
const GOOGLE_FILE_ID = /^[A-Za-z0-9_-]{10,200}$/;
/** Google's row count for a tab whose size isn't known; rows a tab grows by beyond what a write needs. */
const DEFAULT_ROWS = 1000;
const GROW_HEADROOM = 500;
const UNFORMATTED = { majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' };

const FILE_NOT_FOUND: StoreError = { ok: false, error: 'file_not_found', message: COPY.FILE_GONE };

interface SpreadsheetMeta {
  sheets?: Array<{ properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number } } }>;
}
interface BatchGetResponse {
  valueRanges?: Array<{ values?: unknown[][] }>;
}

/** The values of the tabs the file is read from, and its layout. `cached`: the layout came from the cache. */
interface Loaded { grids: Grids; meta: SheetMeta; cached: boolean }

const toCell = (value: unknown): Cell =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : value == null ? null : String(value);
/** Writes never hold null for a cell meant blank: '' (null would mean "leave unchanged" to Sheets). */
const toRaw = (grid: Cell[][]) => grid.map((row) => row.map((cell) => (cell === null ? '' : cell)));
const isStaleLayout = (loaded: { cached: boolean }, error: unknown) => loaded.cached && error instanceof GoogleApiError && error.kind === 'bad_request';

/**
 * A Company facts, program or business case file on the person's Google Drive, in "PartnerStandard / PartnerStandard Desk". A read is one
 * values read of the tabs the file is read from (the layout cached). A save reads the file afresh, refuses a file it
 * can't read, a stale copy or a record that isn't valid, then writes only the rows the record changes, in one RAW values
 * write (so no text is ever read as a formula). Rows it couldn't read, a person's own rows and columns, and the output
 * tabs are never written by a save. Run saves through `serializeApplies`: one save per file at a time.
 */
export class GoogleSettingsFileStore<T extends { id: string; updatedAt: string }, C> {
  protected readonly client: GoogleClient;
  private readonly options: GoogleStoreOptions;

  constructor(private readonly spec: FileSpec<T, C>, options: GoogleStoreOptions) {
    this.client = options.client;
    this.options = options;
  }

  urlFor(ref: FileRef): string {
    return `https://docs.google.com/spreadsheets/d/${ref.fileId}/edit`;
  }

  /** Makes the spreadsheet in the person's folder, sets it up and writes `grids`. Anything made is trashed if a step fails. */
  protected async createFile(owner: OwnerContext, name: string, value: T, grids: Workbook): Promise<CreatedFile> {
    const parsed = this.spec.save.parse(value);
    if (!parsed.ok) throw new StoreFailure('invalid', parsed.issues[0]?.message ?? COPY.FIX_FIELDS);
    let fileId: string | null = null;
    try {
      const folderId = await driveFolder(this.client, this.options.folders, owner.userId);
      fileId = (await this.client.post<{ id: string }>(withQuery(DRIVE_API, { fields: 'id' }), {
        name, mimeType: SHEET_MIME, parents: [folderId],
      })).id;
      // Not retried on 5xx (client default): a repeated addSheet would be refused.
      await this.client.post(`${SHEETS_API}/${fileId}:batchUpdate`, { requests: settingsFileSetupRequests(this.spec.tabs, this.spec.dataTabs, META_TAB) });
      await this.client.post(`${SHEETS_API}/${fileId}/values:batchUpdate`, {
        valueInputOption: 'RAW',
        data: this.spec.tabs.filter((title) => (grids[title] ?? []).length > 0).map((title) => ({ range: tabRange(title), values: toRaw(grids[title]!) })),
      }, { idempotent: true });
      return { fileId, fileUrl: this.urlFor({ fileId }) };
    } catch (error) {
      if (fileId) await this.trashQuietly(fileId);
      throw toFailure(error);
    }
  }

  async read(ref: FileRef): Promise<ReadResult<T>> {
    if (!GOOGLE_FILE_ID.test(ref.fileId)) return FILE_NOT_FOUND;
    try {
      const book = this.spec.read((await this.load(ref.fileId)).grids);
      return book.ok ? { ok: true, snapshot: { value: book.value, issues: book.issues } } : book;
    } catch (error) {
      return toStoreError(error);
    }
  }

  async apply(ref: FileRef, change: C, stamp: ChangeStamp): Promise<ApplyResult<T>> {
    if (!GOOGLE_FILE_ID.test(ref.fileId)) return FILE_NOT_FOUND;
    try {
      // Twice at most: a cached layout can be out of date (a tab grown or made again by hand); Google then refuses the
      // write, nothing is written, and the save reads the file again.
      for (let attempt = 0; attempt < 2; attempt++) {
        const loaded = await this.load(ref.fileId);
        const book = this.spec.read(loaded.grids);
        if (!book.ok) return book;
        const planned = planSave(this.spec.save, book.value, change, stamp);
        if (!planned.ok) return planned;
        const writes = book.writes(planned.value);
        try {
          await this.writeRows(ref.fileId, loaded, writes);
        } catch (error) {
          if (!isStaleLayout(loaded, error)) throw error;
          this.options.metaCache?.drop(ref.fileId);
          continue;
        }
        await this.saved?.(ref, book.value, planned.value);
        const after = this.spec.read(applyRowWrites(loaded.grids, writes));
        return after.ok ? { ok: true, snapshot: { value: after.value, issues: after.issues }, entityId: null } : after;
      }
      return { ok: false, error: 'conflict', message: COPY.SHEET_CHANGED_MESSAGE };
    } catch (error) {
      return toStoreError(error);
    }
  }

  /** At most one save: a batch of whole-record saves means nothing. None reads the file. */
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

  /** Moves the file to the person's Drive trash, where they can still recover it. Best effort: never throws. */
  async discard(ref: FileRef): Promise<void> {
    await this.moveToTrash(ref);
  }

  /** After a save that wrote: the place for a rename. Best effort: the save stands whatever happens here. */
  protected saved?(ref: FileRef, before: T, after: T): Promise<void>;

  protected async moveToTrash(ref: FileRef): Promise<void> {
    if (!GOOGLE_FILE_ID.test(ref.fileId)) return;
    this.options.metaCache?.drop(ref.fileId);
    await this.trashQuietly(ref.fileId);
  }

  /** Forgets the cached layout: the next read asks Google for it. */
  protected dropLayout(fileId: string): void {
    this.options.metaCache?.drop(fileId);
  }

  protected now(): IsoDateTime {
    return this.options.clock?.() ?? new Date().toISOString();
  }

  /** The layout, cached when it can be: every tab the file is read from must be there. */
  protected async layout(fileId: string): Promise<{ meta: SheetMeta; cached: boolean }> {
    const cached = this.options.metaCache?.get(fileId);
    return cached ? { meta: cached, cached: true } : { meta: await this.fetchMeta(fileId), cached: false };
  }

  /**
   * The layout as Google has it now, and whether the file is in the Drive trash (Google still serves a trashed
   * spreadsheet by id; to us it is gone).
   */
  protected async fetchMeta(fileId: string): Promise<SheetMeta> {
    const [file, response] = await Promise.all([
      this.client.get<{ trashed?: boolean }>(withQuery(`${DRIVE_API}/${fileId}`, { fields: 'id,trashed' })),
      this.client.get<SpreadsheetMeta>(withQuery(`${SHEETS_API}/${fileId}`, { fields: 'sheets.properties(sheetId,title,gridProperties.rowCount)' })),
    ]);
    if (file.trashed) {
      this.options.metaCache?.drop(fileId);
      throw new StoreFailure('file_not_found', COPY.FILE_GONE);
    }
    const sheets = response.sheets ?? [];
    const meta: SheetMeta = {
      sheetIds: Object.fromEntries(sheets.map((s) => [s.properties.title, s.properties.sheetId])),
      rowCounts: Object.fromEntries(sheets.map((s) => [s.properties.title, s.properties.gridProperties?.rowCount ?? DEFAULT_ROWS])),
    };
    if (this.spec.readTabs.every((tab) => Object.hasOwn(meta.sheetIds, tab))) this.options.metaCache?.set(fileId, meta);
    else this.options.metaCache?.drop(fileId);
    return meta;
  }

  /** The layout (cached), then every tab the file is read from that it has, in one batchGet. Values are never cached. */
  private async load(fileId: string): Promise<Loaded> {
    const first = await this.layout(fileId);
    if (first.cached) {
      try {
        return await this.loadTabs(fileId, first.meta, true);
      } catch (error) {
        // Google can't parse a range: a cached tab was renamed or deleted by hand. Ask for the layout again, once.
        if (!isStaleLayout(first, error)) throw error;
        this.options.metaCache?.drop(fileId);
      }
    }
    return this.loadTabs(fileId, first.cached ? await this.fetchMeta(fileId) : first.meta, false);
  }

  private async loadTabs(fileId: string, meta: SheetMeta, cached: boolean): Promise<Loaded> {
    const tabs = this.spec.readTabs.filter((tab) => Object.hasOwn(meta.sheetIds, tab));
    const grids: Grids = {};
    if (tabs.length > 0) {
      const response = await this.client.get<BatchGetResponse>(withQuery(`${SHEETS_API}/${fileId}/values:batchGet`, { ranges: tabs.map(tabRange), ...UNFORMATTED }));
      tabs.forEach((title, i) => {
        grids[title] = (response.valueRanges?.[i]?.values ?? []).map((row) => row.map(toCell));
      });
    }
    return { grids, meta, cached };
  }

  /**
   * Makes any tab the rows go to that the file doesn't have (a format upgrade's new tab), grows any tab the rows reach
   * past (Google refuses writes beyond a tab's grid), then writes the rows in one values write.
   */
  private async writeRows(fileId: string, { meta }: Loaded, writes: RowWrite[]): Promise<void> {
    if (writes.length === 0) return;
    const lastRow = new Map<string, number>();
    for (const w of writes) lastRow.set(w.tab, Math.max(lastRow.get(w.tab) ?? 0, w.row));
    let nextId = Math.max(-1, ...Object.values(meta.sheetIds)) + 1;
    const count = Object.keys(meta.sheetIds).length;
    const added = [...lastRow.keys()].filter((title) => meta.sheetIds[title] === undefined).flatMap((title) => {
      const at = this.spec.tabs.indexOf(title);
      return addTabRequests(title, nextId++, at < 0 ? count : Math.min(at, count), this.spec.dataTabs.includes(title));
    });
    const grown: Record<string, number> = {};
    const grow = [...lastRow].flatMap(([title, row]) => {
      const have = meta.rowCounts[title] ?? DEFAULT_ROWS;
      const sheetId = meta.sheetIds[title];
      if (row <= have || sheetId === undefined) return [];
      grown[title] = row + GROW_HEADROOM;
      return [{ appendDimension: { sheetId, dimension: 'ROWS', length: row - have + GROW_HEADROOM } }];
    });
    const requests = [...added, ...grow];
    // Not retried on 5xx: a repeat would add the rows twice (harmless, but untidy), or the tab twice (refused).
    if (requests.length > 0) {
      await this.client.post(`${SHEETS_API}/${fileId}:batchUpdate`, { requests });
      const cached = this.options.metaCache?.get(fileId);
      if (added.length > 0) this.options.metaCache?.drop(fileId);
      else if (cached) this.options.metaCache!.set(fileId, { ...cached, rowCounts: { ...cached.rowCounts, ...grown } });
    }
    // RAW: a person's text such as "007" or "=1+1" stays text. Replaces fixed cells, so repeating it is safe.
    await this.client.post(`${SHEETS_API}/${fileId}/values:batchUpdate`, {
      valueInputOption: 'RAW',
      data: writes.map((w) => ({ range: rowRange(w.tab, w.row, w.from, w.from + w.values.length - 1), values: [w.values] })),
    }, { idempotent: true });
  }

  protected async trashQuietly(fileId: string): Promise<void> {
    try {
      await this.client.patch(`${DRIVE_API}/${fileId}`, { trashed: true }, { idempotent: true });
    } catch {
      // Best effort: a file left in the person's Drive is untidy, not harmful.
    }
  }
}

/** A Google or store failure as a StoreFailure the caller can show; anything else as "try again later". */
function toFailure(error: unknown): StoreFailure {
  if (!(error instanceof StoreFailure || error instanceof GoogleApiError)) return new StoreFailure('unavailable', COPY.UNAVAILABLE_MESSAGE);
  const failure = toStoreError(error);
  return new StoreFailure(failure.error, failure.message);
}

/** "PartnerStandard Desk – Program – Reseller · DACH". */
export const programFileName = (p: Pick<Program, 'type' | 'focus'>) => SHEET_COPY.DRIVE.programFile(programLabel(p));

/** One spreadsheet per program: Program Designer's tabs, and `_meta`. */
class GoogleProgramStore extends GoogleSettingsFileStore<Program, ProgramChange> implements ProgramStore {
  constructor(options: GoogleStoreOptions) {
    super(PROGRAM_SPEC, options);
  }

  create(owner: OwnerContext, companyId: string, program: Program): Promise<CreatedFile> {
    return this.createFile(owner, programFileName(program), program, freshProgramGrids(program, companyId));
  }

  /** A deleted program goes to the person's Drive trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }

  /** The file is named after the program's label: renamed when the label changes. Best effort. */
  protected override async saved(ref: FileRef, before: Program, after: Program): Promise<void> {
    if (programLabel(before) === programLabel(after)) return;
    await renameKeepingPrefix(this.client, ref.fileId, programFileName(after));
  }

  async writeOutputs(ref: FileRef, sheet: SheetContent, publicText: string): Promise<void> {
    if (!GOOGLE_FILE_ID.test(ref.fileId)) throw new StoreFailure('file_not_found', COPY.FILE_GONE);
    const note = OUTPUT_NOTE(noteTime(this.now()));
    const outputs: Output[] = [
      { title: PROGRAM_SHEET_TAB, at: 'first', rows: sheetTabValues(sheet, note), format: sheetTabFormat },
      { title: PUBLIC_TAB, at: 'last', rows: publicTabValues(publicText, note), format: publicTabFormat },
    ];
    try {
      // The layout as Google has it now, never the cached one: a tab renamed since would be cleared under its new name.
      await this.writeOutputTabs(ref.fileId, await this.fetchMeta(ref.fileId), outputs);
    } catch (error) {
      throw toFailure(error);
    }
  }

  /**
   * Clears and rewrites the output tabs: one batchUpdate (adding a tab a person deleted, clearing, growing and
   * formatting, on the output tabs' own sheet ids only) and one values write to those tabs.
   */
  private async writeOutputTabs(fileId: string, meta: SheetMeta, outputs: Output[]): Promise<void> {
    const requests: object[] = [];
    let nextId = Math.max(-1, ...Object.values(meta.sheetIds)) + 1;
    let count = Object.keys(meta.sheetIds).length;
    let changed = false;
    const ids = outputs.map(({ title, at, rows }) => {
      const sheetId = meta.sheetIds[title];
      if (sheetId !== undefined) {
        const have = meta.rowCounts[title] ?? DEFAULT_ROWS;
        if (rows.length > have) {
          requests.push({ appendDimension: { sheetId, dimension: 'ROWS', length: rows.length - have + GROW_HEADROOM } });
          changed = true;
        }
        return sheetId;
      }
      const made = nextId++;
      requests.push({ addSheet: { properties: { sheetId: made, title, index: at === 'first' ? 0 : count } } });
      count += 1;
      changed = true;
      return made;
    });
    outputs.forEach(({ rows, format }, i) => {
      requests.push({ updateCells: { range: { sheetId: ids[i] }, fields: 'userEnteredValue,userEnteredFormat' } }, ...format(ids[i]!, rows.length));
    });
    await this.client.post(`${SHEETS_API}/${fileId}:batchUpdate`, { requests });
    if (changed) this.dropLayout(fileId);
    await this.client.post(`${SHEETS_API}/${fileId}/values:batchUpdate`, {
      valueInputOption: 'RAW', data: outputs.map(({ title, rows }) => ({ range: tabRange(title), values: toRaw(rows) })),
    }, { idempotent: true });
  }
}

type Output = { title: string; at: 'first' | 'last'; rows: Cell[][]; format: (sheetId: number, rows: number) => object[] };

/** One Company facts spreadsheet per company: a Setting / Value tab, and `_meta`. */
class GoogleCompanyFactsStore extends GoogleSettingsFileStore<CompanyFacts, CompanyFactsChange> implements CompanyFactsStore {
  constructor(options: GoogleStoreOptions) {
    super(COMPANY_FACTS_SPEC, options);
  }

  create(owner: OwnerContext, companyId: string, facts: CompanyFacts): Promise<CreatedFile> {
    return this.createFile(owner, SHEET_COPY.DRIVE.companyFactsFile, facts, freshCompanyFactsGrids(facts, companyId));
  }
}

/** A program store on the person's Google Drive. Wrap it in `cacheReads(serializeApplies(...))` in the app. */
export const createGoogleProgramStore = (options: GoogleStoreOptions): ProgramStore => new GoogleProgramStore(options);
/** A Company facts store on the person's Google Drive. Wrap it in `cacheReads(serializeApplies(...))` in the app. */
export const createGoogleCompanyFactsStore = (options: GoogleStoreOptions): CompanyFactsStore => new GoogleCompanyFactsStore(options);

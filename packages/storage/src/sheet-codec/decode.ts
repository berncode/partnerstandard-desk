// The decoders. Issues carry tab, row and message only, and a message names the column, never what the cell holds. A
// row whose only problem is a value that may be empty and can't be read is kept with that value empty (the
// Recruitment app did this for "Updated" only).
import {
  COLLECTION, DEFAULT_HORIZON_DAYS, MAP_COLLECTION, MAP_ENTITY_SCHEMAS, MARKET_COLLECTION, MARKET_ENTITY_SCHEMAS, MARKET_FIELD_NAMES,
  PARTNER_ENTITY_SCHEMAS, horizonDaysSchema, isoDateSchema, marketInfoSchema, normalizeName, toFieldErrors, type EntityKind, type IsoDate,
  type IsoDateTime, type MapInfo, type MapPlan, type Market, type MarketEntity, type MarketInfo, type PartnerBook, type PartnerEntity,
} from '@partner-desk/core';
import { SHEET_COPY } from '@partner-desk/copy';
import type { RowIssue } from '../types';
import type { ColumnDef, ColumnKind, InfoFieldKind, InfoKey } from './columns';
import { getPath } from './encode';
import { headerKey, type Cell, type Grid, type Workbook } from './grid';
import { labelsOf, valueFor, type EnumName } from './labels';
import { accountRef, MARKET_LAYOUT, PARTNERS_LAYOUT, type WorkbookLayout } from './layouts';
import { MAP_LAYOUT, parseLaterHorizons, readDays } from './map-layout';
import { CURRENT_SCHEMA_VERSIONS, OLDEST_READABLE_VERSIONS, upgrade, type UpgradeCell, type WorkbookKind } from './version';

export interface RowLocation<E extends string> {
  entity: E;
  tab: string;
  /** 1-based sheet row. */
  row: number;
}

/** A row that decoded without a usable ID (blank or a duplicate). It is in the value under `provisionalId`. */
export interface MissingId<E extends string> {
  entity: E;
  row: number;
  provisionalId: string;
}

export interface DecodedRows<T, E extends string> {
  value: T;
  /**
   * Cells and rows the app can't read. `row` is 1-based; 0 when a Market tab row is missing. An issue on an entity row
   * means the row was left out, unless the row has a location: then it was kept (see `unreadable`, and duplicate IDs).
   */
  issues: RowIssue[];
  /** Per entity: column key → 0-based column index, as found in the header row. Other columns are the user's. */
  columns: Record<E, Record<string, number>>;
  /** Where each row in `value` sits, by id. Rows left out have no location. */
  locations: Map<string, RowLocation<E>>;
  missingIds: Array<MissingId<E>>;
  /**
   * Per kept row id, the column keys whose cell couldn't be read: the row holds them empty, the sheet still has what was
   * typed. Only an edit of that field may overwrite it.
   */
  unreadable: Map<string, Set<string>>;
  /**
   * The cells an older file needs to be at the current format version (its new headers or rows, and `_meta`'s
   * version), in the order to write them; empty for a current file. The value, columns and rows are read as if the
   * file had them already; the next save writes them (writer.ts).
   */
  upgrade: UpgradeCell[];
}

export interface DecodedInfo {
  /** 1-based row of each field on the Market tab; a missing row has no entry. */
  infoRows: Partial<Record<InfoKey, number>>;
  /**
   * Market fields whose sheet value couldn't be read or broke a rule, so `value.info` holds a stand-in default.
   * The sheet still has what the user typed; only an edit of that field may overwrite it.
   */
  unreadableInfo: Set<keyof MarketInfo>;
}

export type Decoded<T extends PartnerBook | Market> = T extends Market
  ? DecodedRows<Market, MarketEntity> & DecodedInfo
  : DecodedRows<PartnerBook, PartnerEntity>;

/** A MAP's Plan tab, as read. */
export interface DecodedPlan {
  /** 1-based row of each field on the Plan tab; a missing row has no entry. */
  planRows: Partial<Record<keyof MapInfo, number>>;
  /**
   * Plan fields whose sheet value couldn't be read, so `value.info` holds a stand-in (the default, or the later horizons
   * that could be read). The sheet still has what the person typed; only a change that sets the field may overwrite it.
   */
  unreadablePlan: Set<keyof MapInfo>;
}

export type DecodedMap = DecodedRows<MapPlan, EntityKind> & DecodedPlan;

/**
 * Why a file can't be read at all. Stores map the kind to a StoreError code; the message is for people. `old_version`:
 * a format version this app no longer reads (a version 1 Partners file); it is never upgraded. `missing_row`: a row the
 * file can't do without (a MAP's partner type) is missing or can't be read.
 */
export type DecodeErrorKind = 'not_ours' | 'newer_version' | 'old_version' | 'missing_tab' | 'missing_column' | 'missing_row';

export interface DecodeError {
  kind: DecodeErrorKind;
  tab: string;
  message: string;
}

export type DecodeResult<T extends PartnerBook | Market> = { ok: true; value: Decoded<T> } | { ok: false; error: DecodeError };
export type MapDecodeResult = { ok: true; value: DecodedMap } | { ok: false; error: DecodeError };

const I = SHEET_COPY.ISSUES;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/;
const DAY_MS = 86_400_000;
// Day 0 of Google Sheets serial numbers.
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);
/** Spreadsheet serials from 1900-01-01 up to 9999-12-31; anything else is not a date. */
const isValidSerial = (n: number) => Number.isFinite(n) && n >= 1 && n <= 2958465;

const normalizeKey = (s: string) => headerKey(s);
const isBlank = (cell: Cell | undefined) => cell == null || (typeof cell === 'string' && cell.trim() === '');
const text = (cell: Cell | undefined) => (cell == null ? '' : String(cell).trim());

type Read = { ok: true; value: unknown } | { ok: false; message: string };
const ok = (value: unknown): Read => ({ ok: true, value });
const fail = (message: string): Read => ({ ok: false, message });

function readDate(cell: Cell | undefined): IsoDate | null | undefined {
  if (isBlank(cell)) return null;
  if (typeof cell === 'number') {
    return isValidSerial(cell) ? new Date(SERIAL_EPOCH_MS + Math.floor(cell) * DAY_MS).toISOString().slice(0, 10) : undefined;
  }
  const value = text(cell);
  return /^\d{4}-\d{2}-\d{2}(T.*)?$/.test(value) && isoDateSchema.safeParse(value.slice(0, 10)).success ? value.slice(0, 10) : undefined;
}

/** A hand-typed serial, or a timestamp typed without an offset, is read as UTC, whatever the host's time zone. */
function readDateTime(cell: Cell | undefined): IsoDateTime | null | undefined {
  if (isBlank(cell)) return null;
  if (typeof cell === 'number') return isValidSerial(cell) ? new Date(SERIAL_EPOCH_MS + Math.round(cell * DAY_MS)).toISOString() : undefined;
  const value = text(cell);
  const match = ISO_DATE_TIME.exec(value);
  if (!match) return undefined;
  // Date.parse reads "2026-10-21T10:00" (and "2026-10-21 10:00") in the host's zone, so the time is pinned to UTC.
  const iso = value.replace(' ', 'T') + (match[1] && !match[4] ? 'Z' : '');
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
}

function readBool(cell: Cell | undefined): boolean | undefined {
  if (typeof cell === 'boolean') return cell;
  const value = text(cell).toLowerCase();
  if (['', 'no', 'n', 'false'].includes(value)) return false;
  if (['yes', 'y', 'true', 'x', '✓', '✔'].includes(value)) return true;
  return undefined;
}

function readCell(kind: ColumnKind | InfoFieldKind, cell: Cell | undefined, header: string, enumName?: EnumName): Read {
  const value = text(cell);
  switch (kind) {
    case 'id':
    case 'text':
      return ok(value);
    case 'actor':
      return ok(value || SHEET_COPY.UPDATED_BY_SHEET);
    case 'optionalText':
    case 'ref':
    // A name, as typed: decodeRows finds the row it names.
    case 'nameRef':
      return ok(value || null);
    case 'refList':
      return ok(value.split(',').map((s) => s.trim()).filter(Boolean));
    case 'lines':
      return ok(value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
    case 'enum': {
      if (!value) return ok(null);
      const parsed = valueFor(enumName!, value);
      return parsed ? ok(parsed) : fail(I.NOT_IN_LIST(header, labelsOf(enumName!)));
    }
    case 'email':
      if (!value) return ok(null);
      return EMAIL_PATTERN.test(value) ? ok(value) : fail(I.NOT_EMAIL(header));
    case 'date': {
      const date = readDate(cell);
      return date === undefined ? fail(I.NOT_DATE(header)) : ok(date);
    }
    case 'datetime': {
      const dateTime = readDateTime(cell);
      return dateTime === undefined ? fail(I.NOT_TIME(header)) : ok(dateTime);
    }
    case 'score': {
      if (!value) return ok(null);
      const score = typeof cell === 'number' ? cell : /^[0-3]$/.test(value) ? Number(value) : NaN;
      return [0, 1, 2, 3].includes(score) ? ok(score) : fail(I.NOT_SCORE(header));
    }
    case 'number': {
      if (!value) return ok(null);
      const n = typeof cell === 'number' ? cell : /^-?\d+$/.test(value) ? Number(value) : NaN;
      return Number.isInteger(n) ? ok(n) : fail(I.NOT_NUMBER(header));
    }
    case 'amount': {
      if (!value) return ok(null);
      const n = typeof cell === 'number' ? cell : /^-?\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;
      return Number.isFinite(n) ? ok(n) : fail(I.NOT_AMOUNT(header));
    }
    case 'bool': {
      const flag = readBool(cell);
      return flag === undefined ? fail(I.NOT_YES(header)) : ok(flag);
    }
  }
}

/** A schema message for a cell, starting with its header. A blank cell is "empty", whatever the schema says. */
function schemaMessage(header: string | undefined, message: string, value: unknown): string {
  if (!header) return message;
  if (value === null || value === undefined) return I.EMPTY(header);
  return message.startsWith(header) ? message : `${header}: ${message}`;
}

function setPath(target: Record<string, unknown>, path: string, value: unknown) {
  const keys = path.split('.');
  let at = target;
  for (const key of keys.slice(0, -1)) at = (at[key] ??= {}) as Record<string, unknown>;
  at[keys.at(-1)!] = value;
}

/** Rows after the header, by normalized first cell; the first row wins. */
function readKeyRows(grid: Grid): Map<string, { row: number; cells: Cell[] }> {
  const out = new Map<string, { row: number; cells: Cell[] }>();
  grid.forEach((cells, index) => {
    if (index === 0) return;
    const key = normalizeKey(text(cells[0]));
    if (key && !out.has(key)) out.set(key, { row: index + 1, cells });
  });
  return out;
}

type RowSchema = { safeParse(value: unknown): { success: true; data: unknown } | { success: false; error: Parameters<typeof toFieldErrors>[0] } };

interface Frame<E extends string> {
  /** The workbook as read, upgraded to the current format version. */
  wb: Workbook;
  ids: Record<string, string>;
  columns: Record<E, Record<string, number>>;
  /** The cells the upgrade filled in; empty for a current file. */
  upgrade: UpgradeCell[];
}

/**
 * Checks `_meta` (the version and the ids in `idKeys`), upgrades an older file (version.ts), and finds every entity tab's
 * columns. A file without our `_meta` is not ours; a file older than this app reads is old, whatever its tabs; a missing
 * tab or column is named.
 */
function readFrame<E extends string>(
  kind: WorkbookKind, layout: WorkbookLayout<E>, input: Workbook, idKeys: string[], otherTabs: string[],
): { ok: true; frame: Frame<E> } | { ok: false; error: DecodeError } {
  const error = (kind: DecodeErrorKind, tab: string, message: string) => ({ ok: false as const, error: { kind, tab, message } });
  const metaGrid = input[layout.tabs.meta];
  if (!metaGrid) return error('not_ours', layout.tabs.meta, I.NOT_OURS);
  const meta = readKeyRows(metaGrid);
  const schemaVersion = Number(meta.get('schemaversion')?.cells[1]);
  const ids = Object.fromEntries(idKeys.map((key) => [key, text(meta.get(normalizeKey(key))?.cells[1])]));
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1 || idKeys.some((key) => !ids[key])) return error('not_ours', layout.tabs.meta, I.NOT_OURS);
  if (schemaVersion > CURRENT_SCHEMA_VERSIONS[kind]) return error('newer_version', layout.tabs.meta, I.NEWER_VERSION);
  if (schemaVersion < OLDEST_READABLE_VERSIONS[kind]) return error('old_version', layout.tabs.meta, I.OLD_VERSION);

  const { wb, cells } = upgrade(kind, input, schemaVersion);
  for (const tab of [...otherTabs, ...layout.entityOrder.map((entity) => layout.tabs[entity])]) {
    if (!wb[tab]) return error('missing_tab', tab, I.MISSING_TAB(tab));
  }

  const columns = {} as Record<E, Record<string, number>>;
  for (const entity of layout.entityOrder) {
    const tab = layout.tabs[entity];
    const positions = new Map<string, number>();
    (wb[tab]![0] ?? []).forEach((cell, index) => {
      const key = normalizeKey(text(cell));
      if (key && !positions.has(key)) positions.set(key, index);
    });
    const found: Record<string, number> = {};
    for (const col of layout.columns[entity]) {
      const index = positions.get(normalizeKey(col.header));
      if (index === undefined) return error('missing_column', tab, I.MISSING_COLUMN(tab, col.header));
      found[col.key] = index;
    }
    columns[entity] = found;
  }
  return { ok: true, frame: { wb, ids, columns, upgrade: cells } };
}

interface RowContext<E extends string> {
  issues: RowIssue[];
  /** Every ID cell seen so far, in every tab, including rows left out. */
  seen: Set<string>;
  locations: Map<string, RowLocation<E>>;
  missingIds: Array<MissingId<E>>;
  unreadable: Map<string, Set<string>>;
  /** Per entity a `nameRef` names: its rows read so far, by normalized name (`normalizeName`), the first row winning. */
  names: Map<string, Map<string, string>>;
  /** Per entity a `nameRef` names: the name of each of its rows read so far, by ID. */
  namesById: Map<string, Map<string, string>>;
  /**
   * The `nameRef` columns (as "entity.key") whose header this file's upgrade writes: they held ids before it (a version 2
   * MAP's Review items "Owner ID" and "Milestone ID"), turned into names here, row by row (`asName`).
   */
  heldIds: Set<string>;
  /** The cells that turn those ids into names, in the rows read: the save that upgrades the file writes them. */
  idNames: UpgradeCell[];
  /** Tab names, for the issues of a `nameRef`. */
  tabs: Record<string, string>;
}

/**
 * A cell of a column that held ids before this file's upgrade, as the name it now holds: the name of the row read with
 * that ID, when that name finds the same row (the first row with a name wins). Otherwise the cell as it is: an ID no
 * row read has, or whose name another row has first, reads as a name nobody has, with an issue, and stays in the sheet.
 */
function asName<E extends string>(col: ColumnDef, cell: Cell | undefined, ctx: RowContext<E>): string | null {
  const id = text(cell);
  const name = id ? ctx.namesById.get(col.refersTo!)?.get(id) : undefined;
  return name !== undefined && ctx.names.get(col.refersTo!)?.get(normalizeName(name)) === id ? name : null;
}

/** The ID a `nameRef` cell names, or the issue when no row read has that name. A blank cell is null. */
function readNameRef<E extends string>(col: ColumnDef, cell: Cell | undefined, ctx: RowContext<E>): Read {
  const value = text(cell);
  if (!value) return ok(null);
  const id = ctx.names.get(col.refersTo!)?.get(normalizeName(value));
  return id === undefined ? fail(I.UNKNOWN_NAME(col.header, ctx.tabs[col.refersTo!]!)) : ok(id);
}

/**
 * Indexes the rows of `entity` just read by name, for the `nameRef` columns that name them. A row whose name an earlier
 * row has is kept with an issue on its Name: a reference names the first of them, as in the MAP app.
 */
function indexNames<E extends string>(entity: E, tab: string, defs: ColumnDef[], rows: object[], ctx: RowContext<E>) {
  const header = defs.find((col) => col.key === 'name')?.header ?? 'Name';
  const index = new Map<string, string>();
  const byId = new Map<string, string>();
  for (const row of rows as Array<{ id: string; name: string }>) {
    byId.set(row.id, row.name);
    const key = normalizeName(row.name);
    if (!index.has(key)) {
      index.set(key, row.id);
      continue;
    }
    ctx.issues.push({ tab, row: ctx.locations.get(row.id)!.row, message: I.SAME_NAME(header, tab) });
  }
  ctx.names.set(entity, index);
  ctx.namesById.set(entity, byId);
}

/** A rule a whole row must meet beyond core's schema: the issue's message when it doesn't, else null. */
type RowRule = (row: Record<string, unknown>) => string | null;

/**
 * The rows that can be read. A row is left out, with its issues, when a cell can't be read or the row breaks a core
 * rule (or `rule`); except that a value that may be empty and can't be read is held empty, and the row kept with an
 * issue. A column marked `leavesRowOut` never is: holding it empty would misread the row (an unreadable Closed is not
 * "open").
 */
function decodeRows<E extends string>(
  entity: E, tab: string, defs: ColumnDef[], schema: RowSchema, frame: Frame<E>, ctx: RowContext<E>, fixed: Record<string, unknown>,
  rule?: RowRule,
): object[] {
  const grid = frame.wb[tab]!;
  const columns = frame.columns[entity];
  const byKey = new Map<string, ColumnDef>(defs.map((col) => [col.key, col]));
  const out: object[] = [];
  for (let index = 1; index < grid.length; index++) {
    const cells = grid[index] ?? [];
    if (defs.every((col) => isBlank(cells[columns[col.key]!]))) continue;
    const row = index + 1;
    const cellId = text(cells[columns.id!]);
    const duplicate = cellId !== '' && ctx.seen.has(cellId);
    const usable = cellId !== '' && !duplicate;
    const id = usable ? cellId : `tmp_${entity}_${row}`;
    if (cellId) ctx.seen.add(cellId);
    const issue = (message: string) => ctx.issues.push({ tab, row, message });
    if (duplicate) issue(I.DUPLICATE_ID);

    const record: Record<string, unknown> = { ...fixed, id };
    const unreadable = new Map<string, string>();
    const idNames: UpgradeCell[] = [];
    for (const col of defs) {
      if (col.kind === 'id') continue;
      let cell = cells[columns[col.key]!];
      const name = ctx.heldIds.has(`${entity}.${col.key}`) ? asName(col, cell, ctx) : null;
      if (name !== null) {
        cell = name;
        idNames.push({ tab, row, col: columns[col.key]!, value: name, anchorCol: columns.id! });
      }
      const read = col.kind === 'nameRef' ? readNameRef(col, cell, ctx) : readCell(col.kind, cell, col.header, col.enumName);
      if (read.ok) setPath(record, col.key, read.value);
      else {
        setPath(record, col.key, null);
        unreadable.set(col.key, read.message);
      }
    }
    for (const message of unreadable.values()) issue(message);
    if (defs.some((col) => col.leavesRowOut && unreadable.has(col.key))) continue;

    const parsed = schema.safeParse(record);
    if (!parsed.success) {
      for (const [path, message] of Object.entries(toFieldErrors(parsed.error))) {
        if (!unreadable.has(path)) issue(schemaMessage(byKey.get(path)?.header, message, getPath(record, path)));
      }
      continue;
    }
    const broken = rule?.(parsed.data as Record<string, unknown>);
    if (broken) {
      issue(broken);
      continue;
    }
    out.push(parsed.data as object);
    // Only a row read gets its names written: a row left out is never written.
    ctx.idNames.push(...idNames);
    ctx.locations.set(id, { entity, tab, row });
    if (!usable) ctx.missingIds.push({ entity, row, provisionalId: id });
    if (unreadable.size > 0) ctx.unreadable.set(id, new Set(unreadable.keys()));
  }
  return out;
}

/**
 * `rule(entity, items)` gives a tab's row rule, from the rows of the tabs read before it: `entityOrder`, except that a
 * tab another tab's `nameRef` names is read first, so its names are known.
 */
function decodeAllRows<E extends string>(
  layout: WorkbookLayout<E>, frame: Frame<E>, schemas: Record<E, RowSchema>, issues: RowIssue[], fixed: (entity: E) => Record<string, unknown>,
  rule: (entity: E, items: Partial<Record<E, object[]>>) => RowRule | undefined = () => undefined,
) {
  const heldIds = new Set(layout.entityOrder.flatMap((entity) => layout.columns[entity]
    .filter((col) => col.kind === 'nameRef' && frame.upgrade.some((c) => c.tab === layout.tabs[entity] && c.row === 1
      && c.col === frame.columns[entity][col.key] && c.value === col.header))
    .map((col) => `${entity}.${col.key}`)));
  const ctx: RowContext<E> = {
    issues, seen: new Set(), locations: new Map(), missingIds: [], unreadable: new Map(), names: new Map(), namesById: new Map(), heldIds,
    idNames: [], tabs: layout.tabs,
  };
  const named = new Set(layout.entityOrder.flatMap((entity) => layout.columns[entity].flatMap((col) => (col.refersTo ? [col.refersTo] : []))));
  const order = [...layout.entityOrder.filter((e) => named.has(e)), ...layout.entityOrder.filter((e) => !named.has(e))];
  const items = {} as Record<E, object[]>;
  for (const entity of order) {
    const tab = layout.tabs[entity];
    items[entity] = decodeRows(entity, tab, layout.columns[entity], schemas[entity], frame, ctx, fixed(entity), rule(entity, items));
    if (named.has(entity)) indexNames(entity, tab, layout.columns[entity], items[entity], ctx);
  }
  return {
    items,
    rows: {
      issues, columns: frame.columns, locations: ctx.locations, missingIds: ctx.missingIds, unreadable: ctx.unreadable,
      // The names go before `_meta`'s version, the upgrade's last cell.
      upgrade: [...frame.upgrade.filter((c) => c.tab !== layout.tabs.meta), ...ctx.idNames, ...frame.upgrade.filter((c) => c.tab === layout.tabs.meta)],
    },
  };
}

/**
 * A Partners row whose company is not among the Accounts rows read (an unknown id, or a company row left out) is left
 * out with an issue, like any row that can't be read, so it is never written. People keep an unknown company, as rows
 * keep a deleted partner: core's `danglingRefs` reports them.
 */
function knownAccount(items: Partial<Record<PartnerEntity, object[]>>): RowRule {
  const accounts = new Set((items.account as Array<{ id: string }> | undefined ?? []).map((a) => a.id));
  const message = I.UNKNOWN_ACCOUNT(accountRef.header, PARTNERS_LAYOUT.tabs.account);
  return (row) => (accounts.has(row.accountId as string) ? null : message);
}

export function decodePartnerBook(input: Workbook): DecodeResult<PartnerBook> {
  const layout = PARTNERS_LAYOUT;
  const read = readFrame('partners', layout, input, ['companyId'], []);
  if (!read.ok) return read;
  const companyId = read.frame.ids.companyId!;
  const { items, rows } = decodeAllRows(
    layout, read.frame, PARTNER_ENTITY_SCHEMAS, [], (entity) => (entity === 'partner' ? { companyId } : {}),
    (entity, decoded) => (entity === 'partner' ? knownAccount(decoded) : undefined),
  );
  const book = { companyId } as Record<string, unknown>;
  for (const entity of layout.entityOrder) book[COLLECTION[entity]] = items[entity];
  return { ok: true, value: { value: book as unknown as PartnerBook, ...rows } };
}

const DEFAULT_INFO: Omit<MarketInfo, 'marketId' | 'companyId'> = {
  marketName: '', partnerType: 'reseller', ourProduct: '', ourTargetCustomers: '', whyPartnerRoute: '', mustHaves: [],
  howMarketBuys: 'unknown', howMarketBuysNote: '', statement: '', expectedCandidates: null, status: 'open', statusNote: '',
  copiedFrom: null, feedsProgramId: null, checkAgain: [], updatedAt: null, updatedBy: SHEET_COPY.UPDATED_BY_SHEET,
};

/** The Market tab never stops a market from loading: an unreadable or missing value keeps its default. */
function decodeInfo(grid: Grid, ids: Record<string, string>, issues: RowIssue[]) {
  const layout = MARKET_LAYOUT;
  const rows = readKeyRows(grid);
  const info: Record<string, unknown> = { ...DEFAULT_INFO, marketId: ids.marketId, companyId: ids.companyId, checkAgain: [] };
  const infoRows: Partial<Record<InfoKey, number>> = {};
  const flagged = new Set<string>();
  const issue = (row: number, message: string) => issues.push({ tab: layout.tabs.info, row, message });

  for (const field of layout.infoFields) {
    const entry = [field.label, ...(field.formerLabels ?? [])].map((label) => rows.get(normalizeKey(label))).find((e) => e !== undefined);
    if (!entry) {
      if (!field.optional) issue(0, I.MISSING_ROW(field.label));
      continue;
    }
    infoRows[field.key] = entry.row;
    const read = readCell(field.kind, entry.cells[layout.infoColumns.value], field.label, field.enumName);
    if (read.ok) info[field.key] = read.value;
    else {
      flagged.add(field.key);
      issue(entry.row, read.message);
    }
    const checkAgain = readBool(entry.cells[layout.infoColumns.checkAgain]);
    if (checkAgain === undefined) issue(entry.row, I.NOT_YES(SHEET_COPY.HEADERS.checkAgain));
    else if (checkAgain && (MARKET_FIELD_NAMES as string[]).includes(field.key)) (info.checkAgain as string[]).push(field.key);
  }

  const parsed = marketInfoSchema.safeParse(info);
  if (!parsed.success) {
    for (const [key, message] of Object.entries(toFieldErrors(parsed.error))) {
      const field = layout.infoFields.find((f) => f.key === key);
      const row = field ? infoRows[field.key] ?? 0 : 0;
      if (!flagged.has(key)) issue(row, schemaMessage(field?.label, message, info[key]));
      if (field) flagged.add(key);
      if (key in DEFAULT_INFO) info[key] = DEFAULT_INFO[key as keyof typeof DEFAULT_INFO];
    }
  }
  return { info: info as unknown as MarketInfo, infoRows, unreadableInfo: flagged as Set<keyof MarketInfo> };
}

export function decodeMarket(input: Workbook): DecodeResult<Market> {
  const layout = MARKET_LAYOUT;
  const read = readFrame('market', layout, input, ['marketId', 'companyId'], [layout.tabs.info]);
  if (!read.ok) return read;
  const issues: RowIssue[] = [];
  const { info, infoRows, unreadableInfo } = decodeInfo(read.frame.wb[layout.tabs.info]!, read.frame.ids, issues);
  const { items, rows } = decodeAllRows(layout, read.frame, MARKET_ENTITY_SCHEMAS, issues, () => ({}));
  const market = { info } as Record<string, unknown>;
  for (const entity of layout.entityOrder) market[MARKET_COLLECTION[entity]] = items[entity];
  return { ok: true, value: { value: market as unknown as Market, ...rows, infoRows, unreadableInfo } };
}

const DEFAULT_PLAN: Pick<MapInfo, 'horizonDays' | 'laterHorizons' | 'nextReviewDate'> = {
  horizonDays: DEFAULT_HORIZON_DAYS, laterHorizons: [], nextReviewDate: null,
};

/**
 * A MAP's Plan tab, one field per row found by its label. The partner type's id and type must be readable: they say
 * which partner type the MAP belongs to. Any other value that is missing or can't be read keeps its default, with an
 * issue, and never stops the MAP from loading.
 */
function decodePlanTab(grid: Grid, issues: RowIssue[]): { ok: true; info: MapInfo } & DecodedPlan | { ok: false; error: DecodeError } {
  const layout = MAP_LAYOUT;
  const tab = layout.tabs.plan;
  const rows = readKeyRows(grid);
  const info: Record<string, unknown> = { ...DEFAULT_PLAN, laterHorizons: [] };
  const planRows: DecodedPlan['planRows'] = {};
  const unreadablePlan: DecodedPlan['unreadablePlan'] = new Set();
  const structure = (message: string) => ({ ok: false as const, error: { kind: 'missing_row' as const, tab, message } });

  for (const field of layout.planFields) {
    const entry = rows.get(normalizeKey(field.label));
    if (!entry) {
      if (field.needed === 'file') return structure(I.MISSING_ROW(field.label));
      if (field.needed === 'issue') issues.push({ tab, row: 0, message: I.MISSING_ROW(field.label) });
      continue;
    }
    planRows[field.key] = entry.row;
    const cell = entry.cells[layout.planColumns.value];
    let read: Read;
    switch (field.kind) {
      case 'days': {
        const days = readDays(cell);
        read = days !== null && horizonDaysSchema.safeParse(days).success ? ok(days) : fail(SHEET_COPY.MAP.HORIZON_DAYS_HINT);
        break;
      }
      case 'horizons': {
        // The horizons that can be read stand in for the cell, so the current horizon is still known.
        const parsed = parseLaterHorizons(cell);
        info[field.key] = parsed.value;
        read = parsed.ok ? ok(parsed.value) : fail(SHEET_COPY.MAP.LATER_HORIZONS_HINT);
        break;
      }
      default:
        read = readCell(field.kind, cell, field.label, field.enumName);
    }
    if (field.needed === 'file') {
      if (!read.ok) return structure(read.message);
      if (read.value === null || read.value === '') return structure(I.EMPTY(field.label));
    }
    if (read.ok) info[field.key] = read.value;
    else {
      unreadablePlan.add(field.key);
      issues.push({ tab, row: entry.row, message: read.message });
    }
  }
  return { ok: true, info: info as unknown as MapInfo, planRows, unreadablePlan };
}

/**
 * A review's number or item whose review is not among the Reviews rows read (deleted by hand, or a row left out) is
 * left out with an issue, so it is never written: a save never deletes or changes it, and it stays in the file as typed.
 */
function knownReview(items: Partial<Record<EntityKind, object[]>>): RowRule {
  const reviews = new Set((items.review as Array<{ id: string }> | undefined ?? []).map((r) => r.id));
  const { columns, tabs } = MAP_LAYOUT;
  const message = I.UNKNOWN_ACCOUNT(columns.reviewNumber.find((col) => col.key === 'reviewId')!.header, tabs.review);
  return (row) => (reviews.has(row.reviewId as string) ? null : message);
}

/**
 * A MAP's file: the Plan tab, then the list tabs, the MAP app's tabs and columns, then the review tabs. An activity's
 * Owner and Milestone are found by name on the People and Milestones tabs; a name no readable row has is held empty,
 * with an issue. A version 1 file has no review tabs: it reads with none (version.ts).
 */
export function decodeMap(input: Workbook): MapDecodeResult {
  const layout = MAP_LAYOUT;
  const read = readFrame('map', layout, input, ['companyId'], [layout.tabs.plan]);
  if (!read.ok) return read;
  const issues: RowIssue[] = [];
  const plan = decodePlanTab(read.frame.wb[layout.tabs.plan]!, issues);
  if (!plan.ok) return plan;
  const { items, rows } = decodeAllRows(
    layout, read.frame, MAP_ENTITY_SCHEMAS as Record<EntityKind, RowSchema>, issues, () => ({}),
    (entity, decoded) => (entity === 'reviewNumber' || entity === 'reviewItem' ? knownReview(decoded) : undefined),
  );
  const value = { info: plan.info } as Record<string, unknown>;
  for (const entity of layout.entityOrder) value[MAP_COLLECTION[entity]] = items[entity];
  return { ok: true, value: { value: value as unknown as MapPlan, ...rows, planRows: plan.planRows, unreadablePlan: plan.unreadablePlan } };
}

// One planner over both workbooks, driven by a WorkbookSpec (the layout, the decoder and core's batch functions). A
// MAP's file (MAP_SPEC) is planned the same way, as the MAP app's plan writer did: rows by id, an Owner or Milestone
// rewritten when the name it shows changes, the Plan tab cell by cell.
import {
  applyMarketChanges, applyPartnerChanges, COLLECTION, currentLaterHorizon, MAP_COLLECTION, MARKET_COLLECTION, MARKET_REF_KEYS,
  newId, newMapEntityId, REF_KEYS, remapMarketChange, remapPartnerChange, type ChangeStamp, type EntityKind, type MapInfo, type MapPlan,
  type Market, type MarketChange, type MarketEntity, type MarketInfo, type PartnerBook, type PartnerChange, type PartnerEntity,
} from '@partner-desk/core';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { applyMapFileChanges, remapMapFileChange } from '../map-changes';
import type { MapFileChange, StoreErrorCode } from '../types';
import {
  decodeMap, decodeMarket, decodePartnerBook, type DecodeError, type DecodeErrorKind, type DecodedInfo, type DecodedMap, type DecodedRows,
  type RowLocation,
} from '../sheet-codec/decode';
import { encodeEntity, encodeInfoRow, encodePlanValue, mapNames, type NameLookup } from '../sheet-codec/encode';
import type { Cell, Workbook } from '../sheet-codec/grid';
import { MARKET_LAYOUT, PARTNERS_LAYOUT, type MarketWorkbookLayout, type WorkbookLayout } from '../sheet-codec/layouts';
import { MAP_LAYOUT, MAP_REF_KEYS } from '../sheet-codec/map-layout';
import type { UpgradeCell } from '../sheet-codec/version';
import { appendRows, cellText } from './append-rows';

/**
 * Row writes for the stores that keep a workbook (Google Sheets, and the database edition's rows). Apply them in array order. Rows are 1-based sheet rows.
 * Deletes come last, so earlier row numbers stay valid. A batch may delete several rows (a company's last partner type,
 * its people and the company): within a tab they come bottom row first, so each delete's row number is still right
 * when it is applied. Every delete's row is as the sheet stands after the other writes, before any delete.
 * An append goes after the last row with any content (`lastContentRow`), including content only in columns the user
 * added. Only the listed cells are written:
 * - An update carries the cells whose value changed, every cell the change's patch names on the row it targets (so
 *   correcting a cell rewrites it even when the decoded value is unchanged; a partial object field names only its
 *   sub-fields' columns), and the ID cell for a newly identified row.
 * - Only rows the codec decoded are ever addressed. A row it left out (a bad row) is never written.
 * - A value the codec couldn't read is held empty in the decoded row, and the sheet keeps what was typed. Its cell is
 *   written only when the change sets that field (a patch that names it, or a change whose result differs), so the
 *   empty stand-in never goes back into the sheet. On the Market tab only an `updateInfo` that names the field writes it.
 * - Unknown columns are never written. Appends carry every known column.
 * - A file of an older format version gets the cells its upgrade adds (new headers or rows, and `_meta`'s version)
 *   first, on any save: an update on the header row or `_meta` row, checked like any row, and its `expectCells` (the
 *   cells it fills, as they were read: blank, or the old version) checked too; a new row checked blank. An append goes
 *   below a row the upgrade adds (`appendRows`).
 *
 * Adapter contract:
 * - Serialize applies per file: never run two applies against the same file at once.
 * - Before each update or delete, read the row's ID cell (0-based column `idCol`; on the Market tab this is the label
 *   column) and compare it, as trimmed text with a blank cell as '', to `expectId`. On a mismatch the sheet changed
 *   since it was decoded (rows inserted, sorted or deleted by hand): abort the apply without writing further, then
 *   re-read and retry the change, or fail it with a conflict. When `expectId` is '' (a row without an ID yet) the ID
 *   cell proves nothing: compare the whole row instead.
 * - Before appending, check that the rows an append will fill are still blank.
 * - Check every delete's row again just before deleting, all of them before the first, and delete them in one request
 *   (all or nothing), in array order.
 * - A `positional` change names a row without an ID by its provisional, row-number-based id. After a re-read that id
 *   may name another row, so on a mismatch fail such a change with a conflict instead of retrying it.
 */
export type CellWrite = { col: number; value: Cell };
export type RowWrite =
  | { op: 'update'; tab: string; row: number; expectId: string; idCol: number; cells: CellWrite[]; expectCells?: CellWrite[] }
  | { op: 'append'; tab: string; cells: CellWrite[] }
  | { op: 'delete'; tab: string; row: number; expectId: string; idCol: number };

type Decoded<T, E extends string> = DecodedRows<T, E> & Partial<DecodedInfo>;
type Refusal = { ok: false; error: 'not_found' | 'invalid' | 'conflict'; message: string; fieldErrors?: Record<string, string> };
type BatchOutcome<T> = { ok: true; value: T; entityIds: Array<string | null> } | (Refusal & { valid: number });

/** What the planner needs to know about one kind of workbook. */
export interface WorkbookSpec<T, C, E extends string> {
  layout: WorkbookLayout<E>;
  decode(wb: Workbook): { ok: true; value: Decoded<T, E> } | { ok: false; error: DecodeError };
  /** Entity → the value's list of its rows. */
  collection: Record<E, string>;
  /** Row fields that hold ids of rows in the same file. */
  refKeys: readonly string[];
  /**
   * Applies the changes. `idFor`, when given, is the id a provisional `values.id` is saved under (a single change
   * keeps it). Without it, a batch replaces provisional ids with new ones.
   */
  applyChanges(value: T, changes: C[], stamp: ChangeStamp, idFor?: (entity: string, provisional: string) => string): BatchOutcome<T>;
  /** The change with the ids `ids` replaces rewritten, in its target and its references. */
  remap(change: C, ids: Record<string, string>): C;
  /**
   * A last check of the changes against the file as it is: rows the codec left out are not in the value, so core's
   * rules can't see them. A refusal, with how many changes came before the one refused, or null.
   */
  guard?(wb: Workbook, decoded: Decoded<T, E>, changes: C[]): (Refusal & { valid: number }) | null;
  /** The names of the rows a `nameRef` column names, in a value (a MAP's people and milestones). */
  names?(value: T): NameLookup;
  /** The id a row without one gets on the next write. Without it, core's `newId` (or the stamp's). */
  newId?(entity: E): string;
  /** Writes beyond the entity rows (a MAP's Plan tab), from the value before and after the changes. */
  extraWrites?(decoded: Decoded<T, E>, before: T, after: T, changes: C[], idCellAt: (tab: string, row: number, idCol: number) => string): RowWrite[];
}

/**
 * A company is deleted only when no Partners row still names it. A partner type row the codec left out (an unreadable
 * Closed or Exited cell, a row that breaks a rule) is invisible to core's PARTNER_HAS_TYPES check, so it is checked
 * here, in the sheet itself.
 */
function guardHiddenPartnerTypes(wb: Workbook, decoded: Decoded<PartnerBook, PartnerEntity>, changes: PartnerChange[]) {
  const tab = PARTNERS_LAYOUT.tabs.partner;
  const grid = wb[tab] ?? [];
  const accountCol = decoded.columns.partner.accountId;
  if (accountCol === undefined) return null;
  const read = new Set([...decoded.locations.values()].filter((l) => l.entity === 'partner').map((l) => l.row));
  for (const [index, change] of changes.entries()) {
    if (change.kind !== 'delete' || change.entity !== 'account') continue;
    for (let i = 1; i < grid.length; i++) {
      if (read.has(i + 1) || cellText(grid[i]?.[accountCol]) !== change.id) continue;
      return { ok: false as const, error: 'invalid' as const, message: COPY.ROW_STILL_NAMES_PARTNER(tab, i + 1), valid: index };
    }
  }
  return null;
}

export const PARTNERS_SPEC: WorkbookSpec<PartnerBook, PartnerChange, PartnerEntity> = {
  layout: PARTNERS_LAYOUT, decode: decodePartnerBook, collection: COLLECTION, refKeys: REF_KEYS,
  applyChanges: (book, changes, stamp, idFor) => applyPartnerChanges(
    book, changes, stamp, idFor === undefined ? undefined : (kind, provisional) => idFor(kind, provisional),
  ), remap: remapPartnerChange, guard: guardHiddenPartnerTypes,
};

export const MARKET_SPEC: WorkbookSpec<Market, MarketChange, MarketEntity> = {
  layout: MARKET_LAYOUT, decode: decodeMarket, collection: MARKET_COLLECTION, refKeys: MARKET_REF_KEYS,
  applyChanges: (market, changes, stamp, idFor) => applyMarketChanges(
    market, changes, stamp, idFor === undefined ? undefined : (kind, provisional) => idFor(kind, provisional),
  ), remap: remapMarketChange,
};

/**
 * Which Plan tab fields the changes set. A new length goes to the current horizon: the first one's `horizonDays`, or a
 * later horizon's entry (core's `applyMapChange`).
 */
function namedPlanFields(before: MapPlan, after: MapPlan, changes: MapFileChange[]): Set<keyof MapInfo> {
  const named = new Set<keyof MapInfo>();
  for (const change of changes) {
    if (change.kind === 'startHorizon') named.add('laterHorizons');
    if (change.kind !== 'updateInfo') continue;
    if (Object.hasOwn(change.patch, 'nextReviewDate')) named.add('nextReviewDate');
    if (Object.hasOwn(change.patch, 'horizonDays')) {
      const later = currentLaterHorizon(before.info, change.record) !== null || currentLaterHorizon(after.info, change.record) !== null;
      named.add(later ? 'laterHorizons' : 'horizonDays');
    }
  }
  return named;
}

/**
 * The Plan tab's writes: the value cell of each field whose value changed or that the changes set, a missing row added
 * back at the end. A value the codec couldn't read is the person's: it stays until a change sets that field.
 */
function planTabWrites(
  decoded: Decoded<MapPlan, EntityKind>, before: MapPlan, after: MapPlan, changes: MapFileChange[],
  idCellAt: (tab: string, row: number, idCol: number) => string,
): RowWrite[] {
  const d = decoded as DecodedMap;
  const { tabs, planColumns, planFields } = MAP_LAYOUT;
  const named = namedPlanFields(before, after, changes);
  const writes: RowWrite[] = [];
  for (const field of planFields) {
    const old = encodePlanValue(field, before.info);
    const next = encodePlanValue(field, after.info);
    if (d.unreadablePlan.has(field.key) && !named.has(field.key)) continue;
    if (next === old && !named.has(field.key)) continue;
    const row = d.planRows[field.key];
    const { label, value } = planColumns;
    writes.push(row
      ? { op: 'update', tab: tabs.plan, row, expectId: idCellAt(tabs.plan, row, label), idCol: label, cells: [{ col: value, value: next }] }
      : { op: 'append', tab: tabs.plan, cells: [{ col: label, value: field.label }, { col: value, value: next }] });
  }
  return writes;
}

/**
 * Later horizons the codec could read only in part are never written over: a new horizon, or a new length once the
 * partner type is signed (it may belong to a later horizon), is refused until the row is fixed in the sheet.
 */
function guardLaterHorizons(_wb: Workbook, decoded: Decoded<MapPlan, EntityKind>, changes: MapFileChange[]) {
  if (!(decoded as DecodedMap).unreadablePlan.has('laterHorizons')) return null;
  const index = changes.findIndex((change) => change.kind === 'startHorizon'
    || (change.kind === 'updateInfo' && Object.hasOwn(change.patch, 'horizonDays') && change.record.signedDate !== null));
  if (index === -1) return null;
  const message = SHEET_COPY.ISSUES.FIX_ROW_FIRST(SHEET_COPY.MAP.PLAN_FIELDS.laterHorizons, MAP_LAYOUT.tabs.plan);
  return { ok: false as const, error: 'invalid' as const, message, valid: index };
}

export const MAP_SPEC: WorkbookSpec<MapPlan, MapFileChange, EntityKind> = {
  layout: MAP_LAYOUT, decode: decodeMap, collection: MAP_COLLECTION, refKeys: MAP_REF_KEYS,
  applyChanges: (plan, changes, stamp) => applyMapFileChanges(plan, changes, stamp), remap: remapMapFileChange, guard: guardLaterHorizons,
  names: mapNames, newId: newMapEntityId, extraWrites: planTabWrites,
};

/**
 * The store error for a file the codec can't read at all, chosen by the error's kind (never by its words). Most kinds
 * are a 'structure' problem: the file is there, but not in a shape this app can use. A file made by an earlier version
 * is 'old_version', so the app can offer a new file in its place.
 */
const DECODE_ERROR_CODE: Record<DecodeErrorKind, StoreErrorCode> = {
  not_ours: 'structure', newer_version: 'structure', old_version: 'old_version', missing_tab: 'structure', missing_column: 'structure',
  missing_row: 'structure',
};

export type StructureFailure = { ok: false; error: StoreErrorCode; message: string; tab: string };

export const decodeFailure = (error: DecodeError): StructureFailure =>
  ({ ok: false, error: DECODE_ERROR_CODE[error.kind], message: error.message, tab: error.tab });

/**
 * A batch's plan. `columns`: where each entity's known columns are in the file (key → 0-based index). `valid`: when a
 * change was refused, how many came before it.
 */
export type ChangesPlan<T, E extends string> =
  | { ok: true; value: T; entityIds: Array<string | null>; writes: RowWrite[]; positional: boolean; columns: Record<E, Record<string, number>> }
  | StructureFailure
  | (Refusal & { valid?: number });

type Item = { id: string } & Record<string, unknown>;
type AnyChange = { kind: string; entity?: string; id?: string; patch?: Record<string, unknown> };

const isMarketLayout = (layout: WorkbookLayout<string>): layout is MarketWorkbookLayout => 'infoFields' in layout;

/** `values` with every id in a ref field passed through `id`. */
function translateRefs(values: Record<string, unknown>, refKeys: readonly string[], id: (value: string) => string): Record<string, unknown> {
  const out = { ...values };
  for (const key of refKeys) {
    const value = out[key];
    if (typeof value === 'string') out[key] = id(value);
    else if (Array.isArray(value)) out[key] = value.map((v) => (typeof v === 'string' ? id(v) : v));
  }
  return out;
}

function replaceIds<T, C, E extends string>(spec: WorkbookSpec<T, C, E>, value: T, ids: Record<string, string>): T {
  if (Object.keys(ids).length === 0) return value;
  const id = (v: string) => ids[v] ?? v;
  const out = { ...value } as Record<string, unknown>;
  for (const entity of spec.layout.entityOrder) {
    const key = spec.collection[entity];
    out[key] = (out[key] as Item[]).map((item) => ({ ...translateRefs(item, spec.refKeys, id), id: id(item.id) }));
  }
  return out as T;
}

/**
 * Whether `patch` sets the column at dotted `path`: the whole path, or an object field the patch sets as a whole value.
 * A patch of `{ desk: { credibility: 2 } }` names "desk.credibility" and none of the other desk columns.
 */
function namesPath(patch: Record<string, unknown>, path: string): boolean {
  let at: unknown = patch;
  for (const key of path.split('.')) {
    if (typeof at !== 'object' || at === null || Array.isArray(at)) return true;
    if (!Object.hasOwn(at, key)) return false;
    at = (at as Record<string, unknown>)[key];
  }
  return true;
}

/**
 * Plans the row writes that make the file hold `changes` applied in order (core's batch function) to the value as it
 * is in `wb` now: one set of writes for the whole batch, from the value before and after. All or nothing: when any
 * change is refused, there is no plan.
 */
export function planChanges<T, C, E extends string>(
  spec: WorkbookSpec<T, C, E>, wb: Workbook, changes: C[], stamp: ChangeStamp,
  idFor?: (entity: string, provisional: string) => string,
): ChangesPlan<T, E> {
  const decoded = spec.decode(wb);
  if (!decoded.ok) return decodeFailure(decoded.error);
  const d = decoded.value;
  const { layout } = spec;
  const refusal = spec.guard?.(wb, d, changes);
  if (refusal) return refusal;

  // 0. An older file: the cells its upgrade adds go first. The rest of the plan reads the file as they leave it.
  const upgrade = upgradeWrites(wb, d.upgrade);
  const file = upgrade.length > 0 ? applyWrites(wb, upgrade) : wb;

  /** What a row's ID cell holds in the file right now (after the upgrade's cells, which this save writes first). */
  const idCellAt = (tab: string, row: number, idCol: number) => cellText(file[tab]?.[row - 1]?.[idCol]);
  const rowKey = (location: RowLocation<E>) => {
    const idCol = d.columns[location.entity].id!;
    return { idCol, expectId: idCellAt(location.tab, location.row, idCol) };
  };

  // 1. Every row without a usable ID gets a real one on this write.
  const makeId = spec.newId ?? ((entity: E) => (stamp.newId ?? newId)(entity as unknown as PartnerEntity | MarketEntity));
  const ids: Record<string, string> = {};
  for (const missing of d.missingIds) ids[missing.provisionalId] = makeId(missing.entity);
  const locations = new Map(d.locations);
  const unreadable = new Map(d.unreadable);
  for (const [provisional, real] of Object.entries(ids)) {
    locations.set(real, locations.get(provisional)!);
    locations.delete(provisional);
    const typed = unreadable.get(provisional);
    if (typed) unreadable.set(real, typed);
    unreadable.delete(provisional);
  }
  const newlyIdentified = new Set(Object.values(ids));

  // 2. Apply the changes in the domain, to the value as decoded from the file.
  const before = replaceIds(spec, d.value, ids);
  const translated = changes.map((change) => spec.remap(change, ids));
  const outcome = spec.applyChanges(before, translated, stamp, idFor);
  if (!outcome.ok) return outcome;
  const after = outcome.value;

  // 3. The Market tab, cell by cell, and a MAP's Plan tab.
  const writes: RowWrite[] = [
    ...upgrade,
    ...(isMarketLayout(layout)
      ? infoWrites(layout, d, (before as Market).info, (after as Market).info, translated as MarketChange[], idCellAt)
      : []),
    ...(spec.extraWrites?.(d, before, after, translated, idCellAt) ?? []),
  ];

  // 4. Entity rows: updates in row order, then appends, then deletes.
  const deletes: Extract<RowWrite, { op: 'delete' }>[] = [];
  const named = (entity: E, id: string, key: string) =>
    (translated as AnyChange[]).some((t) => t.kind === 'update' && t.entity === entity && t.id === id && namesPath(t.patch!, key));
  const itemsOf = (value: T, entity: E) => (value as Record<string, unknown>)[spec.collection[entity]] as Item[];
  // A row that names another by its name (a MAP's Owner) is written again when that name changes.
  const namesBefore = spec.names?.(before);
  const namesAfter = spec.names?.(after);
  for (const entity of layout.entityOrder) {
    const tab = layout.tabs[entity];
    const defs = layout.columns[entity];
    const columns = d.columns[entity];
    const afterById = new Map(itemsOf(after, entity).map((item) => [item.id, item]));
    const beforeIds = new Set<string>();
    const tabDeletes: Extract<RowWrite, { op: 'delete' }>[] = [];
    for (const previous of itemsOf(before, entity)) {
      beforeIds.add(previous.id);
      const location = locations.get(previous.id)!;
      const fresh = newlyIdentified.has(previous.id);
      const current = afterById.get(previous.id);
      const old = encodeEntity(defs, previous, namesBefore);
      const next = current ? encodeEntity(defs, current, namesAfter) : old;
      // `old` holds an unreadable value as empty; the comparison keeps that stand-in out unless the change sets the field.
      const cells = defs
        .filter((col) => (current && (next[col.key] !== old[col.key] || named(entity, previous.id, col.key))) || (col.key === 'id' && fresh))
        .map((col) => ({ col: columns[col.key]!, value: next[col.key]! }));
      if (cells.length > 0) writes.push({ op: 'update', tab, row: location.row, ...rowKey(location), cells });
      if (!current) {
        const { idCol, expectId } = rowKey(location);
        // A newly identified row had its real id written just above.
        tabDeletes.push({ op: 'delete', tab, row: location.row, idCol, expectId: fresh ? previous.id : expectId });
      }
    }
    // Bottom row first, so the rows above keep their numbers.
    deletes.push(...tabDeletes.sort((a, b) => b.row - a.row));
    for (const item of itemsOf(after, entity)) {
      if (beforeIds.has(item.id)) continue;
      const encoded = encodeEntity(defs, item, namesAfter);
      writes.push({ op: 'append', tab, cells: defs.map((col) => ({ col: columns[col.key]!, value: encoded[col.key]! })) });
    }
  }
  writes.push(...deletes);

  // A change that names a row by its provisional, row-number-based id is changed by the remap.
  const positional = changes.some((change, i) => JSON.stringify(translated[i]) !== JSON.stringify(change));
  return { ok: true, value: after, entityIds: outcome.entityIds, writes, positional, columns: d.columns };
}

/**
 * The upgrade's cells as row writes, one per row. A row with an anchor (the header row's ID cell, a `_meta` key) is
 * checked by it; a row that was blank (a new Market tab row) is checked blank, as a row without an ID is.
 */
function upgradeWrites(wb: Workbook, cells: UpgradeCell[]): RowWrite[] {
  const rows = new Map<string, Extract<RowWrite, { op: 'update' }>>();
  for (const cell of cells) {
    const key = `${cell.tab}\u0000${cell.row}`;
    let write = rows.get(key);
    if (!write) {
      const idCol = cell.anchorCol ?? 0;
      const expectId = cell.anchorCol === null ? '' : cellText(wb[cell.tab]?.[cell.row - 1]?.[idCol]);
      write = { op: 'update', tab: cell.tab, row: cell.row, expectId, idCol, cells: [], expectCells: [] };
      rows.set(key, write);
    }
    write.cells.push({ col: cell.col, value: cell.value });
    write.expectCells!.push({ col: cell.col, value: cellText(wb[cell.tab]?.[cell.row - 1]?.[cell.col]) });
  }
  return [...rows.values()];
}

/** The Market tab's writes: a value cell and a "Check again" cell per field row, a missing row added back at the end. */
function infoWrites(
  layout: MarketWorkbookLayout, d: Partial<DecodedInfo>, before: MarketInfo, after: MarketInfo, translated: MarketChange[],
  idCellAt: (tab: string, row: number, idCol: number) => string,
): RowWrite[] {
  const { label, value, checkAgain } = layout.infoColumns;
  const tab = layout.tabs.info;
  const namedInfo = (key: keyof MarketInfo) => translated.some((t) => t.kind === 'updateInfo' && Object.hasOwn(t.patch, key));
  const writes: RowWrite[] = [];
  for (const field of layout.infoFields) {
    const old = encodeInfoRow(field, before);
    const next = encodeInfoRow(field, after);
    // A value the codec couldn't read is the user's: it stays until they edit that field. The app owns Updated.
    const keep = !!d.unreadableInfo?.has(field.key) && field.key !== 'updatedAt' && !namedInfo(field.key);
    const cells: CellWrite[] = [];
    if (!keep && (next[value] !== old[value] || namedInfo(field.key))) cells.push({ col: value, value: next[value]! });
    if (next[checkAgain] !== old[checkAgain]) cells.push({ col: checkAgain, value: next[checkAgain]! });
    if (cells.length === 0) continue;
    const row = d.infoRows?.[field.key];
    // A field whose row is missing (an optional row, or one deleted by hand) gets its row back at the end of the tab.
    writes.push(row
      ? { op: 'update', tab, row, expectId: idCellAt(tab, row, label), idCol: label, cells }
      : { op: 'append', tab, cells: next.map((cell, col) => ({ col, value: cell })) });
  }
  return writes;
}

/** `wb` with `writes` applied, as a store applies them; throws when a row's ID cell isn't what the write expects. */
export function applyWrites(wb: Workbook, writes: RowWrite[]): Workbook {
  const out: Workbook = Object.fromEntries(Object.entries(wb).map(([tab, grid]) => [tab, grid.map((row) => row.slice())]));
  const appended = appendRows(wb, writes);
  for (const write of writes) {
    const grid = (out[write.tab] ??= []);
    if (write.op !== 'append') {
      const found = cellText(grid[write.row - 1]?.[write.idCol]);
      if (found !== write.expectId) {
        // Only the expected ID: the cell may now hold the user's content, which never goes into logs.
        throw new Error(`Row ${write.row} of "${write.tab}" changed since it was read: expected ID "${write.expectId}"`);
      }
      if (write.op === 'update' && write.expectCells?.some((c) => cellText(grid[write.row - 1]?.[c.col]) !== cellText(c.value))) {
        throw new Error(`Row ${write.row} of "${write.tab}" changed since it was read`);
      }
    }
    if (write.op === 'delete') {
      grid.splice(write.row - 1, 1);
      continue;
    }
    const index = write.op === 'update' ? write.row - 1 : appended.get(write)! - 1;
    const row = grid[index] ?? [];
    for (const cell of write.cells) row[cell.col] = cell.value;
    for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
    grid[index] = row;
  }
  return out;
}

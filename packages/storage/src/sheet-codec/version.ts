// One format version and one list of migrations per kind of workbook. Each migration also says which cells it fills
// in, so the next save writes them.
import { SHEET_COPY } from '@partner-desk/copy';
import { FIGURES, OUR_COST_COLUMNS, OUR_COSTS_TAB } from './case-records';
import { headerKey, lastContentRow, type Cell, type Grid, type Workbook } from './grid';
import { PARTNERS_LAYOUT } from './layouts';
import { MAP_LAYOUT, REVIEW_KINDS } from './map-layout';
import { COMPANY_TAB } from './program-records';

/**
 * `program` and `companyFacts` are Program Designer's layout (program-layout.ts): Setting / Value tabs and list tabs.
 * `businessCase` is one business case in the same layout (case-layout.ts). `map` is one MAP (map-layout.ts).
 */
export const WORKBOOK_KINDS = ['partners', 'market', 'program', 'companyFacts', 'businessCase', 'map'] as const;
export type WorkbookKind = (typeof WORKBOOK_KINDS)[number];

/**
 * The format version each kind of workbook is written with. Partners version 2 added the Accounts tab (one row per
 * company); version 1 files are not upgraded (owner, 2026-10-29): they read as old, and the app offers a new file.
 * Partners version 3 added the Program and Level columns, version 4 the MAP health and Next milestone columns, market
 * version 2 the "Feeds program" row, Partners version 5 the Proposals tab (spec 7.1): older files are upgraded on read and
 * written on their next save. Company facts
 * version 2 added our figures and the Our cost lines tab, MAP version 2 the three review tabs and MAP version 3 a review
 * item's Owner and Milestone by name and the review's "Sent to" (owner, 2026-11-01), upgraded the same way.
 */
export const CURRENT_SCHEMA_VERSIONS: Record<WorkbookKind, number> = { partners: 5, market: 2, program: 1, companyFacts: 2, businessCase: 1, map: 3 };

/** The oldest version of each kind this app reads. An older file is "old": not read, not upgraded. */
export const OLDEST_READABLE_VERSIONS: Record<WorkbookKind, number> = { partners: 2, market: 1, program: 1, companyFacts: 1, businessCase: 1, map: 1 };

/**
 * One cell an upgrade fills in. `row` is 1-based, `col` 0-based. `anchorCol` is the column whose cell shows the row is
 * still the one that was read (the header row's ID cell, a `_meta` key), or null for a row that was blank: the writer
 * checks it before writing, as for any row it writes.
 */
export interface UpgradeCell {
  tab: string;
  row: number;
  col: number;
  value: Cell;
  anchorCol: number | null;
}

/** A workbook as this app reads it, and the cells that took it there from the file. */
export interface Upgrade {
  wb: Workbook;
  cells: UpgradeCell[];
}

const META_TAB = '_meta';
const H = SHEET_COPY.HEADERS;

const isBlank = (cell: Cell | undefined) => cell == null || (typeof cell === 'string' && cell.trim() === '');

/** Columns in use: up to the last cell with anything in it, in any row (a column the person added included). */
function usedWidth(grid: Grid): number {
  let width = 0;
  for (const row of grid) {
    for (let end = row.length; end > width; end--) {
      if (!isBlank(row[end - 1])) {
        width = end;
        break;
      }
    }
  }
  return width;
}

/**
 * New headers for an entity tab, after every column in use, so no column of the person's own is taken over. A header
 * the tab already has (typed by hand) is kept where it is. Every row below reads them as empty.
 */
function addColumns(wb: Workbook, tab: string, headers: string[]): UpgradeCell[] {
  const grid = wb[tab];
  const keys = (grid?.[0] ?? []).map((cell) => headerKey(cell));
  const idCol = keys.indexOf(headerKey(H.id));
  // Without the tab or its ID column the decoder says what is missing; there is nothing to add to.
  if (!grid || idCol === -1) return [];
  let col = usedWidth(grid);
  return headers
    .filter((header) => !keys.includes(headerKey(header)))
    .map((value) => ({ tab, row: 1, col: col++, value, anchorCol: idCol }));
}

/** Partners 2 → 3: the Program and Level columns. */
const addProgramColumns = (wb: Workbook) => addColumns(wb, SHEET_COPY.TABS.partners, [H.program, H.level]);
/** Partners 3 → 4: the MAP health and Next milestone columns (spec 5.7). */
const addMapColumns = (wb: Workbook) => addColumns(wb, SHEET_COPY.TABS.partners, [H.mapHealth, H.mapNextMilestone]);

/** Market 1 → 2: the "Feeds program" row, below the last row in use on the Market tab, its value empty. */
function addFeedsProgramRow(wb: Workbook): UpgradeCell[] {
  const tab = SHEET_COPY.TABS.market;
  const grid = wb[tab];
  const label = SHEET_COPY.INFO_FIELDS.feedsProgramId;
  if (!grid || grid.slice(1).some((row) => headerKey(row[0]) === headerKey(label))) return [];
  return [{ tab, row: lastContentRow(grid) + 1, col: 0, value: label, anchorCol: null }];
}

const settingKey = (cell: Cell | undefined) => String(cell ?? '').trim().toLowerCase();

/**
 * Company facts 1 → 2: our figures' settings, below the last row in use on the Company facts tab with their values
 * empty (read as 0 and Assumption), and the Our cost lines tab's header. A figure setting a person already typed is
 * kept where it is; an Our cost lines tab with anything in it is left alone.
 */
function addOurFigures(wb: Workbook): UpgradeCell[] {
  const cells: UpgradeCell[] = [];
  const grid = wb[COMPANY_TAB];
  const settingCol = (grid?.[0] ?? []).findIndex((cell) => settingKey(cell) === 'setting');
  // Without the tab or its Setting column the decoder says what is missing; there is nothing to add to.
  if (grid && settingCol >= 0) {
    const have = new Set(grid.slice(1).map((row) => settingKey(row[settingCol])));
    let row = lastContentRow(grid);
    for (const name of Object.values(FIGURES)) {
      if (!have.has(settingKey(name))) cells.push({ tab: COMPANY_TAB, row: ++row, col: settingCol, value: name, anchorCol: null });
    }
  }
  // A tab made by an earlier save that failed before its header was written is empty: it gets the header too.
  if (lastContentRow(wb[OUR_COSTS_TAB]) === 0) {
    OUR_COST_COLUMNS.forEach((value, col) => cells.push({ tab: OUR_COSTS_TAB, row: 1, col, value, anchorCol: null }));
  }
  return cells;
}

/**
 * An added tab's header row, in a tab that is missing or empty (made by an earlier save that failed before its header
 * was written). A tab with anything in it is left alone: the decoder then names a missing column.
 */
function addTab(wb: Workbook, tab: string, headers: readonly string[]): UpgradeCell[] {
  if (lastContentRow(wb[tab]) > 0) return [];
  return headers.map((value, col): UpgradeCell => ({ tab, row: 1, col, value, anchorCol: null }));
}

/** Partners 4 → 5: the Proposals tab, with its header row and no rows (spec 7.1), as MAP 1 → 2 added the review tabs. */
const addProposalsTab = (wb: Workbook) =>
  addTab(wb, PARTNERS_LAYOUT.tabs.proposalItem, PARTNERS_LAYOUT.columns.proposalItem.map((col) => col.header));

/** MAP 1 → 2: the Reviews, Review numbers and Review items tabs, each with its header row and no rows (spec 7). */
function addReviewTabs(wb: Workbook): UpgradeCell[] {
  return REVIEW_KINDS.flatMap((entity) => addTab(wb, MAP_LAYOUT.tabs[entity], MAP_LAYOUT.columns[entity].map((col) => col.header)));
}

const headerOf = (entity: 'review' | 'reviewItem', key: string) => MAP_LAYOUT.columns[entity].find((col) => col.key === key)!.header;

/**
 * MAP 2 → 3 (owner, 2026-11-01): the Review items tab names its Owner and Milestone as the Activities tab does, and a
 * review says whom its summary went to.
 * - Reviews: the "Sent to" header after every column in use; every review reads it as empty.
 * - Review items: "About ID" becomes "Activity or hypothesis ID" (still an ID); "Owner ID" and "Milestone ID" become
 *   "Owner" and "Milestone". The ids in those two columns are turned into names by the decoder, from the People and
 *   Milestones rows it reads (decode.ts, `heldIds` and `asName`), and only in rows it reads.
 * A header already in its new form, or one a person changed, is left alone, so a file a save upgraded in part is not
 * upgraded twice (the decoder names a missing column).
 */
function reviewNames(wb: Workbook): UpgradeCell[] {
  const cells = addColumns(wb, MAP_LAYOUT.tabs.review, [headerOf('review', 'summarySentTo')]);
  const tab = MAP_LAYOUT.tabs.reviewItem;
  const grid = wb[tab];
  const keys = (grid?.[0] ?? []).map((cell) => headerKey(cell));
  const idCol = keys.indexOf(headerKey(H.id));
  if (!grid || idCol === -1) return cells;
  const V2 = SHEET_COPY.MAP.V2_REVIEW_ITEM_HEADERS;
  for (const key of ['refId', 'ownerId', 'milestoneId'] as const) {
    const col = keys.indexOf(headerKey(V2[key]));
    const header = headerOf('reviewItem', key);
    if (col === -1 || keys.includes(headerKey(header))) continue;
    cells.push({ tab, row: 1, col, value: header, anchorCol: idCol });
  }
  return cells;
}

// MIGRATIONS[kind][n] upgrades a workbook of that kind from schema version OLDEST + n to OLDEST + n + 1.
const MIGRATIONS: Record<WorkbookKind, Array<(wb: Workbook) => UpgradeCell[]>> = {
  partners: [addProgramColumns, addMapColumns, addProposalsTab], market: [addFeedsProgramRow], program: [], companyFacts: [addOurFigures], businessCase: [],
  map: [addReviewTabs, reviewNames],
};

/** `wb` with `cells` set, without changing `wb`. */
function withCells(wb: Workbook, cells: UpgradeCell[]): Workbook {
  const out: Workbook = { ...wb };
  const copied = new Set<string>();
  for (const cell of cells) {
    if (!copied.has(cell.tab)) {
      out[cell.tab] = (wb[cell.tab] ?? []).slice();
      copied.add(cell.tab);
    }
    const grid = out[cell.tab]!;
    while (grid.length < cell.row) grid.push([]);
    const row = (grid[cell.row - 1] = grid[cell.row - 1]!.slice());
    while (row.length < cell.col) row.push('');
    row[cell.col] = cell.value;
  }
  return out;
}

/**
 * The workbook upgraded from `fromVersion` to the current version, and every cell that took: the migrations' cells,
 * then `_meta`'s schemaVersion. A current file comes back as it is, with no cells.
 */
export function upgrade(kind: WorkbookKind, wb: Workbook, fromVersion: number): Upgrade {
  const current = CURRENT_SCHEMA_VERSIONS[kind];
  if (fromVersion >= current) return { wb, cells: [] };
  let out = wb;
  const cells: UpgradeCell[] = [];
  for (let version = fromVersion; version < current; version++) {
    const step = MIGRATIONS[kind][version - OLDEST_READABLE_VERSIONS[kind]]!(out);
    out = withCells(out, step);
    cells.push(...step);
  }
  const versionRow = (out[META_TAB] ?? []).findIndex((row, i) => i > 0 && headerKey(row[0]) === headerKey('schemaVersion'));
  if (versionRow > 0) {
    const cell: UpgradeCell = { tab: META_TAB, row: versionRow + 1, col: 1, value: current, anchorCol: 0 };
    out = withCells(out, [cell]);
    cells.push(cell);
  }
  return { wb: out, cells };
}

export function migrate(kind: WorkbookKind, wb: Workbook, fromVersion: number): Workbook {
  return upgrade(kind, wb, fromVersion).wb;
}

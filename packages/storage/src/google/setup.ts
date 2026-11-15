// The Google Sheets setup of both workbooks, from their layouts.
import { SHEET_COPY } from '@partner-desk/copy';
import type { Workbook } from '../sheet-codec/grid';
import { labelsOf } from '../sheet-codec/labels';
import type { MarketWorkbookLayout, WorkbookLayout } from '../sheet-codec/layouts';
import { isMapLayout } from '../sheet-codec/map-layout';

/** Dropdowns cover rows 2 to 1,000 of each entity tab: Google's 1,000 rows. A tab grown later gets them on its new rows. */
export const VALIDATED_ROWS = 1000;
const SCORE_CHOICES = ['0', '1', '2', '3'];

/** Google's width for a new tab. Google refuses formatting, dropdowns and protection past a tab's last column. */
const DEFAULT_COLUMNS = 26;

export interface TabLayout { title: string; sheetId: number; hidden: boolean; frozenRows: number; columnCount: number }

const isMarketLayout = (layout: WorkbookLayout<string>): layout is MarketWorkbookLayout => 'infoFields' in layout;

/** Every tab of a new workbook, in order. A tab's sheetId is its position, so the blank tab Drive makes (0) comes first. */
export function tabLayout<E extends string>(layout: WorkbookLayout<E>): TabLayout[] {
  const widths: Record<string, number> = Object.fromEntries(layout.entityOrder.map((entity) => [layout.tabs[entity], layout.columns[entity].length]));
  if (isMarketLayout(layout)) widths[layout.tabs.info] = layout.infoHeader.length;
  if (isMapLayout(layout)) widths[layout.tabs.plan] = layout.planHeader.length;
  return layout.tabOrder.map((title, index) => ({
    title,
    sheetId: index,
    hidden: title === layout.tabs.meta,
    frozenRows: title === layout.tabs.start || title === layout.tabs.meta ? 0 : 1,
    // Never narrower than Google's default, so a person keeps room for their own columns.
    columnCount: Math.max(DEFAULT_COLUMNS, widths[title] ?? 0),
  }));
}

const dropdown = (sheetId: number, rows: [number, number], col: number, choices: string[]) => ({
  setDataValidation: {
    range: { sheetId, startRowIndex: rows[0], endRowIndex: rows[1], startColumnIndex: col, endColumnIndex: col + 1 },
    rule: {
      condition: { type: 'ONE_OF_LIST', values: choices.map((v) => ({ userEnteredValue: v })) },
      showCustomUi: true,
      strict: true,
    },
  },
});

/**
 * The dropdowns of an entity tab's list and score columns, for 0-based rows [from, to). `columnOf` gives a column's
 * position (a person may have moved columns); a column it doesn't know gets none.
 */
export function entityDropdowns<E extends string>(
  layout: WorkbookLayout<E>, entity: E, sheetId: number, rows: [number, number], columnOf: (key: string) => number | undefined,
): unknown[] {
  return layout.columns[entity].flatMap((col) => {
    const index = columnOf(col.key);
    if (index === undefined) return [];
    if (col.kind === 'enum') return [dropdown(sheetId, rows, index, labelsOf(col.enumName!))];
    if (col.kind === 'score') return [dropdown(sheetId, rows, index, SCORE_CHOICES)];
    return [];
  });
}

const width = (sheetId: number, col: number, pixelSize: number) => ({
  updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: col, endIndex: col + 1 }, properties: { pixelSize }, fields: 'pixelSize' },
});

const boldHeader = (sheetId: number) => ({
  repeatCell: {
    range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
    cell: { userEnteredFormat: { textFormat: { bold: true } } },
    fields: 'userEnteredFormat.textFormat.bold',
  },
});

/** Warning-only: Sheets asks before the edit, and the person can go ahead. */
const protect = (range: Record<string, number>) => ({
  addProtectedRange: { protectedRange: { range, description: SHEET_COPY.DRIVE.protectedNote, warningOnly: true } },
});
const idColumn = (sheetId: number, col = 0) => protect({ sheetId, startColumnIndex: col, endColumnIndex: col + 1 });
const headerRow = (sheetId: number) => protect({ sheetId, startRowIndex: 0, endRowIndex: 1 });

/**
 * Turns the blank spreadsheet Drive creates (one tab, sheetId 0) into a PartnerStandard Desk workbook: every tab in order,
 * `_meta` hidden, headers frozen and bold, ID columns, header rows and `_meta` protected (warning only), and dropdowns
 * for list and score columns. `wb` is the encoded workbook, for the Market tab's or a MAP's Plan tab's rows. Values are written separately,
 * with valueInputOption RAW.
 */
export function setupRequests<E extends string>(layout: WorkbookLayout<E>, wb: Workbook): unknown[] {
  const tabs = tabLayout(layout);
  const sheetIdOf = (title: string) => tabs.find((t) => t.title === title)!.sheetId;
  const [start, ...rest] = tabs;
  const requests: unknown[] = [
    { updateSheetProperties: { properties: { sheetId: 0, title: start!.title, index: 0 }, fields: 'title,index' } },
    ...rest.map((t) => ({
      addSheet: {
        properties: {
          sheetId: t.sheetId, title: t.title, index: t.sheetId, hidden: t.hidden,
          gridProperties: { frozenRowCount: t.frozenRows, columnCount: t.columnCount },
        },
      },
    })),
    width(sheetIdOf(layout.tabs.start), 0, 640),
    boldHeader(sheetIdOf(layout.tabs.start)),
  ];

  if (isMarketLayout(layout)) {
    // The Market tab: its label column is the rows' ID.
    const { label, value } = layout.infoColumns;
    const marketTab = sheetIdOf(layout.tabs.info);
    requests.push(boldHeader(marketTab), width(marketTab, label, 220), width(marketTab, value, 420), idColumn(marketTab, label), headerRow(marketTab));
    for (const field of layout.infoFields) {
      if (field.kind !== 'enum') continue;
      const row = (wb[layout.tabs.info] ?? []).findIndex((r) => r[label] === field.label);
      // The codec writes every label, so a miss is codec drift: fail the create rather than make a sheet without it.
      if (row < 1) throw new Error(`Setup: no "${field.label}" row on the Market tab`);
      requests.push(dropdown(marketTab, [row, row + 1], value, labelsOf(field.enumName!)));
    }
  }

  if (isMapLayout(layout)) {
    // A MAP's Plan tab: its label column is the rows' ID.
    const { label, value } = layout.planColumns;
    const planTab = sheetIdOf(layout.tabs.plan);
    requests.push(boldHeader(planTab), width(planTab, label, 200), width(planTab, value, 280), idColumn(planTab, label), headerRow(planTab));
    for (const field of layout.planFields) {
      if (field.kind !== 'enum') continue;
      const row = (wb[layout.tabs.plan] ?? []).findIndex((r) => r[label] === field.label);
      // The codec writes every label, so a miss is codec drift: fail the create rather than make a sheet without it.
      if (row < 1) throw new Error(`Setup: no "${field.label}" row on the Plan tab`);
      requests.push(dropdown(planTab, [row, row + 1], value, labelsOf(field.enumName!)));
    }
  }

  for (const entity of layout.entityOrder) requests.push(...entityTabFormat(layout, entity, sheetIdOf(layout.tabs[entity])));

  requests.push(protect({ sheetId: sheetIdOf(layout.tabs.meta) }));
  return requests;
}

/** An entity tab's header bold, its widths and dropdowns, and its ID column and header row protected (warning only). */
function entityTabFormat<E extends string>(layout: WorkbookLayout<E>, entity: E, sheetId: number): unknown[] {
  const columns = layout.columns[entity];
  return [
    boldHeader(sheetId),
    ...columns.map((col, index) => width(sheetId, index, col.kind === 'id' ? 100 : 200)),
    ...entityDropdowns(layout, entity, sheetId, [1, VALIDATED_ROWS], (key) => columns.findIndex((col) => col.key === key)),
    idColumn(sheetId),
    headerRow(sheetId),
  ];
}

/**
 * An entity tab a save writes to that the file doesn't have yet (one a format upgrade adds, such as a MAP's Reviews):
 * made at `index` and set up as a new file's would be. Its header row is written with the save.
 */
export function addEntityTabRequests<E extends string>(layout: WorkbookLayout<E>, entity: E, sheetId: number, index: number): unknown[] {
  const title = layout.tabs[entity];
  const columnCount = Math.max(DEFAULT_COLUMNS, layout.columns[entity].length);
  return [
    { addSheet: { properties: { sheetId, title, index, gridProperties: { frozenRowCount: 1, columnCount } } } },
    ...entityTabFormat(layout, entity, sheetId),
  ];
}

/**
 * Turns the blank spreadsheet Drive creates (one tab, sheetId 0) into a Company facts or program file (Program
 * Designer's layout): every tab in order, a tab's sheetId its position; the data tabs' header rows frozen and bold;
 * `_meta` hidden and protected (warning only). Values are written separately, with valueInputOption RAW.
 */
export function settingsFileSetupRequests(tabs: readonly string[], dataTabs: readonly string[], metaTab: string): unknown[] {
  const frozen = (title: string) => (dataTabs.includes(title) ? 1 : 0);
  const [first, ...rest] = tabs;
  return [
    {
      updateSheetProperties: {
        properties: { sheetId: 0, title: first, index: 0, gridProperties: { frozenRowCount: frozen(first!) } },
        fields: 'title,index,gridProperties.frozenRowCount',
      },
    },
    ...rest.map((title, i) => ({
      addSheet: { properties: { sheetId: i + 1, title, index: i + 1, hidden: title === metaTab, gridProperties: { frozenRowCount: frozen(title) } } },
    })),
    ...tabs.flatMap((title, sheetId) => (dataTabs.includes(title) ? [boldHeader(sheetId)] : [])),
    protect({ sheetId: tabs.indexOf(metaTab) }),
  ];
}

/**
 * A tab a save writes to that the file doesn't have yet (one a format upgrade adds, such as Company facts' Our cost
 * lines): made at `index`, with a data tab's header row frozen and bold.
 */
export function addTabRequests(title: string, sheetId: number, index: number, dataTab: boolean): unknown[] {
  return [
    { addSheet: { properties: { sheetId, title, index, gridProperties: { frozenRowCount: dataTab ? 1 : 0 } } } },
    ...(dataTab ? [boldHeader(sheetId)] : []),
  ];
}

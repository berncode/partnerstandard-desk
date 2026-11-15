// The encoders for both workbooks, with an "Updated by" column.
import {
  COLLECTION, MAP_COLLECTION, MARKET_COLLECTION, type MapInfo, type MapPlan, type Market, type MarketField, type MarketInfo, type PartnerBook,
} from '@partner-desk/core';
import { SHEET_COPY } from '@partner-desk/copy';
import type { ColumnDef, InfoFieldDef } from './columns';
import type { Cell, Grid, Workbook } from './grid';
import { labelFor } from './labels';
import { MARKET_LAYOUT, PARTNERS_LAYOUT, type WorkbookLayout } from './layouts';
import { formatLaterHorizons, MAP_LAYOUT, type PlanFieldDef } from './map-layout';
import { CURRENT_SCHEMA_VERSIONS, type WorkbookKind } from './version';

export interface WorkbookMeta {
  /** Link to the partners or the market in the app, shown on the "Start here" tab. */
  appUrl: string;
}

export const CREATED_WITH = 'desk.partnerstandard.com';

/** The value at a dotted path such as 'desk.customerBase'. */
export function getPath(value: object, path: string): unknown {
  return path.split('.').reduce<unknown>((at, key) => (at == null ? undefined : (at as Record<string, unknown>)[key]), value);
}

/** The name of row `id` of `entity`, for a `nameRef` cell; undefined when there is no such row. */
export type NameLookup = (entity: string, id: string) => string | undefined;

/**
 * Every cell is plain data: text is written exactly as typed, even when it starts with `=`, `+`, `-` or `@`.
 * The stores write cells raw (valueInputOption RAW), so a sheet never reads them as formulas. A `nameRef` is written as
 * the name `names` gives, never as an ID: blank without one.
 */
export function encodeCell(def: Pick<ColumnDef, 'kind' | 'enumName' | 'refersTo'>, value: unknown, names?: NameLookup): Cell {
  if (value == null) return '';
  switch (def.kind) {
    case 'nameRef':
      return names?.(def.refersTo!, String(value)) ?? '';
    case 'enum':
      return labelFor(def.enumName!, String(value));
    case 'bool':
      return value === true ? 'yes' : '';
    case 'score':
    case 'number':
    case 'amount':
      return Number(value);
    case 'refList':
      return (value as string[]).join(', ');
    default:
      return String(value);
  }
}

/** Column key → cell, for every known column. `names` names the rows a `nameRef` column holds. */
export function encodeEntity(columns: ColumnDef[], value: object, names?: NameLookup): Record<string, Cell> {
  const out: Record<string, Cell> = {};
  for (const def of columns) out[def.key] = encodeCell(def, getPath(value, def.key), names);
  return out;
}

/**
 * The row for `value` with each known column at its position in `positions` (column key → 0-based index, as decoded).
 * Cells of other columns are taken from `base`, the row as it is in the sheet, so columns the user added are kept.
 */
export function encodeRow(columns: ColumnDef[], value: object, positions: Record<string, number>, base: Cell[] = []): Cell[] {
  const row = base.slice();
  const cells = encodeEntity(columns, value);
  for (const def of columns) row[positions[def.key]!] = cells[def.key]!;
  for (let i = 0; i < row.length; i++) if (row[i] === undefined) row[i] = '';
  return row;
}

export function encodeInfoValue(field: InfoFieldDef, info: MarketInfo): Cell {
  const value = info[field.key];
  if (value == null) return '';
  switch (field.kind) {
    case 'lines':
      return (value as string[]).join('\n');
    case 'enum':
      return labelFor(field.enumName!, String(value));
    case 'number':
      return Number(value);
    default:
      return String(value);
  }
}

/** A Market tab row: label, value, "Check again". */
export function encodeInfoRow(field: InfoFieldDef, info: MarketInfo): Cell[] {
  const flagged = info.checkAgain.includes(field.key as MarketField);
  return [field.label, encodeInfoValue(field, info), flagged ? 'yes' : ''];
}

const S = SHEET_COPY.START_HERE;

function startHereRows(appUrl: string, open: string, lines: string[]): Grid {
  return [[S.title], [''], [open], [appUrl], [''], [S.database], [S.adminOnly], ...lines.map((line) => [line])];
}

function entityTabs<E extends string>(layout: WorkbookLayout<E>, itemsOf: (entity: E) => readonly object[], names?: NameLookup): Workbook {
  const wb: Workbook = {};
  for (const entity of layout.entityOrder) {
    const columns = layout.columns[entity];
    wb[layout.tabs[entity]] = [
      columns.map((c) => c.header),
      ...itemsOf(entity).map((item) => {
        const cells = encodeEntity(columns, item, names);
        return columns.map((c) => cells[c.key]!);
      }),
    ];
  }
  return wb;
}

function metaRows(kind: WorkbookKind, ids: Array<[string, string]>): Grid {
  return [['key', 'value'], ['schemaVersion', CURRENT_SCHEMA_VERSIONS[kind]], ...ids, ['createdWith', CREATED_WITH]];
}

/** Tabs in `tabOrder`, so a store that creates them from the workbook keeps the order. */
function inOrder(tabOrder: string[], tabs: Workbook): Workbook {
  return Object.fromEntries(tabOrder.map((tab) => [tab, tabs[tab]!]));
}

export function encodePartnerBook(book: PartnerBook, meta: WorkbookMeta): Workbook {
  const layout = PARTNERS_LAYOUT;
  return inOrder(layout.tabOrder, {
    [layout.tabs.start]: startHereRows(meta.appUrl, S.openPartners, [S.keepIds, S.accounts, S.partnerLists, S.scores, S.dates, S.mapColumns, S.proposals]),
    ...entityTabs(layout, (entity) => book[COLLECTION[entity]]),
    [layout.tabs.meta]: metaRows('partners', [['companyId', book.companyId]]),
  });
}

/** The market's company id sits in `_meta` too, next to the market id: the file says whose market it is. */
export function encodeMarket(market: Market, meta: WorkbookMeta): Workbook {
  const layout = MARKET_LAYOUT;
  return inOrder(layout.tabOrder, {
    [layout.tabs.start]: startHereRows(meta.appUrl, S.openMarket, [S.keepIds, S.marketLists, S.dates]),
    [layout.tabs.info]: [[...layout.infoHeader], ...layout.infoFields.map((field) => encodeInfoRow(field, market.info))],
    ...entityTabs(layout, (entity) => market[MARKET_COLLECTION[entity]]),
    [layout.tabs.meta]: metaRows('market', [['marketId', market.info.marketId], ['companyId', market.info.companyId]]),
  });
}

/** The names of a MAP's people and milestones, for its activities' Owner and Milestone cells. */
export function mapNames(plan: MapPlan): NameLookup {
  return (entity, id) => (entity === 'person' ? plan.people : entity === 'milestone' ? plan.milestones : []).find((row) => row.id === id)?.name;
}

/** A Plan tab value as its cell holds it. */
export function encodePlanValue(field: PlanFieldDef, info: MapInfo): Cell {
  const value = info[field.key];
  if (field.kind === 'horizons') return formatLaterHorizons(info.laterHorizons);
  if (value == null) return '';
  if (field.kind === 'enum') return labelFor(field.enumName!, String(value));
  if (field.kind === 'days') return Number(value);
  return String(value);
}

const MS = SHEET_COPY.MAP.START_HERE;

/** A MAP's file: the MAP app's tabs, the Plan tab without what the partner record holds, and its company in `_meta`. */
export function encodeMap(plan: MapPlan, companyId: string, meta: WorkbookMeta): Workbook {
  const layout = MAP_LAYOUT;
  return inOrder(layout.tabOrder, {
    [layout.tabs.start]: startHereRows(meta.appUrl, MS.open, [S.keepIds, MS.lists, MS.names, S.dates, MS.reviews]),
    [layout.tabs.plan]: [[...layout.planHeader], ...layout.planFields.map((field) => [field.label, encodePlanValue(field, plan.info)])],
    ...entityTabs(layout, (entity) => plan[MAP_COLLECTION[entity]], mapNames(plan)),
    [layout.tabs.meta]: metaRows('map', [['companyId', companyId]]),
  });
}

// Test support: hand edits on a workbook's grids, as a person typing in Google Sheets, for the storage contract's
// hand-edit cases. Not production code. Moved from google/raw-access.ts (plan 13, task 8) so the same edits run on
// fake Google and on the database edition's rows: both hold the same workbook.
import type { ColumnDef, ColumnKind, InfoFieldKind } from './sheet-codec/columns';
import { decodeMap, decodeMarket, decodePartnerBook } from './sheet-codec/decode';
import { encodeCell, encodeEntity } from './sheet-codec/encode';
import { lastContentRow, type Cell, type Grid, type Workbook } from './sheet-codec/grid';
import type { MarketWorkbookLayout, WorkbookLayout } from './sheet-codec/layouts';
import { isMapLayout } from './sheet-codec/map-layout';
import type { RawAccess, SettingsRawAccess } from './types';

/** Where the hand edits happen: a store's files as workbooks, read and replaced whole. */
export interface HandEditTarget {
  getWorkbook(fileId: string): Promise<Workbook>;
  setWorkbook(fileId: string, wb: Workbook): Promise<void>;
  /**
   * What else `dump` shows of a file, so a "writes nothing" check sees any write: Google's tab sizes (a grown grid),
   * the database row's revision and time (a body written again unchanged). Undefined where there is nothing more.
   */
  state?(fileId: string): Promise<unknown>;
  /** Renames a tab, keeping its rows and place. */
  renameTab(fileId: string, from: string, to: string): Promise<void>;
}

const INFO = 'info';
const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const text = (cell: Cell | undefined) => (cell == null ? '' : String(cell).trim());
const blankRow = (row: Cell[] | undefined) => (row ?? []).every((cell) => text(cell) === '');

/** What a person might type that the app can't read, per kind of cell. Text cells read anything. */
const UNREADABLE: Partial<Record<ColumnKind | InfoFieldKind, Cell>> = {
  enum: 'Pending', score: 'high', number: 'a dozen', amount: '12k', date: 'next spring', datetime: 'last Tuesday', email: 'not an email',
  bool: 'perhaps',
};

/** Values a person fills in when typing a row whose kind needs them (a person's role has no empty choice). */
const TYPED_DEFAULTS: Record<string, Record<string, unknown>> = { person: { role: 'contact' } };

const isMarketLayout = (layout: WorkbookLayout<string>): layout is MarketWorkbookLayout => 'infoFields' in layout;

/** RawAccess on a target's workbooks of one kind. Entity 'info' (id 'info') is the Market tab. */
export function workbookRawAccess<E extends string>(target: HandEditTarget, layout: WorkbookLayout<E>): RawAccess {
  type Decode = (wb: Workbook) => { ok: true; value: { locations: Map<string, unknown> } } | { ok: false };
  const decode: Decode = isMarketLayout(layout) ? decodeMarket : isMapLayout(layout) ? decodeMap : decodePartnerBook;
  const tabOf = (entity: string) => (entity === INFO && isMarketLayout(layout) ? layout.tabs.info : layout.tabs[entity as E]);
  const defsOf = (entity: string): ColumnDef[] => layout.columns[entity as E];
  const gridOf = (wb: Workbook, entity: string): Grid => {
    const grid = wb[tabOf(entity)];
    if (!grid) throw new Error(`no tab for ${entity}`);
    return grid;
  };
  const colOf = (grid: Grid, header: string) => {
    const col = (grid[0] ?? []).findIndex((cell) => normalize(text(cell)) === normalize(header));
    if (col === -1) throw new Error(`no column ${header}`);
    return col;
  };
  const idCol = (grid: Grid, entity: string) => colOf(grid, defsOf(entity)[0]!.header);
  const defOf = (entity: string, key: string) => {
    const def = defsOf(entity).find((d) => d.key === key);
    if (!def) throw new Error(`no column for ${entity}.${key}`);
    return def;
  };

  /** 0-based index of the row holding `id` (or, on the Market tab, field `id`'s row; `key` is then the field). */
  function rowIndex(grid: Grid, entity: string, id: string, key?: string): number {
    if (entity === INFO && isMarketLayout(layout)) {
      const field = layout.infoFields.find((f) => f.key === key);
      const labels = [field?.label ?? '', ...(field?.formerLabels ?? [])].map(normalize);
      const index = grid.findIndex((row, i) => i > 0 && labels.includes(normalize(text(row[layout.infoColumns.label]))));
      if (index === -1) throw new Error(`no Market row for ${key}`);
      return index;
    }
    const col = idCol(grid, entity);
    const index = grid.findIndex((row, i) => i > 0 && text(row[col]) === id);
    if (index === -1) throw new Error(`no ${entity} row ${id}`);
    return index;
  }

  /** The cell a field sits in: its column on an entity tab, the value column on the Market tab. */
  function cellOf(grid: Grid, entity: string, id: string, field: string): { row: number; col: number; kind: ColumnKind | InfoFieldKind } {
    if (entity === INFO && isMarketLayout(layout)) {
      const def = layout.infoFields.find((f) => f.key === field)!;
      return { row: rowIndex(grid, entity, id, field), col: layout.infoColumns.value, kind: def.kind };
    }
    const def = defOf(entity, field);
    return { row: rowIndex(grid, entity, id), col: colOf(grid, def.header), kind: def.kind };
  }

  async function edit(fileId: string, change: (wb: Workbook) => void): Promise<void> {
    const wb = await target.getWorkbook(fileId);
    change(wb);
    await target.setWorkbook(fileId, wb);
  }

  /** Puts `row` right after the last row with any content, as a person typing at the bottom of a tab does. */
  const typeAtBottom = (grid: Grid, row: Cell[]) => grid.splice(lastContentRow(grid), 0, row);

  return {
    async dump(fileId) {
      return { workbook: await target.getWorkbook(fileId), state: await target.state?.(fileId) };
    },

    async rowOf(fileId, entity, id) {
      const grid = gridOf(await target.getWorkbook(fileId), entity);
      const col = idCol(grid, entity);
      return grid.find((row, i) => i > 0 && text(row[col]) === id) ?? null;
    },

    async rowIds(fileId, entity) {
      const grid = gridOf(await target.getWorkbook(fileId), entity);
      const col = idCol(grid, entity);
      return grid.slice(1).filter((row) => !blankRow(row)).map((row) => text(row[col]));
    },

    /** Types something unreadable into the first list or other typed cell that, unreadable, leaves the row out. */
    async breakRow(fileId, entity, id) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        const index = rowIndex(grid, entity, id);
        const candidates = defsOf(entity).filter((d) => d.kind !== 'id' && d.kind !== 'datetime' && d.kind !== 'actor');
        const ordered = [...candidates.filter((d) => d.kind === 'enum'), ...candidates.filter((d) => d.kind !== 'enum')];
        for (const def of ordered) {
          const col = colOf(grid, def.header);
          const before = grid[index]![col] ?? '';
          grid[index]![col] = UNREADABLE[def.kind] ?? '';
          const decoded = decode(wb);
          if (decoded.ok && !decoded.value.locations.has(id)) return;
          grid[index]![col] = before;
        }
        throw new Error(`can't break ${entity} ${id}`);
      });
    },

    async removeTab(fileId, entity) {
      const tab = tabOf(entity);
      await edit(fileId, (wb) => { delete wb[tab]; });
      return { tab };
    },

    async renameTab(fileId, entity, to) {
      const tab = tabOf(entity);
      await target.renameTab(fileId, tab, to);
      return { tab };
    },

    async breakField(fileId, entity, id, field) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        const { row, col, kind } = cellOf(grid, entity, id, field);
        const typed = UNREADABLE[kind];
        if (typed === undefined) throw new Error(`a ${kind} cell reads anything`);
        grid[row]![col] = typed;
      });
    },

    async fieldOf(fileId, entity, id, field) {
      const grid = gridOf(await target.getWorkbook(fileId), entity);
      const { row, col } = cellOf(grid, entity, id, field);
      return grid[row]![col] ?? null;
    },

    async editField(fileId, entity, id, field, value) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        grid[rowIndex(grid, entity, id)]![colOf(grid, defOf(entity, field).header)] = encodeCell(defOf(entity, field), value);
      });
    },

    async typeCell(fileId, entity, id, field, typed) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        const { row, col } = cellOf(grid, entity, id, field);
        grid[row]![col] = typed;
      });
    },

    async deleteRow(fileId, entity, id) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        grid.splice(rowIndex(grid, entity, id), 1);
      });
    },

    async editSubField(fileId, entity, id, field, sub, value) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        const def = defOf(entity, `${field}.${sub}`);
        grid[rowIndex(grid, entity, id)]![colOf(grid, def.header)] = encodeCell(def, value);
      });
    },

    async addUserNotes(fileId, entity, column, notes, extraRowNote) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        const col = Math.max(...grid.map((row) => row.length));
        const pad = (row: Cell[]) => { while (row.length < col) row.push(''); };
        const ids = idCol(grid, entity);
        grid.forEach((row, i) => {
          pad(row);
          if (i === 0) row[col] = column;
          else if (Object.hasOwn(notes, text(row[ids]))) row[col] = notes[text(row[ids])]!;
        });
        const extra: Cell[] = [];
        pad(extra);
        extra[col] = extraRowNote;
        typeAtBottom(grid, extra);
      });
    },

    async userNotes(fileId, entity, column) {
      const grid = gridOf(await target.getWorkbook(fileId), entity);
      const col = colOf(grid, column);
      const ids = idCol(grid, entity);
      return grid.slice(1).filter((row) => !blankRow(row)).map((row) => ({ id: text(row[ids]) || null, note: text(row[col]) }));
    },

    async typeRowWithoutId(fileId, entity, values) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        const defs = defsOf(entity);
        const cells = encodeEntity(defs, { ...TYPED_DEFAULTS[entity], ...values });
        const row: Cell[] = (grid[0] ?? []).map(() => '');
        for (const def of defs) {
          if (def.kind === 'id' || def.key === 'updatedAt' || def.key === 'updatedBy') continue;
          row[colOf(grid, def.header)] = cells[def.key]!;
        }
        typeAtBottom(grid, row);
      });
    },

    async copyRow(fileId, entity, id) {
      await edit(fileId, (wb) => {
        const grid = gridOf(wb, entity);
        typeAtBottom(grid, grid[rowIndex(grid, entity, id)]!.slice());
      });
    },

    async setSchemaVersion(fileId, version) {
      await edit(fileId, (wb) => {
        const row = (wb[layout.tabs.meta] ?? []).find((r, i) => i > 0 && text(r[0]) === 'schemaVersion');
        if (!row) throw new Error('no schemaVersion row');
        row[1] = version;
      });
    },

    async addTab(fileId, title, rows) {
      await edit(fileId, (wb) => {
        if (Object.hasOwn(wb, title)) throw new Error(`tab ${title} exists`);
        wb[title] = structuredClone(rows) as Grid;
      });
    },

    async tabRows(fileId, title) {
      return (await target.getWorkbook(fileId))[title] ?? null;
    },
  };
}

/** SettingsRawAccess on a target: hand edits on a Company facts, program or case file, by tab and header. */
export function workbookSettingsRawAccess(target: HandEditTarget): SettingsRawAccess {
  const gridOf = async (fileId: string, tab: string): Promise<Grid> => {
    const grid = (await target.getWorkbook(fileId))[tab];
    if (!grid) throw new Error(`no tab ${tab}`);
    return grid;
  };
  const put = async (fileId: string, tab: string, grid: Grid) => target.setWorkbook(fileId, { ...(await target.getWorkbook(fileId)), [tab]: grid });
  /** The column under `header`, made at the end of the header row when there is none. */
  const columnOf = (grid: Grid, header: string) => {
    const head = (grid[0] ??= []);
    const at = head.findIndex((cell) => normalize(text(cell)) === normalize(header));
    if (at >= 0) return at;
    head.push(header);
    return head.length - 1;
  };
  /** 0-based grid index of row `index` among the rows with anything in them. */
  const rowAt = (grid: Grid, index: number) => {
    const filled = grid.map((row, i) => ({ row, i })).filter(({ row, i }) => i > 0 && !blankRow(row));
    const found = filled[index];
    if (!found) throw new Error(`no row ${index}`);
    return found.i;
  };
  return {
    async dump(fileId) {
      return target.getWorkbook(fileId);
    },
    async rows(fileId, tab) {
      const grid = await gridOf(fileId, tab);
      const header = (grid[0] ?? []).map(text);
      return grid.slice(1).filter((row) => !blankRow(row)).map((row) =>
        Object.fromEntries(row.flatMap((cell, i) => (header[i] && text(cell) !== '' ? [[header[i]!, cell]] : []))));
    },
    async typeRow(fileId, tab, values) {
      const grid = await gridOf(fileId, tab);
      const row: Cell[] = [];
      for (const [header, value] of Object.entries(values)) row[columnOf(grid, header)] = value as Cell;
      grid[lastContentRow(grid)] = Array.from(row, (cell) => cell ?? null);
      await put(fileId, tab, grid);
    },
    async typeCell(fileId, tab, index, column, value) {
      const grid = await gridOf(fileId, tab);
      const col = columnOf(grid, column);
      const row = grid[rowAt(grid, index)]!;
      while (row.length <= col) row.push(null);
      row[col] = value as Cell;
      await put(fileId, tab, grid);
    },
    async typeSetting(fileId, tab, setting, value) {
      const grid = await gridOf(fileId, tab);
      const name = columnOf(grid, 'Setting');
      const col = columnOf(grid, 'Value');
      const row = grid.find((r, i) => i > 0 && normalize(text(r[name])) === normalize(setting));
      if (!row) throw new Error(`no setting ${setting}`);
      while (row.length <= col) row.push(null);
      row[col] = value as Cell;
      await put(fileId, tab, grid);
    },
    async renameTab(fileId, from, to) {
      await target.renameTab(fileId, from, to);
    },
  };
}

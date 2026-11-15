import type { Workbook } from '../sheet-codec/grid';
import { appendRows, cellText } from '../workbook/append-rows';
import type { RowWrite } from '../workbook/writer';

export { appendRows, cellText };

/** One range to read back before writing (row 1-based, columns 0-based and inclusive) and what it must hold. */
export interface RowCheck {
  tab: string;
  row: number;
  fromCol: number;
  toCol: number;
  matches(values: unknown[][] | undefined): boolean;
}

/**
 * The adapter contract's checks (writer.ts), for `writes` against the sheet as `expected` says it is:
 * - Each row an update or delete touches must still hold the ID it was read with.
 * - A row without an ID yet must still hold exactly what it was read with, cell for cell.
 * - Only a row's first write is checked: a later write to the same row expects what the earlier one put there.
 * - An update's `expectCells` must still hold what they held when read (an upgrade's new header cells: still blank).
 * - The rows appends will fill must still be blank.
 */
export function rowChecks(expected: Workbook, writes: RowWrite[]): RowCheck[] {
  const checks: RowCheck[] = [];
  const seen = new Set<string>();
  const appends = new Map<string, number[]>();
  for (const w of writes) {
    if (w.op === 'append') {
      appends.set(w.tab, [...(appends.get(w.tab) ?? []), ...w.cells.map((c) => c.col)]);
      continue;
    }
    const key = `${w.tab}\u0000${w.row}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (w.op === 'update' && w.expectCells && w.expectCells.length > 0) {
      const cells = w.expectCells;
      const fromCol = Math.min(...cells.map((c) => c.col));
      const toCol = Math.max(...cells.map((c) => c.col));
      checks.push({
        tab: w.tab, row: w.row, fromCol, toCol,
        matches: (v) => cells.every((c) => cellText(v?.[0]?.[c.col - fromCol]) === cellText(c.value)),
      });
    }
    if (w.expectId !== '') {
      checks.push({ tab: w.tab, row: w.row, fromCol: w.idCol, toCol: w.idCol, matches: (v) => cellText(v?.[0]?.[0]) === w.expectId });
      continue;
    }
    const row = expected[w.tab]?.[w.row - 1] ?? [];
    const width = Math.max(row.length, w.idCol + 1);
    checks.push({
      tab: w.tab, row: w.row, fromCol: 0, toCol: width - 1,
      matches: (v) => Array.from({ length: width }, (_, c) => cellText(v?.[0]?.[c]) === cellText(row[c])).every(Boolean),
    });
  }
  const rows = appendRows(expected, writes);
  for (const [tab, cols] of appends) {
    const grid = expected[tab] ?? [];
    const maxCol = Math.max(...cols, ...grid.map((r) => r.length - 1));
    for (const [w, row] of rows) {
      if (w.tab !== tab) continue;
      checks.push({ tab, row, fromCol: 0, toCol: maxCol, matches: (v) => (v ?? []).every((r) => r.every((c) => cellText(c) === '')) });
    }
  }
  return checks;
}

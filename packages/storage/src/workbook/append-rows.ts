// Moved from google/row-checks.ts (plan 13): where an append lands, shared by every store that applies row writes.
import { lastContentRow, type Workbook } from '../sheet-codec/grid';
import type { RowWrite } from './writer';

/** A cell as trimmed text ('' for blank), the way the codec compares cells. */
export const cellText = (value: unknown): string => (value == null ? '' : String(value).trim());

/**
 * The 1-based row each append in `writes` lands on, against the sheet as `expected` says it is: after the last row
 * with any content, counting the rows this apply's updates fill (an upgrade's new Market row sits past the last row,
 * and an append goes below it). Every place that places an append (the cell write, its check, the snapshot) uses this.
 */
export function appendRows(expected: Workbook, writes: RowWrite[]): Map<RowWrite, number> {
  const out = new Map<RowWrite, number>();
  const last = new Map<string, number>();
  const lastOf = (tab: string) => last.get(tab) ?? lastContentRow(expected[tab] ?? []);
  for (const w of writes) {
    if (w.op === 'append') {
      const row = lastOf(w.tab) + 1;
      out.set(w, row);
      last.set(w.tab, row);
    } else if (w.op === 'update' && w.cells.some((c) => cellText(c.value) !== '')) {
      last.set(w.tab, Math.max(lastOf(w.tab), w.row));
    }
  }
  return out;
}

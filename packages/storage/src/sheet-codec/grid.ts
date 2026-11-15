// The one home of these types.
export type Cell = string | number | boolean | null;
export type Grid = Cell[][];
/** Tab name → rows. Row 0 of an entity tab is its header. */
export type Workbook = Record<string, Grid>;

/**
 * 1-based number of the last row with any content in any column, including columns the user added (0 for an empty
 * tab). New rows go right after it, so a row holding only the user's own notes is never taken over.
 */
export function lastContentRow(grid: Grid | undefined): number {
  let n = grid?.length ?? 0;
  while (n > 0 && grid![n - 1]!.every((cell) => cell == null || (typeof cell === 'string' && cell.trim() === ''))) n--;
  return n;
}

/** A header, label or key as the codec compares them: case, spaces and punctuation ignored. */
export const headerKey = (cell: Cell | undefined): string => (cell == null ? '' : String(cell)).toLowerCase().replace(/[^a-z0-9]/g, '');

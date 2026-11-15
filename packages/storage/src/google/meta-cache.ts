/** A spreadsheet's layout: each tab's sheetId and grid size by title. Never cell values. */
export interface SheetMeta {
  sheetIds: Record<string, number>;
  /** Rows in each tab's grid (Google's 1000 for a new tab). Writes past them are refused until the tab grows. */
  rowCounts: Record<string, number>;
  /** Columns in each tab's grid (Google's 26 for a new tab), as for rows. Left out, a tab has Google's 26. */
  columnCounts?: Record<string, number>;
}

export interface SheetMetaCache {
  get(fileId: string): SheetMeta | null;
  set(fileId: string, meta: SheetMeta): void;
  drop(fileId: string): void;
}

/** Most layouts kept at once; the oldest goes first. */
const MAX_ENTRIES = 1000;

const copy = (meta: SheetMeta): SheetMeta => ({
  sheetIds: { ...meta.sheetIds }, rowCounts: { ...meta.rowCounts }, ...(meta.columnCounts ? { columnCounts: { ...meta.columnCounts } } : {}),
});

/**
 * Per-process layout cache keyed by file id. Setup fixes tab titles and ids and people rarely change them, so a
 * layout is kept longer than a market snapshot (60 s). A read that finds a cached tab gone drops the entry.
 */
export function createSheetMetaCache(options: { ttlMs: number; clock: () => number }): SheetMetaCache {
  const entries = new Map<string, { meta: SheetMeta; expiresAt: number }>();
  return {
    get(fileId) {
      const entry = entries.get(fileId);
      if (!entry) return null;
      if (entry.expiresAt <= options.clock()) {
        entries.delete(fileId);
        return null;
      }
      return copy(entry.meta);
    },
    set(fileId, meta) {
      entries.delete(fileId);
      entries.set(fileId, { meta: copy(meta), expiresAt: options.clock() + options.ttlMs });
      while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value!);
    },
    drop(fileId) {
      entries.delete(fileId);
    },
  };
}

/** A cursor as `page` makes it: an index in base 36, no sign, no point. */
const CURSOR = /^[0-9a-z]{1,10}$/;

/** Where a cursor starts: the index it names, or 0 for anything that isn't a cursor `page` could have made. */
function startOf(cursor: string | undefined): number {
  if (cursor === undefined || !CURSOR.test(cursor)) return 0;
  const at = parseInt(cursor, 36);
  return Number.isSafeInteger(at) ? at : 0;
}

/**
 * One page of a list. The cursor is the index of the page's first item as a base 36 string [builder's call]: the
 * commands read whole lists, so a page is a slice. `nextCursor` is null on the last page.
 */
export function page<T>(items: readonly T[], cursor: string | undefined, limit: number): { items: T[]; nextCursor: string | null } {
  const start = startOf(cursor);
  const size = Math.max(1, Math.floor(limit));
  const end = start + size;
  return { items: items.slice(start, end), nextCursor: end < items.length ? end.toString(36) : null };
}

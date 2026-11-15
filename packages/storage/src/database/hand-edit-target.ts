// Test support: the contract's hand edits on the database edition's rows (plan 13, task 8). The body is the same
// workbook Google holds, so the same edits (../hand-edits.ts) run on it, through the port every store uses, so the
// memory port and SQLite both take them. Not production code.
import type { HandEditTarget } from '../hand-edits';
import type { Workbook } from '../sheet-codec/grid';
import type { WorkFiles } from './work-files';

/** The format version a body's `_meta` says, so the row's column follows a hand edit of it. */
function metaVersion(wb: Workbook): number | null {
  const row = (wb['_meta'] ?? []).find((r) => String(r[0] ?? '').trim() === 'schemaVersion');
  return typeof row?.[1] === 'number' ? row[1] : null;
}

/** A port's rows as hand-edit targets. An edit is a write at the row's revision, as an admin's database tool would make. */
export function workFilesTarget(files: WorkFiles): HandEditTarget {
  const row = async (fileId: string) => {
    const found = await files.read(fileId);
    if (!found) throw new Error(`no file ${fileId}`);
    return found;
  };
  const get = async (fileId: string) => JSON.parse((await row(fileId)).body) as Workbook;
  const set = async (fileId: string, wb: Workbook) => {
    const current = await row(fileId);
    const wrote = await files.write(fileId, current.revision, {
      body: JSON.stringify(wb), formatVersion: metaVersion(wb) ?? current.formatVersion, updatedAt: current.updatedAt,
    });
    if (!wrote) throw new Error(`hand edit of ${fileId} didn't land`);
  };
  return {
    getWorkbook: get,
    setWorkbook: set,
    // A refused save that wrote the same body again would still raise the revision: `dump` shows it.
    state: async (fileId) => {
      const { revision, updatedAt, formatVersion } = await row(fileId);
      return { revision, updatedAt, formatVersion };
    },
    renameTab: async (fileId, from, to) => {
      const wb = await get(fileId);
      if (!Object.hasOwn(wb, from)) throw new Error(`no tab ${from}`);
      if (Object.hasOwn(wb, to)) throw new Error(`tab ${to} exists`);
      await set(fileId, Object.fromEntries(Object.entries(wb).map(([title, grid]) => [title === from ? to : title, grid])));
    },
  };
}

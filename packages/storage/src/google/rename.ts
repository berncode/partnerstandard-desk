// Renaming a file the app named after its content (a case's partner, a program's label). A file named before
// 2026-11-10 keeps its earlier prefix ("Partner Desk – "): the owner decided existing files are never renamed to the
// new name (2026-11-10). Best effort, as before: a name that couldn't change is untidy, not harmful.
import { SHEET_COPY } from '@partner-desk/copy';
import { DRIVE_API, type GoogleClient } from './client';
import { withQuery } from '../http/retry';

/** `name` (which starts with the current prefix) under the prefix the file has now, when that is an earlier one. */
export function underItsPrefix(current: string, name: string): string {
  const { filePrefix, earlierFilePrefixes } = SHEET_COPY.DRIVE;
  const earlier = earlierFilePrefixes.find((prefix) => current.startsWith(prefix));
  return earlier && name.startsWith(filePrefix) ? `${earlier}${name.slice(filePrefix.length)}` : name;
}

/** Renames the file to `name`, keeping an earlier prefix it already has. One read for its name, then the rename. */
export async function renameKeepingPrefix(client: GoogleClient, fileId: string, name: string): Promise<void> {
  try {
    const file = await client.get<{ name?: string }>(withQuery(`${DRIVE_API}/${fileId}`, { fields: 'name' }));
    await client.patch(`${DRIVE_API}/${fileId}`, { name: underItsPrefix(file.name ?? '', name) }, { idempotent: true });
  } catch {
    // Left as it is.
  }
}

import { SHEET_COPY } from '@partner-desk/copy';
import { withQuery } from '../http/retry';
import { DRIVE_API, GoogleApiError, type GoogleClient } from './client';

/**
 * Remembers each person's "PartnerStandard / PartnerStandard Desk" folder, or the earlier one,
 * "PartnerStandard / Partner Desk". The platform's TursoFolderStore fits this shape; storage never imports it.
 */
export interface FolderStore {
  get(userId: string): Promise<string | null>;
  set(userId: string, folderId: string): Promise<void>;
  /** Forgets the person's folder (account deletion). The folder itself stays in their Drive. */
  delete(userId: string): Promise<void>;
}

export class MemoryFolderStore implements FolderStore {
  private readonly folders = new Map<string, string>();

  async get(userId: string): Promise<string | null> {
    return this.folders.get(userId) ?? null;
  }

  async set(userId: string, folderId: string): Promise<void> {
    this.folders.set(userId, folderId);
  }

  async delete(userId: string): Promise<void> {
    this.folders.delete(userId);
  }
}

export const FOLDER_MIME = 'application/vnd.google-apps.folder';

/**
 * The person's folder: the remembered one while Drive still has it. Otherwise this app's own "PartnerStandard /
 * PartnerStandard Desk" (or the earlier "PartnerStandard / Partner Desk") found by name, making only the levels that are
 * missing. drive.file lets Drive list only folders this app's Google project made, so a person's own folder with the
 * same name is never picked. Two first reads at once both end up with the oldest of each level; the spare ones go to
 * the trash.
 */
export async function driveFolder(client: GoogleClient, folders: FolderStore, userId: string): Promise<string> {
  const known = await folders.get(userId);
  if (known && (await stillThere(client, known))) return known;
  let parent = 'root';
  let made = false;
  const path = SHEET_COPY.DRIVE.folderPath;
  for (const [level, name] of path.entries()) {
    // Inside a folder made just now there is nothing to find. The last level also answers to its earlier names, so a
    // person who has the old folder keeps it (owner, 2026-11-10); a new one gets the new name.
    const names = level === path.length - 1 ? [name, ...SHEET_COPY.DRIVE.earlierFolderNames] : [name];
    let found: string | null = null;
    for (const candidate of made ? [] : names) {
      found = await findFolder(client, candidate, parent);
      if (found) break;
    }
    if (found) {
      parent = found;
      continue;
    }
    const mine = await makeFolder(client, name, parent);
    // Another first read may have made the same folder just now. Everyone keeps the oldest; ours, if it isn't the
    // oldest, is still empty and goes to the trash. Only inside a folder that is ours is there nothing to search.
    const oldest = (await findFolder(client, name, parent)) ?? mine;
    if (oldest !== mine) await trashQuietly(client, mine);
    made = oldest === mine;
    parent = oldest;
  }
  await folders.set(userId, parent);
  return parent;
}

/** Whether a remembered folder can still be used. Only "trashed" or a 404 mean no; any other failure is thrown. */
async function stillThere(client: GoogleClient, folderId: string): Promise<boolean> {
  try {
    const folder = await client.get<{ trashed?: boolean }>(withQuery(`${DRIVE_API}/${folderId}`, { fields: 'id,trashed' }));
    return !folder.trashed;
  } catch (error) {
    if (error instanceof GoogleApiError && error.kind === 'not_found' && error.status === 404) return false;
    throw error;
  }
}

/** The oldest untrashed folder `name` directly inside `parentId`, or null. The folder names hold no quotes. */
async function findFolder(client: GoogleClient, name: string, parentId: string): Promise<string | null> {
  const q = `name = '${name}' and mimeType = '${FOLDER_MIME}' and trashed = false and '${parentId}' in parents`;
  const found = await client.get<{ files?: Array<{ id: string }> }>(
    withQuery(DRIVE_API, { q, fields: 'files(id)', orderBy: 'createdTime', pageSize: '1' }),
  );
  return found.files?.[0]?.id ?? null;
}

/** Moves a folder this run made, still empty, to the Drive trash. Best effort: a spare empty folder is untidy, not harmful. */
async function trashQuietly(client: GoogleClient, folderId: string): Promise<void> {
  try {
    await client.patch(`${DRIVE_API}/${folderId}`, { trashed: true }, { idempotent: true });
  } catch {
    // Left as it is.
  }
}

/** Not retried on 5xx (client default): a second create would make a second folder. */
async function makeFolder(client: GoogleClient, name: string, parentId: string): Promise<string> {
  const created = await client.post<{ id: string }>(withQuery(DRIVE_API, { fields: 'id' }), {
    name, mimeType: FOLDER_MIME, ...(parentId === 'root' ? {} : { parents: [parentId] }),
  });
  return created.id;
}

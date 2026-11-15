// The folder cases, for the "PartnerStandard / PartnerStandard Desk" folder.
import { describe, expect, it } from 'vitest';
import { FakeGoogle, fakeClient } from './fake-google';
import { driveFolder, MemoryFolderStore } from './folders';

const FOLDER_QUERY = (name: string, parent: string) =>
  `name = '${name}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false and '${parent}' in parents`;
/** The Drive files.list calls made, by their q. */
const folderSearches = (fake: FakeGoogle) =>
  fake.calls.filter((c) => c.method === 'GET' && c.url.pathname === '/drive/v3/files').map((c) => c.url.searchParams.get('q'));

function setup() {
  const fake = new FakeGoogle();
  const folders = new MemoryFolderStore();
  return { fake, folders, folder: () => driveFolder(fakeClient(fake), folders, 'u_1') };
}

describe('driveFolder', () => {
  it('makes PartnerStandard / PartnerStandard Desk, searching only where something could be, and remembers it', async () => {
    const { fake, folders, folder } = setup();
    const id = await folder();
    const [root, desk] = fake.folders();
    expect(root).toMatchObject({ name: 'PartnerStandard', parents: [] });
    expect(desk).toMatchObject({ id, name: 'PartnerStandard Desk', parents: [root!.id] });
    // Nothing found at the top, so "PartnerStandard Desk" goes inside a folder made just now: nothing to search there. Each
    // folder made is looked for once more, in case a second first read made the same one at once.
    expect(folderSearches(fake)).toEqual([
      FOLDER_QUERY('PartnerStandard', 'root'), FOLDER_QUERY('PartnerStandard', 'root'), FOLDER_QUERY('PartnerStandard Desk', root!.id),
    ]);
    expect(await folders.get('u_1')).toBe(id);
  });

  it('reuses the remembered folder', async () => {
    const { fake, folder } = setup();
    const first = await folder();
    fake.calls.length = 0;
    expect(await folder()).toBe(first);
    expect(fake.folders()).toHaveLength(2);
    expect(folderSearches(fake)).toEqual([]);
  });

  it('makes a new PartnerStandard Desk folder inside the existing PartnerStandard when the PartnerStandard Desk folder was trashed', async () => {
    const { fake, folder } = setup();
    await folder();
    const [root, desk] = fake.folders();
    fake.trash(desk!.id);
    fake.calls.length = 0;
    const id = await folder();
    // The new name, then the earlier one; none found, so the new name is made and looked for once more.
    expect(folderSearches(fake)).toEqual([
      FOLDER_QUERY('PartnerStandard', 'root'), FOLDER_QUERY('PartnerStandard Desk', root!.id), FOLDER_QUERY('Partner Desk', root!.id),
      FOLDER_QUERY('PartnerStandard Desk', root!.id),
    ]);
    const live = fake.folders().filter((f) => !f.trashed);
    expect(live.filter((f) => f.name === 'PartnerStandard')).toHaveLength(1);
    expect(live.find((f) => f.name === 'PartnerStandard Desk')).toMatchObject({ id, parents: [root!.id] });
  });

  it('makes a new PartnerStandard Desk folder when the remembered one is gone for good (404)', async () => {
    const { fake, folder } = setup();
    await folder();
    const [root, desk] = fake.folders();
    fake.remove(desk!.id);
    await folder();
    expect(fake.folders().map((f) => [f.name, f.parents])).toEqual([['PartnerStandard', []], ['PartnerStandard Desk', [root!.id]]]);
  });

  it('finds the app’s folders again when the remembered id is lost', async () => {
    const { fake, folder } = setup();
    const id = await folder();
    // As after the folder row was lost: same Drive, nothing remembered.
    expect(await driveFolder(fakeClient(fake), new MemoryFolderStore(), 'u_1')).toBe(id);
    expect(fake.folders()).toHaveLength(2);
  });

  it('keeps a person’s folder from before the new name (Partner Desk): found by it when the id is lost, never renamed', async () => {
    const { fake, folder } = setup();
    const id = await folder();
    const [, desk] = fake.folders();
    desk!.name = 'Partner Desk'; // as made before 2026-11-10
    expect(await driveFolder(fakeClient(fake), new MemoryFolderStore(), 'u_1')).toBe(id);
    expect(fake.folders().map((f) => f.name)).toEqual(['PartnerStandard', 'Partner Desk']);
  });

  it('takes the new name first when a person has both', async () => {
    const { fake, folder } = setup();
    await folder();
    const [, old] = fake.folders();
    old!.name = 'set aside'; // so the next first read makes a folder with the new name
    const newer = await driveFolder(fakeClient(fake), new MemoryFolderStore(), 'u_1');
    old!.name = 'Partner Desk';
    expect(await driveFolder(fakeClient(fake), new MemoryFolderStore(), 'u_1')).toBe(newer);
    expect(fake.folders().map((f) => f.name).sort()).toEqual(['Partner Desk', 'PartnerStandard', 'PartnerStandard Desk']);
  });

  it('makes both levels again when PartnerStandard itself was trashed', async () => {
    const { fake, folder } = setup();
    await folder();
    fake.trash(fake.folders()[0]!.id); // trashes the PartnerStandard Desk folder inside it too, as Drive does
    await folder();
    expect(fake.folders().filter((f) => !f.trashed).map((f) => f.name)).toEqual(['PartnerStandard', 'PartnerStandard Desk']);
    expect(fake.folders()).toHaveLength(4);
  });

  it('stops, making nothing, when Drive refuses the remembered folder (403)', async () => {
    const { fake, folder } = setup();
    await folder();
    fake.calls.length = 0;
    fake.failNext(403);
    await expect(folder()).rejects.toMatchObject({ kind: 'not_found', status: 403 });
    expect(fake.folders()).toHaveLength(2);
    expect(fake.calls.filter((c) => c.method === 'POST')).toEqual([]);
  });
});

describe('driveFolder: two first reads at once', () => {
  it('keep one PartnerStandard / PartnerStandard Desk, trash the extra (empty) ones, and both answer its id', async () => {
    const fake = new FakeGoogle();
    const client = fakeClient(fake);
    const [a, b] = await Promise.all([
      driveFolder(client, new MemoryFolderStore(), 'u_1'),
      driveFolder(client, new MemoryFolderStore(), 'u_1'),
    ]);
    expect(a).toBe(b);
    const live = fake.folders().filter((f) => !f.trashed);
    expect(live.map((f) => f.name)).toEqual(['PartnerStandard', 'PartnerStandard Desk']);
    expect(live[1]).toMatchObject({ id: a, parents: [live[0]!.id] });
    // Every extra folder is in the trash, never deleted for good.
    expect(fake.folders().length).toBeGreaterThan(2);
  });
});

describe('MemoryFolderStore', () => {
  it('remembers a folder per person and forgets one person’s', async () => {
    const folders = new MemoryFolderStore();
    await folders.set('u_1', 'folder-1');
    await folders.set('u_10', 'folder-10');
    await folders.delete('u_1');
    await folders.delete('u_1');
    expect(await folders.get('u_1')).toBeNull();
    expect(await folders.get('u_10')).toBe('folder-10');
  });
});

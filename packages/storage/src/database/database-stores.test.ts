import { describe, expect, it } from 'vitest';
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import { runMapStoreContract } from '../map-store.contract';
import { runMarketStoreContract } from '../market-store.contract';
import { runPartnerBookStoreContract } from '../partner-book-store.contract';
import { encodePartnerBook } from '../sheet-codec/encode';
import { asPartnersVersion4, PARTNERS_META, richBook } from '../sheet-codec/test-fixtures';
import type { Workbook } from '../sheet-codec/grid';
import { MARKET_LAYOUT, PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { MAP_LAYOUT } from '../sheet-codec/map-layout';
import { workbookRawAccess } from '../hand-edits';
import { workFilesTarget } from './hand-edit-target';
import { MemoryWorkFiles } from './memory-work-files';
import { createDatabaseMapStore } from './map-store';
import { createDatabaseMarketStore } from './market-store';
import { createDatabasePartnerBookStore } from './partner-book-store';
import type { WorkFiles, WorkFileWrite } from './work-files';

const owner = { userId: 'u_contract', displayName: 'Anna Keller' };
const options = (files: WorkFiles) => ({ files, appBaseUrl: 'https://desk.test' });

// With raw access on the rows: the contract's "writes nothing" checks and its hand-edit cases run on the database too.
runPartnerBookStoreContract('database (memory port)', () => {
  const files = new MemoryWorkFiles();
  return { store: createDatabasePartnerBookStore(options(files)), owner, raw: workbookRawAccess(workFilesTarget(files), PARTNERS_LAYOUT) };
});
runMarketStoreContract('database (memory port)', () => {
  const files = new MemoryWorkFiles();
  return { store: createDatabaseMarketStore(options(files)), owner, raw: workbookRawAccess(workFilesTarget(files), MARKET_LAYOUT) };
});
runMapStoreContract('database (memory port)', () => {
  const files = new MemoryWorkFiles();
  return { store: createDatabaseMapStore(options(files)), owner, raw: workbookRawAccess(workFilesTarget(files), MAP_LAYOUT) };
});

const stamp = { now: '2026-11-07T12:00:00.000Z', actor: 'Anna Keller' };

/** A Partners file in the port whose body is `wb`, at `version`. */
async function seededFile(files: MemoryWorkFiles, wb: Workbook, version: number) {
  const id = 'wf_0123456789abcdef0123';
  await files.create({ id, kind: 'partners', companyId: 'co_aaaaaaaaaa', formatVersion: version, body: JSON.stringify(wb), createdAt: stamp.now, updatedAt: stamp.now });
  return id;
}

describe('the database Partners store', () => {
  it('makes a file whose link is its download address, never a Drive link', async () => {
    const store = createDatabasePartnerBookStore(options(new MemoryWorkFiles()));
    const file = await store.create(owner, 'co_aaaaaaaaaa');
    expect(file.fileUrl).toBe(`https://desk.test/files/${file.fileId}/download`);
    expect(store.urlFor({ fileId: file.fileId })).toBe(file.fileUrl);
  });

  it('reads a version 4 body with no proposal rows, and its next save writes version 5 with the Proposals tab', async () => {
    const files = new MemoryWorkFiles();
    const id = await seededFile(files, asPartnersVersion4(encodePartnerBook(richBook(), PARTNERS_META)), 4);
    expect(JSON.parse((await files.read(id))!.body)).not.toHaveProperty([PARTNERS_LAYOUT.tabs.proposalItem]);
    const store = createDatabasePartnerBookStore(options(files));
    const read = await store.read({ fileId: id });
    expect(read).toMatchObject({ ok: true });
    if (!read.ok) return;
    expect(read.snapshot.value.proposalItems).toEqual([]);
    const account = read.snapshot.value.accounts[0]!;
    const saved = await store.apply({ fileId: id }, { kind: 'update', entity: 'account', id: account.id, patch: { comments: 'Upgraded' }, expectedUpdatedAt: account.updatedAt }, stamp);
    expect(saved).toMatchObject({ ok: true });
    const row = (await files.read(id))!;
    expect(row.formatVersion).toBe(5);
    const body = JSON.parse(row.body) as Workbook;
    expect(body[PARTNERS_LAYOUT.tabs.proposalItem]?.[0]?.[0]).toBe('ID');
    expect(body['_meta']).toContainEqual(['schemaVersion', 5]);
  });

  it('reads a body that isn’t JSON as damaged, and a save never writes over it', async () => {
    const files = new MemoryWorkFiles();
    const id = await seededFile(files, {}, 5);
    await files.write(id, 0, { body: '{"Accounts": [["ID"', formatVersion: 5, updatedAt: stamp.now });
    const store = createDatabasePartnerBookStore(options(files));
    expect(await store.read({ fileId: id })).toEqual({ ok: false, error: 'structure', message: COPY.DB_FILE_DAMAGED, tab: '' });
    expect(await store.apply({ fileId: id }, { kind: 'add', entity: 'account', values: { company: 'Zeta GmbH' } }, stamp))
      .toMatchObject({ ok: false, error: 'structure' });
    expect((await files.read(id))!).toMatchObject({ revision: 1, body: '{"Accounts": [["ID"' });
  });

  it('reads JSON that isn’t a workbook as damaged too', async () => {
    const files = new MemoryWorkFiles();
    for (const body of ['[]', '"text"', '{"Accounts": "no rows"}', '{"Accounts": [1, 2]}', 'null']) {
      const id = `wf_${String(Math.random()).slice(2, 12).padEnd(10, '0')}0123456789`;
      await files.create({ id, kind: 'partners', companyId: 'co_aaaaaaaaaa', formatVersion: 5, body, createdAt: stamp.now, updatedAt: stamp.now });
      expect(await createDatabasePartnerBookStore(options(files)).read({ fileId: id })).toMatchObject({ ok: false, message: COPY.DB_FILE_DAMAGED });
    }
  });

  it('reads a trashed file as gone, keeps its row, and reads a file of another kind as gone', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabasePartnerBookStore(options(files));
    const file = await store.create(owner, 'co_aaaaaaaaaa');
    await store.trash({ fileId: file.fileId });
    expect(await store.read({ fileId: file.fileId })).toEqual({ ok: false, error: 'file_not_found', message: COPY.FILE_GONE });
    expect((await files.read(file.fileId))!.trashedAt).not.toBeNull();
    const map = await createDatabaseMapStore(options(files)).read({ fileId: (await store.create(owner, 'co_aaaaaaaaaa')).fileId });
    expect(map).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await store.read({ fileId: 'not-a-database-id' })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('writes nothing when a change is refused', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabasePartnerBookStore(options(files));
    const file = await store.create(owner, 'co_aaaaaaaaaa');
    const refused = await store.apply({ fileId: file.fileId }, { kind: 'update', entity: 'account', id: 'a_missing0001', patch: { comments: 'x' }, expectedUpdatedAt: null }, stamp);
    expect(refused).toMatchObject({ ok: false });
    expect((await files.read(file.fileId))!.revision).toBe(0);
  });

  it('plans again on the new body when someone saved in between', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabasePartnerBookStore(options(files));
    const file = await store.create(owner, 'co_aaaaaaaaaa');
    // The first write is answered false after another save lands: the store must read that save and keep it.
    let interleaved = false;
    const racing: WorkFiles = {
      create: (row) => files.create(row), read: (id) => files.read(id), trash: (id, at) => files.trash(id, at), restore: (id) => files.restore(id),
      write: async (id: string, revision: number, next: WorkFileWrite) => {
        if (!interleaved) {
          interleaved = true;
          await createDatabasePartnerBookStore(options(files)).apply({ fileId: id }, { kind: 'add', entity: 'account', values: { company: 'First GmbH' } }, stamp);
        }
        return files.write(id, revision, next);
      },
    };
    const saved = await createDatabasePartnerBookStore(options(racing)).apply({ fileId: file.fileId }, { kind: 'add', entity: 'account', values: { company: 'Second GmbH' } }, stamp);
    expect(saved).toMatchObject({ ok: true });
    const read = await store.read({ fileId: file.fileId });
    expect(read.ok && read.snapshot.value.accounts.map((a) => a.company).sort()).toEqual(['First GmbH', 'Second GmbH']);
    expect((await files.read(file.fileId))!.revision).toBe(2);
  });

  it('answers that the database isn’t answering when the port fails, never the driver’s words', async () => {
    const broken: WorkFiles = {
      create: async () => { throw new Error('work_file_create_failed'); },
      read: async () => { throw new Error('work_file_read_failed'); },
      write: async () => { throw new Error('work_file_write_failed'); },
      trash: async () => { throw new Error('work_file_trash_failed'); },
      restore: async () => { throw new Error('work_file_restore_failed'); },
    };
    const store = createDatabasePartnerBookStore(options(broken));
    expect(await store.read({ fileId: 'wf_0123456789abcdef0123' })).toEqual({ ok: false, error: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE });
    await expect(store.trash({ fileId: 'wf_0123456789abcdef0123' })).resolves.toBeUndefined();
    // A create fails as the Google store's does: a StoreFailure the commands turn into the person's message.
    const created = await store.create(owner, 'co_aaaaaaaaaa').then(() => null, (e: unknown) => e);
    expect(created).toBeInstanceOf(StoreFailure);
    expect(created).toMatchObject({ code: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE });
  });

  it('answers unavailable when the write fails, after a good read', async () => {
    const files = new MemoryWorkFiles();
    const file = await createDatabasePartnerBookStore(options(files)).create(owner, 'co_aaaaaaaaaa');
    const failing: WorkFiles = {
      create: (row) => files.create(row), read: (id) => files.read(id), trash: (id, at) => files.trash(id, at), restore: (id) => files.restore(id),
      write: async () => { throw new Error('work_file_write_failed'); },
    };
    expect(await createDatabasePartnerBookStore(options(failing)).apply({ fileId: file.fileId }, { kind: 'add', entity: 'account', values: { company: 'Zeta GmbH' } }, stamp))
      .toEqual({ ok: false, error: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE });
  });

  it('never writes a body that is JSON but doesn’t decode, nor one of a newer format', async () => {
    const files = new MemoryWorkFiles();
    const book = encodePartnerBook(richBook(), PARTNERS_META);
    const noMeta = await seededFile(files, Object.fromEntries(Object.entries(book).filter(([tab]) => tab !== '_meta')), 5);
    const newer = 'wf_fedcba9876543210fedc';
    const future = structuredClone(book);
    future['_meta'] = future['_meta']!.map((row) => (row[0] === 'schemaVersion' ? ['schemaVersion', 6] : row));
    await files.create({ id: newer, kind: 'partners', companyId: 'co_aaaaaaaaaa', formatVersion: 6, body: JSON.stringify(future), createdAt: stamp.now, updatedAt: stamp.now });
    const store = createDatabasePartnerBookStore(options(files));
    for (const id of [noMeta, newer]) {
      expect(await store.read({ fileId: id })).toMatchObject({ ok: false, error: 'structure' });
      expect(await store.apply({ fileId: id }, { kind: 'add', entity: 'account', values: { company: 'Zeta GmbH' } }, stamp)).toMatchObject({ ok: false, error: 'structure' });
      expect((await files.read(id))!.revision).toBe(0);
    }
  });

  it('reads a body with a cell that isn’t text, a number, true or false as damaged', async () => {
    const files = new MemoryWorkFiles();
    const id = await seededFile(files, { Accounts: [['ID', { toString: 1 }]] } as unknown as Workbook, 5);
    expect(await createDatabasePartnerBookStore(options(files)).read({ fileId: id })).toMatchObject({ ok: false, message: COPY.DB_FILE_DAMAGED });
  });
});

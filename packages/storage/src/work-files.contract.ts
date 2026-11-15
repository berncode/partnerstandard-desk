import { describe, expect, it } from 'vitest';
import { newWorkFileId, WORK_FILE_ID, type WorkFiles } from './database/work-files';

const AT = '2026-11-07T10:00:00.000Z';
const LATER = '2026-11-07T10:05:00.000Z';

/** Every `work_files` port (memory, SQLite) must pass this suite (plan 13, task 5). */
export function runWorkFilesContract(name: string, make: () => WorkFiles | Promise<WorkFiles>): void {
  describe(`WorkFiles contract: ${name}`, () => {
    async function made() {
      const files = await make();
      const id = newWorkFileId();
      await files.create({ id, kind: 'partners', companyId: 'co_contract01', formatVersion: 5, body: '{"_meta":[]}', createdAt: AT, updatedAt: AT });
      return { files, id };
    }

    it('creates a file at revision 0, not trashed, and reads it back', async () => {
      const { files, id } = await made();
      expect(id).toMatch(WORK_FILE_ID);
      expect(await files.read(id)).toEqual({
        id, kind: 'partners', companyId: 'co_contract01', formatVersion: 5, revision: 0, body: '{"_meta":[]}', createdAt: AT, updatedAt: AT, trashedAt: null,
      });
    });

    it('reads null for a file that was never made', async () => {
      const { files } = await made();
      expect(await files.read(newWorkFileId())).toBeNull();
    });

    it('writes at the current revision and raises it by one', async () => {
      const { files, id } = await made();
      expect(await files.write(id, 0, { body: '{"a":[]}', formatVersion: 5, updatedAt: LATER })).toBe(true);
      expect(await files.read(id)).toMatchObject({ body: '{"a":[]}', revision: 1, updatedAt: LATER, createdAt: AT });
      expect(await files.write(id, 1, { body: '{"b":[]}', formatVersion: 5, updatedAt: LATER })).toBe(true);
      expect(await files.read(id)).toMatchObject({ body: '{"b":[]}', revision: 2 });
    });

    it('writes nothing at an old revision and answers false', async () => {
      const { files, id } = await made();
      await files.write(id, 0, { body: '{"first":[]}', formatVersion: 5, updatedAt: LATER });
      expect(await files.write(id, 0, { body: '{"stale":[]}', formatVersion: 5, updatedAt: LATER })).toBe(false);
      expect(await files.read(id)).toMatchObject({ body: '{"first":[]}', revision: 1 });
    });

    it('writes the format version a save upgrades to', async () => {
      const { files, id } = await made();
      await files.write(id, 0, { body: '{}', formatVersion: 6, updatedAt: LATER });
      expect(await files.read(id)).toMatchObject({ formatVersion: 6 });
    });

    it('answers false for a missing file, and for a trashed one, writing nothing', async () => {
      const { files, id } = await made();
      expect(await files.write(newWorkFileId(), 0, { body: '{}', formatVersion: 5, updatedAt: LATER })).toBe(false);
      await files.trash(id, LATER);
      expect(await files.write(id, 0, { body: '{"x":[]}', formatVersion: 5, updatedAt: LATER })).toBe(false);
      expect(await files.read(id)).toMatchObject({ body: '{"_meta":[]}', revision: 0 });
    });

    it('trash keeps the row and its body, and sets trashedAt once', async () => {
      const { files, id } = await made();
      await files.trash(id, LATER);
      await files.trash(id, '2026-11-08T00:00:00.000Z');
      expect(await files.read(id)).toMatchObject({ body: '{"_meta":[]}', trashedAt: LATER });
    });

    it('restore clears trashedAt, and the file takes saves again', async () => {
      const { files, id } = await made();
      await files.trash(id, LATER);
      await files.restore(id);
      expect(await files.read(id)).toMatchObject({ trashedAt: null });
      expect(await files.write(id, 0, { body: '{"back":[]}', formatVersion: 5, updatedAt: LATER })).toBe(true);
    });

    it('restore of a file that isn’t trashed changes nothing', async () => {
      const { files, id } = await made();
      const before = await files.read(id);
      await files.restore(id);
      expect(await files.read(id)).toEqual(before);
    });

    it('a write carries only body, format version and time, whatever else the object holds', async () => {
      const { files, id } = await made();
      const next = { body: '{"b":[]}', formatVersion: 5, updatedAt: LATER, trashedAt: LATER, kind: 'map', createdAt: LATER, id: 'wf_other' };
      expect(await files.write(id, 0, next)).toBe(true);
      expect(await files.read(id)).toMatchObject({ id, kind: 'partners', createdAt: AT, trashedAt: null, body: '{"b":[]}' });
    });

    it('trash and restore of a missing file change nothing and don’t throw', async () => {
      const { files } = await made();
      const ghost = newWorkFileId();
      await files.trash(ghost, LATER);
      await files.restore(ghost);
      expect(await files.read(ghost)).toBeNull();
    });

    it('refuses a second file with the same id', async () => {
      const { files, id } = await made();
      await expect(files.create({ id, kind: 'map', companyId: 'co_contract01', formatVersion: 3, body: '{}', createdAt: AT, updatedAt: AT })).rejects.toThrow();
      expect(await files.read(id)).toMatchObject({ kind: 'partners' });
    });
  });
}

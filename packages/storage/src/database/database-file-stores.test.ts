import { describe, expect, it, vi } from 'vitest';
import { emptyFigures, newCompanyFacts, programSheet, publicBlocks, publicPlain } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { runCaseStoreContract, sampleCase } from '../case-store.contract';
import { runCompanyFactsStoreContract, sampleFacts } from '../company-facts-store.contract';
import { StoreFailure } from '../errors';
import { runProgramStoreContract, sampleProgram } from '../program-store.contract';
import type { Workbook } from '../sheet-codec/grid';
import { FIGURES } from '../sheet-codec/case-records';
import { PROGRAM_SHEET_TAB, PUBLIC_TAB } from '../sheet-codec/program-layout';
import { workbookSettingsRawAccess } from '../hand-edits';
import { createDatabaseCaseStore } from './case-store';
import { workFilesTarget } from './hand-edit-target';
import { MemoryWorkFiles } from './memory-work-files';
import { createDatabaseCompanyFactsStore, createDatabaseProgramStore } from './program-store';
import type { WorkFiles, WorkFileWrite } from './work-files';

const owner = { userId: 'u_contract', displayName: 'Anna Keller' };
const options = (files: MemoryWorkFiles) => ({ files, appBaseUrl: 'https://desk.test' });
const stamp = { now: '2026-11-07T12:00:00.000Z', actor: 'Anna Keller' };
const COMPANY = 'co_contract001';

// With raw access on the rows: the contract's "writes nothing" checks and its hand-edit cases run on the database too.
const withRaw = <S>(make: (files: MemoryWorkFiles) => S) => () => {
  const files = new MemoryWorkFiles();
  return { store: make(files), owner, raw: workbookSettingsRawAccess(workFilesTarget(files)) };
};
runProgramStoreContract('database (memory port)', withRaw((files) => createDatabaseProgramStore(options(files))));
runCompanyFactsStoreContract('database (memory port)', withRaw((files) => createDatabaseCompanyFactsStore(options(files))));
runCaseStoreContract('database (memory port)', withRaw((files) => createDatabaseCaseStore(options(files))));

describe('the database program store', () => {
  it('writes the Program Sheet and Public page tabs into the same body, and a read returns the same program', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabaseProgramStore(options(files));
    const program = sampleProgram();
    const { fileId } = await store.create(owner, COMPANY, program);
    const before = await store.read({ fileId });
    const facts = newCompanyFacts(COMPANY);
    await store.writeOutputs({ fileId }, programSheet(facts, program, 'Northwind Security'), publicPlain(publicBlocks(facts, program)));
    const body = JSON.parse((await files.read(fileId))!.body) as Workbook;
    expect(body[PROGRAM_SHEET_TAB]?.length).toBeGreaterThan(0);
    expect(body[PUBLIC_TAB]?.length).toBeGreaterThan(0);
    expect(await store.read({ fileId })).toEqual(before);
    // A save keeps the output tabs as they were.
    const saved = await store.apply({ fileId }, { kind: 'save', program: { ...program, name: 'Renamed' }, base: program, expectedUpdatedAt: program.updatedAt || null }, stamp);
    expect(saved).toMatchObject({ ok: true });
    const after = JSON.parse((await files.read(fileId))!.body) as Workbook;
    expect(after[PROGRAM_SHEET_TAB]).toEqual(body[PROGRAM_SHEET_TAB]);
    expect(after[PUBLIC_TAB]).toEqual(body[PUBLIC_TAB]);
  });

  it('throws StoreFailure for outputs to a file that is gone', async () => {
    const store = createDatabaseProgramStore(options(new MemoryWorkFiles()));
    const program = sampleProgram();
    await expect(store.writeOutputs({ fileId: 'wf_0123456789abcdef0123' }, programSheet(newCompanyFacts(COMPANY), program, 'N'), 'x'))
      .rejects.toMatchObject({ code: 'file_not_found' });
  });

  it('refuses to make a program that isn’t valid, making nothing', async () => {
    const files = new MemoryWorkFiles();
    const create = vi.spyOn(files, 'create');
    const store = createDatabaseProgramStore(options(files));
    const bad = { ...sampleProgram(), name: 'x'.repeat(10_000) };
    const made = await store.create(owner, COMPANY, bad).then(() => null, (e: unknown) => e);
    expect(made).toBeInstanceOf(StoreFailure);
    expect(made).toMatchObject({ code: 'invalid' });
    expect(create).not.toHaveBeenCalled();
  });

  it('writes outputs at the row’s own format version and time, raising the revision, and never over a damaged body', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabaseProgramStore(options(files));
    const program = sampleProgram();
    const { fileId } = await store.create(owner, COMPANY, program);
    const before = (await files.read(fileId))!;
    const facts = newCompanyFacts(COMPANY);
    await store.writeOutputs({ fileId }, programSheet(facts, program, 'N'), 'x');
    expect((await files.read(fileId))!).toMatchObject({ formatVersion: before.formatVersion, updatedAt: before.updatedAt, revision: before.revision + 1 });
    await files.write(fileId, before.revision + 1, { body: 'not json', formatVersion: before.formatVersion, updatedAt: before.updatedAt });
    await expect(store.writeOutputs({ fileId }, programSheet(facts, program, 'N'), 'x')).rejects.toMatchObject({ code: 'structure' });
    expect((await files.read(fileId))!.body).toBe('not json');
  });

  it('never writes an output tab beside one of the same name in other letters: the download must open (final review)', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabaseProgramStore(options(files));
    const program = sampleProgram();
    const { fileId } = await store.create(owner, COMPANY, program);
    const row = (await files.read(fileId))!;
    const wb = JSON.parse(row.body) as Workbook;
    const rest = Object.fromEntries(Object.entries(wb).filter(([title]) => title !== PUBLIC_TAB));
    const renamed = JSON.stringify({ ...rest, [PUBLIC_TAB.toLowerCase()]: [['typed by hand']] });
    await files.write(fileId, row.revision, { body: renamed, formatVersion: row.formatVersion, updatedAt: row.updatedAt });
    await expect(store.writeOutputs({ fileId }, programSheet(newCompanyFacts(COMPANY), program, 'N'), 'x'))
      .rejects.toMatchObject({ code: 'structure', message: expect.stringContaining(PUBLIC_TAB.toLowerCase()) });
    expect((await files.read(fileId))!.body).toBe(renamed);
  });

  it('a save that lands while outputs are written plans again and keeps both', async () => {
    const files = new MemoryWorkFiles();
    const program = sampleProgram();
    const { fileId } = await createDatabaseProgramStore(options(files)).create(owner, COMPANY, program);
    let interleaved = false;
    const racing: WorkFiles = {
      create: (row) => files.create(row), read: (id) => files.read(id), trash: (id, at) => files.trash(id, at), restore: (id) => files.restore(id),
      write: async (id: string, revision: number, next: WorkFileWrite) => {
        if (!interleaved) {
          interleaved = true;
          await createDatabaseProgramStore(options(files)).apply({ fileId: id },
            { kind: 'save', program: { ...program, name: 'Saved meanwhile' }, base: program, expectedUpdatedAt: program.updatedAt || null }, stamp);
        }
        return files.write(id, revision, next);
      },
    };
    const facts = newCompanyFacts(COMPANY);
    await createDatabaseProgramStore({ files: racing, appBaseUrl: 'https://desk.test' }).writeOutputs({ fileId }, programSheet(facts, program, 'N'), 'x');
    const read = await createDatabaseProgramStore(options(files)).read({ fileId });
    expect(read).toMatchObject({ ok: true, snapshot: { value: { name: 'Saved meanwhile' } } });
    const body = JSON.parse((await files.read(fileId))!.body) as Workbook;
    expect(body[PUBLIC_TAB]?.length).toBeGreaterThan(0);
    expect((await files.read(fileId))!.revision).toBe(2);
  });

  it('answers that the database isn’t answering when the port fails, for create, read, save and outputs', async () => {
    const broken: WorkFiles = {
      create: async () => { throw new Error('work_file_create_failed'); },
      read: async () => { throw new Error('work_file_read_failed'); },
      write: async () => { throw new Error('work_file_write_failed'); },
      trash: async () => { throw new Error('work_file_trash_failed'); },
      restore: async () => { throw new Error('work_file_restore_failed'); },
    };
    const store = createDatabaseProgramStore({ files: broken, appBaseUrl: 'https://desk.test' });
    const program = sampleProgram();
    const ref = { fileId: 'wf_0123456789abcdef0123' };
    await expect(store.create(owner, COMPANY, program)).rejects.toMatchObject({ code: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE });
    expect(await store.read(ref)).toEqual({ ok: false, error: 'unavailable', message: COPY.DB_UNAVAILABLE_MESSAGE });
    expect(await store.apply(ref, { kind: 'save', program, base: program, expectedUpdatedAt: null }, stamp)).toMatchObject({ ok: false, error: 'unavailable' });
    await expect(store.writeOutputs(ref, programSheet(newCompanyFacts(COMPANY), program, 'N'), 'x')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(store.trash(ref)).resolves.toBeUndefined();
  });
});

describe('the database case store', () => {
  it('links a file to its download address', async () => {
    const store = createDatabaseCaseStore(options(new MemoryWorkFiles()));
    const { fileId, fileUrl } = await store.create(owner, COMPANY, sampleCase());
    expect(fileUrl).toBe(`https://desk.test/files/${fileId}/download`);
  });
});

describe('the database Company facts store: version 1', () => {
  it('reads a version 1 body with nothing of ours, and its next save writes version 2 with the Our cost lines tab', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabaseCompanyFactsStore(options(files));
    const sample = sampleFacts();
    const { fileId } = await store.create(owner, COMPANY, sample);
    const wb = JSON.parse((await files.read(fileId))!.body) as Workbook;
    const figures = new Set<unknown>(Object.values(FIGURES));
    wb['Company facts'] = wb['Company facts']!.filter((row) => !figures.has(row[0]));
    delete wb['Our cost lines'];
    wb._meta = wb._meta!.map((row) => (row[0] === 'schemaVersion' ? ['schemaVersion', 1] : row));
    await files.write(fileId, 0, { body: JSON.stringify(wb), formatVersion: 1, updatedAt: stamp.now });

    const first = await store.read({ fileId });
    if (!first.ok) throw new Error(first.message);
    expect(first.snapshot.value.ours).toEqual({ figures: emptyFigures(), costs: [] });
    const v1 = first.snapshot.value;
    const saved = await store.apply({ fileId }, { kind: 'save', facts: { ...v1, ours: sample.ours }, base: v1, expectedUpdatedAt: v1.updatedAt }, stamp);
    expect(saved).toMatchObject({ ok: true, snapshot: { value: { ours: sample.ours } } });
    const row = (await files.read(fileId))!;
    expect(row.formatVersion).toBe(2);
    const after = JSON.parse(row.body) as Workbook;
    expect(after._meta).toContainEqual(['schemaVersion', 2]);
    expect(after['Our cost lines']?.[0]).toEqual(['Cost', 'When', 'Amount', 'Source', 'Id']);
  });

  it('reads a damaged body as damaged, and a save doesn’t write it', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabaseCompanyFactsStore(options(files));
    const { fileId } = await store.create(owner, COMPANY, sampleFacts());
    await files.write(fileId, 0, { body: 'not json', formatVersion: 2, updatedAt: stamp.now });
    expect(await store.read({ fileId })).toMatchObject({ ok: false, error: 'structure', message: COPY.DB_FILE_DAMAGED });
    const facts = sampleFacts();
    expect(await store.apply({ fileId }, { kind: 'save', facts, base: facts, expectedUpdatedAt: facts.updatedAt }, stamp)).toMatchObject({ ok: false, error: 'structure' });
    expect((await files.read(fileId))!).toMatchObject({ body: 'not json', revision: 1 });
  });
});

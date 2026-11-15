// The Google side of the Company facts and program files: what is made in Drive, the file name, the calls a read and
// a save make, and where the outputs go. The shared cases are in the contract suites.
import { describe, expect, it } from 'vitest';
import { emptyFigures, programSheet, publicBlocks, publicPlain } from '@partner-desk/core';
import { NOW } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { sampleFacts } from '../company-facts-store.contract';
import { sampleProgram } from '../program-store.contract';
import { FIGURES } from '../sheet-codec/case-records';
import type { Cell } from '../sheet-codec/grid';
import { FakeGoogle, fakeClient } from './fake-google';
import { MemoryFolderStore } from './folders';
import { createSheetMetaCache } from './meta-cache';
import { createGoogleCompanyFactsStore, createGoogleProgramStore, programFileName } from './program-store';

const owner = { userId: 'u_1', displayName: 'Anna Keller' };
const stamp = { now: NOW, actor: 'Ruth' };
const program = sampleProgram();
const COMPANY = program.companyId;
type ValuesBody = { valueInputOption: string; data: Array<{ range: string; values: Cell[][] }> };

function setup(withCache = false) {
  const fake = new FakeGoogle();
  let now = 0;
  const metaCache = withCache ? createSheetMetaCache({ ttlMs: 600_000, clock: () => now }) : undefined;
  const opts = { client: fakeClient(fake), folders: new MemoryFolderStore(), clock: () => '2026-10-26T09:05:42.000Z', metaCache };
  return { fake, programs: createGoogleProgramStore(opts), facts: createGoogleCompanyFactsStore(opts), tick: () => { now += 1; } };
}

async function made(withCache = false) {
  const env = setup(withCache);
  const { fileId } = await env.programs.create(owner, COMPANY, program);
  env.fake.calls.length = 0;
  return { ...env, fileId, ref: { fileId } };
}

/** Each call after the file was made: the Drive trash check, the layout, a values read, or a write. */
const kinds = (fake: FakeGoogle) => fake.calls.map((c) => {
  if (c.method !== 'GET') return c.url.pathname.includes('/values') ? 'values write' : c.url.pathname.includes('/drive/') ? 'drive write' : 'batchUpdate';
  return c.url.pathname.endsWith('/values:batchGet') ? 'values' : c.url.pathname.includes('/drive/') ? 'drive read' : 'layout';
});

describe('Google program files: create', () => {
  it('makes the program spreadsheet in PartnerStandard / PartnerStandard Desk, named by its label, with its tabs set up', async () => {
    const { fake, programs } = setup();
    const created = await programs.create(owner, COMPANY, program);
    const sheet = fake.spreadsheet(created.fileId)!;
    expect(sheet.name).toBe('PartnerStandard Desk – Program – Reseller · DACH');
    expect(programFileName(program)).toBe(sheet.name);
    const [root, desk] = fake.folders();
    expect([root!.name, desk!.name]).toEqual(['PartnerStandard', 'PartnerStandard Desk']);
    expect(sheet.parents).toEqual([desk!.id]);
    const tabs = [...sheet.sheets].sort((a, b) => a.index - b.index);
    expect(tabs.map((t) => t.title)).toEqual(['Program Sheet', 'Program', 'Reasons', 'Entry', 'Benefits', 'Requirements', 'Performance bar', 'Public page', '_meta']);
    expect(tabs.filter((t) => t.hidden).map((t) => t.title)).toEqual(['_meta']);
    expect(tabs.filter((t) => t.frozenRows === 1).map((t) => t.title)).toEqual(['Program', 'Reasons', 'Entry', 'Benefits', 'Requirements', 'Performance bar']);
    expect(sheet.protections).toEqual([expect.objectContaining({ range: { sheetId: 8 }, warningOnly: true })]);
    expect(fake.getWorkbook(created.fileId)._meta).toEqual([
      ['key', 'value'], ['schemaVersion', 1], ['companyId', COMPANY], ['programId', program.id], ['createdWith', 'desk.partnerstandard.com'],
    ]);
  });

  it('makes the Company facts spreadsheet as "PartnerStandard Desk – Company facts"', async () => {
    const { fake, facts } = setup();
    const created = await facts.create(owner, COMPANY, sampleFacts());
    const sheet = fake.spreadsheet(created.fileId)!;
    expect(sheet.name).toBe('PartnerStandard Desk – Company facts');
    expect(sheet.sheets.map((t) => t.title)).toEqual(['Company facts', 'Our cost lines', '_meta']);
    expect(sheet.sheets.filter((t) => t.frozenRows === 1).map((t) => t.title)).toEqual(['Company facts', 'Our cost lines']);
  });

  it('trashes a half-made spreadsheet and says to try again when a step fails', async () => {
    const { fake, programs } = setup();
    // Folders, the spreadsheet and its setup succeed; the value write after setup fails for good.
    fake.beforeRequest = (call) => {
      if (call.url.pathname.endsWith(':batchUpdate') && !call.url.pathname.includes('/values')) {
        fake.beforeRequest = undefined;
        fake.failNext(400);
      }
    };
    await expect(programs.create(owner, COMPANY, program)).rejects.toMatchObject({ code: 'unavailable' });
    const trashed = fake.calls.find((c) => c.method === 'PATCH');
    expect(trashed?.body).toEqual({ trashed: true });
    expect(fake.spreadsheet(trashed!.url.pathname.split('/files/')[1]!)).toMatchObject({ trashed: true });
  });
});

describe('Google program files: reading and saving', () => {
  it('reads with one values read once the layout is cached', async () => {
    const { fake, programs, ref } = await made(true);
    await programs.read(ref);
    fake.calls.length = 0;
    await programs.read(ref);
    expect(kinds(fake)).toEqual(['values']);
  });

  it('saves with one values read and one values write, and renames the file only when the label changes', async () => {
    const { fake, programs, ref, fileId } = await made(true);
    await programs.read(ref);
    fake.calls.length = 0;
    const renamed = await programs.apply(ref, { kind: 'save', program: { ...program, name: 'New name' }, base: program, expectedUpdatedAt: program.updatedAt }, stamp);
    expect(renamed.ok).toBe(true);
    expect(kinds(fake)).toEqual(['values', 'values write']);
    expect(fake.spreadsheet(fileId)!.name).toBe('PartnerStandard Desk – Program – Reseller · DACH');
    fake.calls.length = 0;
    await programs.apply(ref, { kind: 'save', program: { ...program, name: 'New name', focus: 'Nordics' }, base: { ...program, name: 'New name', updatedAt: NOW }, expectedUpdatedAt: NOW }, stamp);
    // The file's name is read first, so a file named before the new name keeps its prefix.
    expect(kinds(fake)).toEqual(['values', 'values write', 'drive read', 'drive write']);
    expect(fake.spreadsheet(fileId)!.name).toBe('PartnerStandard Desk – Program – Reseller · Nordics');
  });

  it('keeps the earlier prefix of a file named before the new name when it renames it', async () => {
    const { fake, programs, ref, fileId } = await made(true);
    fake.spreadsheet(fileId)!.name = 'Partner Desk – Program – Reseller · DACH'; // as made before 2026-11-10
    await programs.read(ref);
    await programs.apply(ref, { kind: 'save', program: { ...program, focus: 'Nordics' }, base: program, expectedUpdatedAt: program.updatedAt }, stamp);
    expect(fake.spreadsheet(fileId)!.name).toBe('Partner Desk – Program – Reseller · Nordics');
  });

  it('writes only the rows a save changes, as RAW', async () => {
    const { fake, programs, ref } = await made();
    await programs.apply(ref, { kind: 'save', program: { ...program, why: ['Changed', program.why[1]!] }, base: program, expectedUpdatedAt: program.updatedAt }, stamp);
    const write = fake.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/values:batchUpdate'))!.body as ValuesBody;
    expect(write.valueInputOption).toBe('RAW');
    expect(write.data.every((d) => !d.range.startsWith("'Program Sheet'") && !d.range.startsWith("'Public page'") && !d.range.startsWith("'_meta'"))).toBe(true);
  });

  it("keeps a person's own column between the tool's columns through a save", async () => {
    const { fake, programs, ref, fileId } = await made();
    const wb = fake.getWorkbook(fileId);
    // Measure | My notes | At least | Unit
    wb['Performance bar'] = wb['Performance bar']!.map((row, i) => [row[0]!, i === 0 ? 'My notes' : `note ${i}`, ...row.slice(1)]);
    fake.setWorkbook(fileId, wb);
    const first = await programs.read(ref);
    if (!first.ok) throw new Error(first.message);
    expect(first.snapshot.value.bars).toEqual(program.bars);
    const bars = [{ label: 'Changed', value: 7, unit: 'a month' }, { label: 'Second', value: 8, unit: 'a year' }];
    const saved = await programs.apply(ref, { kind: 'save', program: { ...first.snapshot.value, bars }, base: first.snapshot.value, expectedUpdatedAt: program.updatedAt }, stamp);
    expect(saved.ok).toBe(true);
    expect(fake.getWorkbook(fileId)['Performance bar']).toEqual([
      ['Measure', 'My notes', 'At least', 'Unit'], ['Changed', 'note 1', 7, 'a month'], ['Second', 'note 2', 8, 'a year'],
    ]);
  });

  it('reads a spreadsheet a person moved to the trash as gone', async () => {
    const { fake, programs, ref, fileId } = await made();
    fake.trash(fileId);
    expect(await programs.read(ref)).toEqual({ ok: false, error: 'file_not_found', message: COPY.FILE_GONE });
  });

  it('moves a deleted program to the Drive trash, never deleting it for good', async () => {
    const { fake, programs, ref, fileId } = await made();
    await programs.trash(ref);
    expect(fake.spreadsheet(fileId)?.trashed).toBe(true);
  });
});

describe('Google Company facts files: version 1', () => {
  it('reads a version 1 file with nothing of ours, and the next save makes the Our cost lines tab, the figure rows and version 2', async () => {
    const { fake, facts } = setup(true);
    const sample = sampleFacts();
    const { fileId } = await facts.create(owner, COMPANY, sample);
    // As version 1 made it: no figure rows, no Our cost lines tab.
    const wb = fake.getWorkbook(fileId);
    const figures = new Set<unknown>(Object.values(FIGURES));
    wb['Company facts'] = wb['Company facts']!.filter((row) => !figures.has(row[0]));
    delete wb['Our cost lines'];
    wb._meta = wb._meta!.map((row) => (row[0] === 'schemaVersion' ? ['schemaVersion', 1] : row));
    fake.setWorkbook(fileId, wb);
    expect(fake.getWorkbook(fileId)['Company facts']!.map((row) => row[0])).not.toContain('Gross margin (%)');

    const first = await facts.read({ fileId });
    if (!first.ok) throw new Error(first.message);
    expect(first.snapshot.value.ours).toEqual({ figures: emptyFigures(), costs: [] });
    const v1 = first.snapshot.value;
    const saved = await facts.apply({ fileId }, { kind: 'save', facts: { ...v1, ours: sample.ours }, base: v1, expectedUpdatedAt: v1.updatedAt }, stamp);
    expect(saved).toMatchObject({ ok: true, snapshot: { value: { ours: sample.ours } } });

    const after = fake.getWorkbook(fileId);
    expect(after._meta).toContainEqual(['schemaVersion', 2]);
    expect(after['Our cost lines']).toEqual([
      ['Cost', 'When', 'Amount', 'Source', 'Id'], ['Partner manager time', 'Every year', 24000, 'Finance', 'oc_contract01'],
    ]);
    expect(after['Company facts']).toContainEqual(['Gross margin (%)', 78]);
    expect(fake.spreadsheet(fileId)!.sheets.find((t) => t.title === 'Our cost lines')).toMatchObject({ frozenRows: 1 });
    expect(await facts.read({ fileId })).toMatchObject({ ok: true, snapshot: { value: { ...v1, ours: sample.ours, updatedAt: NOW } } });
  });
});

describe('Google program files: outputs', () => {
  const facts = sampleFacts();
  const sheet = programSheet(facts, program, 'Northwind Security');
  const text = publicPlain(publicBlocks(facts, program));

  it('writes the note with the time, and sends every clear, format and value only to the output tabs', async () => {
    const { fake, programs, ref, fileId } = await made();
    await programs.writeOutputs(ref, sheet, text);
    const wb = fake.getWorkbook(fileId);
    expect(wb['Program Sheet']![0]).toEqual([expect.stringContaining('Last updated 26 Oct 2026, 09:05 UTC')]);
    expect(wb['Public page']![2]).toEqual([text.split('\n')[0]]);
    const ids = fake.spreadsheet(fileId)!.sheets.filter((t) => t.title === 'Program Sheet' || t.title === 'Public page').map((t) => t.sheetId);
    const update = fake.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith(':batchUpdate') && !c.url.pathname.includes('/values'))!;
    const sheetIds = JSON.stringify(update.body).match(/"sheetId":\d+/g)!.map((m) => Number(m.split(':')[1]));
    expect(new Set(sheetIds)).toEqual(new Set(ids));
    const values = fake.calls.find((c) => c.method === 'POST' && c.url.pathname.endsWith('/values:batchUpdate'))!.body as ValuesBody;
    expect(values.data.map((d) => d.range)).toEqual(["'Program Sheet'", "'Public page'"]);
  });

  it('clears what the last outputs left behind', async () => {
    const { fake, programs, ref, fileId } = await made();
    await programs.writeOutputs(ref, sheet, `${text}\nOne more line`);
    await programs.writeOutputs(ref, sheet, '# Short');
    const page = fake.getWorkbook(fileId)['Public page']!.flat().filter((cell) => cell !== null && cell !== '');
    expect(page).toHaveLength(2);
    expect(page[1]).toBe('# Short');
  });

  it('throws a StoreFailure the screen can show when Google keeps failing', async () => {
    const { fake, programs, ref } = await made();
    fake.failNext(503, 10);
    await expect(programs.writeOutputs(ref, sheet, text)).rejects.toMatchObject({ code: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
  });
});

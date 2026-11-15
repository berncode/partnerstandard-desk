import { describe, expect, it } from 'vitest';
import type { MapPlan } from '@partner-desk/core';
import { buildSamplePlan } from '@partner-desk/method';
import { sampleCase } from '../case-store.contract';
import { sampleFacts } from '../company-facts-store.contract';
import { sampleProgram } from '../program-store.contract';
import { sampleMarket } from '@partner-desk/core/test-builders';
import type { Workbook } from '../sheet-codec/grid';
import { PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { PROGRAM_SHEET_TAB, PUBLIC_TAB } from '../sheet-codec/program-layout';
import { createDatabaseCaseStore } from './case-store';
import { exportName, exportWorkFile, orderedTabs } from './export';
import { createDatabaseMapStore } from './map-store';
import { createDatabaseMarketStore } from './market-store';
import { MemoryWorkFiles } from './memory-work-files';
import { createDatabasePartnerBookStore } from './partner-book-store';
import { createDatabaseCompanyFactsStore, createDatabaseProgramStore } from './program-store';
import type { WorkFiles } from './work-files';

const owner = { userId: 'u_contract', displayName: 'Anna Keller' };
const COMPANY = 'co_contract001';
const options = (files: WorkFiles) => ({ files, appBaseUrl: 'https://desk.test' });

describe('exportWorkFile', () => {
  it('gives a Partners file its tabs in the file’s order and its Drive name', async () => {
    const files = new MemoryWorkFiles();
    const { fileId } = await createDatabasePartnerBookStore(options(files)).create(owner, COMPANY);
    const out = await exportWorkFile(files, fileId);
    expect(out).toMatchObject({ kind: 'partners', companyId: COMPANY, name: 'PartnerStandard Desk – Partners' });
    if (!out || out === 'unavailable') throw new Error('export');
    expect(out.tabs.map((t) => t.title)).toEqual(PARTNERS_LAYOUT.tabOrder);
  });

  it('names a market, a program, Company facts, a case and a MAP as their Drive files are named', async () => {
    const files = new MemoryWorkFiles();
    const market = sampleMarket();
    const made = {
      market: (await createDatabaseMarketStore(options(files)).create(owner, { ...market, info: { ...market.info, companyId: COMPANY } })).fileId,
      program: (await createDatabaseProgramStore(options(files)).create(owner, COMPANY, sampleProgram())).fileId,
      facts: (await createDatabaseCompanyFactsStore(options(files)).create(owner, COMPANY, sampleFacts())).fileId,
      case: (await createDatabaseCaseStore(options(files)).create(owner, COMPANY, sampleCase())).fileId,
      map: (await createDatabaseMapStore(options(files)).create(owner, COMPANY, { ...(buildSamplePlan('2026-11-07') as MapPlan), info: { ...(buildSamplePlan('2026-11-07') as MapPlan).info, partnerType: 'reseller' } }, 'Acme')).fileId,
    };
    const names = Object.fromEntries(await Promise.all(Object.entries(made).map(async ([k, id]) => {
      const out = await exportWorkFile(files, id);
      return [k, out && out !== 'unavailable' ? out.name : null];
    })));
    expect(names.market).toMatch(/^PartnerStandard Desk – .+ · .+$/);
    expect(names.program).toMatch(/^PartnerStandard Desk – Program – /);
    expect(names.facts).toBe('PartnerStandard Desk – Company facts');
    expect(names.case).toMatch(/^PartnerStandard Desk – Business case – .+ as .+ · \d{4}-\d{2}-\d{2}$/);
    expect(names.map).toBe('PartnerStandard Desk – MAP – Reseller');
  });

  it('answers null for a file that is gone or trashed, and unavailable when the database fails', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabasePartnerBookStore(options(files));
    const { fileId } = await store.create(owner, COMPANY);
    expect(await exportWorkFile(files, 'wf_0123456789abcdef0123')).toBeNull();
    await store.trash({ fileId });
    expect(await exportWorkFile(files, fileId)).toBeNull();
    const broken = { ...files, read: async () => { throw new Error('work_file_read_failed'); } } as unknown as WorkFiles;
    expect(await exportWorkFile(broken, fileId)).toBe('unavailable');
  });
});

describe('exportWorkFile and a damaged file', () => {
  it('answers null for a body that isn’t a workbook, and downloads one that reads only in part under its kind’s plain name', async () => {
    const files = new MemoryWorkFiles();
    const store = createDatabasePartnerBookStore(options(files));
    const { fileId } = await store.create(owner, COMPANY);
    await files.write(fileId, 0, { body: 'not json', formatVersion: 5, updatedAt: '2026-11-08T10:00:00.000Z' });
    expect(await exportWorkFile(files, fileId)).toBeNull();
    const market = await createDatabaseMarketStore(options(files)).create(owner, { ...sampleMarket(), info: { ...sampleMarket().info, companyId: COMPANY } });
    const row = (await files.read(market.fileId))!;
    await files.write(market.fileId, row.revision, { body: JSON.stringify({ Notes: [['kept']] }), formatVersion: row.formatVersion, updatedAt: row.updatedAt });
    expect(await exportWorkFile(files, market.fileId)).toMatchObject({ name: 'PartnerStandard Desk – Market', tabs: [{ title: 'Notes', rows: [['kept']] }] });
  });
});

describe('orderedTabs', () => {
  it('puts a program’s Program Sheet first and its Public page last, whatever the body’s key order', () => {
    const wb: Workbook = { _meta: [['key']], [PUBLIC_TAB]: [['p']], Program: [['x']], [PROGRAM_SHEET_TAB]: [['s']] };
    expect(orderedTabs('program', wb).map((t) => t.title)).toEqual([PROGRAM_SHEET_TAB, 'Program', PUBLIC_TAB, '_meta']);
  });

  it('puts a tab an upgrade added in its place, and any other tab after the known ones', () => {
    const order = PARTNERS_LAYOUT.tabOrder;
    const wb: Workbook = Object.fromEntries([...order.filter((t) => t !== 'Proposals'), 'My notes', 'Proposals'].map((t) => [t, [[t]]]));
    expect(orderedTabs('partners', wb).map((t) => t.title)).toEqual([...order, 'My notes']);
  });
});

describe('exportName', () => {
  it('falls back to the kind’s plain name when the file doesn’t read', () => {
    expect(exportName('market', {})).toBe('PartnerStandard Desk – Market');
    expect(exportName('map', {})).toBe('PartnerStandard Desk – MAP');
  });
});

import { newMapPlan } from '@partner-desk/core';
import { describe, expect, it } from 'vitest';
import { sampleCase } from '../case-store.contract';
import { sampleProgram } from '../program-store.contract';
import { createDatabaseCaseStore } from './case-store';
import { createDatabaseMapStore } from './map-store';
import { MemoryWorkFiles } from './memory-work-files';
import { createDatabaseProgramStore } from './program-store';
import { readTrashed } from './trash';

const owner = { userId: 'u_anna', displayName: 'Anna' };
const COMPANY = 'co_aaaaaaaaaa';

async function bodyOf(files: MemoryWorkFiles, fileId: string): Promise<string> {
  return (await files.read(fileId))!.body;
}

describe('readTrashed (plan 16, task 1)', () => {
  it('reads a case’s id, partner type, title and made-on from its body', async () => {
    const files = new MemoryWorkFiles();
    const c = sampleCase();
    const { fileId } = await createDatabaseCaseStore({ files, appBaseUrl: 'https://desk.test' }).create(owner, COMPANY, c);
    expect(readTrashed('businessCase', await bodyOf(files, fileId))).toEqual({
      kind: 'businessCase', caseId: c.id, partnerId: c.partnerId, partnerType: c.partnerType, title: c.title, createdAt: c.createdAt,
    });
  });

  it('reads a MAP’s partner type from its body', async () => {
    const files = new MemoryWorkFiles();
    const plan = newMapPlan({ partnerId: 'p_acme', partnerType: 'reseller', contacts: [] });
    const { fileId } = await createDatabaseMapStore({ files, appBaseUrl: 'https://desk.test' }).create(owner, COMPANY, plan, 'Acme');
    expect(readTrashed('map', await bodyOf(files, fileId))).toEqual({ kind: 'map', partnerId: 'p_acme', partnerType: 'reseller', people: [] });
  });

  it('reads a program’s id and its name as the lists show it', async () => {
    const files = new MemoryWorkFiles();
    const p = sampleProgram();
    const { fileId } = await createDatabaseProgramStore({ files, appBaseUrl: 'https://desk.test' }).create(owner, COMPANY, p);
    expect(readTrashed('program', await bodyOf(files, fileId))).toMatchObject({ kind: 'program', programId: p.id, programType: p.type });
    expect((readTrashed('program', await bodyOf(files, fileId)) as { label: string }).label).toMatch(/^Reseller/);
  });

  it('answers null for a body it can’t read, never throws', async () => {
    for (const body of ['not json', 'null', '{}', '{"Case":[["x"]]}', '{"Case":"x"}', '{"Case":5}', '{"Case":{}}', '{"Case":[null]}',
      '{"Plan":"x","Program":5}', '{"_meta":[null],"Program":[null]}']) {
      for (const kind of ['businessCase', 'map', 'program'] as const) expect(readTrashed(kind, body)).toBeNull();
    }
  });
});

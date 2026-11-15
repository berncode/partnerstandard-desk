// The Google side of a business case file: what is made in Drive, its name and tabs, and the trash. The shared cases
// are in the contract suite.
import { describe, expect, it } from 'vitest';
import { NOW } from '@partner-desk/core/test-builders';
import { sampleCase } from '../case-store.contract';
import { caseFileName, createGoogleCaseStore } from './case-store';
import { FakeGoogle, fakeClient } from './fake-google';
import { MemoryFolderStore } from './folders';

const owner = { userId: 'u_1', displayName: 'Anna Keller' };
const stamp = { now: NOW, actor: 'Ruth' };
const sample = sampleCase();

function setup() {
  const fake = new FakeGoogle();
  return { fake, cases: createGoogleCaseStore({ client: fakeClient(fake), folders: new MemoryFolderStore() }) };
}

describe('Google business case files', () => {
  it('makes one spreadsheet per case in PartnerStandard / PartnerStandard Desk, named by partner, type and day, with its tabs set up', async () => {
    const { fake, cases } = setup();
    const created = await cases.create(owner, sample.companyId, sample);
    const sheet = fake.spreadsheet(created.fileId)!;
    expect(sheet.name).toBe('PartnerStandard Desk – Business case – Northwind as Reseller · 2026-10-27');
    expect(caseFileName(sample)).toBe(sheet.name);
    const [root, desk] = fake.folders();
    expect([root!.name, desk!.name]).toEqual(['PartnerStandard', 'PartnerStandard Desk']);
    expect(sheet.parents).toEqual([desk!.id]);
    const tabs = [...sheet.sheets].sort((a, b) => a.index - b.index);
    const data = ['Offer', 'Products', 'Partner type', 'Case', 'Costs', 'Our case', 'Strategic reasons'];
    expect(tabs.map((t) => t.title)).toEqual([...data, '_meta']);
    expect(tabs.filter((t) => t.hidden).map((t) => t.title)).toEqual(['_meta']);
    expect(tabs.filter((t) => t.frozenRows === 1).map((t) => t.title)).toEqual(data);
    expect(fake.getWorkbook(created.fileId)._meta).toEqual([
      ['key', 'value'], ['schemaVersion', 1], ['companyId', sample.companyId], ['caseId', sample.id], ['createdWith', 'desk.partnerstandard.com'],
    ]);
  });

  it('renames the file when the partner it names changes, and only then', async () => {
    const { fake, cases } = setup();
    const { fileId } = await cases.create(owner, sample.companyId, sample);
    await cases.apply({ fileId }, { kind: 'save', case: { ...sample, title: 'Other title' }, base: sample, expectedUpdatedAt: sample.updatedAt }, stamp);
    expect(fake.spreadsheet(fileId)!.name).toBe(caseFileName(sample));
    const base = { ...sample, title: 'Other title', updatedAt: NOW };
    await cases.apply({ fileId }, { kind: 'save', case: { ...base, partner: 'Northwind GmbH' }, base, expectedUpdatedAt: NOW }, stamp);
    expect(fake.spreadsheet(fileId)!.name).toBe('PartnerStandard Desk – Business case – Northwind GmbH as Reseller · 2026-10-27');
  });

  it('keeps the earlier prefix of a case file named before the new name when it renames it', async () => {
    const { fake, cases } = setup();
    const { fileId } = await cases.create(owner, sample.companyId, sample);
    fake.spreadsheet(fileId)!.name = 'Partner Desk – Business case – Acme as Reseller · 2026-10-27'; // as made before 2026-11-10
    await cases.apply({ fileId }, { kind: 'save', case: { ...sample, partner: 'Northwind GmbH' }, base: sample, expectedUpdatedAt: sample.updatedAt }, stamp);
    expect(fake.spreadsheet(fileId)!.name).toBe('Partner Desk – Business case – Northwind GmbH as Reseller · 2026-10-27');
  });

  it('moves a deleted case to the Drive trash, never deleting it for good', async () => {
    const { fake, cases } = setup();
    const { fileId } = await cases.create(owner, sample.companyId, sample);
    await cases.trash({ fileId });
    expect(fake.spreadsheet(fileId)?.trashed).toBe(true);
  });
});

import { SHEET_COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it } from 'vitest';
import { runCaseStoreContract } from '../case-store.contract';
import { runCompanyFactsStoreContract } from '../company-facts-store.contract';
import { runMapStoreContract } from '../map-store.contract';
import { runMarketStoreContract } from '../market-store.contract';
import { runProgramStoreContract } from '../program-store.contract';
import { runPartnerBookStoreContract } from '../partner-book-store.contract';
import { newCompanyFacts } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { createMemoryCompanyFactsStore, createMemoryProgramStore, editMemoryFileByHand, memoryProgramOutputs, showMemoryRowIssues } from './program-stores';
import { createMemoryCaseStore } from './case-store';
import { createMemoryMapStore } from './map-store';
import { createMemoryMarketStore } from './market-store';
import { createMemoryPartnerBookStore, markMemoryBookOld, memoryTrashedPartnerFiles, resetMemoryBookTestState } from './partner-book-store';

const owner = { userId: 'u_contract', displayName: 'Anna Keller' };

runPartnerBookStoreContract('memory', () => ({ store: createMemoryPartnerBookStore(), owner }));
runMarketStoreContract('memory', () => ({ store: createMemoryMarketStore(), owner }));
runProgramStoreContract('memory', () => ({ store: createMemoryProgramStore(), owner }));
runCompanyFactsStoreContract('memory', () => ({ store: createMemoryCompanyFactsStore(), owner }));
runCaseStoreContract('memory', () => ({ store: createMemoryCaseStore(), owner }));
runMapStoreContract('memory', () => ({ store: createMemoryMapStore(), owner }));

describe('a version 1 Partners file in memory', () => {
  const store = createMemoryPartnerBookStore();
  beforeEach(() => resetMemoryBookTestState());

  it('reads as old_version until trash, which remembers the file id and then the file is gone', async () => {
    const { fileId } = await store.create(owner, 'co_aaaaaaaaaa');
    markMemoryBookOld(fileId);
    expect(await store.read({ fileId })).toEqual({ ok: false, error: 'old_version', message: SHEET_COPY.ISSUES.OLD_VERSION });
    await store.trash({ fileId });
    expect(memoryTrashedPartnerFiles()).toEqual([fileId]);
    expect(await store.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });
});

describe('a Company facts file edited by hand in memory', () => {
  it('reads with the hand edit, keeps its Updated, and refuses a save from a screen that read it before', async () => {
    const store = createMemoryCompanyFactsStore();
    const { fileId } = await store.create(owner, 'co_aaaaaaaaaa', newCompanyFacts('co_aaaaaaaaaa'));
    const before = await store.read({ fileId });
    if (!before.ok) throw new Error(before.error);
    const base = before.snapshot.value;
    editMemoryFileByHand(fileId, { yearly: 21000 });
    const after = await store.read({ fileId });
    expect(after).toMatchObject({ ok: true, snapshot: { value: { yearly: 21000, updatedAt: base.updatedAt } } });
    const stamp = { now: '2026-10-30T10:00:00.000Z', actor: 'Anna Keller' };
    expect(await store.apply({ fileId }, { kind: 'save', facts: { ...base, once: 5 }, base, expectedUpdatedAt: base.updatedAt || null }, stamp))
      .toEqual({ ok: false, error: 'conflict', message: COPY.SHEET_CHANGED_MESSAGE });
    expect(await store.read({ fileId })).toMatchObject({ ok: true, snapshot: { value: { yearly: 21000, once: 0 } } });
  });
});

describe('a program file in memory, for the e2e', () => {
  const store = createMemoryProgramStore();
  const stamp = { now: '2026-10-30T10:00:00.000Z', actor: 'Anna Keller' };

  it('reads and saves with the row issues a sheet would have, and keeps them until they are set again', async () => {
    const { brightpage } = await import('@partner-desk/core/test-builders');
    const program = brightpage().programs[0];
    const { fileId } = await store.create(owner, 'co_aaaaaaaaaa', program);
    const issues = [{ tab: 'Reasons', row: 3, message: 'Reason in Reasons row 3 is too long.' }];
    showMemoryRowIssues(fileId, issues);
    const read = await store.read({ fileId });
    expect(read).toMatchObject({ ok: true, snapshot: { issues } });
    const base = read.ok ? read.snapshot.value : program;
    expect(await store.apply({ fileId }, { kind: 'save', program: { ...base, lead: 'Sam' }, base, expectedUpdatedAt: base.updatedAt || null }, stamp))
      .toMatchObject({ ok: true, snapshot: { issues } });
    showMemoryRowIssues(fileId, []);
    expect(await store.read({ fileId })).toMatchObject({ ok: true, snapshot: { issues: [] } });
  });

  it('remembers the outputs last written, by file', async () => {
    const { brightpage } = await import('@partner-desk/core/test-builders');
    const { fileId } = await store.create(owner, 'co_aaaaaaaaaa', brightpage().programs[0]);
    expect(memoryProgramOutputs(fileId)).toBeNull();
    const { programSheet } = await import('@partner-desk/core');
    const bp = brightpage();
    await store.writeOutputs({ fileId }, programSheet(bp, bp.programs[0], bp.name), '# Public');
    expect(memoryProgramOutputs(fileId)).toMatchObject({ publicText: '# Public', sheet: { footer: ['Brightpage · internal, not for partners', 'Made with PartnerStandard Desk'] } });
  });
});

import { describe, expect, it, vi } from 'vitest';
import { caseTitle, partnerSide, type BusinessCase } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import {
  editMemoryFileByHand, ReconnectRequired, showMemoryRowIssues, StoreFailure, TokenUnavailable, type CaseStore, type PartnerBookStore,
} from '@partner-desk/storage';
import type { Actor } from './actor';
import {
  copyCase, createCase, deleteCase, listCases, openSharedCase, readCase, readCaseSources, recalculateCase, saveCase, shareCase,
  unshareCase, type ShareDeps,
} from './cases';
import { changeMarket, createMarket } from './markets';
import { changePartner, readPartners, recreatePartnerBook, removePartnerType } from './partners';
import { createProgram, deleteProgram, readCompanyFacts, readProgram, saveCompanyFacts, saveProgram } from './programs';
import { hashToken, newToken } from './share-tokens';
import { makeTestDeps, TEST_NOW } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
const companyId = 'co_aaaaaaaaaa';
const otherCompany = 'co_bbbbbbbbbb';
const LATER = '2026-11-02T09:00:00.000Z';
const LATEST = '2026-11-05T09:00:00.000Z';

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  await deps.companies.rename('u1', 'Halden');
  await readPartners(deps, owner, { companyId });
  await readCompanyFacts(deps, owner, { companyId });
  deps.events.events.length = 0;
  return deps;
}

type TestDeps = Awaited<ReturnType<typeof setup>>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function program(deps: TestDeps, partnerType = 'reseller') {
  return value(await createProgram(deps, owner, { companyId, partnerType, from: 'fresh' })).programId;
}

async function addPartnerType(deps: TestDeps, partnerType = 'reseller', company = 'Acme') {
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company } } }));
  const added = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType, whyItFits: 'Fits' } },
  }));
  return added.entityId!;
}

async function joinProgram(deps: TestDeps, partnerId: string, programId: string | null) {
  value(await changePartner(deps, owner, { companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch: { programId } } }));
}

async function partnerRow(deps: TestDeps, partnerId: string) {
  return value(await readPartners(deps, owner, { companyId })).value.partners.find((p) => p.id === partnerId);
}

/** A reseller partner type in a reseller program, and its first case. */
async function withCase(deps: TestDeps) {
  const programId = await program(deps);
  const partnerId = await addPartnerType(deps);
  await joinProgram(deps, partnerId, programId);
  const { caseId } = value(await createCase(deps, owner, { companyId, partnerId }));
  deps.events.events.length = 0;
  return { programId, partnerId, caseId };
}

async function read(deps: TestDeps, caseId: string) {
  return value(await readCase(deps, owner, { caseId }));
}

/** The save a screen sends: the case as it read it, changed by `edit`. */
async function save(deps: TestDeps, actor: Actor, caseId: string, edit: (c: BusinessCase) => void) {
  const before = await read(deps, caseId);
  const c = structuredClone(before.value);
  edit(c);
  return saveCase(deps, actor, { caseId, case: c, base: before.value, expectedUpdatedAt: before.value.updatedAt });
}

/** A partner type taken out of the Partners sheet by hand: straight to the file, past every command. */
async function removeByHand(deps: TestDeps, partnerId: string) {
  const book = deps.directory.books.get(companyId)!;
  const out = await deps.partnerBooks.apply(book, { kind: 'delete', entity: 'partner', id: partnerId }, { now: TEST_NOW, actor: 'Hand' });
  if (!out.ok) throw new Error('setup');
}

function shareDeps(deps: TestDeps, over: Partial<ShareDeps> = {}) {
  const log = vi.fn();
  const casesFor = vi.fn(async (userId: string): Promise<CaseStore | null> => (userId === 'u1' ? deps.cases : null));
  const partnerBooksFor = vi.fn(async (userId: string): Promise<PartnerBookStore | null> => (userId === 'u1' ? deps.partnerBooks : null));
  const share: ShareDeps = {
    shareLinks: deps.shareLinks, reviewLinks: deps.reviewLinks, directory: deps.directory, companies: deps.companies, casesFor, partnerBooksFor,
    mapsFor: async () => null, ownerName: async () => null, log, ...over,
  };
  return { share, log, casesFor, partnerBooksFor };
}

/** The case as its file holds it now, past every command. */
async function fileOf(deps: TestDeps, caseId: string): Promise<BusinessCase> {
  const read = await deps.cases.read({ fileId: (await deps.directory.businessCase(caseId))!.fileId });
  if (!read.ok) throw new Error('setup');
  return read.snapshot.value;
}

/** Renames the partner type's account in Partners, as a person does on the partner page. */
async function renameAccount(deps: TestDeps, partnerId: string, company: string) {
  const { accountId } = (await partnerRow(deps, partnerId))!;
  value(await changePartner(deps, owner, { companyId, change: { kind: 'update', entity: 'account', id: accountId, patch: { company } } }));
}

describe('createCase', () => {
  it('fills a case from Company facts and the program the partner type is in, lists it, and moves no stage', async () => {
    const deps = await setup();
    const programId = await program(deps);
    const partnerId = await addPartnerType(deps);
    await joinProgram(deps, partnerId, programId);
    const before = await partnerRow(deps, partnerId);
    deps.events.events.length = 0;

    const { caseId } = value(await createCase(deps, owner, { companyId, partnerId }));

    const c = (await read(deps, caseId)).value;
    expect(c).toMatchObject({
      id: caseId, companyId, partnerId, partnerType: 'reseller', programId, title: caseTitle('2026-10-28'), createdAt: TEST_NOW,
      stageWhenMade: before!.stage, recalculatedAt: null, partner: 'Acme', shared: null,
    });
    expect(c.offer.company).toBe('Halden');
    expect(await deps.directory.businessCase(caseId)).toEqual({
      fileId: expect.any(String), ownerUserId: 'u1', companyId, partnerId, partnerType: 'reseller', displayName: caseTitle('2026-10-28'),
      createdAt: TEST_NOW,
    });
    expect(deps.events.events[0]).toMatchObject({ command: 'cases.create', entityIds: [caseId, partnerId, programId], actorKind: 'owner' });
    // Spec 5.6: making a case never moves a stage or a step, and never writes Partners.
    expect(await partnerRow(deps, partnerId)).toEqual(before);
    expect(deps.events.events.map((e) => e.command)).not.toContain('partners.change');
  });

  it('takes the program a linked market feeds when the partner type is in none', async () => {
    const deps = await setup();
    await program(deps);
    const fed = await program(deps);
    const partnerId = await addPartnerType(deps);
    const { marketId } = value(await createMarket(deps, owner, {
      companyId, info: { marketName: 'DACH', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
    }));
    value(await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { feedsProgramId: fed } } }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'marketLink', values: { partnerId, marketId } } }));
    const { caseId } = value(await createCase(deps, owner, { companyId, partnerId }));
    expect((await read(deps, caseId)).value.programId).toBe(fed);
  });

  it('asks the person to pick when the type has a program but the partner type is in none, even only one', async () => {
    const deps = await setup();
    const programId = await program(deps);
    const partnerId = await addPartnerType(deps);
    deps.events.events.length = 0;
    expect(await createCase(deps, owner, { companyId, partnerId })).toEqual({
      ok: false, error: 'invalid', message: COPY.CASE_PICK_PROGRAM, fieldErrors: { programId: COPY.CASE_PICK_PROGRAM },
    });
    expect(await deps.directory.businessCases(companyId)).toEqual([]);
    expect(deps.events.events).toEqual([]);
    const { caseId } = value(await createCase(deps, owner, { companyId, partnerId, programId }));
    expect((await read(deps, caseId)).value.programId).toBe(programId);
  });

  it('starts with no program when the type has none, and says so', async () => {
    const deps = await setup();
    const reseller = await addPartnerType(deps);
    const technology = await addPartnerType(deps, 'technology', 'Bolt');
    const a = (await read(deps, value(await createCase(deps, owner, { companyId, partnerId: reseller })).caseId)).value;
    expect(a).toMatchObject({ programId: null, notes: ['no-program'] });
    const b = (await read(deps, value(await createCase(deps, owner, { companyId, partnerId: technology })).caseId)).value;
    expect(b).toMatchObject({ programId: null, notes: ['no-program-type'], partner: 'Bolt', partnerType: 'technology' });
  });

  it('refuses a program of another type, of another company, or one that is not there', async () => {
    const deps = await setup();
    const referral = await program(deps, 'referral');
    const partnerId = await addPartnerType(deps);
    await deps.directory.addProgram({
      programId: 'pg_elsewhere0', companyId: otherCompany, ownerUserId: 'u1', fileId: 'f_else', displayName: 'Reseller', partnerType: 'reseller',
    });
    expect(await createCase(deps, owner, { companyId, partnerId, programId: referral })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { programId: COPY.PROGRAM_OTHER_TYPE },
    });
    for (const programId of ['pg_elsewhere0', 'pg_nothere000']) {
      expect(await createCase(deps, owner, { companyId, partnerId, programId })).toMatchObject({
        ok: false, error: 'invalid', fieldErrors: { programId: COPY.PROGRAM_NOT_FOUND },
      });
    }
    expect(await deps.directory.businessCases(companyId)).toEqual([]);
  });

  it('refuses a partner type that is not in Partners, a stranger, an agent without change, and bad input', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    expect(await createCase(deps, owner, { companyId, partnerId: 'p_nothere' })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { partnerId: COPY.CASE_TYPE_GONE },
    });
    expect(await createCase(deps, stranger, { companyId, partnerId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await createCase(deps, stranger, { companyId: otherCompany, partnerId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await createCase(deps, agent('read'), { companyId, partnerId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await createCase(deps, owner, { companyId, partnerId, extra: 1 })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await createCase(deps, owner, { companyId: 'nope', partnerId })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await deps.directory.businessCases(companyId)).toEqual([]);
    expect((await createCase(deps, agent('change'), { companyId, partnerId })).ok).toBe(true);
    // A propose agent may do all a change agent may (agent proposals spec 5.2).
    expect((await createCase(deps, agent('propose'), { companyId, partnerId })).ok).toBe(true);
  });

  it('checks access before it reads or makes Company facts: a refused actor makes no file', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
    await readPartners(deps, owner, { companyId });
    const partnerId = await addPartnerType(deps);
    const looked = vi.spyOn(deps.directory, 'companyFacts');
    const made = vi.spyOn(deps.companyFacts, 'create');
    expect(await createCase(deps, agent('read'), { companyId, partnerId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(looked).not.toHaveBeenCalled();
    expect(made).not.toHaveBeenCalled();
    expect(await deps.directory.companyFacts(companyId)).toBeNull();
  });
});

describe('listCases', () => {
  it('lists the person’s cases newest first, from the directory, for one partner type when asked', async () => {
    const deps = await setup();
    const { partnerId, caseId } = await withCase(deps);
    const other = await addPartnerType(deps, 'technology', 'Bolt');
    deps.clock = () => LATER;
    const { caseId: newer } = value(await createCase(deps, owner, { companyId, partnerId: other }));
    await deps.directory.addBusinessCase({
      caseId: 'case_strangers', companyId, ownerUserId: 'u2', fileId: 'f_s', partnerId, partnerType: 'reseller', displayName: 'Theirs', createdAt: LATEST,
    });
    deps.events.events.length = 0;
    expect(value(await listCases(deps, owner, { companyId }))).toEqual([
      { caseId: newer, title: caseTitle('2026-11-02'), partnerId: other, partnerType: 'technology', createdAt: LATER },
      { caseId, title: caseTitle('2026-10-28'), partnerId, partnerType: 'reseller', createdAt: TEST_NOW },
    ]);
    expect(value(await listCases(deps, agent('read'), { companyId, partnerId }))).toEqual([
      { caseId, title: caseTitle('2026-10-28'), partnerId, partnerType: 'reseller', createdAt: TEST_NOW },
    ]);
    expect(deps.events.events).toEqual([]); // a read leaves no event (owner, 2026-11-14)
    expect(await listCases(deps, owner, { companyId: otherCompany })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(value(await listCases(deps, stranger, { companyId: otherCompany }))).toEqual([]);
  });
});

describe('readCase', () => {
  it('reads the case with the company’s name as it is now, its file link and whether a link works', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    await deps.companies.rename('u1', 'Halden Group');
    const first = await read(deps, caseId);
    expect(first.value.offer.company).toBe('Halden Group');
    expect(first.shared).toBeNull();
    const entry = await deps.directory.businessCase(caseId);
    expect(first.fileUrl).toBe(deps.cases.urlFor({ fileId: entry!.fileId }));
    deps.clock = () => LATER;
    value(await shareCase(deps, owner, { caseId }));
    expect((await read(deps, caseId)).shared).toEqual({ createdAt: LATER });
    expect(deps.events.events.map((e) => e.command)).toEqual(['cases.share']); // the reads leave none
  });

  it('keeps the name stored with the case when the company has none', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    await deps.companies.rename('u1', '');
    expect((await read(deps, caseId)).value.offer.company).toBe('Halden');
  });

  it('shows nobody else the case, and lets an agent read it', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    expect(await readCase(deps, stranger, { caseId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await readCase(deps, owner, { caseId: 'case_nothere' })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect((await readCase(deps, agent('read'), { caseId })).ok).toBe(true);
  });
});

describe('readCaseSources', () => {
  it('says when Company facts or the program changed after the case was made, and not after a recalculation', async () => {
    const deps = await setup();
    const { caseId, programId } = await withCase(deps);
    expect(value(await readCaseSources(deps, owner, { caseId }))).toEqual({ factsChangedAt: null, programChangedAt: null, partnerTypeGone: false });

    deps.clock = () => LATER;
    const facts = value(await readCompanyFacts(deps, owner, { companyId })).value;
    value(await saveCompanyFacts(deps, owner, { companyId, facts: { ...facts, renew: 80 }, base: facts, expectedUpdatedAt: facts.updatedAt || null }));
    const p = value(await readProgram(deps, owner, { programId })).value;
    value(await saveProgram(deps, owner, { programId, program: { ...p, focus: 'Banks' }, base: p, expectedUpdatedAt: p.updatedAt || null }));
    const sources = value(await readCaseSources(deps, owner, { caseId }));
    expect(sources.factsChangedAt! > TEST_NOW).toBe(true);
    expect(sources.programChangedAt! > TEST_NOW).toBe(true);
    expect(sources.partnerTypeGone).toBe(false);

    deps.clock = () => LATEST;
    const c = (await read(deps, caseId)).value;
    value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: c.updatedAt }));
    expect(value(await readCaseSources(deps, owner, { caseId }))).toEqual({ factsChangedAt: null, programChangedAt: null, partnerTypeGone: false });
  });

  it('has no program date for a program that is gone', async () => {
    const deps = await setup();
    const { caseId, programId, partnerId } = await withCase(deps);
    await joinProgram(deps, partnerId, null);
    value(await deleteProgram(deps, owner, { programId }));
    expect(value(await readCaseSources(deps, owner, { caseId }))).toMatchObject({ programChangedAt: null, partnerTypeGone: false });
  });
});

describe('a program still listed but trashed by hand in Drive (Review Focus 1)', () => {
  /** The program's file goes to the Drive trash by hand: the directory still lists it. */
  async function trashByHand(deps: TestDeps, programId: string) {
    const entry = await deps.directory.program(programId);
    await deps.programs.trash({ fileId: entry!.fileId });
    expect(await deps.directory.program(programId)).not.toBeNull();
  }

  it('create: a linked program that is gone is no program, and the case says so', async () => {
    const deps = await setup();
    const programId = await program(deps);
    const partnerId = await addPartnerType(deps);
    await joinProgram(deps, partnerId, programId);
    await trashByHand(deps, programId);
    const { caseId } = value(await createCase(deps, owner, { companyId, partnerId }));
    expect((await read(deps, caseId)).value).toMatchObject({ programId: null, notes: ['no-program'] });
  });

  it('create: with another program of the type left, the person picks, or the one a linked market feeds is taken', async () => {
    const deps = await setup();
    const gone = await program(deps);
    const other = await program(deps);
    const partnerId = await addPartnerType(deps);
    await joinProgram(deps, partnerId, gone);
    await trashByHand(deps, gone);
    expect(await createCase(deps, owner, { companyId, partnerId })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { programId: COPY.CASE_PICK_PROGRAM },
    });
    const { marketId } = value(await createMarket(deps, owner, {
      companyId, info: { marketName: 'DACH', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
    }));
    value(await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { feedsProgramId: other } } }));
    value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'marketLink', values: { partnerId, marketId } } }));
    const { caseId } = value(await createCase(deps, owner, { companyId, partnerId }));
    expect((await read(deps, caseId)).value.programId).toBe(other);
  });

  it('create: a program the person picked that is gone is refused as not found', async () => {
    const deps = await setup();
    const programId = await program(deps);
    const partnerId = await addPartnerType(deps);
    await trashByHand(deps, programId);
    expect(await createCase(deps, owner, { companyId, partnerId, programId })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { programId: COPY.PROGRAM_NOT_FOUND },
    });
  });

  it('recalculate: the case’s own program, still the partner type’s, gone from Drive is no program', async () => {
    const deps = await setup();
    const { caseId, programId } = await withCase(deps);
    await trashByHand(deps, programId);
    const stored = (await read(deps, caseId)).value;
    const out = value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt }));
    expect(out.snapshot.value).toMatchObject({ programId: null, notes: ['no-program'] });
  });

  it('recalculate: the case’s own program, kept while the person may pick, gone from Drive is no longer kept', async () => {
    const deps = await setup();
    const { caseId, programId, partnerId } = await withCase(deps);
    await joinProgram(deps, partnerId, null);
    await trashByHand(deps, programId);
    const stored = (await read(deps, caseId)).value;
    // Nothing else of the type: no program.
    expect(value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt })).snapshot.value.programId).toBeNull();

    const again = await setup();
    const ids = await withCase(again);
    const other = await program(again);
    await joinProgram(again, ids.partnerId, null);
    await trashByHand(again, ids.programId);
    const c = (await read(again, ids.caseId)).value;
    // Another of the type is left: the person picks it.
    expect(await recalculateCase(again, owner, { caseId: ids.caseId, expectedUpdatedAt: c.updatedAt })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { programId: COPY.CASE_PICK_PROGRAM },
    });
    expect(value(await recalculateCase(again, owner, { caseId: ids.caseId, expectedUpdatedAt: c.updatedAt, programId: other })).programId).toBe(other);
  });

  it('still fails when Google can’t be read just now, and writes nothing', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const stored = (await read(deps, caseId)).value;
    vi.spyOn(deps.programs, 'read').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x' });
    expect(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt })).toMatchObject({ ok: false, error: 'unavailable' });
    expect((await read(deps, caseId)).value).toEqual(stored);
  });
});

describe('a partner type removed from Partners by hand while it has cases (Review Focus 2)', () => {
  it('still opens the case and lists it, says the type is gone, and refuses to recalculate', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    const stored = (await read(deps, caseId)).value;
    await removeByHand(deps, partnerId);

    expect((await read(deps, caseId)).value).toEqual(stored);
    expect(value(await readCaseSources(deps, owner, { caseId })).partnerTypeGone).toBe(true);
    expect(value(await listCases(deps, owner, { companyId }))).toEqual([
      { caseId, title: stored.title, partnerId, partnerType: 'reseller', createdAt: TEST_NOW },
    ]);
    expect(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt })).toEqual({
      ok: false, error: 'invalid', message: COPY.CASE_TYPE_GONE,
    });
    expect((await read(deps, caseId)).value).toEqual(stored);
  });
});

describe('saveCase', () => {
  it('saves the case, keeps what the case is fixed to, and renames the directory row with the title', async () => {
    const deps = await setup();
    const { caseId, partnerId, programId } = await withCase(deps);
    const out = value(await save(deps, owner, caseId, (c) => {
      c.deals = [1, 2, 3, 4, 5];
      c.title = 'Expansion 2027';
      c.partnerId = 'p_someoneelse';
      c.partnerType = 'referral';
      c.programId = 'pg_other00000';
      c.companyId = otherCompany;
      c.createdAt = LATEST;
      c.stageWhenMade = 'growth';
      c.recalculatedAt = LATEST;
      c.shared = { sharedAt: LATEST };
    }));
    expect(out.snapshot.value).toMatchObject({
      deals: [1, 2, 3, 4, 5], title: 'Expansion 2027', partnerId, partnerType: 'reseller', programId, companyId, createdAt: TEST_NOW,
      stageWhenMade: 'recruitment', recalculatedAt: null, shared: null,
    });
    expect((await read(deps, caseId)).value.deals).toEqual([1, 2, 3, 4, 5]);
    expect(await deps.directory.businessCase(caseId)).toMatchObject({ displayName: 'Expansion 2027', partnerId, partnerType: 'reseller' });
    expect(deps.events.events.filter((e) => e.command === 'cases.save')).toEqual([expect.objectContaining({ entityIds: [caseId] })]);
  });

  it('saves a case read after the company was renamed, and stores the name of now', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    await deps.companies.rename('u1', 'Halden Group');
    const out = value(await save(deps, owner, caseId, (c) => { c.deals = [1, 0, 0, 0, 0]; }));
    expect(out.snapshot.value.offer.company).toBe('Halden Group');
    const entry = await deps.directory.businessCase(caseId);
    const file = await deps.cases.read({ fileId: entry!.fileId });
    expect(file.ok && file.snapshot.value.offer.company).toBe('Halden Group');
  });

  it('refuses a stale save and a case that is not valid, and writes nothing', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const before = await read(deps, caseId);
    value(await save(deps, owner, caseId, (c) => { c.deals = [1, 0, 0, 0, 0]; }));
    const stale = await saveCase(deps, owner, { caseId, case: { ...before.value, deals: [9, 9, 9, 9, 9] }, base: before.value, expectedUpdatedAt: before.value.updatedAt });
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    const bad = await save(deps, owner, caseId, (c) => { c.deals = [-1, 0, 0, 0, 0]; });
    expect(bad).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { 'deals.0': expect.any(String) } });
    expect((await read(deps, caseId)).value.deals).toEqual([1, 0, 0, 0, 0]);
  });

  it('lets an agent with change save, and nobody else', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    expect(await save(deps, agent('read'), caseId, (c) => { c.deals = [1, 0, 0, 0, 0]; })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await save(deps, stranger, caseId, (c) => { c.deals = [1, 0, 0, 0, 0]; })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect((await save(deps, agent('change'), caseId, (c) => { c.deals = [1, 0, 0, 0, 0]; })).ok).toBe(true);
  });
});

describe('copyCase', () => {
  it('makes a new case made today, titled “Copy of” its original, with the same numbers and no share link', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    value(await save(deps, owner, caseId, (c) => {
      c.deals = [3, 4, 5, 6, 7];
      c.costs = [{ id: 'cost_1', name: 'Training', when: 'start', amount: 500 }];
    }));
    value(await shareCase(deps, owner, { caseId }));
    deps.clock = () => LATER;
    const source = (await read(deps, caseId)).value;

    const { caseId: copyId } = value(await copyCase(deps, owner, { caseId }));

    expect(copyId).not.toBe(caseId);
    const copy = await read(deps, copyId);
    expect(copy.shared).toBeNull();
    expect(copy.value).toMatchObject({
      id: copyId, partnerId, partnerType: 'reseller', title: `Copy of ${caseTitle('2026-10-28')}`, createdAt: LATER, shared: null,
      deals: [3, 4, 5, 6, 7], costs: [{ name: 'Training', when: 'start', amount: 500 }], offer: source.offer, ours: { figures: source.ours.figures },
    });
    expect(copy.value.costs[0]!.id).not.toBe('cost_1');
    expect((await read(deps, caseId)).value).toEqual(source);
    expect(await deps.directory.businessCase(copyId)).toMatchObject({ partnerId, displayName: `Copy of ${caseTitle('2026-10-28')}`, createdAt: LATER });
    expect(deps.events.events.filter((e) => e.command === 'cases.copy')).toEqual([expect.objectContaining({ entityIds: [copyId, caseId] })]);
  });

  it('cuts a long title to the longest a title may be', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    value(await save(deps, owner, caseId, (c) => { c.title = 'x'.repeat(78) + ' y'; }));
    const { caseId: copyId } = value(await copyCase(deps, owner, { caseId }));
    const title = (await read(deps, copyId)).value.title;
    expect(title).toBe(`Copy of ${'x'.repeat(72)}`);
    const { caseId: again } = value(await copyCase(deps, owner, { caseId: copyId }));
    expect((await read(deps, again)).value.title).toBe(`Copy of Copy of ${'x'.repeat(64)}`);
  });

  it('takes the stage the partner type has now in Partners (ruling R9), and moves no stage', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    expect((await read(deps, caseId)).value.stageWhenMade).toBe('recruitment');
    const book = deps.directory.books.get(companyId)!;
    expect((await deps.partnerBooks.apply(book, { kind: 'markSigned', partnerId, signedDate: '2026-10-30' }, { now: TEST_NOW, actor: 'Hand' })).ok).toBe(true);
    const stage = (await partnerRow(deps, partnerId))!.stage;
    expect(stage).not.toBe('recruitment');
    const { caseId: copyId } = value(await copyCase(deps, owner, { caseId }));
    expect((await read(deps, copyId)).value.stageWhenMade).toBe(stage);
    expect((await read(deps, caseId)).value.stageWhenMade).toBe('recruitment');
    expect((await partnerRow(deps, partnerId))!.stage).toBe(stage);
  });

  it('keeps the original’s stage when the partner type is gone from Partners, or Partners can’t be read', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    // A stage the partner type doesn't have now, so the test tells the two apart (saveCase keeps the file's).
    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { stageWhenMade: 'growth' });
    vi.spyOn(deps.partnerBooks, 'read').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x' });
    const unread = value(await copyCase(deps, owner, { caseId }));
    expect((await read(deps, unread.caseId)).value.stageWhenMade).toBe('growth');
    await removeByHand(deps, partnerId);
    const gone = value(await copyCase(deps, owner, { caseId }));
    expect((await read(deps, gone.caseId)).value.stageWhenMade).toBe('growth');
  });
});

describe('recalculateCase', () => {
  it('fills the terms again from the program as it is now and keeps deals, costs and our case', async () => {
    const deps = await setup();
    const { caseId, programId } = await withCase(deps);
    value(await save(deps, owner, caseId, (c) => {
      c.deals = [2, 2, 2, 2, 2];
      c.ours.recommendation = 'Go';
    }));
    const p = value(await readProgram(deps, owner, { programId })).value;
    const rates = structuredClone(p.money.rates);
    rates.reg[0] = 33;
    value(await saveProgram(deps, owner, { programId, program: { ...p, money: { ...p.money, rates } }, base: p, expectedUpdatedAt: p.updatedAt || null }));
    deps.clock = () => LATER;
    const before = (await read(deps, caseId)).value;

    const out = value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: before.updatedAt }));

    const after = out.snapshot.value;
    expect(after.offer.types[0]!.registered.first).toBe(33);
    expect(after).toMatchObject({ deals: [2, 2, 2, 2, 2], recalculatedAt: LATER, programId, partnerType: 'reseller', stageWhenMade: before.stageWhenMade });
    expect(after.ours.recommendation).toBe('Go');
    expect(deps.events.events.filter((e) => e.command === 'cases.recalculate')).toEqual([expect.objectContaining({ entityIds: [caseId, programId] })]);
  });

  describe('when the program is gone or changed type after the case was made (Review Focus 1)', () => {
    it('opens with its stored numbers, then recalculates to no program, and says so', async () => {
      const deps = await setup();
      const { caseId, programId, partnerId } = await withCase(deps);
      await joinProgram(deps, partnerId, null);
      value(await deleteProgram(deps, owner, { programId }));
      const stored = (await read(deps, caseId)).value;
      expect(stored.programId).toBe(programId);
      const out = value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt }));
      expect(out.snapshot.value).toMatchObject({ programId: null, notes: ['no-program'] });
      expect(out.programId).toBeNull();
    });

    it('takes the program the partner type is in now', async () => {
      const deps = await setup();
      const { caseId, programId, partnerId } = await withCase(deps);
      const next = await program(deps);
      await joinProgram(deps, partnerId, next);
      value(await deleteProgram(deps, owner, { programId }));
      const stored = (await read(deps, caseId)).value;
      expect(value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt })).snapshot.value.programId).toBe(next);
    });

    it('asks which program when the type has some and none is the partner type’s, and takes the one picked', async () => {
      const deps = await setup();
      const { caseId, programId, partnerId } = await withCase(deps);
      const next = await program(deps);
      await joinProgram(deps, partnerId, null);
      value(await deleteProgram(deps, owner, { programId }));
      const stored = (await read(deps, caseId)).value;
      expect(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt })).toMatchObject({
        ok: false, error: 'invalid', fieldErrors: { programId: COPY.CASE_PICK_PROGRAM },
      });
      expect((await read(deps, caseId)).value).toEqual(stored);
      const out = value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt, programId: next }));
      expect(out.snapshot.value.programId).toBe(next);
    });

    it('keeps its own program when the person may pick and it is still one of the type’s', async () => {
      const deps = await setup();
      const { caseId, programId, partnerId } = await withCase(deps);
      await program(deps);
      await joinProgram(deps, partnerId, null);
      const stored = (await read(deps, caseId)).value;
      expect(value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt })).snapshot.value.programId).toBe(programId);
    });

    it('treats a program now listed for another type as not the type’s', async () => {
      const deps = await setup();
      const { caseId, programId } = await withCase(deps);
      const entry = await deps.directory.program(programId);
      await deps.directory.removeProgram(programId);
      await deps.directory.addProgram({ ...entry!, programId, partnerType: 'referral' });
      const stored = (await read(deps, caseId)).value;
      const out = value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt }));
      expect(out.snapshot.value).toMatchObject({ programId: null, notes: ['no-program'] });
    });
  });

  it('refuses a case whose partner type left its own offer, without throwing', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const entry = await deps.directory.businessCase(caseId);
    editMemoryFileByHand(entry!.fileId, { typeId: 'type_gone' });
    const stored = (await read(deps, caseId)).value;
    expect(stored.typeId).toBe('type_gone');
    expect(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: stored.updatedAt })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { typeId: expect.any(String) },
    });
  });

  describe('in one tab while another tab autosaves (Review Focus 4)', () => {
    it('refuses a recalculation after the other tab saved, and writes nothing', async () => {
      const deps = await setup();
      const { caseId } = await withCase(deps);
      const opened = (await read(deps, caseId)).value;
      value(await save(deps, owner, caseId, (c) => { c.deals = [5, 0, 0, 0, 0]; }));
      const saved = (await read(deps, caseId)).value;
      expect(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: opened.updatedAt })).toMatchObject({ ok: false, error: 'conflict' });
      expect((await read(deps, caseId)).value).toEqual(saved);
    });

    it('refuses the other tab’s autosave after a recalculation, and writes nothing', async () => {
      const deps = await setup();
      const { caseId } = await withCase(deps);
      const opened = (await read(deps, caseId)).value;
      deps.clock = () => LATER;
      value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: opened.updatedAt }));
      const recalculated = (await read(deps, caseId)).value;
      const autosave = await saveCase(deps, owner, {
        caseId, case: { ...opened, deals: [5, 0, 0, 0, 0] }, base: opened, expectedUpdatedAt: opened.updatedAt,
      });
      expect(autosave).toMatchObject({ ok: false, error: 'conflict' });
      expect((await read(deps, caseId)).value).toEqual(recalculated);
    });
  });

  it('lets an agent with change or propose recalculate, and nobody else', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const { updatedAt } = (await read(deps, caseId)).value;
    expect(await recalculateCase(deps, agent('read'), { caseId, expectedUpdatedAt: updatedAt })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await recalculateCase(deps, stranger, { caseId, expectedUpdatedAt: updatedAt })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect((await recalculateCase(deps, agent('change'), { caseId, expectedUpdatedAt: updatedAt })).ok).toBe(true);
    const again = (await read(deps, caseId)).value.updatedAt;
    expect((await recalculateCase(deps, agent('propose'), { caseId, expectedUpdatedAt: again })).ok).toBe(true);
  });
});

describe('deleteCase', () => {
  it('trashes the file, removes the row and turns the share link off', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const { token } = value(await shareCase(deps, owner, { caseId }));
    const entry = await deps.directory.businessCase(caseId);
    expect(await deleteCase(deps, agent('change'), { caseId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(value(await deleteCase(deps, owner, { caseId }))).toEqual({ caseId });
    expect(await deps.directory.businessCase(caseId)).toBeNull();
    expect(await deps.cases.read({ fileId: entry!.fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.shareLinks.findActive(hashToken(token))).toBeNull();
    expect(await openSharedCase(shareDeps(deps).share, token)).toEqual({ kind: 'gone' });
    expect(deps.events.events.filter((e) => e.command === 'cases.delete')).toEqual([expect.objectContaining({ fileId: entry!.fileId, entityIds: [caseId] })]);
  });
});

describe('shareCase and unshareCase', () => {
  it('makes a link whose token is never stored, stamps the case, and a new link turns the old one off', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const first = value(await shareCase(deps, owner, { caseId }));
    expect(first.snapshot.value.shared).toEqual({ sharedAt: TEST_NOW });
    expect(JSON.stringify(deps.shareLinks.rows)).not.toContain(first.token);
    expect(deps.shareLinks.rows).toEqual([expect.objectContaining({ ownerUserId: 'u1', caseId, tokenHash: hashToken(first.token), revokedAt: null })]);
    const second = value(await shareCase(deps, owner, { caseId }));
    expect(second.token).not.toBe(first.token);
    expect(await deps.shareLinks.findActive(hashToken(first.token))).toBeNull();
    expect(await deps.shareLinks.findActive(hashToken(second.token))).toEqual({ ownerUserId: 'u1', caseId });
    expect((await openSharedCase(shareDeps(deps).share, second.token)).kind).toBe('ok');
  });

  it('turns the link off and clears the stamp', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const { token } = value(await shareCase(deps, owner, { caseId }));
    const out = value(await unshareCase(deps, agent('change'), { caseId }));
    expect(out.snapshot.value.shared).toBeNull();
    expect((await read(deps, caseId)).shared).toBeNull();
    expect(await openSharedCase(shareDeps(deps).share, token)).toEqual({ kind: 'gone' });
  });

  it('lets only a person share, and refuses a case whose partner type left its offer', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(await shareCase(deps, agent(level), { caseId })).toMatchObject({ ok: false, error: 'forbidden' });
    }
    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { typeId: 'type_gone' });
    expect(await shareCase(deps, owner, { caseId })).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { typeId: expect.any(String) } });
    expect(deps.shareLinks.rows).toEqual([]);
  });

  it('refuses a case whose file has rows it can’t read, as its link couldn’t show it, and writes nothing', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const fileId = (await deps.directory.businessCase(caseId))!.fileId;
    showMemoryRowIssues(fileId, [{ tab: 'Products', row: 2, message: 'Price in Products row 2 isn’t a number.' }]);
    const before = (await read(deps, caseId)).value;
    expect(await shareCase(deps, owner, { caseId })).toEqual({ ok: false, error: 'invalid', message: COPY.CASE_SHARE_ROWS_UNREADABLE });
    expect(deps.shareLinks.rows).toEqual([]);
    expect((await read(deps, caseId)).value).toEqual(before);
    showMemoryRowIssues(fileId, []);
    expect((await shareCase(deps, owner, { caseId })).ok).toBe(true);
  });
});

describe('openSharedCase (Review Focus 3)', () => {
  async function shared(deps: TestDeps) {
    const ids = await withCase(deps);
    value(await save(deps, owner, ids.caseId, (c) => {
      c.deals = [4, 5, 6, 7, 8];
      c.ours.recommendation = 'SECRET-RECOMMENDATION';
      c.ours.ask = 'SECRET-ASK';
      c.ours.preparedBy = 'SECRET-PREPARED';
      c.ours.risk.why = 'SECRET-RISK';
      c.ours.efficiency.note = 'SECRET-EFFICIENCY';
      c.ours.churn.note = 'SECRET-CHURN';
      c.ours.strategic = [{ id: 'reason_1', text: 'SECRET-REASON', weight: 'high', alone: false }];
      c.ours.costs = [{ id: 'cost_ours', name: 'SECRET-COST', when: 'yearly', amount: 12345, source: 'finance' }];
      c.ours.alone.costs = [{ id: 'cost_alone', name: 'SECRET-ALONE', when: 'start', amount: 777, source: 'sales' }];
    }));
    const { token } = value(await shareCase(deps, owner, { caseId: ids.caseId }));
    return { ...ids, token };
  }

  it('shows the partner’s side as the case is now, named as the company is now, and nothing of ours', async () => {
    const deps = await setup();
    const { caseId, partnerId, programId, token } = await shared(deps);
    await deps.companies.rename('u1', 'Halden Group');
    const view = await openSharedCase(shareDeps(deps).share, token);
    const c = (await read(deps, caseId)).value;
    expect(view).toEqual({ kind: 'ok', view: partnerSide(c, 'Halden Group') });
    const json = JSON.stringify(view);
    expect(json).not.toContain('SECRET');
    expect(json).not.toContain('12345');
    expect(json).not.toContain('"ours"');
    for (const id of [caseId, partnerId, programId, (await deps.directory.businessCase(caseId))!.fileId]) expect(json).not.toContain(id);
  });

  it('never reaches the database or the storage with something that is not a token', async () => {
    const deps = await setup();
    await shared(deps);
    const { share, casesFor } = shareDeps(deps);
    const findActive = vi.spyOn(deps.shareLinks, 'findActive');
    for (const bad of ['', 'x', 'a'.repeat(44), `${'a'.repeat(42)}/`, '../../etc', 42, null, undefined, { token: 'x' }]) {
      expect(await openSharedCase(share, bad)).toEqual({ kind: 'gone' });
    }
    expect(findActive).not.toHaveBeenCalled();
    expect(casesFor).not.toHaveBeenCalled();
  });

  it('says the link is gone for an unknown or a turned-off link, without reading the storage', async () => {
    const deps = await setup();
    const { caseId, token } = await shared(deps);
    const { share, casesFor } = shareDeps(deps);
    expect(await openSharedCase(share, newToken())).toEqual({ kind: 'gone' });
    await deps.shareLinks.revokeCases('u1', [caseId], LATER);
    expect(await openSharedCase(share, token)).toEqual({ kind: 'gone' });
    expect(casesFor).not.toHaveBeenCalled();
  });

  it('says the link is gone after the case was deleted, its row removed, or its file trashed by hand', async () => {
    const deps = await setup();
    const a = await shared(deps);
    // The row gone but the link left on: a removal that stopped half way.
    await deps.directory.removeBusinessCases([a.caseId]);
    expect(await openSharedCase(shareDeps(deps).share, a.token)).toEqual({ kind: 'gone' });

    const other = await setup();
    const b = await shared(other);
    const entry = await other.directory.businessCase(b.caseId);
    await other.cases.trash({ fileId: entry!.fileId });
    expect(await openSharedCase(shareDeps(other).share, b.token)).toEqual({ kind: 'gone' });
  });

  it('says the link is gone when the owner’s account is gone, or the case is no longer stamped shared', async () => {
    const deps = await setup();
    const { caseId, token } = await shared(deps);
    const { share, casesFor } = shareDeps(deps);
    casesFor.mockResolvedValueOnce(null);
    expect(await openSharedCase(share, token)).toEqual({ kind: 'gone' });
    // The stamp cleared by a hand edit while the link stays on (ruling R3: both are needed).
    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { shared: null });
    expect(await openSharedCase(share, token)).toEqual({ kind: 'gone' });
  });

  it('can’t show the case while the owner’s storage fails or the file can’t be read, and logs ids only', async () => {
    const deps = await setup();
    const { caseId, token } = await shared(deps);
    const { share, log } = shareDeps(deps);
    const readSpy = vi.spyOn(deps.cases, 'read');

    readSpy.mockRejectedValueOnce(new StoreFailure('auth', COPY.FORBIDDEN));
    expect(await openSharedCase(share, token)).toEqual({ kind: 'unavailable' });
    expect(log).toHaveBeenLastCalledWith('shared_case_unavailable', { reason: 'auth', ownerUserId: 'u1', caseId });
    readSpy.mockRejectedValueOnce(new ReconnectRequired());
    expect(await openSharedCase(share, token)).toEqual({ kind: 'unavailable' });
    expect(log).toHaveBeenLastCalledWith('shared_case_unavailable', { reason: 'auth', ownerUserId: 'u1', caseId });
    readSpy.mockRejectedValueOnce(new TokenUnavailable());
    expect(await openSharedCase(share, token)).toEqual({ kind: 'unavailable' });
    expect(log).toHaveBeenLastCalledWith('shared_case_unavailable', { reason: 'unavailable', ownerUserId: 'u1', caseId });

    for (const error of ['unavailable', 'auth', 'structure', 'old_version'] as const) {
      readSpy.mockResolvedValueOnce({ ok: false, error, message: 'x' });
      expect(await openSharedCase(share, token)).toEqual({ kind: 'unavailable' });
      expect(log).toHaveBeenLastCalledWith('shared_case_unavailable', { reason: error, ownerUserId: 'u1', caseId });
    }

    const c = (await read(deps, caseId)).value;
    readSpy.mockResolvedValueOnce({ ok: true, snapshot: { value: c, issues: [{ tab: 'Products', row: 3, message: 'x' }] } });
    expect(await openSharedCase(share, token)).toEqual({ kind: 'unavailable' });

    vi.spyOn(deps.shareLinks, 'findActive').mockRejectedValueOnce(new Error('share_links_find_failed'));
    expect(await openSharedCase(share, token)).toEqual({ kind: 'unavailable' });
    expect(log).toHaveBeenLastCalledWith('shared_case_unavailable', { reason: 'share_links_find_failed' });

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).not.toContain(token);
    expect(logged).not.toContain(hashToken(token));
  });

  it('can’t show a case whose partner type left its own offer, and never throws for it', async () => {
    const deps = await setup();
    const { caseId, token } = await shared(deps);
    const { share, log } = shareDeps(deps);
    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { typeId: 'type_gone' });
    expect(await openSharedCase(share, token)).toEqual({ kind: 'unavailable' });
    expect(log).toHaveBeenCalledWith('shared_case_unavailable', { reason: 'type_missing', ownerUserId: 'u1', caseId });
  });

  it('names the company as stored with the case when the company has no name or can’t be read', async () => {
    const deps = await setup();
    const { token } = await shared(deps);
    await deps.companies.rename('u1', '');
    const view = await openSharedCase(shareDeps(deps).share, token);
    expect(view.kind === 'ok' && view.view.company).toBe('Halden');
    const failing = shareDeps(deps, { companies: { nameOf: async () => { throw new Error('companies_read_failed'); } } });
    const again = await openSharedCase(failing.share, token);
    expect(again.kind === 'ok' && again.view.company).toBe('Halden');
  });

  it('only reads the company’s name, and never makes a company (ruling R8)', async () => {
    const deps = await setup();
    const { token } = await shared(deps);
    // A lookup that knows no company: the name stored with the case shows, and nothing is made.
    const nameOf = vi.fn(async (): Promise<string | null> => null);
    const forUser = vi.spyOn(deps.companies, 'forUser');
    const view = await openSharedCase(shareDeps(deps, { companies: { nameOf } }).share, token);
    expect(view.kind === 'ok' && view.view.company).toBe('Halden');
    expect(nameOf).toHaveBeenCalledWith('u1');
    expect(forUser).not.toHaveBeenCalled();
  });

  it('lets a bug in the storage through', async () => {
    const deps = await setup();
    const { token } = await shared(deps);
    vi.spyOn(deps.cases, 'read').mockRejectedValueOnce(new TypeError('boom'));
    await expect(openSharedCase(shareDeps(deps).share, token)).rejects.toThrow('boom');
  });
});

describe('cases when their partner type goes away (spec 5.5)', () => {
  async function twoWithCases(deps: TestDeps) {
    const { caseId, partnerId } = await withCase(deps);
    const other = await addPartnerType(deps, 'technology', 'Bolt');
    const { caseId: otherCase } = value(await createCase(deps, owner, { companyId, partnerId: other }));
    const { token } = value(await shareCase(deps, owner, { caseId }));
    const { token: otherToken } = value(await shareCase(deps, owner, { caseId: otherCase }));
    const fileId = (await deps.directory.businessCase(caseId))!.fileId;
    deps.events.events.length = 0;
    return { caseId, partnerId, other, otherCase, token, otherToken, fileId };
  }

  const expected = async (deps: TestDeps, partnerId: string) => {
    const book = value(await readPartners(deps, owner, { companyId })).value;
    const p = book.partners.find((x) => x.id === partnerId)!;
    return [partnerId, p.accountId];
  };

  it('asks what happens to the cases before a partner type is removed, and writes nothing until then', async () => {
    const deps = await setup();
    const { caseId, partnerId, token } = await twoWithCases(deps);
    const r = await removePartnerType(deps, owner, { companyId, partnerId, expected: await expected(deps, partnerId) });
    expect(r).toEqual({ ok: false, error: 'invalid', message: COPY.CASES_CHOOSE(1), fieldErrors: { items: COPY.CASES_CHOOSE(1) } });
    expect(await partnerRow(deps, partnerId)).toBeDefined();
    expect(await deps.directory.businessCase(caseId)).not.toBeNull();
    expect(await deps.shareLinks.findActive(hashToken(token))).not.toBeNull();
    expect(await removePartnerType(deps, owner, { companyId, partnerId, expected: [partnerId], items: 'bin' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('trash: removes the partner type, trashes its cases, removes their rows and turns their links off', async () => {
    const deps = await setup();
    const { caseId, partnerId, otherCase, token, otherToken, fileId } = await twoWithCases(deps);
    value(await removePartnerType(deps, owner, { companyId, partnerId, expected: await expected(deps, partnerId), items: 'trash' }));
    expect(await partnerRow(deps, partnerId)).toBeUndefined();
    expect(await deps.directory.businessCase(caseId)).toBeNull();
    expect(await deps.cases.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.shareLinks.findActive(hashToken(token))).toBeNull();
    // The other partner type's case stays as it was.
    expect(await deps.directory.businessCase(otherCase)).not.toBeNull();
    expect(await deps.shareLinks.findActive(hashToken(otherToken))).not.toBeNull();
    expect(deps.events.events.filter((e) => e.command === 'cases.delete')).toEqual([expect.objectContaining({ fileId, entityIds: [caseId] })]);
  });

  it('keep: removes the rows and turns the links off, and leaves the files in Drive', async () => {
    const deps = await setup();
    const { caseId, partnerId, token, fileId } = await twoWithCases(deps);
    value(await removePartnerType(deps, owner, { companyId, partnerId, expected: await expected(deps, partnerId), items: 'keep' }));
    expect(await deps.directory.businessCase(caseId)).toBeNull();
    expect((await deps.cases.read({ fileId })).ok).toBe(true);
    expect(await deps.shareLinks.findActive(hashToken(token))).toBeNull();
  });

  it('turns the links off before the Partners write: a refused write leaves the type, the rows and the files, links off', async () => {
    const deps = await setup();
    const { caseId, partnerId, token, otherToken, fileId } = await twoWithCases(deps);
    const want = await expected(deps, partnerId);
    vi.spyOn(deps.partnerBooks, 'applyMany').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x', valid: 0 });
    expect(await removePartnerType(deps, owner, { companyId, partnerId, expected: want, items: 'trash' })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await partnerRow(deps, partnerId)).toBeDefined();
    expect(await deps.directory.businessCase(caseId)).not.toBeNull();
    expect((await deps.cases.read({ fileId })).ok).toBe(true);
    expect(await deps.shareLinks.findActive(hashToken(token))).toBeNull();
    expect(await deps.shareLinks.findActive(hashToken(otherToken))).not.toBeNull();
    // The removal can be made again, and finishes.
    value(await removePartnerType(deps, owner, { companyId, partnerId, expected: want, items: 'trash' }));
    expect(await partnerRow(deps, partnerId)).toBeUndefined();
    expect(await deps.directory.businessCase(caseId)).toBeNull();
  });

  it('writes nothing when the links can’t be turned off', async () => {
    const deps = await setup();
    const { caseId, partnerId, token, fileId } = await twoWithCases(deps);
    const want = await expected(deps, partnerId);
    vi.spyOn(deps.shareLinks, 'revokeCases').mockRejectedValueOnce(new Error('database'));
    const write = vi.spyOn(deps.partnerBooks, 'applyMany');
    await expect(removePartnerType(deps, owner, { companyId, partnerId, expected: want, items: 'trash' })).rejects.toThrow('database');
    expect(write).not.toHaveBeenCalled();
    expect(await partnerRow(deps, partnerId)).toBeDefined();
    expect(await deps.directory.businessCase(caseId)).not.toBeNull();
    expect((await deps.cases.read({ fileId })).ok).toBe(true);
    expect(await deps.shareLinks.findActive(hashToken(token))).not.toBeNull();
  });

  it('a new Partners file: links off before the new file, and nothing written when they can’t be turned off', async () => {
    const deps = await setup();
    const { caseId, token, otherToken, fileId } = await twoWithCases(deps);
    const oldBook = deps.directory.books.get(companyId)!.fileId;
    await deps.partnerBooks.discard({ fileId: oldBook });
    vi.spyOn(deps.shareLinks, 'revokeCases').mockRejectedValueOnce(new Error('database'));
    const create = vi.spyOn(deps.partnerBooks, 'create');
    await expect(recreatePartnerBook(deps, owner, { companyId, items: 'trash' })).rejects.toThrow('database');
    expect(create).not.toHaveBeenCalled();
    expect(deps.directory.books.get(companyId)!.fileId).toBe(oldBook);
    expect(await deps.shareLinks.findActive(hashToken(token))).not.toBeNull();
    create.mockRejectedValueOnce(new StoreFailure('unavailable', 'x'));
    expect(await recreatePartnerBook(deps, owner, { companyId, items: 'trash' })).toMatchObject({ ok: false });
    expect(deps.directory.books.get(companyId)!.fileId).toBe(oldBook);
    expect(await deps.directory.businessCase(caseId)).not.toBeNull();
    expect((await deps.cases.read({ fileId })).ok).toBe(true);
    expect(await deps.shareLinks.findActive(hashToken(token))).toBeNull();
    expect(await deps.shareLinks.findActive(hashToken(otherToken))).toBeNull();
  });

  it('needs no choice for a partner type without cases', async () => {
    const deps = await setup();
    const { other, otherCase } = await twoWithCases(deps);
    value(await deleteCase(deps, owner, { caseId: otherCase }));
    expect((await removePartnerType(deps, owner, { companyId, partnerId: other, expected: await expected(deps, other) })).ok).toBe(true);
  });

  it('asks the same for all of the company’s cases before a new Partners file', async () => {
    const deps = await setup();
    const { caseId, otherCase, token, otherToken, fileId } = await twoWithCases(deps);
    await deps.partnerBooks.discard({ fileId: deps.directory.books.get(companyId)!.fileId });
    expect(await recreatePartnerBook(deps, owner, { companyId })).toEqual({
      ok: false, error: 'invalid', message: COPY.CASES_CHOOSE(2), fieldErrors: { items: COPY.CASES_CHOOSE(2) },
    });
    expect(await deps.directory.businessCase(caseId)).not.toBeNull();
    expect((await recreatePartnerBook(deps, owner, { companyId, items: 'keep' })).ok).toBe(true);
    expect(await deps.directory.businessCases(companyId)).toEqual([]);
    expect((await deps.cases.read({ fileId })).ok).toBe(true);
    expect(await deps.shareLinks.findActive(hashToken(token))).toBeNull();
    expect(await deps.shareLinks.findActive(hashToken(otherToken))).toBeNull();
    expect(otherCase).toBeDefined();
  });

  it('a Partners file that still reads needs no choice and keeps the cases', async () => {
    const deps = await setup();
    const { caseId } = await twoWithCases(deps);
    expect((await recreatePartnerBook(deps, owner, { companyId })).ok).toBe(true);
    expect(await deps.directory.businessCase(caseId)).not.toBeNull();
  });

  it('refuses to delete a partner type that has cases through a plain change', async () => {
    const deps = await setup();
    const { partnerId, other, otherCase } = await twoWithCases(deps);
    expect(await changePartner(deps, owner, { companyId, change: { kind: 'delete', entity: 'partner', id: partnerId } })).toEqual({
      ok: false, error: 'invalid', message: COPY.CASES_USE_REMOVE,
    });
    expect(await partnerRow(deps, partnerId)).toBeDefined();
    value(await deleteCase(deps, owner, { caseId: otherCase }));
    expect((await changePartner(deps, owner, { companyId, change: { kind: 'delete', entity: 'partner', id: other } })).ok).toBe(true);
  });
});

describe('the partner’s name: always as Partners names it now (owner, 2026-10-30)', () => {
  it('reads the case with the name in Partners, and the next save writes it into the file, never the input’s', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    await renameAccount(deps, partnerId, 'Acme Group');
    expect((await read(deps, caseId)).value.partner).toBe('Acme Group');
    // The file keeps the old name until the next save.
    expect((await fileOf(deps, caseId)).partner).toBe('Acme');

    const out = value(await save(deps, owner, caseId, (c) => { c.deals = [1, 0, 0, 0, 0]; c.partner = 'Typed by hand'; }));
    expect(out.snapshot.value.partner).toBe('Acme Group');
    expect((await fileOf(deps, caseId)).partner).toBe('Acme Group');
  });

  it('saves a case the screen read before Partners was renamed, and writes the name of now', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    const before = await read(deps, caseId);
    await renameAccount(deps, partnerId, 'Acme Group');
    const out = await saveCase(deps, owner, {
      caseId, case: { ...before.value, deals: [2, 0, 0, 0, 0] }, base: before.value, expectedUpdatedAt: before.value.updatedAt,
    });
    expect(value(out).snapshot.value).toMatchObject({ partner: 'Acme Group', deals: [2, 0, 0, 0, 0] });
  });

  it('falls back to the name stored with the case when Partners can’t be read or the partner type is gone', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { partner: 'Acme Stored' });
    vi.spyOn(deps.partnerBooks, 'read').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x' });
    expect((await read(deps, caseId)).value.partner).toBe('Acme Stored');
    // Partners can't be read during the save: the stored name stays, never the input's.
    const before = await read(deps, caseId);
    vi.spyOn(deps.partnerBooks, 'read').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x' });
    value(await saveCase(deps, owner, {
      caseId, case: { ...before.value, partner: 'Typed by hand', deals: [3, 0, 0, 0, 0] }, base: before.value, expectedUpdatedAt: before.value.updatedAt,
    }));
    expect((await fileOf(deps, caseId)).partner).toBe('Acme Stored');

    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { partner: 'Acme Stored' });
    await removeByHand(deps, partnerId);
    expect((await read(deps, caseId)).value.partner).toBe('Acme Stored');
    value(await save(deps, owner, caseId, (c) => { c.partner = 'Typed by hand'; c.deals = [4, 0, 0, 0, 0]; }));
    expect((await fileOf(deps, caseId)).partner).toBe('Acme Stored');
  });

  it('a copy and an update take the name in Partners', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    await renameAccount(deps, partnerId, 'Acme Group');
    const { caseId: copyId } = value(await copyCase(deps, owner, { caseId }));
    expect((await fileOf(deps, copyId)).partner).toBe('Acme Group');
    const c = (await read(deps, caseId)).value;
    value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: c.updatedAt }));
    expect((await fileOf(deps, caseId)).partner).toBe('Acme Group');
  });

  it('the partner’s page names the partner as Partners does now, else as stored with the case', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    const { token } = value(await shareCase(deps, owner, { caseId }));
    await renameAccount(deps, partnerId, 'Acme Group');
    const view = await openSharedCase(shareDeps(deps).share, token);
    expect(view.kind === 'ok' && view.view.partner).toBe('Acme Group');

    const failing = shareDeps(deps, { partnerBooksFor: async () => { throw new Error('partners_read_failed'); } });
    const stored = await openSharedCase(failing.share, token);
    expect(stored.kind === 'ok' && stored.view.partner).toBe('Acme');
    const unread = shareDeps(deps);
    vi.spyOn(deps.partnerBooks, 'read').mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'x' });
    const fallback = await openSharedCase(unread.share, token);
    expect(fallback.kind === 'ok' && fallback.view.partner).toBe('Acme');

    await removeByHand(deps, partnerId);
    const gone = await openSharedCase(shareDeps(deps).share, token);
    expect(gone.kind === 'ok' && gone.view.partner).toBe('Acme');
  });

  it('the partner’s page reads only the owner’s own Partners file', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    const { token } = value(await shareCase(deps, owner, { caseId }));
    await renameAccount(deps, partnerId, 'Acme Group');
    const book = deps.directory.books.get(companyId)!;
    deps.directory.books.set(companyId, { ...book, ownerUserId: 'u2' });
    const { share, partnerBooksFor } = shareDeps(deps);
    const view = await openSharedCase(share, token);
    expect(view.kind === 'ok' && view.view.partner).toBe('Acme');
    expect(partnerBooksFor).not.toHaveBeenCalled();
  });
});

describe('a case file whose partner type id was edited by hand (final review)', () => {
  it('opens under its own partner, recalculates against its own partner type, and the next save writes the directory’s back', async () => {
    const deps = await setup();
    const { caseId, partnerId } = await withCase(deps);
    const other = await addPartnerType(deps, 'referral', 'Globex');
    const roles = (await fileOf(deps, caseId)).offer.types[0]!.roles;
    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { partnerId: other, partnerType: 'referral' });

    const c = (await read(deps, caseId)).value;
    expect(c).toMatchObject({ partnerId, partnerType: 'reseller', partner: 'Acme' });
    expect(value(await readCaseSources(deps, owner, { caseId })).partnerTypeGone).toBe(false);

    const out = value(await recalculateCase(deps, owner, { caseId, expectedUpdatedAt: c.updatedAt }));
    expect(out.snapshot.value).toMatchObject({ partnerId, partnerType: 'reseller', partner: 'Acme' });
    expect(out.snapshot.value.offer.types[0]!.roles).toEqual(roles);

    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { partnerId: other, partnerType: 'referral' });
    value(await save(deps, owner, caseId, (x) => { x.deals = [5, 0, 0, 0, 0]; }));
    expect(await fileOf(deps, caseId)).toMatchObject({ partnerId, partnerType: 'reseller', partner: 'Acme', deals: [5, 0, 0, 0, 0] });

    // A copy is of its own partner type too.
    editMemoryFileByHand((await deps.directory.businessCase(caseId))!.fileId, { partnerId: other, partnerType: 'referral' });
    const { caseId: copyId } = value(await copyCase(deps, owner, { caseId }));
    expect(await fileOf(deps, copyId)).toMatchObject({ partnerId, partnerType: 'reseller' });
  });
});

describe('a case that is not in the directory (owner, 2026-10-30)', () => {
  it('says it is no longer in PartnerStandard Desk, and a listed case whose file is gone keeps the words of a file that is gone', async () => {
    const deps = await setup();
    const { caseId } = await withCase(deps);
    const notListed = { ok: false, error: 'file_not_found', message: COPY.CASE_NOT_LISTED };
    expect(await readCase(deps, owner, { caseId: 'case_nothere0000' })).toEqual(notListed);
    expect(await readCase(deps, stranger, { caseId })).toEqual(notListed);
    expect(await readCaseSources(deps, owner, { caseId: 'case_nothere0000' })).toEqual(notListed);
    expect(await saveCase(deps, owner, { caseId: 'case_nothere0000', case: {}, base: {}, expectedUpdatedAt: null })).toEqual(notListed);

    await deps.cases.trash({ fileId: (await deps.directory.businessCase(caseId))!.fileId });
    // The file trashed while the directory still lists the case: the words of a file that is gone, as before.
    expect(await readCase(deps, owner, { caseId })).toMatchObject({ ok: false, error: 'file_not_found', message: COPY.FILE_GONE });
  });
});

describe('events and logs', () => {
  it('hold ids only, never a name, a title, a number or a token', async () => {
    const deps = await setup();
    const log = vi.fn();
    deps.log = log;
    const { caseId } = await withCase(deps);
    value(await save(deps, owner, caseId, (c) => { c.title = 'Secret title'; c.deals = [4321, 0, 0, 0, 0]; }));
    value(await listCases(deps, owner, { companyId }));
    value(await readCaseSources(deps, owner, { caseId }));
    const { caseId: copyId } = value(await copyCase(deps, owner, { caseId }));
    const c = (await read(deps, copyId)).value;
    value(await recalculateCase(deps, owner, { caseId: copyId, expectedUpdatedAt: c.updatedAt }));
    const { token } = value(await shareCase(deps, owner, { caseId }));
    const share = shareDeps(deps);
    await openSharedCase(share.share, token);
    value(await unshareCase(deps, owner, { caseId }));
    value(await deleteCase(deps, owner, { caseId: copyId }));

    const written = JSON.stringify([deps.events.events, log.mock.calls, share.log.mock.calls]);
    for (const content of ['Acme', 'Halden', 'Secret title', '4321', token, hashToken(token)]) expect(written).not.toContain(content);
    for (const e of deps.events.events) {
      expect(Object.keys(e).sort()).toEqual(['actorKind', 'actorUserId', 'at', 'command', 'entityIds', 'fileId', 'id']);
      for (const id of e.entityIds) expect(id).toMatch(/^[a-z]+_[0-9a-z]+$/);
    }
    expect(new Set(deps.events.events.map((e) => e.command))).toEqual(new Set([
      'cases.save', 'cases.copy', 'cases.recalculate', 'cases.share', 'cases.unshare', 'cases.delete',
    ]));
  });
});

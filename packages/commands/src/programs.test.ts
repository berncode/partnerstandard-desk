import { describe, expect, it } from 'vitest';
import { programSheet, publicBlocks, publicPlain, type CompanyFacts, type Program } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '@partner-desk/storage';
import type { Actor } from './actor';
import { archiveMarket, changeMarket, createMarket, readMarket } from './markets';
import { changePartner, importPartners, readPartners } from './partners';
import {
  createProgram, deleteProgram, listPrograms, readCompanyFacts, readProgram, refreshProgramOutputs, saveCompanyFacts,
  saveProgram,
} from './programs';
import { makeTestDeps, TEST_NOW } from './testing';

const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
const stranger: Actor = { kind: 'owner', userId: 'u2', displayName: 'Anna' };
const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', userId: 'u1', displayName: 'Ruth', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
const companyId = 'co_aaaaaaaaaa';
const otherCompany = 'co_bbbbbbbbbb';

async function setup() {
  const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa', u2: 'co_bbbbbbbbbb' } });
  await deps.companies.rename('u1', 'Halden');
  await readPartners(deps, owner, { companyId });
  deps.events.events.length = 0;
  return deps;
}

type TestDeps = Awaited<ReturnType<typeof setup>>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

async function fresh(deps: TestDeps, partnerType = 'reseller') {
  return value(await createProgram(deps, owner, { companyId, partnerType, from: 'fresh' }));
}

async function addPartnerType(deps: TestDeps, partnerType = 'reseller', company = 'Acme') {
  const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company } } }));
  const added = value(await changePartner(deps, owner, {
    companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType, whyItFits: 'Fits' } },
  }));
  return added.entityId!;
}

async function partner(deps: TestDeps, partnerId: string) {
  const read = value(await readPartners(deps, owner, { companyId }));
  return read.value.partners.find((p) => p.id === partnerId)!;
}

async function market(deps: TestDeps, partnerType = 'reseller', marketName = 'DACH') {
  const created = value(await createMarket(deps, owner, {
    companyId, info: { marketName, partnerType, ourProduct: 'Tool', ourTargetCustomers: 'Mid-sized banks' },
  }));
  return created.marketId;
}

const setProgram = (partnerId: string, patch: Record<string, unknown>) =>
  ({ companyId, change: { kind: 'update', entity: 'partner', id: partnerId, patch } });

/** The save a screen sends: the program as it read it, changed by `edit`. */
async function save(deps: TestDeps, actor: Actor, programId: string, edit: (p: Program) => void) {
  const read = value(await readProgram(deps, owner, { programId }));
  const program = structuredClone(read.value);
  edit(program);
  return saveProgram(deps, actor, { programId, program, base: read.value, expectedUpdatedAt: read.value.updatedAt || null });
}

describe('readCompanyFacts', () => {
  it('makes the file on the first read, for the owner, with the starting facts, and keeps it', async () => {
    const deps = await setup();
    const first = value(await readCompanyFacts(deps, owner, { companyId }));
    expect(first.value).toMatchObject({ id: companyId, currency: 'EUR', spend: null, revenue: null });
    const entry = await deps.directory.companyFacts(companyId);
    expect(entry).toMatchObject({ ownerUserId: 'u1' });
    const second = value(await readCompanyFacts(deps, owner, { companyId }));
    expect(second.value).toEqual(first.value);
    expect(await deps.directory.companyFacts(companyId)).toEqual(entry);
    expect(first.fileUrl).toBe(deps.companyFacts.urlFor({ fileId: entry!.fileId }));
    expect(deps.events.events).toEqual([]); // a read leaves no event (owner, 2026-11-14)
  });

  it('never lets an agent make the file, and lets it read one that exists', async () => {
    const deps = await setup();
    expect(await readCompanyFacts(deps, agent('change'), { companyId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.directory.companyFacts(companyId)).toBeNull();
    await readCompanyFacts(deps, owner, { companyId });
    expect(await readCompanyFacts(deps, agent('read'), { companyId })).toMatchObject({ ok: true });
  });

  it('makes no file for a company whose Partners file is someone else’s, and shows nobody else the facts', async () => {
    const deps = await setup();
    expect(await readCompanyFacts(deps, stranger, { companyId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await deps.directory.companyFacts(companyId)).toBeNull();
    await readCompanyFacts(deps, owner, { companyId });
    expect(await readCompanyFacts(deps, stranger, { companyId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await readCompanyFacts(deps, owner, { companyId: 'nope' })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('two first reads at once make one file, and the loser’s file is thrown away', async () => {
    const deps = await setup();
    const discarded: string[] = [];
    const discard = deps.companyFacts.discard.bind(deps.companyFacts);
    deps.companyFacts.discard = async (ref) => { discarded.push(ref.fileId); return discard(ref); };
    const [a, b] = await Promise.all([readCompanyFacts(deps, owner, { companyId }), readCompanyFacts(deps, owner, { companyId })]);
    expect(a.ok && b.ok).toBe(true);
    expect(discarded).toHaveLength(1);
    expect(discarded[0]).not.toBe((await deps.directory.companyFacts(companyId))!.fileId);
  });

  it('a file the store can’t make is a failure with its message', async () => {
    const deps = await setup();
    deps.companyFacts.create = async () => { throw new StoreFailure('quota', COPY.QUOTA_MESSAGE); };
    expect(await readCompanyFacts(deps, owner, { companyId })).toEqual({ ok: false, error: 'quota', message: COPY.QUOTA_MESSAGE });
    expect(await deps.directory.companyFacts(companyId)).toBeNull();
  });
});

describe('saveCompanyFacts', () => {
  async function saveFacts(deps: TestDeps, actor: Actor, edit: (f: CompanyFacts) => void, base?: CompanyFacts) {
    const read = value(await readCompanyFacts(deps, owner, { companyId }));
    const facts = structuredClone(read.value);
    edit(facts);
    return saveCompanyFacts(deps, actor, { companyId, facts, base: base ?? read.value, expectedUpdatedAt: read.value.updatedAt || null });
  }

  it('saves the facts whole and records ids only', async () => {
    const deps = await setup();
    const r = await saveFacts(deps, owner, (f) => { f.yearly = 12000; f.rules.handover = 'Secret handover words'; });
    expect(value(r).value).toMatchObject({ yearly: 12000, updatedAt: TEST_NOW });
    const again = value(await readCompanyFacts(deps, owner, { companyId }));
    expect(again.value.rules.handover).toBe('Secret handover words');
    expect(JSON.stringify(deps.events.events)).not.toContain('Secret');
    expect(deps.events.events.map((e) => [e.command, e.entityIds])).toEqual([['companyFacts.save', []]]);
  });

  it('refuses facts that aren’t valid, a stale base, and nobody else’s save', async () => {
    const deps = await setup();
    const bad = await saveFacts(deps, owner, (f) => { (f as { currency: string }).currency = 'XYZ'; });
    expect(bad).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { currency: 'Pick a currency from the list.' } });
    const read = value(await readCompanyFacts(deps, owner, { companyId }));
    const stale = await saveFacts(deps, owner, (f) => { f.once = 5; }, { ...read.value, once: 99 });
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    expect(await saveFacts(deps, stranger, (f) => { f.once = 5; })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(value(await readCompanyFacts(deps, owner, { companyId })).value.once).toBe(0);
    expect(deps.events.events.filter((e) => e.command === 'companyFacts.save')).toHaveLength(0);
  });

  it('follows the agent’s grant', async () => {
    const deps = await setup();
    expect(await saveFacts(deps, agent('read'), (f) => { f.once = 5; })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await saveFacts(deps, agent('change'), (f) => { f.once = 5; })).toMatchObject({ ok: true });
    expect(deps.events.events.at(-1)).toMatchObject({ command: 'companyFacts.save', actorKind: 'agent' });
    // A propose agent may do all a change agent may (agent proposals spec 5.2).
    expect(await saveFacts(deps, agent('propose'), (f) => { f.once = 6; })).toMatchObject({ ok: true });
    expect(deps.events.events.at(-1)).toMatchObject({ command: 'companyFacts.save', actorKind: 'agent' });
  });
});

describe('createProgram', () => {
  it('starts a fresh program of the type, lists it and records ids only', async () => {
    const deps = await setup();
    const created = await fresh(deps);
    expect(created.programId).toMatch(/^pg_[0-9a-z]{10}$/);
    expect(created.marketLink).toBe('none');
    expect(created.snapshot.value).toMatchObject({ id: created.programId, companyId, type: 'reseller', name: 'Halden Reseller Program' });
    expect(await deps.directory.program(created.programId)).toMatchObject({
      companyId, ownerUserId: 'u1', displayName: 'Reseller', partnerType: 'reseller',
    });
    expect(value(await readProgram(deps, owner, { programId: created.programId })).value).toEqual(created.snapshot.value);
    const event = deps.events.events.find((e) => e.command === 'programs.create');
    expect(event).toMatchObject({ entityIds: [created.programId], actorKind: 'owner' });
    expect(JSON.stringify(deps.events.events)).not.toContain('Halden');
  });

  it('refuses a partner type no program covers, with its reason, and makes nothing', async () => {
    const deps = await setup();
    expect(await createProgram(deps, owner, { companyId, partnerType: 'oem', from: 'fresh' })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { partnerType: expect.stringContaining('Not covered') },
    });
    expect(await createProgram(deps, owner, { companyId, partnerType: 'wizard', from: 'fresh' })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { partnerType: COPY.PROGRAM_PICK_TYPE },
    });
    expect(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'other' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await deps.directory.programs(companyId)).toEqual([]);
  });

  it('keeps a long default name within 80 characters', async () => {
    const deps = await setup();
    await deps.companies.rename('u1', 'H'.repeat(80));
    const created = await fresh(deps, 'vad');
    expect(created.snapshot.value.name.length).toBeLessThanOrEqual(80);
  });

  it('copies one of the person’s programs', async () => {
    const deps = await setup();
    const source = await fresh(deps);
    expect(await save(deps, owner, source.programId, (p) => { p.why = ['Better margins']; p.focus = 'DACH'; })).toMatchObject({ ok: true });
    const copy = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { copyOf: source.programId } }));
    expect(copy.snapshot.value).toMatchObject({ why: ['Better margins'], focus: '', name: 'Halden Reseller Program (copy)' });
    expect(deps.events.events.at(-1)).toMatchObject({ command: 'programs.create', entityIds: [copy.programId, source.programId] });
  });

  it('copies a program only as the same partner type (owner, 2026-10-30)', async () => {
    const deps = await setup();
    const source = await fresh(deps);
    expect(await createProgram(deps, owner, { companyId, partnerType: 'distributor', from: { copyOf: source.programId } }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { from: COPY.PROGRAM_COPY_OTHER_TYPE } });
    expect(await deps.directory.programs(companyId)).toHaveLength(1);
  });

  it('never copies a program that isn’t this person’s, or one of another company', async () => {
    const deps = await setup();
    const source = await fresh(deps);
    await readPartners(deps, stranger, { companyId: otherCompany });
    expect(await createProgram(deps, stranger, { companyId: otherCompany, partnerType: 'reseller', from: { copyOf: source.programId } }))
      .toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { copyOf: 'pg_nothere000' } }))
      .toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.directory.programs(otherCompany)).toEqual([]);
  });

  it('starts from a market: fills four answers and the market feeds the new program', async () => {
    const deps = await setup();
    const marketId = await market(deps);
    const vp = value(await changeMarket(deps, owner, { marketId, change: { kind: 'add', entity: 'valuePoint', values: { text: 'Margin on every sale', state: 'confirmed' } } }));
    await changeMarket(deps, owner, { marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'IT resellers for banks', status: 'holds', valuePointIds: [vp.entityId] } } });
    deps.events.events.length = 0;
    const created = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { marketId } }));
    expect(created.marketLink).toBe('made');
    expect(created.snapshot.value).toMatchObject({ ipp: 'IT resellers for banks', icp: 'Mid-sized banks', why: ['Margin on every sale'], focus: 'DACH' });
    expect(value(await readMarket(deps, owner, { marketId })).value.info.feedsProgramId).toBe(created.programId);
    expect(deps.events.events.slice(0, 2).map((e) => [e.command, e.entityIds])).toEqual([
      ['programs.create', [created.programId, marketId]],
      ['markets.change', [marketId]],
    ]);
    expect(JSON.stringify(deps.events.events)).not.toContain('DACH');
  });

  it('starts from a market with long texts: they are clipped, the program is made and the market feeds it', async () => {
    const deps = await setup();
    const words = (n: number) => Array.from({ length: Math.ceil(n / 5) }, (_, i) => `w${String(i % 1000).padStart(3, '0')}`).join(' ').slice(0, n);
    const { marketId } = value(await createMarket(deps, owner, {
      companyId, info: { marketName: words(250), partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: words(2100) },
    }));
    const vp = value(await changeMarket(deps, owner, { marketId, change: { kind: 'add', entity: 'valuePoint', values: { text: words(250), state: 'confirmed' } } }));
    await changeMarket(deps, owner, { marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: words(250), status: 'holds', valuePointIds: [vp.entityId] } } });
    const created = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { marketId } }));
    expect(created.marketLink).toBe('made');
    const p = created.snapshot.value;
    for (const reason of p.why) expect(reason.length).toBeLessThanOrEqual(200);
    expect(p.focus.length).toBeLessThanOrEqual(200);
    expect(p.icp.length).toBeLessThanOrEqual(2000);
    expect(value(await readProgram(deps, owner, { programId: created.programId })).value.focus).toBe(p.focus);
  });

  it('refuses a market of another partner type, or another person’s, and makes nothing', async () => {
    const deps = await setup();
    const marketId = await market(deps, 'referral');
    expect(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { marketId } })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { from: COPY.MARKET_OTHER_TYPE },
    });
    expect(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { marketId: 'm_nothere000' } }))
      .toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.directory.programs(companyId)).toEqual([]);
  });

  it('keeps the program when the market link can’t be made, and says so', async () => {
    const deps = await setup();
    const marketId = await market(deps);
    const logged: Array<[string, Record<string, string>]> = [];
    deps.log = (event, ids) => { logged.push([event, ids]); };
    deps.markets.apply = async () => ({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    const created = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { marketId } }));
    expect(created).toMatchObject({ marketLink: 'failed', message: COPY.MARKET_LINK_NOT_MADE });
    expect(await deps.directory.program(created.programId)).not.toBeNull();
    expect(value(await readMarket(deps, owner, { marketId })).value.info.feedsProgramId).toBeNull();
    expect(logged).toEqual([['program_market_link_failed', { programId: created.programId, marketId }]]);
    expect(deps.events.events.map((e) => e.command)).not.toContain('markets.change');
  });

  it('keeps the program when the market store throws on the link', async () => {
    const deps = await setup();
    const marketId = await market(deps);
    deps.markets.apply = async () => { throw new StoreFailure('unavailable', COPY.UNAVAILABLE_MESSAGE); };
    const created = value(await createProgram(deps, owner, { companyId, partnerType: 'reseller', from: { marketId } }));
    expect(created.marketLink).toBe('failed');
  });

  it('makes the Company facts file for the owner when there is none, but never for an agent', async () => {
    const deps = await setup();
    expect(await createProgram(deps, agent('change'), { companyId, partnerType: 'reseller', from: 'fresh' })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.directory.companyFacts(companyId)).toBeNull();
    await fresh(deps);
    expect(await deps.directory.companyFacts(companyId)).not.toBeNull();
  });

  it('follows the agent’s grant', async () => {
    const deps = await setup();
    await readCompanyFacts(deps, owner, { companyId });
    expect(await createProgram(deps, agent('read'), { companyId, partnerType: 'reseller', from: 'fresh' })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await createProgram(deps, agent('change'), { companyId, partnerType: 'reseller', from: 'fresh' })).toMatchObject({ ok: true });
    expect(await createProgram(deps, agent('propose'), { companyId, partnerType: 'referral', from: 'fresh' })).toMatchObject({ ok: true });
  });

  it('removes the new file when the directory fails', async () => {
    const deps = await setup();
    const discarded: string[] = [];
    const discard = deps.programs.discard.bind(deps.programs);
    deps.programs.discard = async (ref) => { discarded.push(ref.fileId); return discard(ref); };
    deps.directory.addProgram = async () => { throw new Error('programs_add_failed'); };
    await expect(createProgram(deps, owner, { companyId, partnerType: 'reseller', from: 'fresh' })).rejects.toThrow('programs_add_failed');
    expect(discarded).toHaveLength(1);
  });
});

describe('listPrograms and readProgram', () => {
  it('lists the person’s programs by label and type, and nobody else’s', async () => {
    const deps = await setup();
    const a = await fresh(deps);
    const b = await fresh(deps, 'referral');
    await save(deps, owner, a.programId, (p) => { p.focus = 'DACH'; });
    deps.events.events.length = 0;
    const listed = value(await listPrograms(deps, owner, { companyId }));
    expect(listed).toEqual([
      { programId: a.programId, label: 'Reseller · DACH', partnerType: 'reseller' },
      { programId: b.programId, label: 'Referral Partner', partnerType: 'referral' },
    ]);
    expect(await listPrograms(deps, stranger, { companyId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(value(await listPrograms(deps, stranger, { companyId: otherCompany }))).toEqual([]);
    expect(value(await listPrograms(deps, agent('read'), { companyId }))).toHaveLength(2);
    expect(deps.events.events).toEqual([]); // a read leaves no event (owner, 2026-11-14)
  });

  it('reads a program for its owner and an agent, and nobody else', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    deps.events.events.length = 0;
    const read = value(await readProgram(deps, agent('read'), { programId }));
    expect(read.value.id).toBe(programId);
    expect(read.fileUrl).toMatch(/^memory:\/\//);
    expect(await readProgram(deps, stranger, { programId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await readProgram(deps, owner, { programId: 'pg_nothere000' })).toMatchObject({ ok: false, error: 'file_not_found' });
    // An agent's read leaves no event.
    expect(deps.events.events).toEqual([]);
  });
});

describe('saveProgram', () => {
  it('saves the program, renames its directory row, and records ids only', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    deps.events.events.length = 0;
    const saved = await save(deps, owner, programId, (p) => { p.focus = 'DACH'; p.goals = 'Secret goals'; });
    expect(value(saved).snapshot.value).toMatchObject({ focus: 'DACH', goals: 'Secret goals', updatedAt: TEST_NOW });
    expect((await deps.directory.program(programId))?.displayName).toBe('Reseller · DACH');
    expect(deps.events.events.map((e) => e.command)).toEqual(['programs.save']);
    expect(deps.events.events[0]).toMatchObject({ entityIds: [programId] });
    expect(JSON.stringify(deps.events.events)).not.toContain('Secret');
  });

  it('saves the file when the directory rename fails, and logs ids only', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const logged: Array<[string, Record<string, string>]> = [];
    deps.log = (event, ids) => { logged.push([event, ids]); };
    deps.directory.renameProgram = async () => { throw new Error('programs_rename_failed'); };
    expect(await save(deps, owner, programId, (p) => { p.focus = 'DACH'; })).toMatchObject({ ok: true });
    expect(logged).toEqual([['directory_rename_failed', { programId }]]);
  });

  it('says when the Partner type was changed by hand in the sheet, and how to put it back', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const read = value(await readProgram(deps, owner, { programId }));
    // What the screen sends after reading a file whose Partner type was typed over: the base has the new type too.
    const handEdited = { ...read.value, type: 'referral' as const };
    expect(await saveProgram(deps, owner, {
      programId, program: { ...handEdited, focus: 'DACH' }, base: handEdited, expectedUpdatedAt: read.value.updatedAt || null,
    })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { type: COPY.PROGRAM_TYPE_CHANGED_IN_SHEET('Referral Partner', 'Reseller') },
    });
    expect(COPY.PROGRAM_TYPE_CHANGED_IN_SHEET('Referral Partner', 'Reseller')).toBe(
      'Someone changed the Partner type in this program’s sheet to Referral Partner. A program’s partner type can’t change. '
      + 'Set it back to Reseller on the Program tab of the sheet, then reload this page.',
    );
    expect(value(await readProgram(deps, owner, { programId })).value).toEqual(read.value);
  });

  it('refuses a new partner type, an invalid program and a stale base, and writes nothing', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    expect(await save(deps, owner, programId, (p) => { p.type = 'referral'; })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { type: COPY.PROGRAM_TYPE_FIXED },
    });
    expect(await save(deps, owner, programId, (p) => { p.name = ''; })).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { name: expect.any(String) } });
    const read = value(await readProgram(deps, owner, { programId }));
    const stale = await saveProgram(deps, owner, {
      programId, program: { ...read.value, focus: 'DACH' }, base: { ...read.value, goals: 'Typed by hand' }, expectedUpdatedAt: null,
    });
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    expect(value(await readProgram(deps, owner, { programId })).value).toEqual(read.value);
    expect(deps.events.events.filter((e) => e.command === 'programs.save')).toHaveLength(0);
  });

  it('follows the agent’s grant', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    expect(await save(deps, agent('read'), programId, (p) => { p.focus = 'DACH'; })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await save(deps, stranger, programId, (p) => { p.focus = 'DACH'; })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await save(deps, agent('change'), programId, (p) => { p.focus = 'DACH'; })).toMatchObject({ ok: true });
    expect(await save(deps, agent('propose'), programId, (p) => { p.focus = 'Austria'; })).toMatchObject({ ok: true });
  });

  // Review Focus 2
  it('refuses to remove Preferred while partners sit at it, with the count, and writes nothing', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const first = await addPartnerType(deps, 'reseller', 'Acme');
    const second = await addPartnerType(deps, 'reseller', 'Bolt');
    await changePartner(deps, owner, setProgram(first, { programId, level: 'pref' }));
    await changePartner(deps, owner, setProgram(second, { programId, level: 'pref' }));
    expect(await save(deps, owner, programId, (p) => { p.prefOn = false; })).toEqual({
      ok: false, error: 'invalid', message: COPY.PREFERRED_IN_USE(2, 'Preferred', 'Registered'),
      fieldErrors: { prefOn: COPY.PREFERRED_IN_USE(2, 'Preferred', 'Registered') },
    });
    expect(value(await readProgram(deps, owner, { programId })).value.prefOn).toBe(true);
    await changePartner(deps, owner, setProgram(second, { level: 'reg' }));
    expect(await save(deps, owner, programId, (p) => { p.prefOn = false; })).toMatchObject({
      ok: false, message: COPY.PREFERRED_IN_USE(1, 'Preferred', 'Registered'),
    });
    await changePartner(deps, owner, setProgram(first, { level: null }));
    expect(await save(deps, owner, programId, (p) => { p.prefOn = false; })).toMatchObject({ ok: true });
    // With Preferred removed, nobody can be put at it.
    expect(await changePartner(deps, owner, setProgram(first, { level: 'pref' }))).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { level: COPY.PREFERRED_OFF('Preferred') },
    });
    expect((await partner(deps, first)).level).toBeNull();
  });

  it('counts only this program’s partners at Preferred, by the program’s own level names', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const other = await fresh(deps);
    const partnerId = await addPartnerType(deps);
    await changePartner(deps, owner, setProgram(partnerId, { programId: other.programId, level: 'pref' }));
    expect(await save(deps, owner, programId, (p) => { p.prefOn = false; })).toMatchObject({ ok: true });
    await save(deps, owner, other.programId, (p) => { p.prefName = 'Gold'; p.regName = 'Silver'; });
    expect(await save(deps, owner, other.programId, (p) => { p.prefOn = false; })).toMatchObject({
      ok: false, message: COPY.PREFERRED_IN_USE(1, 'Gold', 'Silver'),
    });
  });
});

describe('deleteProgram', () => {
  // Review Focus 1
  it('refuses while partners or markets point to it, with the counts, and keeps the file', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const first = await addPartnerType(deps, 'reseller', 'Acme');
    const second = await addPartnerType(deps, 'reseller', 'Bolt');
    await changePartner(deps, owner, setProgram(first, { programId }));
    await changePartner(deps, owner, setProgram(second, { programId, level: 'pref' }));
    const marketId = await market(deps);
    await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { feedsProgramId: programId } } });
    let trashed = 0;
    const trash = deps.programs.trash.bind(deps.programs);
    deps.programs.trash = async (ref) => { trashed++; return trash(ref); };
    deps.events.events.length = 0;

    const refused = await deleteProgram(deps, owner, { programId });
    expect(refused).toEqual({ ok: false, error: 'invalid', message: COPY.PROGRAM_IN_USE(2, 1) });
    expect(COPY.PROGRAM_IN_USE(2, 1)).toBe('This program still has 2 partners and 1 market. Move its partners and markets to another program first.');
    expect(trashed).toBe(0);
    expect(await readProgram(deps, owner, { programId })).toMatchObject({ ok: true });

    await changePartner(deps, owner, setProgram(first, { programId: null }));
    await changePartner(deps, owner, setProgram(second, { programId: null, level: null }));
    expect(await deleteProgram(deps, owner, { programId })).toEqual({ ok: false, error: 'invalid', message: COPY.PROGRAM_IN_USE(0, 1) });
    await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { feedsProgramId: null } } });
    deps.events.events.length = 0;

    expect(await deleteProgram(deps, owner, { programId })).toEqual({ ok: true, value: { programId } });
    expect(trashed).toBe(1);
    expect(await deps.directory.program(programId)).toBeNull();
    expect(await readProgram(deps, owner, { programId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(deps.events.events).toEqual([expect.objectContaining({ command: 'programs.delete', entityIds: [programId] })]);
  });

  it('words the counts', () => {
    expect(COPY.PROGRAM_IN_USE(1, 0)).toBe('This program still has 1 partner. Move its partners and markets to another program first.');
    expect(COPY.PROGRAM_IN_USE(0, 3)).toBe('This program still has 3 markets. Move its partners and markets to another program first.');
  });

  it('an archived market or another program’s partners don’t hold it', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const other = await fresh(deps);
    const partnerId = await addPartnerType(deps);
    await changePartner(deps, owner, setProgram(partnerId, { programId: other.programId }));
    const marketId = await market(deps);
    await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { feedsProgramId: programId } } });
    await archiveMarket(deps, owner, { marketId, archived: true });
    expect(await deleteProgram(deps, owner, { programId })).toMatchObject({ ok: true });
  });

  it('refuses when a market can’t be read, and writes nothing', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    await market(deps);
    deps.markets.read = async () => ({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    expect(await deleteProgram(deps, owner, { programId })).toMatchObject({ ok: false, error: 'unavailable' });
    expect(await deps.directory.program(programId)).not.toBeNull();
  });

  it('reads only the markets of the program’s type: one of another type that can’t be read doesn’t stop it', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    await market(deps, 'referral', 'Nordics');
    await market(deps, 'reseller', 'DACH');
    const read = deps.markets.read.bind(deps.markets);
    const fileIds: string[] = [];
    for (const m of await deps.directory.markets(companyId)) fileIds.push((await deps.directory.market(m.marketId))!.fileId);
    const [referralFile] = fileIds;
    const asked: string[] = [];
    deps.markets.read = async (ref) => {
      asked.push(ref.fileId);
      return ref.fileId === referralFile ? { ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE } : read(ref);
    };
    expect(await deleteProgram(deps, owner, { programId })).toMatchObject({ ok: true });
    expect(asked).not.toContain(referralFile);
    expect(asked).toHaveLength(1);
  });

  it('is a decision: a person deletes, an agent never does', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    for (const level of ['read', 'change', 'propose'] as const) {
      expect(await deleteProgram(deps, agent(level), { programId })).toMatchObject({ ok: false, error: 'forbidden' });
    }
    expect(await deleteProgram(deps, stranger, { programId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await deps.directory.program(programId)).not.toBeNull();
  });
});

describe('refreshProgramOutputs', () => {
  it('rewrites the Program Sheet and Public page from the program, the facts and the company name', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const written: Array<[string, unknown, string]> = [];
    deps.programs.writeOutputs = async (ref, sheet, text) => { written.push([ref.fileId, sheet, text]); };
    deps.events.events.length = 0;
    expect(await refreshProgramOutputs(deps, owner, { programId })).toEqual({ ok: true, value: { programId } });
    const program = value(await readProgram(deps, owner, { programId })).value;
    const facts = value(await readCompanyFacts(deps, owner, { companyId })).value;
    const fileId = (await deps.directory.program(programId))!.fileId;
    expect(written).toEqual([[fileId, programSheet(facts, program, 'Halden'), publicPlain(publicBlocks(facts, program))]]);
    expect(deps.events.events[0]).toMatchObject({ command: 'programs.refreshOutputs', fileId, entityIds: [programId] });
  });

  it('names a company without a name as the screens do, in the sheet’s footer', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    await deps.companies.rename(owner.userId, '  ');
    const written: unknown[] = [];
    deps.programs.writeOutputs = async (_ref, sheet) => { written.push(sheet); };
    expect(await refreshProgramOutputs(deps, owner, { programId })).toMatchObject({ ok: true });
    expect(written[0]).toMatchObject({ footer: [`${COPY.COMPANY_UNNAMED} · internal, not for partners`, 'Made with PartnerStandard Desk'] });
  });

  it('turns a store failure into a result, and throws on anything else', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    deps.events.events.length = 0;
    deps.programs.writeOutputs = async () => { throw new StoreFailure('unavailable', COPY.UNAVAILABLE_MESSAGE); };
    expect(await refreshProgramOutputs(deps, owner, { programId })).toEqual({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    deps.programs.writeOutputs = async () => { throw new TypeError('bug'); };
    await expect(refreshProgramOutputs(deps, owner, { programId })).rejects.toThrow('bug');
    expect(deps.events.events.filter((e) => e.command === 'programs.refreshOutputs')).toHaveLength(0);
  });

  it('follows the agent’s grant', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    expect(await refreshProgramOutputs(deps, agent('read'), { programId })).toMatchObject({ ok: false, error: 'forbidden' });
    expect(await refreshProgramOutputs(deps, agent('change'), { programId })).toMatchObject({ ok: true });
    expect(await refreshProgramOutputs(deps, stranger, { programId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });
});

// Review Focus 3
describe('a program set on a partner type or a market', () => {
  it('puts a partner type in a program of its type, at a level', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const partnerId = await addPartnerType(deps);
    expect(await changePartner(deps, agent('change'), setProgram(partnerId, { programId, level: 'pref' }))).toMatchObject({ ok: true });
    expect(await partner(deps, partnerId)).toMatchObject({ programId, level: 'pref' });
  });

  it('refuses a program of another type, from a person, an agent or a stale screen, and writes nothing', async () => {
    const deps = await setup();
    const referral = await fresh(deps, 'referral');
    const partnerId = await addPartnerType(deps, 'reseller');
    const refusal = { ok: false, error: 'invalid', fieldErrors: { programId: COPY.PROGRAM_OTHER_TYPE } };
    expect(await changePartner(deps, owner, setProgram(partnerId, { programId: referral.programId }))).toMatchObject(refusal);
    expect(await changePartner(deps, agent('change'), setProgram(partnerId, { programId: referral.programId, level: 'reg' }))).toMatchObject(refusal);
    expect(await partner(deps, partnerId)).toMatchObject({ programId: null, level: null });
    const account = value(await changePartner(deps, owner, { companyId, change: { kind: 'add', entity: 'account', values: { company: 'Bolt' } } }));
    const added = await changePartner(deps, owner, {
      companyId, change: { kind: 'add', entity: 'partner', values: { accountId: account.entityId, partnerType: 'reseller', programId: referral.programId } },
    });
    expect(added).toMatchObject(refusal);
    const book = value(await readPartners(deps, owner, { companyId })).value;
    expect(book.partners.filter((p) => p.accountId === account.entityId)).toEqual([]);
  });

  it('refuses an unknown program, or one of another person, and writes nothing', async () => {
    const deps = await setup();
    const partnerId = await addPartnerType(deps);
    await readPartners(deps, stranger, { companyId: otherCompany });
    const theirs = value(await createProgram(deps, stranger, { companyId: otherCompany, partnerType: 'reseller', from: 'fresh' }));
    for (const programId of ['pg_nothere000', theirs.programId]) {
      expect(await changePartner(deps, owner, setProgram(partnerId, { programId }))).toMatchObject({
        ok: false, error: 'invalid', fieldErrors: { programId: COPY.PROGRAM_NOT_FOUND },
      });
    }
    expect((await partner(deps, partnerId)).programId).toBeNull();
  });

  it('refuses Preferred in a program whose file was trashed by hand, on the field, and writes nothing', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const partnerId = await addPartnerType(deps);
    await deps.programs.trash({ fileId: (await deps.directory.program(programId))!.fileId });
    expect(await changePartner(deps, owner, setProgram(partnerId, { programId, level: 'pref' }))).toEqual({
      ok: false, error: 'invalid', message: COPY.PROGRAM_NOT_FOUND, fieldErrors: { programId: COPY.PROGRAM_NOT_FOUND },
    });
    expect(await partner(deps, partnerId)).toMatchObject({ programId: null, level: null });
    deps.programs.read = async () => ({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    expect(await changePartner(deps, owner, setProgram(partnerId, { programId, level: 'pref' }))).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('refuses joining a program whose file was trashed by hand at any level, and a market feeding it', async () => {
    const deps = await setup();
    const { programId } = await fresh(deps);
    const partnerId = await addPartnerType(deps);
    const marketId = await market(deps);
    await deps.programs.trash({ fileId: (await deps.directory.program(programId))!.fileId });
    for (const patch of [{ programId }, { programId, level: 'reg' }]) {
      expect(await changePartner(deps, owner, setProgram(partnerId, patch))).toMatchObject({
        ok: false, error: 'invalid', fieldErrors: { programId: COPY.PROGRAM_NOT_FOUND },
      });
    }
    expect(await changeMarket(deps, owner, { marketId, change: { kind: 'updateInfo', patch: { feedsProgramId: programId } } })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { feedsProgramId: COPY.PROGRAM_NOT_FOUND },
    });
    expect(await partner(deps, partnerId)).toMatchObject({ programId: null });
  });

  it('checks Preferred when only the level or only the program changes', async () => {
    const deps = await setup();
    const withPref = await fresh(deps);
    const withoutPref = await fresh(deps);
    expect(await save(deps, owner, withoutPref.programId, (p) => { p.prefOn = false; })).toMatchObject({ ok: true });
    const partnerId = await addPartnerType(deps);
    expect(await changePartner(deps, owner, setProgram(partnerId, { programId: withoutPref.programId }))).toMatchObject({ ok: true });
    expect(await changePartner(deps, owner, setProgram(partnerId, { level: 'pref' }))).toMatchObject({
      ok: false, fieldErrors: { level: COPY.PREFERRED_OFF('Preferred') },
    });
    expect(await changePartner(deps, owner, setProgram(partnerId, { programId: withPref.programId, level: 'pref' }))).toMatchObject({ ok: true });
    expect(await changePartner(deps, owner, setProgram(partnerId, { programId: withoutPref.programId }))).toMatchObject({
      ok: false, fieldErrors: { level: COPY.PREFERRED_OFF('Preferred') },
    });
    expect(await partner(deps, partnerId)).toMatchObject({ programId: withPref.programId, level: 'pref' });
    // Clearing needs no program at all, and other fields need no check.
    expect(await changePartner(deps, owner, setProgram(partnerId, { programId: null, level: null }))).toMatchObject({ ok: true });
  });

  it('refuses an import that names a program of another type, and writes nothing', async () => {
    const deps = await setup();
    const referral = await fresh(deps, 'referral');
    const r = await importPartners(deps, owner, {
      companyId,
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'a_bolt01', company: 'Bolt' } },
        { kind: 'add', entity: 'partner', values: { id: 'p_bolt01', accountId: 'a_bolt01', partnerType: 'reseller', programId: referral.programId } },
      ],
    });
    expect(r).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { programId: COPY.PROGRAM_OTHER_TYPE } });
    expect(value(await readPartners(deps, owner, { companyId })).value.accounts).toEqual([]);
  });

  it('lets a market feed only a program of its type', async () => {
    const deps = await setup();
    const reseller = await fresh(deps);
    const referral = await fresh(deps, 'referral');
    const marketId = await market(deps);
    const feed = (feedsProgramId: string | null, actor: Actor = owner) =>
      changeMarket(deps, actor, { marketId, change: { kind: 'updateInfo', patch: { feedsProgramId } } });
    expect(await feed(referral.programId, agent('change'))).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { feedsProgramId: COPY.PROGRAM_OTHER_TYPE },
    });
    expect(await feed('pg_nothere000')).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { feedsProgramId: COPY.PROGRAM_NOT_FOUND } });
    expect(value(await readMarket(deps, owner, { marketId })).value.info.feedsProgramId).toBeNull();
    expect(await feed(reseller.programId)).toMatchObject({ ok: true });
    expect(await feed(null)).toMatchObject({ ok: true });
  });

  it('checks the program a new market feeds', async () => {
    const deps = await setup();
    const referral = await fresh(deps, 'referral');
    const info = { marketName: 'DACH', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks', feedsProgramId: referral.programId };
    expect(await createMarket(deps, owner, { companyId, info })).toMatchObject({
      ok: false, error: 'invalid', fieldErrors: { feedsProgramId: COPY.PROGRAM_OTHER_TYPE },
    });
    expect(await deps.directory.markets(companyId)).toEqual([]);
    const reseller = await fresh(deps);
    expect(await createMarket(deps, owner, { companyId, info: { ...info, feedsProgramId: reseller.programId } })).toMatchObject({ ok: true });
  });
});

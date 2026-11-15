import { describe, expect, it, vi } from 'vitest';
import { READ_COMMANDS, type CommandName } from '../access';
import type { Actor, AgentActor, AgentLevel } from '../actor';
import { createCase } from '../cases';
import { startMap } from '../maps';
import { createMarket } from '../markets';
import { changePartner, readPartners } from '../partners';
import { createProgram, readCompanyFacts } from '../programs';
import { openReview } from '../reviews';
import { makeTestDeps } from '../testing';
import { agentContext, type AgentContext } from './context';
import type { PartnerAccountRead, PartnerRow } from './read-tools';
import { AGENT_TOOLS, runTool } from './tools';

const ANNA_CO = 'co_aaaaaaaaaa';
const BEN_CO = 'co_bbbbbbbbbb';
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const ben: Actor = { kind: 'owner', userId: 'u_ben', displayName: 'Ben' };
/** Signed on this day, the first horizon's review is coming up on TEST_NOW (as in reviews.test.ts). */
const SIGNED = '2026-08-15';

type TestDeps = ReturnType<typeof makeTestDeps>;

function value<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error(`expected ok, got ${JSON.stringify(r)}`);
  return r.value;
}

/** Anna (u_anna) and Ben (u_ben), each with their Partners file and Company facts, and Anna's agent at `level`. */
async function setup(level: AgentLevel = 'read') {
  const deps = makeTestDeps({ companies: { u_anna: ANNA_CO, u_ben: BEN_CO } });
  for (const [actor, companyId] of [[anna, ANNA_CO], [ben, BEN_CO]] as const) {
    await readPartners(deps, actor, { companyId });
    await readCompanyFacts(deps, actor, { companyId });
  }
  const ctx = await agentContext(deps, { userId: 'u_anna', displayName: 'Anna', agentName: 'Claude', level, via: { kind: 'app', clientId: 'c_claude' } });
  return { deps, ctx };
}

const partnerChange = async (deps: TestDeps, actor: Actor, companyId: string, change: Record<string, unknown>) =>
  value(await changePartner(deps, actor, { companyId, change }));

async function addPartner(deps: TestDeps, actor: Actor, companyId: string, company: string, partnerType = 'reseller') {
  const accountId = (await partnerChange(deps, actor, companyId, { kind: 'add', entity: 'account', values: { company } })).entityId!;
  const partnerId = (await partnerChange(deps, actor, companyId, {
    kind: 'add', entity: 'partner', values: { accountId, partnerType, whyItFits: 'SECRET why it fits' },
  })).entityId!;
  return { accountId, partnerId };
}

/** One signed reseller with a MAP, a market it is linked to, a program, a business case and an open review. */
async function withEverything(deps: TestDeps, actor: Actor, companyId: string, company = 'Acme') {
  const { accountId, partnerId } = await addPartner(deps, actor, companyId, company);
  const { mapId } = value(await startMap(deps, actor, { companyId, partnerId }));
  await partnerChange(deps, actor, companyId, { kind: 'markSigned', partnerId, signedDate: SIGNED });
  const { marketId } = value(await createMarket(deps, actor, {
    companyId, info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
  }));
  await partnerChange(deps, actor, companyId, { kind: 'add', entity: 'marketLink', values: { partnerId, marketId } });
  const { programId } = value(await createProgram(deps, actor, { companyId, partnerType: 'reseller', from: 'fresh' }));
  await partnerChange(deps, actor, companyId, { kind: 'update', entity: 'partner', id: partnerId, patch: { programId } });
  const { caseId } = value(await createCase(deps, actor, { companyId, partnerId }));
  const reviewId = value(await openReview(deps, actor, { mapId })).review!.id;
  deps.events.events.length = 0;
  return { accountId, partnerId, mapId, marketId, programId, caseId, reviewId };
}

type Fixture = Awaited<ReturnType<typeof withEverything>>;

/** Each read tool with an input it accepts, and the commands it may run. */
const READS: Record<string, { input: (f: Fixture) => Record<string, unknown>; commands: CommandName[] }> = {
  this_week: { input: () => ({}), commands: ['week.read', 'proposals.list'] },
  list_proposals: { input: () => ({}), commands: ['proposals.list', 'partners.read'] },
  list_partners: { input: () => ({}), commands: ['partners.read'] },
  get_partner: { input: (f) => ({ accountId: f.accountId }), commands: ['partners.read'] },
  list_markets: { input: () => ({}), commands: ['markets.list'] },
  get_market: { input: (f) => ({ marketId: f.marketId }), commands: ['markets.read'] },
  list_programs: { input: () => ({}), commands: ['programs.list'] },
  get_program: { input: (f) => ({ programId: f.programId }), commands: ['programs.read'] },
  get_company_facts: { input: () => ({}), commands: ['companyFacts.read'] },
  list_cases: { input: () => ({}), commands: ['cases.list'] },
  get_case: { input: (f) => ({ caseId: f.caseId }), commands: ['cases.read'] },
  list_maps: { input: () => ({}), commands: ['maps.list'] },
  get_map: { input: (f) => ({ mapId: f.mapId }), commands: ['maps.read'] },
  list_reviews: { input: () => ({}), commands: ['reviews.list'] },
  list_webhooks: { input: () => ({}), commands: ['webhooks.list'] },
  get_review: { input: (f) => ({ mapId: f.mapId, reviewId: f.reviewId }), commands: ['reviews.read'] },
};

describe('the read tools', () => {
  it('every read tool runs only READ_COMMANDS', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const readTools = AGENT_TOOLS.filter((t) => t.level === 'read').map((t) => t.name).sort();
    expect(Object.keys(READS).sort()).toEqual(readTools);
    for (const [name, { commands }] of Object.entries(READS)) {
      for (const command of commands) expect({ name, command, read: READ_COMMANDS.includes(command) }).toEqual({ name, command, read: true });
    }
    // Run as Anna herself: a person's changes record their events and reads record none (owner, 2026-11-14), so a read
    // tool that ran any change would leave one.
    const asOwner: AgentContext = { ...ctx, actor: anna as unknown as AgentActor };
    for (const [name, { input }] of Object.entries(READS)) {
      deps.events.events.length = 0;
      const result = await runTool(asOwner, name, input(f));
      expect({ name, ok: result.ok }).toEqual({ name, ok: true });
      expect({ name, events: deps.events.events.map((e) => e.command) }).toEqual({ name, events: [] });
    }
  });

  it('a read tool records no event', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    for (const [name, { input }] of Object.entries(READS)) {
      const result = await runTool(ctx, name, input(f));
      expect({ name, ok: result.ok }).toEqual({ name, ok: true });
    }
    expect(deps.events.events).toEqual([]);
  });

  it('list_partners pages 120 partners as 50, 50, 20 and filters by stage', async () => {
    const { deps, ctx } = await setup();
    const added: Array<{ accountId: string; partnerId: string }> = [];
    for (let i = 0; i < 120; i++) added.push(await addPartner(deps, anna, ANNA_CO, `Partner ${i}`));
    for (const { partnerId } of added.slice(0, 20)) {
      await partnerChange(deps, anna, ANNA_CO, { kind: 'markSigned', partnerId, signedDate: SIGNED });
    }
    deps.events.events.length = 0;
    type Page = { items: PartnerRow[]; nextCursor: string | null };
    const first = value(await runTool(ctx, 'list_partners', {})) as Page;
    expect(first.items).toHaveLength(50);
    const second = value(await runTool(ctx, 'list_partners', { cursor: first.nextCursor })) as Page;
    expect(second.items).toHaveLength(50);
    const third = value(await runTool(ctx, 'list_partners', { cursor: second.nextCursor })) as Page;
    expect(third.items).toHaveLength(20);
    expect(third.nextCursor).toBeNull();
    const all = [...first.items, ...second.items, ...third.items];
    expect(all.map((r) => r.partnerId)).toEqual(added.map((a) => a.partnerId));
    expect(all[0]).toEqual({
      accountId: added[0]!.accountId, partnerId: added[0]!.partnerId, name: 'Partner 0', partnerType: 'reseller', stage: 'onboarding', step: null,
      closed: null, mapHealth: null, nextDate: null,
    });
    expect(all[20]).toMatchObject({ name: 'Partner 20', stage: 'recruitment', step: 'researched' });

    const onboarding = value(await runTool(ctx, 'list_partners', { stage: 'onboarding' })) as Page;
    expect(onboarding.items.map((r) => r.partnerId)).toEqual(added.slice(0, 20).map((a) => a.partnerId));
    expect(onboarding.nextCursor).toBeNull();
    const small = value(await runTool(ctx, 'list_partners', { stage: 'recruitment', limit: 100 })) as Page;
    expect(small.items).toHaveLength(100);
    expect(deps.events.events).toEqual([]);
  });

  it('list_partners filters by partner type and by market', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const other = await addPartner(deps, anna, ANNA_CO, 'Beta', 'referral');
    type Page = { items: PartnerRow[] };
    const byType = value(await runTool(ctx, 'list_partners', { partnerType: 'referral' })) as Page;
    expect(byType.items.map((r) => r.partnerId)).toEqual([other.partnerId]);
    const byMarket = value(await runTool(ctx, 'list_partners', { marketId: f.marketId })) as Page;
    expect(byMarket.items.map((r) => r.partnerId)).toEqual([f.partnerId]);
    expect(value(await runTool(ctx, 'list_partners', { marketId: 'mk_nothere' }))).toEqual({ items: [], nextCursor: null });
  });

  it('get_partner returns the account with its partner types, people, calls and market links', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const reseller = f.partnerId;
    const referral = (await partnerChange(deps, anna, ANNA_CO, {
      kind: 'add', entity: 'partner', values: { accountId: f.accountId, partnerType: 'referral', whyItFits: 'Fits' },
    })).entityId!;
    const elsewhere = await addPartner(deps, anna, ANNA_CO, 'Beta');
    const read = value(await runTool(ctx, 'get_partner', { accountId: f.accountId })) as PartnerAccountRead;
    expect(read.account).toMatchObject({ id: f.accountId, company: 'Acme' });
    expect(read.partners.map((p) => p.id)).toEqual([reseller, referral]);
    expect(read.partners[0]).toMatchObject({ stage: 'onboarding', signedDate: SIGNED });
    expect(read.marketLinks.map((l) => l.marketId)).toEqual([f.marketId]);
    expect(read.partners.map((p) => p.id)).not.toContain(elsewhere.partnerId);
    expect(read).toHaveProperty('people');
    expect(read).toHaveProperty('calls');
    expect(read).toHaveProperty('qualifications');
  });

  it('get_partner with a missing account is not_found', async () => {
    const { ctx } = await setup();
    expect(await runTool(ctx, 'get_partner', { accountId: 'ac_missing' })).toMatchObject({ ok: false, error: 'not_found' });
  });

  it('the list tools page what their commands list', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const items = async (name: string, input: Record<string, unknown> = {}) =>
      (value(await runTool(ctx, name, input)) as { items: Array<Record<string, unknown>>; nextCursor: string | null });
    expect(await items('list_markets')).toMatchObject({ items: [{ marketId: f.marketId }], nextCursor: null });
    expect(await items('list_programs')).toMatchObject({ items: [{ programId: f.programId }], nextCursor: null });
    expect(await items('list_cases')).toMatchObject({ items: [{ caseId: f.caseId, partnerId: f.partnerId }], nextCursor: null });
    expect(await items('list_cases', { partnerId: 'pt_other' })).toEqual({ items: [], nextCursor: null });
    expect(await items('list_maps')).toMatchObject({ items: [{ mapId: f.mapId, partnerId: f.partnerId }], nextCursor: null });
    expect(await items('list_maps', { partnerId: f.partnerId, limit: 1 })).toMatchObject({ items: [{ mapId: f.mapId }], nextCursor: null });
    expect(await items('list_reviews')).toMatchObject({ items: [{ mapId: f.mapId, reviewId: f.reviewId }], nextCursor: null });
  });

  it('the get tools return what their commands return, ids in place', async () => {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const get = async (name: string, input: Record<string, unknown>) => value(await runTool(ctx, name, input)) as Record<string, unknown>;
    expect(await get('get_map', { mapId: f.mapId })).toMatchObject({ value: { info: { partnerId: f.partnerId } } });
    expect(await get('get_case', { caseId: f.caseId })).toHaveProperty('value');
    expect(await get('get_market', { marketId: f.marketId })).toMatchObject({ value: { info: { marketId: f.marketId, companyId: ANNA_CO } } });
    expect(await get('get_program', { programId: f.programId })).toHaveProperty('value');
    expect(await get('get_review', { mapId: f.mapId, reviewId: f.reviewId })).toMatchObject({ mapId: f.mapId, review: { id: f.reviewId } });
    expect(await get('get_company_facts', {})).toHaveProperty('value');
  });
});

describe('get_partner with include (question 22)', () => {
  /** Anna's Acme with everything, a second partner type (referral) with no MAP, and Beta (another account) with a MAP and a case. */
  async function withTwoTypes() {
    const { deps, ctx } = await setup();
    const f = await withEverything(deps, anna, ANNA_CO);
    const referral = (await partnerChange(deps, anna, ANNA_CO, {
      kind: 'add', entity: 'partner', values: { accountId: f.accountId, partnerType: 'referral', whyItFits: 'Fits' },
    })).entityId!;
    const { programId } = value(await createProgram(deps, anna, { companyId: ANNA_CO, partnerType: 'referral', from: 'fresh' }));
    await partnerChange(deps, anna, ANNA_CO, { kind: 'update', entity: 'partner', id: referral, patch: { programId } });
    const beta = await addPartner(deps, anna, ANNA_CO, 'Beta');
    const betaMap = value(await startMap(deps, anna, { companyId: ANNA_CO, partnerId: beta.partnerId })).mapId;
    const betaCase = value(await createCase(deps, anna, { companyId: ANNA_CO, partnerId: beta.partnerId, programId: f.programId })).caseId;
    const fileOf = async (mapId: string) => (await deps.directory.map(mapId))!.fileId;
    const caseFileOf = async (caseId: string) => (await deps.directory.businessCase(caseId))!.fileId;
    deps.events.events.length = 0;
    const mapReads = vi.spyOn(deps.maps, 'read');
    const caseReads = vi.spyOn(deps.cases, 'read');
    return { deps, ctx, f, referral, beta, betaMap, betaCase, fileOf, caseFileOf, mapReads, caseReads };
  }
  const filesRead = (spy: { mock: { calls: Array<[{ fileId: string }]> } }) => spy.mock.calls.map(([ref]) => ref.fileId);

  it('without include, answers exactly what it did', async () => {
    const { ctx, f, mapReads, caseReads } = await withTwoTypes();
    const read = value(await runTool(ctx, 'get_partner', { accountId: f.accountId })) as PartnerAccountRead;
    expect(Object.keys(read)).toEqual(['account', 'partners', 'people', 'calls', 'qualifications', 'marketLinks']);
    expect(mapReads).not.toHaveBeenCalled();
    expect(caseReads).not.toHaveBeenCalled();
  });

  it('include map reads only the MAPs of the account’s partner types', async () => {
    const { ctx, f, mapReads, caseReads, fileOf } = await withTwoTypes();
    const read = value(await runTool(ctx, 'get_partner', { accountId: f.accountId, include: ['map'] })) as PartnerAccountRead;
    expect(read.maps).toHaveLength(1);
    expect(read.maps![0]).toMatchObject({ partnerId: f.partnerId, mapId: f.mapId, read: { ok: true } });
    expect(read.maps![0]!.read).toEqual(await runTool(ctx, 'get_map', { mapId: f.mapId }));
    expect(read).not.toHaveProperty('cases');
    expect(read).not.toHaveProperty('reviews');
    // Anna's MAP was read twice: once by get_partner, once by get_map above. Beta's MAP never.
    expect(filesRead(mapReads)).toEqual([await fileOf(f.mapId), await fileOf(f.mapId)]);
    expect(caseReads).not.toHaveBeenCalled();
  });

  it('include cases reads each case of the account, newest first, and no MAP', async () => {
    const { deps, ctx, f, referral, betaCase, mapReads, caseReads, caseFileOf } = await withTwoTypes();
    deps.clock = () => '2026-10-29T10:00:00.000Z';
    const second = value(await createCase(deps, anna, { companyId: ANNA_CO, partnerId: referral })).caseId;
    deps.clock = () => '2026-10-30T10:00:00.000Z';
    const third = value(await createCase(deps, anna, { companyId: ANNA_CO, partnerId: f.partnerId })).caseId;
    caseReads.mockClear();
    const read = value(await runTool(ctx, 'get_partner', { accountId: f.accountId, include: ['cases'] })) as PartnerAccountRead;
    expect(read.cases!.map((c) => [c.partnerId, c.caseId])).toEqual([[f.partnerId, third], [referral, second], [f.partnerId, f.caseId]]);
    expect(read.cases!.every((c) => c.read.ok)).toBe(true);
    expect(read.cases![0]!.read).toEqual(await runTool(ctx, 'get_case', { caseId: third }));
    expect(filesRead(caseReads).slice(0, 3)).toEqual([await caseFileOf(third), await caseFileOf(second), await caseFileOf(f.caseId)]);
    expect(filesRead(caseReads)).not.toContain(await caseFileOf(betaCase));
    expect(read).not.toHaveProperty('maps');
    expect(read).not.toHaveProperty('casesTruncated');
    expect(mapReads).not.toHaveBeenCalled();
  });

  it('include cases reads the 20 newest cases and says there are more', async () => {
    const { deps, ctx, f, caseReads } = await withTwoTypes();
    const made: string[] = [];
    for (let day = 1; day <= 21; day++) {
      deps.clock = () => `2026-11-${String(day).padStart(2, '0')}T10:00:00.000Z`;
      made.push(value(await createCase(deps, anna, { companyId: ANNA_CO, partnerId: f.partnerId })).caseId);
    }
    caseReads.mockClear();
    const read = value(await runTool(ctx, 'get_partner', { accountId: f.accountId, include: ['cases'] })) as PartnerAccountRead;
    // 22 cases (21 made here and the fixture's): the 20 newest, newest first, each read; the 2 oldest neither.
    expect(read.cases!.map((c) => c.caseId)).toEqual([...made].reverse().slice(0, 20));
    expect(read.casesTruncated).toBe(true);
    expect(caseReads).toHaveBeenCalledTimes(20);
  });

  it('a MAP of the account another person in the company owns is neither read nor listed', async () => {
    const { deps, ctx, f, referral, mapReads, fileOf } = await withTwoTypes();
    await deps.directory.addMap({
      mapId: 'mp_carasmap00', fileId: 'file_caras_map', ownerUserId: 'u_cara', companyId: ANNA_CO, partnerId: referral,
      partnerType: 'referral', displayName: 'Acme as referral partner', createdAt: '2026-10-28T09:00:00.000Z', startedOn: '2026-10-28',
    });
    const result = await runTool(ctx, 'get_partner', { accountId: f.accountId, include: ['map', 'reviews'] });
    const read = value(result) as PartnerAccountRead;
    expect(read.maps!.map((m) => m.mapId)).toEqual([f.mapId]);
    expect(read.reviews!.map((r) => r.partnerId)).toEqual([f.partnerId]);
    expect(JSON.stringify(result)).not.toContain('mp_carasmap00');
    expect(filesRead(mapReads)).toEqual([await fileOf(f.mapId), await fileOf(f.mapId)]);
  });

  it('include reviews lists each MAP’s reviews by partner type, and reads no other MAP', async () => {
    const { ctx, f, mapReads, caseReads, fileOf } = await withTwoTypes();
    const read = value(await runTool(ctx, 'get_partner', { accountId: f.accountId, include: ['reviews'] })) as PartnerAccountRead;
    expect(read.reviews).toHaveLength(1);
    expect(read.reviews![0]).toMatchObject({ partnerId: f.partnerId, read: { ok: true } });
    const lines = (read.reviews![0]!.read as { ok: true; value: Array<{ mapId: string; reviewId: string | null }> }).value;
    expect(lines).toEqual([expect.objectContaining({ mapId: f.mapId, reviewId: f.reviewId })]);
    expect(filesRead(mapReads)).toEqual([await fileOf(f.mapId)]);
    expect(caseReads).not.toHaveBeenCalled();
    expect(read).not.toHaveProperty('maps');
    expect(read).not.toHaveProperty('cases');
  });

  it('a case file that can’t be read answers its failure in its item, and the rest still comes', async () => {
    const { deps, ctx, f, referral, caseFileOf, caseReads } = await withTwoTypes();
    const other = value(await createCase(deps, anna, { companyId: ANNA_CO, partnerId: referral })).caseId;
    const broken = await caseFileOf(f.caseId);
    caseReads.mockRestore();
    const real = deps.cases.read.bind(deps.cases);
    vi.spyOn(deps.cases, 'read').mockImplementation(async (ref) =>
      (ref.fileId === broken ? { ok: false, error: 'file_not_found', message: 'gone' } : real(ref)));
    const result = await runTool(ctx, 'get_partner', { accountId: f.accountId, include: ['map', 'cases'] });
    expect(result.ok).toBe(true);
    const read = value(result) as PartnerAccountRead;
    const byId = new Map(read.cases!.map((c) => [c.caseId, c.read]));
    expect(byId.get(f.caseId)).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(byId.get(other)).toMatchObject({ ok: true });
    expect(read.maps![0]!.read.ok).toBe(true);
    expect(read.account.id).toBe(f.accountId);
  });

  it('refuses an unknown include, and reads nothing', async () => {
    const { deps, ctx, f, mapReads, caseReads } = await withTwoTypes();
    const bookReads = vi.spyOn(deps.partnerBooks, 'read');
    for (const include of [['everything'], ['MAP'], [], ['map', 'cases', 'reviews', 'map']]) {
      expect(await runTool(ctx, 'get_partner', { accountId: f.accountId, include })).toMatchObject({ ok: false, error: 'invalid' });
    }
    expect(bookReads).not.toHaveBeenCalled();
    expect(mapReads).not.toHaveBeenCalled();
    expect(caseReads).not.toHaveBeenCalled();
  });

  it('the same include twice reads once', async () => {
    const { ctx, f, mapReads, fileOf } = await withTwoTypes();
    const read = value(await runTool(ctx, 'get_partner', { accountId: f.accountId, include: ['map', 'map'] })) as PartnerAccountRead;
    expect(read.maps).toHaveLength(1);
    expect(filesRead(mapReads)).toEqual([await fileOf(f.mapId)]);
  });

  it('runs only read commands, and Ben’s account answers as a missing one, with nothing of his read', async () => {
    const { deps, ctx, mapReads, caseReads } = await withTwoTypes();
    const bens = await withEverything(deps, ben, BEN_CO, 'Bens Partner');
    mapReads.mockClear();
    caseReads.mockClear();
    const all = ['map', 'cases', 'reviews'];
    const theirs = await runTool(ctx, 'get_partner', { accountId: bens.accountId, include: all });
    expect(theirs).toEqual(await runTool(ctx, 'get_partner', { accountId: 'ac_missing', include: all }));
    expect(theirs).toMatchObject({ ok: false, error: 'not_found' });
    expect(mapReads).not.toHaveBeenCalled();
    expect(caseReads).not.toHaveBeenCalled();
    // Run as Anna herself: a change would leave an event, and reads leave none (owner, 2026-11-14).
    const f = await withEverything(deps, anna, ANNA_CO, 'Corvid');
    const asOwner: AgentContext = { ...ctx, actor: anna as unknown as AgentActor };
    deps.events.events.length = 0;
    mapReads.mockClear();
    caseReads.mockClear();
    value(await runTool(asOwner, 'get_partner', { accountId: f.accountId, include: all }));
    expect(mapReads).toHaveBeenCalled();
    expect(caseReads).toHaveBeenCalled();
    expect(deps.events.events.map((e) => e.command)).toEqual([]);
  });
});

describe('get_review without a reviewId', () => {
  it('a read agent reads the current horizon\'s review, with its prep and scorecard', async () => {
    const { deps, ctx } = await setup('read');
    const f = await withEverything(deps, anna, ANNA_CO);
    const read = value(await runTool(ctx, 'get_review', { mapId: f.mapId })) as Record<string, unknown>;
    expect(read).toMatchObject({ mapId: f.mapId, review: { id: f.reviewId }, status: { kind: 'coming' } });
    expect(read).toHaveProperty('numbers');
    expect(read).toHaveProperty('items');
    expect(read).toEqual(value(await runTool(ctx, 'get_review', { mapId: f.mapId, reviewId: f.reviewId })));
    expect(deps.events.events).toEqual([]);
  });

  it('before the prep, it answers the coming review\'s status with no review, not a refusal', async () => {
    const { deps, ctx } = await setup('read');
    const { partnerId } = await addPartner(deps, anna, ANNA_CO, 'Acme');
    const { mapId } = value(await startMap(deps, anna, { companyId: ANNA_CO, partnerId }));
    await partnerChange(deps, anna, ANNA_CO, { kind: 'markSigned', partnerId, signedDate: SIGNED });
    const read = value(await runTool(ctx, 'get_review', { mapId })) as Record<string, unknown>;
    expect(read).toMatchObject({ mapId, review: null, status: { kind: 'coming' } });
    expect(deps.events.events.filter((e) => e.command === 'reviews.open')).toEqual([]);
  });
});

describe('another person\'s ids (Review Focus 1)', () => {
  it('get_map with Ben\'s map id by Anna\'s agent is file_not_found, like a missing id', async () => {
    const { deps, ctx } = await setup();
    await withEverything(deps, anna, ANNA_CO);
    const bens = await withEverything(deps, ben, BEN_CO, 'Bens Partner');
    const theirs = await runTool(ctx, 'get_map', { mapId: bens.mapId });
    expect(theirs).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(theirs).toEqual(await runTool(ctx, 'get_map', { mapId: 'mp_missing0000' }));
    expect(deps.events.events).toEqual([]);
  });

  it('every get tool answers Ben\'s id as it answers a missing one, and Anna\'s lists show none of Ben\'s', async () => {
    const { deps, ctx } = await setup();
    await withEverything(deps, anna, ANNA_CO);
    const bens = await withEverything(deps, ben, BEN_CO, 'Bens Partner');
    const pairs: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
      ['get_partner', { accountId: bens.accountId }, { accountId: 'ac_missing' }],
      ['get_market', { marketId: bens.marketId }, { marketId: 'mk_missing' }],
      ['get_program', { programId: bens.programId }, { programId: 'pg_missing' }],
      ['get_case', { caseId: bens.caseId }, { caseId: 'cs_missing' }],
      ['get_map', { mapId: bens.mapId }, { mapId: 'mp_missing' }],
      ['get_review', { mapId: bens.mapId, reviewId: bens.reviewId }, { mapId: 'mp_missing', reviewId: bens.reviewId }],
      ['get_review', { mapId: bens.mapId }, { mapId: 'mp_missing' }],
    ];
    for (const [name, theirs, missing] of pairs) {
      const answer = await runTool(ctx, name, theirs);
      expect({ name, ok: answer.ok }).toEqual({ name, ok: false });
      expect({ name, answer }).toEqual({ name, answer: await runTool(ctx, name, missing) });
    }
    const lists = ['list_partners', 'list_markets', 'list_programs', 'list_cases', 'list_maps', 'list_reviews'];
    const bensIds = new Set(Object.values(bens));
    for (const name of lists) {
      const listed = JSON.stringify(value(await runTool(ctx, name, {})));
      for (const id of bensIds) expect({ name, id, listed: listed.includes(id) }).toEqual({ name, id, listed: false });
    }
    expect(deps.events.events).toEqual([]);
  });
});

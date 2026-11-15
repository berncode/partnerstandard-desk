import { changeMarket, createMarket, listPrograms, readCompanyFacts, readMarket, readPartners, readProgram, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import type { CompanyFacts } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const state = vi.hoisted(() => ({ session: null as OwnerSession | null, deps: null as unknown as ReturnType<typeof makeTestDeps> }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  companyFor: async () => ({ companyId: 'co_aaaaaaaaaa', name: 'Halden' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { companyFactsSave, programCreate, programDelete, programLevelsRead, programSave, programStartMarkets } = await import('./programs');

const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };

/** The facts as the page read them: the first read makes the file. */
async function readFacts(): Promise<CompanyFacts> {
  const read = await readCompanyFacts(state.deps, anna, { companyId: 'co_aaaaaaaaaa' });
  if (!read.ok) throw new Error(read.error);
  return read.value.value;
}

beforeEach(() => {
  state.session = session;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
});

describe('companyFactsSave', () => {
  it('saves the person’s own company facts and answers with them as stored', async () => {
    const base = await readFacts();
    const facts = { ...base, yearly: 18000, renew: 90 };
    const result = await companyFactsSave({ facts, base, expectedUpdatedAt: base.updatedAt || null });
    expect(result).toMatchObject({ ok: true, entityId: null, snapshot: { value: { yearly: 18000, renew: 90 } } });
    expect(await readFacts()).toMatchObject({ yearly: 18000, renew: 90 });
  });

  it('refuses with a conflict when the facts changed since the screen read them, and keeps what is stored', async () => {
    const base = await readFacts();
    const first = await companyFactsSave({ facts: { ...base, yearly: 100 }, base, expectedUpdatedAt: base.updatedAt || null });
    expect(first.ok).toBe(true);
    // A second screen still holds the first read.
    const stale = await companyFactsSave({ facts: { ...base, yearly: 200 }, base, expectedUpdatedAt: base.updatedAt || null });
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    expect(await readFacts()).toMatchObject({ yearly: 100 });
  });

  it('refuses facts with a mistake, on the field', async () => {
    const base = await readFacts();
    const result = await companyFactsSave({ facts: { ...base, renew: 150 }, base, expectedUpdatedAt: base.updatedAt || null });
    expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { renew: 'Customers who renew must be between 0 and 100.' } });
  });

  it('never takes a company from the input', async () => {
    const base = await readFacts();
    const result = await companyFactsSave({ companyId: 'co_bbbbbbbbbb', facts: base, base, expectedUpdatedAt: null });
    expect(result).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('answers a signed-out visitor with auth and saves nothing', async () => {
    const base = await readFacts();
    state.session = null;
    expect(await companyFactsSave({ facts: { ...base, yearly: 1 }, base, expectedUpdatedAt: null })).toEqual({
      ok: false, error: 'auth', message: COPY.SIGNED_OUT,
    });
    expect(await readFacts()).toMatchObject({ yearly: 0 });
  });
});

/** The person's programs, from the directory. */
async function listed() {
  const list = await listPrograms(state.deps, anna, { companyId: 'co_aaaaaaaaaa' });
  if (!list.ok) throw new Error(list.error);
  return list.value;
}

async function readOne(programId: string) {
  const read = await readProgram(state.deps, anna, { programId });
  if (!read.ok) throw new Error(read.error);
  return read.value.value;
}

describe('programCreate', () => {
  it('adds a program of the type to the person’s own company and answers its id', async () => {
    const made = await programCreate({ partnerType: 'reseller', from: 'fresh' });
    expect(made).toMatchObject({ ok: true, programId: expect.stringMatching(/^pg_/) });
    expect(await listed()).toEqual([{ programId: made.ok ? made.programId : '', label: 'Reseller', partnerType: 'reseller' }]);
  });

  it('copies one of the person’s programs', async () => {
    const first = await programCreate({ partnerType: 'reseller', from: 'fresh' });
    if (!first.ok) throw new Error(first.error);
    const before = await readOne(first.programId);
    const base = before;
    await programSave({ programId: first.programId, program: { ...before, why: ['Leads from us'] }, base, expectedUpdatedAt: base.updatedAt || null });
    const copy = await programCreate({ partnerType: 'reseller', from: { copyOf: first.programId } });
    if (!copy.ok) throw new Error(copy.error);
    expect(await readOne(copy.programId)).toMatchObject({ type: 'reseller', why: ['Leads from us'] });
    // A copy keeps its partner type (owner, 2026-10-30).
    expect(await programCreate({ partnerType: 'distributor', from: { copyOf: first.programId } })).toMatchObject({ ok: false, error: 'invalid' });
  });

  it('refuses a type that has no program, with its reason', async () => {
    expect(await programCreate({ partnerType: 'oem', from: 'fresh' })).toMatchObject({ ok: false, error: 'invalid', message: expect.stringMatching(/^Not covered: OEM/) });
    expect(await listed()).toEqual([]);
  });

  it('never takes a company from the input, and answers a signed-out visitor with auth', async () => {
    expect(await programCreate({ companyId: 'co_bbbbbbbbbb', partnerType: 'reseller', from: 'fresh' })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await programCreate({ partnerType: 'reseller', from: 'fresh' })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
  });
});

describe('programSave', () => {
  it('saves the program whole and answers it as stored, the next save’s base', async () => {
    const made = await programCreate({ partnerType: 'reseller', from: 'fresh' });
    if (!made.ok) throw new Error(made.error);
    const base = await readOne(made.programId);
    const result = await programSave({ programId: made.programId, program: { ...base, focus: 'DACH' }, base, expectedUpdatedAt: base.updatedAt || null });
    expect(result).toMatchObject({ ok: true, entityId: null, snapshot: { value: { focus: 'DACH' } } });
    expect((await listed())[0]!.label).toBe('Reseller · DACH');
  });

  it('refuses with a conflict when the program changed since the screen read it', async () => {
    const made = await programCreate({ partnerType: 'reseller', from: 'fresh' });
    if (!made.ok) throw new Error(made.error);
    const base = await readOne(made.programId);
    await programSave({ programId: made.programId, program: { ...base, lead: 'Anna' }, base, expectedUpdatedAt: base.updatedAt || null });
    const stale = await programSave({ programId: made.programId, program: { ...base, lead: 'Bert' }, base, expectedUpdatedAt: base.updatedAt || null });
    expect(stale).toMatchObject({ ok: false, error: 'conflict' });
    expect(await readOne(made.programId)).toMatchObject({ lead: 'Anna' });
  });
});

describe('programDelete', () => {
  it('deletes a program nobody points to: its row goes and its file goes to the trash', async () => {
    const made = await programCreate({ partnerType: 'reseller', from: 'fresh' });
    if (!made.ok) throw new Error(made.error);
    expect(await programDelete({ programId: made.programId })).toEqual({ ok: true, programId: made.programId });
    expect(await listed()).toEqual([]);
  });

  it('answers a program that isn’t there as gone, and a signed-out visitor with auth', async () => {
    expect(await programDelete({ programId: 'pg_zzzzzzzzzz' })).toMatchObject({ ok: false, error: 'file_not_found' });
    state.session = null;
    expect(await programDelete({ programId: 'pg_zzzzzzzzzz' })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
  });
});

describe('programCreate from a market', () => {
  it('starts from one of the person’s markets, and the market feeds the new program', async () => {
    await readPartners(state.deps, anna, { companyId: 'co_aaaaaaaaaa' });
    const market = await createMarket(state.deps, anna, {
      companyId: 'co_aaaaaaaaaa', info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
    });
    if (!market.ok) throw new Error(market.error);
    const made = await programCreate({ partnerType: 'reseller', from: { marketId: market.value.marketId } });
    if (!made.ok) throw new Error(made.error);
    expect(await readOne(made.programId)).toMatchObject({ focus: 'Austria', icp: 'Banks' });
    const read = await readMarket(state.deps, anna, { marketId: market.value.marketId });
    expect(read.ok && read.value.value.info.feedsProgramId).toBe(made.programId);
  });
});

describe('programLevelsRead', () => {
  it('answers the level names of the person’s programs, and one that isn’t there as gone', async () => {
    const made = await programCreate({ partnerType: 'reseller', from: 'fresh' });
    if (!made.ok) throw new Error(made.error);
    expect(await programLevelsRead({ programIds: [made.programId, 'pg_zzzzzzzzzz'] })).toEqual({
      ok: true,
      levels: { [made.programId]: { status: 'ready', reg: 'Registered', pref: 'Preferred', prefOn: true }, pg_zzzzzzzzzz: { status: 'gone' } },
    });
  });

  it('takes at most 20 ids, and answers a signed-out visitor with auth', async () => {
    expect(await programLevelsRead({ programIds: Array.from({ length: 21 }, (_, i) => `pg_${i}`) })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await programLevelsRead({ programIds: 'pg_a' })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await programLevelsRead({ programIds: [] })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
  });
});

describe('programStartMarkets', () => {
  it('answers the person’s open markets of the type with a hypothesis that holds', async () => {
    await readPartners(state.deps, anna, { companyId: 'co_aaaaaaaaaa' });
    const market = await createMarket(state.deps, anna, {
      companyId: 'co_aaaaaaaaaa', info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' },
    });
    if (!market.ok) throw new Error(market.error);
    expect(await programStartMarkets({ partnerType: 'reseller' })).toEqual({ ok: true, markets: [] });
    await changeMarket(state.deps, anna, { marketId: market.value.marketId, change: { kind: 'add', entity: 'hypothesis', values: { name: 'IT resellers', status: 'holds' } } });
    expect(await programStartMarkets({ partnerType: 'reseller' })).toEqual({ ok: true, markets: [{ marketId: market.value.marketId, displayName: 'Austria · Reseller' }] });
    expect(await programStartMarkets({ partnerType: 'nonsense' })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await programStartMarkets({ partnerType: 'reseller' })).toEqual({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
  });
});

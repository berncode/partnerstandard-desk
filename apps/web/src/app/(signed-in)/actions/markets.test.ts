import { readPartners, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const COMPANY = 'co_aaaaaaaaaa';
const state = vi.hoisted(() => ({ session: null as OwnerSession | null, deps: null as unknown as ReturnType<typeof makeTestDeps> }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  companyFor: async () => ({ companyId: COMPANY, name: '' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { marketArchive, marketChange, marketCopy, marketCreate, marketExclusionsImport, marketRead } = await import('./markets');

const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const annaSession: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };
const benSession: OwnerSession = { owner: { userId: 'u_ben', displayName: 'Ben' }, email: 'ben@example.test', storage: 'memory', personId: 'u_ben', member: null };
const info = { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' };
const SIGNED_OUT = { ok: false, error: 'auth', message: COPY.SIGNED_OUT };

beforeEach(async () => {
  state.session = annaSession;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa', u_ben: 'co_bbbbbbbbbb' } });
  await readPartners(state.deps, anna, { companyId: COMPANY });
});

async function created(): Promise<string> {
  const made = await marketCreate({ info });
  if (!made.ok || !made.entityId) throw new Error('setup');
  return made.entityId;
}

describe('marketCreate and marketCopy', () => {
  it('makes a market in the person’s company and answers with its id as the entity id', async () => {
    const made = await marketCreate({ info });
    expect(made).toMatchObject({ ok: true, entityId: expect.stringMatching(/^m_/), snapshot: { value: { info: { marketName: 'Austria', companyId: COMPANY } } } });
  });

  it('passes field errors on, and refuses a company id in the input', async () => {
    expect(await marketCreate({ info: { ...info, marketName: '' } })).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { marketName: expect.any(String) } });
    expect(await marketCreate({ info, companyId: 'co_bbbbbbbbbb' })).toEqual({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS });
  });

  it('copies a market into a new one', async () => {
    const marketId = await created();
    const copy = await marketCopy({ marketId, info: { marketName: 'Germany', partnerType: 'reseller' } });
    expect(copy).toMatchObject({ ok: true, snapshot: { value: { info: { marketName: 'Germany', copiedFrom: 'Austria · Reseller' } } } });
    expect(copy.ok && copy.entityId).not.toBe(marketId);
  });
});

describe('marketRead and marketChange', () => {
  it('reads the market and applies a change with the conflict check', async () => {
    const marketId = await created();
    const read = await marketRead(marketId);
    expect(read).toMatchObject({ ok: true, entityId: null, snapshot: { value: { info: { marketId } } } });
    if (!read.ok) return;
    // The snapshot only: the file's link stays on the server, as the page's loader keeps it.
    expect(read.snapshot).not.toHaveProperty('fileUrl');
    const change = await marketChange(marketId, { kind: 'updateInfo', patch: { statusNote: 'Two calls' }, expectedUpdatedAt: read.snapshot.value.info.updatedAt });
    expect(change).toMatchObject({ ok: true, snapshot: { value: { info: { statusNote: 'Two calls', updatedBy: 'Anna' } } } });
    expect(await marketChange(marketId, { kind: 'updateInfo', patch: { statusNote: 'Late' }, expectedUpdatedAt: read.snapshot.value.info.updatedAt }))
      .toMatchObject({ ok: false, error: 'conflict' });
  });

  it('answers someone else as if the market were not there', async () => {
    const marketId = await created();
    state.session = benSession;
    expect(await marketRead(marketId)).toEqual({ ok: false, error: 'file_not_found', message: COPY.NOT_FOUND_FILE });
    expect(await marketChange(marketId, { kind: 'updateInfo', patch: { statusNote: 'x' } })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await marketArchive(marketId, true)).toMatchObject({ ok: false, error: 'file_not_found' });
  });
});

describe('marketArchive', () => {
  it('archives and brings back a market', async () => {
    const marketId = await created();
    expect(await marketArchive(marketId, true)).toEqual({ ok: true });
    expect(await state.deps.directory.markets(COMPANY)).toEqual([expect.objectContaining({ marketId, archived: true })]);
    expect(await marketArchive(marketId, false)).toEqual({ ok: true });
    expect(await state.deps.directory.markets(COMPANY)).toEqual([expect.objectContaining({ marketId, archived: false })]);
  });

  it('refuses an archived flag that is not true or false', async () => {
    const marketId = await created();
    expect(await marketArchive(marketId, 'yes')).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('signed out', () => {
  it('answers every market action with auth and the signed-out words', async () => {
    const marketId = await created();
    state.session = null;
    expect(await marketRead(marketId)).toEqual(SIGNED_OUT);
    expect(await marketChange(marketId, { kind: 'updateInfo', patch: { statusNote: 'x' } })).toEqual(SIGNED_OUT);
    expect(await marketCreate({ info })).toEqual(SIGNED_OUT);
    expect(await marketCopy({ marketId, info: { marketName: 'Germany', partnerType: 'reseller' } })).toEqual(SIGNED_OUT);
    expect(await marketArchive(marketId, true)).toEqual(SIGNED_OUT);
    expect(await state.deps.directory.markets(COMPANY)).toHaveLength(1);
  });
});

describe('marketExclusionsImport', () => {
  it('adds the exclusions in one write and answers the market with the new rows’ ids', async () => {
    const marketId = await created();
    const changes = [{ kind: 'add', entity: 'exclusion', values: { company: 'Tauern Systems', website: '', reason: '' } }];
    const r = await marketExclusionsImport(marketId, changes);
    expect(r).toMatchObject({ ok: true, entityIds: [expect.any(String)], snapshot: { value: { exclusions: [{ company: 'Tauern Systems' }] } } });
  });

  it('refuses another person’s market, and anyone signed out', async () => {
    const marketId = await created();
    const changes = [{ kind: 'add', entity: 'exclusion', values: { company: 'A' } }];
    state.session = benSession;
    expect(await marketExclusionsImport(marketId, changes)).toMatchObject({ ok: false, error: 'file_not_found' });
    state.session = null;
    expect(await marketExclusionsImport(marketId, changes)).toEqual(SIGNED_OUT);
  });
});

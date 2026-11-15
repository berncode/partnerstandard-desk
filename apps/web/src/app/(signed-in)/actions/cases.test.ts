import { changePartner, createProgram, listCases, readPartners, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { COPY } from '@partner-desk/copy';
import { editMemoryFileByHand } from '@partner-desk/storage';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const COMPANY = 'co_aaaaaaaaaa';
const state = vi.hoisted(() => ({ session: null as OwnerSession | null, deps: null as unknown as ReturnType<typeof makeTestDeps> }));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  companyFor: async () => ({ companyId: COMPANY, name: 'Halden' }),
  shareUrl: (token: string) => `https://desk.test/s/${token}`,
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const {
  caseCopy, caseCreate, caseDelete, caseList, caseRead, caseRecalculate, caseRows, caseSave, caseShare, caseSources, caseUnshare,
} = await import('./cases');

const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };
const SIGNED_OUT = { ok: false, error: 'auth', message: COPY.SIGNED_OUT };

/** Acme as a reseller and as a technology partner: the two partner type ids. */
async function acme(): Promise<{ reseller: string; technology: string }> {
  const send = (change: unknown) => changePartner(state.deps, anna, { companyId: COMPANY, change });
  const account = await send({ kind: 'add', entity: 'account', values: { company: 'Acme' } });
  if (!account.ok || !account.value.entityId) throw new Error('setup');
  const reseller = await send({ kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'reseller' } });
  const technology = await send({ kind: 'add', entity: 'partner', values: { accountId: account.value.entityId, partnerType: 'technology' } });
  if (!reseller.ok || !reseller.value.entityId || !technology.ok || !technology.value.entityId) throw new Error('setup');
  return { reseller: reseller.value.entityId, technology: technology.value.entityId };
}

async function made(partnerId: string): Promise<string> {
  const result = await caseCreate({ partnerId });
  if (!result.ok) throw new Error(result.message);
  return result.caseId;
}

beforeEach(async () => {
  state.session = session;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  await readPartners(state.deps, anna, { companyId: COMPANY });
});

describe('caseCreate and caseList', () => {
  it('makes a case for the person’s own partner type and lists it, of that type or all', async () => {
    const { reseller, technology } = await acme();
    const first = await made(reseller);
    const second = await made(technology);
    const all = await caseList({});
    expect(all.ok && all.cases.map((c) => c.caseId).sort()).toEqual([first, second].sort());
    expect(await caseList({ partnerId: technology })).toMatchObject({ ok: true, cases: [{ caseId: second, partnerType: 'technology' }] });
    // No input lists them all too.
    expect(await caseList(undefined)).toMatchObject({ ok: true });
  });

  it('asks for the program when the partner type’s type has programs and it is in none, then takes the one picked', async () => {
    const { reseller } = await acme();
    const program = await createProgram(state.deps, anna, { companyId: COMPANY, partnerType: 'reseller', from: 'fresh' });
    if (!program.ok) throw new Error(program.error);
    expect(await caseCreate({ partnerId: reseller }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { programId: COPY.CASE_PICK_PROGRAM } });
    const picked = await caseCreate({ partnerId: reseller, programId: program.value.programId });
    expect(picked).toMatchObject({ ok: true, caseId: expect.stringMatching(/^case_/) });
  });

  it('never takes a company from the input, and answers a signed-out visitor with auth', async () => {
    const { reseller } = await acme();
    expect(await caseCreate({ partnerId: reseller, companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await caseList({ companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await caseCreate({ partnerId: reseller })).toEqual(SIGNED_OUT);
    expect(await caseList({})).toEqual(SIGNED_OUT);
    expect(await listCases(state.deps, anna, { companyId: COMPANY })).toEqual({ ok: true, value: [] });
  });
});

describe('caseRows', () => {
  it('gives each case of the partner type with the stage it was made in and its two numbers', async () => {
    const { reseller, technology } = await acme();
    const caseId = await made(reseller);
    await made(technology);
    const rows = await caseRows({ partnerId: reseller });
    expect(rows).toMatchObject({
      ok: true,
      rows: [{ caseId, title: expect.stringMatching(/^Case of /), numbers: { stageWhenMade: 'recruitment', earnings: 0, net: 0, currency: 'EUR' } }],
    });
  });

  it('keeps a case whose file can’t be read, without numbers', async () => {
    const { reseller } = await acme();
    const caseId = await made(reseller);
    const entry = await state.deps.directory.businessCase(caseId);
    await state.deps.cases.discard({ fileId: entry!.fileId });
    expect(await caseRows({ partnerId: reseller })).toMatchObject({ ok: true, rows: [{ caseId, numbers: null }] });
  });

  it('keeps a case whose partner type isn’t in its offer, without numbers, beside a good one', async () => {
    const { reseller } = await acme();
    const good = await made(reseller);
    const broken = await made(reseller);
    editMemoryFileByHand((await state.deps.directory.businessCase(broken))!.fileId, { typeId: 'type_gone' });
    const rows = await caseRows({ partnerId: reseller });
    expect(rows.ok && rows.rows.map((r) => [r.caseId, r.numbers === null]).sort()).toEqual([[good, false], [broken, true]].sort());
  });

  it('needs a partner type', async () => {
    expect(await caseRows({})).toMatchObject({ ok: false, error: 'invalid' });
  });
});

describe('caseCopy, caseDelete and caseRead', () => {
  it('copies a case of the same partner type, and deletes one', async () => {
    const { reseller } = await acme();
    const caseId = await made(reseller);
    const copy = await caseCopy({ caseId });
    expect(copy).toMatchObject({ ok: true, caseId: expect.stringMatching(/^case_/) });
    expect(await caseList({ partnerId: reseller })).toMatchObject({ ok: true, cases: [{}, {}] });
    expect(await caseDelete({ caseId })).toEqual({ ok: true, caseId });
    const left = await caseList({});
    expect(left.ok && left.cases.map((c) => c.caseId)).toEqual([copy.ok ? copy.caseId : '']);
    expect(await caseRead({ caseId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('reads a case with the company named as it is now', async () => {
    const { reseller } = await acme();
    const caseId = await made(reseller);
    expect(await caseRead({ caseId })).toMatchObject({ ok: true, value: { id: caseId, partner: 'Acme', partnerType: 'reseller' }, shared: null });
  });

  it('says what changed since a case was filled, and whether its partner type is still in Partners', async () => {
    const { reseller } = await acme();
    const caseId = await made(reseller);
    expect(await caseSources({ caseId })).toEqual({ ok: true, factsChangedAt: null, programChangedAt: null, partnerTypeGone: false });
    expect(await caseSources({ caseId: 'case_zzzzzzzzzzzz' })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await caseSources({ caseId, companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await caseSources({ caseId })).toEqual(SIGNED_OUT);
  });

  it('refuses anything but a case id', async () => {
    expect(await caseCopy({ caseId: 'case_x', companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await caseDelete({})).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await caseDelete({ caseId: 'case_x' })).toEqual(SIGNED_OUT);
  });
});

describe('caseSave, caseRecalculate, caseShare and caseUnshare', () => {
  it('save a case whole, recalculate it, and share and unshare it', async () => {
    const { reseller } = await acme();
    const caseId = await made(reseller);
    const read = await caseRead({ caseId });
    if (!read.ok) throw new Error(read.message);
    const base = read.value;
    const saved = await caseSave({ caseId, case: { ...base, title: 'Expansion' }, base, expectedUpdatedAt: base.updatedAt });
    expect(saved).toMatchObject({ ok: true, entityId: null, snapshot: { value: { title: 'Expansion' } } });
    // A screen that still holds the first read gets a conflict.
    expect(await caseSave({ caseId, case: { ...base, title: 'Late' }, base, expectedUpdatedAt: base.updatedAt })).toMatchObject({ ok: false, error: 'conflict' });
    if (!saved.ok) return;
    const recalculated = await caseRecalculate({ caseId, expectedUpdatedAt: saved.snapshot.value.updatedAt });
    expect(recalculated).toMatchObject({ ok: true, programId: null });
    const shared = await caseShare({ caseId });
    // The link on the app's own address, and the case as stamped, for the screen's next autosave.
    expect(shared).toMatchObject({ ok: true, url: expect.stringMatching(/^https:\/\/desk\.test\/s\/[A-Za-z0-9_-]{43}$/), snapshot: { value: { shared: { sharedAt: expect.any(String) } } } });
    expect(shared).not.toHaveProperty('token');
    expect(await caseRead({ caseId })).toMatchObject({ ok: true, shared: { createdAt: expect.any(String) } });
    expect(await caseUnshare({ caseId })).toMatchObject({ ok: true });
    expect(await caseRead({ caseId })).toMatchObject({ ok: true, shared: null });
  });

  it('refuse a company id in the input', async () => {
    expect(await caseSave({ caseId: 'x', case: {}, base: {}, expectedUpdatedAt: null, companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await caseRecalculate({ caseId: 'x', expectedUpdatedAt: null, companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await caseShare({ caseId: 'x', companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await caseUnshare({ caseId: 'x', companyId: COMPANY })).toMatchObject({ ok: false, error: 'invalid' });
  });
});

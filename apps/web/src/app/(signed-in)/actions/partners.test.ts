import { changePartner, createCase, listCases, readPartners, startMap, type Actor } from '@partner-desk/commands';
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

const { partnerChange, partnerImport, partnerRemoveType, recreatePartners } = await import('./partners');
const { marketCreate } = await import('./markets');

const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };
const session: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'anna@example.test', storage: 'memory', personId: 'u_anna', member: null };
const addAcme = { kind: 'add', entity: 'account', values: { company: 'Acme GmbH', website: 'acme.example' } };
const SIGNED_OUT = { ok: false, error: 'auth', message: COPY.SIGNED_OUT };

/** A section of `accountId`. Company facts stay on the account. */
const addSection = (accountId: string, partnerType = 'reseller') => ({ kind: 'add', entity: 'partner', values: { accountId, partnerType } });

beforeEach(async () => {
  state.session = session;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  await readPartners(state.deps, anna, { companyId: COMPANY });
});

describe('partnerChange', () => {
  it('applies the change to the person’s own book and answers with the snapshot and the new row', async () => {
    const account = await partnerChange(addAcme);
    expect(account.ok).toBe(true);
    if (!account.ok) return;
    expect(account.entityId).toMatch(/^a_/);
    const result = await partnerChange(addSection(account.entityId!));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entityId).toMatch(/^p_/);
    expect(result.snapshot.value.accounts).toEqual([expect.objectContaining({ id: account.entityId, company: 'Acme GmbH', updatedBy: 'Anna' })]);
    expect(result.snapshot.value.partners).toEqual([expect.objectContaining({
      id: result.entityId, accountId: account.entityId, partnerType: 'reseller', updatedBy: 'Anna',
    })]);
  });

  it('passes a refusal on with its code, message and field errors', async () => {
    expect(await partnerChange({ kind: 'add', entity: 'account', values: { company: '' } })).toEqual({
      ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { company: COPY.REQUIRED('Company') },
    });
    expect(await partnerChange({ kind: 'update', entity: 'account', id: 'a_none', patch: { company: 'X' } }))
      .toEqual({ ok: false, error: 'not_found', message: COPY.GONE });
  });

  it('answers a conflict when the row changed since the version the change was made on', async () => {
    const added = await changePartner(state.deps, anna, { companyId: COMPANY, change: addAcme });
    if (!added.ok || !added.value.entityId) throw new Error('setup');
    const result = await partnerChange({
      kind: 'update', entity: 'account', id: added.value.entityId, patch: { comments: 'x' }, expectedUpdatedAt: '2020-01-01T00:00:00.000Z',
    });
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
  });

  it('sends undoSigned and correctExit through to the command', async () => {
    const account = await partnerChange(addAcme);
    if (!account.ok || !account.entityId) throw new Error('setup');
    const section = await partnerChange(addSection(account.entityId));
    if (!section.ok || !section.entityId) throw new Error('setup');
    const partnerId = section.entityId;
    expect(await partnerChange({ kind: 'markSigned', partnerId, signedDate: '2026-09-15' })).toMatchObject({ ok: true });
    const undone = await partnerChange({ kind: 'undoSigned', partnerId });
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.snapshot.value.partners[0]).toMatchObject({ signedDate: null, stage: 'recruitment', step: 'map' });
    expect(await partnerChange({ kind: 'markSigned', partnerId, signedDate: '2026-09-15' })).toMatchObject({ ok: true });
    expect(await partnerChange({ kind: 'markExited', partnerId, exitedDate: '2026-10-21', reason: 'They left the market.' })).toMatchObject({ ok: true });
    const corrected = await partnerChange({ kind: 'correctExit', partnerId, exitedDate: '2026-11-01', reason: 'Chose another vendor' });
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    expect(corrected.snapshot.value.partners[0]).toMatchObject({ exitedDate: '2026-11-01', exitReason: 'Chose another vendor' });
  });

  it('sends a signing with shiftMapDates, says whether the MAP’s dates moved, and refuses the option on any other change', async () => {
    const account = await partnerChange(addAcme);
    if (!account.ok || !account.entityId) throw new Error('setup');
    const section = await partnerChange(addSection(account.entityId));
    if (!section.ok || !section.entityId) throw new Error('setup');
    const partnerId = section.entityId;
    // No MAP: the signing is saved and nothing is said about dates.
    const signed = await partnerChange({ kind: 'markSigned', partnerId, signedDate: '2026-09-15' }, { shiftMapDates: true });
    expect(signed).toMatchObject({ ok: true });
    expect(signed).not.toHaveProperty('mapDates');
    expect(await partnerChange({ kind: 'undoSigned', partnerId }, { shiftMapDates: true })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await partnerChange({ kind: 'undoSigned', partnerId }, { shiftMapDates: 'yes' })).toMatchObject({ ok: false, error: 'invalid' });
    const started = await startMap(state.deps, anna, { companyId: COMPANY, partnerId });
    if (!started.ok) throw new Error('setup');
    expect(await partnerChange({ kind: 'undoSigned', partnerId })).toMatchObject({ ok: true });
    expect(await partnerChange({ kind: 'markSigned', partnerId, signedDate: '2026-09-15' }, { shiftMapDates: true }))
      .toMatchObject({ ok: true, mapDates: { moved: true } });
  });

  it('answers a signed-out visitor with auth and the signed-out words, and changes nothing', async () => {
    state.session = null;
    expect(await partnerChange(addAcme)).toEqual(SIGNED_OUT);
    expect(COPY.SIGNED_OUT).toBe('You’re signed out. Sign in again to keep working.');
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    expect(read.ok && read.value.value.partners).toEqual([]);
  });
});

describe('partnerImport', () => {
  async function market() {
    const made = await marketCreate({ info: { marketName: 'Austria', partnerType: 'reseller', ourProduct: 'Tool', ourTargetCustomers: 'Banks' } });
    if (!made.ok || !made.entityId) throw new Error('setup');
    return made.entityId;
  }

  it('adds the partners and their market links in one write, with the ids per change', async () => {
    const marketId = await market();
    const result = await partnerImport({
      marketId,
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'a_tmp', company: 'Kappa GmbH' } },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_1', accountId: 'a_tmp', partnerType: 'reseller' } },
        { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_1', marketId } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entityIds).toEqual([expect.stringMatching(/^a_/), expect.stringMatching(/^p_/), expect.stringMatching(/^l_/)]);
    expect(result.snapshot.value.marketLinks).toEqual([expect.objectContaining({ partnerId: result.entityIds[1], marketId })]);
    expect(result.snapshot.value.partners).toEqual([expect.objectContaining({ id: result.entityIds[1], accountId: result.entityIds[0] })]);
  });

  it('refuses the whole import, saying how many came before the refused one', async () => {
    const marketId = await market();
    const result = await partnerImport({
      marketId,
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'a_tmp', company: 'Kappa GmbH' } },
        { kind: 'add', entity: 'partner', values: { id: 'tmp_1', accountId: 'a_tmp', partnerType: 'reseller' } },
        { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_1', marketId } },
        { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_1', marketId } },
      ],
    });
    expect(result).toEqual({
      ok: false, error: 'invalid', message: COPY.ALREADY_LINKED, fieldErrors: { marketId: COPY.ALREADY_LINKED }, valid: 3,
    });
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    expect(read.ok && read.value.value.partners).toEqual([]);
  });

  it('refuses a company id, or anything else, in the input', async () => {
    const marketId = await market();
    expect(await partnerImport({ marketId, changes: [addAcme], companyId: 'co_bbbbbbbbbb' })).toEqual({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS });
    expect(await partnerImport(null)).toEqual({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS });
  });

  it('answers a signed-out visitor with auth', async () => {
    state.session = null;
    expect(await partnerImport({ marketId: 'm_x', changes: [addAcme] })).toEqual(SIGNED_OUT);
  });
});

describe('recreatePartners', () => {
  it('makes a new book when the file is gone, and answers with it', async () => {
    const entry = await state.deps.directory.partnerBook(COMPANY);
    await state.deps.partnerBooks.discard({ fileId: entry!.fileId });
    const result = await recreatePartners();
    expect(result).toMatchObject({ ok: true, entityId: null, snapshot: { value: { companyId: COMPANY, partners: [] } } });
    expect((await state.deps.directory.partnerBook(COMPANY))!.fileId).not.toBe(entry!.fileId);
  });

  it('asks what happens to the business cases first, then keeps or trashes them as chosen', async () => {
    const account = await partnerChange(addAcme);
    if (!account.ok || !account.entityId) throw new Error('setup');
    const section = await partnerChange(addSection(account.entityId));
    if (!section.ok || !section.entityId) throw new Error('setup');
    const made = await createCase(state.deps, anna, { companyId: COMPANY, partnerId: section.entityId });
    if (!made.ok) throw new Error(made.error);
    const entry = await state.deps.directory.partnerBook(COMPANY);
    await state.deps.partnerBooks.discard({ fileId: entry!.fileId });
    expect(await recreatePartners()).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { items: COPY.CASES_CHOOSE(1) } });
    expect(await recreatePartners({ cases: 'everything' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await recreatePartners({ items: 'keep' })).toMatchObject({ ok: true });
    expect(await listCases(state.deps, anna, { companyId: COMPANY })).toEqual({ ok: true, value: [] });
  });

  it('refuses a company id in the input, and answers a signed-out visitor with auth', async () => {
    expect(await recreatePartners({ companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await recreatePartners()).toEqual(SIGNED_OUT);
  });
});

describe('partnerImport without a market', () => {
  it('adds a company and its partner type in one write', async () => {
    const result = await partnerImport({
      changes: [
        { kind: 'add', entity: 'account', values: { id: 'a_tmp', company: 'Kappa GmbH' } },
        { kind: 'add', entity: 'partner', values: { id: 'p_tmp', accountId: 'a_tmp', partnerType: 'reseller' } },
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.snapshot.value.partners).toEqual([expect.objectContaining({ id: result.entityIds[1], accountId: result.entityIds[0] })]);
  });
});

describe('partnerRemoveType', () => {
  it('answers a conflict, writing nothing, when the file has a contact the screen didn’t show', async () => {
    const account = await partnerChange(addAcme);
    if (!account.ok || !account.entityId) throw new Error('setup');
    const section = await partnerChange(addSection(account.entityId));
    if (!section.ok || !section.entityId) throw new Error('setup');
    await partnerChange({ kind: 'add', entity: 'person', values: { accountId: account.entityId, name: 'Eva Roth' } });
    expect(await partnerRemoveType({ partnerId: section.entityId, expected: [section.entityId, account.entityId] }))
      .toEqual({ ok: false, error: 'conflict', message: COPY.SAVE_CONFLICT });
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    expect(read.ok && read.value.value.people).toHaveLength(1);
  });

  it('removes the last partner type with its company and contacts, in one write', async () => {
    const account = await partnerChange(addAcme);
    if (!account.ok || !account.entityId) throw new Error('setup');
    const section = await partnerChange(addSection(account.entityId));
    if (!section.ok || !section.entityId) throw new Error('setup');
    const person = await partnerChange({ kind: 'add', entity: 'person', values: { accountId: account.entityId, name: 'Eva Roth' } });
    if (!person.ok || !person.entityId) throw new Error('setup');
    const result = await partnerRemoveType({ partnerId: section.entityId, expected: [section.entityId, person.entityId, account.entityId] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entityIds).toHaveLength(3);
    expect(result.snapshot.value).toMatchObject({ accounts: [], partners: [], people: [] });
  });

  it('asks what happens to the partner type’s business cases, then removes them with it as chosen', async () => {
    const account = await partnerChange(addAcme);
    if (!account.ok || !account.entityId) throw new Error('setup');
    const reseller = await partnerChange(addSection(account.entityId));
    const technology = await partnerChange(addSection(account.entityId, 'technology'));
    if (!reseller.ok || !reseller.entityId || !technology.ok || !technology.entityId) throw new Error('setup');
    for (const partnerId of [reseller.entityId, reseller.entityId, technology.entityId]) {
      const made = await createCase(state.deps, anna, { companyId: COMPANY, partnerId });
      if (!made.ok) throw new Error(made.error);
    }
    const expected = [reseller.entityId];
    expect(await partnerRemoveType({ partnerId: reseller.entityId, expected }))
      .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { items: COPY.CASES_CHOOSE(2) } });
    expect(await partnerRemoveType({ partnerId: reseller.entityId, expected, items: 'trash' })).toMatchObject({ ok: true });
    const left = await listCases(state.deps, anna, { companyId: COMPANY });
    expect(left.ok && left.value.map((c) => c.partnerId)).toEqual([technology.entityId]);
  });

  it('refuses a company id or a list of changes in the input, and a signed-out visitor', async () => {
    expect(await partnerRemoveType({ partnerId: 'p_1', expected: ['p_1'], companyId: 'co_bbbbbbbbbb' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await partnerRemoveType({ partnerId: 'p_1', expected: ['p_1'], changes: [] })).toMatchObject({ ok: false, error: 'invalid' });
    expect(await partnerRemoveType({ partnerId: 'p_1' })).toMatchObject({ ok: false, error: 'invalid' });
    state.session = null;
    expect(await partnerRemoveType({ partnerId: 'p_1', expected: ['p_1'] })).toEqual(SIGNED_OUT);
  });
});

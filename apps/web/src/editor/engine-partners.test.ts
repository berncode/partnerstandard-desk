// The editor engine's behaviors on the Partner book, through the partners adapter.
import { applyPartnerChange, applyPartnerChanges, deleteSectionChanges, parsePartnerChange, type PartnerBook, type PartnerChange } from '@partner-desk/core';
import { anAccount, aPartner, call, person, qualification } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { partnersAdapter } from './adapters';
import { createEditorEngine, savedIdOf, saveStateOf } from './engine';
import type { RemoteBatchResult, RemoteResult } from './remote';
import type { PartnerBatch } from './remotes';

const WINDOW = 5000;
const T0 = '2026-10-18T14:00:00.000Z';
const T1 = '2026-10-21T10:05:00.000Z';
const T2 = '2026-10-21T10:06:00.000Z';
const ACTOR = 'Ruth';
type Batch = PartnerBatch;

/** Four companies, each with one section: two open, one closed, one to refuse a jump on; one person, call and qualification. */
function sampleBook(): PartnerBook {
  return {
    companyId: 'co_abcdefghij',
    accounts: [
      anAccount({ id: 'a_1', company: 'Acme GmbH', comments: 'Founder-led', updatedAt: T0 }),
      anAccount({ id: 'a_2', company: 'Beta AG', updatedAt: T0 }),
      anAccount({ id: 'a_3', company: 'Gamma KG', updatedAt: T0 }),
      anAccount({ id: 'a_4', company: 'Delta SE', updatedAt: T0 }),
    ],
    partners: [
      aPartner({ id: 'p_1', accountId: 'a_1', updatedAt: T0 }),
      aPartner({ id: 'p_2', accountId: 'a_2', step: 'discovery_call', updatedAt: T0 }),
      aPartner({ id: 'p_3', accountId: 'a_3', closed: 'no', closedReason: 'Competes with us', updatedAt: T0 }),
      aPartner({ id: 'p_4', accountId: 'a_4', updatedAt: T0 }),
    ],
    people: [person({ id: 'e_1', accountId: 'a_1', name: 'Eva Roth', updatedAt: T0 })],
    calls: [call({ id: 'k_1', partnerId: 'p_1', updatedAt: T0 })],
    qualifications: [qualification({ id: 'q_1', partnerId: 'p_1', updatedAt: T0 })],
    marketLinks: [],
    proposalItems: [],
  };
}
const snapshot = (value: PartnerBook = sampleBook()): Snapshot<PartnerBook> => ({ value, issues: [] });
/** Lets the engine's promise callbacks run; fake timers don't touch promises. */
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

/** What the server would answer: the change applied to `book` at `now`, with server ids. */
function serverApply(book: PartnerBook, change: PartnerChange, now: string): Extract<RemoteResult<PartnerBook>, { ok: true }> {
  const out = applyPartnerChange(book, change, { now, actor: ACTOR, newId: (entity) => `${entity}_srv` });
  if (!out.ok) throw new Error(out.message);
  return { ok: true, snapshot: snapshot(out.value), entityId: out.entityId };
}

function setup(initial = snapshot(), readOnlyMessage?: string) {
  const calls: Array<{ change: PartnerChange; resolve: (r: RemoteResult<PartnerBook>) => void; reject: (e: unknown) => void }> = [];
  const batches: Array<{ changes: PartnerChange[]; batch: Batch; resolve: (r: RemoteBatchResult<PartnerBook>) => void }> = [];
  const remote = {
    apply: vi.fn((change: PartnerChange) => new Promise<RemoteResult<PartnerBook>>((resolve, reject) => { calls.push({ change, resolve, reject }); })),
    applyMany: vi.fn((changes: PartnerChange[], batch: Batch) => new Promise<RemoteBatchResult<PartnerBook>>((resolve) => { batches.push({ changes, batch, resolve }); })),
  };
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const refresh = vi.fn();
  const engine = createEditorEngine<PartnerBook, PartnerChange, Batch>({
    initial, remote, notify, refresh, undoWindowMs: WINDOW, adapter: partnersAdapter, actor: ACTOR, ...(readOnlyMessage ? { readOnlyMessage } : {}),
  });
  return { engine, calls, batches, notify, refresh, view: () => engine.view() };
}

const p = (book: PartnerBook, id: string) => book.partners.find((x) => x.id === id)!;
const a = (book: PartnerBook, id: string) => book.accounts.find((x) => x.id === id)!;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('partners editor: optimistic apply', () => {
  it('shows a change at once, sends it with the row’s Updated as base, and takes the server snapshot as confirmed', async () => {
    const { engine, calls, view } = setup();
    expect(engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } }).ok).toBe(true);
    expect(a(view(), 'a_1')).toMatchObject({ company: 'Acme AG', updatedBy: ACTOR });
    expect(saveStateOf(engine.getState())).toBe('saving');
    await settle();
    expect(calls[0]!.change).toEqual({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' }, expectedUpdatedAt: T0 });
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    expect(a(engine.getState().confirmed.value, 'a_1')).toMatchObject({ company: 'Acme AG', updatedAt: T1 });
    expect(saveStateOf(engine.getState())).toBe('saved');
  });

  it('starts idle, before any change', () => {
    expect(saveStateOf(setup().engine.getState())).toBe('idle');
  });

  it('refuses a change core’s rules refuse, without sending it', async () => {
    const { engine, calls } = setup();
    expect(engine.dispatch({ kind: 'setStep', partnerId: 'p_4', to: 'map' })).toMatchObject({ ok: false, error: 'invalid', message: COPY.ONE_STEP });
    await settle();
    expect(calls).toHaveLength(0);
  });

  it('sends one change at a time, in order', async () => {
    const { engine, calls } = setup();
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'One' } });
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_2', patch: { whyItFits: 'Two' } });
    await settle();
    expect(calls).toHaveLength(1);
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.change).toMatchObject({ id: 'p_2', expectedUpdatedAt: T0 });
  });
});

describe('partners editor: a server conflict', () => {
  it('rolls the row’s changes back and offers a refresh', async () => {
    const { engine, calls, notify, refresh, view } = setup();
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } }, { label: 'Company renamed' });
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { comments: 'Call back' } });
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_2', patch: { comments: 'Unrelated' } });
    expect(a(view(), 'a_1')).toMatchObject({ company: 'Acme AG', comments: 'Call back' });
    await settle();

    calls[0]!.resolve({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    await settle();
    // The conflicted row's edits are dropped (they were made against a stale version); other rows' edits go on.
    expect(a(view(), 'a_1')).toMatchObject({ company: 'Acme GmbH', comments: 'Founder-led' });
    expect(a(view(), 'a_2').comments).toBe('Unrelated');
    expect(calls).toHaveLength(2);
    expect(calls[1]!.change).toMatchObject({ id: 'a_2' });
    expect(notify.dismissUndo).toHaveBeenCalledTimes(1);
    expect(notify.info).toHaveBeenCalledWith(COPY.SAVE_CONFLICT, { label: COPY.REFRESH, onClick: expect.any(Function) });
    expect(COPY.SAVE_CONFLICT).toBe('Updated elsewhere just now. Refresh?');
    (notify.info.mock.calls[0]![1] as { onClick: () => void }).onClick();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('drops a lifecycle change queued for the conflicted row too', async () => {
    const { engine, calls, view } = setup();
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Mine' } });
    engine.dispatch({ kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    await settle();
    expect(calls).toHaveLength(1);
    expect(p(view(), 'p_1').step).toBe('researched');
  });

  it('takes a refreshed snapshot as the confirmed book and keeps queued changes on top of it', async () => {
    const { engine, calls, view } = setup();
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_2', patch: { whyItFits: 'Mine' } });
    const theirs = sampleBook();
    theirs.accounts[0] = { ...theirs.accounts[0]!, company: 'Acme Holding', updatedAt: T1 };
    engine.refresh(snapshot(theirs));
    expect(a(view(), 'a_1').company).toBe('Acme Holding');
    expect(p(view(), 'p_2').whyItFits).toBe('Mine');
    await settle();
    expect(calls).toHaveLength(1);
  });
});

describe('partners editor: other failures', () => {
  for (const [error, message] of [['unavailable', COPY.UNAVAILABLE_MESSAGE], ['quota', COPY.QUOTA_MESSAGE]] as const) {
    it(`drops the change, says why and offers a retry when the answer is ${error}`, async () => {
      const { engine, calls, notify, view } = setup();
      engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } });
      await settle();
      calls[0]!.resolve({ ok: false, error, message });
      await settle();
      expect(a(view(), 'a_1').company).toBe('Acme GmbH');
      expect(saveStateOf(engine.getState())).toBe('error');
      expect(notify.error).toHaveBeenCalledWith(message, { label: COPY.RETRY, onClick: expect.any(Function) });
      (notify.error.mock.calls[0]![1] as { onClick: () => void }).onClick();
      expect(a(view(), 'a_1').company).toBe('Acme AG');
      await settle();
      expect(calls).toHaveLength(2);
    });
  }

  it('offers a retry when the network throws', async () => {
    const { engine, calls, notify, view } = setup();
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } });
    await settle();
    calls[0]!.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(a(view(), 'a_1').company).toBe('Acme GmbH');
    expect(notify.error).toHaveBeenCalledWith(COPY.SAVE_OFFLINE, { label: COPY.RETRY, onClick: expect.any(Function) });
    expect(COPY.SAVE_OFFLINE).toBe('Couldn’t save your change. Check your connection and try again.');
    (notify.error.mock.calls[0]![1] as { onClick: () => void }).onClick();
    await settle();
    expect(calls[1]!.change).toMatchObject({ patch: { company: 'Acme AG' }, expectedUpdatedAt: T0 });
  });

  it('offers no retry for a refusal that would be refused again', async () => {
    const { engine, calls, notify } = setup();
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'forbidden', message: COPY.FORBIDDEN });
    await settle();
    expect(notify.error).toHaveBeenCalledWith(COPY.FORBIDDEN);
  });

  it('says the read-only line in the words it was given: a company server’s "Sign in again" (plan 14)', async () => {
    const { engine, calls } = setup(snapshot(), 'Sign in again to keep editing.');
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
    await settle();
    expect(engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_2', patch: { whyItFits: 'x' } }))
      .toEqual({ ok: false, error: 'invalid', message: 'Sign in again to keep editing.' });
  });

  it('turns read-only when Google needs reconnecting (or the person is signed out), and drops what was queued', async () => {
    const { engine, calls, notify, view } = setup();
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } });
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_2', patch: { whyItFits: 'Later' } });
    engine.dispatch({ kind: 'delete', entity: 'person', id: 'e_1' }, { label: 'Person removed' });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'auth', message: COPY.SIGNED_OUT });
    await settle();
    expect(engine.getState().readOnly).toBe(true);
    expect(calls).toHaveLength(1);
    expect(p(view(), 'p_2').whyItFits).toBe('');
    expect(view().people.map((e) => e.id)).toEqual(['e_1']);
    expect(notify.error).toHaveBeenCalledWith(COPY.SIGNED_OUT);
    expect(notify.dismissUndo).toHaveBeenCalled();
    expect(engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_2', patch: { whyItFits: 'x' } }))
      .toEqual({ ok: false, error: 'invalid', message: COPY.SAVE_READ_ONLY });
    vi.advanceTimersByTime(WINDOW);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('drops edits of a new row whose add failed', async () => {
    const { engine, calls } = setup();
    const added = engine.dispatch({ kind: 'add', entity: 'person', values: { accountId: 'a_2', name: 'Lea' } });
    if (!added.ok) throw new Error('add refused');
    engine.dispatch({ kind: 'update', entity: 'person', id: added.entityId!, patch: { title: 'CEO' } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS });
    await settle();
    expect(calls).toHaveLength(1);
    expect(engine.getState().queue).toEqual([]);
  });
});

describe('partners editor: new rows and follow-up edits', () => {
  it('sends an edit made before the add was saved with the server’s id', async () => {
    const { engine, calls } = setup();
    const added = engine.dispatch({ kind: 'add', entity: 'person', values: { accountId: 'a_2', name: 'Lea' } });
    if (!added.ok) throw new Error('add refused');
    expect(added.entityId).toMatch(/^e_[0-9a-z]{6}$/);
    engine.dispatch({ kind: 'update', entity: 'person', id: added.entityId!, patch: { title: 'CEO' } });
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    expect(calls[1]!.change).toEqual({ kind: 'update', entity: 'person', id: 'person_srv', patch: { title: 'CEO' }, expectedUpdatedAt: T1 });
    expect(engine.getState().idMap).toEqual({ [added.entityId!]: 'person_srv' });
  });

  it('sends a lifecycle change on a new partner with the server’s id', async () => {
    const { engine, calls } = setup();
    const added = engine.dispatch({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'referral' } });
    if (!added.ok) throw new Error('add refused');
    engine.dispatch({ kind: 'setStep', partnerId: added.entityId!, to: 'discovery_call' });
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    expect(calls[1]!.change).toEqual({ kind: 'setStep', partnerId: 'partner_srv', to: 'discovery_call' });
  });

  it('moves queued edits of a row onto the version its own earlier save produced', async () => {
    const { engine, calls } = setup();
    engine.dispatch({ kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' });
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Booked the call' } });
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    expect(calls[1]!.change).toMatchObject({ expectedUpdatedAt: T1 });
  });
});

describe('partners editor: undo', () => {
  it('undoes the last labeled change with its inverse', async () => {
    const { engine, calls, notify, view } = setup();
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } }, { label: 'Company renamed' });
    expect(notify.undo).toHaveBeenCalledWith('Company renamed', expect.any(Function));
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    engine.undo();
    expect(a(view(), 'a_1').company).toBe('Acme GmbH');
    await settle();
    expect(calls[1]!.change).toEqual({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme GmbH' }, expectedUpdatedAt: T1 });
    // One undo per change: a second press does nothing.
    engine.undo();
    await settle();
    expect(calls).toHaveLength(2);
  });

  it('undoes a step move by moving back', async () => {
    const { engine, calls, view } = setup();
    engine.dispatch({ kind: 'setStep', partnerId: 'p_2', to: 'qualification' }, { label: 'Step changed' });
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    engine.undo();
    expect(p(view(), 'p_2').step).toBe('discovery_call');
    await settle();
    expect(calls[1]!.change).toEqual({ kind: 'setStep', partnerId: 'p_2', to: 'discovery_call' });
  });

  it('offers one undo for a labeled batch and takes back the partner and its market link', async () => {
    const { engine, batches, calls, notify, view } = setup();
    const added = [
      { kind: 'add', entity: 'partner', values: { id: 'p_tmp', accountId: 'a_1', partnerType: 'referral' } },
      { kind: 'add', entity: 'marketLink', values: { id: 'l_tmp', partnerId: 'p_tmp', marketId: 'm_abcdefghij', hypothesisId: null } },
    ] satisfies PartnerChange[];
    const outcome = engine.dispatchMany(added, { marketId: 'm_abcdefghij' }, { label: 'Partner added' });
    expect(outcome.ok).toBe(true);
    expect(notify.undo).toHaveBeenCalledTimes(1);
    expect(notify.undo).toHaveBeenCalledWith('Partner added', expect.any(Function));
    await settle();
    const saved = applyPartnerChanges(sampleBook(), added, { now: T1, actor: ACTOR, newId: (entity) => `${entity}_srv` });
    if (!saved.ok) throw new Error(saved.message);
    batches[0]!.resolve({ ok: true, snapshot: snapshot(saved.value), entityIds: ['partner_srv', 'marketLink_srv'] });
    await settle();
    engine.undo();
    expect(view().marketLinks).toEqual([]);
    await settle();
    expect(calls.map((c) => c.change)).toEqual([expect.objectContaining({ kind: 'delete', entity: 'marketLink', id: 'marketLink_srv' })]);
    // The partner goes only once the link's delete is saved.
    calls[0]!.resolve(serverApply(saved.value, calls[0]!.change, T2));
    await settle();
    expect(calls.map((c) => c.change)).toEqual([
      expect.objectContaining({ kind: 'delete', entity: 'marketLink', id: 'marketLink_srv' }),
      expect.objectContaining({ kind: 'delete', entity: 'partner', id: 'partner_srv' }),
    ]);
    expect(view().partners.map((x) => x.partnerType)).not.toContain('referral');
  });

  it('sends no partner delete when the link delete fails', async () => {
    const { engine, batches, calls } = setup();
    const added = [
      { kind: 'add', entity: 'partner', values: { id: 'p_tmp', accountId: 'a_1', partnerType: 'referral' } },
      { kind: 'add', entity: 'marketLink', values: { id: 'l_tmp', partnerId: 'p_tmp', marketId: 'm_abcdefghij', hypothesisId: null } },
    ] satisfies PartnerChange[];
    engine.dispatchMany(added, { marketId: 'm_abcdefghij' }, { label: 'Partner added' });
    await settle();
    const saved = applyPartnerChanges(sampleBook(), added, { now: T1, actor: ACTOR, newId: (entity) => `${entity}_srv` });
    if (!saved.ok) throw new Error(saved.message);
    batches[0]!.resolve({ ok: true, snapshot: snapshot(saved.value), entityIds: ['partner_srv', 'marketLink_srv'] });
    await settle();
    engine.undo();
    await settle();
    calls[0]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('offers no undo for a batch without a label', () => {
    const { engine, notify } = setup();
    engine.dispatchMany([{ kind: 'add', entity: 'partner', values: { id: 'p_tmp', accountId: 'a_1', partnerType: 'referral' } }], { marketId: 'm_abcdefghij' });
    expect(notify.undo).not.toHaveBeenCalled();
  });

  it('holds a delete back for 5 seconds; undo cancels it and nothing is sent', async () => {
    const { engine, calls, view, notify } = setup();
    engine.dispatch({ kind: 'delete', entity: 'person', id: 'e_1' }, { label: 'Person removed' });
    expect(view().people).toEqual([]);
    expect(notify.undo).toHaveBeenCalledWith('Person removed', expect.any(Function));
    engine.undo();
    expect(view().people.map((e) => e.id)).toEqual(['e_1']);
    vi.advanceTimersByTime(WINDOW * 2);
    await settle();
    expect(calls).toHaveLength(0);
  });

  it('labels an unlabeled delete "Deleted"', () => {
    const { engine, notify } = setup();
    engine.dispatch({ kind: 'delete', entity: 'call', id: 'k_1' });
    expect(notify.undo).toHaveBeenCalledWith(COPY.DELETED, expect.any(Function));
  });

  it('sends a held-back delete when its window ends, then says it is too late to undo', async () => {
    const { engine, calls, notify } = setup();
    engine.dispatch({ kind: 'delete', entity: 'person', id: 'e_1' }, { label: 'Person removed' });
    vi.advanceTimersByTime(WINDOW - 1);
    await settle();
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await settle();
    expect(calls.map((c) => c.change)).toEqual([{ kind: 'delete', entity: 'person', id: 'e_1' }]);
    (notify.undo.mock.calls[0]![1] as () => void)();
    expect(notify.info).toHaveBeenCalledWith(COPY.UNDO_TOO_LATE);
  });

  it('sends held-back deletes at once on releaseAll (leaving the page)', async () => {
    const { engine, calls } = setup();
    engine.dispatch({ kind: 'delete', entity: 'person', id: 'e_1' });
    engine.releaseAll();
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('offers no undo for a change whose inverse would be refused, nor for an exit', () => {
    const book = sampleBook();
    book.partners[0] = { ...book.partners[0]!, stage: 'growth', step: null, signedDate: '2026-09-01' };
    book.partners[2] = { ...book.partners[2]!, closedReason: '' };
    const { engine, notify } = setup(snapshot(book));
    engine.dispatch({ kind: 'reopen', partnerId: 'p_3' }, { label: 'Reopened' });
    engine.dispatch({ kind: 'markExited', partnerId: 'p_1', exitedDate: '2026-10-21', reason: 'Done' }, { label: 'Exited' });
    expect(notify.undo).not.toHaveBeenCalled();
  });

  it('undoes a signing by taking the signature back', async () => {
    const { engine, calls, notify } = setup();
    engine.dispatch({ kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-10-21' }, { label: 'Signed' });
    expect(notify.undo).toHaveBeenCalledWith('Signed', expect.any(Function));
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    engine.undo();
    await settle();
    expect(calls[1]!.change).toEqual({ kind: 'undoSigned', partnerId: 'p_1' });
  });

  it('signs again with the old date when that signing is undone', async () => {
    const book = sampleBook();
    book.partners[0] = { ...book.partners[0]!, stage: 'growth', step: null, signedDate: '2026-09-01' };
    const { engine, calls } = setup(snapshot(book));
    expect(engine.dispatch({ kind: 'undoSigned', partnerId: 'p_1' }, { label: 'Signing undone' }).ok).toBe(true);
    await settle();
    calls[0]!.resolve(serverApply(book, calls[0]!.change, T1));
    await settle();
    engine.undo();
    await settle();
    expect(calls[1]!.change).toEqual({ kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-09-01' });
    const undone = calls[0]!.change;
    const unsigned = applyPartnerChange(book, undone, { now: T1, actor: ACTOR });
    if (!unsigned.ok) throw new Error(unsigned.message);
    calls[1]!.resolve(serverApply(unsigned.value, calls[1]!.change, T2));
    await settle();
    expect(calls[2]!.change).toEqual({ kind: 'setStage', partnerId: 'p_1', to: 'growth' });
  });

  it('brings back the account, then its person, then the signed section, after the last section is deleted', async () => {
    const book = sampleBook();
    book.partners[0] = { ...book.partners[0]!, stage: 'growth', step: null, signedDate: '2026-09-01' };
    const changes = deleteSectionChanges(book, 'p_1');
    expect(changes).toEqual([
      { kind: 'delete', entity: 'partner', id: 'p_1' },
      { kind: 'delete', entity: 'person', id: 'e_1' },
      { kind: 'delete', entity: 'account', id: 'a_1' },
    ]);
    const { engine, batches, calls, notify, view } = setup(snapshot(book));
    expect(engine.dispatchMany(changes, { remove: true }, { label: 'Partner removed' }).ok).toBe(true);
    expect(batches).toHaveLength(0);
    expect(notify.undo).toHaveBeenCalledWith('Partner removed', expect.any(Function));
    await settle();
    expect(batches).toHaveLength(1);
    expect(batches[0]!.batch).toEqual({ remove: true });
    const saved = applyPartnerChanges(book, changes, { now: T1, actor: ACTOR, newId: (entity) => `${entity}_srv` });
    if (!saved.ok) throw new Error(saved.message);
    batches[0]!.resolve({ ok: true, snapshot: snapshot(saved.value), entityIds: saved.entityIds });
    await settle();
    engine.undo();
    await settle();

    const sent = () => calls.map((c) => c.change);
    expect(sent()[0]).toMatchObject({ kind: 'add', entity: 'account', values: expect.objectContaining({ id: 'a_1', company: 'Acme GmbH' }) });
    let current = saved.value;
    for (const call of calls) {
      const parsed = parsePartnerChange(call.change);
      if (!parsed.ok) throw new Error(`parser rejected ${call.change.kind}`);
      const out = applyPartnerChange(current, parsed.change, { now: T2, actor: ACTOR });
      if (!out.ok) throw new Error(out.message);
      call.resolve({ ok: true, snapshot: snapshot(out.value), entityId: out.entityId });
      current = out.value;
      await settle();
    }
    expect(sent().map((c) => (c.kind === 'add' ? c.entity : c.kind))).toEqual(['account', 'person', 'partner', 'markSigned', 'setStage']);
    expect(sent()[1]).toMatchObject({ kind: 'add', entity: 'person', values: expect.objectContaining({ id: 'e_1', accountId: 'a_1', name: 'Eva Roth' }) });
    expect(sent()[2]).toMatchObject({ kind: 'add', entity: 'partner', values: expect.objectContaining({ id: 'p_1', accountId: 'a_1', partnerType: 'reseller' }) });
    expect(sent()[3]).toEqual({ kind: 'markSigned', partnerId: 'p_1', signedDate: '2026-09-01' });
    expect(sent()[4]).toEqual({ kind: 'setStage', partnerId: 'p_1', to: 'growth' });
    for (const change of sent()) {
      if (change.kind !== 'add') continue;
      expect(change.values).not.toHaveProperty('updatedAt');
      expect(change.values).not.toHaveProperty('updatedBy');
    }
    expect(current.accounts.find((row) => row.id === 'a_1')?.company).toBe('Acme GmbH');
    expect(current.people.find((row) => row.id === 'e_1')).toMatchObject({ accountId: 'a_1', name: 'Eva Roth' });
    expect(current.partners.find((row) => row.id === 'p_1')).toMatchObject({
      accountId: 'a_1', stage: 'growth', signedDate: '2026-09-01', partnerType: 'reseller',
    });
    expect(current.calls.find((row) => row.id === 'k_1')?.partnerId).toBe('p_1');
    expect(view().partners.find((row) => row.id === 'p_1')).toMatchObject({ stage: 'growth', signedDate: '2026-09-01' });
  });
});

describe('partners editor: a batch undo that would no longer apply', () => {
  it('sends nothing when the company it would bring back is there again, and says the undo can’t be done', async () => {
    const book = sampleBook();
    const changes = deleteSectionChanges(book, 'p_1');
    const { engine, batches, calls, notify } = setup(snapshot(book));
    expect(engine.dispatchMany(changes, { remove: true }, { label: 'Partner removed' }).ok).toBe(true);
    await settle();
    const saved = applyPartnerChanges(book, changes, { now: T1, actor: ACTOR, newId: (entity) => `${entity}_srv` });
    if (!saved.ok) throw new Error(saved.message);
    batches[0]!.resolve({ ok: true, snapshot: snapshot(saved.value), entityIds: saved.entityIds });
    await settle();
    // Someone added the same company back meanwhile (another tab): restoring a_1 would be refused.
    const again = applyPartnerChange(saved.value, { kind: 'add', entity: 'account', values: { id: 'a_1', company: 'Acme GmbH' } }, { now: T2, actor: ACTOR });
    if (!again.ok) throw new Error(again.message);
    engine.refresh(snapshot(again.value));
    engine.undo();
    await settle();
    expect(calls).toHaveLength(0);
    expect(notify.info).toHaveBeenCalledWith(COPY.UNDO_NOT_POSSIBLE);
  });
});

describe('partners editor: apply', () => {
  it('resolves once the change is saved', async () => {
    const { engine, calls } = setup();
    let done = false;
    void engine.apply({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } }).then(() => { done = true; });
    await settle();
    expect(done).toBe(false);
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T2));
    await settle();
    expect(done).toBe(true);
  });

  it('resolves at once, with an error toast, when the change is refused locally', async () => {
    const { engine, notify } = setup();
    expect(await engine.apply({ kind: 'setStep', partnerId: 'p_4', to: 'map' })).toEqual({ ok: false, message: COPY.ONE_STEP });
    expect(notify.error).toHaveBeenCalledWith(COPY.ONE_STEP);
  });

  it('resolves with the id the server gave a new row', async () => {
    const { engine, calls } = setup();
    const result = engine.apply({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'referral' } });
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T2));
    expect(await result).toEqual({ ok: true, entityId: 'partner_srv' });
  });

  it('resolves as not saved when the server refuses the change, or it is dropped with it', async () => {
    const { engine, calls } = setup();
    const add = engine.apply({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'referral' } });
    const localId = engine.getState().queue[0]!.localId!;
    const follow = engine.apply({ kind: 'add', entity: 'qualification', values: { partnerId: localId } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS });
    expect(await add).toEqual({ ok: false, message: COPY.FIX_FIELDS });
    expect(await follow).toEqual({ ok: false });
  });
});

describe('partners editor: an add with no clear answer', () => {
  const add: PartnerChange = { kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'referral' } };
  const refreshOffer = { label: COPY.REFRESH, onClick: expect.any(Function) };

  it('offers Refresh, not Retry, when Google isn’t answering, and never sends the add again', async () => {
    const { engine, calls, notify, refresh, view } = setup();
    const result = engine.apply(add);
    await settle();
    calls[0]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    expect(await result).toEqual({ ok: false, unknown: true });
    expect(view().partners.map((x) => x.partnerType)).not.toContain('referral');
    expect(notify.error).toHaveBeenCalledWith(COPY.SAVE_ADD_UNKNOWN, refreshOffer);
    (notify.error.mock.calls[0]![1] as { onClick: () => void }).onClick();
    expect(refresh).toHaveBeenCalledTimes(1);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('offers Refresh when the call fails with no answer at all', async () => {
    const { engine, calls, notify } = setup();
    const result = engine.apply(add);
    await settle();
    calls[0]!.reject(new TypeError('Failed to fetch'));
    expect(await result).toEqual({ ok: false, unknown: true });
    expect(notify.error).toHaveBeenCalledWith(COPY.SAVE_ADD_UNKNOWN, refreshOffer);
  });

  it('offers Refresh for a batch that adds, and its outcome says it is unknown', async () => {
    const { engine, batches, notify, refresh } = setup();
    const result = engine.applyMany([
      { kind: 'add', entity: 'partner', values: { id: 'p_tmp', accountId: 'a_1', partnerType: 'referral' } },
      { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_tmp', marketId: 'm_abcdefghij' } },
    ], { marketId: 'm_abcdefghij' });
    await settle();
    batches[0]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    expect(await result).toEqual({ ok: false, message: COPY.UNAVAILABLE_MESSAGE, unknown: true });
    expect(notify.error).toHaveBeenCalledWith(COPY.SAVE_ADD_UNKNOWN, refreshOffer);
    (notify.error.mock.calls[0]![1] as { onClick: () => void }).onClick();
    expect(refresh).toHaveBeenCalledTimes(1);
    await settle();
    expect(batches).toHaveLength(1);
  });

  it('keeps Retry for an unclear add of anything but a partner, and Retry sends the same notes again', async () => {
    const { engine, calls, notify, view } = setup();
    const notes: PartnerChange = {
      kind: 'add', entity: 'call',
      values: { partnerId: 'p_1', date: '2026-10-21', kind: 'discovery', topics: { customerPains: 'Manual invoices' }, notes: 'Call back in May' },
    };
    const result = engine.apply(notes);
    await settle();
    calls[0]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    expect(await result).toEqual({ ok: false, unknown: true });
    expect(notify.error).toHaveBeenCalledWith(COPY.UNAVAILABLE_MESSAGE, { label: COPY.RETRY, onClick: expect.any(Function) });
    (notify.error.mock.calls[0]![1] as { onClick: () => void }).onClick();
    expect(view().calls.map((c) => c.notes)).toContain('Call back in May');
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.change).toEqual(calls[0]!.change);

    // A thrown call keeps Retry too.
    calls[1]!.reject(new TypeError('Failed to fetch'));
    await settle();
    expect(notify.error).toHaveBeenLastCalledWith(COPY.SAVE_OFFLINE, { label: COPY.RETRY, onClick: expect.any(Function) });
  });

  it('keeps Retry for an add Google refused for too many requests: nothing was written', async () => {
    const { engine, calls, notify } = setup();
    const result = engine.apply(add);
    await settle();
    calls[0]!.resolve({ ok: false, error: 'quota', message: COPY.QUOTA_MESSAGE });
    expect(await result).toEqual({ ok: false, message: COPY.QUOTA_MESSAGE });
    expect(notify.error).toHaveBeenCalledWith(COPY.QUOTA_MESSAGE, { label: COPY.RETRY, onClick: expect.any(Function) });
  });
});

describe('partners editor: imports as one batch', () => {
  const batch: PartnerChange[] = [
    { kind: 'add', entity: 'partner', values: { id: 'p_tmp1', accountId: 'a_1', partnerType: 'referral' } },
    { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_tmp1', marketId: 'm_abcdefghij' } },
    { kind: 'add', entity: 'partner', values: { id: 'p_tmp2', accountId: 'a_2', partnerType: 'managed' } },
  ];
  const into: Batch = { marketId: 'm_abcdefghij' };

  /** What the server would answer: the batch applied to `book` at `now`, with server ids. */
  function serverApplyMany(book: PartnerBook, changes: PartnerChange[], now: string): RemoteBatchResult<PartnerBook> {
    let n = 0;
    const out = applyPartnerChanges(book, changes, { now, actor: ACTOR, newId: (entity) => `${entity}_srv${++n}` });
    if (!out.ok) throw new Error(out.message);
    return { ok: true, snapshot: snapshot(out.value), entityIds: out.entityIds };
  }

  it('shows the whole batch at once, sends it in one call with its market, and maps its rows to their server ids', async () => {
    const { engine, calls, batches, view } = setup();
    const result = engine.applyMany(batch, into);
    expect(view().partners.slice(-2).map((x) => [x.id, x.accountId, x.partnerType])).toEqual([['p_tmp1', 'a_1', 'referral'], ['p_tmp2', 'a_2', 'managed']]);
    expect(view().marketLinks.at(-1)?.partnerId).toBe('p_tmp1');
    expect(saveStateOf(engine.getState())).toBe('saving');
    // An edit of an imported row before the batch is saved goes out under the row's server id.
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_tmp2', patch: { whyItFits: 'Call first' } });
    await settle();
    const link = batch[1] as Extract<PartnerChange, { kind: 'add' }>;
    expect(batches.map((b) => [b.changes, b.batch])).toEqual([[[batch[0], { ...link, values: { id: expect.any(String), ...link.values } }, batch[2]], into]]);
    expect(calls).toHaveLength(0);
    batches[0]!.resolve(serverApplyMany(sampleBook(), batch, T1));
    expect(await result).toEqual({ ok: true, entityIds: ['partner_srv1', 'marketLink_srv2', 'partner_srv3'] });
    await settle();
    expect(engine.getState().idMap).toMatchObject({ p_tmp1: 'partner_srv1', p_tmp2: 'partner_srv3' });
    expect(calls[0]!.change).toEqual({ kind: 'update', entity: 'partner', id: 'partner_srv3', patch: { whyItFits: 'Call first' }, expectedUpdatedAt: T1 });
  });

  it('rolls the whole batch back, with edits of its rows, when the server refuses it', async () => {
    const { engine, calls, batches, notify, view } = setup();
    const before = view();
    const result = engine.applyMany(batch, into);
    engine.dispatch({ kind: 'update', entity: 'partner', id: 'p_tmp2', patch: { whyItFits: 'Call first' } });
    await settle();
    batches[0]!.resolve({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, valid: 2 });
    expect(await result).toEqual({ ok: false, valid: 2, message: COPY.FIX_FIELDS });
    await settle();
    expect(view()).toEqual(before);
    expect(engine.getState().queue).toEqual([]);
    expect(calls).toHaveLength(0);
    expect(notify.error).toHaveBeenCalledWith(COPY.FIX_FIELDS);
  });

  it('offers a retry of the whole batch, with its market, when Google refused it for too many requests', async () => {
    const { engine, batches, notify } = setup();
    void engine.applyMany(batch, into);
    await settle();
    batches[0]!.resolve({ ok: false, error: 'quota', message: COPY.QUOTA_MESSAGE });
    await settle();
    (notify.error.mock.calls[0]![1] as { onClick: () => void }).onClick();
    await settle();
    expect(batches).toHaveLength(2);
    expect(batches[1]!.batch).toEqual(into);
    expect(batches[1]!.changes.map((c) => (c as { values: { id?: string } }).values.id)).toEqual(batches[0]!.changes.map((c) => (c as { values: { id?: string } }).values.id));
  });

  it('gives an add without a provisional id one, so its row keeps its local id until saved', async () => {
    const { engine, batches, view } = setup();
    void engine.applyMany([{ kind: 'add', entity: 'person', values: { accountId: 'a_2', name: 'Psi' } }], into);
    const local = view().people.at(-1)!.id;
    expect(engine.view().people.at(-1)!.id).toBe(local);
    await settle();
    expect(batches[0]!.changes).toEqual([{ kind: 'add', entity: 'person', values: { id: local, accountId: 'a_2', name: 'Psi' } }]);
  });

  it('refuses a batch core refuses, sending and showing nothing', async () => {
    const { engine, batches, notify, view } = setup();
    const before = view();
    expect(await engine.applyMany([batch[0]!, { kind: 'add', entity: 'account', values: { company: ' ' } }], into))
      .toEqual({ ok: false, valid: 1, message: COPY.FIX_FIELDS });
    await settle();
    expect(batches).toHaveLength(0);
    expect(view()).toEqual(before);
    expect(notify.error).toHaveBeenCalledWith(COPY.FIX_FIELDS);
  });

  it('refuses a batch while read-only', async () => {
    const { engine, calls, batches, notify } = setup();
    engine.dispatch({ kind: 'update', entity: 'account', id: 'a_1', patch: { company: 'Acme AG' } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    await settle();
    expect(await engine.applyMany(batch, into)).toEqual({ ok: false, valid: 0, message: COPY.SAVE_READ_ONLY });
    expect(notify.error).toHaveBeenLastCalledWith(COPY.SAVE_READ_ONLY);
    expect(batches).toHaveLength(0);
  });
});

describe('partners editor: the id a link may use', () => {
  it('has none for a row whose add isn’t saved yet, and the server’s id once it is', async () => {
    const { engine, calls, batches } = setup();
    expect(savedIdOf(engine.getState(), 'p_1')).toBe('p_1');
    engine.dispatch({ kind: 'add', entity: 'partner', values: { accountId: 'a_1', partnerType: 'referral' } });
    const local = engine.getState().queue[0]!.localId!;
    void engine.applyMany([{ kind: 'add', entity: 'partner', values: { id: 'p_tmp', accountId: 'a_2', partnerType: 'managed' } }], { marketId: 'm_abcdefghij' });
    expect(savedIdOf(engine.getState(), local)).toBeNull();
    expect(savedIdOf(engine.getState(), 'p_tmp')).toBeNull();
    await settle();
    calls[0]!.resolve(serverApply(sampleBook(), calls[0]!.change, T1));
    await settle();
    expect(savedIdOf(engine.getState(), local)).toBe('partner_srv');
    batches[0]!.resolve({ ok: true, snapshot: snapshot(), entityIds: ['p_saved'] });
    await settle();
    expect(savedIdOf(engine.getState(), 'p_tmp')).toBe('p_saved');
  });
});

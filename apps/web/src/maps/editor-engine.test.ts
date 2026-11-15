import type { MapActor, MapChange, MapPlan } from '@partner-desk/core';
import { makeActivity, makeMapPlan, makeRecord, MAP_NOW as NOW, MAP_TODAY as TODAY } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { viewOf } from './editor';
import { createEditorEngine } from './editor-engine';
import type { MapSnapshot, RemoteResult } from './remote';

const T1 = '2026-10-16T10:05:00.000Z';
const WINDOW = 5000;
const owner: MapActor = { kind: 'owner' };
const record = makeRecord();
const snapshot = (activities = [makeActivity({ id: 'a_1', updatedAt: NOW })], plan: Partial<MapPlan> = {}): MapSnapshot =>
  ({ value: makeMapPlan({ activities, ...plan }), issues: [], record, startedOn: '2026-10-01', lastProgressAt: NOW });
/** Lets the engine's promise callbacks run; fake timers don't touch promises. */
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function setup(initial = snapshot(), actor: MapActor = owner, showsReconnect = false) {
  const calls: Array<{ change: MapChange; resolve: (r: RemoteResult) => void }> = [];
  const remote = vi.fn((change: MapChange) => new Promise<RemoteResult>((resolve) => { calls.push({ change, resolve }); }));
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const engine = createEditorEngine({ initial, remote, notify, actor, actorName: 'Anna Keller', undoWindowMs: WINDOW, showsReconnect });
  return { engine, calls, notify };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('editor engine: the conflict prompt', () => {
  it('shows the latest version and says so when an activity changed since it was read', async () => {
    const { engine, calls, notify } = setup();
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'in_progress' } }, { label: 'Marked in progress' });
    await settle();
    expect(calls[0]!.change).toEqual({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'in_progress' }, expectedUpdatedAt: NOW, expected: { status: 'not_started' } });
    const theirs = snapshot([makeActivity({ id: 'a_1', status: 'blocked', updatedAt: T1, updatedBy: 'Lena Ortiz' })]);
    calls[0]!.resolve({ ok: false, error: 'conflict', message: 'Updated by Lena Ortiz since you opened it', snapshot: theirs });
    await settle();
    expect(notify.info).toHaveBeenCalledWith('Updated by Lena Ortiz since you opened it. You’re now seeing the latest version.');
    expect(notify.dismissUndo).toHaveBeenCalled();
    expect(viewOf(engine.getState(), 'Anna Keller').activities.map((a) => [a.id, a.status])).toEqual([['a_1', 'blocked']]);
  });

  it('offers Retry for a failure a retry can help with, and not for a refusal', async () => {
    const { engine, calls, notify } = setup();
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { note: 'x' } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'unavailable', message: 'Google isn’t answering.' });
    await settle();
    expect(notify.error).toHaveBeenLastCalledWith('Google isn’t answering.', expect.any(Function));
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { note: 'y' } });
    await settle();
    calls[1]!.resolve({ ok: false, error: 'forbidden', message: 'Not yours.' });
    await settle();
    expect(notify.error).toHaveBeenLastCalledWith('Not yours.');
  });

  it('says the connection failed when the server action itself throws', async () => {
    const remote = vi.fn(async () => { throw new Error('offline'); });
    const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
    const engine = createEditorEngine({ initial: snapshot(), remote, notify, actor: owner, actorName: 'Anna Keller', undoWindowMs: WINDOW });
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { note: 'x' } });
    await settle();
    expect(notify.error).toHaveBeenCalledWith('Couldn’t save your change. Check your connection and try again.', expect.any(Function));
    expect(engine.getState().lastSave).toBe('failed');
  });
});

describe('editor engine: a save that needs Google again (question 16)', () => {
  const AUTH: RemoteResult = { ok: false, error: 'auth', message: COPY.AUTH_MESSAGE };

  it('an owner’s save answered auth shows no toast and needs Google, on a page with the banner', async () => {
    const { engine, calls, notify } = setup(snapshot(), owner, true);
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }, { label: 'Marked done' });
    await settle();
    calls[0]!.resolve(AUTH);
    await settle();
    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.info).not.toHaveBeenCalled();
    expect(notify.dismissUndo).toHaveBeenCalled();
    expect(engine.getState().needsGoogle).toBe(true);
    expect(engine.getState().lastSave).toBe('failed');
  });

  it('an owner’s auth failure drops the queue and the held deletes', async () => {
    const { engine, calls, notify } = setup(snapshot([makeActivity({ id: 'a_1', updatedAt: NOW }), makeActivity({ id: 'a_2', updatedAt: NOW })]), owner, true);
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } });
    engine.dispatch({ kind: 'delete', entity: 'activity', id: 'a_2' }, { label: 'Activity deleted' });
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { note: 'later' } });
    await settle();
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    calls[0]!.resolve(AUTH);
    await settle();
    expect(engine.getState().queue).toEqual([]);
    expect(engine.getState().deferred).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(notify.dismissUndo).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WINDOW * 2);
    await settle();
    expect(calls).toHaveLength(1);
    expect(viewOf(engine.getState(), 'Anna Keller').activities.map((a) => a.id)).toEqual(['a_1', 'a_2']);
  });

  it('says the read-only line in the words it was given: a company server’s "Sign in again" (plan 14)', async () => {
    const calls: Array<{ resolve: (r: RemoteResult) => void }> = [];
    const remote = vi.fn(() => new Promise<RemoteResult>((resolve) => { calls.push({ resolve }); }));
    const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
    const engine = createEditorEngine({
      initial: snapshot(), remote, notify, actor: owner, actorName: 'Anna Keller', undoWindowMs: WINDOW, showsReconnect: true,
      readOnlyMessage: 'Sign in again to keep editing.',
    });
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } });
    await settle();
    calls[0]!.resolve(AUTH);
    await settle();
    expect(engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { note: 'x' } }))
      .toEqual({ ok: false, error: 'invalid', message: 'Sign in again to keep editing.' });
  });

  it('after it, a change is refused and nothing is sent', async () => {
    const { engine, calls, notify } = setup(snapshot(), owner, true);
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } });
    await settle();
    calls[0]!.resolve(AUTH);
    await settle();

    const outcome = engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { note: 'x' } }, { label: 'Note changed' });
    expect(outcome).toEqual({ ok: false, error: 'invalid', message: COPY.SAVE_READ_ONLY });
    expect(engine.dispatch({ kind: 'delete', entity: 'activity', id: 'a_1' }, { label: 'Activity deleted' }).ok).toBe(false);
    await settle();
    vi.advanceTimersByTime(WINDOW * 2);
    await settle();
    expect(calls).toHaveLength(1);
    expect(notify.undo).not.toHaveBeenCalled();
    expect(engine.getState().queue).toEqual([]);
    expect(engine.getState().deferred).toEqual([]);
  });

  it('an owner page without the banner keeps the message, without Retry, and still stops saving', async () => {
    const { engine, calls, notify } = setup(snapshot([makeActivity({ id: 'a_1', updatedAt: NOW }), makeActivity({ id: 'a_2', updatedAt: NOW })]));
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } });
    engine.dispatch({ kind: 'delete', entity: 'activity', id: 'a_2' }, { label: 'Activity deleted' });
    await settle();
    calls[0]!.resolve(AUTH);
    await settle();
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith(COPY.AUTH_MESSAGE);
    expect(engine.getState().needsGoogle).toBe(true);
    expect(engine.getState().deferred).toEqual([]);
    expect(engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { note: 'x' } }).ok).toBe(false);
    vi.advanceTimersByTime(WINDOW * 2);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('a link holder’s auth failure still shows its message without Retry', async () => {
    const link: MapActor = { kind: 'link', personId: 'p_1', side: 'partner', name: 'Lena' };
    const { engine, calls, notify } = setup(snapshot([makeActivity({ id: 'a_1', side: 'partner', updatedAt: NOW })]), link);
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'auth', message: 'Your link has ended.' });
    await settle();
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.error).toHaveBeenCalledWith('Your link has ended.');
    expect(engine.getState().needsGoogle).toBe(false);
  });
});

describe('editor engine: held-back deletes dropped by a failure', () => {
  it('clears the timer of a delete that depended on a failed add, withdraws its undo and never sends it', async () => {
    const { engine, calls, notify } = setup();
    const added = engine.dispatch({ kind: 'add', entity: 'activity', values: { title: 'Call' } });
    if (!added.ok) throw new Error('add refused');
    const localId = added.plan.activities.find((a) => a.title === 'Call')!.id;
    engine.dispatch({ kind: 'delete', entity: 'activity', id: localId }, { label: 'Activity deleted' });
    await settle();
    expect(calls).toHaveLength(1);
    expect(vi.getTimerCount()).toBe(1);

    calls[0]!.resolve({ ok: false, error: 'unavailable', message: 'Google isn’t answering.' });
    await settle();
    expect(engine.getState().deferred).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    expect(notify.dismissUndo).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(WINDOW * 2);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('keeps a held-back delete of another activity through a conflict, and sends it when its window ends', async () => {
    const { engine, calls } = setup(snapshot([makeActivity({ id: 'a_1', updatedAt: NOW }), makeActivity({ id: 'a_2', updatedAt: NOW })]));
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } });
    engine.dispatch({ kind: 'delete', entity: 'activity', id: 'a_2' }, { label: 'Activity deleted' });
    await settle();
    calls[0]!.resolve({ ok: false, error: 'conflict', message: 'Updated', snapshot: snapshot([makeActivity({ id: 'a_1', updatedAt: T1 }), makeActivity({ id: 'a_2', updatedAt: NOW })]) });
    await settle();
    expect(engine.getState().deferred.map((i) => i.change)).toEqual([{ kind: 'delete', entity: 'activity', id: 'a_2' }]);

    vi.advanceTimersByTime(WINDOW);
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.change).toEqual({ kind: 'delete', entity: 'activity', id: 'a_2' });
  });

  it('cancels a held-back delete with Undo, and says it is too late once it was sent', async () => {
    const { engine, calls, notify } = setup();
    engine.dispatch({ kind: 'delete', entity: 'activity', id: 'a_1' }, { label: 'Activity deleted' });
    (notify.undo.mock.calls[0]![1] as () => void)();
    expect(engine.getState().deferred).toEqual([]);
    engine.dispatch({ kind: 'delete', entity: 'activity', id: 'a_1' }, { label: 'Activity deleted' });
    vi.advanceTimersByTime(WINDOW);
    await settle();
    expect(calls).toHaveLength(1);
    (notify.undo.mock.calls[1]![1] as () => void)();
    expect(notify.info).toHaveBeenCalledWith('Too late to undo. It was already deleted.');
  });
});

describe('editor engine: a new horizon’s milestones', () => {
  it('saves an activity added under a new milestone before the horizon was confirmed with the real milestone id', async () => {
    const initial = snapshot([]);
    const { engine, calls } = setup(initial);
    const started = engine.dispatch({
      kind: 'startHorizon', expectedStartDate: record.signedDate!, expectedHorizon: 0, startDate: TODAY, horizonDays: 30,
      milestones: [{ name: 'Horizon 2: Business review', criteria: '', day: 30 }],
    });
    if (!started.ok) throw new Error(started.message);
    const localMilestone = started.plan.milestones[0]!.id;
    expect(engine.dispatch({ kind: 'add', entity: 'activity', values: { title: 'Prepare the business review', milestoneId: localMilestone } }).ok).toBe(true);

    await settle();
    expect(calls).toHaveLength(1);
    const server = snapshot([], {
      info: { ...initial.value.info, laterHorizons: [{ startDate: TODAY, horizonDays: 30 }] },
      milestones: [{ id: 'm_server', name: 'Horizon 2: Business review', targetDate: '2026-11-14', criteria: '', achievedDate: null }],
    });
    calls[0]!.resolve({ ok: true, snapshot: server, entityId: null });
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.change).toEqual({ kind: 'add', entity: 'activity', values: { title: 'Prepare the business review', milestoneId: 'm_server' } });
  });
});

describe('editor engine: undo only what can be undone', () => {
  it('offers undo for a change, and none for starting a horizon', () => {
    const { engine, notify } = setup();
    engine.dispatch({ kind: 'updateInfo', patch: { horizonDays: 60 } }, { label: 'Onboarding length changed' });
    expect(notify.undo).toHaveBeenCalledWith('Onboarding length changed', expect.any(Function));
    notify.undo.mockClear();
    engine.dispatch({
      kind: 'startHorizon', expectedStartDate: record.signedDate!, expectedHorizon: 0, startDate: TODAY, horizonDays: 30, milestones: [],
    }, { label: 'Horizon started' });
    expect(notify.undo).not.toHaveBeenCalled();
  });

  it('offers no undo a person with a link couldn’t make', () => {
    const link: MapActor = { kind: 'link', personId: 'p_1', side: 'partner', name: 'Lena' };
    const { engine, notify } = setup(snapshot([makeActivity({ id: 'a_1', side: 'partner', updatedAt: NOW })]), link);
    // The undo of an add is a delete, which only the owner makes.
    engine.dispatch({ kind: 'add', entity: 'activity', values: { title: 'Ours', side: 'partner' } }, { label: 'Activity added' });
    expect(notify.undo).not.toHaveBeenCalled();
    engine.dispatch({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }, { label: 'Marked done' });
    expect(notify.undo).toHaveBeenCalledWith('Marked done', expect.any(Function));
  });
});

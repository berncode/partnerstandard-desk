// @vitest-environment jsdom
// The cases the engine tests don't cover, on the MAP snapshot.
import type { MapActor, MapChange, MapRecord } from '@partner-desk/core';
import { makeActivity, makeMapPlan, makeRecord, MAP_NOW as NOW } from '@partner-desk/core/test-builders';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MapSnapshot, RemoteResult } from './remote';
import { usePlanEditor } from './use-plan-editor';

const T1 = '2026-10-16T10:05:00.000Z';
const owner: MapActor = { kind: 'owner' };
const snapshot = (activities = [makeActivity({ id: 'a_1', updatedAt: NOW })], record: MapRecord = makeRecord()): MapSnapshot =>
  ({ value: makeMapPlan({ activities }), issues: [], record, startedOn: '2026-10-01', lastProgressAt: NOW });

function setup(initial = snapshot()) {
  const calls: Array<{ change: MapChange; resolve: (r: RemoteResult) => void }> = [];
  const remote = vi.fn((change: MapChange) => new Promise<RemoteResult>((resolve) => { calls.push({ change, resolve }); }));
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const hook = renderHook(({ snap }) => usePlanEditor({ initial: snap, remote, actor: owner, actorName: 'Anna Keller', notify }), { initialProps: { snap: initial } });
  return { ...hook, calls, remote, notify };
}

const status = (id: string, value: string): MapChange => ({ kind: 'update', entity: 'activity', id, patch: { status: value } });

afterEach(() => { vi.useRealTimers(); });

describe('usePlanEditor', () => {
  it('shows a change at once, joined with the partner record, and confirms it with the server snapshot and its last progress', async () => {
    const { result, calls } = setup();
    expect(result.current.plan.info).toMatchObject({ partnerName: 'Acme', stage: 'onboarding', startDate: '2026-10-10' });
    act(() => { result.current.dispatch(status('a_1', 'done')); });
    expect(result.current.plan.activities[0]!.status).toBe('done');
    expect(result.current.saveState).toBe('saving');
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.change).toMatchObject({ id: 'a_1', expectedUpdatedAt: NOW });
    await act(async () => calls[0]!.resolve({ ok: true, snapshot: { ...snapshot([makeActivity({ id: 'a_1', status: 'done', updatedAt: T1 })]), lastProgressAt: T1 }, entityId: null }));
    expect(result.current.saveState).toBe('saved');
    expect(result.current.plan.activities[0]!.updatedAt).toBe(T1);
    expect(result.current.lastEventAt).toBe(T1);
  });

  it('takes a fresh server snapshot on a revisit: a signing undone on the partner page shows recruitment again', () => {
    const { result, rerender } = setup();
    expect(result.current.plan.info.stage).toBe('onboarding');
    rerender({ snap: snapshot(undefined, makeRecord({ stage: 'recruitment', signedDate: null })) });
    expect(result.current.plan.info).toMatchObject({ stage: 'recruitment', startDate: '2026-10-01' });
  });

  it('allows the owner every change, and a person with a link only their own side', () => {
    const { result } = setup();
    expect(result.current.allowed({ kind: 'updateInfo', patch: {} })).toBe(true);
    const link = renderHook(() => usePlanEditor({
      initial: snapshot([makeActivity({ id: 'a_1', side: 'us' })]), remote: vi.fn(), actor: { kind: 'link', personId: 'p_1', side: 'partner', name: 'Lena' }, actorName: 'Lena',
    }));
    expect(link.result.current.allowed({ kind: 'updateInfo', patch: {} })).toBe(false);
    expect(link.result.current.allowed(status('a_1', 'done'))).toBe(false);
    expect(link.result.current.allowed({ kind: 'add', entity: 'objective', values: { side: 'partner', statement: '' } })).toBe(true);
  });

  it('warns before leaving the page while a change is being saved', async () => {
    const { result, calls } = setup();
    act(() => { result.current.dispatch(status('a_1', 'done')); });
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await waitFor(() => expect(calls).toHaveLength(1));
    await act(async () => calls[0]!.resolve({ ok: true, snapshot: snapshot(), entityId: null }));
    const after = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });

  it('still sends a held-back delete when the page goes', async () => {
    const { result, calls, unmount } = setup();
    act(() => { result.current.dispatch({ kind: 'delete', entity: 'activity', id: 'a_1' }, { label: 'Activity deleted' }); });
    expect(calls).toHaveLength(0);
    unmount();
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.change).toEqual({ kind: 'delete', entity: 'activity', id: 'a_1' });
  });
});

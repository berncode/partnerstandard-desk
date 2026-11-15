import type { ApplyOutcome, ChangeStamp } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEditorEngine, saveStateOf, type BatchOutcome, type EditorAdapter } from './engine';
import type { RemoteBatchResult, RemoteResult } from './remote';

// A tiny aggregate, so these tests show what the engine does without knowing the Partner book or a Market:
// a list of notes, each note optionally answering another (`replyTo`).

interface Note { id: string; text: string; replyTo: string | null; updatedAt: string | null; updatedBy: string }
interface Notes { notes: Note[] }
type NoteChange =
  | { kind: 'add'; entity: 'call'; values: { id?: string; text: string; replyTo?: string } }
  | { kind: 'update'; entity: 'call'; id: string; patch: { text: string }; expectedUpdatedAt?: string | null }
  | { kind: 'delete'; entity: 'call'; id: string };

const GONE = { ok: false, error: 'not_found', message: COPY.GONE } as const;

function applyNote(value: Notes, change: NoteChange, stamp: ChangeStamp): ApplyOutcome<Notes> {
  switch (change.kind) {
    case 'add': {
      if (change.values.text.trim() === '') return { ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { text: 'Empty' } };
      const id = stamp.newId!('call');
      const note = { id, text: change.values.text, replyTo: change.values.replyTo ?? null, updatedAt: stamp.now, updatedBy: stamp.actor };
      return { ok: true, value: { notes: [...value.notes, note] }, entityId: id };
    }
    case 'update': {
      const current = value.notes.find((n) => n.id === change.id);
      if (!current) return GONE;
      if (change.expectedUpdatedAt !== undefined && current.updatedAt !== change.expectedUpdatedAt) return { ok: false, error: 'conflict', message: COPY.CONFLICT };
      const next = { ...current, ...change.patch, updatedAt: stamp.now, updatedBy: stamp.actor };
      return { ok: true, value: { notes: value.notes.map((n) => (n.id === change.id ? next : n)) }, entityId: change.id };
    }
    case 'delete':
      return value.notes.some((n) => n.id === change.id) ? { ok: true, value: { notes: value.notes.filter((n) => n.id !== change.id) }, entityId: null } : GONE;
  }
}

const remapNote = (change: NoteChange, idMap: Record<string, string>): NoteChange => {
  const map = (id: string) => idMap[id] ?? id;
  if (change.kind === 'add') return change.values.replyTo ? { ...change, values: { ...change.values, replyTo: map(change.values.replyTo) } } : change;
  return { ...change, id: map(change.id) };
};

const notesAdapter: EditorAdapter<Notes, NoteChange> = {
  apply: applyNote,
  applyMany(value, changes, stamp): BatchOutcome<Notes> {
    let current = value;
    const ids: Record<string, string> = {};
    const entityIds: Array<string | null> = [];
    for (const [i, original] of changes.entries()) {
      const change = remapNote(original, ids);
      const own = change.kind === 'add' ? change.values.id : undefined;
      const out = applyNote(current, change, own ? { ...stamp, newId: () => own } : stamp);
      if (!out.ok) return { ...out, valid: i };
      current = out.value;
      entityIds.push(out.entityId);
    }
    return { ok: true, value: current, entityIds };
  },
  inverse(change, before, entityId) {
    if (change.kind === 'add') return entityId ? { kind: 'delete', entity: 'call', id: entityId } : null;
    if (change.kind === 'delete') return null;
    const previous = before.notes.find((n) => n.id === change.id);
    return previous ? { kind: 'update', entity: 'call', id: change.id, patch: { text: previous.text } } : null;
  },
  remap: remapNote,
  targetOf: (change) => (change.kind === 'add' ? null : `call:${change.id}`),
  refKeys: ['replyTo'],
  conflictKinds: ['update'],
  updatedAtOf: (value, target) => value.notes.find((n) => `call:${n.id}` === target)?.updatedAt,
};

const T0 = '2026-10-20T09:00:00.000Z';
const T1 = '2026-10-21T10:05:00.000Z';
const initial = (): Snapshot<Notes> => ({ value: { notes: [{ id: 'n_1', text: 'First', replyTo: null, updatedAt: T0, updatedBy: 'Anna' }] }, issues: [] });
const settle = async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

function serverApply(value: Notes, change: NoteChange): RemoteResult<Notes> {
  const out = applyNote(value, change, { now: T1, actor: 'Anna', newId: () => 'n_srv' });
  if (!out.ok) throw new Error(out.message);
  return { ok: true, snapshot: { value: out.value, issues: [] }, entityId: out.entityId };
}

function setup(extra: { startReadOnly?: boolean; readOnlyMessage?: string } = {}) {
  const calls: Array<{ change: NoteChange; resolve: (r: RemoteResult<Notes>) => void }> = [];
  const batches: Array<{ changes: NoteChange[]; batch: string; resolve: (r: RemoteBatchResult<Notes>) => void }> = [];
  const remote = {
    apply: (change: NoteChange) => new Promise<RemoteResult<Notes>>((resolve) => { calls.push({ change, resolve }); }),
    applyMany: (changes: NoteChange[], batch: string) => new Promise<RemoteBatchResult<Notes>>((resolve) => { batches.push({ changes, batch, resolve }); }),
  };
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const engine = createEditorEngine<Notes, NoteChange, string>({
    initial: initial(), remote, notify, refresh: vi.fn(), undoWindowMs: 5000, adapter: notesAdapter, actor: 'Anna', ...extra,
  });
  return { engine, calls, batches, notify, texts: () => engine.view().notes.map((n) => n.text) };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('editor engine, on any aggregate', () => {
  it('applies at once with the adapter’s rules, and sends one change at a time with the row’s Updated as base', async () => {
    const { engine, calls, texts } = setup();
    engine.dispatch({ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'One' } });
    engine.dispatch({ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'Two' } });
    expect(texts()).toEqual(['Two']);
    await settle();
    expect(calls.map((c) => c.change)).toEqual([{ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'One' }, expectedUpdatedAt: T0 }]);
    calls[0]!.resolve(serverApply(initial().value, calls[0]!.change));
    await settle();
    expect(calls[1]!.change).toMatchObject({ patch: { text: 'Two' }, expectedUpdatedAt: T1 });
  });

  it('maps a local id to the server’s, for the row and for rows that point at it', async () => {
    const { engine, calls } = setup();
    const added = engine.dispatch({ kind: 'add', entity: 'call', values: { text: 'Reply' } });
    if (!added.ok) throw new Error('refused');
    engine.dispatch({ kind: 'add', entity: 'call', values: { text: 'Reply to the reply', replyTo: added.entityId! } });
    await settle();
    calls[0]!.resolve(serverApply(initial().value, calls[0]!.change));
    await settle();
    expect(calls[1]!.change).toEqual({ kind: 'add', entity: 'call', values: { text: 'Reply to the reply', replyTo: 'n_srv' } });
  });

  it('holds a delete for the undo window', async () => {
    const { engine, calls, texts } = setup();
    engine.dispatch({ kind: 'delete', entity: 'call', id: 'n_1' });
    expect(texts()).toEqual([]);
    vi.advanceTimersByTime(4999);
    await settle();
    expect(calls).toHaveLength(0);
    vi.advanceTimersByTime(1);
    await settle();
    expect(calls).toHaveLength(1);
  });

  it('turns read-only on auth, offers Refresh on a conflict, Retry on unavailable', async () => {
    const conflict = setup();
    conflict.engine.dispatch({ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'x' } });
    await settle();
    conflict.calls[0]!.resolve({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    await settle();
    expect(conflict.notify.info).toHaveBeenCalledWith(COPY.SAVE_CONFLICT, expect.objectContaining({ label: COPY.REFRESH }));

    const busy = setup();
    busy.engine.dispatch({ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'x' } });
    await settle();
    busy.calls[0]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    await settle();
    expect(busy.notify.error).toHaveBeenCalledWith(COPY.UNAVAILABLE_MESSAGE, expect.objectContaining({ label: COPY.RETRY }));

    const gone = setup();
    gone.engine.dispatch({ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'x' } });
    await settle();
    gone.calls[0]!.resolve({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    await settle();
    expect(gone.engine.getState().readOnly).toBe(true);
    expect(gone.texts()).toEqual(['First']);
  });

  it('starts read-only for a company server’s viewer: nothing changes, nothing is sent, and the answer says why (plan 15)', async () => {
    const viewer = setup({ startReadOnly: true, readOnlyMessage: COPY.VIEWER_READ_ONLY });
    expect(viewer.engine.getState().readOnly).toBe(true);
    const out = await viewer.engine.apply({ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'x' } });
    expect(out).toMatchObject({ ok: false, message: COPY.VIEWER_READ_ONLY });
    await settle();
    expect(viewer.calls).toEqual([]);
    expect(viewer.texts()).toEqual(['First']);
    expect(setup().engine.getState().readOnly).toBe(false);
  });

  it('sends a batch as one, with what the batch needs, and maps its provisional ids', async () => {
    const { engine, batches, texts } = setup();
    const done = engine.applyMany([
      { kind: 'add', entity: 'call', values: { id: 'tmp_a', text: 'A' } },
      { kind: 'add', entity: 'call', values: { text: 'B', replyTo: 'tmp_a' } },
    ], 'into-somewhere');
    expect(texts()).toEqual(['First', 'A', 'B']);
    expect(saveStateOf(engine.getState())).toBe('saving');
    await settle();
    expect(batches[0]!.batch).toBe('into-somewhere');
    batches[0]!.resolve({ ok: true, snapshot: { value: { notes: [] }, issues: [] }, entityIds: ['n_a', 'n_b'] });
    expect(await done).toEqual({ ok: true, entityIds: ['n_a', 'n_b'] });
    expect(engine.getState().idMap).toMatchObject({ tmp_a: 'n_a' });
  });

  it('moves a change queued behind its own batch to the version the batch saved, so it isn’t a conflict', async () => {
    // Mark signed with the MAP's dates moving is a batch; the program the partner joins follows as one change to the
    // same row, made on the version before the batch.
    const { engine, calls, batches, notify, texts } = setup();
    engine.dispatchMany([{ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'Signed' } }], 'sign');
    engine.dispatch({ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'Signed, in a program' } });
    await settle();
    expect(batches[0]!.changes).toEqual([{ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'Signed' }, expectedUpdatedAt: T0 }]);
    const saved = serverApply(initial().value, batches[0]!.changes[0]!);
    if (!saved.ok) throw new Error('refused');
    batches[0]!.resolve({ ok: true, snapshot: saved.snapshot, entityIds: ['n_1'] });
    await settle();
    expect(calls[0]!.change).toMatchObject({ patch: { text: 'Signed, in a program' }, expectedUpdatedAt: T1 });
    expect(notify.error).not.toHaveBeenCalled();
    expect(texts()).toEqual(['Signed, in a program']);
  });

  it('answers a batch it can’t apply at once, with no toast (dispatchMany) or with one (applyMany), and sends nothing', async () => {
    const { engine, batches, notify, texts } = setup();
    const bad = [{ kind: 'add', entity: 'call', values: { text: 'A' } }, { kind: 'add', entity: 'call', values: { text: ' ' } }] as NoteChange[];
    expect(engine.dispatchMany(bad, 'x')).toMatchObject({ ok: false, error: 'invalid', valid: 1, fieldErrors: { text: 'Empty' } });
    expect(notify.error).not.toHaveBeenCalled();
    expect(await engine.applyMany(bad, 'x')).toEqual({ ok: false, valid: 1, message: COPY.FIX_FIELDS });
    expect(notify.error).toHaveBeenCalledWith(COPY.FIX_FIELDS);
    await settle();
    expect(batches).toHaveLength(0);
    expect(texts()).toEqual(['First']);

    const good = engine.dispatchMany([{ kind: 'add', entity: 'call', values: { text: 'C' } }], 'x');
    expect(good.ok).toBe(true);
    expect(texts()).toEqual(['First', 'C']);
    await settle();
    expect(batches).toHaveLength(1);
  });

  it('leaves a quiet batch’s failures to its caller: no toast, so no Retry that could send it again', async () => {
    const { engine, batches, notify, texts } = setup();
    const bad = [{ kind: 'add', entity: 'call', values: { text: ' ' } }] as NoteChange[];
    expect(await engine.applyMany(bad, 'x', { quiet: true })).toEqual({ ok: false, valid: 0, message: COPY.FIX_FIELDS });

    const busy = engine.applyMany([{ kind: 'add', entity: 'call', values: { text: 'A' } }], 'x', { quiet: true });
    await settle();
    batches[0]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    // Not answering, or no answer at all: the batch may be in the file.
    expect(await busy).toEqual({ ok: false, message: COPY.UNAVAILABLE_MESSAGE, unknown: true });

    const offline = engine.applyMany([{ kind: 'add', entity: 'call', values: { text: 'B' } }], 'x', { quiet: true });
    await settle();
    batches[1]!.resolve(Promise.reject(new Error('offline')) as never);
    expect(await offline).toEqual({ ok: false, message: COPY.SAVE_OFFLINE, unknown: true });

    expect(notify.error).not.toHaveBeenCalled();
    expect(notify.info).not.toHaveBeenCalled();
    expect(batches).toHaveLength(2);
    expect(texts()).toEqual(['First']);

    // Without `quiet`, the same failure offers Retry: it adds no partner, so sending it again can't make a second one.
    void engine.applyMany([{ kind: 'add', entity: 'call', values: { text: 'C' } }], 'x');
    await settle();
    batches[2]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    await settle();
    expect(notify.error).toHaveBeenCalledWith(COPY.UNAVAILABLE_MESSAGE, expect.objectContaining({ label: COPY.RETRY }));

    // A batch that only updates keeps Retry.
    void engine.applyMany([{ kind: 'update', entity: 'call', id: 'n_1', patch: { text: 'D' } }], 'x');
    await settle();
    batches[3]!.resolve({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    await settle();
    expect(notify.error).toHaveBeenLastCalledWith(COPY.UNAVAILABLE_MESSAGE, expect.objectContaining({ label: COPY.RETRY }));
  });

  it('answers a refused batch with the server’s message and how many came first; every row it showed goes', async () => {
    const { engine, batches, texts } = setup();
    const done = engine.applyMany([{ kind: 'add', entity: 'call', values: { text: 'A' } }, { kind: 'add', entity: 'call', values: { text: 'B' } }], 'x');
    await settle();
    batches[0]!.resolve({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, valid: 1 });
    expect(await done).toEqual({ ok: false, valid: 1, message: COPY.FIX_FIELDS });
    expect(texts()).toEqual(['First']);
  });
});

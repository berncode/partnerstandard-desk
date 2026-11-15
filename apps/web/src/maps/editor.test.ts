// The snapshot here is the file's MAP with the partner record it is joined with.
import type { MapChange, MapPlan } from '@partner-desk/core';
import { makeActivity, makeMapPlan, makePerson, makeRecord, makeReview, MAP_NOW as NOW, MAP_TODAY as TODAY } from '@partner-desk/core/test-builders';
import { buildSamplePlan, buildSampleRecord } from '@partner-desk/method';
import { createMemoryMapStore } from '@partner-desk/storage';
import { describe, expect, it } from 'vitest';
import { dropAfterConflict, dropDependents, editorReducer, expectedFor, initEditor, prepareForSend, rebaseAfterSuccess, remapChange, saveStateOf, viewOf, type QueueItem } from './editor';
import type { MapSnapshot } from './remote';

const record = makeRecord();
const snapshot = (plan: MapPlan = makeMapPlan({ activities: [makeActivity({ id: 'a_1', updatedAt: NOW })] })): MapSnapshot =>
  ({ value: plan, issues: [], record, startedOn: '2026-10-01', lastProgressAt: NOW });
const item = (seq: number, change: MapChange, localId: string | null = null): QueueItem => ({ seq, change, localId, at: NOW });
const start = (plan: MapPlan, milestones: Array<{ name: string; day: number }>, horizonDays = 60): MapChange => ({
  kind: 'startHorizon', expectedStartDate: record.signedDate!, expectedHorizon: plan.info.laterHorizons.length, startDate: TODAY, horizonDays,
  milestones: milestones.map((m) => ({ ...m, criteria: '' })),
});

describe('editor state', () => {
  it('shows queued and held-back changes on top of the confirmed plan', () => {
    let state = initEditor(snapshot());
    state = editorReducer(state, { type: 'enqueue', item: item(1, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }) });
    state = editorReducer(state, { type: 'enqueue', item: item(2, { kind: 'add', entity: 'activity', values: { title: 'New' } }, 'a_local') });
    const view = viewOf(state, 'Anna Keller');
    expect(view.activities.map((a) => [a.id, a.status])).toEqual([['a_1', 'done'], ['a_local', 'not_started']]);
    expect(saveStateOf(state)).toBe('saving');

    state = editorReducer(state, { type: 'defer', item: item(3, { kind: 'delete', entity: 'activity', id: 'a_1' }) });
    expect(viewOf(state, 'Anna Keller').activities.map((a) => a.id)).toEqual(['a_local']);
    state = editorReducer(state, { type: 'cancel', seq: 3 });
    expect(viewOf(state, 'Anna Keller').activities).toHaveLength(2);
  });

  it('shows a new horizon’s milestones with distinct local ids until the server confirms them', () => {
    const plan = makeMapPlan();
    let state = initEditor(snapshot(plan));
    const change = start(plan, [{ name: 'Horizon 2: Day 30 check-in', day: 30 }, { name: 'Horizon 2: Business review', day: 60 }]);
    state = editorReducer(state, { type: 'enqueue', item: item(4, change) });
    const view = viewOf(state, 'Anna Keller');
    expect(view.info.laterHorizons).toEqual([{ startDate: TODAY, horizonDays: 60 }]);
    const ids = view.milestones.map((m) => m.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    expect(viewOf(state, 'Anna Keller').milestones.map((m) => m.id)).toEqual(ids);
    expect(remapChange(change, { m_x: 'm_y' })).toBe(change);
  });

  it('maps a new horizon’s local milestone ids to the server’s, so queued changes that use them save with real ids', () => {
    const plan = makeMapPlan();
    let state = initEditor(snapshot(plan));
    state = editorReducer(state, { type: 'enqueue', item: item(1, start(plan, [{ name: 'Horizon 2: Day 30 check-in', day: 30 }, { name: 'Horizon 2: Business review', day: 60 }])) });
    const local = viewOf(state, 'Anna Keller').milestones.find((m) => m.name === 'Horizon 2: Business review')!.id;
    state = editorReducer(state, { type: 'enqueue', item: item(2, { kind: 'add', entity: 'activity', values: { title: 'Review', milestoneId: local } }, 'a_local') });
    const server = snapshot(makeMapPlan({
      info: { ...plan.info, laterHorizons: [{ startDate: TODAY, horizonDays: 60 }] },
      milestones: [
        { id: 'm_real30', name: 'Horizon 2: Day 30 check-in', targetDate: '2026-11-14', criteria: '', achievedDate: null },
        { id: 'm_real60', name: 'Horizon 2: Business review', targetDate: '2026-12-14', criteria: '', achievedDate: null },
      ],
    }));
    state = editorReducer(state, { type: 'succeeded', seq: 1, snapshot: server, entityId: null });
    expect(state.idMap).toEqual({ [local]: 'm_real60', [local.replace(/_2$/, '_1')]: 'm_real30' });
    expect(prepareForSend(state, state.queue[0]!)).toEqual({ kind: 'add', entity: 'activity', values: { title: 'Review', milestoneId: 'm_real60' } });
    expect(viewOf(state, 'Anna Keller').activities[0]!.milestoneId).toBe('m_real60');
  });

  it('drops queued changes that use a new horizon’s milestones when starting it fails', () => {
    const plan = makeMapPlan();
    let state = initEditor(snapshot(plan));
    state = editorReducer(state, { type: 'enqueue', item: item(1, start(plan, [{ name: 'Horizon 2: Business review', day: 30 }], 30)) });
    const local = viewOf(state, 'Anna Keller').milestones[0]!.id;
    state = editorReducer(state, { type: 'enqueue', item: item(2, { kind: 'add', entity: 'activity', values: { title: 'Review', milestoneId: local } }, 'a_local') });
    state = editorReducer(state, { type: 'enqueue', item: item(3, { kind: 'add', entity: 'activity', values: { title: 'Unrelated' } }, 'a_other') });
    state = editorReducer(state, { type: 'failed', seq: 1 });
    expect(state.queue.map((i) => i.seq)).toEqual([3]);
  });

  it('maps a local id to the server id once an add is confirmed', () => {
    let state = initEditor(snapshot());
    state = editorReducer(state, { type: 'enqueue', item: item(1, { kind: 'add', entity: 'person', values: { name: 'Priya', side: 'partner' } }, 'p_local') });
    state = editorReducer(state, { type: 'enqueue', item: item(2, { kind: 'update', entity: 'activity', id: 'a_1', patch: { ownerId: 'p_local' } }) });
    const server = snapshot(makeMapPlan({ activities: [makeActivity({ id: 'a_1', updatedAt: NOW })], people: [makePerson({ id: 'p_server', name: 'Priya', side: 'partner' })] }));
    state = editorReducer(state, { type: 'succeeded', seq: 1, snapshot: server, entityId: 'p_server' });
    expect(state.idMap).toEqual({ p_local: 'p_server' });
    expect(state.queue[0]!.change).toEqual({ kind: 'update', entity: 'activity', id: 'a_1', patch: { ownerId: 'p_server' } });
    expect(remapChange({ kind: 'delete', entity: 'person', id: 'p_local' }, state.idMap)).toEqual({ kind: 'delete', entity: 'person', id: 'p_server' });
  });

  it('drops a failed change, keeps the rest and remembers the failure', () => {
    let state = initEditor(snapshot());
    state = editorReducer(state, { type: 'enqueue', item: item(1, { kind: 'update', entity: 'activity', id: 'a_1', patch: { title: 'X' } }) });
    state = editorReducer(state, { type: 'enqueue', item: item(2, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }) });
    state = editorReducer(state, { type: 'failed', seq: 1 });
    expect(state.queue.map((i) => i.seq)).toEqual([2]);
    expect(viewOf(state, 'Anna Keller').activities[0]!.title).toBe('Test activity');
    state = editorReducer(state, { type: 'succeeded', seq: 2, snapshot: snapshot(), entityId: null });
    expect(saveStateOf(state)).toBe('saved');
    state = editorReducer(state, { type: 'enqueue', item: item(3, { kind: 'update', entity: 'activity', id: 'a_1', patch: { title: 'Y' } }) });
    state = editorReducer(state, { type: 'failed', seq: 3 });
    expect(saveStateOf(state)).toBe('failed');
  });

  it('a fatal failure empties the queue and the held deletes and needs Google', () => {
    let state = initEditor(snapshot());
    expect(state.needsGoogle).toBe(false);
    state = editorReducer(state, { type: 'enqueue', item: item(1, { kind: 'update', entity: 'activity', id: 'a_1', patch: { title: 'X' } }) });
    state = editorReducer(state, { type: 'enqueue', item: item(2, { kind: 'add', entity: 'activity', values: { title: 'New' } }, 'a_local') });
    state = editorReducer(state, { type: 'defer', item: item(3, { kind: 'delete', entity: 'activity', id: 'a_1' }) });
    state = editorReducer(state, { type: 'failed', seq: 1, fatal: true });
    expect(state.queue).toEqual([]);
    expect(state.deferred).toEqual([]);
    expect(state.needsGoogle).toBe(true);
    expect(state.lastSave).toBe('failed');
    expect(state.failures).toBe(1);
    expect(viewOf(state, 'Anna Keller').activities.map((a) => [a.id, a.title])).toEqual([['a_1', 'Test activity']]);
  });

  it('stamps activity updates with the server-confirmed updatedAt', () => {
    const state = initEditor(snapshot());
    expect(prepareForSend(state, item(1, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } })))
      .toEqual({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' }, expectedUpdatedAt: NOW, expected: { status: 'not_started' } });
    expect(prepareForSend(state, item(2, { kind: 'update', entity: 'person', id: 'p_1', patch: { name: 'X' } })))
      .toEqual({ kind: 'update', entity: 'person', id: 'p_1', patch: { name: 'X' } });
  });

  it('stamps review row updates with the server-confirmed updatedAt, without expected values, and rebases rapid edits (task 8)', () => {
    const t1 = '2026-10-16T10:05:00.000Z';
    const reviewPlan = (updatedAt: string) => makeMapPlan({ reviews: [makeReview({ id: 'rv_1', updatedAt })] });
    let state = initEditor(snapshot(reviewPlan(NOW)));
    const edit = (decisions: string): MapChange => ({ kind: 'update', entity: 'review', id: 'rv_1', patch: { decisions } });
    expect(prepareForSend(state, item(1, edit('A')))).toEqual({ ...edit('A'), expectedUpdatedAt: NOW });
    state = editorReducer(state, { type: 'enqueue', item: { ...item(1, edit('A')), base: NOW } });
    state = editorReducer(state, { type: 'enqueue', item: { ...item(2, edit('AB')), base: NOW } });
    state = editorReducer(state, { type: 'succeeded', seq: 1, snapshot: snapshot(reviewPlan(t1)), entityId: null });
    // The second edit moves to the version the first one produced: no conflict with itself.
    expect(prepareForSend(state, state.queue[0]!)).toEqual({ ...edit('AB'), expectedUpdatedAt: t1 });
    expect(dropAfterConflict([{ ...item(3, edit('C')), base: t1 }], { ...item(2, edit('AB')), base: t1 }, {})).toEqual([]);
  });

  it('sends the confirmed values of the patched fields as expected, so a hand edit of one is a conflict', () => {
    const plan = makeMapPlan({ activities: [makeActivity({ id: 'a_1', status: 'in_progress', note: 'Seen', updatedAt: NOW })] });
    const sent = prepareForSend(initEditor(snapshot(plan)), item(1, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done', dueDate: '2026-12-01' } }));
    expect(sent).toMatchObject({ expectedUpdatedAt: NOW, expected: { status: 'in_progress', dueDate: null } });
    expect(sent).not.toHaveProperty('expected.note');
  });

  it('sends the values recorded when the change was made, so a hand edit that a refresh brings in is still a conflict', () => {
    const change: MapChange = { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } };
    let state = initEditor(snapshot());
    const queued = { ...item(1, change), base: NOW, expected: expectedFor(state, change) };
    state = editorReducer(state, { type: 'enqueue', item: queued });
    // A refresh while the change waits behind a save: the sheet now says Blocked.
    state = editorReducer(state, { type: 'refresh', snapshot: snapshot(makeMapPlan({ activities: [makeActivity({ id: 'a_1', status: 'blocked', updatedAt: NOW })] })) });
    expect(prepareForSend(state, state.queue[0]!)).toMatchObject({ expected: { status: 'not_started' } });
  });

  it('moves a later edit of the same field to the value an earlier edit saved, so rapid edits do not conflict with themselves', () => {
    const edit = (status: string): MapChange => ({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status } });
    let state = initEditor(snapshot());
    for (const [seq, status] of [[1, 'in_progress'], [2, 'done']] as const) {
      state = editorReducer(state, { type: 'enqueue', item: { ...item(seq, edit(status)), base: NOW, expected: expectedFor(state, edit(status)) } });
    }
    expect(state.queue.map((i) => i.expected)).toEqual([{ status: 'not_started' }, { status: 'not_started' }]);
    const saved = snapshot(makeMapPlan({ activities: [makeActivity({ id: 'a_1', status: 'in_progress', updatedAt: '2026-10-16T10:05:00.000Z' })] }));
    state = editorReducer(state, { type: 'succeeded', seq: 1, snapshot: saved, entityId: null });
    expect(prepareForSend(state, state.queue[0]!)).toMatchObject({ expected: { status: 'in_progress' } });
  });

  it('sends no expected values for an activity it does not know yet', () => {
    const sent = prepareForSend(initEditor(snapshot()), item(1, { kind: 'update', entity: 'activity', id: 'local_activity_9', patch: { status: 'done' } }));
    expect(sent).not.toHaveProperty('expected');
  });

  it('sends rapid edits to one activity without a false conflict (the memory MAP store)', async () => {
    const store = createMemoryMapStore();
    const sampleRecord = buildSampleRecord(TODAY) as typeof record;
    const { fileId } = await store.create({ userId: 'u_1', displayName: 'Anna Keller' }, 'co_aaaaaaaaaa', buildSamplePlan(TODAY) as MapPlan, 'Brightwave');
    const read = await store.read({ fileId });
    if (!read.ok) throw new Error(read.message);
    let state = initEditor({ ...read.snapshot, record: sampleRecord, startedOn: TODAY, lastProgressAt: NOW });
    for (const [seq, status] of [[1, 'in_progress'], [2, 'done']] as const) {
      state = editorReducer(state, { type: 'enqueue', item: item(seq, { kind: 'update', entity: 'activity', id: 'a_sample7', patch: { status } }) });
    }
    for (const seq of [1, 2]) {
      const result = await store.apply({ fileId }, { ...prepareForSend(state, state.queue[0]!), record: sampleRecord }, { now: `2026-10-16T10:0${seq}:00.000Z`, actor: 'Anna Keller' });
      if (!result.ok) throw new Error(`unexpected ${result.error}`);
      state = editorReducer(state, { type: 'succeeded', seq, snapshot: { ...state.confirmed, ...result.snapshot }, entityId: result.entityId });
    }
    expect(state.confirmed.value.activities.find((a) => a.id === 'a_sample7')?.status).toBe('done');
  });

  it('sends the base recorded at enqueue time, not the confirmed value at send time', () => {
    const state = initEditor(snapshot());
    const based = { ...item(1, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }), base: '2026-01-01T00:00:00.000Z' };
    expect(prepareForSend(state, based)).toMatchObject({ expectedUpdatedAt: '2026-01-01T00:00:00.000Z' });
  });

  it('rebases later edits that shared the base after an own success, and drops them after a conflict', () => {
    const t1 = '2026-10-16T10:05:00.000Z';
    const mk = (seq: number, id: string, base?: string): QueueItem => ({ ...item(seq, { kind: 'update', entity: 'activity', id, patch: { status: 'done' } }), ...(base ? { base } : {}) });
    const done = mk(1, 'a_1', NOW);
    const server = snapshot(makeMapPlan({ activities: [makeActivity({ id: 'a_1', updatedAt: t1 })] }));
    const out = rebaseAfterSuccess([mk(2, 'a_1', NOW), mk(3, 'a_1', 'other'), mk(4, 'a_2', NOW)], done, server, {});
    expect(out.map((i) => i.base)).toEqual([t1, 'other', NOW]);
    expect(dropAfterConflict([mk(2, 'a_1', NOW), mk(3, 'a_2', NOW)], done, {}).map((i) => i.seq)).toEqual([3]);
  });

  it('takes a refreshed snapshot as confirmed and keeps the queue, held deletes and id map', () => {
    let state = initEditor(snapshot());
    state = editorReducer(state, { type: 'enqueue', item: item(1, { kind: 'add', entity: 'person', values: { name: 'Priya', side: 'partner' } }, 'p_local') });
    state = editorReducer(state, { type: 'succeeded', seq: 1, snapshot: snapshot(), entityId: 'p_server' });
    state = editorReducer(state, { type: 'enqueue', item: { ...item(2, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }), base: NOW } });
    state = editorReducer(state, { type: 'defer', item: item(3, { kind: 'delete', entity: 'person', id: 'p_server' }) });
    const fresh = snapshot(makeMapPlan({ activities: [makeActivity({ id: 'a_1', title: 'Renamed elsewhere', updatedAt: NOW })] }));
    const next = editorReducer(state, { type: 'refresh', snapshot: fresh });
    expect(next.confirmed).toBe(fresh);
    expect(next.queue).toBe(state.queue);
    expect(next.deferred).toBe(state.deferred);
    expect(next.idMap).toEqual({ p_local: 'p_server' });
    expect(viewOf(next, 'Anna Keller').activities[0]).toMatchObject({ title: 'Renamed elsewhere', status: 'done' });
  });

  it('applies a change with the confirmed partner record: no new horizon before signing', () => {
    const plan = makeMapPlan();
    let state = initEditor({ ...snapshot(plan), record: makeRecord({ signedDate: null, stage: 'recruitment' }) });
    state = editorReducer(state, { type: 'enqueue', item: item(1, start(plan, [])) });
    expect(viewOf(state, 'Anna Keller').info.laterHorizons).toEqual([]);
  });
});

describe('dropDependents', () => {
  it('drops queued edits that target or reference an add that failed', () => {
    const add = item(1, { kind: 'add', entity: 'person', values: { name: 'Ben' } }, 'p_local1');
    const rename = item(2, { kind: 'update', entity: 'person', id: 'p_local1', patch: { name: 'Benjamin' } });
    const assign = item(3, { kind: 'update', entity: 'activity', id: 'a_sample1', patch: { ownerId: 'p_local1' } });
    const addOwned = item(4, { kind: 'add', entity: 'activity', values: { title: 'Call', ownerId: 'p_local1' } }, 'a_local2');
    const unrelated = item(5, { kind: 'update', entity: 'activity', id: 'a_sample2', patch: { status: 'done' } });
    expect(dropDependents([rename, assign, addOwned, unrelated], add).map((i) => i.seq)).toEqual([5]);
  });

  it('drops edits that depend on a dropped dependent, transitively', () => {
    const addPerson = item(1, { kind: 'add', entity: 'person', values: { name: 'Ben' } }, 'p_local1');
    const addActivity = item(2, { kind: 'add', entity: 'activity', values: { title: 'Call', ownerId: 'p_local1' } }, 'a_local2');
    const editActivity = item(3, { kind: 'update', entity: 'activity', id: 'a_local2', patch: { status: 'done' } });
    expect(dropDependents([addActivity, editActivity], addPerson)).toEqual([]);
  });

  it('keeps everything when the failed change was not an add', () => {
    const update = item(1, { kind: 'update', entity: 'activity', id: 'a_sample1', patch: { status: 'done' } });
    const other = item(2, { kind: 'update', entity: 'activity', id: 'a_sample1', patch: { note: 'x' } });
    expect(dropDependents([other], update)).toEqual([other]);
  });
});

describe('editorReducer: a failed add', () => {
  it('drops queued and held-back changes that depend on it', () => {
    let state = initEditor(snapshot());
    state = editorReducer(state, { type: 'enqueue', item: item(1, { kind: 'add', entity: 'activity', values: { title: 'Call' } }, 'a_local1') });
    state = editorReducer(state, { type: 'enqueue', item: item(2, { kind: 'update', entity: 'activity', id: 'a_local1', patch: { status: 'done' } }) });
    state = editorReducer(state, { type: 'defer', item: item(3, { kind: 'delete', entity: 'activity', id: 'a_local1' }) });
    state = editorReducer(state, { type: 'failed', seq: 1 });
    expect(state.queue).toEqual([]);
    expect(state.deferred).toEqual([]);
    expect(viewOf(state, 'Anna Keller').activities.map((a) => a.id)).toEqual(['a_1']);
  });
});

describe('editorReducer: a conflict', () => {
  const update = (seq: number, id: string): QueueItem => ({ ...item(seq, { kind: 'update', entity: 'activity', id, patch: { status: 'done' } }), base: NOW });
  const del = (seq: number, id: string) => item(seq, { kind: 'delete', entity: 'activity', id });
  const two = () => snapshot(makeMapPlan({ activities: [makeActivity({ id: 'a_1', updatedAt: NOW }), makeActivity({ id: 'a_2', updatedAt: NOW })] }));

  it('drops held-back deletes of the activity that conflicted, and keeps the rest', () => {
    let state = initEditor(two());
    state = editorReducer(state, { type: 'enqueue', item: update(1, 'a_1') });
    state = editorReducer(state, { type: 'defer', item: del(2, 'a_1') });
    state = editorReducer(state, { type: 'defer', item: del(3, 'a_2') });
    state = editorReducer(state, { type: 'failed', seq: 1, conflict: true, snapshot: two() });
    expect(state.queue).toEqual([]);
    expect(state.deferred.map((i) => i.seq)).toEqual([3]);
    expect(viewOf(state, 'Anna Keller').activities.map((a) => a.id)).toEqual(['a_1']);
  });

  it('keeps a held-back delete of that activity when the failure was not a conflict', () => {
    let state = initEditor(two());
    state = editorReducer(state, { type: 'enqueue', item: update(1, 'a_1') });
    state = editorReducer(state, { type: 'defer', item: del(2, 'a_1') });
    state = editorReducer(state, { type: 'failed', seq: 1 });
    expect(state.deferred.map((i) => i.seq)).toEqual([2]);
  });

  it('never drops an add, so nothing queued later loses what it depends on', () => {
    const addMilestone = item(2, { kind: 'add', entity: 'milestone', values: { name: 'Day 45', targetDate: '2026-12-01' } }, 'm_local1');
    const moveA1 = item(3, { kind: 'update', entity: 'activity', id: 'a_1', patch: { milestoneId: 'm_local1' } });
    const moveA2 = item(4, { kind: 'update', entity: 'activity', id: 'a_2', patch: { milestoneId: 'm_local1' } });
    const kept = dropAfterConflict([addMilestone, moveA1, moveA2], update(1, 'a_1'), {});
    expect(kept.map((i) => i.seq)).toEqual([2, 4]);
  });
});

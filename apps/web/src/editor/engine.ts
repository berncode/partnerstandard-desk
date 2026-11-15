// The editor engine, generic over the aggregate (the Partner book or a Market) through an adapter, with words from COPY and no `partial` save.
import { newId, type ApplyOutcome, type ChangeStamp, type IsoDateTime, type MarketEntity, type PartnerEntity } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Snapshot, StoreErrorCode } from '@partner-desk/storage';
import type { EditorRemote, RemoteBatchResult, RemoteResult } from './remote';

/** Retrying can help only when the storage was busy or full; a refused change or a lost file stays refused. */
const RETRYABLE = new Set<StoreErrorCode | 'forbidden'>(['unavailable', 'quota']);

export interface NotifyAction { label: string; onClick: () => void }

export interface Notify {
  /** Shows the undo toast (there is only one; a new one replaces it). */
  undo(label: string, onUndo: () => void): void;
  /** Removes the undo toast, once the change it would undo can no longer be undone. */
  dismissUndo(): void;
  error(message: string, action?: NotifyAction): void;
  info(message: string, action?: NotifyAction): void;
}

// ── The aggregate ──────────────────────────────────────────────────────────

/** What the engine reads of any change: its kind. Adds (`kind: 'add'`) also name the row kind and its values. */
export type EditorChange = { kind: string };
type AddChange = { kind: 'add'; entity: PartnerEntity | MarketEntity; values: Record<string, unknown> };

const asAdd = (change: EditorChange): AddChange | null => (change.kind === 'add' ? (change as AddChange) : null);

/**
 * Whether a piece of work adds a partner: sent twice, it would make a second record of the company. Other adds (a call,
 * a person, an exclusion) keep Retry, since their form has closed and Retry is the only way back to what was typed.
 */
const addsPartner = <C extends EditorChange, B>(work: Work<C, B>): boolean =>
  ('one' in work ? [work.one] : work.many).some((c) => asAdd(c)?.entity === 'partner');

/** An add's provisional id: the id later changes use for the row it makes until the server gives the real one. */
function provisionalIdOf(change: EditorChange): string | null {
  const add = asAdd(change);
  return add && typeof add.values.id === 'string' && add.values.id !== '' ? add.values.id : null;
}

/** One inverse, or the ordered list an inverse returned, or nothing. */
function inverseGroup<T, C extends EditorChange>(adapter: EditorAdapter<T, C>, change: C, before: T, entityId: string | null): C[] {
  const inverse = adapter.inverse(change, before, entityId);
  if (inverse === null) return [];
  return Array.isArray(inverse) ? inverse : [inverse];
}

/** True when every change in `undo` would apply, each on the book the one before left. */
function undoApplies<T, C extends EditorChange>(adapter: EditorAdapter<T, C>, value: T, undo: C[], stamp: ChangeStamp): boolean {
  let current = value;
  for (const change of undo) {
    const out = adapter.apply(current, change, stamp);
    if (!out.ok) return false;
    current = out.value;
  }
  return true;
}

type ApplyFailure = Extract<ApplyOutcome<never>, { ok: false }>;
/** Core's batch outcome (applyPartnerChanges, applyMarketChanges). */
export type BatchOutcome<T> = { ok: true; value: T; entityIds: Array<string | null> } | (ApplyFailure & { valid: number });

/** What the engine needs to know about one aggregate. `adapters.ts` has the Partner book's and the Market's. */
export interface EditorAdapter<T, C extends EditorChange> {
  /** Core's rules for one change: the ones the server applies. */
  apply(value: T, change: C, stamp: ChangeStamp): ApplyOutcome<T>;
  /** Core's rules for a batch, all or nothing. Each add keeps its provisional `values.id` as its row's id. */
  applyMany(value: T, changes: C[], stamp: ChangeStamp): BatchOutcome<T>;
  /**
   * What undoes `change`, given the value before it (`entityId`: the row an add made), or null.
   * A list is applied in that order. The batch undo reverses whole lists, then keeps the order inside each one.
   */
  inverse(change: C, before: T, entityId: string | null): C | C[] | null;
  /** Rewrites the row ids (target and references) that `idMap` replaces. */
  remap(change: C, idMap: Record<string, string>): C;
  /** The row a change writes: `entity:id` for a row, another name (like `info`) for a part that isn't a row, null for an add. */
  targetOf(change: C): string | null;
  /** The fields of an add's values or an update's patch that hold row ids. */
  refKeys: readonly string[];
  /** The kinds of change that carry the conflict check (`expectedUpdatedAt`). */
  conflictKinds: readonly string[];
  /** The Updated value of the row `target` names; undefined when the row isn't there. */
  updatedAtOf(value: T, target: string): IsoDateTime | null | undefined;
}

// ── State (pure) ───────────────────────────────────────────────────────────

/** One change, or a batch (an import) sent as one: its rows show at once and are saved or rolled back together. */
export type Work<C, B> = { one: C } | { many: C[]; batch: B };

export interface QueueItem<C, B> {
  seq: number;
  work: Work<C, B>;
  /** For adds: the id the row has locally until the server assigns the real one. */
  localId: string | null;
  /** When the user made the change; stamps the optimistic version. */
  at: IsoDateTime;
  /** The Updated value of the row the change writes, as the confirmed value had it. Undefined for a row not saved yet. */
  base?: IsoDateTime | null;
  /** A batch whose caller shows its failure itself: no toast, and so no Retry that could send it a second time. */
  quiet?: boolean;
}

export interface EditorState<T, C, B> {
  /** The last snapshot the server returned. */
  confirmed: Snapshot<T>;
  /** Changes waiting to be sent, oldest first. The head may be in flight. */
  queue: QueueItem<C, B>[];
  /** Deletes held back during the undo window. */
  deferred: QueueItem<C, B>[];
  /** Local id → server id for adds the server has confirmed. */
  idMap: Record<string, string>;
  lastSave: 'ok' | 'failed' | null;
  /** Google needs reconnecting (or the person is signed out): nothing can be saved until they sign in again. */
  readOnly: boolean;
}

export type EditorEvent<T, C, B> =
  | { type: 'enqueue'; item: QueueItem<C, B> }
  | { type: 'defer'; item: QueueItem<C, B> }
  | { type: 'release'; seq: number }
  | { type: 'cancel'; seq: number }
  | { type: 'refresh'; snapshot: Snapshot<T> }
  /** `entityIds`: a batch's, per change. */
  | { type: 'succeeded'; seq: number; snapshot: Snapshot<T>; entityId: string | null; entityIds?: Array<string | null> }
  /**
   * `conflict`: drop the row's other edits too. `fatal`: drop everything and stop saving. `valid`: for a refused
   * batch, how many of its changes came before the one refused. `message`: why, for whoever waits on the save.
   * `unknown`: no clear answer (the server wasn't answering, or the call failed): the change may be in the file.
   */
  | { type: 'failed'; seq: number; conflict?: boolean; fatal?: boolean; valid?: number; message?: string; unknown?: true };

export function initEditor<T, C, B>(snapshot: Snapshot<T>, readOnly = false): EditorState<T, C, B> {
  return { confirmed: snapshot, queue: [], deferred: [], idMap: {}, lastSave: null, readOnly };
}

function remapWork<T, C extends EditorChange, B>(adapter: EditorAdapter<T, C>, work: Work<C, B>, idMap: Record<string, string>): Work<C, B> {
  if ('one' in work) return { one: adapter.remap(work.one, idMap) };
  return { ...work, many: work.many.map((c) => adapter.remap(c, idMap)) };
}

/** The row a piece of work writes; null for an add or a batch. */
const targetOfWork = <T, C extends EditorChange, B>(adapter: EditorAdapter<T, C>, work: Work<C, B>) =>
  ('one' in work ? adapter.targetOf(work.one) : null);

/** Every row id one change names: its target and the rows it links to. */
function refsOf<T, C extends EditorChange>(adapter: EditorAdapter<T, C>, change: C): string[] {
  const target = adapter.targetOf(change);
  const own = target?.includes(':') ? [target.slice(target.indexOf(':') + 1)] : [];
  const add = asAdd(change);
  const fields = add ? add.values : change.kind === 'update' ? ((change as { patch?: Record<string, unknown> }).patch ?? {}) : {};
  const refs = adapter.refKeys.flatMap((key) => fields[key] ?? []).filter((v): v is string => typeof v === 'string');
  return [...own, ...refs];
}

/** Every row id a piece of work names. A batch names what its changes name outside it. */
function idsReferencedBy<T, C extends EditorChange, B>(adapter: EditorAdapter<T, C>, work: Work<C, B>): string[] {
  if ('one' in work) return refsOf(adapter, work.one);
  const own = new Set(work.many.map(provisionalIdOf));
  return work.many.flatMap((c) => refsOf(adapter, c)).filter((id) => !own.has(id));
}

/** The conflict base for a change about to be queued: what the confirmed value says, if it has the row. */
export function baseFor<T, C extends EditorChange, B>(adapter: EditorAdapter<T, C>, state: EditorState<T, C, B>, change: C): IsoDateTime | null | undefined {
  const target = adapter.targetOf(adapter.remap(change, state.idMap));
  return target ? adapter.updatedAtOf(state.confirmed.value, target) : undefined;
}

/**
 * After an own save of a row succeeds, later changes to it that shared its base move to the version it produced. A
 * batch was sent on the confirmed version (`before`), so each row it wrote moves from there: a change queued behind
 * the batch (Mark signed with the MAP's dates, then the program the partner joins) is not taken for a conflict.
 */
function rebaseAfterSuccess<T, C extends EditorChange, B>(
  adapter: EditorAdapter<T, C>, items: QueueItem<C, B>[], done: QueueItem<C, B>, before: T, snapshot: Snapshot<T>,
): QueueItem<C, B>[] {
  const moves = new Map<string, { from: IsoDateTime | null; to: IsoDateTime | null }>();
  const changes = 'one' in done.work ? [done.work.one] : done.work.many;
  for (const change of changes) {
    const target = adapter.targetOf(change);
    if (target === null || moves.has(target)) continue;
    const from = 'one' in done.work ? done.base : adapter.updatedAtOf(before, target);
    const to = adapter.updatedAtOf(snapshot.value, target);
    if (from !== undefined && to !== undefined) moves.set(target, { from, to });
  }
  if (moves.size === 0) return items;
  return items.map((i) => {
    const target = targetOfWork(adapter, i.work);
    const move = target === null ? undefined : moves.get(target);
    return move && i.base === move.from ? { ...i, base: move.to } : i;
  });
}

/** After a conflict on a row, the other changes to it were made against a stale version and are dropped. Adds stay. */
function dropAfterConflict<T, C extends EditorChange, B>(
  adapter: EditorAdapter<T, C>, items: QueueItem<C, B>[], failed: QueueItem<C, B>, idMap: Record<string, string>,
): QueueItem<C, B>[] {
  const target = targetOfWork(adapter, remapWork(adapter, failed.work, idMap));
  if (target === null) return items;
  return items.filter((i) => ('one' in i.work && i.work.one.kind === 'add') || targetOfWork(adapter, remapWork(adapter, i.work, idMap)) !== target);
}

/** The local ids of the rows an item makes: an add's, or the provisional ids of a batch's adds. */
function madeBy<C extends EditorChange, B>(item: QueueItem<C, B>): string[] {
  if ('many' in item.work) return item.work.many.map(provisionalIdOf).filter((id): id is string => id !== null);
  return item.localId ? [item.localId] : [];
}

/**
 * After an add (or a batch) fails, the rows it would have made never exist: changes that target or point at them are
 * dropped too, and, transitively, anything that depended on an add dropped this way. Queue and held-back list share
 * one set.
 */
function dropDependents<T, C extends EditorChange, B>(
  adapter: EditorAdapter<T, C>, queue: QueueItem<C, B>[], deferred: QueueItem<C, B>[], failed: QueueItem<C, B>,
) {
  const gone = new Set(madeBy(failed));
  if (gone.size === 0) return { queue, deferred };
  const keep = (items: QueueItem<C, B>[]) => items.filter((item) => {
    if (!idsReferencedBy(adapter, item.work).some((id) => gone.has(id))) return true;
    for (const id of madeBy(item)) gone.add(id);
    return false;
  });
  return { queue: keep(queue), deferred: keep(deferred) };
}

export function editorReducer<T, C extends EditorChange, B>(
  adapter: EditorAdapter<T, C>, state: EditorState<T, C, B>, event: EditorEvent<T, C, B>,
): EditorState<T, C, B> {
  switch (event.type) {
    case 'enqueue':
      return { ...state, queue: [...state.queue, event.item] };
    case 'defer':
      return { ...state, deferred: [...state.deferred, event.item] };
    case 'release': {
      const released = state.deferred.find((i) => i.seq === event.seq);
      if (!released) return state;
      return { ...state, deferred: state.deferred.filter((i) => i.seq !== event.seq), queue: [...state.queue, released] };
    }
    case 'cancel':
      return { ...state, deferred: state.deferred.filter((i) => i.seq !== event.seq) };
    case 'refresh':
      // Queued changes keep their recorded bases, so replaying them on a newer value still surfaces real conflicts.
      return { ...state, confirmed: event.snapshot };
    case 'succeeded': {
      const head = state.queue[0];
      if (!head || head.seq !== event.seq) return state;
      const idMap = { ...state.idMap };
      if (head.localId && event.entityId && head.localId !== event.entityId) idMap[head.localId] = event.entityId;
      if ('many' in head.work) {
        head.work.many.forEach((change, i) => {
          const local = provisionalIdOf(change);
          const saved = event.entityIds?.[i];
          if (local && saved && local !== saved) idMap[local] = saved;
        });
      }
      const remap = (i: QueueItem<C, B>) => ({ ...i, work: remapWork(adapter, i.work, idMap) });
      const rebase = (items: QueueItem<C, B>[]) => rebaseAfterSuccess(adapter, items.map(remap), remap(head), state.confirmed.value, event.snapshot);
      return { ...state, confirmed: event.snapshot, queue: rebase(state.queue.slice(1)), deferred: rebase(state.deferred), idMap, lastSave: 'ok' };
    }
    case 'failed': {
      const head = state.queue[0];
      if (!head || head.seq !== event.seq) return state;
      if (event.fatal) return { ...state, queue: [], deferred: [], lastSave: 'failed', readOnly: true };
      const rest = state.queue.slice(1);
      const queue = event.conflict ? dropAfterConflict(adapter, rest, head, state.idMap) : rest;
      const deferred = event.conflict ? dropAfterConflict(adapter, state.deferred, head, state.idMap) : state.deferred;
      return { ...state, ...dropDependents(adapter, queue, deferred, head), lastSave: 'failed' };
    }
  }
}

const stampFor = <C, B>(item: QueueItem<C, B>, actor: string): ChangeStamp => ({
  now: item.at, actor, newId: (entity) => item.localId ?? newId(entity),
});

/** The value as the user sees it: the confirmed value plus every queued and held-back change. */
export function viewOf<T, C extends EditorChange, B>(adapter: EditorAdapter<T, C>, state: EditorState<T, C, B>, actor: string = COPY.YOU): T {
  let value = state.confirmed.value;
  for (const item of [...state.queue, ...state.deferred]) {
    const work = remapWork(adapter, item.work, state.idMap);
    const stamp = stampFor(item, actor);
    const outcome = 'one' in work ? adapter.apply(value, work.one, stamp) : adapter.applyMany(value, work.many, stamp);
    if (outcome.ok) value = outcome.value;
  }
  return value;
}

/** A change that carries the conflict check, stamped with the version it was made on (`base`, else the confirmed one). */
function withBase<T, C extends EditorChange, B>(
  adapter: EditorAdapter<T, C>, state: EditorState<T, C, B>, change: C, base: IsoDateTime | null | undefined,
): C {
  if (!adapter.conflictKinds.includes(change.kind) || (change as { expectedUpdatedAt?: unknown }).expectedUpdatedAt !== undefined) return change;
  const target = adapter.targetOf(change);
  const expected = base !== undefined ? base : target === null ? undefined : adapter.updatedAtOf(state.confirmed.value, target);
  return expected === undefined ? change : { ...change, expectedUpdatedAt: expected };
}

/** The work as it goes over the wire: ids remapped, conflict-checked changes stamped with the version they were made on. */
export function prepareForSend<T, C extends EditorChange, B>(
  adapter: EditorAdapter<T, C>, state: EditorState<T, C, B>, item: QueueItem<C, B>,
): Work<C, B> {
  const work = remapWork(adapter, item.work, state.idMap);
  if ('many' in work) return { ...work, many: work.many.map((c) => withBase(adapter, state, c, undefined)) };
  return { one: withBase(adapter, state, work.one, item.base) };
}

/**
 * The id a row is saved under, for a link to it: the server's id once its add is saved, null while the add is still
 * queued (the row has only its local id, which no page knows).
 */
export function savedIdOf<T, C extends EditorChange, B>(state: EditorState<T, C, B>, id: string): string | null {
  const saved = state.idMap[id];
  if (saved !== undefined) return saved;
  return [...state.queue, ...state.deferred].some((item) => madeBy(item).includes(id)) ? null : id;
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export function saveStateOf<T, C, B>(state: EditorState<T, C, B>): SaveState {
  if (state.queue.length > 0 || state.deferred.length > 0) return 'saving';
  if (state.lastSave === null) return 'idle';
  return state.lastSave === 'failed' ? 'error' : 'saved';
}

// ── Engine (effects) ───────────────────────────────────────────────────────

export interface DispatchOptions {
  /** Shown in the undo toast, e.g. "Stage changed". Without a label no undo is offered. */
  label?: string;
  /** Deletes are held back for the undo window unless this is false (undoing an add deletes at once). */
  deferDelete?: boolean;
}

/**
 * How an `apply` ended: saved (with the id the server gave a new row), or not (refused, failed, dropped or canceled).
 * `unknown`: no clear answer (Google not answering, or the call failed): the change may be in the file. `message`:
 * why, when the change itself was refused (by core's rules here, or by the server).
 */
export type SaveOutcome = { ok: true; entityId: string | null } | { ok: false; unknown?: true; message?: string };
/** `quiet`: the caller shows a failure itself. The engine shows no toast and offers no Retry (an import is never sent twice). */
export interface BatchOptions {
  quiet?: boolean;
  /** Shown in the undo toast. Undo then deletes every row the batch added, newest first. Without it no undo is offered. */
  label?: string;
}

/**
 * How an `applyMany` ended: saved (with the id of each row an add made), or not. `valid`: when a change was refused,
 * how many came before it. `message`: why, when the editor or the server said. `unknown`: no clear answer (Google not
 * answering, or the call failed): the batch may be in the file, so it must not be sent again before a reload.
 */
export type BatchSaveOutcome =
  | { ok: true; entityIds: Array<string | null> }
  | { ok: false; valid?: number; message?: string; unknown?: true };

export interface EngineDeps<T, C, B> {
  remote: EditorRemote<T, C, B>;
  notify: Notify;
  /** Loads the page again from the server (the conflict toast's Refresh). */
  refresh: () => void;
}

export interface EngineOptions<T, C extends EditorChange, B> extends EngineDeps<T, C, B> {
  initial: Snapshot<T>;
  adapter: EditorAdapter<T, C>;
  undoWindowMs: number;
  /** Who a change shows as changed by until the server's copy comes back. */
  actor?: string;
  /** Why nothing saves while the page is read-only, in the edition's words (plan 14). Default: hosted's. */
  readOnlyMessage?: string;
  /** Read only from the start: a company server's viewer, who changes nothing (plan 15). */
  startReadOnly?: boolean;
}

export interface EditorEngine<T, C extends EditorChange, B> {
  subscribe(listener: () => void): () => void;
  getState(): EditorState<T, C, B>;
  /** The value as the user sees it, for `of` (by default the current state). Worked out once per state. */
  view(of?: EditorState<T, C, B>): T;
  configure(deps: EngineDeps<T, C, B>): void;
  /** Applies the change optimistically and queues it; returns the local outcome (field errors show next to the field). */
  dispatch(change: C, options?: DispatchOptions): ApplyOutcome<T>;
  /** `dispatch`, resolving once the change is saved, failed or dropped. A local refusal shows as an error toast. */
  apply(change: C, options?: DispatchOptions): Promise<SaveOutcome>;
  /**
   * Applies a batch (an import) at once and saves it in one request, all or nothing: on failure every row it showed
   * goes again. An add may carry a provisional `values.id`; it is the row's local id until saved. Undo only with a `label`.
   */
  applyMany(changes: C[], batch: B, options?: BatchOptions): Promise<BatchSaveOutcome>;
  /** `applyMany` for forms that show why a batch can't be saved: returns the local outcome at once, with no error toast. */
  dispatchMany(changes: C[], batch: B, options?: Pick<BatchOptions, 'label'>): BatchOutcome<T>;
  /** Undoes the change that owns the undo toast, if any. */
  undo(): void;
  /** Cancels a delete that is still held back. Once it has been released, tells the user it is too late. */
  cancel(seq: number): void;
  /** Releases every held-back delete now. Idempotent. */
  releaseAll(): void;
  /** Takes a newer server snapshot as the confirmed value; queued and held-back changes stay on top of it. */
  refresh(snapshot: Snapshot<T>): void;
}

/**
 * The sync engine: owns the editor state and sends the queue one change at a time. Plain TypeScript with no React, so
 * it keeps draining while its component is hidden or unmounted. It reads the clock, runs the undo-window timers, calls
 * the network and shows toasts; the state rules above are pure.
 */
export function createEditorEngine<T, C extends EditorChange, B = undefined>(options: EngineOptions<T, C, B>): EditorEngine<T, C, B> {
  const { adapter } = options;
  const actor = options.actor ?? COPY.YOU;
  const readOnlyMessage = options.readOnlyMessage ?? COPY.SAVE_READ_ONLY;
  let deps: EngineDeps<T, C, B> = { remote: options.remote, notify: options.notify, refresh: options.refresh };
  let state = initEditor<T, C, B>(options.initial, options.startReadOnly ?? false);
  let seen: { state: EditorState<T, C, B>; value: T } | null = null;
  let seqCounter = 0;
  let sending: number | null = null;
  /** The change that owns the one undo toast, and what undoing it does. */
  let undoOwner: { seq: number; run: () => void } | null = null;
  const listeners = new Set<() => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Held deletes that have been sent, so a late Undo can say so. */
  const released = new Set<number>();
  /** `apply` callers waiting for their change to leave the queue, told by the event that took it out. */
  const waiters = new Map<number, (event: EditorEvent<T, C, B>) => void>();

  const pending = () => new Set([...state.queue, ...state.deferred].map((i) => i.seq));
  const view = (of: EditorState<T, C, B> = state) => {
    if (seen?.state !== of) seen = { state: of, value: viewOf(adapter, of, actor) };
    return seen.value;
  };

  const reduce = (event: EditorEvent<T, C, B>) => {
    const next = editorReducer(adapter, state, event);
    if (next === state) return;
    state = next;
    const live = pending();
    for (const [seq, settle] of waiters) {
      if (live.has(seq)) continue;
      waiters.delete(seq);
      settle(event);
    }
    for (const listener of [...listeners]) listener();
  };

  const offerUndo = (seq: number, label: string, run: () => void) => {
    undoOwner = { seq, run };
    deps.notify.undo(label, run);
  };

  /** Removes the undo toast if one of these changes owns it: there is nothing left for it to undo. */
  const withdrawUndo = (seqs: ReadonlySet<number>) => {
    if (undoOwner === null || !seqs.has(undoOwner.seq)) return;
    undoOwner = null;
    deps.notify.dismissUndo();
  };

  /** Applies a failure, then clears the timers and undo toast of every change it dropped. */
  const reduceFailure = (event: Extract<EditorEvent<T, C, B>, { type: 'failed' }>) => {
    const before = pending();
    reduce(event);
    const live = pending();
    const dropped = new Set([...before].filter((seq) => !live.has(seq)));
    for (const seq of dropped) {
      clearTimeout(timers.get(seq));
      timers.delete(seq);
    }
    withdrawUndo(dropped);
  };

  const pump = () => {
    const head = state.queue[0];
    if (sending !== null || !head) return;
    sending = head.seq;
    const { remote } = deps;
    // A quiet batch's caller shows its failure: no toast here, and so no Retry.
    const notify: Notify = head.quiet ? { ...deps.notify, error: () => {}, info: () => {} } : deps.notify;
    const { work } = head;
    const retry = {
      label: COPY.RETRY,
      onClick: () => ('many' in work ? void engine.applyMany(work.many, work.batch) : engine.dispatch(work.one)),
    };
    /**
     * No clear answer: the change may be in the file. An add of a partner sent again could make a second record, so it
     * gets Refresh: the page shows what was saved, and nothing is sent again. Anything else gets Retry.
     */
    const unknownOutcome = (message: string) => {
      if (addsPartner(work)) notify.error(COPY.SAVE_ADD_UNKNOWN, { label: COPY.REFRESH, onClick: () => deps.refresh() });
      else notify.error(message, retry);
    };
    /** One change or a batch, answered in one shape. */
    const send = async (): Promise<RemoteResult<T> & { entityIds?: Array<string | null> }> => {
      const prepared = prepareForSend(adapter, state, head);
      if ('one' in prepared) return remote.apply(prepared.one);
      const result: RemoteBatchResult<T> = await remote.applyMany!(prepared.many, prepared.batch);
      return result.ok ? { ...result, entityId: null } : result;
    };
    Promise.resolve().then(send).then(
      (result) => {
        sending = null;
        if (result.ok) {
          const entityIds = result.entityIds ? { entityIds: result.entityIds } : {};
          reduce({ type: 'succeeded', seq: head.seq, snapshot: result.snapshot, entityId: result.entityId, ...entityIds });
        } else {
          const valid = { ...(result.valid !== undefined ? { valid: result.valid } : {}), message: result.message };
          if (result.error === 'conflict') {
            reduceFailure({ type: 'failed', seq: head.seq, conflict: true, ...valid });
            notify.info(COPY.SAVE_CONFLICT, { label: COPY.REFRESH, onClick: () => deps.refresh() });
          } else if (result.error === 'auth') {
            reduceFailure({ type: 'failed', seq: head.seq, fatal: true, message: result.message });
            notify.error(result.message);
          } else if (result.error === 'unavailable') {
            reduceFailure({ type: 'failed', seq: head.seq, ...valid, unknown: true });
            unknownOutcome(result.message);
          } else {
            reduceFailure({ type: 'failed', seq: head.seq, ...valid });
            if (RETRYABLE.has(result.error)) notify.error(result.message, retry);
            else notify.error(result.message);
          }
        }
        pump();
      },
      () => {
        sending = null;
        reduceFailure({ type: 'failed', seq: head.seq, message: COPY.SAVE_OFFLINE, unknown: true });
        unknownOutcome(COPY.SAVE_OFFLINE);
        pump();
      },
    );
  };

  const release = (seq: number) => {
    const timer = timers.get(seq);
    if (timer === undefined) return;
    clearTimeout(timer);
    timers.delete(seq);
    released.add(seq);
    reduce({ type: 'release', seq });
    withdrawUndo(new Set([seq]));
    pump();
  };

  const cancel = (seq: number) => {
    const timer = timers.get(seq);
    if (timer === undefined) {
      if (released.has(seq)) deps.notify.info(COPY.UNDO_TOO_LATE);
      return;
    }
    clearTimeout(timer);
    timers.delete(seq);
    if (undoOwner?.seq === seq) undoOwner = null;
    reduce({ type: 'cancel', seq });
  };

  /** Undoes change `seq` while its toast still owns the undo slot; a change that failed or was dropped gave it up. */
  const undoChange = (seq: number, ...changes: C[]) => {
    if (undoOwner?.seq !== seq) return;
    undoOwner = null;
    // The file may have changed since the toast was offered (a refresh, a later change): only an undo that still
    // applies to what the person sees now is sent, so a list never stops half way on a refusal of its own making.
    const current = changes.map((change) => adapter.remap(change, state.idMap));
    if (!undoApplies(adapter, view(), current, { now: new Date().toISOString(), actor })) {
      deps.notify.info(COPY.UNDO_NOT_POSSIBLE);
      return;
    }
    // One change goes at once. Several go in order, each only after the one before is saved: if a link's delete fails,
    // the row it points at stays, so no link is left without its partner.
    const [first, ...rest] = changes;
    if (!first) return;
    if (rest.length === 0) {
      submit(first, { deferDelete: false });
      return;
    }
    void (async () => {
      for (const change of changes) if (!(await engine.apply(change, { deferDelete: false })).ok) return;
    })();
  };

  const submitBatch = (input: C[], batch: B, { quiet = false, label }: BatchOptions = {}): { outcome: BatchOutcome<T>; seq: number | null } => {
    if (!deps.remote.applyMany) throw new Error('This editor saves no batches');
    if (state.readOnly) return { outcome: { ok: false, error: 'invalid', message: readOnlyMessage, valid: 0 }, seq: null };
    // Every add gets a provisional id, so its row keeps one local id (and can be edited) until the batch is saved.
    const withIds = input.map((c) => {
      const add = asAdd(c);
      return add && provisionalIdOf(c) === null ? ({ ...add, values: { id: newId(add.entity), ...add.values } } as unknown as C) : c;
    });
    const work: Work<C, B> = { many: withIds.map((c) => adapter.remap(c, state.idMap)), batch };
    const item: QueueItem<C, B> = { seq: seqCounter + 1, work, localId: null, at: new Date().toISOString(), ...(quiet ? { quiet } : {}) };
    const before = view();
    const outcome = adapter.applyMany(before, work.many, stampFor(item, actor));
    if (!outcome.ok) return { outcome, seq: null };
    seqCounter = item.seq;
    reduce({ type: 'enqueue', item });
    pump();
    if (label) {
      // Whole groups, newest first, so a row that points at another goes before it. The steps inside one group stay
      // in order (a restored section's lifecycle follows its add). Offered when at least one change has an inverse.
      const groups = work.many.flatMap((change) => {
        const group = inverseGroup(adapter, change, before, provisionalIdOf(change));
        return group.length > 0 ? [group] : [];
      });
      const undo = groups.reverse().flat();
      // Only an undo that would apply is offered, as for a single change. The undo's adds keep their own ids (each is
      // sent as one change), so the check mints none.
      if (undo.length > 0 && undoApplies(adapter, outcome.value, undo, { now: item.at, actor })) offerUndo(item.seq, label, () => undoChange(item.seq, ...undo));
    }
    return { outcome, seq: item.seq };
  };

  const submit = (input: C, opts: DispatchOptions): { outcome: ApplyOutcome<T>; seq: number | null } => {
    if (state.readOnly) return { outcome: { ok: false, error: 'invalid', message: readOnlyMessage }, seq: null };
    const change = adapter.remap(input, state.idMap);
    const add = asAdd(change);
    // An add that already names its id keeps that id on screen. The save stamp does not mint one, so the stored row keeps it too.
    const item: QueueItem<C, B> = {
      seq: seqCounter + 1, work: { one: change }, localId: add ? (provisionalIdOf(change) ?? newId(add.entity)) : null, at: new Date().toISOString(),
      base: baseFor(adapter, state, change),
    };
    const before = view();
    const outcome = adapter.apply(before, change, stampFor(item, actor));
    if (!outcome.ok) return { outcome, seq: null };
    seqCounter = item.seq;

    if (change.kind === 'delete' && opts.deferDelete !== false) {
      reduce({ type: 'defer', item });
      timers.set(item.seq, setTimeout(() => release(item.seq), options.undoWindowMs));
      offerUndo(item.seq, opts.label ?? COPY.DELETED, () => cancel(item.seq));
      return { outcome, seq: item.seq };
    }

    reduce({ type: 'enqueue', item });
    pump();
    if (opts.label) {
      const undo = inverseGroup(adapter, change, before, item.localId);
      // Only an undo that would apply is offered.
      if (undo.length > 0 && undoApplies(adapter, outcome.value, undo, stampFor(item, actor))) offerUndo(item.seq, opts.label, () => undoChange(item.seq, ...undo));
    }
    return { outcome, seq: item.seq };
  };

  const engine: EditorEngine<T, C, B> = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    view,
    configure(next) {
      deps = next;
    },
    dispatch: (change, opts = {}) => submit(change, opts).outcome,
    apply(change, opts = {}) {
      const { outcome, seq } = submit(change, opts);
      if (!outcome.ok) {
        deps.notify.error(outcome.message);
        return Promise.resolve({ ok: false, message: outcome.message });
      }
      if (seq === null || !pending().has(seq)) return Promise.resolve({ ok: false });
      return new Promise((resolve) => waiters.set(seq, (event) => {
        if (event.type === 'succeeded' && event.seq === seq) return resolve({ ok: true, entityId: event.entityId });
        if (event.type !== 'failed' || event.seq !== seq) return resolve({ ok: false });
        resolve(event.unknown ? { ok: false, unknown: true } : { ok: false, ...(event.message !== undefined ? { message: event.message } : {}) });
      }));
    },
    applyMany(changes, batch, options = {}) {
      const { outcome, seq } = submitBatch(changes, batch, options);
      if (!outcome.ok) {
        if (!options.quiet) deps.notify.error(outcome.message);
        return Promise.resolve({ ok: false, valid: outcome.valid, message: outcome.message });
      }
      if (seq === null || !pending().has(seq)) return Promise.resolve({ ok: false });
      return new Promise((resolve) => waiters.set(seq, (event) => {
        if (event.type === 'succeeded' && event.seq === seq) return resolve({ ok: true, entityIds: event.entityIds ?? [] });
        if (event.type !== 'failed' || event.seq !== seq) return resolve({ ok: false });
        resolve({
          ok: false, ...(event.valid !== undefined ? { valid: event.valid } : {}),
          ...(event.message !== undefined ? { message: event.message } : {}), ...(event.unknown ? { unknown: true } : {}),
        });
      }));
    },
    dispatchMany: (changes, batch, options = {}) => submitBatch(changes, batch, { label: options.label }).outcome,
    undo() {
      const owner = undoOwner;
      if (!owner) return;
      deps.notify.dismissUndo();
      owner.run();
    },
    cancel,
    releaseAll() {
      for (const seq of [...timers.keys()]) release(seq);
    },
    refresh(snapshot) {
      reduce({ type: 'refresh', snapshot });
    },
  };
  return engine;
}

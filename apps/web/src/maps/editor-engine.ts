// The MAP editor engine: who may make a change is core's `canChangeMap`, a change is applied with `applyMapChange`, and the words are COPY's.
import {
  applyMapChange, canChangeMap, joinPlan, mapValidationFor, newMapEntityId,
  type IsoDateTime, type MapActor, type MapApplyOutcome, type MapChange,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { baseFor, editorReducer, expectedFor, initEditor, isStampedUpdate, localIdsFor, prepareForSend, remapChange, viewOf, type EditorEvent, type EditorState, type QueueItem } from './editor';
import { inverseOf } from './inverse';
import type { Notify } from './notify';
import type { MapSnapshot, PlanRemote, RemoteErrorCode } from './remote';

export interface DispatchOptions {
  /** Shown in the undo toast, e.g. "Marked done". Without a label no undo is offered. */
  label?: string;
  /** Deletes are held back for the undo window unless this is false (undoing an add deletes at once). */
  deferDelete?: boolean;
}

export interface EngineDeps {
  remote: PlanRemote;
  notify: Notify;
  actor: MapActor;
  /** Stamps the optimistic version's Updated by until the server's comes back. */
  actorName: string;
  /**
   * The page shows the Reconnect Google banner when a save needs Google again (`needsGoogle`), so the owner's `auth`
   * answer gets no toast. Without it the toast says so, without Retry (question 16).
   */
  showsReconnect?: boolean;
  /** Why nothing saves while the page needs a new sign-in, in the edition's words (plan 14). Default: hosted's. */
  readOnlyMessage?: string;
}

export interface EditorEngine {
  subscribe(listener: () => void): () => void;
  getState(): EditorState;
  configure(deps: EngineDeps): void;
  dispatch(change: MapChange, options?: DispatchOptions): MapApplyOutcome;
  /** Cancels a delete that is still held back. Once it has been released, tells the user it is too late. */
  cancel(seq: number): void;
  /** Releases every held-back delete now. Idempotent. */
  releaseAll(): void;
  /** Takes a newer server snapshot as the confirmed plan; queued and held-back changes stay on top of it. */
  refresh(snapshot: MapSnapshot): void;
}

/** Retrying can't help when the change itself was refused, or while a link holder's plan is read-only. */
const retryable = (code: RemoteErrorCode, actor: MapActor): boolean =>
  !(code === 'forbidden' || code === 'invalid' || code === 'not_found' || (code === 'auth' && actor.kind === 'link'));

/** The change that owns the one undo toast, and how far it has got. */
interface UndoOwner {
  seq: number;
  /** For an activity or review row update the server confirmed: the updatedAt that write produced. */
  producedAt?: IsoDateTime | null;
}

/**
 * The sync engine: owns the editor state and sends the queue one change at a time.
 * Plain TypeScript with no React, so it keeps draining while its component is hidden or unmounted.
 *
 * This is the deliberately effectful layer: it reads the clock, runs the undo-window timers, calls the
 * network and shows toasts. The state rules it applies live in the pure `editor.ts`.
 */
export function createEditorEngine(options: EngineDeps & { initial: MapSnapshot; undoWindowMs: number }): EditorEngine {
  let deps: EngineDeps = {
    remote: options.remote, notify: options.notify, actor: options.actor, actorName: options.actorName, showsReconnect: options.showsReconnect ?? false,
  };
  let state = initEditor(options.initial);
  let seqCounter = 0;
  let sending: number | null = null;
  let undoOwner: UndoOwner | null = null;
  const listeners = new Set<() => void>();
  const timers = new Map<number, ReturnType<typeof setTimeout>>();
  /** Held deletes that have been sent, so a late Undo can say so. */
  const released = new Set<number>();

  const reduce = (event: EditorEvent) => {
    const next = editorReducer(state, event);
    if (next === state) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };

  const offerUndo = (seq: number, label: string, onUndo: () => void) => {
    undoOwner = { seq };
    deps.notify.undo(label, onUndo);
  };

  /** Removes the undo toast if one of these changes owns it: there is nothing left for it to undo. */
  const withdrawUndo = (seqs: ReadonlySet<number>) => {
    if (undoOwner === null || !seqs.has(undoOwner.seq)) return;
    undoOwner = null;
    deps.notify.dismissUndo();
  };

  /** Applies a failure and withdraws the undo toast if it belonged to the failed change or one dropped with it. */
  const reduceFailure = (event: Extract<EditorEvent, { type: 'failed' }>) => {
    const before = [...state.queue, ...state.deferred].map((i) => i.seq);
    reduce(event);
    const remaining = new Set([...state.queue, ...state.deferred].map((i) => i.seq));
    const dropped = new Set(before.filter((seq) => !remaining.has(seq)));
    for (const seq of dropped) {
      const timer = timers.get(seq);
      if (timer !== undefined) {
        clearTimeout(timer);
        timers.delete(seq);
      }
    }
    withdrawUndo(dropped);
  };

  const pump = () => {
    const head = state.queue[0];
    if (sending !== null || !head) return;
    sending = head.seq;
    const { remote, notify } = deps;
    const retry = () => engine.dispatch(head.change);
    const outcome = Promise.resolve().then(() => remote(prepareForSend(state, head)));
    outcome.then(
      (result) => {
        sending = null;
        if (result.ok) {
          reduce({ type: 'succeeded', seq: head.seq, snapshot: result.snapshot, entityId: result.entityId });
          if (undoOwner?.seq === head.seq) {
            const change = remapChange(head.change, state.idMap);
            if (isStampedUpdate(change)) {
              const rows = change.entity === 'review' ? result.snapshot.value.reviews : result.snapshot.value.activities;
              undoOwner.producedAt = rows.find((row) => row.id === change.id)?.updatedAt;
            }
          }
        } else if (result.error === 'auth' && deps.actor.kind === 'owner') {
          // Retry can't bring Google back (question 16). The queue and the held deletes go (their timers with them), and no
          // Undo is left on screen, since nothing more can be sent. A page with the Reconnect Google banner says it there;
          // any other page keeps the message, without Retry.
          reduceFailure({ type: 'failed', seq: head.seq, fatal: true });
          if (undoOwner !== null) {
            undoOwner = null;
            notify.dismissUndo();
          }
          if (!deps.showsReconnect) notify.error(result.message);
        } else {
          const conflict = result.error === 'conflict';
          reduceFailure({ type: 'failed', seq: head.seq, ...(result.snapshot ? { snapshot: result.snapshot } : {}), conflict });
          if (conflict) notify.info(COPY.MAP_LATEST_VERSION(result.message));
          else if (retryable(result.error, deps.actor)) notify.error(result.message, retry);
          else notify.error(result.message);
        }
        pump();
      },
      () => {
        sending = null;
        reduceFailure({ type: 'failed', seq: head.seq });
        notify.error(COPY.SAVE_OFFLINE, retry);
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

  /** Queues a change. `base` overrides the conflict base read from the confirmed plan. */
  const submit = (input: MapChange, opts: DispatchOptions, override?: { base: IsoDateTime | null }): MapApplyOutcome => {
    if (state.needsGoogle) return { ok: false, error: 'invalid', message: options.readOnlyMessage ?? COPY.SAVE_READ_ONLY };
    const { actor, actorName } = deps;
    const { record, startedOn } = state.confirmed;
    const change = remapChange(input, state.idMap);
    const localId = change.kind === 'add' ? newMapEntityId(change.entity) : null;
    const at = new Date().toISOString();
    const validate = mapValidationFor(actor);
    const before = viewOf(state, actorName, validate);
    const outcome = applyMapChange(before, change, { now: at, actorName, newId: localIdsFor(seqCounter + 1, localId), validate }, record);
    if (!outcome.ok) return outcome;

    seqCounter += 1;
    const base = override ? override.base : baseFor(state, change);
    const expected = expectedFor(state, change);
    const item: QueueItem = { seq: seqCounter, change, localId, at, ...(base !== undefined ? { base } : {}), ...(expected ? { expected } : {}) };

    if (change.kind === 'delete' && opts.deferDelete !== false) {
      reduce({ type: 'defer', item });
      timers.set(item.seq, setTimeout(() => release(item.seq), options.undoWindowMs));
      offerUndo(item.seq, opts.label ?? COPY.DELETED, () => engine.cancel(item.seq));
      return outcome;
    }

    reduce({ type: 'enqueue', item });
    pump();
    if (opts.label) {
      const inverse = inverseOf(joinPlan(before, record, startedOn), change, localId);
      // Only an undo that would apply is offered.
      const undoable = inverse !== null && canChangeMap(actor, inverse, outcome.plan).allowed
        && applyMapChange(outcome.plan, inverse, { now: at, actorName, validate }, record).ok;
      if (inverse && undoable) {
        offerUndo(item.seq, opts.label, () => undo(item.seq, inverse));
      }
    }
    return outcome;
  };

  /**
   * Undoes change `seq` while its toast still owns the undo slot. A change that failed, conflicted or was
   * dropped has given the slot up, so its Undo does nothing. Once the server confirmed an activity update,
   * the inverse is based on the version that write produced, so an edit made by someone else since conflicts.
   */
  const undo = (seq: number, inverse: MapChange) => {
    const owner = undoOwner;
    if (owner === null) {
      deps.notify.dismissUndo();
      return;
    }
    if (owner.seq !== seq) return;
    undoOwner = null;
    submit(inverse, { deferDelete: false }, owner.producedAt !== undefined ? { base: owner.producedAt } : undefined);
  };

  const engine: EditorEngine = {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: () => state,
    configure(next) {
      deps = next;
    },
    dispatch(input, opts = {}) {
      return submit(input, opts);
    },
    cancel(seq) {
      const timer = timers.get(seq);
      if (timer === undefined) {
        if (released.has(seq)) deps.notify.info(COPY.UNDO_TOO_LATE);
        return;
      }
      clearTimeout(timer);
      timers.delete(seq);
      if (undoOwner?.seq === seq) undoOwner = null;
      reduce({ type: 'cancel', seq });
    },
    releaseAll() {
      for (const seq of [...timers.keys()]) release(seq);
    },
    refresh(snapshot) {
      reduce({ type: 'refresh', snapshot });
    },
  };
  return engine;
}

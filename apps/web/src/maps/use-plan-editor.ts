'use client';

// The plan it gives is the MAP joined with the partner record (`joinPlan`), as every screen shows it.
import {
  canChangeMap, joinPlan, mapValidationFor,
  type IsoDateTime, type JoinedPlan, type MapActor, type MapApplyOutcome, type MapChange, type MapRecord,
} from '@partner-desk/core';
import type { RowIssue } from '@partner-desk/storage';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { saveStateOf, viewOf } from './editor';
import { createEditorEngine, type DispatchOptions } from './editor-engine';
import { sonnerNotify, type Notify } from './notify';
import type { MapSnapshot, PlanRemote } from './remote';
import { useCopy } from '@/storage-context';

export const UNDO_WINDOW_MS = 5000;
export type SaveState = 'saved' | 'saving' | 'failed';

export type { DispatchOptions };

export interface PlanEditor {
  /** The MAP as the person sees it, joined with the partner record. */
  plan: JoinedPlan;
  record: MapRecord;
  issues: RowIssue[];
  /** What health counts "no progress" from: the last change the server confirmed (ruling R6). */
  lastEventAt: IsoDateTime;
  saveState: SaveState;
  /** How many changes have failed since the page opened. */
  failures: number;
  /** A save answered that Google needs reconnecting: nothing can be changed until the owner signs in again (question 16). */
  needsGoogle: boolean;
  dispatch: (change: MapChange, options?: DispatchOptions) => MapApplyOutcome;
  allowed: (change: MapChange) => boolean;
  /** The id an item has now: a new item's local id maps to the server's once the add is saved. */
  idFor: (id: string) => string;
}

export interface UsePlanEditorOptions {
  /** Keep it referentially stable: a new object is taken as a fresh snapshot from the server. */
  initial: MapSnapshot;
  remote: PlanRemote;
  actor: MapActor;
  actorName: string;
  notify?: Notify;
  undoWindowMs?: number;
  /** The page shows the Reconnect Google banner when `needsGoogle`: the owner's lost Google then gets no toast. */
  showsReconnect?: boolean;
}

export function usePlanEditor({
  initial, remote, actor, actorName, notify = sonnerNotify, undoWindowMs = UNDO_WINDOW_MS, showsReconnect = false,
}: UsePlanEditorOptions): PlanEditor {
  const words = useCopy();
  const [engine] = useState(() => createEditorEngine({ initial, remote, notify, actor, actorName, undoWindowMs, showsReconnect, readOnlyMessage: words.SAVE_READ_ONLY }));
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  const { record, startedOn, issues, lastProgressAt } = state.confirmed;
  const plan = useMemo(
    () => joinPlan(viewOf(state, actorName, mapValidationFor(actor)), record, startedOn),
    [state, actorName, actor, record, startedOn],
  );

  useEffect(() => {
    engine.configure({ remote, notify, actor, actorName, showsReconnect });
  }, [engine, remote, notify, actor, actorName, showsReconnect]);

  // Next keeps the page instance on a client-side revisit and passes a fresh server snapshot as `initial`.
  // Take it as the confirmed plan (not on mount: the engine already started from it).
  const seenInitial = useRef(initial);
  useEffect(() => {
    if (seenInitial.current === initial) return;
    seenInitial.current = initial;
    engine.refresh(initial);
  }, [engine, initial]);

  // Leaving or hiding the page commits held-back deletes now; the engine keeps sending without us.
  useEffect(() => () => engine.releaseAll(), [engine]);

  const saveState = saveStateOf(state);
  useEffect(() => {
    if (saveState !== 'saving') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saveState]);

  const dispatch = useCallback((change: MapChange, options?: DispatchOptions): MapApplyOutcome => engine.dispatch(change, options), [engine]);
  const allowed = useCallback((change: MapChange) => canChangeMap(actor, change, plan).allowed, [actor, plan]);

  const idFor = useCallback((id: string) => state.idMap[id] ?? id, [state.idMap]);

  return { plan, record, issues, lastEventAt: lastProgressAt, saveState, failures: state.failures, needsGoogle: state.needsGoogle, dispatch, allowed, idFor };
}

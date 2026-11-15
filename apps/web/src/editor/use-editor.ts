'use client';

// The editor hook, generic over the aggregate.
import type { ApplyOutcome } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { RowIssue, Snapshot } from '@partner-desk/storage';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  createEditorEngine, savedIdOf, saveStateOf,
  type BatchOptions, type BatchOutcome, type BatchSaveOutcome, type DispatchOptions, type EditorAdapter, type EditorChange, type Notify, type SaveOutcome, type SaveState,
} from './engine';
import type { EditorRemote } from './remote';
import { useCopy, useViewer } from '@/storage-context';

export const UNDO_WINDOW_MS = 5000;
const UNDO_TOAST_ID = 'editor-undo';

export type { BatchOptions, BatchOutcome, BatchSaveOutcome, DispatchOptions, SaveOutcome, SaveState };

export const sonnerNotify: Notify = {
  undo(label, onUndo) {
    toast(label, { id: UNDO_TOAST_ID, duration: UNDO_WINDOW_MS, action: { label: COPY.UNDO, onClick: onUndo } });
  },
  dismissUndo() {
    toast.dismiss(UNDO_TOAST_ID);
  },
  error(message, action) {
    toast.error(message, action ? { action } : undefined);
  },
  info(message, action) {
    toast(message, action ? { action } : undefined);
  },
};

export interface Editor<T, C, B> {
  /** The value as the person sees it: the last saved one with their unsaved changes on top. */
  value: T;
  /** Rows the file has that couldn't be read. */
  issues: RowIssue[];
  saving: SaveState;
  /** Google needs reconnecting (or the person is signed out): changes are refused until they sign in again. */
  readOnly: boolean;
  /**
   * Applies a change at once and saves it; resolves when it is saved (with a new row's server id) or has failed
   * (errors show as toasts).
   */
  apply: (change: C, options?: DispatchOptions) => Promise<SaveOutcome>;
  /** Applies a batch (an import) at once and saves it in one request, all or nothing. Undo only with a `label`. */
  applyMany: (changes: C[], batch: B, options?: BatchOptions) => Promise<BatchSaveOutcome>;
  /** `applyMany` for forms that show why a batch can't be saved: returns the local outcome at once. */
  dispatchMany: (changes: C[], batch: B, options?: Pick<BatchOptions, 'label'>) => BatchOutcome<T>;
  /** `apply` for fields that show why a value can't be saved: returns the local outcome at once. */
  dispatch: (change: C, options?: DispatchOptions) => ApplyOutcome<T>;
  /** Undoes the last change that offered an undo. */
  undo: () => void;
  /** The id a row has now: a new row's local id maps to the server's once its add is saved. */
  idFor: (id: string) => string;
  /** The id a link to a row may use: the saved id, or null while the row's add is still being saved. */
  savedIdFor: (id: string) => string | null;
  /**
   * Takes the file as another save wrote it (an accepted proposal writes the market and the Partner book in one
   * answer), as a page refresh does: unsaved changes stay on top of it.
   */
  refresh: (snapshot: Snapshot<T>) => void;
}

export interface EditorOptions<T, C extends EditorChange, B> {
  /** Core's rules for this aggregate: `partnersAdapter` or `marketAdapter`. */
  adapter: EditorAdapter<T, C>;
  /** Must be referentially stable (module-level, useState or useMemo). */
  remote: EditorRemote<T, C, B>;
  notify?: Notify;
  undoWindowMs?: number;
  /** The person's name, shown on a change until the server's copy comes back. */
  actor?: string;
}

/**
 * A page's editor: optimistic changes, saved one at a time, with undo. `initial` must be referentially stable; a new
 * object (a fresh server render after Refresh) replaces the confirmed value.
 */
export function useEditor<T, C extends EditorChange, B = undefined>(
  initial: Snapshot<T>,
  { adapter, remote, notify = sonnerNotify, undoWindowMs = UNDO_WINDOW_MS, actor }: EditorOptions<T, C, B>,
): Editor<T, C, B> {
  const router = useRouter();
  const words = useCopy();
  const viewer = useViewer();
  const [engine] = useState(() => createEditorEngine<T, C, B>({
    initial, adapter, remote, notify, undoWindowMs, actor, refresh: () => router.refresh(),
    readOnlyMessage: viewer ? COPY.VIEWER_READ_ONLY : words.SAVE_READ_ONLY, startReadOnly: viewer,
  }));
  const state = useSyncExternalStore(engine.subscribe, engine.getState, engine.getState);
  // The engine works the view out once per state.
  const value = engine.view(state);

  useEffect(() => {
    engine.configure({ remote, notify, refresh: () => router.refresh() });
  }, [engine, remote, notify, router]);

  // Next keeps the page instance on a refresh or revisit and passes a fresh server snapshot as `initial`.
  const seenInitial = useRef(initial);
  useEffect(() => {
    if (seenInitial.current === initial) return;
    seenInitial.current = initial;
    engine.refresh(initial);
  }, [engine, initial]);

  // Leaving the page commits held-back deletes now; the engine keeps sending without us.
  useEffect(() => () => engine.releaseAll(), [engine]);

  const saving = saveStateOf(state);
  useEffect(() => {
    if (saving !== 'saving') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [saving]);

  const apply = useCallback((change: C, options?: DispatchOptions) => engine.apply(change, options), [engine]);
  const applyMany = useCallback((changes: C[], batch: B, options?: BatchOptions) => engine.applyMany(changes, batch, options), [engine]);
  const dispatch = useCallback((change: C, options?: DispatchOptions) => engine.dispatch(change, options), [engine]);
  const dispatchMany = useCallback((changes: C[], batch: B, options?: Pick<BatchOptions, 'label'>) => engine.dispatchMany(changes, batch, options), [engine]);
  const undo = useCallback(() => engine.undo(), [engine]);
  const idFor = useCallback((id: string) => state.idMap[id] ?? id, [state.idMap]);
  const savedIdFor = useCallback((id: string) => savedIdOf(state, id), [state]);
  const refresh = useCallback((snapshot: Snapshot<T>) => engine.refresh(snapshot), [engine]);

  return { value, issues: state.confirmed.issues, saving, readOnly: state.readOnly, apply, applyMany, dispatch, dispatchMany, undo, idFor, savedIdFor, refresh };
}

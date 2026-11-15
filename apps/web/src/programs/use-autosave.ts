'use client';

import { COPY } from '@partner-desk/copy';
import { useEffect, useEffectEvent, useRef, useState } from 'react';

/**
 * `retry`: the save itself failed, so Try again can send it again (a value with a mistake waits for the fix instead).
 * `stopped`: a refusal that saving again can't get past (the record changed somewhere else); nothing more is sent.
 */
export type SaveStatus =
  | { kind: 'idle' } | { kind: 'unsaved' } | { kind: 'saving' } | { kind: 'saved' }
  | { kind: 'error'; message: string; retry: boolean }
  | { kind: 'stopped'; message: string };

export type SaveOutcome = { ok: true } | { ok: false; message: string };

const SAVE_DELAY_MS = 800;
const SOMETHING_WRONG = COPY.SOMETHING_WRONG;

const same = <T,>(a: T, b: T) => a === b || JSON.stringify(a) === JSON.stringify(b);

export interface AutosaveOptions<T, R extends SaveOutcome> {
  initial: T;
  /** What to send for `value`, or the first thing wrong with it: a value with a mistake is never sent. */
  prepare: (value: T) => { ok: true; value: T } | { ok: false; message: string };
  save: (value: T) => Promise<R>;
  /** Runs when a save returns, before the next save goes out. */
  onSaved?: (result: R, sent: T) => void;
  /** A refusal after which no save can work: saving stops for good (no saves on edit or on leave, no Try again). */
  stops?: (result: R) => boolean;
  /**
   * Read only (a company server's viewer, owner 2026-11-14): a change is neither shown nor saved, so nothing typed is
   * ever lost to a refused save. The page closes its fields too; this is the second lock.
   */
  readOnly?: boolean;
}

/**
 * Saves what is on screen 800 ms after the last change. One save at a time: a change made while a save runs is saved
 * when it returns. "Unsaved" means what is on screen differs from what was last saved (as it was on screen when sent),
 * so a failed save stays unsaved: Try again sends it again, leaving the screen sends it, and closing or reloading the
 * tab asks first. A refusal that `stops` names ends saving: the status says what to do instead.
 */
export function useAutosave<T, R extends SaveOutcome>({ initial, prepare, save, onSaved, stops, readOnly = false }: AutosaveOptions<T, R>) {
  const [value, setValue] = useState(initial);
  const [status, setStatus] = useState<SaveStatus>({ kind: 'idle' });
  const latest = useRef(initial); // the value as it is now, for a save that runs later
  const stored = useRef(initial); // the value as last saved (as it was on screen when sent)
  const version = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The save in flight, if any: a flush waits for it before it sends what is still unsaved. */
  const running = useRef<Promise<SaveOutcome> | null>(null);
  /** Why saving stopped for good, once it has. */
  const stopped = useRef<string | null>(null);

  const dirty = () => !same(latest.current, stored.current);

  /** Puts `next` on screen and saves it after the pause. */
  function update(next: T) {
    if (readOnly) return;
    latest.current = next;
    version.current += 1;
    setValue(next);
    if (stopped.current !== null) return; // the status keeps saying why, and what to do
    if (!running.current) setStatus({ kind: 'unsaved' });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, SAVE_DELAY_MS);
  }

  /** Puts `next` on screen without saving it: for a value that matches what is stored. */
  function show(next: T) {
    latest.current = next;
    setValue(next);
  }

  /**
   * Sends what isn't saved now: after the save in flight returns, then again for a change made meanwhile. Resolves once
   * what is on screen is saved, or with why it isn't: a mistake in it, a failed save, or saving stopped.
   */
  async function flush(): Promise<SaveOutcome> {
    for (;;) {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      while (running.current) await running.current;
      if (stopped.current !== null) return { ok: false, message: stopped.current };
      if (!dirty()) {
        setStatus((now) => (now.kind === 'unsaved' ? { kind: 'saved' } : now));
        return { ok: true };
      }
      const sent = latest.current;
      const prepared = prepare(sent);
      if (!prepared.ok) {
        const message = COPY.NOT_SAVED_BECAUSE(prepared.message);
        setStatus({ kind: 'error', message, retry: false });
        return { ok: false, message };
      }
      const outcome = await send(sent, prepared.value);
      if (!outcome.ok) return outcome;
    }
  }

  /** Saves `value`, prepared from `sent` (the value on screen). The one save in flight until it returns. */
  function send(sent: T, value: T): Promise<SaveOutcome> {
    const at = version.current;
    setStatus({ kind: 'saving' });
    const run = (async (): Promise<SaveOutcome> => {
      let result: R | { ok: false; message: string };
      try {
        result = await save(value);
      } catch {
        result = { ok: false, message: SOMETHING_WRONG };
      }
      running.current = null;
      if (result.ok) stored.current = sent;
      onSaved?.(result as R, sent);
      if (!result.ok && stops?.(result as R)) {
        stopped.current = result.message;
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        setStatus({ kind: 'stopped', message: result.message });
      } else if (version.current !== at) {
        // A change made while this save ran is sent now, unless its pause is still running.
        if (!timer.current) void flush();
      } else {
        setStatus(result.ok ? { kind: 'saved' } : { kind: 'error', message: result.message, retry: dirty() });
      }
      return result.ok ? { ok: true } : { ok: false, message: result.message };
    })();
    running.current = run;
    return run;
  }

  // Leaving the page (another screen in the app) still sends what isn't saved; closing or reloading the tab asks first.
  // Once saving has stopped, reloading is what the owner is asked to do, so it doesn't ask first.
  const saveOnLeave = useEffectEvent(() => {
    if (dirty() && stopped.current === null) void flush();
  });
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (stopped.current === null && (running.current || dirty())) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      saveOnLeave();
    };
  }, []);

  return {
    value,
    status,
    /** The value as it is now, also inside a handler that runs before the next render. */
    latest: () => latest.current,
    /** The value as last saved. */
    stored: () => stored.current,
    update,
    show,
    flush,
  };
}

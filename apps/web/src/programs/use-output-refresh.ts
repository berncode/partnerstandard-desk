'use client';

// The address is PartnerStandard Desk's route, and the provider sits around one program (its layout).

import { createContext, createElement, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useViewer } from '@/storage-context';
import { MAX_OUTPUT_IDS, type Rewritten } from './outputs';

/** How long after the last change the Program Sheet and public page are rewritten. */
export const REFRESH_DELAY_MS = 30_000;
/** A program rewritten this recently, with nothing saved since, isn't rewritten again when it or an output opens. */
export const OPEN_FRESH_MS = 5_000;
/**
 * Where every rewrite goes: a plain POST, never a server action. Next runs a page's server actions one at a time, so a
 * rewrite sent as one would hold up every save behind it. A closing tab beacons here too.
 */
const OUTPUTS_URL = '/api/programs/outputs';

export interface OutputRefresh {
  /** Rewrites these programs' outputs 30 seconds after the last call, together with everything else queued. */
  queue(ids: string[]): void;
  /** Rewrites these programs' outputs now (all queued ones when none are named). Resolves once done; never rejects. */
  flush(ids?: string[]): Promise<void>;
  /**
   * These programs (or one of their outputs) just opened: rewrites the ones not rewritten in the last few seconds
   * with nothing saved since, and not already on their way. Opening a program at its Program Sheet rewrites it once.
   * Resolves once done; never rejects.
   */
  open(ids: string[]): Promise<void>;
  /** Drops these programs from everything queued, waiting or failed (a deleted program): they are not sent again. */
  forget(ids: string[]): void;
  /** These programs' outputs were just rewritten another way (Open in Google Sheets): they are no longer failed. */
  cleared(ids: string[]): void;
  /**
   * These programs' outputs should have been rewritten another way but weren't (Open in Google Sheets opened without it):
   * they count as failed, and go with the next rewrite.
   */
  missed(ids: string[]): void;
  /**
   * Programs whose last rewrite didn't happen. One the storage failed on is sent again with the next rewrite,
   * whatever starts it; one the store refused (it can't be read, say) only when it is asked for again: its screen opens,
   * or it is saved.
   */
  failed: string[];
}

const OutputRefreshContext = createContext<OutputRefresh | null>(null);

/** Only the ids of `batch` that `value` lists. */
const idsIn = (value: unknown, batch: string[]): string[] => (Array.isArray(value) ? batch.filter((id) => value.includes(id)) : []);

/**
 * Sends one batch to POST /api/programs/outputs and reads which rewrites didn't happen. A call that fails (offline, signed out,
 * a server error) counts every id as failed, so it is tried again.
 */
async function rewrite(batch: string[]): Promise<Rewritten> {
  try {
    const response = await fetch(OUTPUTS_URL, {
      method: 'POST', keepalive: false, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ programIds: batch }),
    });
    if (!response.ok) return { failed: batch, refused: [] };
    const answer = (await response.json()) as Partial<Rewritten> | null;
    return { failed: idsIn(answer?.failed, batch), refused: idsIn(answer?.refused, batch) };
  } catch {
    return { failed: batch, refused: [] };
  }
}

const batches = (ids: string[]): string[][] => {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_OUTPUT_IDS) out.push(ids.slice(i, i + MAX_OUTPUT_IDS));
  return out;
};

/**
 * The output scheduler of one program's screens (its layout, ProgramHost, gives it). Rewrites go out one call at a time, at most
 * 50 programs a call. When the tab is left (pagehide), or the designer closes (another company, Settings), what is
 * still queued goes with navigator.sendBeacon, so the stored copy doesn't wait for the next visit.
 */
export function OutputRefreshProvider({ children }: { children: ReactNode }) {
  const scheduler = useOutputScheduler();
  // A company server's viewer changes nothing, so nothing is rewritten for them: a rewrite is a save (plan 15).
  const viewer = useViewer();
  const value = useMemo(() => (viewer ? NO_REWRITES : scheduler), [viewer, scheduler]);
  return createElement(OutputRefreshContext, { value }, children);
}

/** A viewer's outputs: nothing is queued or sent, and nothing failed. */
const NO_REWRITES: OutputRefresh = {
  queue: () => {}, flush: async () => {}, open: async () => {}, forget: () => {}, cleared: () => {}, missed: () => {}, failed: [],
};

/** The scheduler behind OutputRefreshProvider. */
function useOutputScheduler(): OutputRefresh {
  /** Queued, waiting for the pause to end. */
  const pending = useRef(new Set<string>());
  /** Handed to a rewrite that hasn't sent them yet: it waits behind the one in flight, or for its turn in a long run. */
  const waiting = useRef(new Set<string>());
  /** The batch being sent now: neither waiting nor beaconed. */
  const inFlight = useRef(new Set<string>());
  /** Failed last time: sent again with the next rewrite. */
  const failing = useRef(new Set<string>());
  /** Refused last time: shown as failed, sent again only when asked for by name (flush or queue). */
  const refused = useRef(new Set<string>());
  const [failed, setFailed] = useState<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When each program was last rewritten, while nothing was saved since (a queue forgets it). */
  const doneAt = useRef(new Map<string, number>());
  /** The rewrite in flight, if any: the next one starts after it. */
  const chain = useRef<Promise<void>>(Promise.resolve());

  const showFailed = useCallback(() => {
    setFailed([...new Set([...failing.current, ...refused.current])]);
  }, []);

  const stopTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  /**
   * Once the rewrite in flight is done, sends everything waiting (and whatever failed before), at most 50 a call. Ids
   * leave `waiting` only as their batch starts, so a closing tab can still beacon the rest.
   */
  const run = useCallback((): Promise<void> => {
    const next = chain.current.then(async () => {
      for (const id of failing.current) waiting.current.add(id);
      if (waiting.current.size === 0) return;
      while (waiting.current.size > 0) {
        const batch = [...waiting.current].slice(0, MAX_OUTPUT_IDS);
        for (const id of batch) {
          waiting.current.delete(id);
          inFlight.current.add(id);
        }
        const answer = await rewrite(batch);
        inFlight.current.clear();
        for (const id of batch) {
          failing.current.delete(id);
          refused.current.delete(id);
        }
        for (const id of answer.failed) failing.current.add(id);
        for (const id of answer.refused) refused.current.add(id);
        const at = Date.now();
        for (const id of batch) {
          if (failing.current.has(id) || refused.current.has(id)) doneAt.current.delete(id);
          else doneAt.current.set(id, at);
        }
      }
      showFailed();
    });
    chain.current = next;
    return next;
  }, [showFailed]);

  const flush = useCallback((ids?: string[]): Promise<void> => {
    const now = ids ?? [...pending.current];
    for (const id of now) {
      pending.current.delete(id);
      waiting.current.add(id);
    }
    if (pending.current.size === 0) stopTimer();
    return run();
  }, [run, stopTimer]);

  const open = useCallback((ids: string[]): Promise<void> => {
    const now = Date.now();
    const fresh = (id: string) => {
      if (pending.current.has(id) || failing.current.has(id) || refused.current.has(id)) return false;
      if (waiting.current.has(id) || inFlight.current.has(id)) return true;
      const at = doneAt.current.get(id);
      return at !== undefined && now - at < OPEN_FRESH_MS;
    };
    const stale = ids.filter((id) => !fresh(id));
    return stale.length > 0 ? flush(stale) : chain.current;
  }, [flush]);

  const queue = useCallback((ids: string[]) => {
    for (const id of ids) {
      pending.current.add(id);
      doneAt.current.delete(id);
    }
    stopTimer();
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, REFRESH_DELAY_MS);
  }, [flush, stopTimer]);

  const forget = useCallback((ids: string[]) => {
    for (const id of ids) {
      doneAt.current.delete(id);
      pending.current.delete(id);
      waiting.current.delete(id);
      failing.current.delete(id);
      refused.current.delete(id);
    }
    if (pending.current.size === 0) stopTimer();
    setFailed((now) => (now.some((id) => ids.includes(id)) ? now.filter((id) => !ids.includes(id)) : now));
  }, [stopTimer]);

  const cleared = useCallback((ids: string[]) => {
    for (const id of ids) {
      failing.current.delete(id);
      refused.current.delete(id);
    }
    setFailed((now) => (now.some((id) => ids.includes(id)) ? now.filter((id) => !ids.includes(id)) : now));
  }, []);

  const missed = useCallback((ids: string[]) => {
    for (const id of ids) {
      refused.current.delete(id);
      failing.current.add(id);
    }
    showFailed();
  }, [showFailed]);

  /**
   * Hands everything not yet sent (queued, waiting behind the rewrite in flight, failed) to the browser, which sends it
   * even as the page goes away. The batch in flight is left to its own call, and refused ones to their next trigger.
   * What is beaconed is never sent again.
   */
  const beacon = useCallback(() => {
    stopTimer();
    const all = [...new Set([...pending.current, ...waiting.current, ...failing.current])].filter((id) => !inFlight.current.has(id));
    pending.current.clear();
    waiting.current.clear();
    for (const id of all) failing.current.delete(id);
    if (all.length === 0) return;
    showFailed();
    if (typeof navigator.sendBeacon !== 'function') return;
    for (const batch of batches(all)) navigator.sendBeacon(OUTPUTS_URL, JSON.stringify({ programIds: batch }));
  }, [stopTimer, showFailed]);

  useEffect(() => {
    window.addEventListener('pagehide', beacon);
    return () => {
      window.removeEventListener('pagehide', beacon);
      beacon();
    };
  }, [beacon]);

  return useMemo<OutputRefresh>(() => ({ queue, flush, open, forget, cleared, missed, failed }), [queue, flush, open, forget, cleared, missed, failed]);
}

/** The output scheduler of the company on screen. Only inside ProgramHost (or OutputRefreshProvider, in tests). */
export function useOutputRefresh(): OutputRefresh {
  const refresh = useContext(OutputRefreshContext);
  if (!refresh) throw new Error('useOutputRefresh needs OutputRefreshProvider: render the screen inside ProgramHost');
  return refresh;
}

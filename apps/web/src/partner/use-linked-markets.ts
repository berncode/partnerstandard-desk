'use client';

import type { Market, MarketChange } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorRemote, RemoteResult } from '@/editor/remote';
import type { AddHypothesis } from './partner-context';
import type { MarketState } from './partner-model';

export interface MarketAccess {
  read: (marketId: string) => Promise<RemoteResult<Market>>;
  remoteFor: (marketId: string) => EditorRemote<Market, MarketChange>;
}

const stateOf = (result: RemoteResult<Market>): MarketState =>
  (result.ok ? { status: 'ready', market: result.snapshot.value } : { status: 'failed', message: result.message });

/**
 * The files of the markets a partner is linked to. The server hands over those it read with the page; a market linked
 * later (Add to a market) is read here once. Adding a partner hypothesis saves it to the market and keeps the answer.
 * `initial` must be referentially stable: a new object (a fresh server render) replaces the files the page has.
 */
export function useLinkedMarkets(initial: Readonly<Record<string, MarketState>>, marketIds: readonly string[], access: MarketAccess) {
  const [states, setStates] = useState<Record<string, MarketState>>(initial);
  // A fresh server render (Refresh) brings fresh files: they replace what the page had.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setStates((current) => ({ ...current, ...initial }));
  }

  const requested = useRef(new Set(Object.keys(initial)));
  // Ids hold no spaces, so the list of missing markets is one string: the effect runs when it changes.
  const missingKey = marketIds.filter((id) => !(id in states)).join(' ');
  useEffect(() => {
    if (!missingKey) return;
    for (const marketId of missingKey.split(' ')) {
      if (requested.current.has(marketId)) continue;
      requested.current.add(marketId);
      access.read(marketId)
        .then((result) => setStates((current) => ({ ...current, [marketId]: stateOf(result) })))
        .catch(() => setStates((current) => ({ ...current, [marketId]: { status: 'failed', message: COPY.MARKET_READ_FAILED } })));
    }
  }, [missingKey, access]);

  const addHypothesis: AddHypothesis = useCallback(async (marketId, values) => {
    try {
      const result = await access.remoteFor(marketId).apply({ kind: 'add', entity: 'hypothesis', values });
      if (!result.ok) return { ok: false, message: result.message };
      setStates((current) => ({ ...current, [marketId]: { status: 'ready', market: result.snapshot.value } }));
      return result.entityId ? { ok: true, id: result.entityId } : { ok: false, message: COPY.HYPOTHESIS_NOT_ADDED };
    } catch {
      return { ok: false, message: COPY.SAVE_OFFLINE };
    }
  }, [access]);

  const shown: Record<string, MarketState> = Object.fromEntries(marketIds.map((id) => [id, states[id] ?? { status: 'loading' }]));
  return { states: shown, addHypothesis };
}

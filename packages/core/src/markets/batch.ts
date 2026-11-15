// Batches of market changes.
import { newId } from '../ids';
import { applyBatch, parseBatch, type BatchResult, type ParsedBatch } from '../shared/batch';
import type { ChangeStamp } from '../shared/stamp';
import { parseMarketChange } from './change-schema';
import { applyMarketChange, MARKET_COLLECTION, type MarketChange } from './changes';
import type { Market, MarketEntity } from './types';

export type MarketBatchOutcome = BatchResult<Market>;

/** Fields that hold row ids of this market. A change row's `callId` is a call in the Partner book and stays as it is. */
export const MARKET_REF_KEYS = ['entityId', 'valuePointIds'] as const;

function mapRefs(values: Record<string, unknown>, map: (id: string) => string): Record<string, unknown> {
  const out = { ...values };
  for (const key of MARKET_REF_KEYS) {
    const value = out[key];
    if (typeof value === 'string') out[key] = map(value);
    else if (Array.isArray(value)) out[key] = value.map((v) => (typeof v === 'string' ? map(v) : v));
  }
  return out;
}

/** Rewrites the ids (target and references) that `idMap` replaces. An add's own provisional `values.id` stays. */
export function remapMarketChange(change: MarketChange, idMap: Record<string, string>): MarketChange {
  const map = (id: string) => idMap[id] ?? id;
  switch (change.kind) {
    case 'updateInfo':
      return change;
    case 'add':
      return { ...change, values: mapRefs(change.values, map) };
    case 'update':
      return { ...change, id: map(change.id), patch: mapRefs(change.patch, map) };
    case 'delete':
      return { ...change, id: map(change.id) };
    case 'clearCheckAgain':
      return change.target.entity === 'market' ? change : { ...change, target: { ...change.target, id: map(change.target.id) } };
  }
}

/** An add's provisional id: the id later changes in the same batch use for the row it makes. */
export const marketProvisionalIdOf = (change: MarketChange): string | null =>
  change.kind === 'add' && typeof change.values.id === 'string' ? change.values.id : null;

function hasId(m: Market, id: string): boolean {
  return (Object.values(MARKET_COLLECTION) as Array<keyof Omit<Market, 'info'>>)
    .some((key) => (m[key] as ReadonlyArray<{ id: string }>).some((row) => row.id === id));
}

/**
 * Applies `changes` in order, all or nothing (an import: one write instead of one per row).
 * - An add may carry a provisional `values.id`. Its row gets the id `idFor` gives (by default a new one, from the
 *   stamp), and later changes that name the provisional id follow it, e.g. a hypothesis's value points.
 * - A provisional id must be new: not used twice, and not the id of a row already in the market.
 * - `entityIds` has, per change, the id of the row an add made (null for other changes).
 */
export function applyMarketChanges(
  m: Market, changes: MarketChange[], stamp: ChangeStamp,
  idFor: (kind: MarketEntity, provisional: string) => string = (kind) => (stamp.newId ?? newId)(kind),
): MarketBatchOutcome {
  return applyBatch(m, changes, stamp, {
    apply: applyMarketChange,
    remap: remapMarketChange,
    provisionalOf: (change) => {
      const provisional = marketProvisionalIdOf(change);
      return provisional !== null && change.kind === 'add' ? { provisional, entity: change.entity } : null;
    },
    hasId,
    idFor: (entity, provisional) => idFor(entity as MarketEntity, provisional),
  });
}

export type ParsedMarketChanges = ParsedBatch<MarketChange>;

/** Parses an untrusted batch (a server-action argument); see parseBatch. */
export function parseMarketChanges(input: unknown): ParsedMarketChanges {
  return parseBatch(input, parseMarketChange);
}

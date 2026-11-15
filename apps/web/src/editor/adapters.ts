import {
  applyMarketChange, applyMarketChanges, applyPartnerChange, applyPartnerChanges, COLLECTION, MARKET_COLLECTION, MARKET_REF_KEYS,
  REF_KEYS, remapMarketChange, remapPartnerChange,
  type IsoDateTime, type Market, type MarketChange, type PartnerBook, type PartnerChange,
} from '@partner-desk/core';
import type { EditorAdapter } from './engine';
import { marketInverse, partnerInverse } from './inverse';

type Row = { id: string; updatedAt: IsoDateTime | null };

/** `entity:id` → the row's Updated value in `lists`, or undefined when there is no such row. */
function rowUpdatedAt(lists: Record<string, unknown>, collection: Record<string, string>, target: string): IsoDateTime | null | undefined {
  const split = target.indexOf(':');
  if (split === -1) return undefined;
  const key = collection[target.slice(0, split)];
  const rows = key ? (lists[key] as readonly Row[] | undefined) : undefined;
  return rows?.find((row) => row.id === target.slice(split + 1))?.updatedAt;
}

/** The Partner book: rows by `entity:id`; signing, stages, closing and the exit write the partner's row. */
export const partnersAdapter: EditorAdapter<PartnerBook, PartnerChange> = {
  apply: applyPartnerChange,
  // An add's provisional id stays its id, so the row keeps one local id until the batch is saved.
  applyMany: (book, changes, stamp) => applyPartnerChanges(book, changes, stamp, (_kind, provisional) => provisional),
  inverse: partnerInverse,
  remap: remapPartnerChange,
  targetOf(change) {
    switch (change.kind) {
      case 'add':
        return null;
      case 'update':
      case 'delete':
        return `${change.entity}:${change.id}`;
      default:
        return `partner:${change.partnerId}`;
    }
  },
  refKeys: REF_KEYS,
  conflictKinds: ['update'],
  updatedAtOf: (book, target) => rowUpdatedAt(book as unknown as Record<string, unknown>, COLLECTION, target),
};

/** A market: its Market tab is `info`, its rows go by `entity:id`. */
export const marketAdapter: EditorAdapter<Market, MarketChange> = {
  apply: applyMarketChange,
  applyMany: (market, changes, stamp) => applyMarketChanges(market, changes, stamp, (_kind, provisional) => provisional),
  inverse: marketInverse,
  remap: remapMarketChange,
  targetOf(change) {
    switch (change.kind) {
      case 'updateInfo':
        return 'info';
      case 'add':
        return null;
      case 'update':
      case 'delete':
        return `${change.entity}:${change.id}`;
      case 'clearCheckAgain':
        return change.target.entity === 'market' ? 'info' : `${change.target.entity}:${change.target.id}`;
    }
  },
  refKeys: MARKET_REF_KEYS,
  conflictKinds: ['update', 'updateInfo'],
  updatedAtOf: (market, target) =>
    (target === 'info' ? market.info.updatedAt : rowUpdatedAt(market as unknown as Record<string, unknown>, MARKET_COLLECTION, target)),
};

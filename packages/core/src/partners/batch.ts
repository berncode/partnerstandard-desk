// Batches of partner changes.
import type { MarketEntity } from '../markets/types';
import { newId } from '../ids';
import { applyBatch, MAX_BATCH, parseBatch, type BatchResult, type ParsedBatch } from '../shared/batch';
import type { ChangeStamp } from '../shared/stamp';
import { parsePartnerChange } from './change-schema';
import { applyPartnerChange, COLLECTION, type PartnerChange } from './changes';
import type { PartnerBook, PartnerEntity } from './types';

export { MAX_BATCH } from '../shared/batch';

export type BatchOutcome = BatchResult<PartnerBook>;

/** Fields that hold row ids. */
export const REF_KEYS = ['partnerId', 'accountId'] as const;

function mapRefs(values: Record<string, unknown>, map: (id: string) => string): Record<string, unknown> {
  const out = { ...values };
  for (const key of REF_KEYS) {
    const value = out[key];
    if (typeof value === 'string') out[key] = map(value);
  }
  return out;
}

/** Rewrites the ids (target and references) that `idMap` replaces. An add's own provisional `values.id` stays. */
export function remapPartnerChange(change: PartnerChange, idMap: Record<string, string>): PartnerChange {
  const map = (id: string) => idMap[id] ?? id;
  switch (change.kind) {
    case 'add':
      return { ...change, values: mapRefs(change.values, map) };
    case 'update':
      return { ...change, id: map(change.id), patch: mapRefs(change.patch, map) };
    case 'delete':
      return { ...change, id: map(change.id) };
    default:
      return { ...change, partnerId: map(change.partnerId) };
  }
}

/** An add's provisional id: the id later changes in the same batch use for the row it makes. */
export const provisionalIdOf = (change: PartnerChange): string | null =>
  change.kind === 'add' && typeof change.values.id === 'string' ? change.values.id : null;

function hasId(book: PartnerBook, id: string): boolean {
  return (Object.values(COLLECTION) as Array<keyof Omit<PartnerBook, 'companyId'>>)
    .some((key) => (book[key] as ReadonlyArray<{ id: string }>).some((row) => row.id === id));
}

/**
 * Applies `changes` in order, all or nothing (an import: one write instead of one per row).
 * - An add may carry a provisional `values.id`. Its row gets the id `idFor` gives (by default a new one, from the
 *   stamp), and later changes that name the provisional id follow it, e.g. a new account's section, a section's market
 *   link.
 * - A provisional id must be new: not used twice, and not the id of a row already in the book.
 * - `entityIds` has, per change, the id of the row an add made (null for other changes).
 */
export function applyPartnerChanges(
  book: PartnerBook, changes: PartnerChange[], stamp: ChangeStamp,
  idFor: (kind: PartnerEntity | MarketEntity, provisional: string) => string = (kind) => (stamp.newId ?? newId)(kind),
): BatchOutcome {
  return applyBatch(book, changes, stamp, {
    apply: applyPartnerChange,
    remap: remapPartnerChange,
    provisionalOf: (change) => {
      const provisional = provisionalIdOf(change);
      return provisional !== null && change.kind === 'add' ? { provisional, entity: change.entity } : null;
    },
    hasId,
    idFor: (entity, provisional) => idFor(entity as PartnerEntity, provisional),
  });
}

export type ParsedChanges = ParsedBatch<PartnerChange>;

/**
 * Parses an untrusted batch (a server-action argument); see parseBatch. `max`: the most changes it takes, MAX_BATCH
 * unless the batch was built by the server itself from checked input (accepting an agent's proposal).
 */
export function parsePartnerChanges(input: unknown, max: number = MAX_BATCH): ParsedChanges {
  return parseBatch(input, parsePartnerChange, max);
}

// The parts the partner book and the market share.
import { z } from 'zod';
import { COPY } from '@partner-desk/copy';
import type { ApplyFailure, ApplyOutcome } from './outcome';
import type { ChangeStamp } from './stamp';

/**
 * The most changes one batch may carry: an AI import of 25 new companies (the most the search prompt asks for), each
 * with its account, its partner, its market link and its desk notes, in one write.
 */
export const MAX_BATCH = 100;

/** The part of a change a batch needs to see: adds may carry a provisional `values.id`. */
export type BatchChange = { kind: string };
type AddChange = { kind: 'add'; entity: string; values: Record<string, unknown> };

export type BatchResult<V> =
  | { ok: true; value: V; entityIds: Array<string | null> }
  /** `valid`: how many changes came before the one refused. Nothing is applied. */
  | (ApplyFailure & { valid: number });

export interface BatchOps<V, C extends BatchChange> {
  apply: (value: V, change: C, stamp: ChangeStamp) => ApplyOutcome<V>;
  /** Rewrites the ids (target and references) that `ids` replaces. */
  remap: (change: C, ids: Record<string, string>) => C;
  /** For an add with a string `values.id`: that provisional id and the entity it makes. Otherwise null. */
  provisionalOf: (change: C) => { provisional: string; entity: string } | null;
  hasId: (value: V, id: string) => boolean;
  /** The real id for a provisional one. */
  idFor: (entity: string, provisional: string) => string;
}

/**
 * Applies `changes` in order, all or nothing. An add's provisional id gets the real id `ops.idFor` gives, and later
 * changes that name it follow. A provisional id must be new: not used twice, not the id of a row already there.
 * `entityIds` has, per change, the id of the row an add made (null for other changes).
 */
export function applyBatch<V, C extends BatchChange>(subject: V, changes: C[], stamp: ChangeStamp, ops: BatchOps<V, C>): BatchResult<V> {
  const ids: Record<string, string> = {};
  const entityIds: Array<string | null> = [];
  let current = subject;
  for (const [index, original] of changes.entries()) {
    const change = ops.remap(original, ids);
    const add = ops.provisionalOf(change);
    let outcome: ApplyOutcome<V>;
    if (add !== null) {
      const { provisional, entity } = add;
      if (provisional === '' || Object.hasOwn(ids, provisional) || ops.hasId(subject, provisional)) {
        return { ok: false, error: 'invalid', message: COPY.NEEDS_OWN_ID, fieldErrors: { id: COPY.NEEDS_OWN_ID }, valid: index };
      }
      const real = ops.idFor(entity, provisional);
      outcome = ops.apply(current, change, { ...stamp, newId: () => real });
      if (outcome.ok) ids[provisional] = real;
    } else {
      outcome = ops.apply(current, change, stamp);
    }
    if (!outcome.ok) return { ...outcome, valid: index };
    current = outcome.value;
    entityIds.push(outcome.entityId);
  }
  return { ok: true, value: current, entityIds };
}

const provisionalSchema = z.string().min(1).max(64);

export type ParsedBatch<C> =
  | { ok: true; changes: C[] }
  /** `valid`: how many changes came before the first one that couldn't be read. */
  | { ok: false; valid?: number; fieldErrors?: Record<string, string> };

function isAddWithId(item: unknown): item is AddChange & { values: { id: unknown } } {
  if (typeof item !== 'object' || item === null) return false;
  const { kind, values } = item as { kind?: unknown; values?: unknown };
  return kind === 'add' && typeof values === 'object' && values !== null && Object.hasOwn(values, 'id');
}

/**
 * An add may carry a provisional `values.id` (1 to 64 characters). Other changes pass through. A bad id is refused
 * with no field named: the change itself is malformed.
 */
export function splitProvisionalId(input: unknown): { ok: true; input: unknown; id: string | null } | { ok: false } {
  if (!isAddWithId(input)) return { ok: true, input, id: null };
  const { id, ...values } = input.values;
  const parsed = provisionalSchema.safeParse(id);
  if (!parsed.success) return { ok: false };
  return { ok: true, input: { ...input, values }, id: parsed.data };
}

/**
 * Parses an untrusted batch: a list of 1 to `max` (MAX_BATCH) changes, each as `parseOne` reads it, except that an add
 * may carry a provisional `values.id`.
 */
export function parseBatch<C extends BatchChange>(
  input: unknown,
  parseOne: (item: unknown) => { ok: true; change: C } | { ok: false; fieldErrors?: Record<string, string> },
  max: number = MAX_BATCH,
): ParsedBatch<C> {
  if (!Array.isArray(input) || input.length === 0 || input.length > max) return { ok: false };
  const changes: C[] = [];
  for (const [index, item] of input.entries()) {
    const split = splitProvisionalId(item);
    if (!split.ok) return { ok: false, valid: index };
    const parsed = parseOne(split.input);
    if (!parsed.ok) return parsed.fieldErrors ? { ok: false, valid: index, fieldErrors: parsed.fieldErrors } : { ok: false, valid: index };
    const change = parsed.change as C | (AddChange & C);
    changes.push(split.id !== null && change.kind === 'add' ? { ...change, values: { id: split.id, ...(change as AddChange).values } } : change);
  }
  return { ok: true, changes };
}

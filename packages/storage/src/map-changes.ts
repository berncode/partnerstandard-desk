// A MAP file's changes, for every store: the MAP app's typed changes applied one after another with `applyMapChange`
// (core), all or nothing, each joined with the partner record it carries.
import { applyMapChange, type ChangeStamp, type MapChangeStamp, type MapPlan } from '@partner-desk/core';
import { MAP_REF_KEYS } from './sheet-codec/map-layout';
import type { MapFileChange } from './types';

type Refusal = { ok: false; error: 'not_found' | 'invalid' | 'conflict'; message: string; fieldErrors?: Record<string, string> };
export type MapBatchOutcome = { ok: true; value: MapPlan; entityIds: Array<string | null> } | (Refusal & { valid: number });

/** The MAP app's stamp for a PartnerStandard Desk stamp. Its row ids are the MAP app's (`newMapEntityId`), or the add's `newId`. */
const mapStamp = (stamp: ChangeStamp, change: MapFileChange): MapChangeStamp => {
  const { newId } = change;
  return {
    now: stamp.now, actorName: stamp.actor, ...(change.validate === undefined ? {} : { validate: change.validate }),
    ...(change.kind === 'add' && newId !== undefined ? { newId: () => newId } : {}),
  };
};

/** Applies `changes` in order. When one is refused, nothing is kept, and `valid` says how many came before it. */
export function applyMapFileChanges(plan: MapPlan, changes: MapFileChange[], stamp: ChangeStamp): MapBatchOutcome {
  let value = plan;
  const entityIds: Array<string | null> = [];
  for (const [index, change] of changes.entries()) {
    const outcome = applyMapChange(value, change, mapStamp(stamp, change), change.record);
    if (!outcome.ok) return { ...outcome, valid: index };
    value = outcome.plan;
    entityIds.push(outcome.entityId);
  }
  return { ok: true, value, entityIds };
}

/**
 * `change` with the row ids in `ids` replaced: its target, and the rows it names (`MAP_REF_KEYS`). A change the remap
 * alters names a row by its provisional id, so the writer fails it with a conflict if the rows moved (`positional`).
 */
export function remapMapFileChange(change: MapFileChange, ids: Record<string, string>): MapFileChange {
  const id = (value: string) => ids[value] ?? value;
  const refs = (values: Record<string, unknown>) => {
    const out = { ...values };
    for (const key of MAP_REF_KEYS) if (typeof out[key] === 'string') out[key] = id(out[key] as string);
    return out;
  };
  switch (change.kind) {
    case 'add':
      return { ...change, values: refs(change.values) };
    case 'update':
      return { ...change, id: id(change.id), patch: refs(change.patch) };
    case 'delete':
      return { ...change, id: id(change.id) };
    default:
      return change;
  }
}

// The guided flow's draft is the new MAP as read (its info, no rows), changed on screen with core's own rules until it
// is saved (spec 5.2). Pure.
import {
  applyMapChange, type IsoDateTime, type MapApplyOutcome, type MapChange, type MapPlan, type MapRecord,
} from '@partner-desk/core';

/** The MAP's rows to start from: the owner on our side as partner manager, as the MAP app's draft starts. */
export function newDraft(plan: MapPlan, record: MapRecord, ownerName: string, now: IsoDateTime): MapPlan {
  if (plan.people.length > 0 || !ownerName.trim()) return plan;
  const { plan: draft } = applyToDraft(plan, [{ kind: 'add', entity: 'person', values: { side: 'us', name: ownerName.trim(), role: 'partner_manager' } }],
    { now, actorName: ownerName }, record);
  return draft;
}

/** Applies changes to the draft in order. Stops at the first failure and returns the draft as it was before it. */
export function applyToDraft(
  draft: MapPlan, changes: MapChange[], stamp: { now: IsoDateTime; actorName: string }, record: MapRecord,
): { plan: MapPlan; outcome: MapApplyOutcome } {
  let plan = draft;
  let outcome: MapApplyOutcome = { ok: true, plan, entityId: null, touched: [], removed: null };
  for (const change of changes) {
    outcome = applyMapChange(plan, change, stamp, record);
    if (!outcome.ok) return { plan, outcome };
    plan = outcome.plan;
  }
  return { plan, outcome };
}

/** `row` without `keys`. */
function without<T extends object, K extends keyof T>(row: T, ...keys: K[]): Omit<T, K> {
  const out = { ...row };
  for (const key of keys) delete out[key];
  return out;
}

/** What `fillMap` takes: the horizon length and the rows, people and milestones by the draft's ids. */
export function fillInput(mapId: string, draft: MapPlan) {
  return {
    mapId,
    horizonDays: draft.info.horizonDays,
    objectives: draft.objectives.map((o) => without(o, 'id')),
    people: draft.people,
    milestones: draft.milestones,
    exitTriggers: draft.exitTriggers.map((x) => without(x, 'id')),
    activities: draft.activities.map((a) => without(a, 'id', 'updatedAt', 'updatedBy')),
  };
}

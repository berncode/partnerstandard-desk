// `before` is the joined plan, so undoing a change to the plan details puts back the current horizon's length as the person saw it.
import { MAP_COLLECTION, type JoinedPlan, type MapChange, type MapInfoPatch, type PlanInfo } from '@partner-desk/core';

const MANAGED = new Set(['id', 'updatedAt', 'updatedBy']);

/**
 * The change that undoes `change`, given the plan as it was before it. Deletes have no inverse:
 * the editor holds them back for the undo window instead of sending them. Starting a horizon has none either.
 */
export function inverseOf(before: JoinedPlan, change: MapChange, entityId: string | null): MapChange | null {
  switch (change.kind) {
    case 'updateInfo': {
      const patch: Record<string, unknown> = {};
      for (const key of Object.keys(change.patch)) patch[key] = before.info[key as keyof PlanInfo];
      return { kind: 'updateInfo', patch: patch as MapInfoPatch };
    }
    case 'startHorizon':
      return null;
    case 'add':
      return entityId ? { kind: 'delete', entity: change.entity, id: entityId } : null;
    case 'update': {
      const items = before[MAP_COLLECTION[change.entity]] as unknown as Array<Record<string, unknown>>;
      const previous = items.find((item) => item.id === change.id);
      if (!previous) return null;
      const keys = new Set(Object.keys(change.patch).filter((key) => !MANAGED.has(key)));
      if (change.entity === 'activity' && keys.has('status')) keys.add('completedDate');
      const patch: Record<string, unknown> = {};
      for (const key of keys) patch[key] = previous[key];
      return { kind: 'update', entity: change.entity, id: change.id, patch };
    }
    case 'delete':
      return null;
  }
}

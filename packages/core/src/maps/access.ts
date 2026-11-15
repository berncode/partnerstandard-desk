// The MAP app's collaborator is a person with a link (`link`), and an agent acts for the owner at its grant's level.
// The commands layer maps its own actor to a `MapActor`; this decides one change.
import { COPY } from '@partner-desk/copy';
import type { MapChange } from './changes';
import type { MapRows, Side } from './types';

export type MapActor =
  | { kind: 'owner' }
  | { kind: 'agent'; level: 'read' | 'change' | 'propose' }
  | { kind: 'link'; personId: string; side: Side; name: string };

export type AccessDecision = { allowed: true } | { allowed: false; reason: string };

const UPDATE_ACTIVITY_FIELDS = new Set(['status', 'note', 'dueDate', 'completedDate']);
const ADD_ACTIVITY_FIELDS = new Set(['title', 'category', 'side', 'ownerId', 'dueDate', 'status', 'note']);
const OBJECTIVE_FIELDS = new Set(['statement', 'successMeasure']);
const ADD_OBJECTIVE_FIELDS = new Set(['side', 'statement', 'successMeasure']);

const allow: AccessDecision = { allowed: true };
const deny = (reason: string): AccessDecision => ({ allowed: false, reason });
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
/** False for anything that is not a plain record, so malformed input is denied rather than thrown on. */
const onlyKeys = (values: unknown, allowed: Set<string>): boolean =>
  isRecord(values) && Object.keys(values).every((k) => allowed.has(k));

/** How much of an updated row a change from `actor` must satisfy (MapChangeStamp.validate). */
export const mapValidationFor = (actor: MapActor): 'row' | 'patch' => (actor.kind === 'link' ? 'patch' : 'row');

/**
 * An agent acts with its person's access: it changes rows and plan details at level `change`, and never starts a
 * horizon or deletes, which stay a person's decision [builder's call].
 */
function agentMay(level: 'read' | 'change' | 'propose', change: MapChange): AccessDecision {
  if (level === 'read') return deny(COPY.MAP_AGENT_READ_ONLY);
  if (level === 'propose') return deny(COPY.MAP_AGENT_PROPOSES);
  switch (change.kind) {
    case 'updateInfo':
    case 'add':
    case 'update':
      return allow;
    case 'startHorizon':
      return deny(COPY.MAP_AGENT_NO_HORIZON);
    case 'delete':
      return deny(COPY.MAP_AGENT_NO_DELETE);
    default:
      return deny('This change isn’t supported');
  }
}

const REVIEW_KINDS = new Set<string>(['review', 'reviewNumber', 'reviewItem']);

export function canChangeMap(actor: MapActor, change: MapChange, plan: Pick<MapRows, 'people' | 'activities' | 'objectives'>): AccessDecision {
  if (actor.kind === 'owner') return allow;
  if (actor.kind === 'agent') return agentMay(actor.level, change);

  // A person with a link never sees a review, so no change of theirs may touch one.
  if ((change.kind === 'add' || change.kind === 'update' || change.kind === 'delete') && REVIEW_KINDS.has(change.entity)) {
    return deny('Only the plan owner can change plan details');
  }

  switch (change.kind) {
    case 'updateInfo':
      return deny('Only the plan owner can change plan details');
    case 'startHorizon':
      return deny('Only the plan owner can start the next horizon');
    case 'delete':
      return deny('Only the plan owner can delete items');

    case 'add': {
      const { values } = change;
      if (!isRecord(values)) return deny('This change isn’t supported');
      if (change.entity === 'activity') {
        if (!onlyKeys(values, ADD_ACTIVITY_FIELDS)) return deny('You can set title, category, owner, due date, status and note');
        if (values.side !== actor.side) return deny('You can only add activities for your side');
        if (values.ownerId != null) {
          const owner = plan.people.find((p) => p.id === values.ownerId);
          if (!owner || owner.side !== actor.side) return deny('The owner must be someone on your side');
        }
        return allow;
      }
      if (change.entity === 'objective') {
        if (!onlyKeys(values, ADD_OBJECTIVE_FIELDS)) return deny('You can set the objective and how you will know');
        return values.side === actor.side ? allow : deny('You can only add objectives for your side');
      }
      return deny('You can add activities and objectives');
    }

    case 'update': {
      if (change.entity === 'activity') {
        const activity = plan.activities.find((a) => a.id === change.id);
        if (!activity) return deny('This item no longer exists');
        if (activity.side !== actor.side && activity.side !== 'joint') return deny('This activity belongs to the other side');
        return onlyKeys(change.patch, UPDATE_ACTIVITY_FIELDS) ? allow : deny('You can update status, note and due date');
      }
      if (change.entity === 'objective') {
        const objective = plan.objectives.find((o) => o.id === change.id);
        if (!objective) return deny('This item no longer exists');
        if (objective.side !== actor.side) return deny('This objective belongs to the other side');
        return onlyKeys(change.patch, OBJECTIVE_FIELDS) ? allow : deny('You can update the objective and how you will know');
      }
      return deny('Only the plan owner can change this');
    }

    default:
      return deny('This change isn’t supported');
  }
}

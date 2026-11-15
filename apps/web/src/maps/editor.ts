// The confirmed snapshot is the MAP as its file holds it, and a change is applied with core's `applyMapChange`, which
// joins in the partner record's facts (spec 5.3). There is no `signAgreement` here: signing is the partner page's.
import { applyMapChange, normalizeName, type EntityKind, type IsoDateTime, type MapChange, type MapPlan } from '@partner-desk/core';
import type { MapSnapshot } from './remote';

export interface QueueItem {
  seq: number;
  change: MapChange;
  /** For adds: the id the item has locally until the server assigns the real one. */
  localId: string | null;
  /** When the user made the change; stamps the optimistic version. */
  at: IsoDateTime;
  /**
   * For activity updates: the updatedAt the user saw (from the confirmed plan) when making the change.
   * Sent as expectedUpdatedAt. Undefined when the activity isn't confirmed yet (a new local item).
   */
  base?: IsoDateTime | null;
  /**
   * For activity updates: the values of the patched fields the user saw (from the confirmed plan) when making the
   * change. Sent as `expected`, so a hand edit of one of them in the sheet is a conflict. Undefined like `base`.
   */
  expected?: Record<string, unknown>;
}

export interface EditorState {
  /** The last snapshot the server returned. */
  confirmed: MapSnapshot;
  /** Changes waiting to be sent, oldest first. The head may be in flight. */
  queue: QueueItem[];
  /** Deletes held back during the undo window. */
  deferred: QueueItem[];
  /** Local id → server id for adds the server has confirmed. */
  idMap: Record<string, string>;
  lastSave: 'ok' | 'failed' | null;
  /** How many changes have failed since the page opened: a screen waiting for its saves can tell one failed meanwhile. */
  failures: number;
  /** A save answered that Google needs reconnecting: nothing more is sent, and nothing can be changed (question 16). */
  needsGoogle: boolean;
}

export type EditorEvent =
  | { type: 'enqueue'; item: QueueItem }
  | { type: 'defer'; item: QueueItem }
  | { type: 'release'; seq: number }
  | { type: 'cancel'; seq: number }
  | { type: 'refresh'; snapshot: MapSnapshot }
  | { type: 'succeeded'; seq: number; snapshot: MapSnapshot; entityId: string | null }
  /** `fatal`: Google needs reconnecting; drop everything and stop saving. */
  | { type: 'failed'; seq: number; snapshot?: MapSnapshot; conflict?: boolean; fatal?: boolean };

export function initEditor(snapshot: MapSnapshot): EditorState {
  return { confirmed: snapshot, queue: [], deferred: [], idMap: {}, lastSave: null, failures: 0, needsGoogle: false };
}

const REFERENCE_FIELDS = ['ownerId', 'milestoneId'] as const;

/** Rewrites ids (the target and owner/milestone references) that the server has since replaced. */
export function remapChange(change: MapChange, idMap: Record<string, string>): MapChange {
  const map = (value: unknown) => (typeof value === 'string' && idMap[value] ? idMap[value] : value);
  const fields = (record: Record<string, unknown>) => {
    const out = { ...record };
    for (const key of REFERENCE_FIELDS) if (key in out) out[key] = map(out[key]);
    return out;
  };
  switch (change.kind) {
    case 'updateInfo':
    case 'startHorizon':
      return change;
    case 'add':
      return { ...change, values: fields(change.values) };
    case 'update':
      return { ...change, id: map(change.id) as string, patch: fields(change.patch) };
    case 'delete':
      return { ...change, id: map(change.id) as string };
  }
}

export const isActivityUpdate = (change: MapChange): change is Extract<MapChange, { kind: 'update' }> =>
  change.kind === 'update' && change.entity === 'activity';

/**
 * An update of a row that records when it last changed (an activity, or a review row): it is sent with the updatedAt
 * the person saw, so a change made elsewhere since is a conflict. Only activities also send the patched fields' values.
 */
export const isStampedUpdate = (change: MapChange): change is Extract<MapChange, { kind: 'update' }> =>
  change.kind === 'update' && (change.entity === 'activity' || change.entity === 'review');

/** The stamped row a change updates, as `plan` holds it. */
const stampedRow = (plan: MapPlan, change: Extract<MapChange, { kind: 'update' }>): { updatedAt: IsoDateTime | null } | undefined =>
  (change.entity === 'review' ? plan.reviews : plan.activities).find((row) => row.id === change.id);

/** The conflict base for a change about to be queued: what the confirmed plan says, if it knows the row. */
export function baseFor(state: EditorState, change: MapChange): IsoDateTime | null | undefined {
  const mapped = remapChange(change, state.idMap);
  if (!isStampedUpdate(mapped)) return undefined;
  return stampedRow(state.confirmed.value, mapped)?.updatedAt;
}

/** The patched fields' values the confirmed plan holds now, if it knows the activity: the conflict check for hand edits. */
export function expectedFor(state: EditorState, change: MapChange): Record<string, unknown> | undefined {
  const mapped = remapChange(change, state.idMap);
  if (!isActivityUpdate(mapped)) return undefined;
  const current = state.confirmed.value.activities.find((a) => a.id === mapped.id);
  return current ? seenFields(current, mapped.patch) : undefined;
}

const seenFields = (activity: object, patch: Record<string, unknown>): Record<string, unknown> => {
  const row = activity as Record<string, unknown>;
  return Object.fromEntries(Object.keys(patch).map((field) => [field, row[field] ?? null]));
};

const targetOf = (item: QueueItem, idMap: Record<string, string>) => {
  const change = remapChange(item.change, idMap);
  return isStampedUpdate(change) ? change.id : null;
};

/** After an own update to an activity (or a review row) succeeds, later edits that shared its base move to the new version. */
export function rebaseAfterSuccess(
  items: QueueItem[],
  done: QueueItem,
  snapshot: MapSnapshot,
  idMap: Record<string, string>,
): QueueItem[] {
  const target = targetOf(done, idMap);
  if (target === null) return items;
  const doneChange = remapChange(done.change, idMap);
  if (!isStampedUpdate(doneChange)) return items;
  const saved = stampedRow(snapshot.value, doneChange);
  if (saved === undefined) return items;
  const produced = isActivityUpdate(doneChange) ? seenFields(saved, doneChange.patch) : {};
  return items.map((i) => {
    if (targetOf(i, idMap) !== target) return i;
    let next = i;
    if (done.base !== undefined && saved.updatedAt !== undefined && i.base === done.base) next = { ...next, base: saved.updatedAt };
    // The fields the earlier write produced: a later edit that saw the old value now expects the new one.
    if (done.expected !== undefined && i.expected !== undefined) {
      const moved = Object.fromEntries(Object.entries(produced).filter(([field]) => field in i.expected! && i.expected![field] === done.expected![field]));
      if (Object.keys(moved).length > 0) next = { ...next, expected: { ...i.expected, ...moved } };
    }
    return next;
  });
}

/** The activity or review row a change edits or deletes, after remapping; null for anything else. */
const activityOf = (item: QueueItem, idMap: Record<string, string>) => {
  const change = remapChange(item.change, idMap);
  return (change.kind === 'update' || change.kind === 'delete') && (change.entity === 'activity' || change.entity === 'review') ? change.id : null;
};

/**
 * After a conflict on an activity (or a review row), queued edits and held-back deletes of it were made against a stale version and
 * are dropped: the user now sees the latest version and can decide again. Only updates and deletes are dropped,
 * never adds, so nothing later in the queue can depend on a dropped item.
 */
export function dropAfterConflict(items: QueueItem[], failed: QueueItem, idMap: Record<string, string>): QueueItem[] {
  const target = targetOf(failed, idMap);
  if (target === null) return items;
  return items.filter((i) => activityOf(i, idMap) !== target);
}

/** Every id a change refers to: its target and any owner/milestone references. */
function idsReferencedBy(change: MapChange): string[] {
  const refs = (record: Record<string, unknown>) =>
    REFERENCE_FIELDS.map((key) => record[key]).filter((value): value is string => typeof value === 'string');
  switch (change.kind) {
    case 'updateInfo':
    case 'startHorizon':
      return [];
    case 'add':
      return refs(change.values);
    case 'update':
      return [change.id, ...refs(change.patch)];
    case 'delete':
      return [change.id];
  }
}

/**
 * After an add fails, the item it would have created never exists: queued edits that target it or point at it
 * would fail on the server or attach to nothing, so they are dropped too, and, transitively, anything that
 * depended on an add dropped this way.
 */
export function dropDependents(items: QueueItem[], failed: QueueItem): QueueItem[] {
  const created = createdIds(failed);
  return created.length === 0 ? items : dropReferencing(items, new Set(created));
}

/** Drops items that reference an id in `gone`, adding the ids of dropped adds to it so later lists see them too. */
function dropReferencing(items: QueueItem[], gone: Set<string>): QueueItem[] {
  const kept: QueueItem[] = [];
  for (const item of items) {
    if (idsReferencedBy(item.change).some((id) => gone.has(id))) {
      if (item.localId) gone.add(item.localId);
    } else {
      kept.push(item);
    }
  }
  return kept;
}

/** The local ids of the milestones a startHorizon item adds, in its order (as localIdsFor hands them out). */
function horizonMilestoneIds(item: QueueItem): string[] {
  if (item.change.kind !== 'startHorizon') return [];
  const next = localIdsFor(item.seq, item.localId);
  return item.change.milestones.map(() => next('milestone'));
}

/** Every local id an item gives the rows it adds: an add's one, or a new horizon's milestones. */
const createdIds = (item: QueueItem): string[] => (item.localId ? [item.localId] : horizonMilestoneIds(item));

/**
 * The server ids of a confirmed item's new rows, by local id. An add's comes back as entityId. A new horizon's milestones
 * are found by name in the returned snapshot: names are unique on a plan (the sheet links milestones by name).
 */
function confirmedIds(item: QueueItem, entityId: string | null, snapshot: MapSnapshot): Record<string, string> {
  if (item.localId) return entityId && item.localId !== entityId ? { [item.localId]: entityId } : {};
  if (item.change.kind !== 'startHorizon') return {};
  const { milestones } = item.change;
  const out: Record<string, string> = {};
  horizonMilestoneIds(item).forEach((local, index) => {
    const name = normalizeName(milestones[index]!.name);
    const saved = snapshot.value.milestones.find((m) => normalizeName(m.name) === name);
    if (saved) out[local] = saved.id;
  });
  return out;
}

/** `dropDependents` across the queue and then the held-back list (their send order), sharing one set of vanished ids. */
function dropFailedDependents(queue: QueueItem[], deferred: QueueItem[], failed: QueueItem) {
  const created = createdIds(failed);
  if (created.length === 0) return { queue, deferred };
  const gone = new Set(created);
  return { queue: dropReferencing(queue, gone), deferred: dropReferencing(deferred, gone) };
}

export function editorReducer(state: EditorState, event: EditorEvent): EditorState {
  switch (event.type) {
    case 'enqueue':
      return { ...state, queue: [...state.queue, event.item] };
    case 'defer':
      return { ...state, deferred: [...state.deferred, event.item] };
    case 'release': {
      const released = state.deferred.find((i) => i.seq === event.seq);
      if (!released) return state;
      return { ...state, deferred: state.deferred.filter((i) => i.seq !== event.seq), queue: [...state.queue, released] };
    }
    case 'cancel':
      return { ...state, deferred: state.deferred.filter((i) => i.seq !== event.seq) };
    case 'refresh':
      // Queued changes keep their recorded bases, so replaying them on a newer plan still surfaces real conflicts.
      return { ...state, confirmed: event.snapshot };
    case 'succeeded': {
      const head = state.queue[0];
      if (!head || head.seq !== event.seq) return state;
      const confirmed = confirmedIds(head, event.entityId, event.snapshot);
      const idMap = Object.keys(confirmed).length > 0 ? { ...state.idMap, ...confirmed } : state.idMap;
      const remap = (i: QueueItem) => ({ ...i, change: remapChange(i.change, idMap) });
      const rebase = (items: QueueItem[]) => rebaseAfterSuccess(items.map(remap), head, event.snapshot, idMap);
      return {
        ...state, confirmed: event.snapshot, queue: rebase(state.queue.slice(1)), deferred: rebase(state.deferred), idMap, lastSave: 'ok',
      };
    }
    case 'failed': {
      const head = state.queue[0];
      if (!head || head.seq !== event.seq) return state;
      // As the partner editor's engine does: what was waiting can't be saved now, so it goes, and the page shows the file.
      if (event.fatal) return { ...state, queue: [], deferred: [], lastSave: 'failed', failures: state.failures + 1, needsGoogle: true };
      const rest = state.queue.slice(1);
      const queue = event.conflict ? dropAfterConflict(rest, head, state.idMap) : rest;
      const deferred = event.conflict ? dropAfterConflict(state.deferred, head, state.idMap) : state.deferred;
      return {
        ...state,
        confirmed: event.snapshot ?? state.confirmed,
        ...dropFailedDependents(queue, deferred, head),
        lastSave: 'failed',
        failures: state.failures + 1,
      };
    }
  }
}

/**
 * The ids a queued change gives the rows it adds, the same on every replay: an add's one local id, or (for a change that
 * adds several rows, such as starting a horizon) one per row from the change's sequence number. Once the server
 * confirms the change, idMap points them at the server's ids (confirmedIds), so queued changes using them still save.
 */
export function localIdsFor(seq: number, localId: string | null): (entity: EntityKind) => string {
  if (localId) return () => localId;
  let n = 0;
  return (entity) => `local_${entity}_${seq}_${++n}`;
}

/** The MAP as the user sees it: the confirmed file plus every queued and held-back change. */
export function viewOf(state: EditorState, actorName: string, validate: 'row' | 'patch' = 'row'): MapPlan {
  const { record } = state.confirmed;
  let plan = state.confirmed.value;
  for (const item of [...state.queue, ...state.deferred]) {
    const change = remapChange(item.change, state.idMap);
    const outcome = applyMapChange(plan, change, { now: item.at, actorName, newId: localIdsFor(item.seq, item.localId), validate }, record);
    if (outcome.ok) plan = outcome.plan;
  }
  return plan;
}

/**
 * The change as it goes over the wire: ids remapped, activity and review row updates stamped with the updatedAt the
 * user saw, and activity updates with the patched fields' values too.
 */
export function prepareForSend(state: EditorState, item: QueueItem): MapChange {
  const change = remapChange(item.change, state.idMap);
  if (!isStampedUpdate(change)) return change;
  const stamped = stampedRow(state.confirmed.value, change);
  let sent = change;
  if (sent.expectedUpdatedAt === undefined) {
    if (item.base !== undefined) sent = { ...sent, expectedUpdatedAt: item.base };
    else if (stamped) sent = { ...sent, expectedUpdatedAt: stamped.updatedAt };
  }
  if (!isActivityUpdate(change)) return sent;
  const current = state.confirmed.value.activities.find((a) => a.id === change.id);
  // The patched fields' values the user saw (recorded when the change was made), so a hand edit of one is a conflict, not lost.
  if (sent.expected === undefined) {
    const seen = item.expected ?? (current ? seenFields(current, sent.patch) : undefined);
    if (seen) sent = { ...sent, expected: seen };
  }
  return sent;
}

export function saveStateOf(state: EditorState): 'saved' | 'saving' | 'failed' {
  if (state.queue.length > 0 || state.deferred.length > 0) return 'saving';
  return state.lastSave === 'failed' ? 'failed' : 'saved';
}

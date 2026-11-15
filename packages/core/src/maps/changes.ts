// Spec 5.3: the partner record owns the name, stage, signing and closing, so there is no `signAgreement` and
// `updateInfo` has no stage or closing rules. `applyMapChange` joins the record in, applies the MAP app's change, and keeps what the MAP file stores.
import type { z } from 'zod';
import { type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { IsoDate, IsoDateTime } from '../partners/types';
import { toFieldErrors } from '../shared/schemas';
import { horizonDayDate, toIsoDate } from './dates';
import { newMapEntityId } from './ids';
import { currentLaterHorizon, joinPlan } from './join';
import { MAP_ENTITY_SCHEMAS, planInfoSchema } from './schemas';
import { DEFAULT_HORIZON_DAYS, type EntityByKind, EntityKind, JoinedPlan, MapInfo, MapPlan, MapRecord, MapRows } from './types';
import { normalizeName } from './validate';

type Plan = JoinedPlan;

export const MAP_COLLECTION = {
  objective: 'objectives',
  activity: 'activities',
  person: 'people',
  milestone: 'milestones',
  exitTrigger: 'exitTriggers',
  review: 'reviews',
  reviewNumber: 'reviewNumbers',
  reviewItem: 'reviewItems',
} as const satisfies Record<EntityKind, keyof MapRows>;

export interface EntityRef {
  entity: EntityKind;
  id: string;
}

/**
 * Plan details a change may set: the current horizon's length and the next review. The horizon history only grows,
 * through startHorizon; the name, type, stage, start date and closing come from the partner record.
 */
export interface MapInfoPatch {
  horizonDays?: number;
  nextReviewDate?: IsoDate | null;
}

/** A milestone a new horizon starts with, on day `day` of it (day 1 is the horizon's start date). */
export interface HorizonMilestone {
  name: string;
  criteria: string;
  day: number;
}

/**
 * Starts the plan's next horizon (owner only): the current period becomes past, the new one starts on `startDate`
 * with its own length, and the milestones are added. `expectedStartDate` and `expectedHorizon` (how many horizons had
 * ended) are what the change was made against: the start date alone can't tell a replay apart once a horizon started
 * today, so the same horizon is never started twice. Its stage is the partner record's.
 */
export interface MapStartHorizonChange {
  kind: 'startHorizon';
  expectedStartDate: IsoDate;
  expectedHorizon: number;
  startDate: IsoDate;
  horizonDays: number;
  milestones: HorizonMilestone[];
}

/** The MAP app's startHorizon, with the stage the new horizon runs in. */
export interface JoinedStartHorizonChange extends MapStartHorizonChange {
  stage: Stage;
}

type RowChange =
  | { kind: 'add'; entity: EntityKind; values: Record<string, unknown> }
  | {
    kind: 'update'; entity: EntityKind; id: string; patch: Record<string, unknown>; expectedUpdatedAt?: IsoDateTime | null;
    /** Activities only [builder's call]: the values of the patched fields the client saw. A hand edit of one is a conflict. */
    expected?: Record<string, unknown>;
  }
  | { kind: 'delete'; entity: EntityKind; id: string };

/** A change to a MAP, as screens, links and agents send it. */
export type MapChange = { kind: 'updateInfo'; patch: MapInfoPatch } | MapStartHorizonChange | RowChange;

/** The MAP app's change, applied to the joined plan. */
export type JoinedChange = { kind: 'updateInfo'; patch: MapInfoPatch } | JoinedStartHorizonChange | RowChange;

export interface MapChangeStamp {
  now: IsoDateTime;
  actorName: string;
  newId?: (entity: EntityKind) => string;
  /**
   * How much of an updated row to check. 'row' (the default) checks the whole row, as the owner's edits always have.
   * 'patch' checks only the fields the change names, plus the fields the stamp sets on activities. It is for people
   * with a link, who may change a status on a row whose title was left blank in the sheet. Chosen by the server
   * (`mapValidationFor` in access.ts), never by client input.
   */
  validate?: 'row' | 'patch';
}

type Failure = { ok: false; error: 'not_found' | 'invalid' | 'conflict'; message: string; fieldErrors?: Record<string, string> };

export type JoinedApplyOutcome =
  | { ok: true; plan: Plan; entityId: string | null; touched: EntityRef[]; removed: EntityRef | null }
  | Failure;

export type MapApplyOutcome =
  | { ok: true; plan: MapPlan; entityId: string | null; touched: EntityRef[]; removed: EntityRef | null }
  | Failure;

type Entity = { id: string } & Record<string, unknown>;

const DEFAULTS: { [K in EntityKind]: Omit<EntityByKind[K], 'id'> } = {
  objective: { side: 'us', statement: '', successMeasure: '' },
  activity: {
    title: '', category: 'other', side: 'us', ownerId: null, dueDate: null, status: 'not_started',
    completedDate: null, milestoneId: null, note: '', updatedAt: null, updatedBy: null,
  },
  person: { side: 'us', name: '', title: '', email: null, role: 'other' },
  milestone: { name: '', targetDate: null, criteria: '', achievedDate: null },
  exitTrigger: { condition: '', status: 'ok' },
  review: {
    horizon: 1, state: 'prep', heldOn: null, caseId: null, decisions: '', relationshipNote: '', nextHorizonDays: DEFAULT_HORIZON_DAYS,
    includeScorecard: false, summarySentAt: null, summarySentTo: '', updatedAt: null, updatedBy: null,
  },
  reviewNumber: { reviewId: '', key: 'dealsWon', actual: null, target: null, source: null, note: '', nextTarget: null },
  reviewItem: {
    reviewId: '', kind: 'notDone', refId: null, title: '', side: null, ownerId: null, dueDate: null, milestoneId: null,
    answer: null, note: '', moved: false,
  },
};

const SERVER_MANAGED = ['id', 'updatedAt', 'updatedBy'];
const REFERENCE_FIELD = { person: 'ownerId', milestone: 'milestoneId' } as const;

const list = (plan: Plan, entity: EntityKind) => plan[MAP_COLLECTION[entity]] as unknown as Entity[];
const withList = (plan: Plan, entity: EntityKind, items: Entity[]) => ({ ...plan, [MAP_COLLECTION[entity]]: items }) as Plan;

function stripManaged(values: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...values };
  for (const key of SERVER_MANAGED) delete copy[key];
  return copy;
}

/** A review row records who changed it and when, like an activity, without the activity's completed date. */
function stampReview(row: Record<string, unknown>, stamp: MapChangeStamp): Record<string, unknown> {
  return { ...row, updatedAt: stamp.now, updatedBy: stamp.actorName };
}

function stampActivity(row: Record<string, unknown>, stamp: MapChangeStamp): Record<string, unknown> {
  const next: Record<string, unknown> = { ...row, updatedAt: stamp.now, updatedBy: stamp.actorName };
  if (next.status !== 'done') next.completedDate = null;
  else if (!next.completedDate) next.completedDate = toIsoDate(stamp.now);
  return next;
}

function invalid(error: z.ZodError): Failure {
  return { ok: false, error: 'invalid', message: 'Please fix the highlighted fields', fieldErrors: toFieldErrors(error) };
}

/** The sheet stores owners and milestones by name, so two people (or milestones) must never share one. */
function duplicateName(plan: Plan, entity: EntityKind, row: Entity): Failure | null {
  if (entity !== 'person' && entity !== 'milestone') return null;
  const name = String(row.name);
  const key = normalizeName(name);
  const clash = list(plan, entity).some((item) => item.id !== row.id && normalizeName(String(item.name)) === key);
  if (!clash) return null;
  return {
    ok: false, error: 'invalid', message: 'Please fix the highlighted fields',
    fieldErrors: { name: `Another ${entity} is already called “${name}”. Add something to tell them apart.` },
  };
}

/**
 * A commitment added to a review held already (a second tab still showing the prep): closing turned the commitments
 * into activities, so a new one would never reach the MAP.
 */
function commitmentOnHeldReview(plan: Plan, entity: EntityKind, row: Entity): boolean {
  if (entity !== 'reviewItem' || row.kind !== 'commitment') return false;
  return plan.reviews.some((r) => r.id === row.reviewId && r.state === 'held');
}

function parse(entity: EntityKind, row: Record<string, unknown>): { ok: true; value: Entity } | { ok: false; outcome: Failure } {
  const result = MAP_ENTITY_SCHEMAS[entity].safeParse(row);
  return result.success ? { ok: true, value: result.data as Entity } : { ok: false, outcome: invalid(result.error) };
}

/** Activity fields the stamp sets on every update; a patch-only check covers them too. */
const STAMPED_ACTIVITY_FIELDS = ['completedDate', 'updatedAt', 'updatedBy'];

/** Checks only `keys` of `row` against the entity's schema; every other field is kept as it is. */
function parsePatched(entity: EntityKind, row: Record<string, unknown>, keys: string[]): ReturnType<typeof parse> {
  const object = MAP_ENTITY_SCHEMAS[entity] as z.ZodObject;
  const fields = [...keys, ...(entity === 'activity' ? STAMPED_ACTIVITY_FIELDS : [])].filter((key) => key in object.shape);
  const result = object.pick(Object.fromEntries(fields.map((key) => [key, true])) as Record<string, true>).safeParse(row);
  return result.success ? { ok: true, value: { ...row, ...result.data } as Entity } : { ok: false, outcome: invalid(result.error) };
}

const NO_HORIZON_BEFORE_SIGNING = 'In recruitment no horizon runs yet: record the signed agreement to start onboarding';

function startHorizon(plan: Plan, change: JoinedStartHorizonChange, stamp: MapChangeStamp): JoinedApplyOutcome {
  const { info } = plan;
  if (info.startDate !== change.expectedStartDate || info.pastHorizons.length !== change.expectedHorizon) {
    return { ok: false, error: 'conflict', message: 'A new horizon was already started since you opened the plan' };
  }
  if (info.stage === 'recruitment') {
    return { ok: false, error: 'invalid', message: NO_HORIZON_BEFORE_SIGNING };
  }
  if (change.startDate < info.startDate) {
    return { ok: false, error: 'invalid', message: 'The current horizon hasn’t started yet, so the next one can’t start' };
  }
  if (change.stage === 'recruitment') {
    return { ok: false, error: 'invalid', message: 'Recruitment isn’t a horizon.', fieldErrors: { stage: 'Recruitment isn’t a horizon.' } };
  }
  const result = planInfoSchema.safeParse({
    ...info, startDate: change.startDate, horizonDays: change.horizonDays, stage: change.stage,
    pastHorizons: [...info.pastHorizons, { startDate: info.startDate, horizonDays: info.horizonDays, stage: info.stage }],
  });
  if (!result.success) return invalid(result.error);

  let next: Plan = { ...plan, info: result.data };
  const touched: EntityRef[] = [];
  for (const milestone of change.milestones) {
    const id = (stamp.newId ?? newMapEntityId)('milestone');
    const row: Record<string, unknown> = {
      id, name: milestone.name, criteria: milestone.criteria, targetDate: horizonDayDate(result.data.startDate, milestone.day), achievedDate: null,
    };
    const parsed = parse('milestone', row);
    if (!parsed.ok) return parsed.outcome;
    const clash = duplicateName(next, 'milestone', parsed.value);
    if (clash) return clash;
    next = withList(next, 'milestone', [...list(next, 'milestone'), parsed.value]);
    touched.push({ entity: 'milestone', id });
  }
  return { ok: true, plan: next, entityId: null, touched, removed: null };
}

/** True when a field the client saw has another value in the stored row now. An empty value and a missing one are alike. */
function handEdited(current: object, expected: Record<string, unknown>): boolean {
  const row = current as Record<string, unknown>;
  return Object.entries(expected).some(([field, seen]) => (row[field] ?? null) !== (seen ?? null));
}

/** The MAP app's change on the joined plan. Callers go through `applyMapChange`, which joins the partner record in. */
export function applyChange(plan: Plan, change: JoinedChange, stamp: MapChangeStamp): JoinedApplyOutcome {
  switch (change.kind) {
    case 'startHorizon':
      return startHorizon(plan, change, stamp);

    case 'updateInfo': {
      const result = planInfoSchema.safeParse({ ...plan.info, ...change.patch });
      if (!result.success) return invalid(result.error);
      return { ok: true, plan: { ...plan, info: result.data }, entityId: null, touched: [], removed: null };
    }

    case 'add': {
      const id = (stamp.newId ?? newMapEntityId)(change.entity);
      let row: Record<string, unknown> = { ...DEFAULTS[change.entity], ...stripManaged(change.values), id };
      if (change.entity === 'activity') row = stampActivity(row, stamp);
      if (change.entity === 'review') row = stampReview(row, stamp);
      const parsed = parse(change.entity, row);
      if (!parsed.ok) return parsed.outcome;
      const clash = duplicateName(plan, change.entity, parsed.value);
      if (clash) return clash;
      if (commitmentOnHeldReview(plan, change.entity, parsed.value)) {
        return { ok: false, error: 'conflict', message: COPY.REVIEW_ERR_HELD_NO_COMMITMENT };
      }
      return {
        ok: true,
        plan: withList(plan, change.entity, [...list(plan, change.entity), parsed.value]),
        entityId: id,
        touched: [{ entity: change.entity, id }],
        removed: null,
      };
    }

    case 'update': {
      const items = list(plan, change.entity);
      const index = items.findIndex((item) => item.id === change.id);
      if (index === -1) return { ok: false, error: 'not_found', message: 'This item no longer exists' };
      const current = items[index]!;
      if ((change.entity === 'activity' || change.entity === 'review') && change.expectedUpdatedAt !== undefined && current.updatedAt !== change.expectedUpdatedAt) {
        return { ok: false, error: 'conflict', message: `Updated by ${String(current.updatedBy ?? 'someone else')} since you opened it` };
      }
      if (change.entity === 'activity' && change.expected !== undefined && handEdited(current, change.expected)) {
        return { ok: false, error: 'conflict', message: COPY.CONFLICT };
      }
      let row: Record<string, unknown> = { ...current, ...stripManaged(change.patch), id: current.id };
      if (change.entity === 'activity') row = stampActivity(row, stamp);
      if (change.entity === 'review') row = stampReview(row, stamp);
      const parsed = stamp.validate === 'patch'
        ? parsePatched(change.entity, row, Object.keys(stripManaged(change.patch)))
        : parse(change.entity, row);
      if (!parsed.ok) return parsed.outcome;
      const clash = duplicateName(plan, change.entity, parsed.value);
      if (clash) return clash;

      const nextItems = items.slice();
      nextItems[index] = parsed.value;
      const next = withList(plan, change.entity, nextItems);
      const touched: EntityRef[] = [{ entity: change.entity, id: current.id }];
      if ((change.entity === 'person' || change.entity === 'milestone') && current.name !== parsed.value.name) {
        const field = REFERENCE_FIELD[change.entity];
        for (const activity of next.activities) {
          if (activity[field] === current.id) touched.push({ entity: 'activity', id: activity.id });
        }
        // The Review items tab names them too, as the Activities tab does (owner, 2026-11-01).
        for (const item of next.reviewItems) {
          if (item[field] === current.id) touched.push({ entity: 'reviewItem', id: item.id });
        }
      }
      return { ok: true, plan: next, entityId: current.id, touched, removed: null };
    }

    case 'delete': {
      const items = list(plan, change.entity);
      if (!items.some((item) => item.id === change.id)) return { ok: false, error: 'not_found', message: 'This item no longer exists' };
      let next = withList(plan, change.entity, items.filter((item) => item.id !== change.id));
      const touched: EntityRef[] = [];
      if (change.entity === 'person' || change.entity === 'milestone') {
        const field = REFERENCE_FIELD[change.entity];
        next = {
          ...next,
          activities: next.activities.map((activity) => {
            if (activity[field] !== change.id) return activity;
            touched.push({ entity: 'activity', id: activity.id });
            return field === 'ownerId' ? { ...activity, ownerId: null } : { ...activity, milestoneId: null };
          }),
          // A review item names them by name in the sheet as an activity does (owner, 2026-11-01): it lets go of them too,
          // so its cell never names someone the People or Milestones tab no longer has.
          reviewItems: next.reviewItems.map((item) => {
            if (item[field] !== change.id) return item;
            touched.push({ entity: 'reviewItem', id: item.id });
            return field === 'ownerId' ? { ...item, ownerId: null } : { ...item, milestoneId: null };
          }),
        };
      }
      if (change.entity === 'review') {
        // A review owns its numbers and items, so they go with it.
        const gone = (row: { reviewId: string }) => row.reviewId === change.id;
        for (const row of next.reviewNumbers.filter(gone)) touched.push({ entity: 'reviewNumber', id: row.id });
        for (const row of next.reviewItems.filter(gone)) touched.push({ entity: 'reviewItem', id: row.id });
        next = { ...next, reviewNumbers: next.reviewNumbers.filter((row) => !gone(row)), reviewItems: next.reviewItems.filter((row) => !gone(row)) };
      }
      return { ok: true, plan: next, entityId: null, touched, removed: { entity: change.entity, id: change.id } };
    }
  }
}

/** What the MAP file stores after `change` gave the joined plan details `joined`. */
function storedInfo(map: MapInfo, change: MapChange, joined: JoinedPlan['info'], record: MapRecord): MapInfo {
  if (change.kind === 'startHorizon') {
    return { ...map, laterHorizons: [...map.laterHorizons, { startDate: change.startDate, horizonDays: change.horizonDays }] };
  }
  if (change.kind !== 'updateInfo') return map;
  const current = currentLaterHorizon(map, record);
  const next: MapInfo = { ...map, nextReviewDate: joined.nextReviewDate };
  if (current === null) return { ...next, horizonDays: joined.horizonDays };
  return { ...next, laterHorizons: map.laterHorizons.map((h, i) => (i === current ? { ...h, horizonDays: joined.horizonDays } : h)) };
}

/**
 * Applies a change to a stored MAP. The partner record's facts are joined in, the MAP app's change runs on the joined
 * plan, and what the MAP file stores comes back. A new horizon needs a signed record and runs in the record's stage.
 * The date a MAP not yet signed counts from doesn't matter here: no change reads or stores it.
 */
export function applyMapChange(plan: MapPlan, change: MapChange, stamp: MapChangeStamp, record: MapRecord): MapApplyOutcome {
  if (change.kind === 'startHorizon' && record.signedDate === null) return { ok: false, error: 'invalid', message: NO_HORIZON_BEFORE_SIGNING };
  const joined = joinPlan(plan, record, toIsoDate(stamp.now));
  const outcome = applyChange(joined, change.kind === 'startHorizon' ? { ...change, stage: record.stage } : change, stamp);
  if (!outcome.ok) return outcome;
  return { ...outcome, plan: { ...outcome.plan, info: storedInfo(plan.info, change, outcome.plan.info, record) } };
}

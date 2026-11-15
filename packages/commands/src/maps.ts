// The MAP commands (spec 8): list, read, start, change, delete, and moving the open dates at signing. The access rules
// are the MAP app's (core's `canChangeMap`), with PartnerStandard Desk's actors; the date move is the MAP app's
// `signAgreement` shift, as ordinary updates.
import {
  applyMapChange, canChangeMap, daysBetween, DEFAULT_SETTINGS, isValidTimeZone, joinPlan, mapSummary, mapValidationFor, newMapId,
  newMapPlan, normalizeName, notifySettingsSchema, parseMapChange, planInfoFor,
  withoutReviews, type Health, type IsoDate, type IsoDateTime, type JoinedPlan, type MapChange, type MapPlan, type MapRecord,
  type NotifySettings, type PlanInfo,
} from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, type PartnerType, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { MapFileChange, Snapshot } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, ownerOf, type Actor } from './actor';
import { type Deps, wordsOf } from './deps';
import { DuplicateEntry, type MapEntry, type MapEvent } from './directory';
import {
  dropMaps, isMapProgress, lastProgress, mapActorOf, MAX_NAME, moveOffered, moveOpenDates, noteChange, noteMoveFailed, ownerTimeZone, ownerToday, ownMap,
  plannedStart, recordFor, revokeMapAccess, setSummary, startedOn, TYPE_GONE, writeSummary,
} from './map-shared';
import type { FileRead } from './programs';
import { logQuietly, refused } from './shared';
import { createFailed, FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, record, type CommandResult, type Failure } from './result';
import { ownCompanyOnly } from './own-company';

// The MAP's clock and dates, for the screens and the scheduled job.
export { DEFAULT_TIME_ZONE, lastProgress, ownerTimeZone, ownerToday, plannedStart } from './map-shared';

const id = z.string().min(1).max(64);
const companyId = z.string().regex(/^co_[0-9a-z]{10}$/);
const listInput = z.object({ companyId, partnerId: id.optional() }).strict();
const mapInput = z.object({ mapId: id }).strict();
const startInput = z.object({ companyId, partnerId: id }).strict();
const changeInput = z.object({ mapId: id, change: z.unknown() }).strict();
/** A row of the guided steps: its fields are checked as an add's values. People and milestones carry the draft's id. */
const draftRow = z.record(z.string(), z.unknown());
const keyedRow = z.object({ id }).catchall(z.unknown());
const fillInput = z.object({
  mapId: id,
  horizonDays: z.number().optional(),
  objectives: z.array(draftRow).max(50),
  people: z.array(keyedRow).max(100),
  milestones: z.array(keyedRow).max(50),
  exitTriggers: z.array(draftRow).max(30),
  activities: z.array(draftRow).max(300),
}).strict();

/** The MAP isn't in the directory, or isn't this person's: deleted, removed with its partner type, or never there. */
/** No longer in the directory, in the words of where the work lives. */
const notListed = (deps: Deps): Failure => ({ ok: false, error: 'file_not_found', message: wordsOf(deps).MAP_NOT_LISTED });
const READ_ONLY_AFTER_EXIT: Failure = { ok: false, error: 'forbidden', message: COPY.MAP_READ_ONLY_AFTER_EXIT };

/**
 * A partner type taken out of Partners by hand leaves its MAP listed, but for a person with a link the MAP is gone, as
 * if deleted (Review Focus 4): they get the same answer, never the owner's words about Partners, and their screen ends
 * the session on it.
 */
const goneForLink = (deps: Deps, actor: Actor, failure: Failure): Failure => (actor.kind === 'link' && failure === TYPE_GONE ? notListed(deps) : failure);

/** What kind of change a person with a link made, for the owner's partner alerts (the MAP app's plan_events). */
function eventAction(change: MapChange): MapEvent['action'] | null {
  if (change.kind === 'add') return 'created';
  if (change.kind === 'delete') return 'deleted';
  if (change.kind === 'update') return 'status' in change.patch ? 'status_changed' : 'updated';
  return null;
}

/** Records a change by a person with a link, ids and codes only. Best effort: logged with ids only. */
async function noteLinkChange(
  deps: Deps, mapId: string, actor: Extract<Actor, { kind: 'link' }>, change: MapChange, entityId: string, at: IsoDateTime,
): Promise<void> {
  const action = eventAction(change);
  if (!action || !('entity' in change)) return;
  try {
    await deps.mapEvents.record(mapId, { entityType: change.entity, entityId, action, actorRef: actor.linkId, at });
  } catch {
    logQuietly(deps, 'map_event_failed', { mapId });
  }
}

/** "Acme as reseller", or the partner type alone when the partner has no name. */
export function displayNameOf(partnerName: string, partnerType: PartnerType): string {
  const label = PARTNER_TYPE_LABELS[partnerType];
  return partnerName ? COPY.PARTNER_AS_TYPE(partnerName, label) : label;
}

/**
 * The MAP as a person with a link may see it: without its review rows, in a read, a change's answer and so in an undo
 * (reviews Review Focus 1). Anyone else sees all of it.
 */
const linkView = (actor: Actor, snapshot: Snapshot<MapPlan>): Snapshot<MapPlan> =>
  (actor.kind === 'link' ? { ...snapshot, value: withoutReviews(snapshot.value) } : snapshot);

/** The ids an event names: the MAP, what the change touched, and for a person with a link, the link. */
const eventIds = (actor: Actor, ids: string[]): string[] => (actor.kind === 'link' ? [...ids, actor.linkId] : ids);

/**
 * A good read of the MAP's file shows its owner's Google access works again: a MAP whose emails were paused for it
 * resumes (the MAP app's resumeIfPaused). Best effort: logged with ids only.
 */
async function resumeIfPaused(deps: Deps, mapId: string): Promise<void> {
  try {
    if ((await deps.directory.resumeMaps([mapId])).length > 0) logQuietly(deps, 'map_resumed', { mapId });
  } catch {
    logQuietly(deps, 'map_resume_failed', { mapId });
  }
}

/** Renames the MAP's directory row after the partner was renamed. Best effort: the next read puts it right. */
async function renameRow(deps: Deps, mapId: string, entry: MapEntry, record: MapRecord): Promise<void> {
  const name = displayNameOf(record.partnerName, entry.partnerType);
  if (name === entry.displayName) return;
  try {
    await deps.directory.renameMap(mapId, name);
  } catch {
    logQuietly(deps, 'directory_rename_failed', { mapId });
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads

export interface MapListItem {
  mapId: string;
  partnerId: string;
  partnerType: PartnerType;
  /** "Acme as reseller", as the directory lists it. */
  displayName: string;
  createdAt: IsoDateTime;
  /** The date the open dates stand for: what signing moves them from (spec 5.3). */
  plannedStart: IsoDate;
  /** The partner type's stage and signing date in Partners; null when it is gone from Partners. */
  stage: Stage | null;
  signedDate: IsoDate | null;
  /** The copy on the partner row (spec 5.7): it may lag by up to a day. */
  health: Health | null;
  nextMilestone: IsoDate | null;
  /** A move of the open dates at this signing failed: the MAP page offers it again. */
  datesMoveFailed: boolean;
  /** What its health counts progress from (`lastProgress`, ruling R6). */
  lastProgressAt: IsoDateTime;
}

/**
 * The company's MAPs that this person owns (one partner type's, when given), oldest first: the directory, and one
 * Partners read for the stage and the summary on each partner row.
 */
export const listMaps = ownCompanyOnly(async function listMaps(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MapListItem[]>> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'maps.list', { ownerUserId: actor.userId })) return FORBIDDEN;
  const { partnerId } = parsed.data;
  const mine = (await deps.directory.maps(parsed.data.companyId))
    .filter((m) => isOwner(actor, m) && (partnerId === undefined || m.partnerId === partnerId));
  if (mine.length === 0) return ok([]);
  const book = await deps.directory.partnerBook(parsed.data.companyId);
  if (!book || !isOwner(actor, book)) return NOT_FOUND_FILE;
  const read = await deps.partnerBooks.read({ fileId: book.fileId });
  if (!read.ok) return fromStore(read);
  const rows = new Map(read.snapshot.value.partners.map((p) => [p.id, p]));
  await record(deps, actor, 'maps.list', '', mine.map((m) => m.mapId));
  return ok(mine.map((m) => {
    const p = rows.get(m.partnerId);
    const row = p && p.partnerType === m.partnerType ? p : null;
    return {
      mapId: m.mapId, partnerId: m.partnerId, partnerType: m.partnerType, displayName: m.displayName, createdAt: m.createdAt,
      plannedStart: plannedStart(m), stage: row?.stage ?? null, signedDate: row?.signedDate ?? null,
      health: row?.mapHealth ?? null, nextMilestone: row?.mapNextMilestone ?? null,
      datesMoveFailed: moveOffered(m, row?.signedDate ?? null),
      lastProgressAt: lastProgress(m),
    };
  }));
});

/** A MAP as the directory alone lists it: no file is read. */
export interface MapId { mapId: string; partnerId: string; partnerType: PartnerType }

/**
 * The company's MAPs that this person owns (one partner type's, when given), from the directory only: no file is read,
 * so it answers while the Partners file is gone (counting the MAPs a new Partners file leaves behind) and costs the
 * Partners list no Google read (telling an empty MAP from no MAP, owner 2026-10-31).
 */
export const listMapIds = ownCompanyOnly(async function listMapIds(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MapId[]>> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'maps.list', { ownerUserId: actor.userId })) return FORBIDDEN;
  const { partnerId } = parsed.data;
  const mine = (await deps.directory.maps(parsed.data.companyId))
    .filter((m) => isOwner(actor, m) && (partnerId === undefined || m.partnerId === partnerId));
  if (mine.length > 0) await record(deps, actor, 'maps.list', '', mine.map((m) => m.mapId));
  return ok(mine.map(({ mapId, partnerId: id, partnerType }) => ({ mapId, partnerId: id, partnerType })));
});

export type MapRead = FileRead<MapPlan> & {
  /** The MAP app's plan details: the MAP joined with the partner record (`planInfoFor`). */
  info: PlanInfo;
  record: MapRecord;
  plannedStart: IsoDate;
  /** A move of the open dates at this signing failed: the MAP page offers it again (ruling R4). */
  datesMoveFailed: boolean;
  /** What its health counts progress from (`lastProgress`, ruling R6). */
  lastProgressAt: IsoDateTime;
  /** The day it was started: what it counts from before signing (`planInfoFor`'s `unsignedStart`, ruling R3). */
  startedOn: IsoDate;
};

/**
 * Reads a MAP with the partner record's facts joined in. A person with a link reads their own MAP only, without the
 * file's address and without its review rows (reviews Review Focus 1). The directory row follows a renamed partner.
 */
export async function readMap(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MapRead>> {
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'maps.read', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const facts = await recordFor(deps, entry);
  if (!facts.ok) return goneForLink(deps, actor, facts);
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  await resumeIfPaused(deps, mapId);
  await renameRow(deps, mapId, entry, facts.record);
  await record(deps, actor, 'maps.read', entry.fileId, eventIds(actor, [mapId]));
  const { signedDate } = facts.record;
  return ok({
    ...linkView(actor, read.snapshot),
    fileUrl: actor.kind === 'link' ? '' : deps.maps.urlFor({ fileId: entry.fileId }),
    info: planInfoFor(read.snapshot.value.info, facts.record, startedOn(entry)),
    record: facts.record,
    plannedStart: plannedStart(entry),
    datesMoveFailed: moveOffered(entry, signedDate),
    lastProgressAt: lastProgress(entry),
    startedOn: startedOn(entry),
  });
}

// ---------------------------------------------------------------------------------------------------------------------
// Writes

/**
 * Starts the MAP of a partner type (spec 5.1, 5.2): empty apart from its info, named after the partner, listed in the
 * directory. One MAP per partner type: refused when it has one. Its health goes onto the partner type's row.
 */
export const startMap = ownCompanyOnly(async function startMap(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ mapId: string }>> {
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { companyId: company, partnerId } = parsed.data;
  const book = await deps.directory.partnerBook(company);
  if (!book || !isOwner(actor, book)) return NOT_FOUND_FILE;
  if (!can(actor, 'maps.start', book)) return FORBIDDEN;
  // The partner type must be in this company's Partners before anything is said about a MAP: partner type ids are
  // unique only within a company, so the answer never tells of another company's MAP.
  const read = await deps.partnerBooks.read({ fileId: book.fileId });
  if (!read.ok) return fromStore(read);
  const partner = read.snapshot.value.partners.find((p) => p.id === partnerId);
  if (!partner) return refused('partnerId', COPY.MAP_TYPE_GONE);
  const already = refused('partnerId', COPY.MAP_ALREADY);
  if (await deps.directory.mapFor(company, partnerId)) return already;
  const account = read.snapshot.value.accounts.find((a) => a.id === partner.accountId);
  const partnerName = (account?.company ?? '').trim().slice(0, MAX_NAME).trim();
  const plan = newMapPlan({ partnerId, partnerType: partner.partnerType, contacts: [] });

  let fileId: string;
  try {
    fileId = (await deps.maps.create(ownerOf(actor), company, plan, partnerName)).fileId;
  } catch (error) {
    return createFailed(error);
  }
  const mapId = newMapId();
  // It starts on the owner's today, not the UTC date of the instant it was made (question 20).
  const today = await ownerToday(deps, actor.userId);
  const entry: MapEntry & { startedOn: IsoDate } = {
    fileId, ownerUserId: actor.userId, companyId: company, partnerId, partnerType: partner.partnerType,
    displayName: displayNameOf(partnerName, partner.partnerType), createdAt: deps.clock(), startedOn: today, datesMovedFor: null,
    datesMoveFailedFor: null, lastChangeAt: null,
  };
  try {
    await deps.directory.addMap({ mapId, ...entry });
  } catch (error) {
    await deps.maps.discard({ fileId });
    // A second start for the same partner type won the race: one MAP per partner type.
    if (error instanceof DuplicateEntry) return already;
    throw error;
  }
  await record(deps, actor, 'maps.start', fileId, [mapId, partnerId]);
  const facts = await recordFor(deps, entry);
  if (facts.ok) await writeSummary(deps, actor, { mapId, entry, read: facts }, plan, lastProgress(entry));
  return ok({ mapId });
});

/** A change saved: the MAP as its file holds it now, with what the screens join it with. */
export interface MapChanged {
  snapshot: Snapshot<MapPlan>;
  entityId: string | null;
  /** The MAP app's plan details: the MAP joined with the partner record (`planInfoFor`). */
  info: PlanInfo;
  record: MapRecord;
  /** The day the MAP was started (see `MapRead`). */
  startedOn: IsoDate;
  /**
   * The MAP's last progress after this change (ruling R6): the change's time, unless it changed only review rows, which
   * aren't MAP progress (owner, 2026-11-01).
   */
  lastProgressAt: IsoDateTime;
}

/**
 * Applies one of the MAP app's changes (spec 8). Who may make it is the MAP's rule (`canChangeMap`): a person with a
 * link changes only their own side, never plan info, a horizon or a delete (Review Focus 1), and after the partner
 * type's exit only reads (spec 5.3). For them the change is checked against the MAP as read now, and an activity
 * update must find the row as it was checked. After a good write the health and next milestone go onto the partner
 * type's row, best effort.
 */
export async function changeMap(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<MapChanged>> {
  const parsed = changeInput.safeParse(input);
  if (!parsed.success) return invalid();
  const sent = parseMapChange(parsed.data.change);
  if (!sent) return invalid();
  const { mapId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  // A new horizon starts on the owner's today, not on the date a page left open overnight sent (the MAP app's
  // applyChangeAsOwner and todayFor).
  const change: MapChange = sent.kind === 'startHorizon' ? { ...sent, startDate: await ownerToday(deps, entry.ownerUserId) } : sent;
  if (!can(actor, 'maps.change', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const facts = await recordFor(deps, entry);
  if (!facts.ok) return goneForLink(deps, actor, facts);
  if (actor.kind === 'link' && facts.record.stage === 'exit') return READ_ONLY_AFTER_EXIT;

  let acting = actor;
  let checked: MapChange = change;
  const mapActor = mapActorOf(actor);
  if (actor.kind === 'link' || actor.kind === 'agent') {
    let rows: Pick<MapPlan, 'people' | 'activities' | 'objectives'> = { people: [], activities: [], objectives: [] };
    if (actor.kind === 'link') {
      const read = await deps.maps.read({ fileId: entry.fileId });
      if (!read.ok) return fromStore(read);
      rows = read.snapshot.value;
      const person = rows.people.find((p) => p.id === actor.personId);
      acting = { ...actor, name: person?.name ?? actor.name };
      // The row the change was allowed on: an activity changed since (its side, say) is a conflict, nothing written.
      if (change.kind === 'update' && change.entity === 'activity' && change.expectedUpdatedAt === undefined) {
        const activity = rows.activities.find((a) => a.id === change.id);
        if (activity) checked = { ...change, expectedUpdatedAt: activity.updatedAt };
      }
    }
    const decision = canChangeMap(mapActor, change, rows);
    if (!decision.allowed) return { ok: false, error: 'forbidden', message: decision.reason };
  }

  const fileChange = { ...checked, record: facts.record, validate: mapValidationFor(mapActor) } as MapFileChange;
  const now = deps.clock();
  const out = await deps.maps.apply({ fileId: entry.fileId }, fileChange, { now, actor: actorLabel(acting) });
  if (!out.ok) return fromStore(out);
  const touched = out.entityId ?? ('id' in change ? change.id : null);
  await record(deps, acting, 'maps.change', entry.fileId, eventIds(acting, touched ? [mapId, touched] : [mapId]));
  if (acting.kind === 'link' && touched) await noteLinkChange(deps, mapId, acting, change, touched, now);
  // A review's prep isn't MAP progress (owner, 2026-11-01): the MAP's last change stays where it was.
  const progressAt = isMapProgress(change) ? now : lastProgress(entry);
  if (isMapProgress(change)) await noteChange(deps, mapId, now);
  await writeSummary(deps, acting, { mapId, entry, read: facts }, out.snapshot.value, progressAt);
  return ok({
    snapshot: linkView(acting, out.snapshot), entityId: out.entityId, info: planInfoFor(out.snapshot.value.info, facts.record, startedOn(entry)),
    record: facts.record, startedOn: startedOn(entry), lastProgressAt: progressAt,
  });
}

/** Refused when the guided steps are sent for a MAP that holds plan content already. */
const FILLED_ALREADY: Failure = { ok: false, error: 'invalid', message: COPY.MAP_FILLED_ALREADY };

/**
 * The guided first MAP (spec 5.2, MAP 3.1): the rows the steps made, added to a MAP that has no objectives, activities or
 * exit triggers yet [builder's call]. Two writes: the horizon length, people and milestones, then the objectives, exit
 * triggers and activities, whose owner and milestone name the draft's people and milestones by the draft's ids. A
 * person or milestone already in the MAP by that name is that one, so a fill that stopped after its first write can be
 * made again. Every row is checked against the MAP before anything is written. Not for a person with a link.
 */
export async function fillMap(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ mapId: string }>> {
  const parsed = fillInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, horizonDays, objectives, people, milestones, exitTriggers, activities } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (actor.kind === 'link' || !can(actor, 'maps.change', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const facts = await recordFor(deps, entry);
  if (!facts.ok) return facts;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const plan = read.snapshot.value;
  if (plan.objectives.length + plan.activities.length + plan.exitTriggers.length > 0) return FILLED_ALREADY;

  // The first write: the draft's people and milestones not in the MAP yet (by name), each with the draft id it had.
  const known: Record<string, string> = {};
  const first: Array<{ change: MapChange; key: string | null }> = [];
  if (horizonDays !== undefined && horizonDays !== plan.info.horizonDays) {
    first.push({ change: { kind: 'updateInfo', patch: { horizonDays } }, key: null });
  }
  const keyed = (entity: 'person' | 'milestone', rows: Array<{ id: string } & Record<string, unknown>>, have: Array<{ id: string; name: string }>) => {
    for (const { id: key, ...values } of rows) {
      const same = have.find((row) => normalizeName(row.name) === normalizeName(String(values.name ?? '')));
      if (same) known[key] = same.id;
      else first.push({ change: { kind: 'add', entity, values }, key });
    }
  };
  keyed('person', people, plan.people);
  keyed('milestone', milestones, plan.milestones);
  const second = (ids: Record<string, string>): MapChange[] | null => {
    const changes: MapChange[] = [
      ...objectives.map((values): MapChange => ({ kind: 'add', entity: 'objective', values })),
      ...exitTriggers.map((values): MapChange => ({ kind: 'add', entity: 'exitTrigger', values })),
    ];
    for (const values of activities) {
      const refs: Record<string, unknown> = {};
      for (const key of ['ownerId', 'milestoneId'] as const) {
        const ref = values[key];
        if (ref === undefined || ref === null) continue;
        if (typeof ref !== 'string' || ids[ref] === undefined) return null;
        refs[key] = ids[ref];
      }
      changes.push({ kind: 'add', entity: 'activity', values: { ...values, ...refs } });
    }
    return changes;
  };

  // Every change is checked as one sent alone would be, then all of them against the MAP as it is, before any write.
  const mapActor = mapActorOf(actor);
  const check = (changes: MapChange[]): Failure | null => {
    for (const c of changes) {
      if (parseMapChange(c) === null) return invalid();
      const decision = canChangeMap(mapActor, c, plan);
      if (!decision.allowed) return { ok: false, error: 'forbidden', message: decision.reason };
    }
    return null;
  };
  const now = deps.clock();
  const stamp = { now, actorName: actorLabel(actor) };
  let trial = plan;
  const trialIds = { ...known };
  for (const { change: c, key } of first) {
    const problem = check([c]);
    if (problem) return problem;
    const out = applyMapChange(trial, c, stamp, facts.record);
    if (!out.ok) return out;
    trial = out.plan;
    if (key !== null && out.entityId) trialIds[key] = out.entityId;
  }
  const planned = second(trialIds);
  if (planned === null) return invalid();
  const refusal = check(planned);
  if (refusal) return refusal;
  for (const c of planned) {
    const out = applyMapChange(trial, c, stamp, facts.record);
    if (!out.ok) return out;
    trial = out.plan;
  }

  const validate = mapValidationFor(mapActor);
  const asFile = (c: MapChange) => ({ ...c, record: facts.record, validate }) as MapFileChange;
  const ref = { fileId: entry.fileId };
  const label = { now, actor: actorLabel(actor) };
  const touched: string[] = [];
  let latest = plan;
  if (first.length > 0) {
    const out = await deps.maps.applyMany(ref, first.map(({ change: c }) => asFile(c)), label);
    if (!out.ok) return fromStore(out);
    first.forEach(({ key }, index) => {
      const made = out.entityIds[index];
      if (key !== null && made) known[key] = made;
      if (made) touched.push(made);
    });
    latest = out.snapshot.value;
  }
  const rest = second(known);
  if (rest === null) return invalid();
  if (rest.length > 0) {
    const out = await deps.maps.applyMany(ref, rest.map(asFile), label);
    if (!out.ok) return fromStore(out);
    touched.push(...out.entityIds.filter((made): made is string => made !== null));
    latest = out.snapshot.value;
  }
  await record(deps, actor, 'maps.change', entry.fileId, [mapId, ...touched]);
  await noteChange(deps, mapId, now);
  await writeSummary(deps, actor, { mapId, entry, read: facts }, latest, now);
  return ok({ mapId });
}

/**
 * Deletes a MAP (spec 8): its links go off and its sessions end, its row goes, its file goes to the person's Drive
 * trash, and the partner type's MAP health and next milestone are cleared (best effort). A decision: a person only.
 */
export async function deleteMap(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ mapId: string }>> {
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'maps.delete', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  await revokeMapAccess(deps, entry.ownerUserId, [mapId]);
  await dropMaps(deps, actor, [{ mapId, fileId: entry.fileId }], 'trash');
  const facts = await recordFor(deps, entry);
  if (facts.ok) {
    await setSummary(deps, actor, { mapId, partnerId: entry.partnerId, bookFileId: facts.bookFileId }, facts.partner, null, null);
  }
  return ok({ mapId });
}

// ---------------------------------------------------------------------------------------------------------------------
// Moving the open dates at signing (spec 5.3, ruling R4)

/**
 * Moves the MAP's open dates for the partner type's signing, when the move at signing failed or wasn't chosen (spec
 * 5.3): the MAP page offers it. Refused before signing, and once the dates were moved for this signing. The owner only.
 */
export async function shiftMapDates(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ days: number }>> {
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'maps.shiftDates', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const facts = await recordFor(deps, entry);
  if (!facts.ok) return facts;
  const { signedDate } = facts.record;
  if (signedDate === null) return refused('signedDate', COPY.MAP_DATES_NOT_SIGNED);
  if (entry.datesMovedFor === signedDate) return refused('signedDate', COPY.MAP_DATES_MOVED_ALREADY);
  const moved = await moveOpenDates(deps, actor, mapId, entry, facts);
  return moved.ok ? ok({ days: moved.days }) : moved;
}

/**
 * After a signing the person chose to move the MAP's dates with (`changePartner`): moves them, when the partner type has
 * a MAP. The signing is saved already and stands whatever happens here; the answer says whether the dates moved.
 */
export async function moveDatesAfterSigning(
  deps: Deps, actor: Actor, company: string, partnerId: string,
): Promise<{ moved: boolean; days: number } | undefined> {
  const found = await deps.directory.mapFor(company, partnerId);
  if (!found || !isOwner(actor, found) || !can(actor, 'maps.shiftDates', { ownerUserId: found.ownerUserId, mapId: found.mapId })) {
    return undefined;
  }
  const { mapId, ...entry } = found;
  const facts = await recordFor(deps, entry);
  if (!facts.ok || facts.record.signedDate === null) {
    logQuietly(deps, 'map_dates_move_failed', { mapId, partnerId, error: facts.ok ? 'not_signed' : facts.error });
    return { moved: false, days: 0 };
  }
  const { signedDate } = facts.record;
  const days = daysBetween(plannedStart(entry), signedDate);
  if (entry.datesMovedFor === signedDate) return { moved: true, days: 0 };
  try {
    const moved = await moveOpenDates(deps, actor, mapId, entry, facts);
    return { moved: moved.ok, days };
  } catch {
    // As a refused move: recorded, so the MAP page offers it again (a move recorded as done before the throw wins).
    await noteMoveFailed(deps, { mapId, partnerId }, signedDate, 'thrown');
    return { moved: false, days };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Email (task 8): the owner's timezone, a MAP's email settings, and the scheduled job's read

const timeZoneInput = z.object({ timeZone: z.string().min(1).max(64) }).strict();

/** The company's timezone for its MAPs: what an admin chose in Settings, or Europe/Berlin. Every member reads it. */
export async function timeZoneSetting(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ timeZone: string }>> {
  if (!z.object({}).strict().safeParse(input).success) return invalid();
  if (!can(actor, 'company.read', { ownerUserId: actor.userId })) return FORBIDDEN;
  return ok({ timeZone: await ownerTimeZone(deps, actor.userId) });
}

/**
 * Saves the person's timezone (Settings): their MAPs count "today" in it, and their emails go out at 08:00 in it. A
 * zone this runtime doesn't know is refused. Their own company only, found by the person; a person only.
 */
export async function saveTimeZone(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ timeZone: string }>> {
  const parsed = timeZoneInput.safeParse(input);
  if (!parsed.success || !isValidTimeZone(parsed.data.timeZone)) return refused('timeZone', COPY.SETTINGS_TIME_ZONE_INVALID);
  if (!can(actor, 'company.timezone', { ownerUserId: actor.userId })) return FORBIDDEN;
  await deps.companies.setTimeZone(actor.userId, parsed.data.timeZone);
  await record(deps, actor, 'company.timezone', '', []);
  return ok({ timeZone: parsed.data.timeZone });
}

/** A MAP's email settings as stored, with the MAP app's defaults for what isn't set or can't be read. */
export function notifySettingsOf(stored: { dueSoonDays?: number; partnerDigest?: boolean; partnerAlerts?: NotifySettings['partnerAlerts'] }): NotifySettings {
  const dueSoonDays = stored.dueSoonDays === 1 || stored.dueSoonDays === 3 || stored.dueSoonDays === 7 ? stored.dueSoonDays : DEFAULT_SETTINGS.dueSoonDays;
  return {
    dueSoonDays,
    partnerDigest: stored.partnerDigest ?? DEFAULT_SETTINGS.partnerDigest,
    partnerAlerts: stored.partnerAlerts ?? DEFAULT_SETTINGS.partnerAlerts,
  };
}

export interface MapNotifyView {
  settings: NotifySettings;
  /** The owner's timezone: the emails go out at 08:00 in it. */
  timeZone: string;
}

/** A MAP's email settings (the MAP app's Notifications dialog). The owner only. */
export async function mapNotifySettings(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MapNotifyView>> {
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await ownMap(deps, actor, parsed.data.mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'maps.notifyRead', { ownerUserId: entry.ownerUserId, mapId: parsed.data.mapId })) return FORBIDDEN;
  const state = await deps.directory.mapNotifyState(parsed.data.mapId);
  if (!state) return notListed(deps);
  return ok({ settings: notifySettingsOf(state.settings), timeZone: await ownerTimeZone(deps, entry.ownerUserId) });
}

const notifyInput = z.object({ mapId: id, settings: notifySettingsSchema }).strict();

/**
 * Saves a MAP's email settings: the days before a due date reminders start, the partner's weekly copy and the partner
 * alerts. Turning partner alerts on from off starts them after the changes already made (the MAP app's Decision 11).
 * The owner only; settings and ids in our database, never plan content.
 */
export async function saveMapNotifySettings(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<NotifySettings>> {
  const parsed = notifyInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, settings } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'maps.notify', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const state = await deps.directory.mapNotifyState(mapId);
  if (!state) return notListed(deps);
  const wasOff = notifySettingsOf(state.settings).partnerAlerts === 'off';
  const cursor = wasOff && settings.partnerAlerts !== 'off' ? { partnerAlertsThrough: await deps.mapEvents.latestId(mapId) } : {};
  await deps.directory.setMapNotifyState(mapId, { settings, ...cursor });
  await record(deps, actor, 'maps.notify', entry.fileId, [mapId]);
  return ok(settings);
}

export interface MapForJob {
  /** The MAP with the partner record's facts joined in: what the MAP app's notification rules take. */
  plan: JoinedPlan;
  record: MapRecord;
  /** The owner's today. */
  today: IsoDate;
  /** The MAP's one last progress (ruling R6). */
  lastEventAt: IsoDateTime;
  /** Whether the partner type's MAP health and next milestone were written: only when they changed (spec 5.7). */
  refreshed: 'written' | 'unchanged' | 'failed';
}

/**
 * The scheduled job's read of one MAP (spec 5.7, task 8): the MAP joined with the partner record, as its owner. It also
 * refreshes the partner type's MAP health and next milestone when days passing changed them, with the MAP's last
 * change as its last progress (ruling R6). A partner record it can't trust is never written (Review Focus 5): a
 * Partners file or a partner type row it can't read (renamed tab, broken row, partner type gone) fails the read, and a
 * row changed since it was read is a conflict; either way ids are logged and the next run tries again. Only the two
 * MAP cells of the MAP's own row are written, never a row without a MAP. The owner and their agent only.
 */
export async function readMapForJob(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MapForJob>> {
  const parsed = mapInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry || actor.kind === 'link') return notListed(deps);
  if (!can(actor, 'maps.read', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const facts = await recordFor(deps, entry);
  if (!facts.ok) return facts;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const today = await ownerToday(deps, entry.ownerUserId);
  const lastEventAt = lastProgress(entry);
  const summary = mapSummary(read.snapshot.value, facts.record, startedOn(entry), today, lastEventAt);
  const refreshed = await setSummary(
    deps, actor, { mapId, partnerId: entry.partnerId, bookFileId: facts.bookFileId }, facts.partner, summary.health, summary.nextMilestone, true,
  );
  await record(deps, actor, 'maps.read', entry.fileId, [mapId]);
  return ok({ plan: joinPlan(read.snapshot.value, facts.record, startedOn(entry)), record: facts.record, today, lastEventAt, refreshed });
}

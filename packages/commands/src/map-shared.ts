// What the MAP commands share with the partner commands (spec 5.3, 5.6): the partner record a MAP shows, its summary on
// the partner row, its removal, and the move of its open dates at signing. Not exported from the package: every
// command checks access itself, and these run only after a command has.
import {
  addDays, daysBetween, horizonDayDate, isOpen, isValidTimeZone, localTime, mapSummary, reviewDateOf, toIsoDate,
  type Health, type IsoDate, type IsoDateTime, type JoinedPlan, type MapActor, type MapChange, type MapPlan, type MapRecord, type MapReview,
  type Partner, type PartnerBook,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { MapFileChange } from '@partner-desk/storage';
import { actorLabel, levelAtLeast, type Actor } from './actor';
import type { Deps } from './deps';
import type { MapEntry } from './directory';
import { logQuietly, refused } from './shared';
import { fromStore, isOwner, record, type Failure } from './result';

export const TYPE_GONE: Failure = { ok: false, error: 'invalid', message: COPY.MAP_TYPE_GONE };

/** A MAP's directory row, when the actor may reach it. Anyone else gets the answer for a MAP that isn't there. */
export async function ownMap(deps: Deps, actor: Actor, mapId: string): Promise<MapEntry | null> {
  const entry = await deps.directory.map(mapId);
  return entry && isOwner(actor, entry) ? entry : null;
}

/**
 * The commands' actor as the MAP's access rules see it (ruling R1). An agent at propose changes a MAP as one at change
 * does (agent proposals spec 5.2): no MAP change is proposable, so the MAP rules see it at change [builder's call].
 */
export function mapActorOf(actor: Actor): MapActor {
  switch (actor.kind) {
    case 'owner':
      return { kind: 'owner' };
    case 'agent':
      return { kind: 'agent', level: levelAtLeast(actor.level, 'change') ? 'change' : 'read' };
    case 'link':
      return { kind: 'link', personId: actor.personId, side: actor.side, name: actor.name };
  }
}

/** The MAP app's longest partner name and closing reason: a longer value from Partners is cut, so it never blocks a MAP save. */
export const MAX_NAME = 200;
export const MAX_REASON = 1000;

/** The owner's timezone until they choose one in Settings [builder's call]. */
export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

/** The MAP owner's timezone (Settings), or Europe/Berlin. A zone this runtime doesn't know reads as the default. */
export async function ownerTimeZone(deps: Pick<Deps, 'companies' | 'log'>, userId: string): Promise<string> {
  try {
    const zone = await deps.companies.timeZoneOf(userId);
    return zone && isValidTimeZone(zone) ? zone : DEFAULT_TIME_ZONE;
  } catch {
    logQuietly(deps, 'time_zone_read_failed', {});
    return DEFAULT_TIME_ZONE;
  }
}

/**
 * "Today" for the owner's MAPs: the date in their timezone, as the MAP app's todayFor(userId). A new horizon starts on
 * it, and health, Day N and the 08:00 emails count from it.
 */
export async function ownerToday(deps: Pick<Deps, 'companies' | 'log' | 'clock'>, userId: string): Promise<IsoDate> {
  return localTime(new Date(deps.clock()), await ownerTimeZone(deps, userId)).date;
}

/**
 * The day a MAP not yet signed counts from: the day it was started (ruling R3), the owner's date when it was made
 * (question 20). A MAP made before it kept that day keeps the UTC date of its created time.
 */
export const startedOn = (entry: Pick<MapEntry, 'createdAt' | 'startedOn'>): IsoDate => entry.startedOn ?? toIsoDate(entry.createdAt);

/**
 * The horizon a review closes, as `horizonWork` reads it: its start and the day it ends (held on, or its review date).
 * A held review's horizon is past; one the MAP no longer has (an undone signing) reads as the current one.
 */
export function horizonOf(plan: JoinedPlan, review: MapReview | null): { plan: JoinedPlan; until: IsoDate } {
  const { info } = plan;
  const past = review !== null && review.horizon <= info.pastHorizons.length ? info.pastHorizons[review.horizon - 1]! : null;
  if (past) {
    const until = review!.heldOn ?? horizonDayDate(past.startDate, past.horizonDays);
    return { plan: { ...plan, info: { ...info, startDate: past.startDate, horizonDays: past.horizonDays } }, until };
  }
  return { plan, until: reviewDateOf(info) ?? horizonDayDate(info.startDate, info.horizonDays) };
}

/** The date the MAP's open dates stand for: the signing they were last moved for, else the day it was started (ruling R4). */
export const plannedStart = (entry: Pick<MapEntry, 'createdAt' | 'startedOn' | 'datesMovedFor'>): IsoDate => entry.datesMovedFor ?? startedOn(entry);

/**
 * The one "last progress" of a MAP (ruling R6): the last change to its own rows through PartnerStandard Desk, by anyone (a
 * review's prep isn't one, owner 2026-11-01: `isMapProgress`), else the day it was started. Its health counts "no
 * progress" from here on every screen, in the partner row's copy and in the refresh.
 */
export const lastProgress = (entry: Pick<MapEntry, 'createdAt' | 'lastChangeAt'>): IsoDateTime => entry.lastChangeAt ?? entry.createdAt;

/** The review rows of a MAP file: a review, its numbers and its items. */
const REVIEW_ENTITIES: ReadonlySet<string> = new Set(['review', 'reviewNumber', 'reviewItem']);

/**
 * Whether a change counts as the MAP's progress (its last change, ruling R6): only the MAP's own rows do. A change to a
 * review, its numbers or its items doesn't, so preparing a review never hides a stalled MAP (owner, 2026-11-01).
 */
export const isMapProgress = (change: MapChange): boolean => !('entity' in change) || !REVIEW_ENTITIES.has(change.entity);

/** Records a write to the MAP as its last change (ruling R6). Best effort: logged with ids only. */
export async function noteChange(deps: Deps, mapId: string, at: IsoDateTime): Promise<void> {
  try {
    await deps.directory.setMapLastChange(mapId, at);
  } catch {
    logQuietly(deps, 'map_last_change_failed', { mapId });
  }
}

export interface RecordRead {
  ok: true;
  record: MapRecord;
  partner: Partner;
  bookFileId: string;
  /** The Partners file as read: a review counts the account's active sellers and finds the linked hypotheses in it. */
  book: PartnerBook;
}

/**
 * The partner record's facts the MAP shows (spec 5.3), read from the owner's Partners file: the partner type the
 * directory lists, and its account's name. The command has checked the actor's access to the MAP; a person with a link
 * sees only these facts of Partners, never the file.
 */
export async function recordFor(deps: Deps, entry: MapEntry): Promise<RecordRead | Failure> {
  const book = await deps.directory.partnerBook(entry.companyId);
  if (!book || book.ownerUserId !== entry.ownerUserId) return TYPE_GONE;
  const read = await deps.partnerBooks.read({ fileId: book.fileId });
  if (!read.ok) return fromStore(read);
  const found = recordIn(read.snapshot.value, entry);
  if (!found) return TYPE_GONE;
  return { ok: true, ...found, bookFileId: book.fileId, book: read.snapshot.value };
}

/**
 * The partner record's facts for a MAP, from a Partners file already read: null when the partner type the directory
 * lists is gone from it. For a command that reads many MAPs of one company with one Partners read.
 */
export function recordIn(book: PartnerBook, entry: Pick<MapEntry, 'partnerId' | 'partnerType'>): { record: MapRecord; partner: Partner } | null {
  const partner = book.partners.find((p) => p.id === entry.partnerId && p.partnerType === entry.partnerType);
  if (!partner) return null;
  const account = book.accounts.find((a) => a.id === partner.accountId);
  const record: MapRecord = {
    partnerName: (account?.company ?? '').trim().slice(0, MAX_NAME).trim(),
    partnerType: partner.partnerType,
    stage: partner.stage,
    signedDate: partner.signedDate,
    closed: partner.closed,
    closedReason: partner.closedReason.slice(0, MAX_REASON),
  };
  return { record, partner };
}

/**
 * Writes the MAP's health and next milestone to its partner type's row (spec 5.7), when they changed. Best effort: a
 * failure is logged with ids only and never fails the command; the daily refresh puts it right. Never stamps the row.
 */
export async function writeSummary(
  deps: Deps, actor: Actor, at: { mapId: string; entry: MapEntry; read: RecordRead }, plan: MapPlan, lastEventAt: IsoDateTime | null,
): Promise<'written' | 'unchanged' | 'failed'> {
  const { mapId, entry, read } = at;
  const today = await ownerToday(deps, entry.ownerUserId);
  const summary = mapSummary(plan, read.record, startedOn(entry), today, lastEventAt);
  return setSummary(deps, actor, { mapId, partnerId: entry.partnerId, bookFileId: read.bookFileId }, read.partner, summary.health, summary.nextMilestone);
}

/**
 * Writes a partner type's MAP summary again after a change to its record that the MAP joins in (a reopen, an undone
 * signing): until then the row would keep what it said before, "Nothing planned yet" in the list for a MAP with
 * content after a reopen, say. Best effort, as every summary write: ids only in the logs, the change stands whatever
 * happens here. Nothing happens for a partner type without a MAP of this person's. True when the row was written.
 */
export async function refreshSummary(deps: Deps, actor: Actor, companyId: string, partnerId: string): Promise<boolean> {
  try {
    const [found] = await mapsOf(deps, actor, companyId, partnerId);
    if (!found) return false;
    const entry = await deps.directory.map(found.mapId);
    if (!entry) return false;
    const facts = await recordFor(deps, entry);
    if (!facts.ok) {
      logQuietly(deps, 'map_summary_refresh_failed', { mapId: found.mapId, partnerId, error: facts.error });
      return false;
    }
    const read = await deps.maps.read({ fileId: entry.fileId });
    if (!read.ok) {
      logQuietly(deps, 'map_summary_refresh_failed', { mapId: found.mapId, partnerId, error: read.error });
      return false;
    }
    return (await writeSummary(deps, actor, { mapId: found.mapId, entry, read: facts }, read.snapshot.value, lastProgress(entry))) === 'written';
  } catch {
    logQuietly(deps, 'map_summary_refresh_failed', { partnerId, error: 'thrown' });
    return false;
  }
}

/**
 * `row` is the partner type's row as read; with `guard`, the write is refused as a conflict when the row changed since
 * (the scheduled job's refresh, Review Focus 5). A row the store can't read is refused by the store, never written.
 */
export async function setSummary(
  deps: Deps, actor: Actor, at: { mapId: string; partnerId: string; bookFileId: string },
  row: Pick<Partner, 'mapHealth' | 'mapNextMilestone' | 'updatedAt'>, health: Health | null, nextMilestone: IsoDate | null, guard = false,
): Promise<'written' | 'unchanged' | 'failed'> {
  if (row.mapHealth === health && row.mapNextMilestone === nextMilestone) return 'unchanged';
  const ids = { mapId: at.mapId, partnerId: at.partnerId };
  try {
    const out = await deps.partnerBooks.apply(
      { fileId: at.bookFileId },
      { kind: 'setMapSummary', partnerId: at.partnerId, health, nextMilestone, ...(guard ? { expectedUpdatedAt: row.updatedAt } : {}) },
      { now: deps.clock(), actor: actorLabel(actor) },
    );
    if (out.ok) return 'written';
    logQuietly(deps, 'map_summary_write_failed', { ...ids, error: out.error });
  } catch {
    logQuietly(deps, 'map_summary_write_failed', { ...ids, error: 'thrown' });
  }
  return 'failed';
}

// ---------------------------------------------------------------------------------------------------------------------
// Removal (spec 5.6) and the date move at signing (spec 5.3, ruling R4)

/**
 * Turns off these MAPs' links, ends their sessions and turns off their reviews' summary links (reviews spec 5.6). A
 * removal does it first, before anything else is written: a removal that then fails leaves only the links off, and can
 * be made again (spec 5.6). `ownerUserId` owns the MAPs.
 */
export async function revokeMapAccess(deps: Deps, ownerUserId: string, mapIds: string[]): Promise<void> {
  if (mapIds.length === 0) return;
  const at = deps.clock();
  await deps.mapLinks.revokeMaps(mapIds, at);
  await deps.mapSessions.deleteForMaps(mapIds);
  await deps.reviewLinks.revokeMaps(ownerUserId, mapIds, at);
}

/**
 * Removes these MAPs' rows; with `trash`, their files go to the Drive trash too. Their links must be off already
 * (`revokeMapAccess`), so no link stays open for a MAP nobody sees.
 */
export async function dropMaps(
  deps: Deps, actor: Actor, maps: Array<{ mapId: string; fileId: string }>, files: 'trash' | 'keep',
): Promise<void> {
  if (maps.length === 0) return;
  await deps.directory.removeMaps(maps.map((m) => m.mapId));
  for (const { mapId, fileId } of maps) {
    if (files === 'trash') await deps.maps.trash({ fileId });
    await record(deps, actor, 'maps.delete', fileId, [mapId]);
  }
}

/** The person's MAPs of the company (of one partner type, when given), with their files: for spec 5.6. */
export async function mapsOf(
  deps: Deps, actor: Actor, company: string, partnerId?: string,
): Promise<Array<{ mapId: string; fileId: string }>> {
  const listed = (await deps.directory.maps(company))
    .filter((m) => isOwner(actor, m) && (partnerId === undefined || m.partnerId === partnerId));
  const found: Array<{ mapId: string; fileId: string }> = [];
  for (const { mapId } of listed) {
    const entry = await deps.directory.map(mapId);
    if (entry) found.push({ mapId, fileId: entry.fileId });
  }
  return found;
}

/**
 * Whether the MAP page offers the move of the open dates again (ruling R4): a move at this signing failed, and none
 * was recorded as done for it since. A move done always wins, so the dates never move twice for one signing.
 */
export const moveOffered = (entry: Pick<MapEntry, 'datesMovedFor' | 'datesMoveFailedFor'>, signedDate: IsoDate | null): boolean =>
  signedDate !== null && entry.datesMoveFailedFor === signedDate && entry.datesMovedFor !== signedDate;

/** Records a failed move, so the MAP page offers it again. Best effort: logged with ids only. */
export async function noteMoveFailed(deps: Deps, ids: { mapId: string; partnerId: string }, signedDate: IsoDate, error: string): Promise<void> {
  logQuietly(deps, 'map_dates_move_failed', { ...ids, error });
  try {
    await deps.directory.setMapDatesMoved(ids.mapId, { failedFor: signedDate });
  } catch {
    logQuietly(deps, 'map_dates_move_record_failed', ids);
  }
}

/**
 * Records a move made for this signing. The dates have moved whatever happens here: a failure is logged with ids only,
 * and the answer still says they moved, so the move is never offered for this answer again.
 */
async function noteMoved(deps: Deps, ids: { mapId: string; partnerId: string }, signedDate: IsoDate): Promise<void> {
  try {
    await deps.directory.setMapDatesMoved(ids.mapId, { movedFor: signedDate, failedFor: null });
  } catch {
    logQuietly(deps, 'map_dates_move_record_failed', ids);
  }
}

/**
 * Moves the MAP's open activities' due dates and its milestones not yet achieved by the days between its planned start
 * and `record`'s signing date, as the MAP app's "Agreement signed" did: done and not-needed activities, achieved
 * milestones and rows without a date keep theirs. One write, all or nothing; an activity changed since it was read is
 * a conflict. The directory records the move, done or failed, so it is never made twice and can be offered again.
 */
export async function moveOpenDates(
  deps: Deps, actor: Actor, mapId: string, entry: MapEntry, facts: RecordRead,
): Promise<{ ok: true; days: number } | Failure> {
  const signedDate = facts.record.signedDate;
  if (signedDate === null) return refused('signedDate', COPY.MAP_DATES_NOT_SIGNED);
  const days = daysBetween(plannedStart(entry), signedDate);
  const fail = async (failure: Failure): Promise<Failure> => {
    await noteMoveFailed(deps, { mapId, partnerId: entry.partnerId }, signedDate, failure.error);
    return failure;
  };
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fail(fromStore(read));
  const plan = read.snapshot.value;
  const changes: MapChange[] = days === 0 ? [] : [
    ...plan.milestones.filter((m) => m.targetDate !== null && m.achievedDate === null).map((m): MapChange => ({
      kind: 'update', entity: 'milestone', id: m.id, patch: { targetDate: addDays(m.targetDate!, days) },
    })),
    ...plan.activities.filter((a) => a.dueDate !== null && isOpen(a)).map((a): MapChange => ({
      kind: 'update', entity: 'activity', id: a.id, patch: { dueDate: addDays(a.dueDate!, days) }, expectedUpdatedAt: a.updatedAt,
    })),
  ];
  let moved = plan;
  if (changes.length > 0) {
    // Only the dates are checked: a row left half filled in the sheet never stops the move.
    const fileChanges = changes.map((c) => ({ ...c, record: facts.record, validate: 'patch' }) as MapFileChange);
    const now = deps.clock();
    const out = await deps.maps.applyMany({ fileId: entry.fileId }, fileChanges, { now, actor: actorLabel(actor) });
    if (!out.ok) return fail(fromStore(out));
    moved = out.snapshot.value;
    // The dates moved: recorded first, so nothing after this write can offer the move again.
    await noteMoved(deps, { mapId, partnerId: entry.partnerId }, signedDate);
    await record(deps, actor, 'maps.shiftDates', entry.fileId, [mapId, ...changes.map((c) => ('id' in c ? c.id : ''))]);
    await noteChange(deps, mapId, now);
    await writeSummary(deps, actor, { mapId, entry, read: facts }, moved, now);
    return { ok: true, days };
  }
  await noteMoved(deps, { mapId, partnerId: entry.partnerId }, signedDate);
  return { ok: true, days };
}

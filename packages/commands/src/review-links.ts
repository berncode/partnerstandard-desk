// The summary for the partner (reviews spec 5.6): a held review's summary link, made and turned off by its owner, and
// what the link shows to anyone who has it. The link works as the business case's share link (`shareCase` and
// `openSharedCase` in cases.ts): a random token, its hash in our database, one working link per review. The summary
// holds only what spec 5.6 allows, built here on the server.
import {
  categoryNumberOf, currentHorizon, horizonWork, joinPlan, mapValidationFor, randomSuffix, reviewDateOf, SCORE_KEYS,
  type CategoryNumber, type Currency, type IsoDate, type JoinedPlan, type MapPlan, type MapRecord, type MapReview, type ScoreKey,
} from '@partner-desk/core';
import { type PartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { ReconnectRequired, StoreFailure, type MapFileChange, type MapStore } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, type Actor } from './actor';
import type { ShareDeps } from './cases';
import { type Deps, wordsOf } from './deps';
import type { MapEntry } from './directory';
import { caseOptionsOf, pickedCase } from './reviews';
import { horizonOf, mapActorOf, ownMap, recordFor, recordIn, startedOn } from './map-shared';
import { isStorageFailure, logQuietly, reasonOf, refused } from './shared';
import { FORBIDDEN, fromStore, invalid, ok, record, type CommandResult, type Failure } from './result';
import { hashToken, isToken, newToken } from './share-tokens';

const id = z.string().min(1).max(64);
/** At most this many people get one send: a MAP's partner side is a handful of people. */
const MAX_RECIPIENTS = 50;
const shareInput = z.object({
  mapId: id, reviewId: id, personIds: z.array(id).min(1).max(MAX_RECIPIENTS), includeScorecard: z.boolean(),
}).strict();
const reviewInput = z.object({ mapId: id, reviewId: id }).strict();

/** No longer in the directory, in the words of where the work lives. */
const notListed = (deps: Deps): Failure => ({ ok: false, error: 'file_not_found', message: wordsOf(deps).MAP_NOT_LISTED });
const REVIEW_GONE: Failure = { ok: false, error: 'not_found', message: COPY.GONE };
const NOT_HELD = refused('reviewId', COPY.REVIEW_SUMMARY_NOT_HELD);
const PICK_PEOPLE = refused('personIds', COPY.REVIEW_SUMMARY_PICK_PEOPLE);
const NOT_SENT: Failure = { ok: false, error: 'unavailable', message: COPY.REVIEW_SUMMARY_NOT_SENT };

/** A new summary link id. Ids appear in logs and events, so they are ids, not secrets: the secret is the token. */
const newReviewLinkId = (): string => `rl_${randomSuffix(16)}`;

/** One Send summary, for the mail: the held review, and each person it goes to with their address in People. */
export interface SummarySend {
  ownerUserId: string;
  mapId: string;
  reviewId: string;
  to: Array<{ personId: string; email: string }>;
}

/**
 * Emails each person of a send the summary link with `token`, on the owner's behalf (the web app's `mailReviewSummary`).
 * Answers the ids of the people it went out to.
 */
export type SummaryMail = (send: SummarySend, token: string) => Promise<string[]>;

/**
 * Sends a held review's summary (spec 5.6), a person's decision, to partner-side people of the MAP with an email, every
 * one checked. In this order, so what the review says is true (owner, 2026-11-01):
 * 1. The review's earlier link is turned off (sending again turns it off, as the dialog says), so an earlier recipient
 *    never sees the scorecard choice of this send.
 * 2. The scorecard choice is written to the review's row (with the row's conflict check), when it changed: the summary
 *    page reads it live, so it is in place before any email can arrive. Then a new link is made.
 * 3. `mail` sends the emails. A mail that throws counts as none sent.
 * 4. Only once at least one went out is the review stamped "Summary sent", with the names of the people it reached in
 *    the MAP sheet ("Sent to"), never in our database. When none went out, the new link is turned off at once (nobody
 *    has it), the review keeps what it said before, and the person is told it couldn't be sent.
 * The token goes only to `mail`. Refused before the review is held. The event holds the MAP, review and link ids only.
 */
export async function shareSummary(
  deps: Deps, actor: Actor, input: unknown, mail: SummaryMail,
): Promise<CommandResult<{ sent: number; total: number }>> {
  const parsed = shareInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, reviewId, includeScorecard } = parsed.data;
  const personIds = [...new Set(parsed.data.personIds)];
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'reviews.share', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const facts = await recordFor(deps, entry);
  if (!facts.ok) return facts;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const plan = read.snapshot.value;
  const review = plan.reviews.find((r) => r.id === reviewId);
  if (!review) return REVIEW_GONE;
  if (review.state !== 'held') return NOT_HELD;
  const to: Array<{ personId: string; email: string; name: string }> = [];
  for (const personId of personIds) {
    const person = plan.people.find((p) => p.id === personId);
    if (!person || person.side !== 'partner' || !person.email) return PICK_PEOPLE;
    to.push({ personId, email: person.email, name: person.name });
  }

  const ref = { fileId: entry.fileId };
  const validate = mapValidationFor(mapActorOf(actor));
  const label = () => ({ now: deps.clock(), actor: actorLabel(actor) });
  // The earlier link goes off first, so an earlier recipient never sees a scorecard choice meant for this send.
  await deps.reviewLinks.revokeReview(entry.ownerUserId, mapId, reviewId, deps.clock());
  if (review.includeScorecard !== includeScorecard) {
    const change = {
      kind: 'update', entity: 'review', id: reviewId, patch: { includeScorecard }, expectedUpdatedAt: review.updatedAt, record: facts.record, validate,
    } as MapFileChange;
    const written = await deps.maps.apply(ref, change, label());
    if (!written.ok) return fromStore(written);
  }

  const now = deps.clock();
  const token = newToken();
  const linkId = newReviewLinkId();
  await deps.reviewLinks.create({ id: linkId, ownerUserId: entry.ownerUserId, mapId, reviewId, tokenHash: hashToken(token), createdAt: now });
  let reached = new Set<string>();
  try {
    reached = new Set(await mail({ ownerUserId: entry.ownerUserId, mapId, reviewId, to: to.map(({ personId, email }) => ({ personId, email })) }, token));
  } catch {
    // Its message may hold an address: ids only. Nothing counts as sent.
    logQuietly(deps, 'review_summary_mail_failed', { mapId, reviewId });
  }
  const got = to.filter((t) => reached.has(t.personId));
  if (got.length === 0) {
    await deps.reviewLinks.revokeReview(entry.ownerUserId, mapId, reviewId, deps.clock());
    return NOT_SENT;
  }

  // Only the stamp's own fields: a change of the review made meanwhile (a note) is no conflict for them.
  const stamp = {
    kind: 'update', entity: 'review', id: reviewId, patch: { summarySentAt: deps.clock(), summarySentTo: got.map((t) => t.name).join(', ') },
    record: facts.record, validate,
  } as MapFileChange;
  const stamped = await deps.maps.apply(ref, stamp, label());
  // The emails went out: the person is told so. The review then reads as not sent, and they can send it again.
  if (!stamped.ok) logQuietly(deps, 'review_summary_stamp_failed', { mapId, reviewId, error: stamped.error });
  await record(deps, actor, 'reviews.share', entry.fileId, [mapId, reviewId, linkId]);
  return ok({ sent: got.length, total: to.length });
}

/** Turns a review's summary link off at once (Turn off the link). The review keeps its "sent" stamp. */
export async function revokeSummary(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ mapId: string }>> {
  const parsed = reviewInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, reviewId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'reviews.revoke', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  await deps.reviewLinks.revokeReview(entry.ownerUserId, mapId, reviewId, deps.clock());
  await record(deps, actor, 'reviews.revoke', entry.fileId, [mapId, reviewId]);
  return ok({ mapId });
}

// ---------------------------------------------------------------------------------------------------------------------
// The partner's page

type Side = 'us' | 'partner' | 'joint';

/**
 * What a summary link shows (spec 5.6), and nothing else: the review's date, both companies, the horizon's work done
 * and not done with the reasons, the commitments closing moved to the MAP with their owner's name, side and date, the
 * named blockers and the next review. The scorecard's numbers (the recommend score among them) only when the owner
 * ticked "Include the scorecard". Never the partner hypothesis or its answer, the Decisions note, the relationship
 * note, or a number's source or note; no ids either.
 */
export interface SummaryView {
  heldOn: IsoDate;
  horizon: number;
  partnerName: string;
  partnerType: PartnerType;
  /** Our side: the owner's company name, else the owner's name. */
  ourName: string;
  done: Array<{ title: string; side: Side }>;
  notDone: Array<{ title: string; side: Side; reason: string }>;
  commitments: Array<{ title: string; side: Side | null; owner: string | null; dueDate: IsoDate | null }>;
  blockers: Array<{ title: string; side: Side | null; note: string }>;
  nextReview: IsoDate | null;
  /** Null unless the scorecard is on the summary. */
  scorecard: Array<{ key: ScoreKey; actual: number | null; target: number | null }> | null;
  /** The number by partner category's name, for its label; null for a category without one. */
  categoryNumber: CategoryNumber | null;
  /**
   * The currency of the business case the review checks against, for its money: only with the scorecard, and null
   * when there is no case or it can't be read now.
   */
  currency: Currency | null;
}

export type SharedSummary = { kind: 'ok'; view: SummaryView } | { kind: 'gone' } | { kind: 'unavailable' };

/**
 * What the summary link with `token` shows, as `openSharedCase` does for a case. Anything not shaped like a token is
 * refused before the database is asked. An unknown or turned-off link, a MAP no longer listed or in the trash, a review
 * gone or not held, a partner type gone, or an owner who is gone: the link doesn't work, with one answer for each. The
 * owner's storage failing: it can't be shown now. It only reads: nothing is written, marked or sent, and no event is
 * recorded. Logs carry event names and ids only, never the token or its hash.
 */
export async function openSharedSummary(deps: ShareDeps, token: unknown): Promise<SharedSummary> {
  if (!isToken(token)) return { kind: 'gone' };
  const unavailable = (reason: string, ids: Record<string, string> = {}): SharedSummary => {
    logQuietly(deps, 'shared_summary_unavailable', { reason, ...ids });
    return { kind: 'unavailable' };
  };
  let link: { ownerUserId: string; mapId: string; reviewId: string } | null;
  let entry: MapEntry | null;
  try {
    link = await deps.reviewLinks.findActive(hashToken(token));
    entry = link ? await deps.directory.map(link.mapId) : null;
  } catch (error) {
    return unavailable(reasonOf(error));
  }
  if (!link || !entry || entry.ownerUserId !== link.ownerUserId) return { kind: 'gone' };
  const ids = { ownerUserId: link.ownerUserId, mapId: link.mapId, reviewId: link.reviewId };

  let store: Pick<MapStore, 'read'> | null;
  try {
    store = await deps.mapsFor(link.ownerUserId);
  } catch (error) {
    return unavailable(reasonOf(error), ids);
  }
  if (!store) return { kind: 'gone' };
  let read: Awaited<ReturnType<MapStore['read']>>;
  try {
    read = await store.read({ fileId: entry.fileId });
  } catch (error) {
    if (!isStorageFailure(error)) throw error;
    return unavailable(error instanceof StoreFailure ? error.code : error instanceof ReconnectRequired ? 'auth' : 'unavailable', ids);
  }
  if (!read.ok) {
    // A MAP file in the trash (or deleted) is a summary that is gone [builder's call]; anything else may pass.
    if (read.error === 'file_not_found') return { kind: 'gone' };
    return unavailable(read.error, ids);
  }
  const plan = read.snapshot.value;
  const review = plan.reviews.find((r) => r.id === link.reviewId);
  // A review row that can't be read is one that can't be shown now; one that is gone, or not held, is a link that is gone.
  if (!review) return read.snapshot.issues.length > 0 ? unavailable('rows_unreadable', ids) : { kind: 'gone' };
  if (review.state !== 'held' || review.heldOn === null) return { kind: 'gone' };

  const facts = await partnerFacts(deps, link.ownerUserId, entry);
  if (facts === 'unavailable') return unavailable('partners_unreadable', ids);
  if (facts === null) return { kind: 'gone' };
  let ourName = '';
  try {
    ourName = (await deps.companies.nameOf(link.ownerUserId))?.trim() || (await deps.ownerName(link.ownerUserId))?.trim() || '';
  } catch {
    // The page still shows; our side is named by its side only.
  }
  const currency = review.includeScorecard ? await summaryCurrency(deps, { ownerUserId: link.ownerUserId, mapId: link.mapId, entry }, review) : null;
  return { kind: 'ok', view: summaryOf(plan, review, { record: facts, entry, ourName, currency }) };
}

/**
 * The currency of the case the review page checks the review against (`pickedCase`), read only. Null with no case, or
 * when it can't be read now: the summary then shows its money without a sign [builder's call].
 */
async function summaryCurrency(
  deps: ShareDeps, at: { ownerUserId: string; mapId: string; entry: MapEntry }, review: MapReview,
): Promise<Currency | null> {
  const { ownerUserId, entry } = at;
  try {
    const options = await caseOptionsOf(deps, entry);
    const picked = pickedCase(options, review);
    const listed = picked ? await deps.directory.businessCase(picked.caseId) : null;
    const store = listed && listed.ownerUserId === ownerUserId ? await deps.casesFor(ownerUserId) : null;
    if (!listed || !store) return null;
    const read = await store.read({ fileId: listed.fileId });
    return read.ok ? read.snapshot.value.offer.currency : null;
  } catch {
    logQuietly(deps, 'shared_summary_case_unread', { mapId: at.mapId, reviewId: review.id });
    return null;
  }
}

/** The partner record's facts from the owner's Partners, read only: null when the partner type is gone from it. */
async function partnerFacts(deps: ShareDeps, ownerUserId: string, entry: MapEntry): Promise<MapRecord | null | 'unavailable'> {
  try {
    const book = await deps.directory.partnerBook(entry.companyId);
    if (!book || book.ownerUserId !== ownerUserId) return null;
    const store = await deps.partnerBooksFor(ownerUserId);
    if (!store) return null;
    const read = await store.read({ fileId: book.fileId });
    if (!read.ok) return read.error === 'file_not_found' ? null : 'unavailable';
    return recordIn(read.snapshot.value, entry)?.record ?? null;
  } catch {
    return 'unavailable';
  }
}

/** The summary of a held review, from the MAP as read now (spec 5.6): only what the partner may see. */
function summaryOf(
  plan: MapPlan, review: MapReview, at: { record: MapRecord; entry: MapEntry; ourName: string; currency: Currency | null },
): SummaryView {
  const joined = joinPlan(plan, at.record, startedOn(at.entry));
  const items = (kind: string) => joined.reviewItems.filter((i) => i.reviewId === review.id && i.kind === kind);
  const horizon = horizonOf(joined, review);
  const work = horizonWork(horizon.plan, horizon.until);
  const reasons = items('notDone');
  const personName = (personId: string | null) => (personId ? joined.people.find((p) => p.id === personId)?.name ?? null : null);
  const category = categoryNumberOf(at.entry.partnerType);
  const numbers = joined.reviewNumbers.filter((n) => n.reviewId === review.id);
  return {
    heldOn: review.heldOn!,
    horizon: review.horizon,
    partnerName: at.record.partnerName,
    partnerType: at.entry.partnerType,
    ourName: at.ourName,
    done: work.filter((a) => a.status === 'done').map((a) => ({ title: a.title, side: a.side })),
    notDone: work.filter((a) => a.status !== 'done').map((a) => ({
      title: a.title, side: a.side, reason: reasons.find((r) => r.refId === a.id)?.note ?? '',
    })),
    // Only what closing turned into MAP activities: a commitment row that never moved isn't agreed work.
    commitments: items('commitment').filter((c) => c.moved)
      .map((c) => ({ title: c.title, side: c.side, owner: personName(c.ownerId), dueDate: c.dueDate })),
    blockers: items('blocker').map((b) => ({ title: b.title, side: b.side, note: b.note })),
    nextReview: nextReviewOf(joined, review),
    scorecard: review.includeScorecard
      ? SCORE_KEYS.filter((key) => key !== 'categoryNumber' || category !== null).map((key) => {
        const row = numbers.find((n) => n.key === key);
        return { key, actual: row?.actual ?? null, target: row?.target ?? null };
      })
      : null,
    categoryNumber: category,
    currency: at.currency,
  };
}

/**
 * The review after this one: the day the next horizon's review is (its "Next review", else its last day) while that
 * horizon runs, the day it was held once held, and none after the exit or when there is no next horizon.
 */
function nextReviewOf(joined: JoinedPlan, review: MapReview): IsoDate | null {
  const next = joined.reviews.find((r) => r.horizon === review.horizon + 1 && r.state === 'held');
  if (next?.heldOn) return next.heldOn;
  return currentHorizon(joined.info) === review.horizon + 1 ? reviewDateOf(joined.info) : null;
}

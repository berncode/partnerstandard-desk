// The review commands (reviews spec 5 and 8): read, open (the prep, written on first open) and close a partner review,
// and list a company's reviews. A review lives in its partnership's MAP file, so these read and write the MAP through
// its store, with the MAP's own checks. A person with a link reaches none of them (Review Focus 1).
import {
  caseAgainstActual, categoryNumberOf, closeReviewChanges, currentHorizon, daysBetween, horizonWork, isOpen, isoDateSchema,
  joinPlan, mapValidationFor, nearestHorizonLength, newMapEntityId, prefill, prepOf, reviewDateOf, reviewStatus, stageSuggestion, summarizeMap, targetsFor,
  type Activity, type BusinessCase, type CaseAgainstActual, type CategoryNumber, type Currency, type HypothesisAnswer, type ExitTrigger, type IsoDate, type JoinedPlan,
  type MapChange, type MapPerson, type MapPlan, type MapRecord, type MapReview, type MapView, type Milestone, type Objective,
  type PartnerBook, type PlanInfo, type ReviewItem, type ReviewNumber, type ReviewStatus, type ScoreTargets,
} from '@partner-desk/core';
import { type PartnerType, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { MapFileChange, StoreError } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, type Actor } from './actor';
import { type Deps, wordsOf } from './deps';
import type { MapEntry } from './directory';
import {
  horizonOf, lastProgress, mapActorOf, noteChange, ownerToday, ownMap, recordFor, recordIn, startedOn, writeSummary, type RecordRead,
} from './map-shared';
import { logQuietly, refused } from './shared';
import { FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, record, type CommandResult, type Failure } from './result';
import { ownCompanyOnly } from './own-company';

const id = z.string().min(1).max(64);
const companyId = z.string().regex(/^co_[0-9a-z]{10}$/);
const readInput = z.object({ mapId: id, reviewId: id.optional() }).strict();
const openInput = z.object({ mapId: id }).strict();
const closeInput = z.object({ mapId: id, reviewId: id, heldOn: isoDateSchema }).strict();
/** With a partnerId, only that partner type's MAP is read (`get_partner` with include). */
const listInput = z.object({ companyId, partnerId: id.optional() }).strict();

/** The MAP isn't in the directory, or isn't this person's (as `readMap` answers). */
/** No longer in the directory, in the words of where the work lives. */
const notListed = (deps: Deps): Failure => ({ ok: false, error: 'file_not_found', message: wordsOf(deps).MAP_NOT_LISTED });
const REVIEW_GONE: Failure = { ok: false, error: 'not_found', message: COPY.GONE };
/** Before signing, after the exit, or once the recruitment ended: no review can be held (Review Focus 3). */
const NOT_NOW = refused('mapId', COPY.REVIEW_NOT_NOW);

const YEAR_DAYS = 365;

// ---------------------------------------------------------------------------------------------------------------------
// The read

export interface ReviewRead {
  mapId: string;
  partnerName: string;
  partnerType: PartnerType;
  record: MapRecord;
  info: PlanInfo;
  /** The partnership's next review, as This week shows it: none before signing and after the exit. */
  status: ReviewStatus;
  /** The review asked for, or the current horizon's prep; null before prep (and whenever no review can be held). */
  review: MapReview | null;
  numbers: ReviewNumber[];
  items: ReviewItem[];
  /** The review's horizon's activities (`horizonWork`): due in it, or still open from before. */
  work: Activity[];
  objectives: Objective[];
  milestones: Milestone[];
  exitTriggers: ExitTrigger[];
  health: MapView;
  people: MapPerson[];
  /** What the scorecard checks: the last review's next targets, else the business case's (spec 5.4). */
  targets: ScoreTargets;
  prefill: ScoreTargets;
  /**
   * What one new deal is worth in the case year of the review, by the case: what we bill and what the partner earns.
   * The page prefills those two numbers from the deals won as they are typed. Null with no usable case.
   */
  perDeal: { weBill: number; partnerEarns: number } | null;
  categoryNumber: CategoryNumber | null;
  /** The business case the targets come from: the review's pick, else the newest shared case, else the newest case. */
  case: { caseId: string; title: string } | null;
  caseOptions: Array<{ caseId: string; title: string; shared: boolean }>;
  /** The partner hypotheses the partnership is linked to, one per linked market (spec 5.2). */
  hypotheses: Array<{ id: string; marketId: string; marketName: string; text: string }>;
  /** A linked market couldn't be read now, so `hypotheses` leaves its hypothesis out (a prep keeps its questions as items). */
  hypothesesIncomplete: boolean;
  whyItFits: string;
  caseAgainstActual: CaseAgainstActual | null;
  /** The currency of the business case the comparison uses; null with no usable case. */
  caseCurrency: Currency | null;
  /** Every held review of the MAP, by horizon. */
  held: MapReview[];
  /** Each held review's partner hypothesis answers (the `hypothesis` items with an answer), by the review's id. */
  heldAnswers: Record<string, HypothesisAnswer[]>;
  /** The review row's `updatedAt`, for a change's conflict check; empty before prep. */
  expectedUpdatedAt: string;
}

/** The partnership's cases, newest first, with whether each is shared now. */
export async function caseOptionsOf(
  deps: { directory: Pick<Deps['directory'], 'businessCases'>; shareLinks: Pick<Deps['shareLinks'], 'activeFor'> }, entry: MapEntry,
): Promise<ReviewRead['caseOptions']> {
  const listed = (await deps.directory.businessCases(entry.companyId))
    .filter((c) => c.ownerUserId === entry.ownerUserId && c.partnerId === entry.partnerId);
  const options: ReviewRead['caseOptions'] = [];
  for (const c of listed) {
    options.push({ caseId: c.caseId, title: c.displayName, shared: (await deps.shareLinks.activeFor(entry.ownerUserId, c.caseId)) !== null });
  }
  return options;
}

/** The case a review checks against: the review's pick, else the newest shared case, else the newest case. */
export const pickedCase = (options: ReviewRead['caseOptions'], review: MapReview | null): ReviewRead['caseOptions'][number] | null =>
  options.find((c) => c.caseId === review?.caseId) ?? options.find((c) => c.shared) ?? options[0] ?? null;

/** The case's contents, or null when its file can't be read (gone, or Google not answering): targets then stay empty. */
async function caseValue(deps: Deps, caseId: string): Promise<BusinessCase | null> {
  const entry = await deps.directory.businessCase(caseId);
  if (!entry) return null;
  const read = await deps.cases.read({ fileId: entry.fileId });
  if (read.ok) return read.snapshot.value;
  logQuietly(deps, 'review_case_read_failed', { caseId, error: read.error });
  return null;
}

type Hypotheses = { ok: true; list: ReviewRead['hypotheses']; incomplete: boolean };

/**
 * The partner hypotheses the partnership's market links name, read from their markets. A market or hypothesis that is
 * gone is left out. A market that can't be read now (Google not answering, a tab renamed by hand): `strict` fails, so a
 * new prep never misses one of its questions; else it is left out with a log line of ids, and the list is incomplete.
 */
async function hypothesesOf(
  deps: Deps, at: { mapId: string; entry: MapEntry; book: PartnerBook }, strict: boolean,
): Promise<Hypotheses | Failure> {
  const { mapId, entry, book } = at;
  const links = book.marketLinks.filter((l) => l.partnerId === entry.partnerId && l.hypothesisId !== null);
  const list: ReviewRead['hypotheses'] = [];
  let incomplete = false;
  for (const link of links) {
    const market = await deps.directory.market(link.marketId);
    if (!market || market.ownerUserId !== entry.ownerUserId) continue;
    const read = await deps.markets.read({ fileId: market.fileId });
    if (!read.ok) {
      if (read.error === 'file_not_found') continue;
      if (strict) return fromStore(read);
      logQuietly(deps, 'review_market_read_failed', { mapId, marketId: link.marketId, error: read.error });
      incomplete = true;
      continue;
    }
    const hypothesis = read.snapshot.value.hypotheses.find((h) => h.id === link.hypothesisId);
    if (hypothesis && !list.some((h) => h.id === hypothesis.id)) {
      list.push({ id: hypothesis.id, marketId: link.marketId, marketName: read.snapshot.value.info.marketName, text: hypothesis.name });
    }
  }
  return { ok: true, list, incomplete };
}

/**
 * What a review's scorecard checks (spec 5.4): the last review's next targets, else the business case's (the review's
 * pick, else the newest shared case, else the newest), for the review's horizon. The page shows them and closing keeps
 * them, so both read them here. The number by partner category only for a category that has one.
 */
async function scoreTargetsOf(
  deps: Deps, entry: MapEntry, joined: JoinedPlan, signedDate: IsoDate | null, review: MapReview | null, cases = true,
) {
  const caseOptions = cases ? await caseOptionsOf(deps, entry) : [];
  const picked = pickedCase(caseOptions, review);
  const c = picked ? await caseValue(deps, picked.caseId) : null;
  const held = joined.reviews.filter((r) => r.state === 'held').sort((a, b) => a.horizon - b.horizon);
  const horizon = horizonOf(joined, review);
  const reviewHorizon = review?.horizon ?? currentHorizon(joined.info);
  const previous = held.filter((r) => r.horizon === reviewHorizon - 1 && r.id !== review?.id).at(-1) ?? null;
  const from = signedDate ?? horizon.plan.info.startDate;
  const targets = targetsFor({
    previous: previous ? joined.reviewNumbers.filter((n) => n.reviewId === previous.id) : null,
    c, signedDate: from, horizonStart: horizon.plan.info.startDate, reviewDate: horizon.until,
  });
  if (categoryNumberOf(entry.partnerType) === null) delete targets.categoryNumber;
  return { caseOptions, picked, c, horizon, from, targets };
}

/** Everything the review page shows of a review (or of none yet), from a MAP and its partner record as read. */
async function reviewRead(
  deps: Deps, at: { mapId: string; entry: MapEntry; facts: RecordRead; plan: MapPlan; today: IsoDate },
  review: MapReview | null, hypotheses: Hypotheses, cases = true,
): Promise<ReviewRead> {
  const { mapId, entry, facts, today } = at;
  const joined = joinPlan(at.plan, facts.record, startedOn(entry));
  const { info } = joined;
  const signedDate = facts.record.signedDate;
  const numbersOf = (reviewId: string) => joined.reviewNumbers.filter((n) => n.reviewId === reviewId);
  const numbers = review ? numbersOf(review.id) : [];
  const held = joined.reviews.filter((r) => r.state === 'held').sort((a, b) => a.horizon - b.horizon);
  const { caseOptions, picked, c, horizon, from, targets } = await scoreTargetsOf(deps, entry, joined, signedDate, review, cases);
  const year = Math.max(1, Math.floor(daysBetween(from, horizon.until) / YEAR_DAYS) + 1);
  const activeSellers = facts.book.people.filter((p) => p.accountId === facts.partner.accountId && p.activeSeller).length;
  // One deal's worth, as `prefill` counts it: null when there is no usable case.
  const one = prefill({ activeSellers, type: entry.partnerType, dealsWon: 1, c, year });

  return {
    mapId, partnerName: facts.record.partnerName, partnerType: entry.partnerType, record: facts.record, info,
    status: reviewStatus(joined, today),
    review, numbers, items: review ? joined.reviewItems.filter((i) => i.reviewId === review.id) : [],
    work: horizonWork(horizon.plan, horizon.until),
    objectives: joined.objectives, milestones: joined.milestones, exitTriggers: joined.exitTriggers, people: joined.people,
    health: summarizeMap(joined, today, lastProgress(entry)),
    targets,
    prefill: prefill({
      activeSellers, type: entry.partnerType, dealsWon: numbers.find((n) => n.key === 'dealsWon')?.actual ?? null, c, year,
    }),
    perDeal: one.weBill === null || one.weBill === undefined ? null : { weBill: one.weBill, partnerEarns: one.partnerEarns ?? 0 },
    categoryNumber: categoryNumberOf(entry.partnerType),
    case: picked ? { caseId: picked.caseId, title: picked.title } : null,
    caseOptions, hypotheses: hypotheses.list, hypothesesIncomplete: hypotheses.incomplete, whyItFits: facts.partner.whyItFits,
    caseAgainstActual: signedDate === null ? null : caseAgainstActual({
      held: held.map((r) => ({ review: r, numbers: numbersOf(r.id) })), c, signedDate, asOf: today,
    }),
    caseCurrency: c?.offer.currency ?? null,
    held,
    heldAnswers: Object.fromEntries(held.map((r) => [r.id, joined.reviewItems
      .filter((i) => i.reviewId === r.id && i.kind === 'hypothesis' && i.answer !== null).map((i) => i.answer!)])),
    expectedUpdatedAt: review?.updatedAt ?? '',
  };
}

/** The MAP, its partner record and the owner's today, for a review command that has checked access. */
async function loaded(deps: Deps, mapId: string, entry: MapEntry) {
  const facts = await recordFor(deps, entry);
  if (!facts.ok) return facts;
  const read = await deps.maps.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const today = await ownerToday(deps, entry.ownerUserId);
  return { ok: true as const, at: { mapId, entry, facts, plan: read.snapshot.value, today } };
}

/**
 * A review as the review page shows it (spec 5.2). Without `reviewId`, the current horizon's prep, or `review: null`
 * before prep and whenever no review can be held (`status` none). With it, that review, held ones too, after the exit
 * as well. The owner and their agent, at any level.
 */
export async function readReview(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<ReviewRead>> {
  const parsed = readInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, reviewId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'reviews.read', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const load = await loaded(deps, mapId, entry);
  if (!load.ok) return load;
  const joined = joinPlan(load.at.plan, load.at.facts.record, startedOn(entry));
  let review: MapReview | null;
  if (reviewId !== undefined) {
    review = joined.reviews.find((r) => r.id === reviewId) ?? null;
    if (!review) return REVIEW_GONE;
  } else {
    review = reviewStatus(joined, load.at.today).kind === 'none' ? null : prepOf(joined);
  }
  // No review can be held now and none was (before signing, mostly: every partner page's Reviews area asks): nothing
  // the page shows needs a business case or a market, so neither is read (about 60 Google reads a minute).
  const quiet = review === null && reviewStatus(joined, load.at.today).kind === 'none' && !joined.reviews.some((r) => r.state === 'held');
  const hypotheses: Hypotheses | Failure = quiet
    ? { ok: true, list: [], incomplete: false }
    : await hypothesesOf(deps, { mapId, entry, book: load.at.facts.book }, false);
  if (!hypotheses.ok) return hypotheses;
  await record(deps, actor, 'reviews.read', entry.fileId, review ? [mapId, review.id] : [mapId]);
  return ok(await reviewRead(deps, load.at, review, hypotheses, !quiet));
}

// ---------------------------------------------------------------------------------------------------------------------
// Writes

/** A change as the MAP file takes it: with the partner record, checked as the owner's (whole rows). */
const asFile = (actor: Actor, recordOf: MapRecord) => (c: MapChange, newId?: string): MapFileChange =>
  ({ ...c, record: recordOf, validate: mapValidationFor(mapActorOf(actor)), ...(newId === undefined ? {} : { newId }) }) as MapFileChange;

/**
 * Starts the current horizon's review: its prep row, written to the MAP the first time it is opened (spec 5.1), in one
 * write with a "not done" line per open activity of the horizon and a question per linked partner hypothesis (one about
 * "Why it fits" when none is linked). An existing prep is given back as it is. Refused when no review can be held
 * (before signing, after the exit). The owner, and their agent at level change.
 */
export async function openReview(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<ReviewRead>> {
  const parsed = openInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'reviews.open', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const load = await loaded(deps, mapId, entry);
  if (!load.ok) return load;
  const { facts, plan, today } = load.at;
  const joined = joinPlan(plan, facts.record, startedOn(entry));
  const until = reviewDateOf(joined.info);
  if (reviewStatus(joined, today).kind === 'none' || until === null) return NOT_NOW;
  const existing = prepOf(joined);
  if (existing) {
    // A prep made already is read as `readReview` reads it: its questions are its items.
    const known = await hypothesesOf(deps, { mapId, entry, book: facts.book }, false);
    if (!known.ok) return known;
    await record(deps, actor, 'reviews.read', entry.fileId, [mapId, existing.id]);
    return ok(await reviewRead(deps, load.at, existing, known));
  }
  const hypotheses = await hypothesesOf(deps, { mapId, entry, book: facts.book }, true);
  if (!hypotheses.ok) return hypotheses;

  // The review's id is chosen here, so its lines can name it in the same write.
  const reviewId = newMapEntityId('review');
  const item = (values: Partial<ReviewItem>): MapChange => ({ kind: 'add', entity: 'reviewItem', values: { reviewId, ...values } });
  const questions = hypotheses.list.length > 0
    ? hypotheses.list.map((h) => item({ kind: 'hypothesis', refId: h.id, title: h.text }))
    : [item({ kind: 'hypothesis', refId: null, title: facts.partner.whyItFits })];
  const file = asFile(actor, facts.record);
  const changes: MapFileChange[] = [
    // The next horizon's length: the current one's, or the nearest the MAP offers (a 45-day horizon gives 60).
    file({
      kind: 'add', entity: 'review',
      values: { horizon: currentHorizon(joined.info), nextHorizonDays: nearestHorizonLength(joined.info.horizonDays) },
    }, reviewId),
    ...horizonWork(joined, until).filter(isOpen).map((a) => file(item({ kind: 'notDone', refId: a.id, title: a.title }))),
    ...questions.map((c) => file(c)),
  ];
  const now = deps.clock();
  const out = await deps.maps.applyMany({ fileId: entry.fileId }, changes, { now, actor: actorLabel(actor) });
  if (!out.ok) return fromStore(out);
  let written = out.snapshot.value;
  // Two opens at once (a double click) each wrote a prep: the first one stays, and this one's rows go again.
  const first = prepOf(joinPlan(written, facts.record, startedOn(entry)));
  if (first && first.id !== reviewId) {
    const undone = await deps.maps.apply({ fileId: entry.fileId }, file({ kind: 'delete', entity: 'review', id: reviewId }), { now, actor: actorLabel(actor) });
    if (undone.ok) written = undone.snapshot.value;
    else logQuietly(deps, 'review_open_twice', { mapId, reviewId, error: undone.error });
    return ok(await reviewRead(deps, { ...load.at, plan: written }, first, hypotheses));
  }
  await record(deps, actor, 'reviews.open', entry.fileId, [mapId, reviewId]);
  // The prep writes only review rows: not MAP progress (owner, 2026-11-01), so the MAP's last change stays.
  await writeSummary(deps, actor, { mapId, entry, read: facts }, written, lastProgress(entry));
  const opened = written.reviews.find((r) => r.id === reviewId)!;
  return ok(await reviewRead(deps, { ...load.at, plan: written }, opened, hypotheses));
}

/**
 * Closes a review (spec 5.3), a person's decision: the next horizon starts on the day it was held, each commitment
 * becomes a MAP activity, and the review is marked held, all in one write to the MAP, made against the MAP as read now.
 * When the write fails nothing is held and the person gets the store's answer. A review held already, or a horizon
 * moved on since, is refused, so a second close (a double click, a retry) changes nothing (Review Focus 2). Never moves
 * the stage: the answer suggests one when it fits.
 */
export async function closeReview(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ suggestion: Stage | null }>> {
  const parsed = closeInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { mapId, reviewId, heldOn } = parsed.data;
  const entry = await ownMap(deps, actor, mapId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'reviews.close', { ownerUserId: entry.ownerUserId, mapId })) return FORBIDDEN;
  const load = await loaded(deps, mapId, entry);
  if (!load.ok) return load;
  const { facts, plan, today } = load.at;
  const joined = joinPlan(plan, facts.record, startedOn(entry));
  // The targets the page shows, kept on the number rows in the same write (spec 5.3 point 5).
  const asked = joined.reviews.find((r) => r.id === reviewId) ?? null;
  const targets = asked ? (await scoreTargetsOf(deps, entry, joined, facts.record.signedDate, asked)).targets : {};
  // Not `changeMap`: it would start the horizon on the owner's today, and a review held late starts it on its day.
  const closing = closeReviewChanges(joined, { reviewId, heldOn, today, targets });
  if (!closing.ok) {
    return { ok: false, error: 'invalid', message: closing.fieldErrors.reviewId ?? COPY.FIX_FIELDS, fieldErrors: closing.fieldErrors };
  }
  const review = joined.reviews.find((r) => r.id === reviewId)!;
  const file = asFile(actor, facts.record);
  const now = deps.clock();
  const out = await deps.maps.applyMany({ fileId: entry.fileId }, closing.changes.map((c) => file(c)), { now, actor: actorLabel(actor) });
  if (!out.ok) return closeRefused(out, closing.itemOf);
  await record(deps, actor, 'reviews.close', entry.fileId, [mapId, reviewId]);
  // Closing starts a horizon and adds the commitments as activities: MAP progress.
  await noteChange(deps, mapId, now);
  await writeSummary(deps, actor, { mapId, entry, read: facts }, out.snapshot.value, now);
  return ok({ suggestion: stageSuggestion(facts.record.stage, review.horizon) });
}

/**
 * The store refused the close's write (the MAP's own checks, which `closeReviewChanges` can't all foresee). A refused
 * change of a commitment comes back on that commitment, where the review page shows it. Any other comes back as one
 * message and no field errors, so the close dialog shows it: the store's field names (a milestone's name, an
 * activity's title) match nothing on the review page.
 */
function closeRefused(out: StoreError & { valid?: number }, itemOf: Array<string | null>): Failure {
  const item = out.valid === undefined ? null : itemOf[out.valid] ?? null;
  const detail = Object.values(out.fieldErrors ?? {})[0];
  if (item !== null && out.error === 'invalid') {
    return { ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { [item]: detail ?? out.message } };
  }
  return { ok: false, error: out.error, message: detail ?? out.message };
}

// ---------------------------------------------------------------------------------------------------------------------
// The list

export interface ReviewLine {
  mapId: string;
  partnerId: string;
  displayName: string;
  /** The horizon the review closes; 0 for a MAP that couldn't be read. */
  horizon: number;
  /** The review date, or the day a held one was held; null for a MAP that couldn't be read. */
  date: IsoDate | null;
  /** `prep`: prep started for a review not coming up yet. A coming or overdue one with prep started has its `reviewId`. */
  state: 'coming' | 'overdue' | 'later' | 'prep' | 'held';
  reviewId: string | null;
  heldOn: IsoDate | null;
  /** The MAP's file couldn't be read now: listed as later, with no date. */
  unreadable?: boolean;
}

/**
 * The company's reviews (the Reviews page): each MAP's next review and its held ones, by date. One Partners read and
 * each MAP's read, through the read cache; with a partnerId, only that partner type's MAP. A MAP whose partner type
 * is gone from Partners is left out; one that can't be read is listed as later with no date and `unreadable`. The
 * owner and their agent, at any level.
 */
export const listReviews = ownCompanyOnly(async function listReviews(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<ReviewLine[]>> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'reviews.list', { ownerUserId: actor.userId })) return FORBIDDEN;
  const { companyId: company, partnerId } = parsed.data;
  const mine = (await deps.directory.maps(company)).filter((m) => isOwner(actor, m) && (partnerId === undefined || m.partnerId === partnerId));
  if (mine.length === 0) return ok([]);
  const bookEntry = await deps.directory.partnerBook(company);
  if (!bookEntry || !isOwner(actor, bookEntry)) return NOT_FOUND_FILE;
  const bookRead = await deps.partnerBooks.read({ fileId: bookEntry.fileId });
  if (!bookRead.ok) return fromStore(bookRead);
  const book = bookRead.snapshot.value;
  const today = await ownerToday(deps, actor.userId);

  const lines: ReviewLine[] = [];
  for (const listed of mine) {
    const found = recordIn(book, listed);
    const entry = found ? await deps.directory.map(listed.mapId) : null;
    if (!found || !entry) continue;
    const base = { mapId: listed.mapId, partnerId: listed.partnerId, displayName: listed.displayName };
    const read = await deps.maps.read({ fileId: entry.fileId });
    if (!read.ok) {
      logQuietly(deps, 'review_list_read_failed', { mapId: listed.mapId, error: read.error });
      lines.push({ ...base, horizon: 0, date: null, state: 'later', reviewId: null, heldOn: null, unreadable: true });
      continue;
    }
    const joined = joinPlan(read.snapshot.value, found.record, startedOn(entry));
    for (const r of joined.reviews.filter((x) => x.state === 'held').sort((a, b) => a.horizon - b.horizon)) {
      lines.push({ ...base, horizon: r.horizon, date: r.heldOn, state: 'held', reviewId: r.id, heldOn: r.heldOn });
    }
    const status = reviewStatus(joined, today);
    if (status.kind === 'none') continue;
    const prep = prepOf(joined);
    const state = status.kind === 'later' ? (prep ? 'prep' : 'later') : status.kind;
    lines.push({ ...base, horizon: currentHorizon(joined.info), date: status.date, state, reviewId: prep?.id ?? null, heldOn: null });
  }
  await record(deps, actor, 'reviews.list', '', mine.map((m) => m.mapId));
  // By date, soonest first; a MAP that couldn't be read comes last.
  return ok(lines.sort((a, b) => (a.date === b.date ? 0 : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1)));
});

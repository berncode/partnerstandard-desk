// What the partner page does with an agent's proposals (agent proposals spec 10): where a card shows, its words, and
// what an answer changes on screen at once. The server works the same answer out again from the file as it is now.
import {
  acceptChange, daysBetween, proposedValue, statusRows, stepNudge,
  type AcceptPick, type ClosedAs, type IsoDate, type IsoDateTime, type MarketChange, type Partner, type PartnerBook, type PartnerChange,
  type ProposalHead, type ProposalItem, type ProposalView,
} from '@partner-desk/core';
import { FOUR_C, type FourC, type RecruitmentStep } from '@partner-desk/method';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { hypothesisHolds, partnerHref, type MarketState } from '@/partner/partner-model';
import type { AcceptBatch } from '@/editor/remotes';
import { dayIn } from '@/ui/dates';

/** What the person chose: the letters ("Accept some") and the note for the rest, the dialog's values, the MAP's dates. */
export type ProposalPick = AcceptPick & { note?: string; shiftMapDates?: boolean };

/**
 * The card's top line: who proposes, always "Desk Agent" (owner, 2026-11-14), and "(turned off)" for an agent the person
 * turned off since.
 */
export const cardTitle = (head: Pick<ProposalHead, 'makerOn'>): string =>
  (head.makerOn ? COPY.PROPOSAL_BY(COPY.DESK_AGENT) : COPY.PROPOSAL_BY_OFF(COPY.DESK_AGENT));

/** The day an instant falls on in the owner's timezone, as YYYY-MM-DD. */
const dateIn = (iso: IsoDateTime, timeZone: string): IsoDate =>
  new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone }).format(new Date(iso));

/** When it was made, in the owner's days: "today", "yesterday", "2 days ago". */
export function madeWhen(createdAt: IsoDateTime, now: IsoDateTime, timeZone: string): string {
  const days = daysBetween(dateIn(createdAt, timeZone), dateIn(now, timeZone));
  if (days <= 0) return COPY.PROPOSAL_MADE_TODAY;
  return days === 1 ? COPY.PROPOSAL_MADE_YESTERDAY : COPY.PROPOSAL_MADE_DAYS_AGO(days);
}

/** "Expires on 28 Nov 2026": the expiry, an instant, on the owner's calendar. */
export const expiresOn = (expiresAt: IsoDateTime, timeZone: string): string => COPY.PROPOSAL_EXPIRES_ON(dayIn(expiresAt, timeZone));

const PLACES = { desk: ['fourC'], stepper: ['stage', 'close', 'signed'] } as const satisfies Record<string, readonly ProposalHead['kind'][]>;

/**
 * The open partner type's cards, next to what they change (spec 10.2): a 4C proposal beside the desk check, a step,
 * stage, close or signed proposal under the stage stepper.
 */
export function cardsFor(views: readonly ProposalView[], partnerId: string, place: keyof typeof PLACES): ProposalView[] {
  const kinds: readonly string[] = PLACES[place];
  return views.filter((v) => v.target.partnerId === partnerId && kinds.includes(v.head.kind));
}

/**
 * The partner page's cards whose partner type is gone (removed since the agent proposed): no tab to sit in, so they show
 * at the top of the page, Reject only, with the rule's message. With the company's last type gone, the page shows the
 * company gone and This week's Reject is the way.
 */
export const cardsWithoutTab = (views: readonly ProposalView[], partnerIds: readonly string[]): ProposalView[] =>
  views.filter((v) => !isMarketKind(v) && (v.target.partnerId === null || !partnerIds.includes(v.target.partnerId)));

/** The market page's hypothesis status cards whose hypothesis is gone: at the top of the page, as above. */
export const cardsWithoutHypothesis = (views: readonly ProposalView[], hypothesisIds: readonly string[]): ProposalView[] =>
  views.filter((v) => v.head.kind === 'hypothesisStatus' && (v.target.hypothesisId === null || !hypothesisIds.includes(v.target.hypothesisId)));

const itemsOf = (view: ProposalView, book: PartnerBook): ProposalItem[] =>
  book.proposalItems.filter((i) => i.proposalId === view.head.id && i.status === 'waiting');

/** The 4C letter a card's row proposes, or null for a row of another kind. */
export function letterOf(book: PartnerBook, itemId: string): FourC | null {
  const what = book.proposalItems.find((i) => i.id === itemId)?.what ?? '';
  return FOUR_C.find((c) => what === `desk.${c}`) ?? null;
}

/** A note worth keeping: trimmed, and none when it is empty. */
const noteOf = (note: string | undefined) => (note !== undefined && note.trim() !== '' ? note.trim() : undefined);

/**
 * What accepting does on screen at once: the change a person makes (with the evidence in the desk notes), and each row's
 * answer, the letters left out rejected with the note. A target that holds the proposal already only answers the rows.
 * A proposal that can't apply any more is refused with its message.
 */
export function acceptChanges(
  view: ProposalView, book: PartnerBook, pick: ProposalPick, now: IsoDateTime,
): { ok: true; changes: PartnerChange[] } | { ok: false; message: string } {
  const items = itemsOf(view, book);
  const picked = (item: ProposalItem) => view.head.kind !== 'fourC' || pick.letters === undefined
    || pick.letters.some((c) => item.what === `desk.${c}`);
  const answers = [
    ...statusRows(items.filter(picked), 'accepted', now), ...statusRows(items.filter((i) => !picked(i)), 'rejected', now, noteOf(pick.note)),
  ];
  if (view.state === 'already') return { ok: true, changes: answers };
  const choice: AcceptPick = {
    ...(pick.letters ? { letters: pick.letters } : {}), ...(pick.signedDate ? { signedDate: pick.signedDate } : {}),
    ...(pick.as ? { as: pick.as } : {}), ...(pick.reason !== undefined ? { reason: pick.reason } : {}),
  };
  const built = acceptChange(view, book, choice, view.targetUpdatedAt);
  if (!('change' in built)) return { ok: false, message: built.ok ? COPY.GONE : built.message };
  return { ok: true, changes: [built.change, ...built.with, ...answers] };
}

/** What rejecting does on screen at once: every waiting row Rejected, with the note. */
export const rejectChanges = (view: ProposalView, book: PartnerBook, note: string, now: IsoDateTime): PartnerChange[] =>
  statusRows(itemsOf(view, book), 'rejected', now, noteOf(note));

/** What the accept sends: the proposal, the `updatedAt` the card showed (the value now beside the proposed one), the choices. */
export function acceptInput(view: ProposalView, pick: ProposalPick): Omit<AcceptBatch, 'sign' | 'onRefused'> {
  const note = noteOf(pick.note);
  return {
    proposalId: view.head.id, expectedUpdatedAt: view.targetUpdatedAt,
    ...(pick.letters ? { letters: pick.letters } : {}), ...(pick.signedDate ? { signedDate: pick.signedDate } : {}),
    ...(pick.as ? { as: pick.as } : {}), ...(pick.reason !== undefined ? { reason: pick.reason } : {}), ...(note ? { note } : {}),
  };
}

/** The proposal's one proposed value (a step, a close, a signing), or null. */
function onlyValue(view: ProposalView, book: PartnerBook) {
  const items = itemsOf(view, book);
  return items.length === 1 ? proposedValue(items[0]!) : null;
}

/**
 * The stepper's own advice before the step a proposal moves to (`stepNudge`): the partner hypothesis first, the
 * confirmed check first. Null for a move with nothing to finish, and for a stage after signing.
 */
export function stepAdvice(
  view: ProposalView, book: PartnerBook, partner: Partner, marketStates: Readonly<Record<string, MarketState>>,
): { to: RecruitmentStep; text: string } | null {
  if (view.head.kind !== 'stage' || view.state === 'already') return null;
  const value = onlyValue(view, book);
  if (value?.field !== 'step') return null;
  const text = stepNudge(partner, value.to, { hypothesisHolds: hypothesisHolds(book, partner.id, marketStates) });
  return text ? { to: value.to, text } : null;
}

/** The close dialog's values from a close proposal: how, and the agent's reason. */
export function closeValues(view: ProposalView, book: PartnerBook): { as: ClosedAs; reason: string } | null {
  const value = view.head.kind === 'close' ? onlyValue(view, book) : null;
  return value?.field === 'closed' ? { as: value.as, reason: view.reason } : null;
}

/** The sign dialog's date from a signed proposal. */
export function signedValues(view: ProposalView, book: PartnerBook): { signedDate: IsoDate } | null {
  const value = view.head.kind === 'signed' ? onlyValue(view, book) : null;
  return value?.field === 'signedDate' ? { signedDate: value.date } : null;
}

const MARKET_KINDS: ReadonlySet<ProposalHead['kind']> = new Set(['partners', 'hypothesisStatus', 'marketStatus']);

/** A proposal about a market (new partners, a hypothesis's or the market's status), not about one partner type. */
export const isMarketKind = (view: Pick<ProposalView, 'head'>): boolean => MARKET_KINDS.has(view.head.kind);

/**
 * What a proposal does, in one line: "4C scores", "Step: Qualification", "Close as: No", "Hypothesis status: Holds",
 * or for new partners "12 companies for Austria" (`about`: the market or hypothesis they are for).
 */
export function proposalWhat(view: Pick<ProposalView, 'head' | 'rows' | 'about'>, about: string = view.about): string {
  const kinds = SHEET_COPY.PROPOSALS.LABELS.kind;
  if (view.head.kind === 'fourC') return kinds.fourC;
  if (view.head.kind === 'partners') return COPY.PROPOSAL_COMPANIES(view.rows.length, about);
  const row = view.rows[0];
  return row ? `${row.what}: ${row.proposed}` : kinds[view.head.kind];
}

/**
 * The page where a proposal sits (spec 10.2): the partner's page on its partner type, the market's Pipeline for new
 * partners, Partner hypotheses for a hypothesis's status, the market's header for its status.
 */
export function proposalHref(view: Pick<ProposalView, 'head' | 'target'>, partnerType: string | null): string {
  const { accountId, marketId } = view.target;
  if (!isMarketKind(view)) return accountId ? partnerHref(accountId, partnerType ?? undefined) : '/partners';
  if (!marketId) return '/markets';
  const market = `/markets/${encodeURIComponent(marketId)}`;
  return view.head.kind === 'hypothesisStatus' ? `${market}?tab=hypotheses` : market;
}

/** Why an accept was refused, for a toast: a target changed since the page was read gets words of its own. */
export function refusalText(view: Pick<ProposalView, 'head'>, failure: { error: string; message: string }): string {
  if (failure.error !== 'conflict' || failure.message !== COPY.CONFLICT) return failure.message;
  return isMarketKind(view) ? COPY.PROPOSAL_MARKET_CHANGED : COPY.PROPOSAL_PARTNER_CHANGED;
}

/**
 * What accepting a hypothesis's or the market's status does to the market on screen at once, as the server does it
 * (spec 7.3): the status (with the agent's status note, when it gave one), against the `updatedAt` the card showed.
 * `about` is what the change log offer names. Null when the market holds it already: then only the rows are answered.
 */
export function marketAcceptChange(
  view: ProposalView, book: PartnerBook,
): { change: MarketChange; about: { entity: 'hypothesis' | 'market'; id: string } } | null {
  if (view.state === 'already') return null;
  const value = onlyValue(view, book);
  const expectedUpdatedAt = view.targetUpdatedAt;
  if (value?.field === 'hypothesisStatus' && view.target.hypothesisId !== null) {
    const id = view.target.hypothesisId;
    return { change: { kind: 'update', entity: 'hypothesis', id, patch: { status: value.to }, expectedUpdatedAt }, about: { entity: 'hypothesis', id } };
  }
  if (value?.field === 'marketStatus') {
    const patch = { status: value.to, ...(value.note.trim() !== '' ? { statusNote: value.note } : {}) };
    return { change: { kind: 'updateInfo', patch, expectedUpdatedAt }, about: { entity: 'market', id: 'status' } };
  }
  return null;
}

/** The accepted rows of a proposal, as the answer writes them: shown at once, while it saves. */
export const acceptRows = (view: ProposalView, book: PartnerBook, now: IsoDateTime): PartnerChange[] =>
  statusRows(itemsOf(view, book), 'accepted', now);

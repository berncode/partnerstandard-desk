// This week (spec 4): the read model's inputs, gathered. It only reads: no event, no resumed emails, no renamed row, no
// summary write. A visit to the home page changes nothing.
import {
  changeLogCall, joinPlan, newMapPlan, proposalViews, proposedValue, PROPOSAL_INDEX_KEEP_DAYS, stepNudge, thisWeek,
  type IsoDate, type IsoDateTime, type PartnerBook, type ProposalView, type ThisWeek, type WeekMap,
} from '@partner-desk/core';
import type { PartnerType } from '@partner-desk/method';
import { z } from 'zod';
import { can } from './access';
import type { Actor } from './actor';
import type { Deps } from './deps';
import { lastProgress, ownerToday, recordIn, startedOn } from './map-shared';
import { logQuietly } from './shared';
import { FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, type CommandResult } from './result';
import { ownCompanyOnly } from './own-company';

const input = z.object({ companyId: z.string().regex(/^co_[0-9a-z]{10}$/) }).strict();

/**
 * One waiting proposal on This week (agent proposals spec 10.2): its card, the partner type it is about (for Show), and
 * whether it can be accepted from This week in one click. Accept some, close, signed, new partners, a step with the
 * stepper's advice and a target changed since go to the page instead, where the record sits next to it.
 */
export interface WeekProposal extends ProposalView {
  partnerType: PartnerType | null;
  oneClick: boolean;
}

/** This week, and the proposals that wait for the person. */
export type ThisWeekWithProposals = ThisWeek & { proposals: WeekProposal[] };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether This week can accept it at once. It reads no market, so a move into Qualification counts as one with advice
 * (the partner hypothesis may not hold yet) [builder's call]. A hypothesis's or market's status goes to the market page
 * when that page would offer to log the change with a recent call (spec 10.3: everything the status picker does).
 */
function oneClick(view: ProposalView, book: PartnerBook, today: IsoDate): boolean {
  if (view.state !== 'waiting' && view.state !== 'already') return false;
  switch (view.head.kind) {
    case 'fourC':
      return true;
    case 'hypothesisStatus': case 'marketStatus':
      return view.target.marketId !== null && changeLogCall(book, view.target.marketId, today) === null;
    case 'stage': {
      if (view.state === 'already') return true;
      const partner = book.partners.find((p) => p.id === view.target.partnerId);
      const item = book.proposalItems.find((i) => i.proposalId === view.head.id);
      const value = item ? proposedValue(item) : null;
      if (!partner || !value) return false;
      return value.field !== 'step' || stepNudge(partner, value.to, { hypothesisHolds: false }) === null;
    }
    case 'close': case 'signed': case 'partners':
      return false;
  }
}

/**
 * The person's waiting proposals of this Partners file, from our index (no Google read, no event) and the book read
 * already. An index that can't be read lists none; an agent gets none (its own are in list_proposals).
 */
async function waitingProposals(
  deps: Deps, actor: Actor, fileId: string, book: PartnerBook, now: IsoDateTime, today: IsoDate,
): Promise<WeekProposal[]> {
  if (actor.kind !== 'owner') return [];
  let entries;
  try {
    const since = new Date(Date.parse(now) - PROPOSAL_INDEX_KEEP_DAYS * DAY_MS).toISOString();
    entries = await deps.proposals.list(actor.userId, { since, status: 'waiting' });
  } catch {
    logQuietly(deps, 'week_proposals_failed', { userId: actor.userId });
    return [];
  }
  const heads = entries.filter((e) => e.fileId === fileId).map(({ id, kind, status, createdAt, answeredAt, expiresAt, agentName, makerOn }) => ({
    id, kind, status, createdAt, answeredAt, expiresAt, agentName, makerOn,
  }));
  return proposalViews(heads, { book, markets: {} }, now)
    .filter((view) => view.state !== 'answered' && view.state !== 'expired')
    .map((view) => ({
      ...view,
      partnerType: book.partners.find((p) => p.id === view.target.partnerId)?.partnerType ?? null,
      oneClick: oneClick(view, book, today),
    }));
}

/**
 * What needs the partner manager this week: reviews coming up, partnerships that need them, activities due and partners
 * waiting in Recruitment. One Partners read, one read of each running partnership's MAP (through the read cache) and the
 * step moves from the event log. A MAP whose partner type is gone from Partners is left out; one that can't be read is
 * listed under "needs you" with no reasons. Records no event: it is read on every home visit [builder's call].
 * The waiting proposals come from our index and the same Partners read, newest first; no market is read.
 */
export const readThisWeek = ownCompanyOnly(async function readThisWeek(
  deps: Deps, actor: Actor, raw: unknown,
): Promise<CommandResult<ThisWeekWithProposals>> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) return invalid();
  if (!can(actor, 'week.read', { ownerUserId: actor.userId })) return FORBIDDEN;
  const company = parsed.data.companyId;
  const bookEntry = await deps.directory.partnerBook(company);
  // A new company has no Partners file until Partners makes it: its week is empty, and this read makes nothing.
  if (!bookEntry) return ok({ reviews: [], needYou: [], due: [], waiting: [], proposals: [] });
  if (!isOwner(actor, bookEntry)) return NOT_FOUND_FILE;
  const bookRead = await deps.partnerBooks.read({ fileId: bookEntry.fileId });
  if (!bookRead.ok) return fromStore(bookRead);
  const book = bookRead.snapshot.value;
  const today = await ownerToday(deps, actor.userId);
  const stepMovedAt = await deps.events.latestByEntity(bookEntry.fileId, 'setStep');

  const maps: WeekMap[] = [];
  for (const listed of (await deps.directory.maps(company)).filter((m) => isOwner(actor, m))) {
    const found = recordIn(book, listed);
    // Nothing in a MAP of a partner type that is gone, one not signed or one that has ended is This week's business.
    if (!found || found.record.signedDate === null || found.record.stage === 'exit') continue;
    const base = {
      mapId: listed.mapId, partnerId: listed.partnerId, displayName: listed.displayName, lastProgressAt: lastProgress(listed),
    };
    const entry = await deps.directory.map(listed.mapId);
    const read = entry ? await deps.maps.read({ fileId: entry.fileId }) : null;
    if (!entry || !read || !read.ok) {
      if (read && !read.ok) logQuietly(deps, 'week_read_failed', { mapId: listed.mapId, error: read.error });
      // The record's facts alone: enough to tell it is a running partnership.
      const plan = joinPlan(newMapPlan({ partnerId: listed.partnerId, partnerType: listed.partnerType, contacts: [] }), found.record, startedOn(listed));
      maps.push({ ...base, plan, digestHealth: null, unreadable: true });
      continue;
    }
    const notify = await deps.directory.mapNotifyState(listed.mapId);
    maps.push({
      ...base, plan: joinPlan(read.snapshot.value, found.record, startedOn(entry)), digestHealth: notify?.digestHealth ?? null, unreadable: false,
    });
  }
  const now = deps.clock();
  const proposals = await waitingProposals(deps, actor, bookEntry.fileId, book, now, today);
  return ok({ ...thisWeek({ book, maps, stepMovedAt, today, now }), proposals });
});

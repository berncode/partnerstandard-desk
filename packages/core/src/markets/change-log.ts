// When the market page offers to log a change with a call (moved from apps/web's market-model, so This week follows
// the same rule): the latest call with one of the market's partners, less than 7 days before today.
import { daysBetween } from '../maps/dates';
import type { Call, IsoDate, PartnerBook } from '../partners/types';

/** The change log is offered after an edit made less than this many days after the latest call. */
export const CHANGE_LOG_OFFER_DAYS = 7;

/** The calls with this market's partners, newest first; on the same day, the later row first. */
export function marketCalls(book: PartnerBook, marketId: string): Call[] {
  const linked = new Set(book.marketLinks.filter((link) => link.marketId === marketId).map((link) => link.partnerId));
  const partners = new Set(book.partners.filter((p) => linked.has(p.id)).map((p) => p.id));
  return book.calls
    .map((call, index) => ({ call, index }))
    .filter(({ call }) => partners.has(call.partnerId))
    .sort((a, b) => b.call.date.localeCompare(a.call.date) || b.index - a.index)
    .map(({ call }) => call);
}

/** The latest call with one of this market's partners, when it is less than 7 days before `today`: the change log offers it. */
export function changeLogCall(book: PartnerBook, marketId: string, today: IsoDate): string | null {
  const latest = marketCalls(book, marketId)[0];
  if (!latest || daysBetween(latest.date, today) >= CHANGE_LOG_OFFER_DAYS) return null;
  return latest.id;
}

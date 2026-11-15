// New for PartnerStandard Desk (reviews spec 5.5, 6): what a partnership's Reviews area shows, cut from `readReview`. Pure: no
// React, no I/O.
import type { CaseAgainstActual, Currency, HypothesisAnswer, IsoDate } from '@partner-desk/core';
import type { ReviewRead } from '@partner-desk/commands';

/** The partnership's next review, as the area shows it. */
export type NextReview =
  | { kind: 'none' }
  | { kind: 'later' | 'coming'; date: IsoDate; prepStarted: boolean }
  | { kind: 'overdue'; date: IsoDate; daysLate: number; prepStarted: boolean };

/** A partner type's Reviews area: no MAP, a MAP that can't be read, or what `readReview` gives. */
export type ReviewAreaState =
  | { kind: 'none' }
  | { kind: 'unread'; mapId: string; message: string }
  | {
    kind: 'ready'; mapId: string; today: IsoDate; next: NextReview;
    /** Newest first. */
    held: Array<{ reviewId: string; horizon: number; heldOn: IsoDate | null; answers?: HypothesisAnswer[] }>;
    /** Null with no usable business case or no held review: the comparison is hidden. */
    caseAgainstActual: CaseAgainstActual | null;
    /** The business case's currency; null when it isn't known: money then shows whole without a sign. */
    currency: Currency | null;
  };

/** Held reviews, newest first: by the day they were held, then by horizon. */
export function heldNewestFirst(held: ReviewRead['held'], answers: ReviewRead['heldAnswers'] = {}): Extract<ReviewAreaState, { kind: 'ready' }>['held'] {
  return held
    .map((r) => ({ reviewId: r.id, horizon: r.horizon, heldOn: r.heldOn, answers: answers[r.id] ?? [] }))
    .sort((a, b) => (b.heldOn ?? '').localeCompare(a.heldOn ?? '') || b.horizon - a.horizon);
}

/** What the area keeps of a review read (ids, dates and numbers; the page that shows it is the owner's). */
export function areaStateOf(read: ReviewRead, today: IsoDate): Extract<ReviewAreaState, { kind: 'ready' }> {
  const { status } = read;
  const next: NextReview = status.kind === 'none' ? { kind: 'none' }
    : status.kind === 'later' ? { kind: 'later', date: status.date, prepStarted: read.review !== null }
      : status.kind === 'coming' ? { kind: 'coming', date: status.date, prepStarted: status.prepId !== null }
        : { kind: 'overdue', date: status.date, daysLate: status.daysLate, prepStarted: status.prepId !== null };
  return {
    kind: 'ready', mapId: read.mapId, today, next, held: heldNewestFirst(read.held, read.heldAnswers),
    caseAgainstActual: read.caseAgainstActual, currency: read.caseCurrency,
  };
}

// The review page's model (reviews spec 5.2 to 5.5): its addresses, the actions it calls, and the small rules its
// screens share. Pure: no React, no I/O.
import {
  closeReviewChanges, SCORE_KEYS, type CategoryNumber, type Currency, type IsoDate, type JoinedPlan, type MapChange, type ReviewItem,
  type ReviewItemKind, type ScoreKey,
} from '@partner-desk/core';
import { formatMoney } from '@/cases/format';
import { type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { RemoteOutcome } from '@/editor/remote';
import type { RemoteResult } from '@/maps/remote';

/**
 * The server actions the page calls: every prep edit through the MAP's change, opening and closing the review, and a
 * held review's summary for the partner (sent, or its link turned off).
 */
export interface ReviewActions {
  change: (input: { mapId: string; change: MapChange }) => Promise<RemoteResult>;
  open: (input: { mapId: string }) => Promise<RemoteOutcome>;
  close: (input: { mapId: string; reviewId: string; heldOn: IsoDate }) => Promise<RemoteOutcome<{ suggestion: Stage | null }>>;
  sendSummary: (input: { mapId: string; reviewId: string; personIds: string[]; includeScorecard: boolean }) => Promise<RemoteOutcome<{ message: string }>>;
  revokeSummary: (input: { mapId: string; reviewId: string }) => Promise<RemoteOutcome<{ message: string }>>;
}

/** The current horizon's review, or a held one by its id. */
export const reviewPath = (mapId: string, reviewId?: string | null): string =>
  reviewId ? `/plans/${mapId}/review/${reviewId}` : `/plans/${mapId}/review`;

/** The review's present view: the current horizon's, or a held one's. */
export const reviewPresentPath = (mapId: string, reviewId?: string | null): string =>
  `/plans/${mapId}/review/present${reviewId ? `?review=${encodeURIComponent(reviewId)}` : ''}`;

/** The scorecard's numbers this partnership has: the number by partner category only for a category that has one. */
export const scoreKeysFor = (category: CategoryNumber | null): ScoreKey[] =>
  SCORE_KEYS.filter((key) => key !== 'categoryNumber' || category !== null);

/** A number's name on screen: the category number by its category ("Active sellers"). */
export function numberLabel(key: ScoreKey, category: CategoryNumber | null): string {
  if (key === 'categoryNumber' && category) return COPY.REVIEW_CATEGORY_LABELS[category];
  return COPY.REVIEW_NUMBER_LABELS[key];
}

/** The numbers whose targets come from the business case: with none of them set, there is no case to compare with. */
export const CASE_KEYS: readonly ScoreKey[] = ['dealsWon', 'weBill', 'partnerEarns'];

const AMOUNT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const FIELD = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1, useGrouping: false });

/** A number as the screens show it: rounded to one decimal (a forecast counts parts of deals), with thousands separators. */
export const formatAmount = (value: number): string => AMOUNT.format(value);

/** A number as a field holds it: rounded the same way, without separators, so it reads back as typed. */
export const fieldAmount = (value: number | null): string => (value === null ? '' : FIELD.format(value));

/**
 * What a person typed in a number field: null for empty, the number for 12000, 12.5 or 12,000, and 'invalid' for text
 * such as "12k" or a number below 0.
 */
export function parseAmount(text: string): number | null | 'invalid' {
  const trimmed = text.trim().replace(/,/g, '');
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return 'invalid';
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : 'invalid';
}

/** The numbers that are money: shown whole, with the business case's currency (walkthrough 2026-11-01). */
export const MONEY_KEYS: readonly ScoreKey[] = ['weBill', 'partnerEarns', 'openValue'];
export const isMoney = (key: ScoreKey): boolean => MONEY_KEYS.includes(key);

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** A number as the screens show it: money whole, anything else to one decimal. */
export const shownValue = (key: ScoreKey, value: number): number => (isMoney(key) ? Math.round(value) : Math.round(value * 10) / 10);

/**
 * A scorecard number as the screens show it: money whole with the case's sign (€11,836, as the case screens show it),
 * or whole without a sign when there is no case; anything else as `formatAmount`.
 */
export function formatScore(key: ScoreKey, value: number, currency: Currency | null): string {
  if (!isMoney(key)) return formatAmount(value);
  return currency ? formatMoney(value, currency) : WHOLE.format(Math.round(value));
}

/** Actual against target in a percent, counted from the numbers as shown, so the three agree on screen. */
export const scorePercent = (key: ScoreKey, actual: number | null, target: number | null): number | null =>
  percentOf(actual === null ? null : shownValue(key, actual), target === null ? null : shownValue(key, target));

/** Deals as the case against actual shows them: whole, as a forecast counts parts of deals. */
export const formatDeals = (value: number): string => WHOLE.format(Math.round(value));

/** Actual against target, rounded; none without both, or with a target of 0 (nothing divides by zero). */
export function percentOf(actual: number | null, target: number | null): number | null {
  if (actual === null || target === null || target <= 0) return null;
  return Math.round((actual / target) * 100);
}

/** The review's lines of one kind, in the order the file holds them. */
export const itemsOf = (plan: JoinedPlan, reviewId: string, kind: ReviewItemKind): ReviewItem[] =>
  plan.reviewItems.filter((i) => i.reviewId === reviewId && i.kind === kind);

/**
 * What would stop the review from closing now, as `closeReview` checks it: field errors keyed by item id, `heldOn`,
 * `nextHorizonDays` or `reviewId`. Null when it can close. The server checks again.
 */
export function closeProblems(plan: JoinedPlan, reviewId: string, heldOn: IsoDate, today: IsoDate): Record<string, string> | null {
  const out = closeReviewChanges(plan, { reviewId, heldOn, today });
  return out.ok ? null : out.fieldErrors;
}

// Review rows (spec 5): a partner review closes one horizon. The rows live in the MAP file (three tabs), so this file
// imports nothing from `maps`.
import type { CaseSource } from '../cases/types';
import type { IsoDate, IsoDateTime } from '../partners/types';

export const REVIEW_STATES = ['prep', 'held'] as const;
export type ReviewState = (typeof REVIEW_STATES)[number];

/** One review. `horizon` is 1-based: the horizon this review closes. */
export interface MapReview {
  id: string;
  horizon: number;
  state: ReviewState;
  heldOn: IsoDate | null;
  caseId: string | null;
  decisions: string;
  relationshipNote: string;
  nextHorizonDays: number;
  includeScorecard: boolean;
  summarySentAt: IsoDateTime | null;
  /**
   * The names of the people the last summary went to, as the review's row in the MAP sheet shows them ("Anna Keller, Tom
   * Berger"); empty until a summary went out. Kept in the sheet, never in our database (owner, 2026-11-01).
   */
  summarySentTo: string;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

export const SCORE_KEYS = ['dealsWon', 'weBill', 'partnerEarns', 'openDeals', 'openValue', 'categoryNumber', 'recommend'] as const;
export type ScoreKey = (typeof SCORE_KEYS)[number];

/** One scorecard line of a review: what happened against what the case planned, and the next target. */
export interface ReviewNumber {
  id: string;
  reviewId: string;
  key: ScoreKey;
  actual: number | null;
  target: number | null;
  source: CaseSource | null;
  note: string;
  nextTarget: number | null;
}

export const REVIEW_ITEM_KINDS = ['notDone', 'blocker', 'commitment', 'hypothesis'] as const;
export type ReviewItemKind = (typeof REVIEW_ITEM_KINDS)[number];
export const HYPOTHESIS_ANSWERS = ['holds', 'changed', 'doesnt_hold'] as const;
export type HypothesisAnswer = (typeof HYPOTHESIS_ANSWERS)[number];

/**
 * One line of a review's lists. `refId` is the activity id for `notDone`, the hypothesis id for `hypothesis`, and null
 * when the answer is about "Why it fits". `moved` is true once a commitment became a MAP activity.
 */
export interface ReviewItem {
  id: string;
  reviewId: string;
  kind: ReviewItemKind;
  refId: string | null;
  title: string;
  side: 'us' | 'partner' | 'joint' | null;
  ownerId: string | null;
  dueDate: IsoDate | null;
  milestoneId: string | null;
  answer: HypothesisAnswer | null;
  note: string;
  moved: boolean;
}

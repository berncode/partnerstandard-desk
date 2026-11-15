'use client';

// What the review page's areas share: the review as the person sees it (the MAP editor's plan, saved as they type), the
// read the page was loaded with (targets, hypotheses, the case), and the field errors closing found.
import type { ReviewRead } from '@partner-desk/commands';
import type {
  IsoDate, JoinedPlan, MapApplyOutcome, MapChange, MapReview, ReviewItem, ReviewItemKind, ReviewNumber, ScoreKey,
} from '@partner-desk/core';
import { createContext, useContext } from 'react';
import type { SideNames } from '@/maps/format';
import type { DispatchOptions } from '@/maps/use-plan-editor';

export interface ReviewContextValue {
  mapId: string;
  read: ReviewRead;
  plan: JoinedPlan;
  review: MapReview;
  /** Held: only notes, reasons and numbers can still change (spec 5.3). */
  held: boolean;
  today: IsoDate;
  names: SideNames;
  /** Closing's field errors, by item id, `heldOn` or `nextHorizonDays`. */
  errors: Record<string, string>;
  dispatch: (change: MapChange, options?: DispatchOptions) => MapApplyOutcome;
  /** The review's lines of one kind. */
  items: (kind: ReviewItemKind) => ReviewItem[];
  number: (key: ScoreKey) => ReviewNumber | null;
  /** A number's target as the page shows it: the stored one, else the one the review computes. */
  targetOf: (key: ScoreKey) => number | null;
  /** Saves a number's fields: an update of its row, or a new row with its computed target kept as a snapshot. */
  setNumber: (key: ScoreKey, patch: Partial<Pick<ReviewNumber, 'actual' | 'target' | 'source' | 'note' | 'nextTarget'>>) => MapApplyOutcome;
  /** Saves an item's fields, and clears closing's error on it. */
  setItem: (id: string, patch: Partial<ReviewItem>) => MapApplyOutcome;
  addItem: (kind: ReviewItemKind, values: Partial<ReviewItem>) => MapApplyOutcome;
}

export const ReviewContext = createContext<ReviewContextValue | null>(null);

export function useReview(): ReviewContextValue {
  const value = useContext(ReviewContext);
  if (!value) throw new Error('useReview must be used inside <ReviewPage>');
  return value;
}

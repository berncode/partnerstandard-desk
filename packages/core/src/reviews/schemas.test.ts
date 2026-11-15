import { describe, expect, it } from 'vitest';
import { reviewItemSchema, reviewNumberSchema, reviewSchema } from './schemas';
import type { MapReview, ReviewItem, ReviewNumber } from './types';

const review: MapReview = {
  id: 'rv_abc123', horizon: 1, state: 'prep', heldOn: null, caseId: null, decisions: '', relationshipNote: '',
  nextHorizonDays: 90, includeScorecard: true, summarySentAt: null, summarySentTo: '', updatedAt: null, updatedBy: null,
};
const number: ReviewNumber = { id: 'rn_abc123', reviewId: 'rv_abc123', key: 'dealsWon', actual: 3, target: 5, source: null, note: '', nextTarget: 6 };
const item: ReviewItem = {
  id: 'ri_abc123', reviewId: 'rv_abc123', kind: 'commitment', refId: null, title: 'Send the price list', side: 'us', ownerId: null,
  dueDate: null, milestoneId: null, answer: null, note: '', moved: false,
};

describe('reviewSchema', () => {
  it('a review row needs a horizon of 1 or more and a known state', () => {
    expect(reviewSchema.safeParse(review).success).toBe(true);
    expect(reviewSchema.safeParse({ ...review, horizon: 0 }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...review, state: 'closed' }).success).toBe(false);
    expect(reviewSchema.safeParse({ ...review, state: 'held', heldOn: '2026-11-01' }).success).toBe(true);
  });

  it('a review keeps the names its summary went to as text, as its row in the MAP sheet shows them (owner, 2026-11-01)', () => {
    const sent = { ...review, summarySentAt: '2026-11-01T10:00:00.000Z', summarySentTo: 'Anna Keller, Tom Berger' };
    expect(reviewSchema.parse(sent)).toEqual(sent);
    expect(reviewSchema.safeParse({ ...review, summarySentTo: null }).success).toBe(false);
  });
});

describe('reviewNumberSchema', () => {
  it("a number row's actual, target and nextTarget are numbers or null, never negative", () => {
    expect(reviewNumberSchema.safeParse({ ...number, actual: null, target: null, nextTarget: null }).success).toBe(true);
    for (const field of ['actual', 'target', 'nextTarget'] as const) {
      expect(reviewNumberSchema.safeParse({ ...number, [field]: -1 }).success).toBe(false);
      expect(reviewNumberSchema.safeParse({ ...number, [field]: '12k' }).success).toBe(false);
    }
  });

  it('recommend is between 0 and 10', () => {
    const recommend = { ...number, key: 'recommend' as const };
    expect(reviewNumberSchema.safeParse({ ...recommend, actual: 10, target: 0, nextTarget: 8 }).success).toBe(true);
    expect(reviewNumberSchema.safeParse({ ...recommend, actual: 11 }).success).toBe(false);
    expect(reviewNumberSchema.safeParse({ ...recommend, nextTarget: 11 }).success).toBe(false);
    expect(reviewNumberSchema.safeParse({ ...number, actual: 11 }).success).toBe(true);
  });
});

describe('reviewItemSchema', () => {
  it("an item's answer is set only for kind hypothesis", () => {
    expect(reviewItemSchema.safeParse({ ...item, kind: 'hypothesis', answer: 'holds' }).success).toBe(true);
    expect(reviewItemSchema.safeParse({ ...item, kind: 'blocker', answer: 'holds' }).success).toBe(false);
    expect(reviewItemSchema.safeParse({ ...item, kind: 'hypothesis', answer: 'maybe' }).success).toBe(false);
  });

  it('a commitment with an empty title is valid as a draft', () => {
    expect(reviewItemSchema.safeParse({ ...item, title: '' }).success).toBe(true);
  });
});

// The review page's data for component tests: a MAP as `readMap` gives it and the review as `readReview` gives it, built
// from the same rows, so the page's editor and its read agree.
import type { ReviewRead } from '@partner-desk/commands';
import {
  joinPlan, reviewStatus, summarizeMap, type MapPlan, type MapRecord,
} from '@partner-desk/core';
import { makeMapPlan, makeRecord, MAP_NOW, MAP_TODAY } from '@partner-desk/core/test-builders';
import type { MapSnapshot } from '@/maps/remote';

export const REVIEW_TODAY = MAP_TODAY;
export const STARTED_ON = '2026-09-01';

export function reviewSnapshot(plan: MapPlan = makeMapPlan(), record: MapRecord = makeRecord()): MapSnapshot {
  return { value: plan, issues: [], record, startedOn: STARTED_ON, lastProgressAt: MAP_NOW };
}

/** `readReview`'s answer for `plan`: the first prep (or held) review in it, or none before prep. */
export function reviewRead(plan: MapPlan = makeMapPlan(), record: MapRecord = makeRecord(), over: Partial<ReviewRead> = {}): ReviewRead {
  const joined = joinPlan(plan, record, STARTED_ON);
  const review = over.review !== undefined ? over.review : plan.reviews[0] ?? null;
  return {
    mapId: 'map_test', partnerName: record.partnerName, partnerType: record.partnerType, record, info: joined.info,
    status: reviewStatus(joined, REVIEW_TODAY),
    review,
    numbers: review ? plan.reviewNumbers.filter((n) => n.reviewId === review.id) : [],
    items: review ? plan.reviewItems.filter((i) => i.reviewId === review.id) : [],
    work: plan.activities, objectives: plan.objectives, milestones: plan.milestones, exitTriggers: plan.exitTriggers,
    health: summarizeMap(joined, REVIEW_TODAY, MAP_NOW), people: plan.people,
    targets: { dealsWon: null, weBill: null, partnerEarns: null, openDeals: null, openValue: null, categoryNumber: null, recommend: 8 },
    prefill: { weBill: null, partnerEarns: null, categoryNumber: null },
    perDeal: null, categoryNumber: 'activeSellers', case: null, caseOptions: [], hypotheses: [], hypothesesIncomplete: false,
    whyItFits: 'They sell to the same banks', caseAgainstActual: null, caseCurrency: null, heldAnswers: {},
    held: plan.reviews.filter((r) => r.state === 'held'),
    expectedUpdatedAt: review?.updatedAt ?? '',
    ...over,
  };
}

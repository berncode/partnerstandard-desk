// `makePlan` builds the MAP app's plan (the stored MAP joined with the partner record), `makeMapPlan` and `makeRecord`
// the two halves PartnerStandard Desk keeps.
import type { MapReview, ReviewItem, ReviewNumber } from '../reviews/types';
import type { Activity, ExitTrigger, JoinedPlan, MapPerson, MapPlan, MapRecord, Milestone, Objective } from './types';

export const TODAY = '2026-10-16';
export const NOW = '2026-10-16T10:00:00.000Z';

export function makeActivity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: 'a_test01', title: 'Test activity', category: 'other', side: 'us', ownerId: null, dueDate: null,
    status: 'not_started', completedDate: null, milestoneId: null, note: '', updatedAt: null, updatedBy: null,
    ...overrides,
  };
}

export function makePerson(overrides: Partial<MapPerson> = {}): MapPerson {
  return {
    id: 'p_test01', side: 'us', name: 'Anna Keller', title: 'Partner Manager', email: 'anna@example.com',
    role: 'partner_manager', ...overrides,
  };
}

export function makeMilestone(overrides: Partial<Milestone> = {}): Milestone {
  return { id: 'm_test01', name: 'Day 30', targetDate: '2026-11-01', criteria: '', achievedDate: null, ...overrides };
}

export function makeObjective(overrides: Partial<Objective> = {}): Objective {
  return { id: 'o_test01', side: 'us', statement: 'Grow pipeline', successMeasure: '', ...overrides };
}

export function makeExitTrigger(overrides: Partial<ExitTrigger> = {}): ExitTrigger {
  return { id: 'x_test01', condition: 'No deals in 90 days', status: 'ok', ...overrides };
}

export function makeReview(overrides: Partial<MapReview> = {}): MapReview {
  return {
    id: 'rv_test01', horizon: 1, state: 'prep', heldOn: null, caseId: null, decisions: '', relationshipNote: '',
    nextHorizonDays: 90, includeScorecard: true, summarySentAt: null, summarySentTo: '', updatedAt: null, updatedBy: null, ...overrides,
  };
}

export function makeReviewNumber(overrides: Partial<ReviewNumber> = {}): ReviewNumber {
  return { id: 'rn_test01', reviewId: 'rv_test01', key: 'dealsWon', actual: null, target: null, source: null, note: '', nextTarget: null, ...overrides };
}

export function makeReviewItem(overrides: Partial<ReviewItem> = {}): ReviewItem {
  return {
    id: 'ri_test01', reviewId: 'rv_test01', kind: 'notDone', refId: null, title: '', side: null, ownerId: null, dueDate: null,
    milestoneId: null, answer: null, note: '', moved: false, ...overrides,
  };
}

/** The MAP app's plan: what the copied health, change and notification rules read. */
export function makePlan(overrides: Partial<JoinedPlan> = {}): JoinedPlan {
  return {
    info: {
      partnerName: 'Acme', partnerType: 'reseller', stage: 'onboarding', startDate: '2026-10-10',
      horizonDays: 90, nextReviewDate: null, pastHorizons: [], closed: null, closedReason: '',
    },
    objectives: [], activities: [], people: [], milestones: [], exitTriggers: [],
    reviews: [], reviewNumbers: [], reviewItems: [],
    ...overrides,
  };
}

/** A MAP as its file stores it: the same plan, signed on 2026-10-10 (see `makeRecord`). */
export function makeMapPlan(overrides: Partial<MapPlan> = {}): MapPlan {
  return {
    info: { partnerId: 'p_abc123', partnerType: 'reseller', horizonDays: 90, laterHorizons: [], nextReviewDate: null },
    objectives: [], activities: [], people: [], milestones: [], exitTriggers: [],
    reviews: [], reviewNumbers: [], reviewItems: [],
    ...overrides,
  };
}

/** The partner record's facts for `makeMapPlan`: Acme as reseller, signed on 2026-10-10, in onboarding. */
export function makeRecord(overrides: Partial<MapRecord> = {}): MapRecord {
  return {
    partnerName: 'Acme', partnerType: 'reseller', stage: 'onboarding', signedDate: '2026-10-10', closed: null, closedReason: '',
    ...overrides,
  };
}

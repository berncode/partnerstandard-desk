// Partner types, stages and closing are PartnerStandard Desk's (packages/method, partners/types), `Person` is
// `MapPerson`, and the MAP app's `Plan` is the `JoinedPlan`: what a MAP file stores (`MapPlan`) joined with the partner
// record's facts (`MapRecord`, see join.ts).
import type { PartnerType, Stage } from '@partner-desk/method';
import type { ClosedAs, IsoDate, IsoDateTime } from '../partners/types';
import type { MapReview, ReviewItem, ReviewNumber } from '../reviews/types';

/** The lengths a horizon (one working period of a MAP) can be started with; 90 is recommended and the default. */
export const HORIZON_LENGTHS = [30, 60, 90, 120, 180] as const;
export const DEFAULT_HORIZON_DAYS = 90;
export const SIDES = ['us', 'partner'] as const;
export const ACTIVITY_SIDES = ['us', 'partner', 'joint'] as const;
export const CATEGORIES = ['sales', 'marketing', 'product', 'other'] as const;
export const ACTIVITY_STATUSES = ['not_started', 'in_progress', 'blocked', 'done', 'na'] as const;
export const ROLES = ['exec_sponsor', 'partner_manager', 'sales_lead', 'marketing_lead', 'technical_lead', 'other'] as const;
export const EXIT_STATUSES = ['ok', 'watch', 'triggered'] as const;

export type Side = (typeof SIDES)[number];
export type ActivitySide = (typeof ACTIVITY_SIDES)[number];
export type Category = (typeof CATEGORIES)[number];
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];
export type Role = (typeof ROLES)[number];
export type ExitStatus = (typeof EXIT_STATUSES)[number];
export type HorizonLength = (typeof HORIZON_LENGTHS)[number];

/** A working period of the plan that has ended: when it started, how long it ran, and the stage it was in. */
export interface PastHorizon {
  startDate: IsoDate;
  horizonDays: number;
  stage: Stage;
}

/**
 * The MAP app's plan details. `startDate`, `horizonDays` and `stage` describe the current horizon; earlier ones are in
 * `pastHorizons`, oldest first. `closed` is set when the recruitment ended without signing, with its reason.
 * In PartnerStandard Desk this is never stored: `planInfoFor` makes it from the MAP's info and the partner record.
 */
export interface PlanInfo {
  partnerName: string;
  partnerType: PartnerType;
  stage: Stage;
  startDate: IsoDate;
  horizonDays: number;
  nextReviewDate: IsoDate | null;
  pastHorizons: PastHorizon[];
  closed: ClosedAs | null;
  closedReason: string;
}

/** The recruitment ended without signing: no horizon will run, and the plan sends no reminders. */
export const endedWithoutSigning = (info: PlanInfo): boolean => info.stage === 'recruitment' && info.closed !== null;

/**
 * The partnership has ended (PartnerStandard Desk, ruling R7): after the partner type's exit the MAP stays as it was, read-only
 * for people with a link, and sends nobody reminders, momentum warnings or a weekly copy.
 */
export const afterExit = (info: Pick<PlanInfo, 'stage'>): boolean => info.stage === 'exit';

/** A horizon a person started after the first one ("Start next horizon"): when, and for how many days. */
export interface LaterHorizon {
  startDate: IsoDate;
  horizonDays: number;
}

/**
 * What a MAP file stores about the plan (spec 5.3). The partner's name, its stage, signing and closing live on the
 * partner record. The first horizon starts on the signing date with `horizonDays`; `laterHorizons` are the ones a
 * person started after it, oldest first.
 */
export interface MapInfo {
  /** The partner type (a Partners row's id) this MAP belongs to. */
  partnerId: string;
  partnerType: PartnerType;
  horizonDays: number;
  laterHorizons: LaterHorizon[];
  nextReviewDate: IsoDate | null;
}

/** The partner record's facts a MAP shows: read from Partners, never written by a MAP change. */
export interface MapRecord {
  partnerName: string;
  partnerType: PartnerType;
  stage: Stage;
  signedDate: IsoDate | null;
  closed: ClosedAs | null;
  closedReason: string;
}

export interface Objective {
  id: string;
  side: Side;
  statement: string;
  successMeasure: string;
}

export interface Activity {
  id: string;
  title: string;
  category: Category;
  side: ActivitySide;
  ownerId: string | null;
  dueDate: IsoDate | null;
  status: ActivityStatus;
  completedDate: IsoDate | null;
  milestoneId: string | null;
  note: string;
  updatedAt: IsoDateTime | null;
  updatedBy: string | null;
}

export interface MapPerson {
  id: string;
  side: Side;
  name: string;
  title: string;
  email: string | null;
  role: Role;
}

export interface Milestone {
  id: string;
  name: string;
  targetDate: IsoDate | null;
  criteria: string;
  achievedDate: IsoDate | null;
}

export interface ExitTrigger {
  id: string;
  condition: string;
  status: ExitStatus;
}

/** The rows of a MAP, the same in the file and in the joined plan. */
export interface MapRows {
  objectives: Objective[];
  activities: Activity[];
  people: MapPerson[];
  milestones: Milestone[];
  exitTriggers: ExitTrigger[];
  reviews: MapReview[];
  reviewNumbers: ReviewNumber[];
  reviewItems: ReviewItem[];
}

/** The rows with the review rows emptied: what a person with a link, the health rules and the notifications see. */
export const withoutReviews = <T extends MapRows>(rows: T): T => ({ ...rows, reviews: [], reviewNumbers: [], reviewItems: [] });

/** A MAP as its file stores it. */
export interface MapPlan extends MapRows {
  info: MapInfo;
}

/** The MAP app's `Plan`: a MAP joined with its partner record. The copied health, change and notification rules read it. */
export interface JoinedPlan extends MapRows {
  info: PlanInfo;
}

export type EntityKind = 'objective' | 'activity' | 'person' | 'milestone' | 'exitTrigger' | 'review' | 'reviewNumber' | 'reviewItem';

export interface EntityByKind {
  objective: Objective;
  activity: Activity;
  person: MapPerson;
  milestone: Milestone;
  exitTrigger: ExitTrigger;
  review: MapReview;
  reviewNumber: ReviewNumber;
  reviewItem: ReviewItem;
}

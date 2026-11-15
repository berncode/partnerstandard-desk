// The plan as a MAP file stores it, and the partner record's facts (Brightwave Systems as reseller, signed on the
// plan's start) apart. The method package imports nothing from core, so the shapes are spelled out here; core types them
// as its MapPlan and MapRecord (core's maps/content.test.ts).
import type { PartnerType } from '../partner-types';
import type { Stage } from '../stages';
import { addDays } from './dates';
import type { StarterCategory as Category, StarterSide as ActivitySide } from './starters';

type IsoDate = string;
type Side = 'us' | 'partner';
type ActivityStatus = 'not_started' | 'in_progress' | 'blocked' | 'done' | 'na';
type Role = 'exec_sponsor' | 'partner_manager' | 'sales_lead' | 'marketing_lead' | 'technical_lead' | 'other';

interface SampleActivity {
  id: string; title: string; category: Category; side: ActivitySide; ownerId: string | null; dueDate: IsoDate | null;
  status: ActivityStatus; completedDate: IsoDate | null; milestoneId: string | null; note: string;
  updatedAt: string | null; updatedBy: string | null;
}

export interface SamplePlan {
  info: { partnerId: string; partnerType: PartnerType; horizonDays: number; laterHorizons: Array<{ startDate: IsoDate; horizonDays: number }>; nextReviewDate: IsoDate | null };
  objectives: Array<{ id: string; side: Side; statement: string; successMeasure: string }>;
  activities: SampleActivity[];
  people: Array<{ id: string; side: Side; name: string; title: string; email: string | null; role: Role }>;
  milestones: Array<{ id: string; name: string; targetDate: IsoDate | null; criteria: string; achievedDate: IsoDate | null }>;
  exitTriggers: Array<{ id: string; condition: string; status: 'ok' | 'watch' | 'triggered' }>;
  /** The sample has no reviews; the types live in core, which this package can't import. */
  reviews: never[];
  reviewNumbers: never[];
  reviewItems: never[];
}

export interface SampleRecord {
  partnerName: string; partnerType: PartnerType; stage: Stage; signedDate: IsoDate | null; closed: 'not_now' | 'no' | null; closedReason: string;
}

/** The sample's horizon started (and its agreement was signed) this many days before `today`. */
const STARTED_DAYS_AGO = 34;

/** The partner record's facts for the sample MAP: signed on the day its first horizon started. */
export function buildSampleRecord(today: IsoDate): SampleRecord {
  return {
    partnerName: 'Brightwave Systems', partnerType: 'reseller', stage: 'onboarding', signedDate: addDays(today, -STARTED_DAYS_AGO),
    closed: null, closedReason: '',
  };
}

/** The Brightwave sample MAP: dates are relative to `today` so the demo always looks current. */
export function buildSamplePlan(today: IsoDate): SamplePlan {
  const start = addDays(today, -STARTED_DAYS_AGO);
  const day = (n: number) => addDays(start, n);
  const at = (n: number) => `${day(n)}T09:00:00.000Z`;

  function activity(
    id: string, title: string, category: Category, side: ActivitySide, ownerId: string, due: number,
    status: ActivityStatus, completed: number | null, milestoneId: string, updated: number, updatedBy: string, note = '',
  ): SampleActivity {
    return {
      id, title, category, side, ownerId, dueDate: day(due), status,
      completedDate: completed === null ? null : day(completed), milestoneId, note, updatedAt: at(updated), updatedBy,
    };
  }

  return {
    info: { partnerId: 'p_sample', partnerType: 'reseller', horizonDays: 90, laterHorizons: [], nextReviewDate: day(90) },
    objectives: [
      { id: 'o_sample1', side: 'us', statement: 'Build 250k in partner-sourced pipeline by day 90', successMeasure: '250k or more registered by Brightwave in our CRM' },
      { id: 'o_sample2', side: 'us', statement: 'Five Brightwave sellers certified and active', successMeasure: 'Five sellers certified, each with a registered deal' },
      { id: 'o_sample3', side: 'partner', statement: 'Add cloud security to grow average deal size', successMeasure: 'Average deal size up 15% on deals that include it' },
      { id: 'o_sample4', side: 'partner', statement: 'Win three new customers with the joint offer', successMeasure: 'Three signed customers by day 90' },
    ],
    people: [
      { id: 'p_sample1', side: 'us', name: 'Anna Keller', title: 'Partner Manager', email: 'anna@example.com', role: 'partner_manager' },
      { id: 'p_sample2', side: 'us', name: 'Marc Dubois', title: 'VP Sales', email: 'marc@example.com', role: 'exec_sponsor' },
      { id: 'p_sample3', side: 'partner', name: 'Priya Shah', title: 'Head of Alliances', email: 'priya@example.com', role: 'partner_manager' },
      { id: 'p_sample4', side: 'partner', name: 'Tom Becker', title: 'CEO', email: 'tom@example.com', role: 'exec_sponsor' },
      { id: 'p_sample5', side: 'partner', name: 'Lena Ortiz', title: 'Sales Lead', email: 'lena@example.com', role: 'sales_lead' },
    ],
    milestones: [
      { id: 'm_sample1', name: 'Day 30: Partner enabled', targetDate: day(30), criteria: 'Sellers trained and portal access live', achievedDate: day(29) },
      { id: 'm_sample2', name: 'Day 60: First joint opportunity', targetDate: day(60), criteria: 'At least one opportunity worked together', achievedDate: null },
      { id: 'm_sample3', name: 'Day 90: First business review', targetDate: day(90), criteria: 'Results reviewed against both sides’ objectives', achievedDate: null },
    ],
    activities: [
      activity('a_sample1', 'Kickoff with both executive sponsors', 'other', 'joint', 'p_sample1', 5, 'done', 4, 'm_sample1', 4, 'Anna Keller'),
      activity('a_sample2', 'Sales enablement session for Brightwave sellers', 'sales', 'us', 'p_sample1', 14, 'done', 15, 'm_sample1', 15, 'Anna Keller'),
      activity('a_sample3', 'Set up portal and deal registration access', 'product', 'us', 'p_sample1', 10, 'done', 9, 'm_sample1', 9, 'Anna Keller'),
      activity('a_sample4', 'Load our price list into the Brightwave quoting tool', 'product', 'partner', 'p_sample3', 20, 'blocked', null, 'm_sample2', 22, 'Priya Shah', 'Waiting for an API key from Brightwave IT'),
      activity('a_sample5', 'Publish a joint announcement', 'marketing', 'joint', 'p_sample3', 30, 'done', 33, 'm_sample2', 33, 'Priya Shah'),
      activity('a_sample6', 'Identify 10 target accounts for co-selling', 'sales', 'partner', 'p_sample5', 40, 'in_progress', null, 'm_sample2', 32, 'Lena Ortiz'),
      activity('a_sample7', 'Register the first joint opportunity', 'sales', 'partner', 'p_sample5', 45, 'not_started', null, 'm_sample2', 0, 'Anna Keller'),
      activity('a_sample8', 'Joint webinar for the target accounts', 'marketing', 'joint', 'p_sample3', 60, 'not_started', null, 'm_sample3', 0, 'Anna Keller'),
      activity('a_sample9', 'Prepare the first business review', 'other', 'us', 'p_sample1', 88, 'not_started', null, 'm_sample3', 0, 'Anna Keller'),
    ],
    exitTriggers: [
      { id: 'x_sample1', condition: 'No qualified opportunity registered within 90 days', status: 'ok' },
      { id: 'x_sample2', condition: 'The named sales lead leaves and is not replaced within 30 days', status: 'ok' },
    ],
    reviews: [],
    reviewNumbers: [],
    reviewItems: [],
  };
}

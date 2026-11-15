import { categoryOf, type PartnerCategory, type PartnerType } from '../partner-types';
import { horizonDayDate } from './dates';

type IsoDate = string;
/** A suggested milestone, as core's MAP domain names one without its id. */
export interface SuggestedMilestone { name: string; targetDate: IsoDate; criteria: string; achievedDate: null }

export interface ExampleObjectives { us: string[]; partner: string[] }

/** Two objectives per side for each category, plus a set for Other. A type without its own set below uses its category's. */
const BY_SET: Record<PartnerCategory | 'other', ExampleObjectives> = {
  product: {
    us: ['Launch the integration and get 10 shared customers using it', 'Influence 15 opportunities with the integration'],
    partner: ['Reduce churn among shared customers', 'Get listed in the marketplace with joint marketing'],
  },
  channel: {
    us: ['Co-sell 10 opportunities with the partner’s sellers this quarter', 'Close three deals sold together with the partner'],
    partner: ['Grow deal size by selling a more complete offer', 'Win two competitive deals with the joint offer'],
  },
  marketing: {
    us: ['Generate 200 qualified leads from joint content this quarter', 'Publish four joint pieces of content within 90 days'],
    partner: ['Reach a new audience with co-branded content', 'Grow its own subscriber base by 10%'],
  },
  service: {
    us: ['Partner runs 10 customer accounts to our service levels', 'Keep the renewal rate of partner-run customers above 90%'],
    partner: ['Build recurring revenue from services around the product', 'Add a product in demand to its service portfolio'],
  },
  other: {
    us: ['Agree on one measurable shared goal', 'Complete the first joint activity within 30 days'],
    partner: ['See clear value from the partnership within 90 days', 'Named owners for every committed activity'],
  },
};

const TWO_TIER: ExampleObjectives = {
  us: ['Recruit 10 active resellers through the distributor within 90 days', 'Build 500k in pipeline through the distributor’s resellers'],
  partner: ['Add a product line its resellers ask for', 'Reach the committed volume target this year'],
};

/** Types whose goals genuinely differ from their category's. */
const BY_TYPE: Partial<Record<PartnerType, ExampleObjectives>> = {
  data: {
    us: ['Launch the data feed and get 10 customers using the enriched product', 'Ship two features built on the partner’s data'],
    partner: ['Reach a new customer segment for its data', 'Grow data revenue through our customer base'],
  },
  integration: {
    us: ['Publish the connector and get 25 customers using it', 'Halve setup time for connected customers'],
    partner: ['Add a connector its customers ask for', 'Grow platform usage among shared customers'],
  },
  referral: {
    us: ['Receive 20 qualified referrals this quarter', 'Close four referred deals'],
    partner: ['Earn referral revenue without extra sales overhead', 'Offer customers a trusted answer to a gap in our portfolio'],
  },
  reseller: {
    us: ['Build 250k in partner-sourced pipeline within 90 days', 'Five partner sellers certified and actively selling'],
    partner: ['Add a product line that grows average deal size', 'Win three new customers with the joint offer'],
  },
  distributor: TWO_TIER,
  vad: TWO_TIER,
  oem: {
    us: ['Ship the embedded version in the partner’s next release', 'Reach the committed number of licensed end users this year'],
    partner: ['Launch a new capability without building it', 'Win more deals with a stronger product'],
  },
  var: {
    us: ['Partner wins five deals that include its own services', 'Two partner consultants certified on the product'],
    partner: ['Grow services revenue around the product', 'Raise deal size with a complete, value-added offer'],
  },
  broker: {
    us: ['Receive 15 qualified introductions this quarter', 'Close three deals from broker introductions'],
    partner: ['Earn commission on every deal it introduces', 'Give its network a trusted product to recommend'],
  },
  affiliate: {
    us: ['Drive 2,000 visits and 50 sign-ups from affiliate links', 'Keep cost per acquisition under 150 per new customer'],
    partner: ['Earn steady commission from its audience', 'Recommend a product its audience values'],
  },
  ambassador: {
    us: ['Surface three customer stories through the ambassador', 'Reach 50k people through ambassador posts and talks'],
    partner: ['Preview two upcoming features each quarter', 'Build credibility as an expert in the field'],
  },
  fulfillment: {
    us: ['Cut time from order to activation to under five days', 'Activate 20 customers through the partner this quarter'],
    partner: ['Add revenue from provisioning and activation', 'Run activations with clear handoffs and no escalations'],
  },
  solution: {
    us: ['Launch one packaged solution that includes the product', 'Win three deals with the joint solution'],
    partner: ['Offer an end-to-end solution its clients ask for', 'Grow consulting revenue around the bundled solution'],
  },
  'system-integrator': {
    us: ['Partner delivers three implementations to our quality standard', 'Grow certified implementation capacity in the region'],
    partner: ['Build a services practice around the platform', 'Win two projects that include the platform'],
  },
};

export function exampleObjectives(type: PartnerType): ExampleObjectives {
  return BY_TYPE[type] ?? BY_SET[categoryOf(type) ?? 'other'];
}

export const EXAMPLE_EXIT_TRIGGERS: string[] = [
  'No qualified opportunity registered within 90 days',
  'The named sales lead leaves and is not replaced within 30 days',
  'Committed activities stay overdue for more than 30 days',
  'The partner starts promoting a directly competing product',
];

export const MOMENTUM_NEXT_STEPS: string[] = [
  'Book a check-in with both executive sponsors',
  'Pick one overdue activity and agree a new date together',
  'Ask the partner what is blocking them, then remove one blocker',
  'Revisit the objectives: are they still what both sides want?',
];

/** The first horizon's check-ins. Day 1 is the start date, so day 90 is a 90-day horizon's last day. */
export function suggestedMilestones(startDate: IsoDate): SuggestedMilestone[] {
  return [
    { name: 'Day 30: Partner enabled', targetDate: horizonDayDate(startDate, 30), criteria: 'Sellers trained and tools access live', achievedDate: null },
    { name: 'Day 60: First joint opportunity', targetDate: horizonDayDate(startDate, 60), criteria: 'At least one opportunity worked together', achievedDate: null },
    { name: 'Day 90: First business review', targetDate: horizonDayDate(startDate, 90), criteria: 'Results reviewed against both sides’ objectives', achievedDate: null },
  ];
}

export interface HorizonMilestoneSuggestion {
  name: string;
  criteria: string;
  /** The horizon's day it falls on: day 1 is the start date. */
  day: number;
  targetDate: IsoDate;
}

/** Days between check-ins within a horizon, and the last day one is suggested on. */
const CHECK_IN_EVERY = 30;
const LAST_CHECK_IN = 120;

/**
 * The milestones a later horizon starts with: check-ins on days 30, 60, 90 and 120 that fall inside it, then the
 * business review on its last day (the end date the header shows).
 * Each name carries the horizon's number, so it never repeats an earlier horizon's (the sheet links milestones by name).
 */
export function horizonMilestones({ startDate, horizonDays, horizon }: { startDate: IsoDate; horizonDays: number; horizon: number }): HorizonMilestoneSuggestion[] {
  const checkIns: HorizonMilestoneSuggestion[] = [];
  for (let day = CHECK_IN_EVERY; day < horizonDays && day <= LAST_CHECK_IN; day += CHECK_IN_EVERY) {
    checkIns.push({ name: `Horizon ${horizon}: Day ${day} check-in`, criteria: 'Progress reviewed with both sides', day, targetDate: horizonDayDate(startDate, day) });
  }
  return [
    ...checkIns,
    { name: `Horizon ${horizon}: Business review`, criteria: 'Results reviewed against both sides’ objectives', day: horizonDays, targetDate: horizonDayDate(startDate, horizonDays) },
  ];
}

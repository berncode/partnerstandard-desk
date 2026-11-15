import { categoryOf, type PartnerCategory, type PartnerType } from '../partner-types';
import type { Stage } from '../stages';

/** An activity's category and side, as core's MAP domain names them (core checks that the two stay the same). */
export type StarterCategory = 'sales' | 'marketing' | 'product' | 'other';
export type StarterSide = 'us' | 'partner' | 'joint';
type Category = StarterCategory;
type ActivitySide = StarterSide;

export interface StarterActivity {
  title: string;
  category: Category;
  side: ActivitySide;
}

const s = (title: string, category: Category, side: ActivitySide): StarterActivity => ({ title, category, side });

const ONBOARDING: StarterActivity[] = [
  s('Kickoff with both executive sponsors', 'other', 'joint'),
  s('Sales enablement session for partner sellers', 'sales', 'us'),
  s('Set up portal and deal registration access', 'product', 'us'),
  s('Register the first joint opportunity', 'sales', 'partner'),
  s('Publish a joint announcement', 'marketing', 'joint'),
];

/**
 * The MAP is agreed before the agreement is signed, and the MAP made in recruitment is the onboarding plan, carried
 * into onboarding unchanged. So recruitment suggests what to agree before signing, then the onboarding starters.
 */
const RECRUITMENT: StarterActivity[] = [
  s('Agree on seller activation targets', 'sales', 'joint'),
  s('Agree on the training plan', 'sales', 'joint'),
  s('Plan the launch marketing', 'marketing', 'joint'),
  s('Name the partner’s sales and marketing leads', 'other', 'partner'),
  s('Discuss exit triggers and what we do not want', 'other', 'joint'),
  s('Sign the partnership agreement', 'other', 'joint'),
];

const BY_STAGE: Record<Stage, StarterActivity[]> = {
  recruitment: [...RECRUITMENT, ...ONBOARDING],
  onboarding: ONBOARDING,
  growth: [
    s('Monthly pipeline review', 'sales', 'joint'),
    s('Run a joint webinar or customer event', 'marketing', 'joint'),
    s('Identify 10 target accounts for co-selling', 'sales', 'partner'),
    s('Share a customer success story', 'marketing', 'partner'),
  ],
  expansion: [
    s('Identify new regions, segments or products', 'sales', 'joint'),
    s('Enable an additional partner team', 'sales', 'us'),
    s('Plan a joint campaign for the new segment', 'marketing', 'joint'),
    s('Update commercial terms for the expanded scope', 'sales', 'us'),
  ],
  exit: [
    s('Agree on the transition plan for shared customers', 'sales', 'joint'),
    s('Hand over open opportunities and support cases', 'sales', 'joint'),
    s('Remove portal access and update listings', 'product', 'us'),
    s('Hold a closing review and capture lessons learned', 'other', 'joint'),
  ],
};

/** The business review at the end of each horizon, whatever the stage (it used to be the Evaluation stage's starters). */
const REVIEW: StarterActivity[] = [
  s('Prepare the business review', 'other', 'us'),
  s('Review results against both sides’ objectives', 'other', 'joint'),
  s('Collect partner feedback on the program', 'other', 'us'),
  s('Agree on adjustments for the next horizon', 'other', 'joint'),
];

/** Suggested when a horizon is about to end or has ended. */
export function reviewActivities(): StarterActivity[] {
  return REVIEW;
}

type StarterSet = PartnerCategory | 'other';

/** Two starters per category, plus a set for Other. A type without its own set below uses its category's. */
const BY_SET: Record<StarterSet, StarterActivity[]> = {
  product: [s('Scope and build the integration', 'product', 'joint'), s('List the integration on both marketplaces', 'marketing', 'joint')],
  channel: [s('Agree on deal registration and channel conflict rules', 'sales', 'joint'), s('Map overlapping accounts and pick joint targets', 'sales', 'joint')],
  marketing: [s('Agree on the joint content and campaign calendar', 'marketing', 'joint'), s('Set up lead tracking for joint campaigns', 'marketing', 'us')],
  service: [s('Agree on the service scope, handoffs and escalation path', 'other', 'joint'), s('Train the partner’s team to deploy and support the product', 'product', 'us')],
  other: [s('Agree on how we will measure success', 'other', 'joint'), s('Schedule a monthly check-in', 'other', 'joint')],
};

const TWO_TIER: StarterActivity[] = [
  s('Agree on two-tier pricing, stock and payment terms', 'sales', 'us'),
  s('Recruit the first five resellers through the distributor', 'sales', 'partner'),
];

/** Types whose work genuinely differs from their category's. */
const BY_TYPE: Partial<Record<PartnerType, StarterActivity[]>> = {
  data: [s('Agree on the data feed, format and refresh schedule', 'product', 'joint'), s('Sign the data usage agreement', 'other', 'joint')],
  integration: [s('Build and certify the connector on the partner’s platform', 'product', 'joint'), s('Publish the connector in the partner’s app directory', 'marketing', 'partner')],
  referral: [s('Agree on the referral process and fee', 'sales', 'us'), s('Share the referral link and lead form', 'marketing', 'us')],
  reseller: [s('Agree on pricing and margin structure', 'sales', 'us'), s('Train the partner on quoting and ordering', 'sales', 'us')],
  distributor: TWO_TIER,
  vad: TWO_TIER,
  oem: [s('Agree on embedding, branding and licensing terms', 'product', 'joint'), s('Define who supports customers of the embedded product', 'other', 'joint')],
  var: [s('Agree on the services the partner adds to the offer', 'sales', 'joint'), s('Certify the partner’s technical team', 'product', 'us')],
  broker: [s('Agree on the introduction process and commission', 'sales', 'us'), s('Share the ideal customer profile and qualification criteria', 'sales', 'us')],
  affiliate: [s('Set up tracking links and the commission plan', 'marketing', 'us'), s('Share approved creatives and messaging', 'marketing', 'us')],
  ambassador: [s('Agree on ambassador perks and disclosure rules', 'marketing', 'us'), s('Brief the ambassador on messaging and customer stories', 'marketing', 'us')],
  fulfillment: [s('Agree on the provisioning and activation process', 'product', 'joint'), s('Give the partner provisioning access', 'product', 'us')],
  solution: [s('Define the joint solution package and pricing', 'sales', 'joint'), s('Train the partner on configuring and extending the product', 'product', 'us')],
  'system-integrator': [s('Certify the partner’s delivery team', 'product', 'us'), s('Define a joint implementation methodology', 'product', 'joint')],
};

/** The type's own starters, or its category's (Other's for Other). */
export function typeStarters(type: PartnerType): StarterActivity[] {
  return BY_TYPE[type] ?? BY_SET[categoryOf(type) ?? 'other'];
}

/** Stage starters first, then type-specific extras. */
export function starterActivities(type: PartnerType, stage: Stage): StarterActivity[] {
  return [...BY_STAGE[stage], ...typeStarters(type)];
}

// PartnerStandard Desk's names where the Business Case app's clash (BusinessCase, CaseType, CaseRates, CaseOffer,
// CaseSource, CASE_BENEFITS). The partner and its stage are on the case, and there is no standard offer.
import type { PartnerType, Stage } from '@partner-desk/method';
import type { IsoDateTime } from '../partners/types';
import type { Currency } from '../programs/types';

export type { Currency };
export type EarningsWord = 'margin' | 'commission' | 'referral fee';
export type Scenario = 'careful' | 'expected' | 'ambitious';
export type Tier = 'registered' | 'preferred';

/** Where a figure comes from. */
export type CaseSource = 'assumption' | 'finance' | 'sales' | 'partner' | 'other';
export const CASE_SOURCES: readonly CaseSource[] = ['assumption', 'finance', 'sales', 'partner', 'other'];

export interface ProductLine {
  id: string;
  name: string;
  paid: 'yearly' | 'once';
  price: number;
  per: 'user' | 'site' | 'account';
  amount: number;
}

/** Percent, 0 to 100. */
export interface CaseRates {
  first: number;
  renewal: number;
  once: number;
  /** The vendor's share of the partner's service revenue (implementation, managed service, other sales). */
  servicesShare: number;
}

/** Level 1 is first-line support, level12 is first and second line. */
export type Support = 'none' | 'level1' | 'level12';

export interface Roles {
  /** Percent of the lead the partner brings, 0 to 100. */
  lead: number;
  closes: boolean;
  support: Support;
  services: boolean;
}

export interface CaseType {
  id: string;
  name: string;
  roles: Roles;
  registered: CaseRates;
  preferred: CaseRates;
  /** What the partner pays the vendor every year, such as a program or partner license fee. */
  fee: number;
}

export type PreferredRule = 'deals' | 'revenue' | 'year';

export interface PreferredConditions {
  on: boolean;
  rule: PreferredRule;
  deals: number;
  revenue: number;
  year: 2 | 3 | 4 | 5;
}

export interface CaseOffer {
  company: string;
  currency: Currency;
  renewal: number;
  preferred: PreferredConditions;
  products: ProductLine[];
  /** Always exactly one: the partner type this case is for. Its id is the case's `typeId`. */
  types: CaseType[];
  /** The two level names, as the program calls them. */
  levels: { registered: string; preferred: string };
}

export interface CostLine {
  id: string;
  name: string;
  when: 'start' | 'yearly' | 'preferred';
  amount: number;
}

export interface OurCostLine extends CostLine {
  source: CaseSource;
}

export interface Serve {
  find: number;
  close: number;
  salesSource: CaseSource;
  support1: number;
  support2: number;
  supportSource: CaseSource;
  servicesCost: number;
  servicesCharge: number;
  servicesSource: CaseSource;
}

export interface Figures {
  margin: number;
  marginSource: CaseSource;
  serve: Serve;
}

export interface Reason {
  on: boolean;
  mode: 'simple' | 'detailed';
  /** Year the effect starts, 1 to 5. */
  from: 1 | 2 | 3 | 4 | 5;
  source: CaseSource;
  note: string;
  alone: boolean;
  simple: number;
}

export interface Efficiency extends Reason {
  hours: number;
  rate: number;
}

export interface Churn extends Reason {
  customers: number;
  revenue: number;
  now: number;
  withPartner: number;
}

export interface StrategicReason {
  id: string;
  text: string;
  weight: 'high' | 'medium' | 'low';
  alone: boolean;
}

export interface Alone {
  mode: 'simple' | 'detailed';
  share: number;
  delay: number;
  setup: number;
  fixed: number;
  source: CaseSource;
  /** Deals per year, years 1 to 5. */
  deals: [number, number, number, number, number];
  costs: OurCostLine[];
}

export interface Risk {
  amount: number;
  from: 1 | 2 | 3 | 4 | 5;
  source: CaseSource;
  why: string;
}

/** Our side of the case, internal only. */
export interface OurCase {
  figures: Figures;
  costs: OurCostLine[];
  anyway: number;
  anywaySource: CaseSource;
  dealsSource: CaseSource;
  efficiency: Efficiency;
  churn: Churn;
  strategic: StrategicReason[];
  alone: Alone;
  risk: Risk;
  recommendation: string;
  ask: string;
  preparedBy: string;
}

/** A term the case could not take from the program, so it says so (spec section 5.2). */
export type TermNote = 'flat-fee' | 'contract-years' | 'bars' | 'pref-req' | 'no-program' | 'no-program-type';
export const TERM_NOTES: readonly TermNote[] = ['flat-fee', 'contract-years', 'bars', 'pref-req', 'no-program', 'no-program-type'];

export interface BusinessCase {
  id: string;
  companyId: string;
  /** The partner type's row id in Partners. */
  partnerId: string;
  /** PartnerStandard Desk's partner type; fixed for the case. */
  partnerType: PartnerType;
  programId: string | null;
  title: string;
  createdAt: IsoDateTime;
  /** The partner type's stage on the day the case was made. */
  stageWhenMade: Stage;
  recalculatedAt: IsoDateTime | null;
  notes: TermNote[];
  partner: string;
  typeId: string;
  startsAs: Tier;
  deals: [number, number, number, number, number];
  scenario: Scenario;
  implementation: number;
  managed: number;
  other: number;
  serviceProfit: number;
  supportCost: number;
  costs: CostLine[];
  benefits: string[];
  offer: CaseOffer;
  ours: OurCase;
  shared: { sharedAt: string } | null;
  updatedAt: string;
}

/** Margin when the partner closes, else referral fee when it provides services, else commission. */
export function earningsWord(roles: Roles): EarningsWord {
  if (roles.closes) return 'margin';
  return roles.services ? 'referral fee' : 'commission';
}

/** Share of the lead the partner keeps, 0 to 1. */
export function leadShare(roles: Roles): number {
  return !roles.closes && roles.services ? roles.lead / 100 : 1;
}

export const CASE_BENEFITS = [
  'New customers',
  'Stronger offering',
  'Faster time to market',
  'Recurring revenue',
  'Market credibility',
  'Sales and technical training',
  'Leads from the vendor',
  'Co-marketing budget',
] as const;

export const SCENARIO_FACTOR: Record<Scenario, number> = {
  careful: 0.6,
  expected: 1,
  ambitious: 1.4,
};

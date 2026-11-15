import type { RecruitmentPartnerType } from '@partner-desk/method';
import type { IsoDate, IsoDateTime } from '../partners/types';

export const MARKET_STATUSES = ['open', 'validated', 'partly_validated', 'invalidated'] as const;
export const HOW_MARKET_BUYS = ['customer_first', 'capability_first', 'unknown'] as const;
export const VALUE_KINDS = ['margin_or_fees', 'services_revenue', 'portfolio', 'non_financial'] as const;
export const VALUE_STATES = ['assumption', 'confirmed', 'dropped'] as const;
export const HYPOTHESIS_STATUSES = ['draft', 'holds', 'dropped'] as const;
export const CHANGE_ENTITIES = ['market', 'value_point', 'hypothesis'] as const;

export type MarketStatus = (typeof MARKET_STATUSES)[number];
export type HowMarketBuys = (typeof HOW_MARKET_BUYS)[number];
export type ValueKind = (typeof VALUE_KINDS)[number];
export type ValueState = (typeof VALUE_STATES)[number];
export type HypothesisStatus = (typeof HYPOTHESIS_STATUSES)[number];
export type ChangeEntity = (typeof CHANGE_ENTITIES)[number];

export interface MarketInfo {
  marketId: string;
  companyId: string;
  marketName: string;
  partnerType: RecruitmentPartnerType;
  ourProduct: string;
  ourTargetCustomers: string;
  whyPartnerRoute: string;
  mustHaves: string[];
  howMarketBuys: HowMarketBuys;
  howMarketBuysNote: string;
  statement: string;
  expectedCandidates: number | null;
  status: MarketStatus;
  statusNote: string;
  copiedFrom: string | null;
  /** The program this market's partners join when signed (a program file's id). Commands check its type. */
  feedsProgramId: string | null;
  checkAgain: MarketField[];
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}
export type MarketField = Exclude<
  keyof MarketInfo,
  'marketId' | 'companyId' | 'checkAgain' | 'updatedAt' | 'updatedBy' | 'copiedFrom' | 'feedsProgramId'
>;

export interface ValuePoint {
  id: string;
  kind: ValueKind;
  text: string;
  state: ValueState;
  evidence: string;
  checkAgain: boolean;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface Hypothesis {
  id: string;
  name: string;
  theirSide: string;
  theirEvidence: string;
  ourSide: string;
  ourEvidence: string;
  valuePointIds: string[];
  lookalike: string;
  status: HypothesisStatus;
  checkAgain: boolean;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface Exclusion {
  id: string;
  company: string;
  website: string;
  reason: string;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface Change {
  id: string;
  date: IsoDate;
  entity: ChangeEntity;
  entityId: string;
  what: string;
  callId: string | null;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface Market {
  info: MarketInfo;
  valuePoints: ValuePoint[];
  hypotheses: Hypothesis[];
  exclusions: Exclusion[];
  changes: Change[];
}

export type MarketEntity = 'valuePoint' | 'hypothesis' | 'exclusion' | 'change';

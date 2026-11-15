export type Currency = 'EUR' | 'USD' | 'GBP' | 'CHF';
/** The partner types a program can be for: PartnerStandard Desk's types that Program Designer covers. */
export type ProgramType =
  | 'referral' | 'co-seller' | 'broker'
  | 'reseller' | 'var' | 'distributor' | 'vad'
  | 'managed' | 'fulfillment' | 'solution' | 'system-integrator'
  | 'affiliate' | 'content' | 'ambassador';
/** Partner types Program Designer does not cover, and why (`OUT`). */
export type OutKey = 'oem' | 'technology' | 'data' | 'integration' | 'other';
export type Kind = 'referral' | 'resale' | 'services' | 'affiliate' | 'reward';
export type Model = 'commission' | 'margin' | 'fee' | 'none';
export type Pattern = 'oneoff' | 'lifetime';
export type Base = 'year' | 'contract';
export type Payout = 'customer' | 'month' | 'quarter';
export type Level = 'reg' | 'pref';
/** A program's two levels: Registered, the starting level, and Preferred. */
export const LEVELS = ['reg', 'pref'] as const satisfies readonly Level[];
export type BenefitGroup = 'Selling' | 'Marketing' | 'Product and training' | 'Support';

export interface Rules {
  protect: number;
  extend: number;
  answer: number;
  conflict: 'first' | 'case';
  paidInFull: boolean;
  ownerNote: string;
  handover: string;
}

import type { Figures, OurCostLine } from '../cases/types';

/** `null` for spend and revenue means "not known". The company's name lives in Settings, not here. */
export interface CompanyFacts {
  id: string;
  currency: Currency;
  yearly: number;
  once: number;
  renew: number;
  spend: number | null;
  revenue: number | null;
  rules: Rules;
  /** Our figures for business cases (internal): copied into every new case. */
  ours: { figures: Figures; costs: OurCostLine[] };
  updatedAt: string;
}

/** `k` is `own_` plus 8 characters. */
export interface OwnBenefit {
  k: string;
  g: BenefitGroup;
  n: string;
}

export interface Bar {
  label: string;
  value: number;
  unit: string;
}

export interface PrefReq {
  certified: { on: boolean; people: number };
  contact: boolean;
  register: boolean;
  pipeline: boolean;
  qbr: boolean;
  brand: boolean;
}

/** First sale, renewal, once; percent. */
export type Rates = [number, number, number];

export interface Money {
  model: Model;
  rates: Record<Level, Rates>;
  fee: Record<Level, number>;
  pattern: Pattern;
  base: Base;
  years: number;
  payout: Payout;
  payDays: number;
  rewards: string;
}

export interface Running {
  manager: number;
  funds: number;
  training: number;
  deals: number;
}

export interface Program {
  id: string;
  companyId: string;
  type: ProgramType;
  name: string;
  focus: string;
  lead: string;
  goals: string;
  description: string;
  ipp: string;
  icp: string;
  kpis: string;
  enablement: string;
  tools: string;
  regName: string;
  prefName: string;
  prefOn: boolean;
  reg: string[];
  pref: string[];
  own: OwnBenefit[];
  entry: string[];
  prefReq: PrefReq;
  why: string[];
  bars: Bar[];
  notice: number;
  plan: boolean;
  pilots: string;
  /** YYYY-MM-DD or '' */
  publish: string;
  money: Money;
  run: Running;
  updatedAt: string;
}

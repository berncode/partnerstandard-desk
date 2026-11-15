import type {
  CasoLetter,
  FourC,
  PartnerType,
  RecruitmentStep,
  Stage,
  Topic,
} from '@partner-desk/method';
import type { Health } from '../maps/derived';
import type { Level } from '../programs/types';
import type { ProposalItem } from '../proposals/types';

export type IsoDate = string;
export type IsoDateTime = string;

export const TARGET_CUSTOMER_TYPES = ['enterprise', 'smb', 'unknown'] as const;
/** The health values a MAP gives (`Health`), as a list for the partner schema. */
export const MAP_HEALTHS = ['on_track', 'at_risk', 'off_track'] as const satisfies readonly Health[];
export const CLOSED_AS = ['not_now', 'no'] as const;
export const SOURCES = ['research', 'ai_search', 'competitor_of', 'existing_partner'] as const;
export const PERSON_ROLES = ['contact', 'sponsor', 'seller'] as const;
export const CALL_KINDS = ['discovery', 'follow_up'] as const;
export const CASO_ANSWERS = ['yes', 'partly', 'no'] as const;

export type TargetCustomerType = (typeof TARGET_CUSTOMER_TYPES)[number];
export type ClosedAs = (typeof CLOSED_AS)[number];
export type Source = (typeof SOURCES)[number];
export type PersonRole = (typeof PERSON_ROLES)[number];
export type CallKind = (typeof CALL_KINDS)[number];
export type CasoAnswer = (typeof CASO_ANSWERS)[number];

export type Score = 0 | 1 | 2 | 3;
export type Scores = Record<FourC, Score | null>;

/** A partner company: its facts, entered once. Its people hang off it; its sections are the Partner rows. */
export interface PartnerAccount {
  id: string;
  company: string;
  website: string;
  country: string;
  vertical: string;
  subVertical: string;
  targetCustomerType: TargetCustomerType;
  comments: string;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

/** The company facts a person sets on an account. */
export const ACCOUNT_FIELDS = ['company', 'website', 'country', 'vertical', 'subVertical', 'targetCustomerType', 'comments'] as const;
export type AccountFields = Pick<PartnerAccount, (typeof ACCOUNT_FIELDS)[number]>;

/**
 * One section of an account: the company as one partner type. Its type and account are set when it is added and never
 * change; an account has at most one section per type. `companyId` is the vendor company (the user's own), not the partner.
 */
export interface Partner {
  id: string;
  companyId: string;
  accountId: string;
  partnerType: PartnerType;
  stage: Stage;
  step: RecruitmentStep | null;
  closed: ClosedAs | null;
  closedReason: string;
  signedDate: IsoDate | null;
  exitedDate: IsoDate | null;
  exitReason: string;
  source: Source;
  sourceDetail: string;
  whyItFits: string;
  desk: Scores;
  confirmed: Scores;
  mapFilled: boolean;
  mapLink: string;
  /**
   * The program this partner type is in (a program file's id), and its level there (owner, 2026-10-29). A level
   * needs a program; a program without a level is the starting level (`levelOf`). Commands check the program.
   */
  programId: string | null;
  level: Level | null;
  /** What this partner type's MAP last said, kept here for the list (spec 5.7). Only the MAP commands write them. */
  mapHealth: Health | null;
  mapNextMilestone: IsoDate | null;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface MarketLink {
  id: string;
  partnerId: string;
  marketId: string;
  hypothesisId: string | null;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface Person {
  id: string;
  accountId: string;
  name: string;
  title: string;
  email: string | null;
  role: PersonRole;
  activeSeller: boolean;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface Call {
  id: string;
  partnerId: string;
  date: IsoDate;
  kind: CallKind;
  topics: Record<Topic, string>;
  notes: string;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

export interface Qualification {
  id: string;
  partnerId: string;
  deskNotes: Record<FourC, string>;
  confirmedNotes: Record<FourC, string>;
  q1Overlap: string;
  q2DealFit: string;
  q4MapAgreed: string;
  caso: Record<CasoLetter, { answer: CasoAnswer | null; note: string }>;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

/** One company's partner book. */
export interface PartnerBook {
  companyId: string;
  accounts: PartnerAccount[];
  partners: Partner[];
  people: Person[];
  calls: Call[];
  qualifications: Qualification[];
  marketLinks: MarketLink[];
  /** What agents proposed and the person's answers: the Proposals tab (spec 7.1). Only the proposals commands write it. */
  proposalItems: ProposalItem[];
}

export type PartnerEntity = 'account' | 'partner' | 'person' | 'call' | 'qualification' | 'marketLink' | 'proposalItem';

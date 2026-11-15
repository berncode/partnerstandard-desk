import { z } from 'zod';
import { RECRUITMENT_PARTNER_TYPES } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import {
  idSchema, isoDateSchema, required, text, TEXT_MAX, TOO_LONG, updatedAtSchema, updatedBySchema,
} from '../shared/schemas';
import {
  CHANGE_ENTITIES, HOW_MARKET_BUYS, HYPOTHESIS_STATUSES, MARKET_STATUSES, VALUE_KINDS, VALUE_STATES,
  type Change, type Exclusion, type Hypothesis, type MarketEntity, type MarketField, type MarketInfo, type ValuePoint,
} from './types';

export const MAX_VALUE_POINTS_PER_HYPOTHESIS = 4;
/** A new market's first partners, typed in the guided flow; more come in with the AI import. */
export const MAX_FIRST_CANDIDATES = 20;

const FIELD_FLAGS: Record<MarketField, true> = {
  marketName: true, partnerType: true, ourProduct: true, ourTargetCustomers: true, whyPartnerRoute: true,
  mustHaves: true, howMarketBuys: true, howMarketBuysNote: true, statement: true, expectedCandidates: true,
  status: true, statusNote: true,
};
/** The market fields a "check again" flag can sit on. */
export const MARKET_FIELD_NAMES = Object.keys(FIELD_FLAGS) as [MarketField, ...MarketField[]];

/** Market fields the server sets or that say which market this is; a change never carries them. */
export const MARKET_INFO_FIXED = ['marketId', 'companyId', 'copiedFrom', 'updatedAt', 'updatedBy'] as const;

export const marketInfoSchema = z.object({
  marketId: idSchema,
  companyId: idSchema,
  marketName: required('Market'),
  partnerType: z.enum(RECRUITMENT_PARTNER_TYPES),
  ourProduct: required('Our product'),
  ourTargetCustomers: required('Our target customers'),
  whyPartnerRoute: text,
  // The list is one sheet cell, one line per item.
  mustHaves: z.array(z.string()).refine((items) => items.join('\n').length <= TEXT_MAX, TOO_LONG),
  howMarketBuys: z.enum(HOW_MARKET_BUYS),
  howMarketBuysNote: text,
  statement: text,
  expectedCandidates: z.number().int().min(0, COPY.NOT_NEGATIVE).nullable(),
  status: z.enum(MARKET_STATUSES),
  statusNote: text,
  copiedFrom: text.nullable(),
  feedsProgramId: idSchema.nullable(),
  checkAgain: z.array(z.enum(MARKET_FIELD_NAMES)),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<MarketInfo>;

export const valuePointSchema = z.object({
  id: idSchema,
  kind: z.enum(VALUE_KINDS),
  text: required('Value point'),
  state: z.enum(VALUE_STATES),
  evidence: text,
  checkAgain: z.boolean(),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<ValuePoint>;

export const hypothesisSchema = z.object({
  id: idSchema,
  name: required('Name'),
  theirSide: text,
  theirEvidence: text,
  ourSide: text,
  ourEvidence: text,
  valuePointIds: z.array(idSchema).max(MAX_VALUE_POINTS_PER_HYPOTHESIS, COPY.MAX_VALUE_POINTS),
  lookalike: text,
  status: z.enum(HYPOTHESIS_STATUSES),
  checkAgain: z.boolean(),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<Hypothesis>;

export const exclusionSchema = z.object({
  id: idSchema,
  company: required('Company'),
  website: text,
  reason: text,
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<Exclusion>;

export const changeSchema = z.object({
  id: idSchema,
  date: isoDateSchema,
  entity: z.enum(CHANGE_ENTITIES),
  entityId: text,
  what: required('What changed'),
  callId: idSchema.nullable(),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<Change>;

export const MARKET_ENTITY_SCHEMAS = {
  valuePoint: valuePointSchema,
  hypothesis: hypothesisSchema,
  exclusion: exclusionSchema,
  change: changeSchema,
} satisfies Record<MarketEntity, z.ZodType>;

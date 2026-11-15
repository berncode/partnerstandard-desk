import { z } from 'zod';
import {
  CASO_LETTERS,
  FOUR_C,
  PARTNER_TYPES,
  RECRUITMENT_STEPS,
  STAGES,
  TOPICS,
} from '@partner-desk/method';
import {
  COPY,
} from '@partner-desk/copy';
import {
  fieldsOf, idSchema, isoDateSchema, required, scoresSchema, text, updatedAtSchema, updatedBySchema,
} from '../shared/schemas';
import { LEVELS } from '../programs/types';
import { PROPOSAL_FIELDS, PROPOSAL_ITEM_STATUSES, PROPOSAL_KINDS, type ProposalItem } from '../proposals/types';
import {
  CALL_KINDS, CASO_ANSWERS, CLOSED_AS, MAP_HEALTHS, PERSON_ROLES, SOURCES, TARGET_CUSTOMER_TYPES,
  type Call, type MarketLink, type Partner, type PartnerAccount, type PartnerEntity, type Person, type Qualification,
} from './types';

export const accountSchema = z.object({
  id: idSchema,
  company: required('Company'),
  website: text,
  country: text,
  vertical: text,
  subVertical: text,
  targetCustomerType: z.enum(TARGET_CUSTOMER_TYPES),
  comments: text,
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<PartnerAccount>;

export const partnerSchema = z
  .object({
    id: idSchema,
    companyId: idSchema,
    accountId: idSchema,
    partnerType: z.enum(PARTNER_TYPES),
    stage: z.enum(STAGES),
    step: z.enum(RECRUITMENT_STEPS).nullable(),
    closed: z.enum(CLOSED_AS).nullable(),
    closedReason: text,
    signedDate: isoDateSchema.nullable(),
    exitedDate: isoDateSchema.nullable(),
    exitReason: text,
    source: z.enum(SOURCES),
    sourceDetail: text,
    whyItFits: text,
    desk: scoresSchema,
    confirmed: scoresSchema,
    mapFilled: z.boolean(),
    mapLink: text,
    programId: idSchema.nullable(),
    level: z.enum(LEVELS).nullable(),
    mapHealth: z.enum(MAP_HEALTHS).nullable().default(null),
    mapNextMilestone: isoDateSchema.nullable().default(null),
    updatedAt: updatedAtSchema,
    updatedBy: updatedBySchema,
  })
  .superRefine((p, ctx) => {
    if (p.level !== null && p.programId === null) {
      ctx.addIssue({ code: 'custom', path: ['level'], message: COPY.LEVEL_NEEDS_PROGRAM });
    }
    if (p.step !== null && p.stage !== 'recruitment') {
      ctx.addIssue({ code: 'custom', path: ['step'], message: COPY.STEP_ONLY_IN_RECRUITMENT });
    }
    if (p.closed !== null && p.signedDate !== null) {
      ctx.addIssue({ code: 'custom', path: ['closed'], message: COPY.SIGNED_CANT_BE_CLOSED });
    }
    if (p.exitedDate !== null) {
      if (p.signedDate === null) {
        ctx.addIssue({ code: 'custom', path: ['exitedDate'], message: COPY.ONLY_SIGNED_CAN_EXIT });
      } else if (p.exitedDate < p.signedDate) {
        ctx.addIssue({ code: 'custom', path: ['exitedDate'], message: COPY.EXIT_DATE_BEFORE_SIGNING });
      }
    }
  }) satisfies z.ZodType<Partner>;

export const marketLinkSchema = z.object({
  id: idSchema,
  partnerId: idSchema,
  marketId: idSchema,
  hypothesisId: idSchema.nullable(),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<MarketLink>;

export const personSchema = z.object({
  id: idSchema,
  accountId: idSchema,
  name: required('Name'),
  title: text,
  email: z.email({ message: COPY.INVALID_EMAIL }).nullable(),
  role: z.enum(PERSON_ROLES),
  activeSeller: z.boolean(),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<Person>;

export const callSchema = z.object({
  id: idSchema,
  partnerId: idSchema,
  date: isoDateSchema,
  kind: z.enum(CALL_KINDS),
  topics: fieldsOf(TOPICS, text),
  notes: text,
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<Call>;

const fourCNotesSchema = fieldsOf(FOUR_C, text);

export const qualificationSchema = z.object({
  id: idSchema,
  partnerId: idSchema,
  deskNotes: fourCNotesSchema,
  confirmedNotes: fourCNotesSchema,
  q1Overlap: text,
  q2DealFit: text,
  q4MapAgreed: text,
  caso: fieldsOf(CASO_LETTERS, z.object({ answer: z.enum(CASO_ANSWERS).nullable(), note: text })),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<Qualification>;

/** A time the proposals commands set: an ISO timestamp, as `updatedAt` is. */
const timeSchema = z.string().min(1);

export const proposalItemSchema = z.object({
  id: idSchema,
  proposalId: idSchema,
  kind: z.enum(PROPOSAL_KINDS),
  accountId: idSchema.nullable(),
  partnerId: idSchema.nullable(),
  marketId: idSchema.nullable(),
  hypothesisId: idSchema.nullable(),
  about: text,
  what: z.enum(PROPOSAL_FIELDS),
  proposed: text,
  details: text,
  evidence: text,
  proposedBy: text,
  status: z.enum(PROPOSAL_ITEM_STATUSES),
  answerNote: text,
  proposedOn: timeSchema,
  answeredOn: timeSchema.nullable(),
  expiresOn: timeSchema,
  targetUpdated: timeSchema.nullable(),
  updatedAt: updatedAtSchema,
  updatedBy: updatedBySchema,
}) satisfies z.ZodType<ProposalItem>;

export const PARTNER_ENTITY_SCHEMAS = {
  account: accountSchema,
  partner: partnerSchema,
  person: personSchema,
  call: callSchema,
  qualification: qualificationSchema,
  marketLink: marketLinkSchema,
  proposalItem: proposalItemSchema,
} satisfies Record<PartnerEntity, z.ZodType>;

// Core's date, id and field-error helpers (the same rules and words), PartnerStandard Desk's partner types and stages,
// Map names where core's clash, and the stored MAP's info (`mapInfoSchema`).
import { z } from 'zod';
import { PARTNER_TYPES, STAGES } from '@partner-desk/method';
import { CLOSED_AS } from '../partners/types';
import { reviewItemSchema, reviewNumberSchema, reviewSchema } from '../reviews/schemas';
import { idSchema, isoDateSchema } from '../shared/schemas';
import { ACTIVITY_SIDES, ACTIVITY_STATUSES, CATEGORIES, EXIT_STATUSES, ROLES, SIDES, type EntityKind } from './types';

const nullableDate = isoDateSchema.nullable();

/** Stage values from before horizons, as an old draft or a stale page may send them. */
const OLD_STAGES: Record<string, string> = { evaluation: 'growth', recruiting: 'recruitment' };
/** A stage; an old value reads as the stage it became. */
export const stageSchema = z.preprocess((value) => (typeof value === 'string' && Object.hasOwn(OLD_STAGES, value) ? OLD_STAGES[value] : value), z.enum(STAGES));
export const horizonDaysSchema = z.number().int().min(7, 'Use at least 7 days').max(730, 'Use at most 730 days');
export const MAX_PAST_HORIZONS = 100;

export const pastHorizonSchema = z.object({
  startDate: isoDateSchema,
  horizonDays: horizonDaysSchema,
  stage: stageSchema,
});

export const planInfoSchema = z.object({
  partnerName: z.string().trim().min(1, 'Partner name is required').max(200),
  partnerType: z.enum(PARTNER_TYPES),
  stage: stageSchema,
  startDate: isoDateSchema,
  horizonDays: horizonDaysSchema,
  nextReviewDate: nullableDate,
  // Optional on input: drafts and plans from before horizons have no history.
  pastHorizons: z.array(pastHorizonSchema).max(MAX_PAST_HORIZONS, 'Keep at most 100 past horizons').default([]),
  // Optional on input too: plans from before a recruitment could end without signing have neither.
  closed: z.enum(CLOSED_AS).nullable().default(null),
  closedReason: z.string().max(1000).default(''),
});

export const laterHorizonSchema = z.object({
  startDate: isoDateSchema,
  horizonDays: horizonDaysSchema,
});

/** What a MAP file stores about the plan (spec 5.3). */
export const mapInfoSchema = z.object({
  partnerId: idSchema,
  partnerType: z.enum(PARTNER_TYPES),
  horizonDays: horizonDaysSchema,
  laterHorizons: z.array(laterHorizonSchema).max(MAX_PAST_HORIZONS, 'Keep at most 100 past horizons'),
  nextReviewDate: nullableDate,
});

export const objectiveSchema = z.object({
  id: idSchema,
  side: z.enum(SIDES),
  statement: z.string().trim().min(1, 'Objective is required').max(1000),
  successMeasure: z.string().max(1000),
});

/** The longest activity title the MAP keeps: a review's commitment becomes an activity, so closing checks it too. */
export const ACTIVITY_TITLE_MAX = 300;

export const activitySchema = z.object({
  id: idSchema,
  title: z.string().trim().min(1, 'Activity title is required').max(ACTIVITY_TITLE_MAX),
  category: z.enum(CATEGORIES),
  side: z.enum(ACTIVITY_SIDES),
  ownerId: idSchema.nullable(),
  dueDate: nullableDate,
  status: z.enum(ACTIVITY_STATUSES),
  completedDate: nullableDate,
  milestoneId: idSchema.nullable(),
  note: z.string().max(2000),
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

export const mapPersonSchema = z.object({
  id: idSchema,
  side: z.enum(SIDES),
  name: z.string().trim().min(1, 'Name is required').max(200),
  title: z.string().max(200),
  email: z.email({ message: 'Enter a valid email address' }).nullable(),
  role: z.enum(ROLES),
});

export const milestoneSchema = z.object({
  id: idSchema,
  name: z.string().trim().min(1, 'Milestone name is required').max(200),
  targetDate: nullableDate,
  criteria: z.string().max(1000),
  achievedDate: nullableDate,
});

export const exitTriggerSchema = z.object({
  id: idSchema,
  condition: z.string().trim().min(1, 'Condition is required').max(500),
  status: z.enum(EXIT_STATUSES),
});

export const MAP_ENTITY_SCHEMAS: Record<EntityKind, z.ZodType> = {
  objective: objectiveSchema,
  activity: activitySchema,
  person: mapPersonSchema,
  milestone: milestoneSchema,
  exitTrigger: exitTriggerSchema,
  review: reviewSchema,
  reviewNumber: reviewNumberSchema,
  reviewItem: reviewItemSchema,
};

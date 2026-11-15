import { z } from 'zod';
import { CASE_SOURCES } from '../cases/types';
import { idSchema, isoDateSchema, text } from '../shared/schemas';
import { HYPOTHESIS_ANSWERS, REVIEW_ITEM_KINDS, REVIEW_STATES, SCORE_KEYS } from './types';

const nullableDate = isoDateSchema.nullable();
const amount = z.number().min(0, 'Use 0 or more').nullable();

export const reviewSchema = z.object({
  id: idSchema,
  horizon: z.number().int().min(1, 'A horizon starts at 1'),
  state: z.enum(REVIEW_STATES),
  heldOn: nullableDate,
  caseId: idSchema.nullable(),
  decisions: text,
  relationshipNote: text,
  nextHorizonDays: z.number().int().min(7, 'Use at least 7 days').max(730, 'Use at most 730 days'),
  includeScorecard: z.boolean(),
  summarySentAt: z.string().nullable(),
  summarySentTo: text,
  updatedAt: z.string().nullable(),
  updatedBy: z.string().nullable(),
});

/** A number's fields without its row rule: zod can't omit or pick from a refined object (the change schema needs to). */
export const reviewNumberObject = z.object({
  id: idSchema,
  reviewId: idSchema,
  key: z.enum(SCORE_KEYS),
  actual: amount,
  target: amount,
  source: z.enum(CASE_SOURCES as [string, ...string[]]).nullable(),
  note: text,
  nextTarget: amount,
});

export const reviewNumberSchema = reviewNumberObject.refine(
  (row) => row.key !== 'recommend' || [row.actual, row.target, row.nextTarget].every((n) => n === null || n <= 10),
  { message: 'Use a number from 0 to 10', path: ['actual'] },
);

/**
 * An item's fields without its row rule (see `reviewNumberObject`). A draft saves as you type, so a commitment may have
 * an empty title; closing the review checks it (task 2).
 */
export const reviewItemObject = z.object({
  id: idSchema,
  reviewId: idSchema,
  kind: z.enum(REVIEW_ITEM_KINDS),
  refId: idSchema.nullable(),
  title: text,
  side: z.enum(['us', 'partner', 'joint']).nullable(),
  ownerId: idSchema.nullable(),
  dueDate: nullableDate,
  milestoneId: idSchema.nullable(),
  answer: z.enum(HYPOTHESIS_ANSWERS).nullable(),
  note: text,
  moved: z.boolean(),
});

export const reviewItemSchema = reviewItemObject.refine((row) => row.answer === null || row.kind === 'hypothesis', {
  message: 'Only a hypothesis has an answer',
  path: ['answer'],
});

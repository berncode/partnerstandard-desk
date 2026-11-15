// Spec 5.3: no signAgreement, plan details limited to the horizon length and the next review, a new horizon without a
// stage (it runs in the partner record's), and the stored MAP as the draft.
import { z } from 'zod';
import { COPY } from '@partner-desk/copy';
import { reviewItemObject, reviewItemSchema, reviewNumberObject, reviewNumberSchema, reviewSchema } from '../reviews/schemas';
import { isoDateSchema } from '../shared/schemas';
import type { MapChange } from './changes';
import {
  MAX_PAST_HORIZONS, activitySchema, exitTriggerSchema, horizonDaysSchema, mapInfoSchema, mapPersonSchema, milestoneSchema, objectiveSchema,
} from './schemas';
import { HORIZON_LENGTHS, type EntityKind } from './types';

export const ENTITY_KINDS = [
  'objective', 'activity', 'person', 'milestone', 'exitTrigger', 'review', 'reviewNumber', 'reviewItem',
] as const satisfies readonly EntityKind[];

/**
 * Fields a change may set per entity. Unknown fields are rejected; `id`, `updatedAt` and `updatedBy` are server-managed.
 * So are a review's horizon, state, held-on date, summary stamp (when, and to whom) and whether the summary shows the scorecard (it decides
 * what the partner sees), and an item's `moved`: the review commands set them (opening, closing, sending the summary),
 * never a typed change. The review number's and item's row rules (their
 * `refine`) are checked on the whole row when the change is applied: zod can't omit from a refined object.
 */
const FIELDS = {
  objective: objectiveSchema.omit({ id: true }).partial().strict(),
  activity: activitySchema.omit({ id: true, updatedAt: true, updatedBy: true }).partial().strict(),
  person: mapPersonSchema.omit({ id: true }).partial().strict(),
  milestone: milestoneSchema.omit({ id: true }).partial().strict(),
  exitTrigger: exitTriggerSchema.omit({ id: true }).partial().strict(),
  review: reviewSchema
    .omit({
      id: true, horizon: true, state: true, heldOn: true, includeScorecard: true, summarySentAt: true, summarySentTo: true, updatedAt: true,
      updatedBy: true,
    })
    // The next horizon gets one of the lengths "Start next horizon" offers (spec 5.2), never another the row could hold.
    .extend({ nextHorizonDays: z.literal(HORIZON_LENGTHS, { message: COPY.REVIEW_ERR_HORIZON_LENGTH }) })
    .partial().strict(),
  reviewNumber: reviewNumberObject.omit({ id: true }).partial().strict(),
  reviewItem: reviewItemObject.omit({ id: true, moved: true }).partial().strict(),
} satisfies Record<(typeof ENTITY_KINDS)[number], z.ZodType>;

/**
 * Plan details an updateInfo may set. The horizon history only grows, through startHorizon. The partner's name, type,
 * stage, the start date and closing belong to the partner record, so they are refused here.
 */
const infoPatch = z.object({ horizonDays: horizonDaysSchema.optional(), nextReviewDate: isoDateSchema.nullable().optional() }).strict();

const id = z.string().min(1).max(64);
const body = z.record(z.string(), z.unknown());

/** At most this many milestones start a horizon: the dialog offers five at most. */
const MAX_HORIZON_MILESTONES = 10;
const horizonMilestone = z.object({
  name: z.string().max(200),
  criteria: z.string().max(1000),
  day: z.number().int().min(1).max(730),
}).strict();

export const mapChangeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('updateInfo'), patch: infoPatch }),
    z.object({
      kind: z.literal('startHorizon'),
      expectedStartDate: isoDateSchema,
      expectedHorizon: z.number().int().min(0).max(MAX_PAST_HORIZONS),
      startDate: isoDateSchema,
      horizonDays: z.literal(HORIZON_LENGTHS),
      milestones: z.array(horizonMilestone).max(MAX_HORIZON_MILESTONES),
    }).strict(),
    z.object({ kind: z.literal('add'), entity: z.enum(ENTITY_KINDS), values: body }),
    z.object({
      kind: z.literal('update'), entity: z.enum(ENTITY_KINDS), id, patch: body,
      expectedUpdatedAt: z.string().max(40).nullable().optional(),
      expected: body.optional(),
    }),
    z.object({ kind: z.literal('delete'), entity: z.enum(ENTITY_KINDS), id }),
  ])
  .superRefine((change, ctx) => {
    // A review is never deleted by a typed change: a held one is the partnership's record. Only `openReview` takes back
    // a prep it wrote twice, through the store.
    if (change.kind === 'delete' && change.entity === 'review') {
      ctx.addIssue({ code: 'custom', message: 'A review can’t be deleted', path: ['entity'] });
      return;
    }
    if (change.kind !== 'add' && change.kind !== 'update') return;
    // A review starts with its prep (`openReview`, which sets its horizon), never as a bare row.
    if (change.kind === 'add' && change.entity === 'review') {
      ctx.addIssue({ code: 'custom', message: 'A review starts with its prep', path: ['entity'] });
      return;
    }
    if (change.kind === 'update' && change.expected !== undefined) {
      const seen = change.entity === 'activity' ? FIELDS.activity.safeParse(change.expected) : null;
      if (!seen) ctx.addIssue({ code: 'custom', message: 'Only activities take expected values', path: ['expected'] });
      else if (!seen.success) {
        for (const issue of seen.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: ['expected', ...issue.path] });
      }
    }
    const key = change.kind === 'add' ? 'values' : 'patch';
    const result = FIELDS[change.entity].safeParse(change.kind === 'add' ? change.values : change.patch);
    if (!result.success) {
      for (const issue of result.error.issues) ctx.addIssue({ code: 'custom', message: issue.message, path: [key, ...issue.path] });
    }
  });

/** Parses an untrusted change (e.g. a server-action argument). Returns null when it is malformed. */
export function parseMapChange(input: unknown): MapChange | null {
  const result = mapChangeSchema.safeParse(input);
  return result.success ? (result.data as MapChange) : null;
}

const draftId = z.string().min(1).max(64);
const draftObjective = objectiveSchema.extend({ id: draftId });
const draftActivity = activitySchema.extend({
  id: draftId,
  updatedAt: z.string().max(40).nullable(),
  updatedBy: z.string().max(200).nullable(),
});
const draftPerson = mapPersonSchema.extend({ id: draftId });
const draftMilestone = milestoneSchema.extend({ id: draftId });
const draftExitTrigger = exitTriggerSchema.extend({ id: draftId });

const DRAFT_COLLECTIONS = ['objectives', 'activities', 'people', 'milestones', 'exitTriggers'] as const;

/**
 * A whole stored MAP, e.g. the guided flow's draft. Entity ids must be unique across all collections.
 * Reference integrity is checked separately (findReferenceIssues).
 */
export const mapDraftSchema = z
  .object({
    info: mapInfoSchema,
    objectives: z.array(draftObjective).max(50),
    activities: z.array(draftActivity).max(300),
    people: z.array(draftPerson).max(100),
    milestones: z.array(draftMilestone).max(50),
    exitTriggers: z.array(draftExitTrigger).max(30),
    // A draft is a new MAP: it holds no reviews, and a review row in one is refused.
    reviews: z.array(reviewSchema).max(0).default([]),
    reviewNumbers: z.array(reviewNumberSchema).max(0).default([]),
    reviewItems: z.array(reviewItemSchema).max(0).default([]),
  })
  .superRefine((plan, ctx) => {
    const seen = new Set<string>();
    for (const key of DRAFT_COLLECTIONS) {
      const items: Array<{ id: string }> = plan[key];
      items.forEach((item, index) => {
        if (seen.has(item.id)) ctx.addIssue({ code: 'custom', message: 'Duplicate id', path: [key, index, 'id'] });
        seen.add(item.id);
      });
    }
  });

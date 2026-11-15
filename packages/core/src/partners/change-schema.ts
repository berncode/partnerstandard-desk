import { z } from 'zod';
import { RECRUITMENT_STEPS, STAGES } from '@partner-desk/method';
import { TEXT_MAX, TOO_LONG, isoDateSchema, toFieldErrors } from '../shared/schemas';
import type { PartnerChange } from './changes';
import { splitProvisionalId } from '../shared/batch';
import { PARTNER_ENTITY_SCHEMAS } from './schemas';
import { CLOSED_AS, type PartnerEntity } from './types';

/**
 * The rows a parsed change may add, update or delete. Not `proposalItem`: only the proposals commands build changes to a
 * Proposals row, so no screen action and no agent tool can write one.
 */
const ENTITY_KINDS = ['account', 'partner', 'person', 'call', 'qualification', 'marketLink'] as const satisfies readonly PartnerEntity[];
type ParsedEntity = (typeof ENTITY_KINDS)[number];

/** `schema` with every field optional and unknown fields refused, all the way down: object fields may be sent in part. */
function partialDeep(schema: z.ZodObject): z.ZodObject {
  const shape = Object.fromEntries(Object.entries(schema.shape).map(([key, field]) => [
    key, field instanceof z.ZodObject ? partialDeep(field) : field,
  ]));
  return z.object(shape).partial().strict();
}

/**
 * Fields a change may set per entity. Unknown fields are refused; `id`, `updatedAt` and `updatedBy` are the server's,
 * and so is a partner's `companyId`. Object fields (scores, notes, call topics, CASO letters) may name only some of
 * their sub-fields: the domain merges them. Lifecycle fields pass here and are refused by the domain with a message.
 */
const settable = (schema: z.ZodObject, extra: readonly string[] = []) => {
  // Built from the shape: `.omit()` refuses schemas with cross-field rules, which only apply to whole rows anyway.
  const hidden = new Set(['id', 'updatedAt', 'updatedBy', ...extra]);
  return partialDeep(z.object(Object.fromEntries(Object.entries(schema.shape).filter(([key]) => !hidden.has(key)))));
};

/** Partner fields only the MAP commands write, so a screen or an agent can't set them. */
export const MAP_FIELDS = ['mapHealth', 'mapNextMilestone'] as const;

const shapes = (extra: Partial<Record<ParsedEntity, readonly string[]>>) => ({
  account: settable(PARTNER_ENTITY_SCHEMAS.account, extra.account),
  partner: settable(PARTNER_ENTITY_SCHEMAS.partner as unknown as z.ZodObject, ['companyId', ...MAP_FIELDS, ...(extra.partner ?? [])]),
  person: settable(PARTNER_ENTITY_SCHEMAS.person, extra.person),
  call: settable(PARTNER_ENTITY_SCHEMAS.call, extra.call),
  qualification: settable(PARTNER_ENTITY_SCHEMAS.qualification, extra.qualification),
  marketLink: settable(PARTNER_ENTITY_SCHEMAS.marketLink, extra.marketLink),
}) satisfies Record<ParsedEntity, z.ZodType>;
const ADD_FIELDS = shapes({});
/**
 * What an update may set. Who a row belongs to never changes (delete and add instead), so the one-per-partner rules
 * hold; nor does a section's partner type, so one section per account and type holds too.
 */
const UPDATE_FIELDS = shapes({
  partner: ['partnerType', 'accountId'], qualification: ['partnerId'], marketLink: ['partnerId', 'marketId'],
});

const id = z.string().min(1).max(64);
const body = z.record(z.string(), z.unknown());
const expectedUpdatedAt = z.string().max(40).nullable().optional();

export const partnerChangeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('add'), entity: z.enum(ENTITY_KINDS), values: body }).strict(),
    z.object({ kind: z.literal('update'), entity: z.enum(ENTITY_KINDS), id, patch: body, expectedUpdatedAt }).strict(),
    z.object({ kind: z.literal('delete'), entity: z.enum(ENTITY_KINDS), id }).strict(),
    z.object({ kind: z.literal('setStep'), partnerId: id, to: z.enum(RECRUITMENT_STEPS) }).strict(),
    z.object({ kind: z.literal('markSigned'), partnerId: id, signedDate: isoDateSchema }).strict(),
    z.object({ kind: z.literal('setStage'), partnerId: id, to: z.enum(STAGES) }).strict(),
    z.object({ kind: z.literal('close'), partnerId: id, as: z.enum(CLOSED_AS), reason: z.string().max(TEXT_MAX, TOO_LONG) }).strict(),
    z.object({ kind: z.literal('reopen'), partnerId: id }).strict(),
    z.object({ kind: z.literal('undoSigned'), partnerId: id }).strict(),
    z.object({
      kind: z.literal('correctExit'), partnerId: id, exitedDate: isoDateSchema, reason: z.string().max(TEXT_MAX, TOO_LONG),
    }).strict(),
    z.object({
      kind: z.literal('markExited'), partnerId: id, exitedDate: isoDateSchema, reason: z.string().max(TEXT_MAX, TOO_LONG),
    }).strict(),
  ])
  .superRefine((change, ctx) => {
    if (change.kind !== 'add' && change.kind !== 'update') return;
    const key = change.kind === 'add' ? 'values' : 'patch';
    const result = (change.kind === 'add' ? ADD_FIELDS : UPDATE_FIELDS)[change.entity].safeParse(
      change.kind === 'add' ? change.values : change.patch,
    );
    if (!result.success) {
      for (const issue of result.error.issues) {
        // An unknown key, even inside an object field, means the change itself is malformed: no field to name.
        const path = issue.code === 'unrecognized_keys' ? [key] : [key, ...issue.path];
        ctx.addIssue({ code: 'custom', message: issue.message, path });
      }
    }
  });

/** Where a field's own value sits in a change; problems anywhere else mean the change itself is malformed. */
const VALUE_KEYS = new Set(['values', 'patch']);
const FIELD_KEYS = new Set(['reason', 'signedDate', 'exitedDate']);

export type ParsedChange = { ok: true; change: PartnerChange } | { ok: false; fieldErrors?: Record<string, string> };

/**
 * Parses an untrusted change (e.g. a server-action argument). When only field values are wrong (a text over the cell
 * limit, say), the failure names those fields; any other problem gives no detail.
 */
export function parsePartnerChange(input: unknown): ParsedChange {
  // A single add may carry the same provisional id a batch does. The field schemas hide `id`, so it is taken off
  // first and put back on the parsed change. `updatedAt` and `updatedBy` stay refused.
  const split = splitProvisionalId(input);
  if (!split.ok) return { ok: false };
  const result = partnerChangeSchema.safeParse(split.input);
  if (result.success) {
    const change = result.data as PartnerChange;
    if (split.id !== null && change.kind === 'add') return { ok: true, change: { ...change, values: { id: split.id, ...change.values } } };
    return { ok: true, change };
  }
  const { issues } = result.error;
  // A missing or mistyped top-level field is a malformed change, not a wrong value.
  const fieldIssue = (issue: (typeof issues)[number]) =>
    (VALUE_KEYS.has(String(issue.path[0])) && issue.path.length > 1) ||
    (FIELD_KEYS.has(String(issue.path[0])) && issue.path.length === 1 && issue.code !== 'invalid_type');
  if (!issues.every(fieldIssue)) return { ok: false };
  const fields = issues.map((issue) => ({ ...issue, path: VALUE_KEYS.has(String(issue.path[0])) ? issue.path.slice(1) : issue.path }));
  return { ok: false, fieldErrors: toFieldErrors(new z.ZodError(fields)) };
}

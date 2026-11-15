import { z } from 'zod';
import { toFieldErrors } from '../shared/schemas';
import type { MarketChange } from './changes';
import { MARKET_ENTITY_SCHEMAS, MARKET_FIELD_NAMES, MARKET_INFO_FIXED, marketInfoSchema } from './schemas';
import type { MarketEntity } from './types';

const ENTITY_KINDS = ['valuePoint', 'hypothesis', 'exclusion', 'change'] as const satisfies readonly MarketEntity[];

/** Built from the shape: a plain way to leave fields out that also works for schemas with cross-field rules. */
const without = (schema: z.ZodObject, hidden: readonly string[]) =>
  z.object(Object.fromEntries(Object.entries(schema.shape).filter(([key]) => !hidden.includes(key))));

/** `schema` with every field optional and unknown fields refused. */
const partial = (schema: z.ZodObject) => schema.partial().strict();

/** Fields a change may set per entity. Unknown fields are refused; `id`, `updatedAt` and `updatedBy` are the server's. */
const settable = (schema: z.ZodObject) => partial(without(schema, ['id', 'updatedAt', 'updatedBy']));
const FIELDS = {
  valuePoint: settable(MARKET_ENTITY_SCHEMAS.valuePoint),
  hypothesis: settable(MARKET_ENTITY_SCHEMAS.hypothesis),
  exclusion: settable(MARKET_ENTITY_SCHEMAS.exclusion),
  change: settable(MARKET_ENTITY_SCHEMAS.change),
} satisfies Record<MarketEntity, z.ZodType>;
/** The market's partner type is fixed once the market is made, so a change never carries it. */
const INFO_FIELDS = partial(without(marketInfoSchema as unknown as z.ZodObject, [...MARKET_INFO_FIXED, 'partnerType']));

const id = z.string().min(1).max(64);
const body = z.record(z.string(), z.unknown());
const expectedUpdatedAt = z.string().max(40).nullable().optional();

export const marketChangeSchema = z
  .discriminatedUnion('kind', [
    z.object({ kind: z.literal('updateInfo'), patch: INFO_FIELDS, expectedUpdatedAt }).strict(),
    z.object({ kind: z.literal('add'), entity: z.enum(ENTITY_KINDS), values: body }).strict(),
    z.object({ kind: z.literal('update'), entity: z.enum(ENTITY_KINDS), id, patch: body, expectedUpdatedAt }).strict(),
    z.object({ kind: z.literal('delete'), entity: z.enum(ENTITY_KINDS), id }).strict(),
    z.object({
      kind: z.literal('clearCheckAgain'),
      target: z.union([
        z.object({ entity: z.literal('market'), field: z.enum(MARKET_FIELD_NAMES) }).strict(),
        z.object({ entity: z.enum(['valuePoint', 'hypothesis']), id }).strict(),
      ]),
    }).strict(),
  ])
  .superRefine((change, ctx) => {
    if (change.kind !== 'add' && change.kind !== 'update') return;
    const key = change.kind === 'add' ? 'values' : 'patch';
    const result = FIELDS[change.entity].safeParse(change.kind === 'add' ? change.values : change.patch);
    if (!result.success) {
      for (const issue of result.error.issues) {
        // An unknown key means the change itself is malformed: no field to name.
        const path = issue.code === 'unrecognized_keys' ? [key] : [key, ...issue.path];
        ctx.addIssue({ code: 'custom', message: issue.message, path });
      }
    }
  });

/** Where a field's own value sits in a change; problems anywhere else mean the change itself is malformed. */
const VALUE_KEYS = new Set(['values', 'patch']);

export type ParsedMarketChange = { ok: true; change: MarketChange } | { ok: false; fieldErrors?: Record<string, string> };

/**
 * Parses an untrusted change (e.g. a server-action argument). When only field values are wrong (a text over the cell
 * limit, say), the failure names those fields; any other problem gives no detail.
 */
export function parseMarketChange(input: unknown): ParsedMarketChange {
  const result = marketChangeSchema.safeParse(input);
  if (result.success) return { ok: true, change: result.data as MarketChange };
  const { issues } = result.error;
  if (!issues.every((issue) => VALUE_KEYS.has(String(issue.path[0])) && issue.path.length > 1)) return { ok: false };
  const fields = issues.map((issue) => ({ ...issue, path: issue.path.slice(1) }));
  return { ok: false, fieldErrors: toFieldErrors(new z.ZodError(fields)) };
}

// The market's changes. Partner changes live in ../partners/changes.
import type { z } from 'zod';
import { COPY } from '@partner-desk/copy';
import { newId } from '../ids';
import type { ApplyFailure, ApplyOutcome } from '../shared/outcome';
import { toFieldErrors } from '../shared/schemas';
import type { ChangeStamp } from '../shared/stamp';
import type { IsoDateTime } from '../partners/types';
import { MARKET_ENTITY_SCHEMAS, MARKET_INFO_FIXED, marketInfoSchema } from './schemas';
import type { Market, MarketEntity, MarketField, MarketInfo } from './types';

export const MARKET_COLLECTION = {
  valuePoint: 'valuePoints',
  hypothesis: 'hypotheses',
  exclusion: 'exclusions',
  change: 'changes',
} as const satisfies Record<MarketEntity, keyof Omit<Market, 'info'>>;

/**
 * Market fields to set. Who the market is (`marketId`, `companyId`), its partner type, where it was copied from and who
 * changed it last are never set by a patch: the type is picked when the market is made, and a patch naming it is refused. `checkAgain`, when given, replaces the flags (undo uses it to restore the flags an edit
 * cleared); otherwise every field the patch names loses its flag.
 */
export type InfoPatch = Partial<Omit<MarketInfo, 'marketId' | 'companyId' | 'partnerType' | 'copiedFrom' | 'updatedAt' | 'updatedBy'>>;

export type MarketChange =
  | { kind: 'updateInfo'; patch: InfoPatch; expectedUpdatedAt?: IsoDateTime | null }
  | { kind: 'add'; entity: MarketEntity; values: Record<string, unknown> }
  | { kind: 'update'; entity: MarketEntity; id: string; patch: Record<string, unknown>; expectedUpdatedAt?: IsoDateTime | null }
  | { kind: 'delete'; entity: MarketEntity; id: string }
  | { kind: 'clearCheckAgain'; target: { entity: 'market'; field: MarketField } | { entity: 'valuePoint' | 'hypothesis'; id: string } };

type Outcome = ApplyOutcome<Market>;
type Row = { id: string; updatedAt: IsoDateTime | null } & Record<string, unknown>;

const GONE: ApplyFailure = { ok: false, error: 'not_found', message: COPY.GONE };
const CONFLICT: ApplyFailure = { ok: false, error: 'conflict', message: COPY.CONFLICT };
/** A market's partner type is fixed: a wrong one means a new market. */
const TYPE_FIXED: ApplyFailure = {
  ok: false, error: 'invalid', message: COPY.MARKET_TYPE_FIXED, fieldErrors: { partnerType: COPY.MARKET_TYPE_FIXED },
};
/** Fields the app sets; values and patches never do. */
const MANAGED = ['id', 'updatedAt', 'updatedBy'];

/** What a new row of each kind starts with. */
function defaults(entity: MarketEntity, now: IsoDateTime): Record<string, unknown> {
  switch (entity) {
    case 'valuePoint':
      return { kind: 'margin_or_fees', text: '', state: 'assumption', evidence: '', checkAgain: false };
    case 'hypothesis':
      return {
        name: '', theirSide: '', theirEvidence: '', ourSide: '', ourEvidence: '', valuePointIds: [], lookalike: '',
        status: 'draft', checkAgain: false,
      };
    case 'exclusion':
      return { company: '', website: '', reason: '' };
    case 'change':
      return { date: now.slice(0, 10), entity: 'market', entityId: '', what: '', callId: null };
  }
}

const list = (m: Market, entity: MarketEntity) => m[MARKET_COLLECTION[entity]] as unknown as Row[];
const withList = (m: Market, entity: MarketEntity, items: Row[]) => ({ ...m, [MARKET_COLLECTION[entity]]: items }) as Market;

function omitKeys(values: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const copy = { ...values };
  for (const key of keys) delete copy[key];
  return copy;
}

function invalid(fieldErrors: Record<string, string>): ApplyFailure {
  return { ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors };
}

/** Validates `row` and puts it in place of row `index` of the entity's list (or at the end when index is -1). */
function write(m: Market, entity: MarketEntity, index: number, row: Record<string, unknown>): Outcome {
  const result = (MARKET_ENTITY_SCHEMAS[entity] as z.ZodType).safeParse(row);
  if (!result.success) return invalid(toFieldErrors(result.error));
  const value = result.data as Row;
  const items = list(m, entity).slice();
  if (index === -1) items.push(value);
  else items[index] = value;
  return { ok: true, value: withList(m, entity, items), entityId: value.id };
}

export function applyMarketChange(m: Market, change: MarketChange, stamp: ChangeStamp): Outcome {
  switch (change.kind) {
    case 'updateInfo': {
      if ('partnerType' in change.patch) return TYPE_FIXED;
      if (change.expectedUpdatedAt !== undefined && m.info.updatedAt !== change.expectedUpdatedAt) return CONFLICT;
      const patch = omitKeys(change.patch, MARKET_INFO_FIXED);
      const result = marketInfoSchema.safeParse({
        ...m.info, ...patch,
        checkAgain: 'checkAgain' in patch ? patch.checkAgain : m.info.checkAgain.filter((field) => !(field in patch)),
        updatedAt: stamp.now, updatedBy: stamp.actor,
      });
      if (!result.success) return invalid(toFieldErrors(result.error));
      return { ok: true, value: { ...m, info: result.data }, entityId: null };
    }

    case 'add': {
      const values = omitKeys(change.values, MANAGED);
      const id = (stamp.newId ?? newId)(change.entity);
      return write(m, change.entity, -1, {
        ...defaults(change.entity, stamp.now), ...values, id, updatedAt: stamp.now, updatedBy: stamp.actor,
      });
    }

    case 'update': {
      const items = list(m, change.entity);
      const index = items.findIndex((item) => item.id === change.id);
      if (index === -1) return GONE;
      const current = items[index]!;
      if (change.expectedUpdatedAt !== undefined && current.updatedAt !== change.expectedUpdatedAt) return CONFLICT;
      const patch = omitKeys(change.patch, MANAGED);
      const row: Record<string, unknown> = { ...current, ...patch, id: current.id, updatedAt: stamp.now, updatedBy: stamp.actor };
      // Editing a copied value point or hypothesis counts as checking it.
      if ((change.entity === 'valuePoint' || change.entity === 'hypothesis') && !('checkAgain' in patch)) row.checkAgain = false;
      return write(m, change.entity, index, row);
    }

    case 'delete': {
      // No cascade: rows that point at the deleted one keep their reference, and marketDanglingRefs reports them.
      const items = list(m, change.entity);
      if (!items.some((item) => item.id === change.id)) return GONE;
      return { ok: true, value: withList(m, change.entity, items.filter((item) => item.id !== change.id)), entityId: null };
    }

    case 'clearCheckAgain': {
      const { target } = change;
      if (target.entity === 'market') {
        const checkAgain = m.info.checkAgain.filter((field) => field !== target.field);
        return { ok: true, value: { ...m, info: { ...m.info, checkAgain, updatedAt: stamp.now, updatedBy: stamp.actor } }, entityId: null };
      }
      const items = list(m, target.entity);
      const index = items.findIndex((item) => item.id === target.id);
      if (index === -1) return GONE;
      return write(m, target.entity, index, { ...items[index], checkAgain: false, updatedAt: stamp.now, updatedBy: stamp.actor });
    }
  }
}

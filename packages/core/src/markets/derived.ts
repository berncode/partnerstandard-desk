// The market's danglingRefs and itemsToCheck.
import type { Market, MarketEntity } from './types';

export interface MarketDanglingRef {
  entity: MarketEntity;
  id: string;
  field: string;
}

/**
 * Hypotheses that name a value point which no longer exists. They show as "needs attention" and are never removed
 * automatically. A change row's `entityId` is history and is not checked, and neither is its `callId`: that call lives
 * in the Partner book, so the caller checks it there.
 */
export function marketDanglingRefs(m: Market): MarketDanglingRef[] {
  const valuePoints = new Set(m.valuePoints.map((v) => v.id));
  const out: MarketDanglingRef[] = [];
  for (const h of m.hypotheses) {
    if (h.valuePointIds.some((id) => !valuePoints.has(id))) out.push({ entity: 'hypothesis', id: h.id, field: 'valuePointIds' });
  }
  return out;
}

/** Market fields, value points and partner hypotheses still flagged "check again" after a copy. */
export function itemsToCheck(m: Market): number {
  return m.info.checkAgain.length
    + m.valuePoints.filter((v) => v.checkAgain).length
    + m.hypotheses.filter((h) => h.checkAgain).length;
}

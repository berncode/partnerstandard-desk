// The join of a stored MAP with its partner record (spec 5.3): the record is the truth for the partner's name, stage,
// signing and closing, so the MAP file stores none of them, and the copied MAP app rules read the joined plan.
import type { IsoDate } from '../partners/types';
import type { JoinedPlan, MapInfo, MapPlan, MapRecord, PlanInfo } from './types';

/**
 * Which stored horizon is the current one: the index in `laterHorizons` of the last one that starts on or after the
 * signing date, or null when the first horizon is current or the MAP isn't signed. A later horizon that starts before
 * the signing date stays stored and is ignored: it belongs to a signing that was undone (Review Focus 3).
 */
export function currentLaterHorizon(map: MapInfo, record: MapRecord): number | null {
  const signed = record.signedDate;
  if (signed === null) return null;
  for (let i = map.laterHorizons.length - 1; i >= 0; i--) {
    if (map.laterHorizons[i]!.startDate >= signed) return i;
  }
  return null;
}

/**
 * The MAP app's plan details for a MAP and its partner record.
 *
 * - Not signed: recruitment, with no horizon run; `closed` follows the record. `unsignedStart` is the date such a MAP
 *   counts from (in the MAP app, the planned start): the day it was started. It is never stored.
 * - Signed: the first horizon starts on the signing date with the MAP's `horizonDays`. The current horizon is the last
 *   later one that starts on or after the signing date, else the first; the ones before it are past, each with the
 *   record's stage (the record keeps no stage history).
 */
export function planInfoFor(map: MapInfo, record: MapRecord, unsignedStart: IsoDate): PlanInfo {
  const base = { partnerName: record.partnerName, partnerType: record.partnerType, nextReviewDate: map.nextReviewDate };
  const signed = record.signedDate;
  if (signed === null) {
    return {
      ...base, stage: 'recruitment', startDate: unsignedStart, horizonDays: map.horizonDays, pastHorizons: [],
      closed: record.closed, closedReason: record.closed === null ? '' : record.closedReason,
    };
  }
  const horizons = [{ startDate: signed, horizonDays: map.horizonDays }, ...map.laterHorizons.filter((h) => h.startDate >= signed)];
  const current = horizons[horizons.length - 1]!;
  return {
    ...base, stage: record.stage, startDate: current.startDate, horizonDays: current.horizonDays,
    pastHorizons: horizons.slice(0, -1).map((h) => ({ startDate: h.startDate, horizonDays: h.horizonDays, stage: record.stage })),
    closed: null, closedReason: '',
  };
}

/** The stored MAP with its plan details joined in: what the copied health and notification rules take. */
export function joinPlan(plan: MapPlan, record: MapRecord, unsignedStart: IsoDate): JoinedPlan {
  return { ...plan, info: planInfoFor(plan.info, record, unsignedStart) };
}

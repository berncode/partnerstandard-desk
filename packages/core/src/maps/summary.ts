// What the partner record keeps of a MAP (spec 5.7): its health and its next milestone date. The same rules give what
// every screen shows of a MAP (ruling R6): one answer for a MAP, wherever it is read.
import type { IsoDate, IsoDateTime } from '../partners/types';
import { computeHealth, isClosedHorizonMilestone, milestoneStatus, type Health, type HealthReason, type MapHealth } from './derived';
import { joinPlan } from './join';
import { endedWithoutSigning, type JoinedPlan, type MapPlan, type MapRecord, type Milestone } from './types';

export interface MapSummary {
  /**
   * Null once a recruitment ended without signing ("Not signed" on screen), and while the MAP is empty ("Nothing
   * planned yet" on screen, owner 2026-10-31): there is nothing to track. The Partners list tells the two apart.
   */
  health: Health | null;
  nextMilestone: IsoDate | null;
}

/** What the screens show of a MAP: its health, `empty` while it has nothing to manage, null once not signed. */
export interface MapView {
  health: MapHealth | null;
  reasons: HealthReason[];
  nextMilestone: IsoDate | null;
}

/**
 * The next milestone: the earliest one not achieved, not missed and with a target date today or later (of two on one
 * date, the first by name). A milestone without a date, or with a planned date already past, is not next, and neither
 * is a milestone of a horizon closed early (`isClosedHorizonMilestone`). None once a
 * recruitment ended without signing.
 */
export function nextMapMilestone(plan: JoinedPlan, today: IsoDate): Milestone | null {
  if (endedWithoutSigning(plan.info)) return null;
  let next: Milestone | null = null;
  for (const m of plan.milestones) {
    if (m.targetDate === null || m.targetDate < today || milestoneStatus(m, today, plan.info.stage) !== 'upcoming' || isClosedHorizonMilestone(m, plan.info)) continue;
    if (next === null || m.targetDate < next.targetDate! || (m.targetDate === next.targetDate && m.name < next.name)) next = m;
  }
  return next;
}

/**
 * A joined MAP's health (with why) and next milestone. `lastEventAt` is the MAP's last change through PartnerStandard Desk
 * (the directory's `lastChangeAt`, else the day it was started): the one "last progress" every caller passes (ruling R6).
 */
export function summarizeMap(plan: JoinedPlan, today: IsoDate, lastEventAt: IsoDateTime | null): MapView {
  if (endedWithoutSigning(plan.info)) return { health: null, reasons: [], nextMilestone: null };
  const { health, reasons } = computeHealth({ plan, today, lastEventAt });
  return { health, reasons, nextMilestone: nextMapMilestone(plan, today)?.targetDate ?? null };
}

/**
 * What the partner row keeps (spec 5.7). `unsignedStart` is the day the MAP was started (see `planInfoFor`). An empty
 * MAP writes no health: the MAP health column's dropdown has no word for it [builder's call, 2026-10-31].
 */
export function mapSummary(plan: MapPlan, record: MapRecord, unsignedStart: IsoDate, today: IsoDate, lastEventAt: IsoDateTime | null): MapSummary {
  const { health, nextMilestone } = summarizeMap(joinPlan(plan, record, unsignedStart), today, lastEventAt);
  return { health: health === 'empty' ? null : health, nextMilestone };
}

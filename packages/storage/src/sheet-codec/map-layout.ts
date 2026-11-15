// How a MAP lies in its spreadsheet. The MAP app's tabs and columns, in its order; the Plan tab holds what a MAP file
// stores (spec 5.3): the partner type's id and type, the first horizon's length, the horizons started after it and
// the next review. The partner's name, stage, signing and closing are on the partner record. PartnerStandard Desk
// keeps cells typed (decode.ts). Format version 2 adds three tabs of PartnerStandard Desk's own after Exit Triggers:
// a partner review's rows (spec 7). Version 3 names a review item's Owner and Milestone as the Activities tab does,
// and adds the review's "Sent to" (owner, 2026-11-01).
import { laterHorizonSchema, type EntityKind, type LaterHorizon, type MapInfo } from '@partner-desk/core';
import { SHEET_COPY } from '@partner-desk/copy';
import { idColumn, type ColumnDef } from './columns';
import type { Cell } from './grid';
import type { EnumName } from './labels';
import type { WorkbookLayout } from './layouts';

const M = SHEET_COPY.MAP;
const H = M.HEADERS;
const F = M.PLAN_FIELDS;

/**
 * How a Plan tab value sits in its cell: `text` as typed; `enum` its label; `days` a whole number of days ("90" or
 * "90 days"); `date` YYYY-MM-DD; `horizons` the later horizons in one cell (`formatLaterHorizons`).
 */
export type PlanFieldKind = 'text' | 'enum' | 'days' | 'date' | 'horizons';

export interface PlanFieldDef {
  key: keyof MapInfo;
  label: string;
  kind: PlanFieldKind;
  enumName?: EnumName;
  /**
   * What a missing or unreadable value means. `file`: the file can't be read (the partner type it belongs to, set when
   * the MAP is made and never written again). `issue`: an issue, and the default stands in. `none`: a missing row is no
   * value, without an issue; an unreadable one is an issue.
   */
  needed: 'file' | 'issue' | 'none';
}

export interface MapWorkbookLayout extends WorkbookLayout<EntityKind> {
  tabs: Record<EntityKind | 'start' | 'meta' | 'plan', string>;
  /** The Plan tab's header row, and its columns (0-based): field label, value. */
  planHeader: readonly string[];
  planColumns: { label: 0; value: 1 };
  /** One row per field, found by its label. */
  planFields: PlanFieldDef[];
}

const person: ColumnDef = { key: 'ownerId', header: H.owner, kind: 'nameRef', refersTo: 'person' };
const milestone: ColumnDef = { key: 'milestoneId', header: H.milestone, kind: 'nameRef', refersTo: 'milestone' };
/** The review a number or item belongs to. A row whose review isn't on the Reviews tab (or can't be read) is left out. */
const reviewRef: ColumnDef = { key: 'reviewId', header: H.reviewId, kind: 'ref' };

const MAP_COLUMNS: Record<EntityKind, ColumnDef[]> = {
  objective: [
    idColumn,
    { key: 'side', header: H.side, kind: 'enum', enumName: 'mapSide' },
    { key: 'statement', header: H.objective, kind: 'text' },
    { key: 'successMeasure', header: H.successMeasure, kind: 'text' },
  ],
  activity: [
    idColumn,
    { key: 'title', header: H.activity, kind: 'text' },
    { key: 'category', header: H.category, kind: 'enum', enumName: 'mapCategory' },
    { key: 'side', header: H.side, kind: 'enum', enumName: 'mapActivitySide' },
    person,
    { key: 'dueDate', header: H.dueDate, kind: 'date' },
    { key: 'status', header: H.status, kind: 'enum', enumName: 'mapActivityStatus' },
    { key: 'completedDate', header: H.completedDate, kind: 'date' },
    milestone,
    { key: 'note', header: H.note, kind: 'text' },
    { key: 'updatedAt', header: H.lastUpdated, kind: 'datetime' },
    { key: 'updatedBy', header: H.updatedBy, kind: 'optionalText' },
  ],
  person: [
    idColumn,
    { key: 'side', header: H.side, kind: 'enum', enumName: 'mapSide' },
    { key: 'name', header: H.name, kind: 'text' },
    { key: 'title', header: H.title, kind: 'text' },
    { key: 'email', header: H.email, kind: 'email' },
    { key: 'role', header: H.role, kind: 'enum', enumName: 'mapRole' },
  ],
  milestone: [
    idColumn,
    { key: 'name', header: H.milestone, kind: 'text' },
    { key: 'targetDate', header: H.targetDate, kind: 'date' },
    { key: 'criteria', header: H.criteria, kind: 'text' },
    { key: 'achievedDate', header: H.achievedDate, kind: 'date' },
  ],
  exitTrigger: [
    idColumn,
    { key: 'condition', header: H.condition, kind: 'text' },
    { key: 'status', header: H.status, kind: 'enum', enumName: 'mapExitStatus' },
  ],
  // The review tabs (version 2). A review item names its Owner and Milestone as an activity does (version 3, owner,
  // 2026-11-01); its review, its business case and what it is about by their ID: an activity's title isn't unique, and a
  // question's hypothesis is in a market's file, so no name could find the row.
  review: [
    idColumn,
    { key: 'horizon', header: H.horizon, kind: 'number' },
    { key: 'state', header: H.reviewState, kind: 'enum', enumName: 'reviewState' },
    { key: 'heldOn', header: H.heldOn, kind: 'date' },
    { key: 'caseId', header: H.caseId, kind: 'ref' },
    { key: 'decisions', header: H.decisions, kind: 'text' },
    { key: 'relationshipNote', header: H.relationshipNote, kind: 'text' },
    { key: 'nextHorizonDays', header: H.nextHorizonDays, kind: 'number' },
    { key: 'includeScorecard', header: H.includeScorecard, kind: 'bool' },
    { key: 'summarySentAt', header: H.summarySentAt, kind: 'datetime' },
    { key: 'summarySentTo', header: H.summarySentTo, kind: 'text' },
    { key: 'updatedAt', header: H.lastUpdated, kind: 'datetime' },
    { key: 'updatedBy', header: H.updatedBy, kind: 'optionalText' },
  ],
  reviewNumber: [
    idColumn,
    reviewRef,
    { key: 'key', header: H.number, kind: 'enum', enumName: 'scoreKey' },
    { key: 'actual', header: H.actual, kind: 'amount' },
    { key: 'target', header: H.target, kind: 'amount' },
    { key: 'source', header: H.source, kind: 'enum', enumName: 'caseSource' },
    { key: 'note', header: H.note, kind: 'text' },
    { key: 'nextTarget', header: H.nextTarget, kind: 'amount' },
  ],
  reviewItem: [
    idColumn,
    reviewRef,
    { key: 'kind', header: H.kind, kind: 'enum', enumName: 'reviewItemKind' },
    { key: 'refId', header: H.refId, kind: 'ref' },
    { key: 'title', header: H.title, kind: 'text' },
    { key: 'side', header: H.side, kind: 'enum', enumName: 'mapActivitySide' },
    person,
    { key: 'dueDate', header: H.dueDate, kind: 'date' },
    milestone,
    { key: 'answer', header: H.answer, kind: 'enum', enumName: 'hypothesisAnswer' },
    { key: 'note', header: H.note, kind: 'text' },
    { key: 'moved', header: H.moved, kind: 'bool' },
  ],
};

/** The review tabs, in file order: a format version 1 file gets them on its next save (version.ts). */
export const REVIEW_KINDS = ['review', 'reviewNumber', 'reviewItem'] as const satisfies readonly EntityKind[];

const META_TAB = '_meta';

/** A MAP's workbook (format version 3), one per MAP. Its company's id is in `_meta`. */
export const MAP_LAYOUT: MapWorkbookLayout = {
  tabs: {
    start: SHEET_COPY.TABS.start, plan: M.TABS.plan, objective: M.TABS.objectives, activity: M.TABS.activities, person: M.TABS.people,
    milestone: M.TABS.milestones, exitTrigger: M.TABS.exitTriggers, review: M.TABS.reviews, reviewNumber: M.TABS.reviewNumbers,
    reviewItem: M.TABS.reviewItems, meta: META_TAB,
  },
  tabOrder: [
    SHEET_COPY.TABS.start, M.TABS.plan, M.TABS.objectives, M.TABS.activities, M.TABS.people, M.TABS.milestones, M.TABS.exitTriggers,
    M.TABS.reviews, M.TABS.reviewNumbers, M.TABS.reviewItems, META_TAB,
  ],
  entityOrder: ['objective', 'activity', 'person', 'milestone', 'exitTrigger', 'review', 'reviewNumber', 'reviewItem'],
  columns: MAP_COLUMNS,
  idKey: 'companyId',
  planHeader: M.PLAN_HEADER,
  planColumns: { label: 0, value: 1 },
  planFields: [
    { key: 'partnerId', label: F.partnerId, kind: 'text', needed: 'file' },
    { key: 'partnerType', label: F.partnerType, kind: 'enum', enumName: 'partnerType', needed: 'file' },
    { key: 'horizonDays', label: F.horizonDays, kind: 'days', needed: 'issue' },
    { key: 'laterHorizons', label: F.laterHorizons, kind: 'horizons', needed: 'none' },
    { key: 'nextReviewDate', label: F.nextReviewDate, kind: 'date', needed: 'none' },
  ],
};

export const isMapLayout = (layout: WorkbookLayout<string>): layout is MapWorkbookLayout => 'planFields' in layout;

/**
 * The fields that hold the id of another row of the MAP: an activity's or review item's Owner and Milestone, a review
 * item's activity (`refId`; a hypothesis id there never matches a MAP row) and a number's or item's review. A row typed
 * without an ID gets a real one on the next save, and these fields follow it (writer.ts, map-changes.ts).
 */
export const MAP_REF_KEYS = ['ownerId', 'milestoneId', 'refId', 'reviewId'] as const;

/** "90", "90 days", "90d": a whole number of days; null when the cell says something else. */
export function readDays(cell: Cell | undefined): number | null {
  if (typeof cell === 'number') return Number.isInteger(cell) ? cell : null;
  const match = /^(\d+)\s*(d|days?)?$/i.exec(String(cell ?? '').trim());
  return match ? Number(match[1]) : null;
}

/** "2026-07-20 · 90 days; 2026-10-18 · 60 days": oldest first, one entry per horizon. */
export function formatLaterHorizons(horizons: LaterHorizon[]): string {
  return horizons.map((h) => `${h.startDate} · ${h.horizonDays} days`).join('; ');
}

function parseEntry(entry: string): LaterHorizon | null {
  const parts = entry.split(/[·|]/).map((part) => part.trim());
  if (parts.length !== 2) return null;
  const days = readDays(parts[1]);
  if (days === null) return null;
  const parsed = laterHorizonSchema.safeParse({ startDate: parts[0], horizonDays: days });
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the Later horizons cell. Entries are separated by semicolons or line breaks; within one, the date and the
 * length by "·" or "|". `ok` is false when any entry (or the cell itself) can't be read: `value` then holds the
 * entries that can.
 */
export function parseLaterHorizons(cell: Cell | undefined): { ok: boolean; value: LaterHorizon[] } {
  if (cell == null) return { ok: true, value: [] };
  if (typeof cell !== 'string') return { ok: false, value: [] };
  const value: LaterHorizon[] = [];
  let ok = true;
  for (const entry of cell.split(/[;\n]/).map((e) => e.trim()).filter(Boolean)) {
    const horizon = parseEntry(entry);
    if (horizon) value.push(horizon);
    else ok = false;
  }
  return { ok, value };
}

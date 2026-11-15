// The snapshot is the MAP as its file holds it, with the partner record's facts it is shown with (spec 5.3) and its one "last progress" (ruling R6).
import type { IsoDate, IsoDateTime, MapChange, MapPlan, MapRecord } from '@partner-desk/core';
import type { RowIssue, StoreErrorCode } from '@partner-desk/storage';

/** What the MAP page holds of a MAP as `readMap` gives it. */
export const snapshotOf = (read: Pick<MapSnapshot, 'value' | 'issues' | 'record' | 'startedOn' | 'lastProgressAt'>): MapSnapshot => ({
  value: read.value, issues: read.issues, record: read.record, startedOn: read.startedOn, lastProgressAt: read.lastProgressAt,
});

/** What the MAP page holds of a MAP: its file, and what the screens join it with. */
export interface MapSnapshot {
  value: MapPlan;
  issues: RowIssue[];
  /** The partner record's name, stage, signing and closing (never written by a MAP change). */
  record: MapRecord;
  /** The day the MAP was started: what it counts from before signing (`planInfoFor`). */
  startedOn: IsoDate;
  /** What its health counts "no progress" from (ruling R6). */
  lastProgressAt: IsoDateTime;
}

export type RemoteErrorCode = StoreErrorCode | 'forbidden' | 'unknown';

export type RemoteResult =
  | { ok: true; snapshot: MapSnapshot; entityId: string | null }
  | { ok: false; error: RemoteErrorCode; message: string; fieldErrors?: Record<string, string>; snapshot?: MapSnapshot };

/** Applies one change wherever the MAP lives (a server action) and returns the fresh snapshot. */
export type PlanRemote = (change: MapChange) => Promise<RemoteResult>;

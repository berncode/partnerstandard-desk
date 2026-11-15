// The MAP page's workspace on the sample MAP, saving to a MAP kept in memory, for component tests.
import {
  applyMapChange, type IsoDate, type IsoDateTime, type MapActor, type MapPlan, type MapRecord,
} from '@partner-desk/core';
import { MAP_NOW, MAP_TODAY } from '@partner-desk/core/test-builders';
import { buildSamplePlan, buildSampleRecord } from '@partner-desk/method';
import type { RowIssue } from '@partner-desk/storage';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { PlanWorkspace } from '@/maps/components/plan-workspace';
import type { MapSnapshot, PlanRemote } from '@/maps/remote';

export const OWNER: MapActor = { kind: 'owner' };
export const SAMPLE_PLAN = buildSamplePlan(MAP_TODAY) as MapPlan;
export const SAMPLE_RECORD = buildSampleRecord(MAP_TODAY) as MapRecord;

export function mapSnapshot(plan: MapPlan = SAMPLE_PLAN, record: MapRecord = SAMPLE_RECORD, issues: RowIssue[] = []): MapSnapshot {
  return { value: plan, issues, record, startedOn: '2026-09-01', lastProgressAt: MAP_NOW };
}

/** A remote that keeps the MAP in memory on the calling side, as the server would save it. */
export function localRemote(initial: MapSnapshot, actorName: string, clock: () => IsoDateTime = () => MAP_NOW): PlanRemote {
  let snapshot = initial;
  return async (change) => {
    const outcome = applyMapChange(snapshot.value, change, { now: clock(), actorName }, snapshot.record);
    if (!outcome.ok) {
      return { ok: false, error: outcome.error, message: outcome.message, ...(outcome.fieldErrors ? { fieldErrors: outcome.fieldErrors } : {}), snapshot };
    }
    snapshot = { ...snapshot, value: outcome.plan, issues: [], lastProgressAt: clock() };
    return { ok: true, snapshot, entityId: outcome.entityId };
  };
}

export function renderWorkspace(
  plan: MapPlan = SAMPLE_PLAN, record: MapRecord = SAMPLE_RECORD,
  extra: { actor?: MapActor; issues?: RowIssue[]; today?: IsoDate; ourName?: string; fileUrl?: string | null; reviewHref?: string | null } = {},
) {
  const initial = mapSnapshot(plan, record, extra.issues);
  const remote = vi.fn(localRemote(initial, 'Anna Keller'));
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const user = userEvent.setup();
  const { unmount } = render(
    <PlanWorkspace initial={initial} remote={remote} actor={extra.actor ?? OWNER} actorName="Anna Keller" today={extra.today ?? MAP_TODAY}
      ourName={extra.ourName ?? ''} ownerName="Anna Keller" fileUrl={extra.fileUrl ?? null} presentHref="/plans/map_test/present"
      reviewHref={extra.reviewHref === undefined ? '/plans/map_test/review' : extra.reviewHref} notify={notify} />,
  );
  return { remote, notify, user, unmount };
}

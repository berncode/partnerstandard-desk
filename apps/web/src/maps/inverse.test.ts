import { makeActivity, makePlan } from '@partner-desk/core/test-builders';
import { describe, expect, it } from 'vitest';
import { inverseOf } from './inverse';

const plan = makePlan({ activities: [makeActivity({ id: 'a_1', status: 'not_started', completedDate: null, title: 'Kickoff' })] });

describe('inverseOf', () => {
  it('restores the previous values of updated fields', () => {
    expect(inverseOf(plan, { kind: 'update', entity: 'activity', id: 'a_1', patch: { title: 'Kick-off' } }, null))
      .toEqual({ kind: 'update', entity: 'activity', id: 'a_1', patch: { title: 'Kickoff' } });
  });

  it('also restores the completed date when undoing a status change', () => {
    expect(inverseOf(plan, { kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'done' } }, null))
      .toEqual({ kind: 'update', entity: 'activity', id: 'a_1', patch: { status: 'not_started', completedDate: null } });
  });

  it('offers no undo for starting a horizon', () => {
    expect(inverseOf(plan, {
      kind: 'startHorizon', expectedStartDate: plan.info.startDate, expectedHorizon: 0, startDate: '2026-10-16', horizonDays: 90, milestones: [],
    }, null)).toBeNull();
  });

  it('restores the plan details as the person saw them: the current horizon’s length', () => {
    const later = makePlan({ info: { ...plan.info, horizonDays: 60 } });
    expect(inverseOf(later, { kind: 'updateInfo', patch: { horizonDays: 120 } }, null))
      .toEqual({ kind: 'updateInfo', patch: { horizonDays: 60 } });
  });

  it('undoes an add by deleting what it created', () => {
    expect(inverseOf(plan, { kind: 'add', entity: 'activity', values: { title: 'New' } }, 'a_new'))
      .toEqual({ kind: 'delete', entity: 'activity', id: 'a_new' });
  });

  it('has no inverse for deletes (they are held back instead) or for missing items', () => {
    expect(inverseOf(plan, { kind: 'delete', entity: 'activity', id: 'a_1' }, null)).toBeNull();
    expect(inverseOf(plan, { kind: 'update', entity: 'activity', id: 'a_gone', patch: { title: 'X' } }, null)).toBeNull();
  });
});

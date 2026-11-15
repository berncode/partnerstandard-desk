import { describe, expect, it } from 'vitest';
import { makeActivity, makeMilestone, makePerson, makePlan } from './test-builders';
import { findReferenceIssues } from './validate';

describe('findReferenceIssues', () => {
  it('returns nothing when references resolve', () => {
    const plan = makePlan({
      people: [makePerson()],
      milestones: [makeMilestone()],
      activities: [makeActivity({ ownerId: 'p_test01', milestoneId: 'm_test01' })],
    });
    expect(findReferenceIssues(plan)).toEqual([]);
  });

  it('reports dangling owners and milestones', () => {
    const plan = makePlan({ activities: [makeActivity({ ownerId: 'p_gone01', milestoneId: 'm_gone01' })] });
    expect(findReferenceIssues(plan)).toEqual([
      { entity: 'activity', id: 'a_test01', field: 'ownerId', message: 'Owner is no longer on the plan' },
      { entity: 'activity', id: 'a_test01', field: 'milestoneId', message: 'Milestone is no longer on the plan' },
    ]);
  });
});

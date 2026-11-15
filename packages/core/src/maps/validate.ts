// It reads only the rows, so it takes a stored MAP as well as a joined one.
import type { EntityKind, MapRows } from './types';

/** How names are compared wherever the sheet refers to a person or milestone by name: trimmed, case-insensitive, spaces collapsed. */
export const normalizeName = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');

export interface PlanIssue {
  entity: EntityKind;
  id: string;
  field: string;
  message: string;
}

export function findReferenceIssues(plan: Pick<MapRows, 'people' | 'milestones' | 'activities'>): PlanIssue[] {
  const people = new Set(plan.people.map((p) => p.id));
  const milestones = new Set(plan.milestones.map((m) => m.id));
  const issues: PlanIssue[] = [];
  for (const activity of plan.activities) {
    if (activity.ownerId && !people.has(activity.ownerId)) {
      issues.push({ entity: 'activity', id: activity.id, field: 'ownerId', message: 'Owner is no longer on the plan' });
    }
    if (activity.milestoneId && !milestones.has(activity.milestoneId)) {
      issues.push({ entity: 'activity', id: activity.id, field: 'milestoneId', message: 'Milestone is no longer on the plan' });
    }
  }
  return issues;
}

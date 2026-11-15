import { describe, expect, it } from 'vitest';
import { addDays } from './dates';
import { bundleByRecipient } from './notify-bundle';
import { nudgesFor } from './notify-evaluate';
import { makeActivity, makePerson, makePlan } from './test-builders';
import type { Activity } from './types';

const TODAY = '2026-10-20';
const people = [
  makePerson({ id: 'p_ben001', side: 'us', name: 'Ben Ito', email: 'ben@example.com' }),
  makePerson({ id: 'p_lena01', side: 'partner', name: 'Lena Ortiz', email: 'lena@example.com' }),
];
const items = (planId: string, activities: Array<Partial<Activity> & { days: number }>) => nudgesFor(planId, makePlan({
  people,
  activities: activities.map(({ days, ...a }, i) => makeActivity({ id: `a_${planId.slice(-1)}${i}`, ownerId: 'p_ben001', dueDate: addDays(TODAY, days), ...a })),
}), TODAY, 3);

describe('bundleByRecipient', () => {
  it('makes one bundle per address across plans: overdue first, most overdue first, then soonest due', () => {
    const bundles = bundleByRecipient([
      ...items('pl_000000000a', [{ title: 'Soon', days: 2 }, { title: 'Late', days: -2 }]),
      ...items('pl_000000000b', [{ title: 'Very late', days: -9 }, { title: 'Tomorrow', days: 1 }, { title: 'For Lena', days: 1, ownerId: 'p_lena01', side: 'partner' }]),
    ]);
    expect(bundles.map((b) => [b.email, b.personName, b.items.map((i) => i.title)])).toEqual([
      ['ben@example.com', 'Ben Ito', ['Very late', 'Late', 'Tomorrow', 'Soon']],
      ['lena@example.com', 'Lena Ortiz', ['For Lena']],
    ]);
  });

  it('is empty for no items', () => {
    expect(bundleByRecipient([])).toEqual([]);
  });
});

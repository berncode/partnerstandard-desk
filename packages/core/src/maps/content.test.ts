// The content in packages/method, checked against the domain. The other content checks live in
// packages/method/src/maps/content.test.ts.
import { describe, expect, expectTypeOf, it } from 'vitest';
import { PARTNER_TYPES, STAGES, buildSamplePlan, buildSampleRecord, starterActivities, type StarterCategory, type StarterSide } from '@partner-desk/method';
import { computeHealth } from './derived';
import { joinPlan } from './join';
import { MAP_ENTITY_SCHEMAS as ENTITY_SCHEMAS, mapInfoSchema, planInfoSchema } from './schemas';
import { TODAY } from './test-builders';
import { ACTIVITY_SIDES, CATEGORIES, type ActivitySide, type Category, type MapPlan, type MapRecord } from './types';
import { findReferenceIssues } from './validate';

describe('starter activities', () => {
  it('offers at least three distinct, valid starters for every partner type and stage', () => {
    for (const type of PARTNER_TYPES) {
      for (const stage of STAGES) {
        const starters = starterActivities(type, stage);
        expect(starters.length, `${type}/${stage}`).toBeGreaterThanOrEqual(3);
        expect(new Set(starters.map((s) => s.title)).size).toBe(starters.length);
        for (const s of starters) {
          expect(CATEGORIES).toContain(s.category);
          expect(ACTIVITY_SIDES).toContain(s.side);
        }
      }
    }
  });
});

describe('sample plan', () => {
  // Typed as the stored MAP: the method package builds it without importing core.
  const plan: MapPlan = buildSamplePlan(TODAY);
  const record: MapRecord = buildSampleRecord(TODAY);
  const joined = joinPlan(plan, record, TODAY);

  it('is valid and fully linked', () => {
    expect(mapInfoSchema.safeParse(plan.info).success).toBe(true);
    expect(planInfoSchema.safeParse(joined.info).success).toBe(true);
    const groups = [
      ['objective', plan.objectives], ['activity', plan.activities], ['person', plan.people],
      ['milestone', plan.milestones], ['exitTrigger', plan.exitTriggers],
    ] as const;
    for (const [entity, items] of groups) {
      for (const item of items) expect(ENTITY_SCHEMAS[entity].safeParse(item).success, `${entity} ${item.id}`).toBe(true);
    }
    expect(findReferenceIssues(plan)).toEqual([]);
  });

  it('shows one realistic risk: a blocked partner activity', () => {
    expect(computeHealth({ plan: joined, today: TODAY, lastEventAt: null })).toEqual({
      health: 'at_risk',
      reasons: [{ kind: 'overdue', activityId: 'a_sample4', days: 14 }],
    });
  });

  it('has objectives on both sides', () => {
    expect(plan.objectives.filter((o) => o.side === 'us').length).toBeGreaterThan(0);
    expect(plan.objectives.filter((o) => o.side === 'partner').length).toBeGreaterThan(0);
  });
});

describe('the method package’s words for the domain', () => {
  it('names the same categories and sides as the domain', () => {
    expectTypeOf<StarterCategory>().toEqualTypeOf<Category>();
    expectTypeOf<StarterSide>().toEqualTypeOf<ActivitySide>();
    expect([...CATEGORIES].sort()).toEqual(['marketing', 'other', 'product', 'sales']);
  });
});

// A person with a link is the MAP app's collaborator, and an agent acts at its grant's level.
import { describe, expect, it } from 'vitest';
import { canChangeMap as can, mapValidationFor as validationFor, type MapActor as Actor } from './access';
import type { MapChange as PlanChange } from './changes';
import { makeActivity, makeMapPlan as makePlan, makeObjective, makePerson } from './test-builders';

const plan = makePlan({
  people: [makePerson({ id: 'p_anna01' }), makePerson({ id: 'p_lena01', side: 'partner', name: 'Lena' })],
  objectives: [makeObjective({ id: 'o_us0001', side: 'us' }), makeObjective({ id: 'o_pa0001', side: 'partner' })],
  activities: [
    makeActivity({ id: 'a_us0001', side: 'us' }),
    makeActivity({ id: 'a_pa0001', side: 'partner' }),
    makeActivity({ id: 'a_jo0001', side: 'joint' }),
  ],
});

const owner: Actor = { kind: 'owner' };
const partner: Actor = { kind: 'link', personId: 'p_lena01', side: 'partner', name: 'Lena' };
const allowed = (actor: Actor, change: PlanChange) => can(actor, change, plan).allowed;

describe('can', () => {
  it('lets the owner do anything', () => {
    expect(allowed(owner, { kind: 'delete', entity: 'person', id: 'p_lena01' })).toBe(true);
    expect(allowed(owner, { kind: 'updateInfo', patch: { horizonDays: 60 } })).toBe(true);
  });

  it('lets a collaborator update status, note and due date on their side and joint activities', () => {
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_pa0001', patch: { status: 'done' } })).toBe(true);
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_jo0001', patch: { note: 'On it', dueDate: '2026-11-01' } })).toBe(true);
  });

  it('blocks collaborators from the other side and from other fields', () => {
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_us0001', patch: { status: 'done' } })).toBe(false);
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_pa0001', patch: { title: 'Renamed' } })).toBe(false);
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_pa0001', patch: { side: 'us' } })).toBe(false);
  });

  it('lets a collaborator add activities only on their side, owned by their side', () => {
    expect(allowed(partner, { kind: 'add', entity: 'activity', values: { title: 'Webinar', side: 'partner', ownerId: 'p_lena01' } })).toBe(true);
    expect(allowed(partner, { kind: 'add', entity: 'activity', values: { title: 'Webinar', side: 'us' } })).toBe(false);
    expect(allowed(partner, { kind: 'add', entity: 'activity', values: { title: 'Webinar', side: 'partner', ownerId: 'p_anna01' } })).toBe(false);
    expect(allowed(partner, { kind: 'add', entity: 'activity', values: { title: 'Webinar', side: 'partner', milestoneId: 'm_x' } })).toBe(false);
  });

  it('lets a collaborator edit and add objectives on their side only', () => {
    expect(allowed(partner, { kind: 'update', entity: 'objective', id: 'o_pa0001', patch: { statement: 'Grow' } })).toBe(true);
    expect(allowed(partner, { kind: 'update', entity: 'objective', id: 'o_us0001', patch: { statement: 'Grow' } })).toBe(false);
    expect(allowed(partner, { kind: 'add', entity: 'objective', values: { side: 'partner', statement: 'Grow' } })).toBe(true);
    expect(allowed(partner, { kind: 'add', entity: 'objective', values: { side: 'us', statement: 'Grow' } })).toBe(false);
  });

  it('denies collaborators plan info, deletes and other entities', () => {
    expect(allowed(partner, { kind: 'updateInfo', patch: { nextReviewDate: '2026-12-01' } })).toBe(false);
    expect(allowed(partner, { kind: 'delete', entity: 'activity', id: 'a_pa0001' })).toBe(false);
    expect(allowed(partner, { kind: 'update', entity: 'person', id: 'p_lena01', patch: { name: 'L' } })).toBe(false);
    expect(allowed(partner, { kind: 'add', entity: 'milestone', values: { name: 'M' } })).toBe(false);
  });

  it('denies updates to items that do not exist', () => {
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_nope01', patch: { status: 'done' } })).toBe(false);
  });

  it('denies unknown change kinds and malformed values or patches instead of throwing', () => {
    expect(allowed(partner, { kind: 'rename', entity: 'activity', id: 'a_pa0001' } as unknown as PlanChange)).toBe(false);
    const malformed = (change: Record<string, unknown>) => allowed(partner, change as unknown as PlanChange);
    for (const bad of [null, undefined, 'status', 42, ['status']]) {
      expect(malformed({ kind: 'update', entity: 'activity', id: 'a_pa0001', patch: bad })).toBe(false);
      expect(malformed({ kind: 'update', entity: 'objective', id: 'o_pa0001', patch: bad })).toBe(false);
      expect(malformed({ kind: 'add', entity: 'activity', values: bad })).toBe(false);
      expect(malformed({ kind: 'add', entity: 'objective', values: bad })).toBe(false);
    }
  });

  it('limits collaborator adds to the allowed activity fields', () => {
    expect(allowed(partner, { kind: 'add', entity: 'activity', values: { title: 'W', side: 'partner', completedDate: '2026-10-16' } })).toBe(false);
    expect(allowed(partner, { kind: 'add', entity: 'activity', values: { title: 'W', side: 'partner', milestoneId: 'm_x' } })).toBe(false);
    expect(allowed(partner, { kind: 'add', entity: 'activity', values: { title: 'W', side: 'partner', ownerId: null } })).toBe(true);
  });

  it('lets a collaborator set the completed date on their own and joint activities', () => {
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_pa0001', patch: { completedDate: '2026-10-16' } })).toBe(true);
    expect(allowed(partner, { kind: 'update', entity: 'activity', id: 'a_jo0001', patch: { completedDate: '2026-10-16' } })).toBe(true);
  });

  it('blocks collaborators from the other side’s objectives and from moving objectives between sides', () => {
    expect(allowed(partner, { kind: 'update', entity: 'objective', id: 'o_us0001', patch: { successMeasure: 'More' } })).toBe(false);
    expect(allowed(partner, { kind: 'update', entity: 'objective', id: 'o_pa0001', patch: { side: 'us' } })).toBe(false);
    expect(allowed(partner, { kind: 'update', entity: 'objective', id: 'o_pa0001', patch: { statement: 'Grow', side: 'partner' } })).toBe(false);
  });

  it('explains why', () => {
    expect(can(partner, { kind: 'delete', entity: 'activity', id: 'a_pa0001' }, plan)).toEqual({
      allowed: false, reason: 'Only the plan owner can delete items',
    });
  });
});

describe('validationFor', () => {
  it('checks whole rows for owners and only patched fields for collaborators', () => {
    expect(validationFor(owner)).toBe('row');
    expect(validationFor(partner)).toBe('patch');
  });
});

describe('can: startHorizon', () => {
  const start: PlanChange = {
    kind: 'startHorizon', expectedStartDate: '2026-10-10', expectedHorizon: 0, startDate: '2026-10-20', horizonDays: 90, milestones: [],
  };

  it('is the owner’s alone', () => {
    expect(can(owner, start, plan)).toEqual({ allowed: true });
    expect(can(partner, start, plan)).toEqual({ allowed: false, reason: 'Only the plan owner can start the next horizon' });
    const usSide: Actor = { ...partner, side: 'us' };
    expect(can(usSide, start, plan).allowed).toBe(false);
  });
});

describe('can: an agent', () => {
  const agent = (level: 'read' | 'change' | 'propose'): Actor => ({ kind: 'agent', level });
  const update: PlanChange = { kind: 'update', entity: 'activity', id: 'a_us0001', patch: { status: 'done' } };

  it('changes plan details, rows and both sides at level change, as the owner it acts for', () => {
    expect(can(agent('change'), update, plan)).toEqual({ allowed: true });
    expect(allowed(agent('change'), { kind: 'update', entity: 'activity', id: 'a_pa0001', patch: { title: 'Renamed' } })).toBe(true);
    expect(allowed(agent('change'), { kind: 'add', entity: 'person', values: { name: 'Priya', side: 'partner' } })).toBe(true);
    expect(allowed(agent('change'), { kind: 'updateInfo', patch: { nextReviewDate: '2026-12-01' } })).toBe(true);
  });

  it('changes nothing at level read or propose', () => {
    expect(can(agent('read'), update, plan)).toEqual({ allowed: false, reason: 'This agent can only read this MAP' });
    expect(can(agent('propose'), update, plan)).toEqual({ allowed: false, reason: 'This agent can only propose changes to this MAP' });
  });

  it('never starts a horizon or deletes, at any level', () => {
    const start: PlanChange = { kind: 'startHorizon', expectedStartDate: '2026-10-10', expectedHorizon: 0, startDate: '2026-10-20', horizonDays: 90, milestones: [] };
    expect(can(agent('change'), start, plan)).toEqual({ allowed: false, reason: 'Only a person can start the next horizon' });
    expect(can(agent('change'), { kind: 'delete', entity: 'activity', id: 'a_us0001' }, plan)).toEqual({ allowed: false, reason: 'Only a person can delete items' });
  });

  it('denies an unknown change kind', () => {
    expect(can(agent('change'), { kind: 'signAgreement' } as unknown as PlanChange, plan)).toEqual({ allowed: false, reason: 'This change isn’t supported' });
  });

  it('checks whole rows, as the owner', () => {
    expect(validationFor(agent('change'))).toBe('row');
  });
});

describe('can: reviews', () => {
  const reviewChanges: PlanChange[] = [
    { kind: 'add', entity: 'review', values: { horizon: 1 } },
    { kind: 'update', entity: 'review', id: 'rv_000001', patch: { decisions: 'x' } },
    { kind: 'delete', entity: 'review', id: 'rv_000001' },
    { kind: 'add', entity: 'reviewNumber', values: { reviewId: 'rv_000001' } },
    { kind: 'update', entity: 'reviewNumber', id: 'rn_000001', patch: { actual: 1 } },
    { kind: 'delete', entity: 'reviewNumber', id: 'rn_000001' },
    { kind: 'add', entity: 'reviewItem', values: { reviewId: 'rv_000001', side: 'us' } },
    { kind: 'update', entity: 'reviewItem', id: 'ri_000001', patch: { note: 'x' } },
    { kind: 'delete', entity: 'reviewItem', id: 'ri_000001' },
  ];
  const us: Actor = { kind: 'link', personId: 'p_anna01', side: 'us', name: 'Anna' };

  it('a link holder may not add, update or delete a review, a review number or a review item', () => {
    for (const actor of [us, partner]) {
      for (const change of reviewChanges) expect(can(actor, change, plan)).toEqual(can(actor, { kind: 'updateInfo', patch: {} }, plan));
      for (const change of reviewChanges) expect(allowed(actor, change)).toBe(false);
    }
  });

  it('lets the owner change them', () => {
    for (const change of reviewChanges) expect(allowed(owner, change)).toBe(true);
  });
});

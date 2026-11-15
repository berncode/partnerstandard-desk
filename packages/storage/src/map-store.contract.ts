// The MAP app's typed changes on a MAP file, with the partner record's facts carried on each change. Hand edits
// behind `raw`, as for the Partners file.
import { describe, expect, it, type TestContext } from 'vitest';
import {
  closeReviewChanges, joinPlan, MAP_COLLECTION, withoutReviews, type ChangeStamp, type EntityKind, type MapChange, type MapPlan, type MapRecord,
} from '@partner-desk/core';
import { buildSamplePlan, buildSampleRecord } from '@partner-desk/method';
import { expectOk, NOW, snapshotOf, STALE, without } from './contract-helpers';
import type { ContractHarness, FileRef, MapFileChange, MapStore } from './types';

const COMPANY_ID = 'co_contract01';
const PARTNER_NAME = 'Brightwave Systems';
const TODAY = NOW.slice(0, 10);

const ENTITIES = Object.keys(MAP_COLLECTION) as EntityKind[];
type Item = { id: string } & Record<string, unknown>;
const itemsOf = (plan: MapPlan, entity: EntityKind) => plan[MAP_COLLECTION[entity]] as unknown as Item[];
/** The kinds the generic add, update and delete case covers. A review's numbers and items need their review: see below. */
type ListKind = Exclude<EntityKind, 'reviewNumber' | 'reviewItem'>;
const an = (entity: string) => `${/^[aeiou]/.test(entity) ? 'an' : 'a'} ${entity}`;

/** Values for an add and a patch for an update, per entity. */
const CASES: Record<ListKind, { add: Record<string, unknown>; patch: Record<string, unknown> }> = {
  objective: { add: { side: 'partner', statement: 'Two certified engineers', successMeasure: 'Certificates by day 60' }, patch: { successMeasure: 'By day 45' } },
  activity: { add: { title: 'Plan the first joint event', category: 'marketing', side: 'joint', dueDate: '2026-12-01' }, patch: { status: 'in_progress', note: 'Venue booked' } },
  person: { add: { side: 'partner', name: 'Jonas Brandt', title: 'Presales', email: 'jonas@example.com', role: 'technical_lead' }, patch: { title: 'Head of Presales' } },
  milestone: { add: { name: 'Day 120: Second deal', targetDate: '2027-01-15', criteria: 'A second signed deal' }, patch: { criteria: 'Two signed deals' } },
  exitTrigger: { add: { condition: 'No joint pipeline after 120 days', status: 'watch' }, patch: { status: 'triggered' } },
  review: { add: { horizon: 1, nextHorizonDays: 60, decisions: 'Run the webinar again', includeScorecard: true }, patch: { relationshipNote: 'Warm' } },
};
const LIST_KINDS = Object.keys(CASES) as ListKind[];

/** Every MapStore implementation must pass this suite. */
export function runMapStoreContract(name: string, make: () => ContractHarness<MapStore>): void {
  describe(`MapStore contract: ${name}`, () => {
    const stamp: ChangeStamp = { now: NOW, actor: 'Ruth' };
    const record = buildSampleRecord(TODAY) as MapRecord;
    const sample = () => buildSamplePlan(TODAY) as MapPlan;
    const change = (c: MapChange, r: MapRecord = record): MapFileChange => ({ ...c, record: r });

    /** A new MAP file holding the sample plan. */
    async function made() {
      const harness = make();
      const plan = sample();
      const file = await harness.store.create(harness.owner, COMPANY_ID, plan, PARTNER_NAME);
      const ref: FileRef = { fileId: file.fileId };
      return { ...harness, plan, file, ref };
    }

    async function apply(store: MapStore, ref: FileRef, c: MapChange, r?: MapRecord) {
      return expectOk(await store.apply(ref, change(c, r), stamp));
    }

    /** Every row of every kind is as in `before`, except the one `except` names. */
    function expectOthersUnchanged(after: MapPlan, before: MapPlan, except: { entity: EntityKind; id: string | null } | null) {
      expect(after.info).toEqual(before.info);
      for (const entity of ENTITIES) {
        const skip = except && entity === except.entity ? except.id : null;
        expect(without(itemsOf(after, entity), skip)).toEqual(without(itemsOf(before, entity), skip));
      }
    }

    it('links to the file it created', async () => {
      const { store, file } = await made();
      expect(store.urlFor({ fileId: file.fileId })).toBe(file.fileUrl);
    });

    it('reads back the sample plan it was made with', async () => {
      const { store, ref } = await made();
      const snapshot = snapshotOf(await store.read(ref));
      expect(snapshot.value).toEqual(sample());
      expect(snapshot.issues).toEqual([]);
    });

    it('keeps two files apart', async () => {
      const { store, owner } = make();
      const a = await store.create(owner, COMPANY_ID, sample(), PARTNER_NAME);
      const other: MapPlan = { ...sample(), info: { ...sample().info, partnerId: 'p_other', partnerType: 'var' }, activities: [] };
      const b = await store.create(owner, COMPANY_ID, other, 'Omega GmbH');
      expect(a.fileId).not.toBe(b.fileId);
      expect(snapshotOf(await store.read({ fileId: a.fileId })).value).toEqual(sample());
      expect(snapshotOf(await store.read({ fileId: b.fileId })).value).toEqual(other);
    });

    for (const entity of LIST_KINDS) {
      it(`adds, updates and deletes ${an(entity)}, and leaves everything else alone`, async () => {
        const { store, ref, plan } = await made();
        const { add, patch } = CASES[entity];
        const added = await apply(store, ref, { kind: 'add', entity, values: add });
        expect(added.entityId).toEqual(expect.any(String));
        const afterAdd = snapshotOf(await store.read(ref));
        expect(added.snapshot).toEqual(afterAdd);
        expect(itemsOf(afterAdd.value, entity).at(-1)).toMatchObject({ ...add, id: added.entityId });
        expectOthersUnchanged(afterAdd.value, plan, { entity, id: added.entityId });

        await apply(store, ref, { kind: 'update', entity, id: added.entityId!, patch });
        const afterUpdate = snapshotOf(await store.read(ref)).value;
        expect(itemsOf(afterUpdate, entity).find((item) => item.id === added.entityId)).toMatchObject({ ...add, ...patch });
        expectOthersUnchanged(afterUpdate, plan, { entity, id: added.entityId });

        const deleted = await apply(store, ref, { kind: 'delete', entity, id: added.entityId! });
        expect(deleted.entityId).toBeNull();
        expect(snapshotOf(await store.read(ref)).value).toEqual(plan);
      });
    }

    it('stamps an activity it changes, and fills or clears its completed date', async () => {
      const { store, ref, plan } = await made();
      const open = plan.activities.find((a) => a.status === 'not_started')!;
      await apply(store, ref, { kind: 'update', entity: 'activity', id: open.id, patch: { status: 'done' }, expectedUpdatedAt: open.updatedAt });
      const done = snapshotOf(await store.read(ref)).value.activities.find((a) => a.id === open.id);
      expect(done).toEqual({ ...open, status: 'done', completedDate: TODAY, updatedAt: NOW, updatedBy: 'Ruth' });
      await apply(store, ref, { kind: 'update', entity: 'activity', id: open.id, patch: { status: 'in_progress' }, expectedUpdatedAt: NOW });
      expect(snapshotOf(await store.read(ref)).value.activities.find((a) => a.id === open.id)).toMatchObject({ status: 'in_progress', completedDate: null });
    });

    it('refuses a stale change to an activity as a conflict, and writes nothing', async () => {
      const { store, ref, raw, plan } = await made();
      const activity = plan.activities[0]!;
      const dumpBefore = raw && (await raw.dump(ref.fileId));
      const result = await store.apply(ref, change({ kind: 'update', entity: 'activity', id: activity.id, patch: { note: 'x' }, expectedUpdatedAt: STALE }), stamp);
      expect(result).toMatchObject({ ok: false, error: 'conflict', message: `Updated by ${activity.updatedBy} since you opened it` });
      expect(snapshotOf(await store.read(ref)).value).toEqual(plan);
      if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);
    });

    it('renames a person and keeps the activities they own', async () => {
      const { store, ref, plan } = await made();
      const owner = plan.people.find((p) => plan.activities.some((a) => a.ownerId === p.id))!;
      await apply(store, ref, { kind: 'update', entity: 'person', id: owner.id, patch: { name: 'Anna Keller-Roth' } });
      const after = snapshotOf(await store.read(ref));
      expect(after.issues).toEqual([]);
      expect(after.value.people.find((p) => p.id === owner.id)!.name).toBe('Anna Keller-Roth');
      expect(after.value.activities).toEqual(plan.activities);
    });

    it('deletes a milestone and clears it from its activities', async () => {
      const { store, ref, plan } = await made();
      const milestone = plan.milestones[0]!;
      await apply(store, ref, { kind: 'delete', entity: 'milestone', id: milestone.id });
      const after = snapshotOf(await store.read(ref)).value;
      expect(after.milestones.map((m) => m.id)).toEqual(plan.milestones.slice(1).map((m) => m.id));
      expect(after.activities).toEqual(plan.activities.map((a) => (a.milestoneId === milestone.id ? { ...a, milestoneId: null } : a)));
    });

    it('refuses a second person with a name already on the plan, and writes nothing', async () => {
      const { store, ref, plan } = await made();
      const result = await store.apply(ref, change({ kind: 'add', entity: 'person', values: { side: 'us', name: ` ${plan.people[0]!.name.toUpperCase()} `, role: 'other' } }), stamp);
      expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { name: expect.any(String) } });
      expect(snapshotOf(await store.read(ref)).value).toEqual(plan);
    });

    it('sets the next review and the horizon length, then starts the next horizon', async () => {
      const { store, ref, plan } = await made();
      await apply(store, ref, { kind: 'updateInfo', patch: { nextReviewDate: '2026-12-15', horizonDays: 120 } });
      const info = snapshotOf(await store.read(ref)).value.info;
      expect(info).toEqual({ ...plan.info, nextReviewDate: '2026-12-15', horizonDays: 120 });

      const started = await apply(store, ref, {
        kind: 'startHorizon', expectedStartDate: record.signedDate!, expectedHorizon: 0, startDate: TODAY, horizonDays: 60,
        milestones: [{ name: 'Day 30 of the new horizon', criteria: 'Ten opportunities', day: 30 }],
      });
      const after = snapshotOf(await store.read(ref)).value;
      expect(started.snapshot.value).toEqual(after);
      expect(after.info).toEqual({ ...info, laterHorizons: [{ startDate: TODAY, horizonDays: 60 }] });
      expect(after.milestones.at(-1)).toMatchObject({ name: 'Day 30 of the new horizon', criteria: 'Ten opportunities', achievedDate: null });
      // A change to the length now goes to the later horizon.
      await apply(store, ref, { kind: 'updateInfo', patch: { horizonDays: 90 } });
      expect(snapshotOf(await store.read(ref)).value.info).toEqual({ ...info, laterHorizons: [{ startDate: TODAY, horizonDays: 90 }] });
    });

    it('refuses a new horizon before the partner type is signed, and writes nothing', async () => {
      const { store, ref, plan } = await made();
      const unsigned = { ...record, stage: 'recruitment', signedDate: null } as MapRecord;
      const result = await store.apply(ref, change({
        kind: 'startHorizon', expectedStartDate: TODAY, expectedHorizon: 0, startDate: TODAY, horizonDays: 60, milestones: [],
      }, unsigned), stamp);
      expect(result).toMatchObject({ ok: false, error: 'invalid' });
      expect(snapshotOf(await store.read(ref)).value).toEqual(plan);
    });

    it('applies a batch in one go, or nothing when a change is refused, saying how many came before it', async () => {
      const { store, ref, raw, plan } = await made();
      const dumpBefore = raw && (await raw.dump(ref.fileId));
      const refused = await store.applyMany(ref, [
        change({ kind: 'add', entity: 'objective', values: CASES.objective.add }),
        change({ kind: 'update', entity: 'person', id: 'p_missing', patch: { title: 'x' } }),
      ], stamp);
      expect(refused).toMatchObject({ ok: false, error: 'not_found', valid: 1 });
      expect(snapshotOf(await store.read(ref)).value).toEqual(plan);
      if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);

      const done = expectOk(await store.applyMany(ref, [
        change({ kind: 'add', entity: 'objective', values: CASES.objective.add }),
        change({ kind: 'add', entity: 'exitTrigger', values: CASES.exitTrigger.add }),
        change({ kind: 'updateInfo', patch: { nextReviewDate: '2027-01-10' } }),
      ], stamp));
      expect(done.entityIds).toEqual([expect.any(String), expect.any(String), null]);
      const after = snapshotOf(await store.read(ref)).value;
      expect(done.snapshot.value).toEqual(after);
      expect(after.objectives.at(-1)).toMatchObject({ id: done.entityIds[0], ...CASES.objective.add });
      expect(after.exitTriggers.at(-1)).toMatchObject({ id: done.entityIds[1], ...CASES.exitTrigger.add });
      expect(after.info.nextReviewDate).toBe('2027-01-10');
    });

    it('reports not_found for a missing id and invalid for a bad value, and writes nothing', async () => {
      const { store, ref, plan } = await made();
      expect(await store.apply(ref, change({ kind: 'update', entity: 'objective', id: 'o_missing', patch: { statement: 'x' } }), stamp))
        .toMatchObject({ ok: false, error: 'not_found' });
      expect(await store.apply(ref, change({ kind: 'delete', entity: 'exitTrigger', id: 'x_missing' }), stamp)).toMatchObject({ ok: false, error: 'not_found' });
      expect(await store.apply(ref, change({ kind: 'add', entity: 'objective', values: { side: 'us', statement: ' ' } }), stamp))
        .toMatchObject({ ok: false, error: 'invalid', fieldErrors: { statement: expect.any(String) } });
      expect(snapshotOf(await store.read(ref)).value).toEqual(plan);
    });

    it('does not change the file when a returned snapshot is mutated', async () => {
      const { store, ref, plan } = await made();
      const read = snapshotOf(await store.read(ref));
      read.value.activities[0]!.title = 'Changed by the caller';
      read.value.info.laterHorizons.push({ startDate: TODAY, horizonDays: 30 });
      expect(snapshotOf(await store.read(ref)).value).toEqual(plan);
    });

    /** Values for a review's numbers and items, by the review they belong to. */
    const number = (reviewId: string, values: Record<string, unknown>) => change({ kind: 'add', entity: 'reviewNumber', values: { reviewId, ...values } });
    const item = (reviewId: string, values: Record<string, unknown>) => change({ kind: 'add', entity: 'reviewItem', values: { reviewId, ...values } });

    /** The made file with a review in prep, two numbers and two items (a commitment and a hypothesis answer). */
    async function withReview<S extends Awaited<ReturnType<typeof made>>>(seed?: S) {
      const env = seed ?? ((await made()) as S);
      const { store, ref, plan } = env;
      const review = (await apply(store, ref, { kind: 'add', entity: 'review', values: CASES.review.add })).entityId!;
      const rows = expectOk(await store.applyMany(ref, [
        number(review, { key: 'dealsWon', actual: 2, target: 3, source: 'sales', note: 'One more in March', nextTarget: 4 }),
        number(review, { key: 'weBill', actual: 12500.5 }),
        item(review, {
          kind: 'commitment', title: 'Train five more sellers', side: 'partner', ownerId: plan.people[2]!.id, dueDate: '2027-01-20',
          milestoneId: plan.milestones[1]!.id,
        }),
        item(review, { kind: 'hypothesis', refId: 'hy_contract1', answer: 'changed', note: 'Buyers moved to yearly plans' }),
      ], stamp));
      const [n1, n2, i1, i2] = rows.entityIds as string[];
      return { ...env, review, numbers: [n1!, n2!], items: [i1!, i2!] };
    }

    it('a review with numbers and items round-trips', async () => {
      const { store, ref, plan, review, numbers, items } = await withReview();
      const read = snapshotOf(await store.read(ref));
      expect(read.issues).toEqual([]);
      expect(withoutReviews(read.value)).toEqual(plan);
      expect(read.value.reviews).toEqual([{
        id: review, horizon: 1, state: 'prep', heldOn: null, caseId: null, decisions: 'Run the webinar again', relationshipNote: '',
        nextHorizonDays: 60, includeScorecard: true, summarySentAt: null, summarySentTo: '', updatedAt: NOW, updatedBy: 'Ruth',
      }]);
      expect(read.value.reviewNumbers).toEqual([
        { id: numbers[0], reviewId: review, key: 'dealsWon', actual: 2, target: 3, source: 'sales', note: 'One more in March', nextTarget: 4 },
        { id: numbers[1], reviewId: review, key: 'weBill', actual: 12500.5, target: null, source: null, note: '', nextTarget: null },
      ]);
      expect(read.value.reviewItems).toEqual([
        {
          id: items[0], reviewId: review, kind: 'commitment', refId: null, title: 'Train five more sellers', side: 'partner',
          ownerId: plan.people[2]!.id, dueDate: '2027-01-20', milestoneId: plan.milestones[1]!.id, answer: null, note: '', moved: false,
        },
        {
          id: items[1], reviewId: review, kind: 'hypothesis', refId: 'hy_contract1', title: '', side: null, ownerId: null, dueDate: null,
          milestoneId: null, answer: 'changed', note: 'Buyers moved to yearly plans', moved: false,
        },
      ]);

      const updated = expectOk(await store.applyMany(ref, [
        change({ kind: 'update', entity: 'reviewNumber', id: numbers[1]!, patch: { target: 15000, source: 'finance' } }),
        change({ kind: 'update', entity: 'reviewItem', id: items[0]!, patch: { moved: true } }),
        change({
          kind: 'update', entity: 'review', id: review, patch: { caseId: 'bc_contract1', summarySentAt: NOW, summarySentTo: 'Lena Ortiz, Tom Berger' },
          expectedUpdatedAt: NOW,
        }),
      ], stamp));
      const after = snapshotOf(await store.read(ref));
      expect(updated.snapshot).toEqual(after);
      expect(after.value.reviewNumbers[1]).toMatchObject({ target: 15000, source: 'finance', actual: 12500.5 });
      expect(after.value.reviewItems[0]).toMatchObject({ moved: true, title: 'Train five more sellers' });
      expect(after.value.reviews[0]).toMatchObject({
        caseId: 'bc_contract1', summarySentAt: NOW, summarySentTo: 'Lena Ortiz, Tom Berger', decisions: 'Run the webinar again',
      });
      expect(withoutReviews(after.value)).toEqual(plan);
    });

    it('a review item names its owner and milestone as an activity does: a rename keeps the link, a delete clears it', async () => {
      const { store, ref, raw, plan, items } = await withReview();
      const owner = plan.people[2]!;
      const milestone = plan.milestones[1]!;
      await apply(store, ref, { kind: 'update', entity: 'person', id: owner.id, patch: { name: 'Priya Shah-Lee' } });
      await apply(store, ref, { kind: 'update', entity: 'milestone', id: milestone.id, patch: { name: 'Day 60: First deal together' } });
      const renamed = snapshotOf(await store.read(ref));
      expect(renamed.issues).toEqual([]);
      expect(renamed.value.reviewItems[0]).toMatchObject({ id: items[0], ownerId: owner.id, milestoneId: milestone.id });
      if (raw) {
        expect(await raw.fieldOf(ref.fileId, 'reviewItem', items[0]!, 'ownerId')).toBe('Priya Shah-Lee');
        expect(await raw.fieldOf(ref.fileId, 'reviewItem', items[0]!, 'milestoneId')).toBe('Day 60: First deal together');
      }

      await apply(store, ref, { kind: 'delete', entity: 'person', id: owner.id });
      await apply(store, ref, { kind: 'delete', entity: 'milestone', id: milestone.id });
      const deleted = snapshotOf(await store.read(ref));
      expect(deleted.issues).toEqual([]);
      expect(deleted.value.reviewItems[0]).toMatchObject({ id: items[0], ownerId: null, milestoneId: null, title: 'Train five more sellers' });
      if (raw) expect(await raw.fieldOf(ref.fileId, 'reviewItem', items[0]!, 'ownerId')).toBe('');
    });

    it('deleting a review removes its numbers and items in the file', async () => {
      const { store, ref, raw, plan, review } = await withReview();
      const other = (await apply(store, ref, { kind: 'add', entity: 'review', values: { horizon: 2, nextHorizonDays: 90 } })).entityId!;
      const kept = expectOk(await store.applyMany(ref, [number(other, { key: 'openDeals', actual: 5 }), item(other, { kind: 'blocker', title: 'No demo kit' })], stamp));
      const read = snapshotOf(await store.read(ref)).value;

      await apply(store, ref, { kind: 'delete', entity: 'review', id: review });
      const after = snapshotOf(await store.read(ref));
      expect(after.issues).toEqual([]);
      expect(after.value.reviews.map((r) => r.id)).toEqual([other]);
      expect(after.value.reviewNumbers).toEqual(read.reviewNumbers.filter((n) => n.reviewId === other));
      expect(after.value.reviewItems).toEqual(read.reviewItems.filter((i) => i.reviewId === other));
      expect(withoutReviews(after.value)).toEqual(plan);
      if (raw) {
        expect(await raw.rowIds(ref.fileId, 'review')).toEqual([other]);
        expect(await raw.rowIds(ref.fileId, 'reviewNumber')).toEqual([kept.entityIds[0]]);
        expect(await raw.rowIds(ref.fileId, 'reviewItem')).toEqual([kept.entityIds[1]]);
      }
    });

    it('an add with a server-chosen id keeps it, so a later change in the same batch can name the new row', async () => {
      const { store, ref, raw, plan } = await made();
      const reviewId = 'rv_chosen001';
      const done = expectOk(await store.applyMany(ref, [
        { ...change({ kind: 'add', entity: 'review', values: { horizon: 1, nextHorizonDays: 90 } }), newId: reviewId },
        change({ kind: 'add', entity: 'reviewItem', values: { reviewId, kind: 'blocker', title: 'No demo kit' } }),
      ], stamp));
      expect(done.entityIds[0]).toBe(reviewId);
      const after = snapshotOf(await store.read(ref));
      expect(after.issues).toEqual([]);
      expect(after.value.reviews.map((r) => r.id)).toEqual([reviewId]);
      expect(after.value.reviewItems).toEqual([expect.objectContaining({ id: done.entityIds[1], reviewId, title: 'No demo kit' })]);
      expect(withoutReviews(after.value)).toEqual(plan);
      if (raw) expect(await raw.rowIds(ref.fileId, 'review')).toEqual([reviewId]);
    });

    it('a closing batch (startHorizon, adds, updates, updateInfo) is written all or nothing', async () => {
      const seed = await withReview();
      const { store, ref, raw, review, items } = seed;
      const current = snapshotOf(await store.read(ref)).value;
      const closing = closeReviewChanges(joinPlan(current, record, TODAY), { reviewId: review, heldOn: TODAY, today: TODAY });
      if (!closing.ok) throw new Error('the review can’t be closed');
      // The fourth: horizon 1's business review milestone, achieved on the day the review was held.
      expect(closing.changes.map((c) => c.kind)).toEqual(['startHorizon', 'add', 'update', 'update', 'update', 'updateInfo']);
      const [start, add, moved, milestone, held, info] = closing.changes;
      if (held!.kind !== 'update' || milestone!.kind !== 'update' || milestone!.entity !== 'milestone') throw new Error('expected the updates');

      // The third change conflicts: the review's update, made against a review a second tab changed meanwhile.
      const dumpBefore = raw && (await raw.dump(ref.fileId));
      const refused = await store.applyMany(ref, [start!, add!, { ...held!, expectedUpdatedAt: STALE }, moved!, milestone!, info!].map((c) => change(c)), stamp);
      expect(refused).toMatchObject({ ok: false, error: 'conflict', valid: 2 });
      expect(snapshotOf(await store.read(ref)).value).toEqual(current);
      if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);

      const done = expectOk(await store.applyMany(ref, closing.changes.map((c) => change(c)), stamp));
      const after = snapshotOf(await store.read(ref));
      expect(done.snapshot).toEqual(after);
      expect(after.issues).toEqual([]);
      expect(after.value.info).toEqual({ ...current.info, laterHorizons: [{ startDate: TODAY, horizonDays: 60 }], nextReviewDate: null });
      expect(after.value.activities.at(-1)).toMatchObject({ id: done.entityIds[1], title: 'Train five more sellers', side: 'partner', status: 'not_started' });
      expect(after.value.reviewItems.find((i) => i.id === items[0])).toMatchObject({ moved: true });
      expect(after.value.reviews).toEqual([{ ...current.reviews[0]!, state: 'held', heldOn: TODAY, updatedAt: NOW, updatedBy: 'Ruth' }]);
      expect(after.value.milestones.find((m) => m.id === milestone!.id)).toMatchObject({ name: 'Day 90: First business review', achievedDate: TODAY });
    });

    describe('hand edits', () => {
      /** The made file with its raw access; the case is skipped when the adapter gives none. */
      async function edited(ctx: TestContext) {
        const seed = await made();
        if (!seed.raw) ctx.skip();
        return { ...seed, raw: seed.raw! };
      }

      describe('the review tabs', () => {
        it('a number cell typed "12k" reads as null with a problem, and the row is not overwritten by a save of another row', async (ctx) => {
          const seed = await edited(ctx);
          const { store, ref, raw, review, numbers, items } = await withReview(seed);
          await raw.typeCell(ref.fileId, 'reviewNumber', numbers[0]!, 'actual', '12k');
          const typed = await raw.rowOf(ref.fileId, 'reviewNumber', numbers[0]!);
          const read = snapshotOf(await store.read(ref));
          expect(read.value.reviewNumbers[0]).toMatchObject({ id: numbers[0], actual: null, target: 3, note: 'One more in March' });
          expect(read.issues).toEqual([{ tab: 'Review numbers', row: 2, message: 'Actual must be a number, like 12000 or 12.5, or empty' }]);

          await apply(store, ref, { kind: 'update', entity: 'reviewNumber', id: numbers[1]!, patch: { note: 'From the invoice list' } });
          await apply(store, ref, { kind: 'update', entity: 'review', id: review, patch: { decisions: 'Webinar in March' } });
          await apply(store, ref, { kind: 'update', entity: 'reviewItem', id: items[1]!, patch: { answer: 'holds' } });
          await store.applyMany(ref, [number(review, { key: 'openDeals', actual: 4 })], stamp);
          expect(await raw.rowOf(ref.fileId, 'reviewNumber', numbers[0]!)).toEqual(typed);
          // A change to another field of the row keeps what was typed; setting the number writes it.
          await apply(store, ref, { kind: 'update', entity: 'reviewNumber', id: numbers[0]!, patch: { note: 'Checked' } });
          expect(await raw.fieldOf(ref.fileId, 'reviewNumber', numbers[0]!, 'actual')).toBe('12k');
          await apply(store, ref, { kind: 'update', entity: 'reviewNumber', id: numbers[0]!, patch: { actual: 12000 } });
          expect(await raw.fieldOf(ref.fileId, 'reviewNumber', numbers[0]!, 'actual')).toBe(12000);
          expect(snapshotOf(await store.read(ref)).issues).toEqual([]);
        });

        it('items whose review row is gone are left out of the plan and never deleted by a save', async (ctx) => {
          const seed = await edited(ctx);
          const { store, ref, raw, plan, review, numbers, items } = await withReview(seed);
          const other = (await apply(store, ref, { kind: 'add', entity: 'review', values: { horizon: 2, nextHorizonDays: 90 } })).entityId!;
          const blocker = (await store.applyMany(ref, [item(other, { kind: 'blocker', title: 'No demo kit' })], stamp));
          const rows = async (entity: string, ids: string[]) => Promise.all(ids.map((id) => raw.rowOf(ref.fileId, entity, id)));
          await raw.deleteRow(ref.fileId, 'review', review);
          const orphanNumbers = await rows('reviewNumber', numbers);
          const orphanItems = await rows('reviewItem', items);

          const read = snapshotOf(await store.read(ref));
          expect(read.value.reviews.map((r) => r.id)).toEqual([other]);
          expect(read.value.reviewNumbers).toEqual([]);
          expect(read.value.reviewItems.map((i) => i.id)).toEqual([expectOk(blocker).entityIds[0]]);
          expect(read.issues.map((i) => i.tab)).toEqual(['Review numbers', 'Review numbers', 'Review items', 'Review items']);
          expect(await store.apply(ref, change({ kind: 'update', entity: 'reviewItem', id: items[0]!, patch: { moved: true } }), stamp))
            .toMatchObject({ ok: false, error: 'not_found' });
          expect(await store.apply(ref, change({ kind: 'delete', entity: 'reviewNumber', id: numbers[0]! }), stamp)).toMatchObject({ ok: false, error: 'not_found' });

          await apply(store, ref, { kind: 'update', entity: 'review', id: other, patch: { decisions: 'Next time' } });
          await store.applyMany(ref, [item(other, { kind: 'commitment', title: 'Book the room' })], stamp);
          await apply(store, ref, { kind: 'delete', entity: 'review', id: other });
          expect(await rows('reviewNumber', numbers)).toEqual(orphanNumbers);
          expect(await rows('reviewItem', items)).toEqual(orphanItems);
          expect(await raw.rowIds(ref.fileId, 'reviewNumber')).toEqual(numbers);
          expect(await raw.rowIds(ref.fileId, 'reviewItem')).toEqual(items);
          expect(withoutReviews(snapshotOf(await store.read(ref)).value)).toEqual(plan);
        });

        it('an item added against an activity typed without an ID links the activity’s new ID in the file', async (ctx) => {
          const seed = await edited(ctx);
          const { store, ref, raw, review } = await withReview(seed);
          await raw.typeRowWithoutId(ref.fileId, 'activity', { title: 'Typed in the sheet', category: 'sales', side: 'us', status: 'in_progress' });
          const provisional = snapshotOf(await store.read(ref)).value.activities.at(-1)!.id;
          const added = expectOk(await store.applyMany(ref, [
            item(review, { kind: 'notDone', refId: provisional, title: 'Typed in the sheet', note: 'Waiting for the partner' }),
          ], stamp));
          const activityId = (await raw.rowIds(ref.fileId, 'activity')).at(-1)!;
          expect(activityId).not.toBe('');
          expect(activityId).not.toBe(provisional);
          expect(await raw.fieldOf(ref.fileId, 'reviewItem', added.entityIds[0]!, 'refId')).toBe(activityId);
          const after = snapshotOf(await store.read(ref));
          expect(after.issues).toEqual([]);
          expect(after.value.activities.at(-1)!.id).toBe(activityId);
          expect(after.value.reviewItems.find((i) => i.id === added.entityIds[0])).toMatchObject({ refId: activityId, kind: 'notDone' });
          expect(added.snapshot).toEqual(after);
        });

        it('a number and an item added to a review typed without an ID are linked to its new ID in the file', async (ctx) => {
          const { store, ref, raw } = await edited(ctx);
          await raw.typeRowWithoutId(ref.fileId, 'review', { horizon: 1, state: 'prep', nextHorizonDays: 90, includeScorecard: false });
          const provisional = snapshotOf(await store.read(ref)).value.reviews.at(-1)!.id;
          const added = expectOk(await store.applyMany(ref, [
            number(provisional, { key: 'dealsWon', actual: 1 }), item(provisional, { kind: 'blocker', title: 'No demo kit' }),
          ], stamp));
          const reviewId = (await raw.rowIds(ref.fileId, 'review')).at(-1)!;
          expect(reviewId).not.toBe('');
          expect(reviewId).not.toBe(provisional);
          expect(await raw.fieldOf(ref.fileId, 'reviewNumber', added.entityIds[0]!, 'reviewId')).toBe(reviewId);
          expect(await raw.fieldOf(ref.fileId, 'reviewItem', added.entityIds[1]!, 'reviewId')).toBe(reviewId);
          const after = snapshotOf(await store.read(ref));
          expect(after.issues).toEqual([]);
          expect(after.value.reviewNumbers).toEqual([expect.objectContaining({ id: added.entityIds[0], reviewId, key: 'dealsWon', actual: 1 })]);
          expect(after.value.reviewItems).toEqual([expect.objectContaining({ id: added.entityIds[1], reviewId, kind: 'blocker' })]);
          expect(added.snapshot).toEqual(after);
        });

        it('an unknown item kind reads as a problem row, kept as it is', async (ctx) => {
          const seed = await edited(ctx);
          const { store, ref, raw, review, items } = await withReview(seed);
          await raw.typeCell(ref.fileId, 'reviewItem', items[0]!, 'kind', 'Wish');
          const typed = await raw.rowOf(ref.fileId, 'reviewItem', items[0]!);
          const read = snapshotOf(await store.read(ref));
          expect(read.value.reviewItems.map((i) => i.id)).toEqual([items[1]]);
          expect(read.issues).toEqual([{ tab: 'Review items', row: 2, message: 'Kind must be one of Not done, Blocker, Commitment, Hypothesis' }]);
          expect(await store.apply(ref, change({ kind: 'update', entity: 'reviewItem', id: items[0]!, patch: { moved: true } }), stamp))
            .toMatchObject({ ok: false, error: 'not_found' });

          await apply(store, ref, { kind: 'update', entity: 'reviewItem', id: items[1]!, patch: { note: 'Asked twice' } });
          await apply(store, ref, { kind: 'update', entity: 'review', id: review, patch: { relationshipNote: 'Fine' } });
          expect(await raw.rowOf(ref.fileId, 'reviewItem', items[0]!)).toEqual(typed);
          // Deleting its review deletes the rows the plan has, never this one.
          await apply(store, ref, { kind: 'delete', entity: 'review', id: review });
          expect(await raw.rowIds(ref.fileId, 'reviewItem')).toEqual([items[0]]);
          expect(await raw.rowOf(ref.fileId, 'reviewItem', items[0]!)).toEqual(typed);
        });
      });

      it('keeps a column the person added through saves, and never fills a row that has only their notes', async (ctx) => {
        const { store, ref, raw, plan } = await edited(ctx);
        const activity = plan.activities[0]!;
        await raw.addUserNotes(ref.fileId, 'activity', 'My notes', { [activity.id]: 'keep me' }, 'Ask Priya about the API key');
        await apply(store, ref, { kind: 'update', entity: 'activity', id: activity.id, patch: { note: 'Kickoff went well' } });
        const added = await apply(store, ref, { kind: 'add', entity: 'activity', values: CASES.activity.add });
        const notes = await raw.userNotes(ref.fileId, 'activity', 'My notes');
        expect(notes.find((n) => n.id === activity.id)?.note).toBe('keep me');
        expect(notes.filter((n) => n.id === null)).toEqual([{ id: null, note: 'Ask Priya about the API key' }]);
        expect(notes.find((n) => n.id === added.entityId)?.note ?? '').toBe('');
        const after = snapshotOf(await store.read(ref));
        expect(after.issues).toEqual([]);
        expect(after.value.activities.map((a) => a.id)).toEqual([...plan.activities.map((a) => a.id), added.entityId]);
      });

      it('refuses an update whose patched field was changed by hand since the page read it, and keeps the hand edit', async (ctx) => {
        const { store, ref, raw, plan } = await edited(ctx);
        const activity = plan.activities[0]!;
        const seen = activity.status;
        await raw.editField(ref.fileId, 'activity', activity.id, 'status', 'blocked');
        const out = await store.apply(ref, change({
          kind: 'update', entity: 'activity', id: activity.id, patch: { status: 'done' }, expectedUpdatedAt: activity.updatedAt, expected: { status: seen },
        }), stamp);
        expect(out).toMatchObject({ ok: false, error: 'conflict' });
        expect(await raw.fieldOf(ref.fileId, 'activity', activity.id, 'status')).toMatch(/blocked/i);
        expect(snapshotOf(await store.read(ref)).value.activities.find((a) => a.id === activity.id)?.status).toBe('blocked');
        // A field the person did not touch is still saved.
        await apply(store, ref, { kind: 'update', entity: 'activity', id: activity.id, patch: { note: 'Fine' }, expectedUpdatedAt: activity.updatedAt, expected: { note: activity.note } });
        expect(snapshotOf(await store.read(ref)).value.activities.find((a) => a.id === activity.id)).toMatchObject({ note: 'Fine', status: 'blocked' });
      });

      it('reads an Activities row it can’t read with a problem, and never writes it', async (ctx) => {
        const { store, ref, raw, plan } = await edited(ctx);
        const bad = plan.activities[1]!;
        await raw.breakRow(ref.fileId, 'activity', bad.id);
        const badRow = await raw.rowOf(ref.fileId, 'activity', bad.id);
        const read = snapshotOf(await store.read(ref));
        expect(read.issues).toEqual([expect.objectContaining({ tab: 'Activities', row: 3 })]);
        expect(read.value.activities.map((a) => a.id)).toEqual(plan.activities.filter((a) => a.id !== bad.id).map((a) => a.id));

        expect(await store.apply(ref, change({ kind: 'update', entity: 'activity', id: bad.id, patch: { status: 'done' } }), stamp))
          .toMatchObject({ ok: false, error: 'not_found' });
        expect(await store.apply(ref, change({ kind: 'delete', entity: 'activity', id: bad.id }), stamp)).toMatchObject({ ok: false, error: 'not_found' });
        // Renaming its owner rewrites the owner's other activities, never this one: its Owner now names nobody.
        const owner = plan.people.find((p) => p.id === bad.ownerId)!;
        await apply(store, ref, { kind: 'update', entity: 'person', id: owner.id, patch: { name: 'Anna K.' } });
        await apply(store, ref, { kind: 'add', entity: 'activity', values: CASES.activity.add });
        expect(await raw.rowOf(ref.fileId, 'activity', bad.id)).toEqual(badRow);
        expect((await raw.rowIds(ref.fileId, 'activity'))[1]).toBe(bad.id);
        const after = snapshotOf(await store.read(ref));
        expect(after.issues).toEqual([
          ...read.issues, { tab: 'Activities', row: 3, message: 'Owner: no row on the "People" tab has this name, or that row can’t be read' },
        ]);
        expect(after.value.activities.filter((a) => a.ownerId === owner.id).map((a) => a.id))
          .toEqual(plan.activities.filter((a) => a.ownerId === owner.id && a.id !== bad.id).map((a) => a.id));
      });

      it('reports a renamed tab as a structure error naming it, and an apply writes nothing', async (ctx) => {
        const { store, ref, raw, plan } = await edited(ctx);
        const { tab } = await raw.renameTab(ref.fileId, 'milestone', 'Goals');
        expect(tab).toBe('Milestones');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, change({ kind: 'update', entity: 'objective', id: plan.objectives[0]!.id, patch: { statement: 'x' } }), stamp))
          .toMatchObject({ ok: false, error: 'structure', tab });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });

      it('gives a row typed without an id a real id on the next write', async (ctx) => {
        const { store, ref, raw, plan } = await edited(ctx);
        await raw.typeRowWithoutId(ref.fileId, 'exitTrigger', { condition: 'Typed in the sheet', status: 'watch' });
        const read = snapshotOf(await store.read(ref));
        expect(read.value.exitTriggers.at(-1)).toMatchObject({ condition: 'Typed in the sheet', status: 'watch' });
        expect((await raw.rowIds(ref.fileId, 'exitTrigger')).at(-1)).toBe('');

        await apply(store, ref, { kind: 'update', entity: 'objective', id: plan.objectives[0]!.id, patch: { successMeasure: 'Pipeline in our CRM' } });
        const ids = await raw.rowIds(ref.fileId, 'exitTrigger');
        expect(ids.at(-1)).not.toBe('');
        const after = snapshotOf(await store.read(ref)).value;
        expect(after.exitTriggers.map((x) => x.id)).toEqual(ids);
        expect(after.exitTriggers.at(-1)).toMatchObject({ condition: 'Typed in the sheet', status: 'watch' });
      });
    });

    it('trashes a file without throwing, even one already trashed or one that never existed', async () => {
      const { store, ref } = await made();
      await expect(store.trash(ref)).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
      await expect(store.trash(ref)).resolves.toBeUndefined();
      await expect(store.trash({ fileId: 'does-not-exist' })).resolves.toBeUndefined();
      expect(await store.apply(ref, change({ kind: 'updateInfo', patch: { nextReviewDate: null } }), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    it('reports unknown files', async () => {
      const { store } = make();
      expect(await store.read({ fileId: 'does-not-exist' })).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply({ fileId: 'does-not-exist' }, change({ kind: 'delete', entity: 'objective', id: 'o_x' }), stamp))
        .toMatchObject({ ok: false, error: 'file_not_found' });
    });
  });
}

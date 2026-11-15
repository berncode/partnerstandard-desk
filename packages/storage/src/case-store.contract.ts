// The business case cases: one file per case, saved whole like a program (program-store.contract.ts), hand edits
// behind `raw`. The cases are the Business Case app's examples.
import { describe, expect, it, type TestContext } from 'vitest';
import { EXAMPLE_KEYS, EXAMPLES, type BusinessCase, type ChangeStamp } from '@partner-desk/core';
import { expectOk, NOW, snapshotOf, STALE } from './contract-helpers';
import type { CaseChange, CaseStore, ContractHarness, FileRef, SettingsRawAccess } from './types';

const CREATED_AT = '2026-10-27T09:00:00.000Z';

/** The software example, with every field PartnerStandard Desk adds filled in. */
export function sampleCase(): BusinessCase {
  const c = structuredClone(EXAMPLES.saas.case);
  return {
    ...c,
    id: 'bc_contract001',
    companyId: 'co_contract001',
    partnerId: 'a_contract1',
    programId: 'pg_contract001',
    title: 'Case of 27 Oct 2026',
    createdAt: CREATED_AT,
    stageWhenMade: 'onboarding',
    recalculatedAt: '2026-10-27T10:30:00.000Z',
    notes: ['flat-fee', 'bars'],
    offer: { ...c.offer, levels: { registered: 'Silver', preferred: 'Gold' }, preferred: { ...c.offer.preferred, on: true } },
    shared: { sharedAt: '2026-10-27T11:00:00.000Z' },
    updatedAt: CREATED_AT,
  };
}

/** Every CaseStore implementation must pass this suite. */
export function runCaseStoreContract(name: string, make: () => ContractHarness<CaseStore, SettingsRawAccess>): void {
  describe(`CaseStore contract: ${name}`, () => {
    const stamp: ChangeStamp = { now: NOW, actor: 'Ruth' };
    const sample = sampleCase();
    /** A save of `next` from a screen that read `base` (by default the case as created). */
    const save = (next: BusinessCase, expectedUpdatedAt: string | null, base: BusinessCase = sample): CaseChange =>
      ({ kind: 'save', case: next, base, expectedUpdatedAt });

    async function created(c = sample) {
      const harness = make();
      const file = await harness.store.create(harness.owner, c.companyId, c);
      return { ...harness, ref: { fileId: file.fileId } as FileRef, file };
    }

    async function read(store: CaseStore, ref: FileRef) {
      return snapshotOf(await store.read(ref));
    }

    it('refuses to make a file for a case that is not valid', async () => {
      const { store, owner } = make();
      await expect(store.create(owner, sample.companyId, { ...sample, title: '' })).rejects.toMatchObject({ code: 'invalid' });
    });

    it('links to the file it created', async () => {
      const { store, ref, file } = await created();
      expect(store.urlFor(ref)).toBe(file.fileUrl);
    });

    for (const key of EXAMPLE_KEYS) {
      it(`reads back exactly the ${key} example it created`, async () => {
        const c = EXAMPLES[key].case;
        const { store, ref } = await created(c);
        const snapshot = await read(store, ref);
        expect(snapshot.value).toEqual(c);
        expect(snapshot.issues).toEqual([]);
      });
    }

    it('reads back the fields PartnerStandard Desk adds', async () => {
      const { store, ref } = await created();
      expect((await read(store, ref)).value).toEqual(sample);
    });

    it('saves the whole case, stamped with the change time', async () => {
      const { store, ref } = await created();
      const next: BusinessCase = {
        ...sample,
        title: 'Expansion case',
        deals: [1, 2, 3, 4, 5],
        recalculatedAt: null,
        notes: [],
        programId: null,
        shared: null,
        costs: [sample.costs[1]!, { id: 'cost_new', name: 'New cost', when: 'preferred', amount: 900 }],
        offer: { ...sample.offer, products: [sample.offer.products[1]!], levels: { registered: 'Registered', preferred: 'Preferred' } },
        ours: {
          ...sample.ours,
          costs: [],
          strategic: [...sample.ours.strategic, { id: 'reason_new', text: 'A new reason', weight: 'low', alone: true }],
          recommendation: 'Go ahead.',
          figures: { ...sample.ours.figures, margin: 65, marginSource: 'partner' },
        },
      };
      const result = expectOk(await store.apply(ref, save(next, CREATED_AT), stamp));
      expect(result.entityId).toBeNull();
      const after = await read(store, ref);
      expect(result.snapshot).toEqual(after);
      expect(after.value).toEqual({ ...next, updatedAt: NOW });
      expect(after.issues).toEqual([]);
    });

    it('refuses a save made from a stale copy, and changes nothing', async () => {
      const { store, ref } = await created();
      expect(await store.apply(ref, save({ ...sample, title: 'Stale' }, STALE), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, save({ ...sample, title: 'Stale' }, null), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect((await read(store, ref)).value).toEqual(sample);
    });

    it('refuses a save whose base is not the case in the file, and changes nothing', async () => {
      const { store, ref } = await created();
      const other = { ...sample, deals: [9, 9, 9, 9, 9] as BusinessCase['deals'] };
      expect(await store.apply(ref, save({ ...sample, title: 'New' }, CREATED_AT, other), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect((await read(store, ref)).value).toEqual(sample);
    });

    it('refuses a case that is not valid, or is another case, and changes nothing', async () => {
      const { store, ref } = await created();
      expect(await store.apply(ref, save({ ...sample, title: '' }, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect(await store.apply(ref, save({ ...sample, id: 'bc_other00001' }, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect((await read(store, ref)).value).toEqual(sample);
    });

    it("keeps the file's company whatever company a save names", async () => {
      const { store, ref } = await created();
      const result = expectOk(await store.apply(ref, save({ ...sample, companyId: 'co_someoneelse' }, CREATED_AT), stamp));
      expect(result.snapshot.value.companyId).toBe(sample.companyId);
      expect((await read(store, ref)).value.companyId).toBe(sample.companyId);
    });

    it('keeps text that looks like a formula as text', async () => {
      const { store, ref } = await created();
      const next = { ...sample, title: '=SUM(1,2)', ours: { ...sample.ours, recommendation: '+43 1 234 56', ask: '@acme' } };
      expectOk(await store.apply(ref, save(next, CREATED_AT), stamp));
      expect((await read(store, ref)).value).toEqual({ ...next, updatedAt: NOW });
    });

    it('applies a batch of one save, refuses more than one, and reads back on none', async () => {
      const { store, ref } = await created();
      const two = [save({ ...sample, title: 'One' }, CREATED_AT), save({ ...sample, title: 'Two' }, CREATED_AT)];
      expect(await store.applyMany(ref, two, stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect((await read(store, ref)).value).toEqual(sample);
      const none = expectOk(await store.applyMany(ref, [], stamp));
      expect(none).toMatchObject({ entityIds: [] });
      expect(none.snapshot.value).toEqual(sample);
      const one = expectOk(await store.applyMany(ref, [save({ ...sample, title: 'One' }, CREATED_AT)], stamp));
      expect(one.entityIds).toEqual([null]);
      expect((await read(store, ref)).value.title).toBe('One');
    });

    it('moves a file to the trash without throwing, even one already trashed or one that never existed', async () => {
      const { store, ref } = await created();
      await expect(store.trash(ref)).resolves.toBeUndefined();
      await expect(store.trash(ref)).resolves.toBeUndefined();
      await expect(store.trash({ fileId: 'does-not-exist' })).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply(ref, save(sample, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    it('discards a file without throwing, and reports unknown files', async () => {
      const { store, ref } = await created();
      await expect(store.discard(ref)).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.read({ fileId: 'does-not-exist' })).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply({ fileId: 'does-not-exist' }, save(sample, null), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    describe('hand edits', () => {
      /** A new file with its raw access; the case is skipped when the adapter gives none. */
      async function edited(ctx: TestContext) {
        const harness = await created();
        if (!harness.raw) ctx.skip();
        return harness as typeof harness & { raw: SettingsRawAccess };
      }

      it('keeps a product typed by hand at the end of Products, on the read and through the next save', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeRow(ref.fileId, 'Products', { Product: 'Support plan', Paid: 'Yearly', Price: 1200, Per: 'account', Amount: 1 });
        const first = await read(store, ref);
        const typed = first.value.offer.products[2]!;
        expect(typed).toEqual({ id: expect.any(String), name: 'Support plan', paid: 'yearly', price: 1200, per: 'account', amount: 1 });
        expect(first.issues).toEqual([]);
        expectOk(await store.apply(ref, save({ ...first.value, title: 'Renamed' }, CREATED_AT, first.value), stamp));
        expect((await read(store, ref)).value.offer.products).toEqual([...sample.offer.products, typed]);
        expect((await raw.rows(ref.fileId, 'Products')).map((r) => r.Product)).toEqual([...sample.offer.products.map((p) => p.name), 'Support plan']);
      });

      it('reads an unreadable Products row with a problem, leaves it out, and never writes over it', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeCell(ref.fileId, 'Products', 0, 'Price', 'a lot');
        const first = await read(store, ref);
        expect(first.value.offer.products).toEqual([sample.offer.products[1]]);
        expect(first.issues).toEqual([{ tab: 'Products', row: 2, message: expect.stringContaining('Price') }]);
        const added = { id: 'prod_new', name: 'Added', paid: 'once' as const, price: 10, per: 'site' as const, amount: 2 };
        const next = { ...first.value, offer: { ...first.value.offer, products: [...first.value.offer.products, added] } };
        expectOk(await store.apply(ref, save(next, CREATED_AT, first.value), stamp));
        expect((await raw.rows(ref.fileId, 'Products'))[0]).toMatchObject({ Product: sample.offer.products[0]!.name, Price: 'a lot' });
        const after = await read(store, ref);
        expect(after.value.offer.products).toEqual(next.offer.products);
        expect(after.issues).toEqual(first.issues);
      });

      it('refuses a save from a screen that read the file before a hand edit, and writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        const before = await read(store, ref);
        await raw.typeSetting(ref.fileId, 'Case', 'Deals year 1', 4);
        const dump = await raw.dump(ref.fileId);
        const stale = save({ ...before.value, title: 'From the open screen' }, CREATED_AT, before.value);
        expect(await store.apply(ref, stale, stamp)).toMatchObject({ ok: false, error: 'conflict' });
        expect(await raw.dump(ref.fileId)).toEqual(dump);
        const fresh = await read(store, ref);
        expectOk(await store.apply(ref, save({ ...fresh.value, title: 'From the open screen' }, CREATED_AT, fresh.value), stamp));
        expect((await read(store, ref)).value).toMatchObject({ title: 'From the open screen', deals: [4, ...sample.deals.slice(1)] });
      });

      it('reads a Partner type row whose Id was cleared as the case’s own type, saves, and reads back the same', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeCell(ref.fileId, 'Partner type', 0, 'Id', '');
        const first = await read(store, ref);
        expect(first.value).toEqual(sample);
        expect(first.issues).toEqual([]);
        const next = { ...first.value, title: 'Renamed' };
        expectOk(await store.apply(ref, save(next, CREATED_AT, first.value), stamp));
        expect((await raw.rows(ref.fileId, 'Partner type'))[0]).toMatchObject({ Id: sample.typeId });
        const after = await read(store, ref);
        expect(after.value).toEqual({ ...next, updatedAt: NOW });
        expect(after.issues).toEqual([]);
      });

      it('reads an edited Type id as the Partner type row’s, says so, saves the two in agreement, and reads back the same', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeSetting(ref.fileId, 'Case', 'Type id', 'type_typedbyhand');
        const first = await read(store, ref);
        expect(first.value).toEqual(sample);
        expect(first.issues).toEqual([{ tab: 'Case', row: expect.any(Number), message: expect.stringMatching(/^Type id in Case /) }]);
        const next = { ...first.value, title: 'Renamed' };
        expectOk(await store.apply(ref, save(next, CREATED_AT, first.value), stamp));
        const after = await read(store, ref);
        expect(after.value).toEqual({ ...next, updatedAt: NOW });
        expect(after.issues).toEqual([]);
      });

      it('refuses to read or save a case whose setting is unreadable, and writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeSetting(ref.fileId, 'Our case', 'Gross margin (%)', 'high');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab: 'Our case' });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, save(sample, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'structure' });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });

      it('reports a renamed tab as a structure error naming it, and a save writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.renameTab(ref.fileId, 'Strategic reasons', 'Reasons');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab: 'Strategic reasons' });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, save(sample, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'structure', tab: 'Strategic reasons' });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });
    });
  });
}

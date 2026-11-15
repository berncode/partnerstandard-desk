// The Company facts cases: Program Designer's company cases on PartnerStandard Desk's file stores, hand edits behind `raw`.
import { describe, expect, it, type TestContext } from 'vitest';
import { newCompanyFacts, type ChangeStamp, type CompanyFacts } from '@partner-desk/core';
import { expectOk, NOW, snapshotOf, STALE } from './contract-helpers';
import type { CompanyFactsChange, CompanyFactsStore, ContractHarness, FileRef, SettingsRawAccess } from './types';

const CREATED_AT = '2026-10-27T09:00:00.000Z';
const COMPANY_ID = 'co_contract001';

export function sampleFacts(): CompanyFacts {
  return {
    ...newCompanyFacts('cf_contract001'),
    currency: 'EUR', yearly: 18000, once: 6000, renew: 90, spend: 2600000, revenue: null,
    rules: {
      protect: 90, extend: 30, answer: 48, conflict: 'first', paidInFull: true,
      ownerNote: 'Partner-sourced customers stay with the partner.', handover: 'Your sales team joins after the deal is registered.',
    },
    ours: {
      figures: {
        margin: 78, marginSource: 'finance',
        serve: { find: 900, close: 2500, salesSource: 'sales', support1: 300, support2: 150, supportSource: 'assumption', servicesCost: 80, servicesCharge: 140, servicesSource: 'other' },
      },
      costs: [{ id: 'oc_contract01', name: 'Partner manager time', when: 'yearly', amount: 24000, source: 'finance' }],
    },
    updatedAt: CREATED_AT,
  };
}


/** Every CompanyFactsStore implementation must pass this suite. */
export function runCompanyFactsStoreContract(name: string, make: () => ContractHarness<CompanyFactsStore, SettingsRawAccess>): void {
  describe(`CompanyFactsStore contract: ${name}`, () => {
    const stamp: ChangeStamp = { now: NOW, actor: 'Ruth' };
    const facts = sampleFacts();
    /** A save of `next` from a screen that read `base` (by default the facts as created). */
    const save = (next: CompanyFacts, expectedUpdatedAt: string | null, base: CompanyFacts = facts): CompanyFactsChange =>
      ({ kind: 'save', facts: next, base, expectedUpdatedAt });

    async function created() {
      const harness = make();
      const file = await harness.store.create(harness.owner, COMPANY_ID, facts);
      return { ...harness, ref: { fileId: file.fileId } as FileRef, file };
    }

    it('refuses to make a file for facts that are not valid', async () => {
      const { store, owner } = make();
      await expect(store.create(owner, COMPANY_ID, { ...facts, renew: -1 })).rejects.toMatchObject({ code: 'invalid' });
    });

    it('links to the file it created and reads back exactly the facts', async () => {
      const { store, ref, file } = await created();
      expect(store.urlFor(ref)).toBe(file.fileUrl);
      const snapshot = snapshotOf(await store.read(ref));
      expect(snapshot.value).toEqual(facts);
      expect(snapshot.issues).toEqual([]);
    });

    it('saves the whole facts, stamped with the change time, "not known" included', async () => {
      const { store, ref } = await created();
      const next: CompanyFacts = { ...facts, currency: 'CHF', spend: null, revenue: 6500000, rules: { ...facts.rules, conflict: 'case', paidInFull: false } };
      const result = expectOk(await store.apply(ref, save(next, CREATED_AT), stamp));
      expect(result.entityId).toBeNull();
      const after = snapshotOf(await store.read(ref));
      expect(result.snapshot).toEqual(after);
      expect(after.value).toEqual({ ...next, updatedAt: NOW });
    });

    it('refuses a stale save, an invalid one and another file\'s facts, and changes nothing', async () => {
      const { store, ref } = await created();
      expect(await store.apply(ref, save({ ...facts, yearly: 1 }, STALE), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, save({ ...facts, yearly: 1 }, null), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, save({ ...facts, renew: 140 }, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect(await store.apply(ref, save({ ...facts, id: 'cf_other00001' }, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect(await store.applyMany(ref, [save(facts, CREATED_AT), save(facts, CREATED_AT)], stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect(snapshotOf(await store.read(ref)).value).toEqual(facts);
    });

    it('refuses a save whose base is not the facts in the file', async () => {
      const { store, ref } = await created();
      expect(await store.apply(ref, save({ ...facts, yearly: 1 }, CREATED_AT, { ...facts, once: 1 }), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect(snapshotOf(await store.read(ref)).value).toEqual(facts);
    });

    it('applies a batch of one save', async () => {
      const { store, ref } = await created();
      const result = expectOk(await store.applyMany(ref, [save({ ...facts, yearly: 20000 }, CREATED_AT)], stamp));
      expect(result.entityIds).toEqual([null]);
      expect(snapshotOf(await store.read(ref)).value.yearly).toBe(20000);
    });

    it('reports unknown and discarded files', async () => {
      const { store, ref } = await created();
      await store.discard(ref);
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply({ fileId: 'does-not-exist' }, save(facts, null), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    describe('hand edits', () => {
      async function edited(ctx: TestContext) {
        const harness = await created();
        if (!harness.raw) ctx.skip();
        return harness as typeof harness & { raw: SettingsRawAccess };
      }

      it('reads a number typed as text, and a setting row of the person\'s own survives a save', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeSetting(ref.fileId, 'Company facts', 'Pays every year', '19000');
        await raw.typeRow(ref.fileId, 'Company facts', { Setting: 'Our own note', Value: 'Keep this' });
        const read1 = snapshotOf(await store.read(ref));
        expect(read1.value.yearly).toBe(19000);
        expectOk(await store.apply(ref, save({ ...read1.value, once: 7000 }, CREATED_AT, read1.value), stamp));
        expect(await raw.rows(ref.fileId, 'Company facts')).toContainEqual({ Setting: 'Our own note', Value: 'Keep this' });
        expect(snapshotOf(await store.read(ref)).value).toMatchObject({ yearly: 19000, once: 7000 });
      });

      it('reads a cost line of ours typed by hand, and keeps it through a save', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeRow(ref.fileId, 'Our cost lines', { Cost: 'Events', When: 'Every year', Amount: 5000, Source: 'Sales' });
        const read1 = snapshotOf(await store.read(ref));
        expect(read1.value.ours.costs).toEqual([...facts.ours.costs, { id: expect.any(String), name: 'Events', when: 'yearly', amount: 5000, source: 'sales' }]);
        expectOk(await store.apply(ref, save({ ...read1.value, once: 7000 }, CREATED_AT, read1.value), stamp));
        expect(snapshotOf(await store.read(ref)).value.ours.costs).toEqual(read1.value.ours.costs);
      });

      it('refuses a save from a screen that read the file before a hand edit, and writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        const before = snapshotOf(await store.read(ref));
        await raw.typeSetting(ref.fileId, 'Company facts', 'Pays once', 6500);
        const dump = await raw.dump(ref.fileId);
        expect(await store.apply(ref, save({ ...before.value, yearly: 1 }, CREATED_AT, before.value), stamp)).toMatchObject({ ok: false, error: 'conflict' });
        expect(await raw.dump(ref.fileId)).toEqual(dump);
      });

      it('refuses to read or save facts whose setting is unreadable, and writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeSetting(ref.fileId, 'Company facts', 'Customers who renew (%)', 'most');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab: 'Company facts' });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, save(facts, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'structure' });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });

      it('reports a file without its _meta tab as not made by PartnerStandard Desk', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.renameTab(ref.fileId, '_meta', 'meta');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab: '_meta' });
      });
    });
  });
}

// The program cases: Program Designer's store contract on PartnerStandard Desk's file stores: one file per program,
// whole-record saves, hand edits behind `raw`.
import { describe, expect, it, type TestContext } from 'vitest';
import { newCompanyFacts, newProgram, programSheet, publicBlocks, publicPlain, type ChangeStamp, type Program } from '@partner-desk/core';
import { expectOk, NOW, snapshotOf, STALE } from './contract-helpers';
import type { ContractHarness, FileRef, ProgramChange, ProgramStore, SettingsRawAccess } from './types';

const CREATED_AT = '2026-10-27T09:00:00.000Z';

/** A Reseller program with something in every list, one benefit of its own and a date. */
export function sampleProgram(): Program {
  const facts = { ...newCompanyFacts('co_contract001'), currency: 'EUR' as const, yearly: 18000, once: 6000, renew: 90 };
  const p = newProgram('reseller', facts, { id: 'pr_contract001', companyName: 'Northwind Security' });
  return {
    ...p,
    focus: 'DACH',
    lead: 'Anna Berger',
    goals: 'Reach mid-sized companies we cannot reach ourselves.',
    why: ['A product your customers renew every year.', 'Leads from us in your region.'],
    own: [{ k: 'own_abcd1234', g: 'Selling', n: 'Joint pitch to your top customers' }],
    reg: [...p.reg, 'own_abcd1234'],
    publish: '2027-01-15',
    updatedAt: CREATED_AT,
  };
}


/** Every ProgramStore implementation must pass this suite. */
export function runProgramStoreContract(name: string, make: () => ContractHarness<ProgramStore, SettingsRawAccess>): void {
  describe(`ProgramStore contract: ${name}`, () => {
    const stamp: ChangeStamp = { now: NOW, actor: 'Ruth' };
    const program = sampleProgram();
    /** A save of `next` from a screen that read `base` (by default the program as created). */
    const save = (next: Program, expectedUpdatedAt: string | null, base: Program = program): ProgramChange =>
      ({ kind: 'save', program: next, base, expectedUpdatedAt });

    async function created() {
      const harness = make();
      const file = await harness.store.create(harness.owner, program.companyId, program);
      return { ...harness, ref: { fileId: file.fileId } as FileRef, file };
    }

    async function read(store: ProgramStore, ref: FileRef) {
      return snapshotOf(await store.read(ref));
    }

    it('refuses to make a file for a program that is not valid', async () => {
      const { store, owner } = make();
      await expect(store.create(owner, program.companyId, { ...program, name: '' })).rejects.toMatchObject({ code: 'invalid' });
    });

    it('links to the file it created', async () => {
      const { store, ref, file } = await created();
      expect(store.urlFor(ref)).toBe(file.fileUrl);
    });

    it('reads back exactly the program it created', async () => {
      const { store, ref } = await created();
      const snapshot = await read(store, ref);
      expect(snapshot.value).toEqual(program);
      expect(snapshot.issues).toEqual([]);
    });

    it('saves the whole program, stamped with the change time', async () => {
      const { store, ref } = await created();
      const next: Program = {
        ...program,
        name: 'Northwind Partner Program',
        why: ['Leads from us in your region.', 'A product your customers renew every year.', 'Certification for your team.'],
        entry: ['Signed partner agreement'],
        bars: [{ label: 'New customers', value: 6, unit: 'a year' }],
        own: [],
        reg: program.reg.filter((k) => k !== 'own_abcd1234'),
        prefOn: false,
        prefReq: { ...program.prefReq, qbr: false, certified: { on: true, people: 3 } },
        money: { ...program.money, rates: { reg: [20, 20, 20], pref: [30, 30, 30] }, payDays: 45 },
      };
      const result = expectOk(await store.apply(ref, save(next, CREATED_AT), stamp));
      expect(result.entityId).toBeNull();
      const after = await read(store, ref);
      expect(result.snapshot).toEqual(after);
      expect(after.value).toEqual({ ...next, updatedAt: NOW });
      expect(after.issues).toEqual([]);
    });

    it('stamps each save strictly after the one before, even when the clock has not moved', async () => {
      const { store, ref } = await created();
      const first = expectOk(await store.apply(ref, save(program, CREATED_AT), stamp)).snapshot.value.updatedAt;
      const second = expectOk(await store.apply(ref, save(program, first, { ...program, updatedAt: first }), stamp)).snapshot.value.updatedAt;
      expect(first).toBe(NOW);
      expect(second > first).toBe(true);
    });

    it('refuses a save made from a stale copy, and changes nothing', async () => {
      const { store, ref } = await created();
      expect(await store.apply(ref, save({ ...program, name: 'Stale' }, STALE), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, save({ ...program, name: 'Stale' }, null), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect((await read(store, ref)).value).toEqual(program);
    });

    it('takes null as "never saved" for a program made without a time', async () => {
      const harness = make();
      const fresh = { ...program, updatedAt: '' };
      const file = await harness.store.create(harness.owner, fresh.companyId, fresh);
      const result = expectOk(await harness.store.apply({ fileId: file.fileId }, save(fresh, null, fresh), stamp));
      expect(result.snapshot.value.updatedAt).toBe(NOW);
    });

    it('refuses a program that is not valid, or is another program, and changes nothing', async () => {
      const { store, ref } = await created();
      expect(await store.apply(ref, save({ ...program, name: '' }, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect(await store.apply(ref, save({ ...program, id: 'pr_other00001' }, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect((await read(store, ref)).value).toEqual(program);
    });

    it('refuses a save whose base is not the program in the file, and changes nothing', async () => {
      const { store, ref } = await created();
      const other = { ...program, why: ['Not what the file holds'] };
      expect(await store.apply(ref, save({ ...program, name: 'New' }, CREATED_AT, other), stamp)).toMatchObject({ ok: false, error: 'conflict' });
      expect((await read(store, ref)).value).toEqual(program);
    });

    it("keeps the file's company whatever company a save names", async () => {
      const { store, ref } = await created();
      const result = expectOk(await store.apply(ref, save({ ...program, companyId: 'co_someoneelse' }, CREATED_AT), stamp));
      expect(result.snapshot.value.companyId).toBe(program.companyId);
      expect((await read(store, ref)).value.companyId).toBe(program.companyId);
    });

    it('keeps text that looks like a formula as text', async () => {
      const { store, ref } = await created();
      const next = { ...program, name: '=SUM(1,2)', why: ['+43 1 234 56', '@acme'], lead: '-x' };
      expectOk(await store.apply(ref, save(next, CREATED_AT), stamp));
      expect((await read(store, ref)).value).toEqual({ ...next, updatedAt: NOW });
    });

    it('applies a batch of one save, refuses more than one, and reads back on none', async () => {
      const { store, ref } = await created();
      const two = [save({ ...program, name: 'One' }, CREATED_AT), save({ ...program, name: 'Two' }, CREATED_AT)];
      expect(await store.applyMany(ref, two, stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect((await read(store, ref)).value).toEqual(program);
      const none = expectOk(await store.applyMany(ref, [], stamp));
      expect(none).toMatchObject({ entityIds: [] });
      expect(none.snapshot.value).toEqual(program);
      const one = expectOk(await store.applyMany(ref, [save({ ...program, name: 'One' }, CREATED_AT)], stamp));
      expect(one.entityIds).toEqual([null]);
      expect((await read(store, ref)).value.name).toBe('One');
    });

    it('rewrites the outputs without touching the program', async () => {
      const { store, ref } = await created();
      const facts = newCompanyFacts('co_contract001');
      const before = await read(store, ref);
      await store.writeOutputs(ref, programSheet(facts, program, 'Northwind Security'), publicPlain(publicBlocks(facts, program)));
      await store.writeOutputs(ref, programSheet(facts, program, 'Northwind Security'), publicPlain(publicBlocks(facts, program)));
      expect(await read(store, ref)).toEqual(before);
      // A save after the outputs still finds the program as it was.
      expectOk(await store.apply(ref, save(program, CREATED_AT), stamp));
    });

    it('moves a file to the trash without throwing, even one already trashed or one that never existed', async () => {
      const { store, ref } = await created();
      await expect(store.trash(ref)).resolves.toBeUndefined();
      await expect(store.trash(ref)).resolves.toBeUndefined();
      await expect(store.trash({ fileId: 'does-not-exist' })).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply(ref, save(program, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    it('discards a file without throwing', async () => {
      const { store, ref } = await created();
      await expect(store.discard(ref)).resolves.toBeUndefined();
      await expect(store.discard({ fileId: 'does-not-exist' })).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    it('reports unknown files, and refuses outputs for one', async () => {
      const { store } = make();
      const facts = newCompanyFacts('co_contract001');
      expect(await store.read({ fileId: 'does-not-exist' })).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply({ fileId: 'does-not-exist' }, save(program, null), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
      await expect(store.writeOutputs({ fileId: 'does-not-exist' }, programSheet(facts, program, 'N'), 'x')).rejects.toMatchObject({ code: 'file_not_found' });
    });

    describe('hand edits', () => {
      /** A new file with its raw access; the case is skipped when the adapter gives none. */
      async function edited(ctx: TestContext) {
        const harness = await created();
        if (!harness.raw) ctx.skip();
        return harness as typeof harness & { raw: SettingsRawAccess };
      }

      it('keeps a reason typed by hand, on the read and through the next save', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeRow(ref.fileId, 'Reasons', { Reason: 'Typed in the sheet' });
        const read1 = await read(store, ref);
        expect(read1.value.why).toEqual([...program.why, 'Typed in the sheet']);
        expect(read1.issues).toEqual([]);
        expectOk(await store.apply(ref, save({ ...read1.value, name: 'Renamed' }, CREATED_AT, read1.value), stamp));
        expect((await read(store, ref)).value.why).toEqual([...program.why, 'Typed in the sheet']);
        expect((await raw.rows(ref.fileId, 'Reasons')).map((r) => r.Reason)).toEqual([...program.why, 'Typed in the sheet']);
      });

      it("keeps a person's own column through a save", async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeCell(ref.fileId, 'Reasons', 0, 'My notes', 'Ask Anna');
        expectOk(await store.apply(ref, save({ ...program, why: ['Changed first reason', program.why[1]!] }, CREATED_AT), stamp));
        expect(await raw.rows(ref.fileId, 'Reasons')).toEqual([
          { Reason: 'Changed first reason', 'My notes': 'Ask Anna' }, { Reason: program.why[1] },
        ]);
      });

      it('reads an unreadable list row with a problem, leaves it out, and never writes over it', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeCell(ref.fileId, 'Performance bar', 1, 'At least', 'lots');
        const first = await read(store, ref);
        expect(first.value.bars).toEqual([program.bars[0]]);
        expect(first.issues).toEqual([{ tab: 'Performance bar', row: 3, message: expect.stringContaining('At least') }]);
        const next = { ...first.value, bars: [{ label: 'Changed', value: 1, unit: 'a month' }, { label: 'Added', value: 2, unit: 'a year' }] };
        expectOk(await store.apply(ref, save(next, CREATED_AT, first.value), stamp));
        const rows = await raw.rows(ref.fileId, 'Performance bar');
        expect(rows).toContainEqual({ Measure: program.bars[1]!.label, 'At least': 'lots', Unit: program.bars[1]!.unit });
        const after = await read(store, ref);
        expect(after.value.bars).toEqual(next.bars);
        expect(after.issues).toEqual(first.issues);
      });

      it('leaves an unreadable benefit row out of the levels and never writes over it', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        const rows = await raw.rows(ref.fileId, 'Benefits');
        const at = rows.findIndex((r) => r.Key === 'dealreg');
        await raw.typeCell(ref.fileId, 'Benefits', at, 'Registered', 'maybe');
        const first = await read(store, ref);
        expect(first.value.reg).not.toContain('dealreg');
        expect(first.issues).toEqual([{ tab: 'Benefits', row: at + 2, message: expect.stringContaining('Registered') }]);
        expectOk(await store.apply(ref, save({ ...first.value, reg: [...first.value.reg, 'dealreg'] }, CREATED_AT, first.value), stamp));
        const after = await raw.rows(ref.fileId, 'Benefits');
        expect(after.filter((r) => r.Key === 'dealreg')).toEqual([expect.objectContaining({ Registered: 'maybe' })]);
        expect((await read(store, ref)).issues).toEqual(first.issues);
      });

      it('refuses a save from a screen that read the file before a hand edit, and writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        const before = await read(store, ref);
        await raw.typeRow(ref.fileId, 'Reasons', { Reason: 'Typed in the sheet' });
        await raw.typeSetting(ref.fileId, 'Program', 'Focus', 'Nordics');
        const dump = await raw.dump(ref.fileId);
        const stale = save({ ...before.value, name: 'From the open screen' }, CREATED_AT, before.value);
        expect(await store.apply(ref, stale, stamp)).toMatchObject({ ok: false, error: 'conflict' });
        expect(await raw.dump(ref.fileId)).toEqual(dump);
        // After a reload the same change saves, and the hand edits stay.
        const fresh = await read(store, ref);
        expectOk(await store.apply(ref, save({ ...fresh.value, name: 'From the open screen' }, CREATED_AT, fresh.value), stamp));
        expect((await read(store, ref)).value).toMatchObject({ name: 'From the open screen', focus: 'Nordics', why: [...program.why, 'Typed in the sheet'] });
      });

      it("reads the file's own ids when a person changed the Company setting, and a save puts it back", async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeSetting(ref.fileId, 'Program', 'Company', 'co_typedbyhand');
        const first = await read(store, ref);
        expect(first.value).toEqual(program);
        expect(first.issues).toEqual([{ tab: 'Program', row: expect.any(Number), message: expect.stringMatching(/^Company in Program /) }]);
        expectOk(await store.apply(ref, save(first.value, CREATED_AT, first.value), stamp));
        expect((await read(store, ref)).issues).toEqual([]);
      });

      it('refuses to read or save a program whose setting is unreadable, and writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeSetting(ref.fileId, 'Program', 'Notice before moving a partner down (days)', 'soon');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab: 'Program' });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, save(program, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'structure' });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });

      it('reports a renamed tab as a structure error naming it, and a save writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.renameTab(ref.fileId, 'Entry', 'Entry rules');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab: 'Entry' });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, save(program, CREATED_AT), stamp)).toMatchObject({ ok: false, error: 'structure', tab: 'Entry' });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });

      it('writes the outputs into their own tabs and never touches the data tabs', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeRow(ref.fileId, 'Reasons', { Reason: 'Typed in the sheet' });
        const facts = newCompanyFacts('co_contract001');
        const before = await raw.dump(ref.fileId);
        const text = publicPlain(publicBlocks(facts, program));
        await store.writeOutputs(ref, programSheet(facts, program, 'Northwind Security'), text);
        const after = await raw.dump(ref.fileId);
        for (const tab of Object.keys(before).filter((t) => t !== 'Program Sheet' && t !== 'Public page')) {
          expect(after[tab], tab).toEqual(before[tab]);
        }
        const sheet = after['Program Sheet']!.flat();
        expect(sheet).toContain(program.name);
        const page = after['Public page']!.flat();
        expect(page).toContain(text.split('\n')[0]);
        expect(String(page[0])).toMatch(/^Made by PartnerStandard Desk/);
      });

      it('makes an output tab again that a person renamed, and leaves the renamed tab as it is', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        const facts = newCompanyFacts('co_contract001');
        await store.writeOutputs(ref, programSheet(facts, program, 'Northwind Security'), '# First');
        await read(store, ref);
        await raw.renameTab(ref.fileId, 'Public page', 'Old public page');
        await store.writeOutputs(ref, programSheet(facts, program, 'Northwind Security'), '# Hello');
        const after = await raw.dump(ref.fileId);
        expect(after['Public page']!.flat()).toContain('# Hello');
        expect(after['Old public page']!.flat()).toContain('# First');
        expect((await read(store, ref)).value).toEqual(program);
      });
    });
  });
}

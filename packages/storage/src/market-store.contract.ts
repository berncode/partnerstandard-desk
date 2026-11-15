// The market cases, hand edits behind `raw`.
import { describe, expect, it, type TestContext } from 'vitest';
import type { ChangeStamp, Market, MarketChange } from '@partner-desk/core';
import { sampleMarket } from '@partner-desk/core/test-builders';
import { expectOk, NOW, snapshotOf, STALE, without } from './contract-helpers';
import type { ContractHarness, FileRef, MarketStore } from './types';

type MarketEntity = 'valuePoint' | 'hypothesis' | 'exclusion' | 'change';
const COLLECTION: Record<MarketEntity, keyof Omit<Market, 'info'>> = {
  valuePoint: 'valuePoints', hypothesis: 'hypotheses', exclusion: 'exclusions', change: 'changes',
};
const ENTITIES = Object.keys(COLLECTION) as MarketEntity[];
type Item = { id: string; updatedAt: string | null } & Record<string, unknown>;
const itemsOf = (market: Market, entity: MarketEntity) => market[COLLECTION[entity]] as unknown as Item[];

/** Per entity kind: values for an add, a patch for an update of a sample row, and a sample row to delete. */
const CASES: Record<MarketEntity, { add: Record<string, unknown>; update: { id: string; patch: Record<string, unknown> }; remove: string }> = {
  valuePoint: {
    add: { kind: 'portfolio', text: 'Completes their cloud bundle', state: 'assumption', evidence: 'Beta website' },
    update: { id: 'v_2', patch: { state: 'confirmed', evidence: 'Beta call, 2026-10-20' } },
    remove: 'v_2',
  },
  hypothesis: {
    add: { name: 'Cloud ERP shops', theirSide: 'They need a finance add-on', valuePointIds: ['v_1'] },
    update: { id: 'h_1', patch: { status: 'dropped', valuePointIds: ['v_2'] } },
    remove: 'h_1',
  },
  exclusion: {
    add: { company: 'Psi AG', website: 'psi.at', reason: 'Too small' },
    update: { id: 'x_1', patch: { reason: 'Signed with a competitor' } },
    remove: 'x_1',
  },
  change: {
    add: { date: '2026-10-20', entity: 'value_point', entityId: 'v_2', what: 'Confirmed on the Beta call', callId: 'k_abc123' },
    update: { id: 'g_1', patch: { what: 'Narrowed to ERP resellers after two calls' } },
    remove: 'g_1',
  },
};

const FORMULA_LIKE = ['=HYPERLINK("https://evil.test","Acme")', '+43 1 234 56', '@acme', '-x', '=SUM(1,2)\n+1'];

/** Every row of every kind is as in `before`, except the one `except` names; the market details too, unless `except` is 'info'. */
function expectOthersUnchanged(after: Market, before: Market, except: { entity: MarketEntity; id: string | null } | 'info') {
  if (except !== 'info') expect(after.info).toEqual(before.info);
  for (const entity of ENTITIES) {
    const skip = except !== 'info' && entity === except.entity ? except.id : null;
    expect(without(itemsOf(after, entity), skip)).toEqual(without(itemsOf(before, entity), skip));
  }
}

/** Every MarketStore implementation must pass this suite. */
export function runMarketStoreContract(name: string, make: () => ContractHarness<MarketStore>): void {
  describe(`MarketStore contract: ${name}`, () => {
    const stamp: ChangeStamp = { now: NOW, actor: 'Ruth' };
    const market = sampleMarket();

    async function created() {
      const harness = make();
      const file = await harness.store.create(harness.owner, market);
      return { ...harness, ref: { fileId: file.fileId } as FileRef, file };
    }

    async function apply(store: MarketStore, ref: FileRef, change: MarketChange) {
      return expectOk(await store.apply(ref, change, stamp));
    }

    it('links to the file it created', async () => {
      const { store, ref, file } = await created();
      expect(store.urlFor(ref)).toBe(file.fileUrl);
    });

    it('reads back exactly the market it created', async () => {
      const { store, ref } = await created();
      const snapshot = snapshotOf(await store.read(ref));
      expect(snapshot.value).toEqual(market);
      expect(snapshot.issues).toEqual([]);
    });

    for (const entity of ENTITIES) {
      const { add, update, remove } = CASES[entity];

      it(`adds a ${entity} and leaves everything else alone`, async () => {
        const { store, ref } = await created();
        const result = await apply(store, ref, { kind: 'add', entity, values: add });
        expect(result.entityId).toEqual(expect.any(String));
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(itemsOf(after.value, entity).find((item) => item.id === result.entityId)).toMatchObject({ ...add, updatedAt: NOW, updatedBy: 'Ruth' });
        expect(itemsOf(after.value, entity)).toHaveLength(itemsOf(market, entity).length + 1);
        expectOthersUnchanged(after.value, market, { entity, id: result.entityId });
        expect(after.issues).toEqual([]);
      });

      it(`updates a ${entity} with its current Updated value and leaves everything else alone`, async () => {
        const { store, ref } = await created();
        const current = itemsOf(market, entity).find((item) => item.id === update.id)!;
        await apply(store, ref, { kind: 'update', entity, id: update.id, patch: update.patch, expectedUpdatedAt: current.updatedAt });
        const after = snapshotOf(await store.read(ref));
        expect(itemsOf(after.value, entity).find((item) => item.id === update.id)).toMatchObject({ ...update.patch, updatedAt: NOW, updatedBy: 'Ruth' });
        expectOthersUnchanged(after.value, market, { entity, id: update.id });
        expect(after.issues).toEqual([]);
      });

      it(`deletes a ${entity} and leaves everything else alone`, async () => {
        const { store, ref } = await created();
        const result = await apply(store, ref, { kind: 'delete', entity, id: remove });
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(itemsOf(after.value, entity).map((item) => item.id)).toEqual(without(itemsOf(market, entity), remove).map((item) => item.id));
        expectOthersUnchanged(after.value, market, { entity, id: remove });
        expect(after.issues).toEqual([]);
      });
    }

    it('updates the market details with the current Updated value', async () => {
      const { store, ref } = await created();
      await apply(store, ref, {
        kind: 'updateInfo', patch: { statement: 'ERP resellers resell invoice automation', expectedCandidates: 20 },
        expectedUpdatedAt: market.info.updatedAt,
      });
      const after = snapshotOf(await store.read(ref));
      expect(after.value.info).toEqual({
        ...market.info, statement: 'ERP resellers resell invoice automation', expectedCandidates: 20, checkAgain: ['mustHaves'], updatedAt: NOW, updatedBy: 'Ruth',
      });
      expectOthersUnchanged(after.value, market, 'info');
    });

    it('sets and clears the program the market feeds', async () => {
      const { store, ref } = await created();
      await apply(store, ref, { kind: 'updateInfo', patch: { feedsProgramId: 'pg_contract1' } });
      const fed = snapshotOf(await store.read(ref));
      expect(fed.value.info).toEqual({ ...market.info, feedsProgramId: 'pg_contract1', updatedAt: NOW, updatedBy: 'Ruth' });
      expect(fed.issues).toEqual([]);
      expectOthersUnchanged(fed.value, market, 'info');
      await apply(store, ref, { kind: 'updateInfo', patch: { feedsProgramId: null } });
      expect(snapshotOf(await store.read(ref)).value.info.feedsProgramId).toBeNull();
    });

    it('clears a check-again flag', async () => {
      const { store, ref } = await created();
      await apply(store, ref, { kind: 'clearCheckAgain', target: { entity: 'market', field: 'statement' } });
      const after = snapshotOf(await store.read(ref)).value;
      expect(after.info).toEqual({ ...market.info, checkAgain: ['mustHaves'], updatedAt: NOW, updatedBy: 'Ruth' });
    });

    it('rejects a stale update as a conflict and leaves the file unchanged', async () => {
      const { store, ref, raw } = await created();
      const dumpBefore = raw && (await raw.dump(ref.fileId));
      const before = snapshotOf(await store.read(ref));
      expect(await store.apply(ref, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'x' }, expectedUpdatedAt: STALE }, stamp))
        .toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'x' }, expectedUpdatedAt: STALE }, stamp))
        .toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, { kind: 'updateInfo', patch: { statusNote: 'x' }, expectedUpdatedAt: STALE }, stamp))
        .toMatchObject({ ok: false, error: 'conflict' });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
      if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);
    });

    it('returns field errors for an invalid change and writes nothing', async () => {
      const { store, ref } = await created();
      const before = snapshotOf(await store.read(ref));
      const result = await store.apply(ref, { kind: 'add', entity: 'exclusion', values: { company: ' ' } }, stamp);
      expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { company: expect.any(String) } });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
    });

    it('reports not_found for a missing id and writes nothing', async () => {
      const { store, ref } = await created();
      const before = snapshotOf(await store.read(ref));
      expect(await store.apply(ref, { kind: 'update', entity: 'hypothesis', id: 'h_missing', patch: { name: 'x' } }, stamp)).toMatchObject({ ok: false, error: 'not_found' });
      expect(await store.apply(ref, { kind: 'delete', entity: 'change', id: 'g_missing' }, stamp)).toMatchObject({ ok: false, error: 'not_found' });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
    });

    it('stores text that looks like a formula as text', async () => {
      const { store, ref } = await created();
      const [company, website, reason, statement] = FORMULA_LIKE;
      const added = await apply(store, ref, { kind: 'add', entity: 'exclusion', values: { company, website, reason } });
      await apply(store, ref, { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { company: '-x', reason: '@acme' } });
      await apply(store, ref, { kind: 'updateInfo', patch: { statement } });
      const after = snapshotOf(await store.read(ref)).value;
      expect(after.exclusions.find((x) => x.id === added.entityId)).toMatchObject({ company, website, reason });
      expect(after.exclusions[0]).toMatchObject({ company: '-x', reason: '@acme' });
      expect(after.info.statement).toBe(statement);
    });

    describe('applyMany', () => {
      /** An imported hypothesis: the value point under a provisional id, then the hypothesis that uses it. */
      const imported = (text: string, provisional: string): MarketChange[] => [
        { kind: 'add', entity: 'valuePoint', values: { id: provisional, kind: 'portfolio', text } },
        { kind: 'add', entity: 'hypothesis', values: { name: `${text} shops`, valuePointIds: [provisional] } },
      ];

      it('applies a batch in one go, attaching each row to the one its provisional id named', async () => {
        const { store, ref } = await created();
        const result = expectOk(await store.applyMany(ref, [...imported('Kappa', 'tmp_a'), ...imported('Lambda', 'tmp_b')], stamp));
        expect(result.entityIds).toHaveLength(4);
        const [kappaV, kappaH, lambdaV, lambdaH] = result.entityIds;
        expect(kappaV).toMatch(/^v_[0-9a-z]{6}$/);
        expect(lambdaH).toMatch(/^h_[0-9a-z]{6}$/);
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(after.value.valuePoints.slice(-2).map((v) => [v.id, v.text, v.updatedAt])).toEqual([[kappaV, 'Kappa', NOW], [lambdaV, 'Lambda', NOW]]);
        expect(after.value.hypotheses.slice(-2).map((h) => [h.id, h.valuePointIds])).toEqual([[kappaH, [kappaV]], [lambdaH, [lambdaV]]]);
        expect(after.value.exclusions).toEqual(market.exclusions);
        expect(after.value.info).toEqual(market.info);
        expect(after.issues).toEqual([]);
      });

      it('writes nothing when any change is refused, and says how many came before it', async () => {
        const { store, ref, raw } = await created();
        const dumpBefore = raw && (await raw.dump(ref.fileId));
        const before = snapshotOf(await store.read(ref));
        const changes: MarketChange[] = [...imported('Kappa', 'tmp_a'), { kind: 'add', entity: 'exclusion', values: { company: ' ' } }];
        expect(await store.applyMany(ref, changes, stamp)).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { company: expect.any(String) }, valid: 2 });
        expect(snapshotOf(await store.read(ref))).toEqual(before);
        if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);
      });

      it('refuses a batch with a stale update as a conflict, writing nothing', async () => {
        const { store, ref } = await created();
        const before = snapshotOf(await store.read(ref));
        const changes: MarketChange[] = [
          ...imported('Kappa', 'tmp_a'),
          { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'x' }, expectedUpdatedAt: STALE },
        ];
        expect(await store.applyMany(ref, changes, stamp)).toMatchObject({ ok: false, error: 'conflict', valid: 2 });
        expect(snapshotOf(await store.read(ref))).toEqual(before);
      });

      it('reports unknown files', async () => {
        const { store } = make();
        expect(await store.applyMany({ fileId: 'does-not-exist' }, imported('Kappa', 'tmp_a'), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
      });
    });

    it('keeps two files apart', async () => {
      const { store, owner } = make();
      const a = await store.create(owner, sampleMarket());
      const other = sampleMarket({ info: { ...market.info, marketName: 'Germany' } });
      const b = await store.create(owner, other);
      expect(a.fileId).not.toBe(b.fileId);
      await store.apply({ fileId: b.fileId }, { kind: 'updateInfo', patch: { statusNote: 'Only in b' } }, stamp);
      expect(snapshotOf(await store.read({ fileId: a.fileId })).value).toEqual(market);
      expect(snapshotOf(await store.read({ fileId: b.fileId })).value.info.marketName).toBe('Germany');
    });

    describe('isolation', () => {
      it('does not change the file when a returned snapshot is mutated', async () => {
        const { store, ref } = await created();
        const read = snapshotOf(await store.read(ref));
        read.value.info.statement = 'Changed';
        read.value.hypotheses[0]!.valuePointIds.push('v_99');
        read.value.valuePoints.length = 0;
        read.issues.push({ tab: 't', row: 1, message: 'm' });
        const applied = expectOk(await store.apply(ref, { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'x' } }, stamp));
        applied.snapshot.value.hypotheses.length = 0;
        const after = snapshotOf(await store.read(ref));
        expect(after.value.info).toEqual(market.info);
        expect(after.value.hypotheses).toEqual(market.hypotheses);
        expect(after.value.valuePoints).toEqual(market.valuePoints);
        expect(after.issues).toEqual([]);
      });

      it('does not change the file when a change is mutated after it was applied', async () => {
        const { store, ref } = await created();
        const values = { name: 'Cloud ERP shops', valuePointIds: ['v_1'] };
        const added = await apply(store, ref, { kind: 'add', entity: 'hypothesis', values });
        const patch = { valuePointIds: ['v_2'] };
        await apply(store, ref, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch });
        const batch = [{ kind: 'add' as const, entity: 'hypothesis' as const, values: { name: 'Batch one', valuePointIds: ['v_1'] } }];
        expectOk(await store.applyMany(ref, batch, stamp));
        const before = snapshotOf(await store.read(ref));
        values.valuePointIds.push('v_2');
        values.name = 'Changed';
        patch.valuePointIds.push('v_1');
        batch[0]!.values.valuePointIds.push('v_2');
        const after = snapshotOf(await store.read(ref));
        expect(after).toEqual(before);
        expect(after.value.hypotheses.find((h) => h.id === added.entityId)).toMatchObject({ name: 'Cloud ERP shops', valuePointIds: ['v_1'] });
      });
    });

    describe('hand edits', () => {
      /** A new file with its raw access; the case is skipped when the adapter gives none. */
      async function edited(ctx: TestContext) {
        const harness = await created();
        if (!harness.raw) ctx.skip();
        return { ...harness, raw: harness.raw! };
      }

      it('reports a bad row and keeps it byte-for-byte through applies to other rows', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.breakRow(ref.fileId, 'valuePoint', 'v_2');
        const badRow = await raw.rowOf(ref.fileId, 'valuePoint', 'v_2');
        const read = snapshotOf(await store.read(ref));
        expect(read.issues.length).toBeGreaterThan(0);
        expect(read.issues.every((i) => i.tab.length > 0 && i.row > 0)).toBe(true);
        expect(read.value.valuePoints.map((v) => v.id)).toEqual(['v_1']);

        const added = await apply(store, ref, { kind: 'add', entity: 'valuePoint', values: { kind: 'portfolio', text: 'New one' } });
        await apply(store, ref, { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'Changed' } });
        await apply(store, ref, { kind: 'updateInfo', patch: { statusNote: 'Three calls back it up' } });

        expect(await raw.rowIds(ref.fileId, 'valuePoint')).toEqual(['v_1', 'v_2', added.entityId]);
        expect(await raw.rowOf(ref.fileId, 'valuePoint', 'v_2')).toEqual(badRow);
        expect(snapshotOf(await store.read(ref)).issues.length).toBe(read.issues.length);
      });

      it('keeps a bad hand-edited row byte-for-byte through a batch', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.breakRow(ref.fileId, 'valuePoint', 'v_2');
        const badRow = await raw.rowOf(ref.fileId, 'valuePoint', 'v_2');
        expectOk(await store.applyMany(ref, [{ kind: 'add', entity: 'valuePoint', values: { kind: 'portfolio', text: 'New one' } }], stamp));
        expect(await raw.rowOf(ref.fileId, 'valuePoint', 'v_2')).toEqual(badRow);
      });

      it('keeps a column the user added, and never fills a row that has only the user’s notes', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.addUserNotes(ref.fileId, 'exclusion', 'My notes', { x_1: 'keep me' }, 'Call Omega back in May');
        await apply(store, ref, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'Renamed' } });
        const added = await apply(store, ref, { kind: 'add', entity: 'exclusion', values: { company: 'Zeta GmbH' } });
        const notes = await raw.userNotes(ref.fileId, 'exclusion', 'My notes');
        expect(notes.find((n) => n.id === 'x_1')?.note).toBe('keep me');
        expect(notes.filter((n) => n.id === null)).toEqual([{ id: null, note: 'Call Omega back in May' }]);
        expect(notes.find((n) => n.id === added.entityId)?.note ?? '').toBe('');
        const after = snapshotOf(await store.read(ref));
        expect(after.value.exclusions.map((x) => x.id)).toEqual(['x_1', added.entityId]);
        expect(after.issues).toEqual([]);
      });

      it('never overwrites a Market value it cannot read, unless that field is edited', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.breakField(ref.fileId, 'info', 'info', 'expectedCandidates');
        const typed = await raw.fieldOf(ref.fileId, 'info', 'info', 'expectedCandidates');
        const read = snapshotOf(await store.read(ref));
        expect(read.value.info.expectedCandidates).toBeNull();
        expect(read.issues.length).toBeGreaterThan(0);

        await apply(store, ref, { kind: 'updateInfo', patch: { statusNote: 'Three calls back it up' } });
        expect(await raw.fieldOf(ref.fileId, 'info', 'info', 'expectedCandidates')).toEqual(typed);
        expect(snapshotOf(await store.read(ref)).issues.length).toBe(read.issues.length);

        await apply(store, ref, { kind: 'updateInfo', patch: { expectedCandidates: 12 } });
        const after = snapshotOf(await store.read(ref));
        expect(after.value.info.expectedCandidates).toBe(12);
        expect(after.issues).toEqual([]);
      });

      it('gives a row typed without an id a real id on the next apply', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.typeRowWithoutId(ref.fileId, 'exclusion', { company: 'Typed GmbH', website: 'typed.at', reason: 'Typed by hand' });
        expect(snapshotOf(await store.read(ref)).value.exclusions.find((x) => x.company === 'Typed GmbH')?.id).toEqual(expect.any(String));
        await apply(store, ref, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'Renamed' } });
        const after = snapshotOf(await store.read(ref));
        expect(after.value.exclusions.find((x) => x.company === 'Typed GmbH')?.id).toMatch(/^x_[0-9a-z]{6}$/);
        expect(after.issues).toEqual([]);
      });

      it('keeps both rows of a copy-pasted row and gives the copy a new id', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        await raw.copyRow(ref.fileId, 'exclusion', 'x_1');
        expect(snapshotOf(await store.read(ref)).value.exclusions).toHaveLength(2);
        await apply(store, ref, { kind: 'updateInfo', patch: { statusNote: 'Two calls back it up, again' } });
        const after = snapshotOf(await store.read(ref));
        const ids = after.value.exclusions.map((x) => x.id);
        expect(ids[0]).toBe('x_1');
        expect(ids[1]).toMatch(/^x_[0-9a-z]{6}$/);
        expect(after.issues).toEqual([]);
      });

      it('reports a missing tab as a structure error naming it, and an apply writes nothing', async (ctx) => {
        const { store, ref, raw } = await edited(ctx);
        const { tab } = await raw.removeTab(ref.fileId, 'exclusion');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'x' } }, stamp)).toMatchObject({ ok: false, error: 'structure', tab });
        expect(await store.apply(ref, { kind: 'updateInfo', patch: { statusNote: 'x' } }, stamp)).toMatchObject({ ok: false, error: 'structure', tab });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });
    });

    it('discards a file without throwing, even one already discarded or one that never existed', async () => {
      const { store, ref } = await created();
      await expect(store.discard(ref)).resolves.toBeUndefined();
      await expect(store.discard(ref)).resolves.toBeUndefined();
      await expect(store.discard({ fileId: 'does-not-exist' })).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    it('reports unknown files', async () => {
      const { store } = make();
      expect(await store.read({ fileId: 'does-not-exist' })).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply({ fileId: 'does-not-exist' }, { kind: 'updateInfo', patch: {} }, stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    });
  });
}

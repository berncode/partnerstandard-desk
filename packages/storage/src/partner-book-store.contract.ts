// The Partners file cases, hand edits behind `raw`.
import { describe, expect, it, type TestContext } from 'vitest';
import { COLLECTION, deleteSectionChanges, type ChangeStamp, type PartnerBook, type PartnerChange, type PartnerEntity } from '@partner-desk/core';
import { expectOk, NOW, snapshotOf, STALE, without } from './contract-helpers';
import { SHEET_COPY } from '@partner-desk/copy';
import { PARTNERS_LAYOUT } from './sheet-codec/layouts';
import type { ContractHarness, FileRef, PartnerBookStore } from './types';

const COMPANY_ID = 'co_contract01';
const MARKET_ID = 'm_contract001';

/** Every kind of row the Partners file holds, in file order: a new kind is covered by every per-entity case below. */
const ENTITIES: readonly PartnerEntity[] = PARTNERS_LAYOUT.entityOrder;
type Item = { id: string; updatedAt: string | null } & Record<string, unknown>;
const itemsOf = (book: PartnerBook, entity: PartnerEntity) => book[COLLECTION[entity]] as unknown as Item[];
const an = (entity: string) => `${/^[aeiou]/.test(entity) ? 'an' : 'a'} ${entity}`;

/** Values for an add and a patch for an update, per entity. `p` is the id of a seeded partner, `a` of its account. */
const CASES = (p: string, a: string): Record<PartnerEntity, { add: Record<string, unknown>; patch: Record<string, unknown> }> => ({
  account: {
    add: { company: 'Zeta GmbH', website: 'https://zeta.example', country: 'Austria', targetCustomerType: 'smb' },
    patch: { comments: 'Met at a fair', vertical: 'Managed IT' },
  },
  // The seeded partners are resellers: a company has one partner of each type.
  partner: { add: { accountId: a, partnerType: 'var', source: 'existing_partner' }, patch: { whyItFits: 'Sells to our buyers' } },
  person: { add: { accountId: a, name: 'Max Muster', email: 'max@zeta.example', role: 'sponsor' }, patch: { title: 'CEO', activeSeller: true } },
  call: { add: { partnerId: p, date: '2026-10-20', kind: 'follow_up', notes: 'Pricing agreed' }, patch: { notes: 'Pricing sent.\nMAP template sent.' } },
  qualification: { add: { partnerId: p, q1Overlap: 'Ten shared customers' }, patch: { q2DealFit: 'Deals around 20k' } },
  marketLink: { add: { partnerId: p, marketId: MARKET_ID }, patch: { hypothesisId: 'h_contract' } },
  // Only the proposals commands write these rows; the store takes them like any other.
  proposalItem: {
    add: {
      proposalId: 'prp_contract', kind: 'fourC', accountId: a, partnerId: p, about: 'Zeta GmbH', what: 'desk.credibility', proposed: '3',
      evidence: 'Ten customers named on their site', proposedBy: 'Claude for Ruth', proposedOn: '2026-10-01T09:00:00.000Z',
      expiresOn: '2026-10-31T09:00:00.000Z', targetUpdated: '2026-10-01T09:00:00.000Z',
    },
    patch: { status: 'rejected', answerNote: 'Not yet', answeredOn: NOW },
  },
});

/** Every PartnerBookStore implementation must pass this suite. */
export function runPartnerBookStoreContract(name: string, make: () => ContractHarness<PartnerBookStore>): void {
  describe(`PartnerBookStore contract: ${name}`, () => {
    const stamp: ChangeStamp = { now: NOW, actor: 'Ruth' };

    /** A new book holding two companies, each a reseller with one row of every kind, made in one applyMany. */
    async function seeded() {
      const harness = make();
      const file = await harness.store.create(harness.owner, COMPANY_ID);
      const ref: FileRef = { fileId: file.fileId };
      const rows = (tmp: string, company: string): PartnerChange[] => {
        const account = `${tmp}_account`;
        const cases = CASES(tmp, account);
        return [
          { kind: 'add', entity: 'account', values: { id: account, company } },
          { kind: 'add', entity: 'partner', values: { id: tmp, accountId: account, partnerType: 'reseller' } },
          { kind: 'add', entity: 'person', values: { ...cases.person.add, name: `${company} contact` } },
          { kind: 'add', entity: 'call', values: cases.call.add },
          { kind: 'add', entity: 'qualification', values: cases.qualification.add },
          { kind: 'add', entity: 'marketLink', values: cases.marketLink.add },
          { kind: 'add', entity: 'proposalItem', values: { ...cases.proposalItem.add, about: company } },
        ];
      };
      const result = expectOk(await harness.store.applyMany(ref, [...rows('tmp_a', 'Alpha GmbH'), ...rows('tmp_b', 'Beta AG')], { ...stamp, now: '2026-10-01T09:00:00.000Z' }));
      const book = result.snapshot.value;
      return {
        ...harness, ref, file, book, partnerId: book.partners[0]!.id, otherPartnerId: book.partners[1]!.id,
        accountId: book.accounts[0]!.id, otherAccountId: book.accounts[1]!.id,
      };
    }

    async function apply(store: PartnerBookStore, ref: FileRef, change: PartnerChange) {
      return expectOk(await store.apply(ref, change, stamp));
    }

    /** Every row of every kind is as in `before`, except the one `except` names. */
    function expectOthersUnchanged(after: PartnerBook, before: PartnerBook, except: { entity: PartnerEntity; id: string | null } | null) {
      expect(after.companyId).toBe(before.companyId);
      for (const entity of ENTITIES) {
        const skip = except && entity === except.entity ? except.id : null;
        expect(without(itemsOf(after, entity), skip)).toEqual(without(itemsOf(before, entity), skip));
      }
    }

    it('links to the file it created', async () => {
      const { store, owner } = make();
      const file = await store.create(owner, COMPANY_ID);
      expect(store.urlFor({ fileId: file.fileId })).toBe(file.fileUrl);
    });

    it('reads back an empty book it created', async () => {
      const { store, owner } = make();
      const file = await store.create(owner, COMPANY_ID);
      const snapshot = snapshotOf(await store.read({ fileId: file.fileId }));
      expect(snapshot.value).toEqual({
        companyId: COMPANY_ID, accounts: [], partners: [], people: [], calls: [], qualifications: [], marketLinks: [], proposalItems: [],
      });
      expect(snapshot.issues).toEqual([]);
    });

    it('keeps two files apart', async () => {
      const { store, owner } = make();
      const a = await store.create(owner, 'co_first00001');
      const b = await store.create(owner, 'co_second0002');
      expect(a.fileId).not.toBe(b.fileId);
      expect(snapshotOf(await store.read({ fileId: a.fileId })).value.companyId).toBe('co_first00001');
      expect(snapshotOf(await store.read({ fileId: b.fileId })).value.companyId).toBe('co_second0002');
    });

    it('reads back exactly what the seeding batch wrote', async () => {
      const { store, ref, book } = await seeded();
      expect(book.partners).toHaveLength(2);
      for (const entity of ENTITIES) expect(itemsOf(book, entity)).toHaveLength(2);
      expect(book.partners.map((p) => p.accountId)).toEqual(book.accounts.map((a) => a.id));
      expect(book.people.map((e) => e.accountId)).toEqual(book.accounts.map((a) => a.id));
      const snapshot = snapshotOf(await store.read(ref));
      expect(snapshot.value).toEqual(book);
      expect(snapshot.issues).toEqual([]);
    });

    for (const entity of ENTITIES) {
      it(`adds ${an(entity)} and leaves everything else alone`, async () => {
        const { store, ref, book, partnerId, accountId } = await seeded();
        const { add } = CASES(partnerId, accountId)[entity];
        // A partner may have one qualification and one link per market: use the free partner or market.
        const values = entity === 'qualification' || entity === 'marketLink' ? { ...add, partnerId: 'p_free01' } : add;
        const result = await apply(store, ref, { kind: 'add', entity, values });
        expect(result.entityId).toEqual(expect.any(String));
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(itemsOf(after.value, entity).find((item) => item.id === result.entityId)).toMatchObject({ ...values, updatedAt: NOW, updatedBy: 'Ruth' });
        expect(itemsOf(after.value, entity)).toHaveLength(itemsOf(book, entity).length + 1);
        expectOthersUnchanged(after.value, book, { entity, id: result.entityId });
        expect(after.issues).toEqual([]);
      });

      it(`updates ${an(entity)} with its current Updated value and leaves everything else alone`, async () => {
        const { store, ref, book, partnerId, accountId } = await seeded();
        const current = itemsOf(book, entity)[0]!;
        const { patch } = CASES(partnerId, accountId)[entity];
        await apply(store, ref, { kind: 'update', entity, id: current.id, patch, expectedUpdatedAt: current.updatedAt });
        const after = snapshotOf(await store.read(ref));
        expect(itemsOf(after.value, entity).find((item) => item.id === current.id)).toMatchObject({ ...patch, updatedAt: NOW, updatedBy: 'Ruth' });
        expectOthersUnchanged(after.value, book, { entity, id: current.id });
        expect(after.issues).toEqual([]);
      });

      // A company goes only once its partner types have: see 'accounts' below.
      if (entity !== 'account') {
        it(`deletes ${an(entity)} and leaves everything else alone`, async () => {
          const { store, ref, book } = await seeded();
          const target = itemsOf(book, entity)[1]!;
          const result = await apply(store, ref, { kind: 'delete', entity, id: target.id });
          const after = snapshotOf(await store.read(ref));
          expect(result.snapshot).toEqual(after);
          expect(itemsOf(after.value, entity).map((item) => item.id)).toEqual(without(itemsOf(book, entity), target.id).map((item) => item.id));
          expectOthersUnchanged(after.value, book, { entity, id: target.id });
          expect(after.issues).toEqual([]);
        });
      }
    }

    describe('accounts', () => {
      it('deletes a company without partner types and leaves everything else alone', async () => {
        const { store, ref } = await seeded();
        const added = await apply(store, ref, { kind: 'add', entity: 'account', values: CASES('', '').account.add });
        const before = snapshotOf(await store.read(ref)).value;
        const result = await apply(store, ref, { kind: 'delete', entity: 'account', id: added.entityId! });
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(after.value.accounts.map((a) => a.id)).toEqual(without(before.accounts as unknown as Item[], added.entityId).map((a) => a.id));
        expectOthersUnchanged(after.value, before, { entity: 'account', id: added.entityId });
        expect(after.issues).toEqual([]);
      });

      it('refuses to delete a company that still has partner types, writing nothing', async () => {
        const { store, ref, raw, accountId } = await seeded();
        const dumpBefore = raw && (await raw.dump(ref.fileId));
        const before = snapshotOf(await store.read(ref));
        expect(await store.apply(ref, { kind: 'delete', entity: 'account', id: accountId }, stamp)).toMatchObject({ ok: false, error: 'invalid' });
        expect(snapshotOf(await store.read(ref))).toEqual(before);
        if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);
      });

      it('adds a second partner type to a company, keeping its people and its first type', async () => {
        const { store, ref, book, accountId, partnerId } = await seeded();
        const added = await apply(store, ref, { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'distributor' } });
        const after = snapshotOf(await store.read(ref)).value;
        expect(after.partners.filter((p) => p.accountId === accountId).map((p) => [p.id, p.partnerType]))
          .toEqual([[partnerId, 'reseller'], [added.entityId, 'distributor']]);
        expect(after.people).toEqual(book.people);
        expect(await store.apply(ref, { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } }, stamp))
          .toMatchObject({ ok: false, error: 'invalid' });
      });

      it('deletes a company’s last partner type, its people and the company in one applyMany', async () => {
        const { store, ref, book, otherPartnerId, otherAccountId } = await seeded();
        const changes = deleteSectionChanges(book, otherPartnerId);
        expect(changes.map((c) => c.kind === 'delete' && c.entity)).toEqual(['partner', 'person', 'account']);
        const result = expectOk(await store.applyMany(ref, changes, stamp));
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(after.value.accounts).toEqual(book.accounts.filter((a) => a.id !== otherAccountId));
        expect(after.value.partners).toEqual(book.partners.filter((p) => p.id !== otherPartnerId));
        expect(after.value.people).toEqual(book.people.filter((e) => e.accountId !== otherAccountId));
        // Calls, qualifications, market links and proposals are kept (no cascade), for the app to flag.
        for (const entity of ['call', 'qualification', 'marketLink', 'proposalItem'] as const) {
          expect(itemsOf(after.value, entity)).toEqual(itemsOf(book, entity));
        }
        expect(after.issues).toEqual([]);
      });

      it('keeps a company and its people when one of its two partner types is deleted', async () => {
        const { store, ref, book, accountId, partnerId } = await seeded();
        await apply(store, ref, { kind: 'add', entity: 'partner', values: { accountId, partnerType: 'distributor' } });
        const mid = snapshotOf(await store.read(ref)).value;
        const changes = deleteSectionChanges(mid, partnerId);
        expect(changes).toEqual([{ kind: 'delete', entity: 'partner', id: partnerId }]);
        expectOk(await store.applyMany(ref, changes, stamp));
        const after = snapshotOf(await store.read(ref)).value;
        expect(after.accounts).toEqual(book.accounts);
        expect(after.people).toEqual(book.people);
        expect(after.partners.map((p) => p.id)).not.toContain(partnerId);
      });
    });

    it('signs, moves and exits a partner through the store', async () => {
      const { store, ref, book, partnerId, otherPartnerId } = await seeded();
      await apply(store, ref, { kind: 'setStep', partnerId, to: 'discovery_call' });
      await apply(store, ref, { kind: 'setStep', partnerId, to: 'qualification' });
      await apply(store, ref, { kind: 'setStep', partnerId, to: 'map' });
      await apply(store, ref, { kind: 'markSigned', partnerId, signedDate: '2026-10-20' });
      expect(snapshotOf(await store.read(ref)).value.partners.find((p) => p.id === partnerId))
        .toMatchObject({ stage: 'onboarding', step: null, signedDate: '2026-10-20', updatedAt: NOW });
      await apply(store, ref, { kind: 'setStage', partnerId, to: 'growth' });
      await apply(store, ref, { kind: 'markExited', partnerId, exitedDate: '2026-10-27', reason: 'Moved to a competitor' });
      await apply(store, ref, { kind: 'close', partnerId: otherPartnerId, as: 'not_now', reason: 'Busy until spring' });
      await apply(store, ref, { kind: 'reopen', partnerId: otherPartnerId });
      const after = snapshotOf(await store.read(ref)).value;
      expect(after.partners.find((p) => p.id === partnerId))
        .toMatchObject({ stage: 'exit', exitedDate: '2026-10-27', exitReason: 'Moved to a competitor', signedDate: '2026-10-20' });
      expect(after.partners.find((p) => p.id === otherPartnerId)).toMatchObject({ closed: null, closedReason: '' });
      for (const entity of ENTITIES.filter((e) => e !== 'partner')) expect(itemsOf(after, entity)).toEqual(itemsOf(book, entity));
    });

    it('refuses a lifecycle move that breaks a rule and writes nothing', async () => {
      const { store, ref, partnerId } = await seeded();
      const before = snapshotOf(await store.read(ref));
      expect(await store.apply(ref, { kind: 'markExited', partnerId, exitedDate: '2026-10-27', reason: 'x' }, stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect(await store.apply(ref, { kind: 'setStage', partnerId, to: 'growth' }, stamp)).toMatchObject({ ok: false, error: 'invalid' });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
    });

    it('sets, moves and clears a partner type’s program and level, and leaves everything else alone', async () => {
      const { store, ref, book, partnerId } = await seeded();
      const placed = await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { programId: 'pg_contract1', level: 'reg' } });
      expect(placed.snapshot.value.partners.find((p) => p.id === partnerId)).toMatchObject({ programId: 'pg_contract1', level: 'reg' });
      await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { level: 'pref' } });
      const moved = snapshotOf(await store.read(ref)).value;
      expect(moved.partners.find((p) => p.id === partnerId)).toMatchObject({ programId: 'pg_contract1', level: 'pref', updatedBy: 'Ruth' });
      expectOthersUnchanged(moved, book, { entity: 'partner', id: partnerId });
      await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { programId: null, level: null } });
      expect(snapshotOf(await store.read(ref)).value.partners.find((p) => p.id === partnerId)).toMatchObject({ programId: null, level: null });
    });

    it('writes a partner type’s MAP health and next milestone without stamping its Updated, and leaves everything else alone', async () => {
      const { store, ref, book, partnerId } = await seeded();
      const before = book.partners.find((p) => p.id === partnerId)!;
      await apply(store, ref, {
        kind: 'setMapSummary', partnerId, health: 'at_risk', nextMilestone: '2026-11-20', expectedUpdatedAt: before.updatedAt,
      });
      const after = snapshotOf(await store.read(ref)).value;
      // Ruling R5: Updated and Updated by stay as they were, so a screen holding the row gets no conflict.
      expect(after.partners.find((p) => p.id === partnerId)).toEqual({ ...before, mapHealth: 'at_risk', mapNextMilestone: '2026-11-20' });
      expectOthersUnchanged(after, book, { entity: 'partner', id: partnerId });
      await apply(store, ref, { kind: 'setMapSummary', partnerId, health: null, nextMilestone: null });
      expect(snapshotOf(await store.read(ref)).value.partners.find((p) => p.id === partnerId)).toMatchObject({ mapHealth: null, mapNextMilestone: null });
    });

    it('refuses a stale MAP health save as a conflict and writes nothing', async () => {
      const { store, ref, raw, partnerId } = await seeded();
      const dumpBefore = raw && (await raw.dump(ref.fileId));
      const before = snapshotOf(await store.read(ref));
      expect(await store.apply(ref, { kind: 'setMapSummary', partnerId, health: 'off_track', nextMilestone: null, expectedUpdatedAt: STALE }, stamp))
        .toMatchObject({ ok: false, error: 'conflict' });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
      if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);
    });

    it('refuses a level without a program and writes nothing', async () => {
      const { store, ref, partnerId } = await seeded();
      const before = snapshotOf(await store.read(ref));
      const result = await store.apply(ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { level: 'pref' } }, stamp);
      expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { level: expect.any(String) } });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
    });

    it('rejects a stale update as a conflict and leaves the file unchanged', async () => {
      const { store, ref, raw, partnerId, book } = await seeded();
      const dumpBefore = raw && (await raw.dump(ref.fileId));
      const before = snapshotOf(await store.read(ref));
      expect(await store.apply(ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'x' }, expectedUpdatedAt: STALE }, stamp))
        .toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, { kind: 'update', entity: 'account', id: book.accounts[0]!.id, patch: { comments: 'x' }, expectedUpdatedAt: STALE }, stamp))
        .toMatchObject({ ok: false, error: 'conflict' });
      expect(await store.apply(ref, { kind: 'update', entity: 'person', id: book.people[0]!.id, patch: { name: 'x' }, expectedUpdatedAt: STALE }, stamp))
        .toMatchObject({ ok: false, error: 'conflict' });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
      if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);
    });

    it('returns field errors for an invalid change and writes nothing', async () => {
      const { store, ref } = await seeded();
      const before = snapshotOf(await store.read(ref));
      const result = await store.apply(ref, { kind: 'add', entity: 'account', values: { company: ' ' } }, stamp);
      expect(result).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { company: expect.any(String) } });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
    });

    it('keeps a single add\'s own id, and refuses a second add with that id', async () => {
      const { store, ref } = await seeded();
      const added = expectOk(await store.apply(ref, {
        kind: 'add', entity: 'account', values: { id: 'a_kept', company: 'Kept GmbH' },
      }, stamp));
      expect(added.entityId).toBe('a_kept');
      const after = snapshotOf(await store.read(ref)).value;
      expect(after.accounts.find((a) => a.id === 'a_kept')).toMatchObject({ company: 'Kept GmbH', updatedBy: 'Ruth', updatedAt: NOW });
      const again = await store.apply(ref, { kind: 'add', entity: 'account', values: { id: 'a_kept', company: 'Other' } }, stamp);
      expect(again).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { id: expect.any(String) } });
      expect(snapshotOf(await store.read(ref)).value.accounts.filter((a) => a.id === 'a_kept')).toHaveLength(1);
    });

    it('reports not_found for a missing id and writes nothing', async () => {
      const { store, ref } = await seeded();
      const before = snapshotOf(await store.read(ref));
      expect(await store.apply(ref, { kind: 'update', entity: 'person', id: 'e_missing', patch: { name: 'x' } }, stamp)).toMatchObject({ ok: false, error: 'not_found' });
      expect(await store.apply(ref, { kind: 'delete', entity: 'call', id: 'k_missing' }, stamp)).toMatchObject({ ok: false, error: 'not_found' });
      expect(snapshotOf(await store.read(ref))).toEqual(before);
    });

    it('stores text that looks like a formula as text', async () => {
      const { store, ref } = await seeded();
      const formulas = ['=HYPERLINK("https://evil.test","Acme")', '+43 1 234 56', '@acme', '-x', '=SUM(1,2)\n+1'];
      const [company, website, comments, whyItFits] = formulas;
      const result = expectOk(await store.applyMany(ref, [
        { kind: 'add', entity: 'account', values: { id: 'tmp_f', company, website, comments } },
        { kind: 'add', entity: 'partner', values: { accountId: 'tmp_f', whyItFits, partnerType: 'reseller' } },
      ], stamp));
      const after = snapshotOf(await store.read(ref)).value;
      expect(after.accounts.find((a) => a.id === result.entityIds[0])).toMatchObject({ company, website, comments });
      expect(after.partners.find((p) => p.id === result.entityIds[1])).toMatchObject({ whyItFits });
    });

    describe('applyMany', () => {
      /** An imported company: its account and partner under provisional ids, then its desk notes and market link pointing at it. */
      const imported = (company: string, provisional: string): PartnerChange[] => [
        { kind: 'add', entity: 'account', values: { id: `${provisional}_account`, company, website: `${provisional}.example` } },
        { kind: 'add', entity: 'partner', values: { id: provisional, accountId: `${provisional}_account`, partnerType: 'reseller', source: 'ai_search' } },
        { kind: 'add', entity: 'marketLink', values: { partnerId: provisional, marketId: MARKET_ID } },
        { kind: 'add', entity: 'qualification', values: { partnerId: provisional, deskNotes: { customerBase: `${company} site` } } },
      ];

      it('adds a company, its partner and its market link in one applyMany', async () => {
        const { store, ref, book } = await seeded();
        const result = expectOk(await store.applyMany(ref, [
          { kind: 'add', entity: 'account', values: { id: 'tmp_xa', company: 'Kappa GmbH' } },
          { kind: 'add', entity: 'partner', values: { id: 'tmp_x', accountId: 'tmp_xa', partnerType: 'reseller' } },
          { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_x', marketId: 'm_other00001' } },
        ], stamp));
        const [accountId, partnerId, linkId] = result.entityIds;
        expect(accountId).toMatch(/^a_[0-9a-z]{6}$/);
        expect(partnerId).toMatch(/^p_[0-9a-z]{6}$/);
        expect(linkId).toMatch(/^l_[0-9a-z]{6}$/);
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(after.value.accounts.at(-1)).toMatchObject({ id: accountId, company: 'Kappa GmbH', updatedAt: NOW });
        expect(after.value.partners.at(-1)).toMatchObject({ id: partnerId, accountId, updatedAt: NOW });
        expect(after.value.marketLinks.at(-1)).toMatchObject({ id: linkId, partnerId, marketId: 'm_other00001', updatedAt: NOW });
        expect(after.value.partners.slice(0, 2)).toEqual(book.partners);
        expect(after.value.marketLinks.slice(0, 2)).toEqual(book.marketLinks);
        expect(after.issues).toEqual([]);
      });

      it('applies a batch in one go, attaching each row to the one its provisional id named', async () => {
        const { store, ref } = await seeded();
        const result = expectOk(await store.applyMany(ref, [...imported('Kappa GmbH', 'tmp_a'), ...imported('Lambda AG', 'tmp_b')], stamp));
        expect(result.entityIds).toHaveLength(8);
        const [kappaA, kappa, , kappaQ, lambdaA, lambda, , lambdaQ] = result.entityIds;
        const after = snapshotOf(await store.read(ref));
        expect(result.snapshot).toEqual(after);
        expect(after.value.accounts.slice(-2).map((a) => [a.id, a.company])).toEqual([[kappaA, 'Kappa GmbH'], [lambdaA, 'Lambda AG']]);
        expect(after.value.partners.slice(-2).map((p) => [p.id, p.accountId, p.updatedAt])).toEqual([[kappa, kappaA, NOW], [lambda, lambdaA, NOW]]);
        expect(after.value.qualifications.slice(-2).map((q) => [q.id, q.partnerId, q.deskNotes.customerBase]))
          .toEqual([[kappaQ, kappa, 'Kappa GmbH site'], [lambdaQ, lambda, 'Lambda AG site']]);
        expect(after.issues).toEqual([]);
      });

      it('writes nothing when any change is refused, and says how many came before it', async () => {
        const { store, ref, raw } = await seeded();
        const dumpBefore = raw && (await raw.dump(ref.fileId));
        const before = snapshotOf(await store.read(ref));
        const changes: PartnerChange[] = [...imported('Kappa GmbH', 'tmp_a'), { kind: 'add', entity: 'account', values: { company: ' ' } }];
        expect(await store.applyMany(ref, changes, stamp)).toMatchObject({ ok: false, error: 'invalid', fieldErrors: { company: expect.any(String) }, valid: 4 });
        expect(snapshotOf(await store.read(ref))).toEqual(before);
        if (raw) expect(await raw.dump(ref.fileId)).toEqual(dumpBefore);
      });

      it('refuses a batch with a stale update as a conflict, writing nothing', async () => {
        const { store, ref, partnerId } = await seeded();
        const before = snapshotOf(await store.read(ref));
        const changes: PartnerChange[] = [
          ...imported('Kappa GmbH', 'tmp_a'),
          { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'x' }, expectedUpdatedAt: STALE },
        ];
        expect(await store.applyMany(ref, changes, stamp)).toMatchObject({ ok: false, error: 'conflict', valid: 4 });
        expect(snapshotOf(await store.read(ref))).toEqual(before);
      });

      it('reports unknown files', async () => {
        const { store } = make();
        expect(await store.applyMany({ fileId: 'does-not-exist' }, imported('Kappa GmbH', 'tmp_a'), stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
      });
    });

    describe('isolation', () => {
      it('does not change the file when a returned snapshot is mutated', async () => {
        const { store, ref } = await seeded();
        const before = snapshotOf(await store.read(ref));
        const read = snapshotOf(await store.read(ref));
        read.value.accounts[0]!.company = 'Changed';
        read.value.partners.pop();
        read.value.marketLinks.length = 0;
        read.issues.push({ tab: 't', row: 1, message: 'm' });
        const applied = expectOk(await store.apply(ref, { kind: 'update', entity: 'partner', id: before.value.partners[0]!.id, patch: { whyItFits: 'x' } }, stamp));
        applied.snapshot.value.partners.length = 0;
        const after = snapshotOf(await store.read(ref));
        expect(after.value.partners).toHaveLength(2);
        expect(after.value.accounts[0]!.company).toBe(before.value.accounts[0]!.company);
        expect(after.value.marketLinks).toEqual(before.value.marketLinks);
        expect(after.issues).toEqual([]);
      });

      it('does not change the file when a change is mutated after it was applied', async () => {
        const { store, ref, accountId, otherAccountId } = await seeded();
        const values = { accountId, partnerType: 'var', whyItFits: 'Zeta', desk: { credibility: 1 } };
        const added = await apply(store, ref, { kind: 'add', entity: 'partner', values });
        const before = snapshotOf(await store.read(ref));
        values.whyItFits = 'Changed';
        values.desk.credibility = 3;
        const batch = [{ kind: 'add' as const, entity: 'partner' as const, values: { id: 'tmp_q', accountId: otherAccountId, partnerType: 'var', whyItFits: 'Kappa', desk: { capability: 2 } } }];
        expectOk(await store.applyMany(ref, batch, stamp));
        const mid = snapshotOf(await store.read(ref));
        batch[0]!.values.whyItFits = 'Changed';
        (batch[0]!.values.desk as { capability: number }).capability = 0;
        expect(snapshotOf(await store.read(ref))).toEqual(mid);
        expect(mid.value.partners.find((p) => p.id === added.entityId)).toEqual(before.value.partners.find((p) => p.id === added.entityId));
        expect(mid.value.partners.find((p) => p.id === added.entityId)).toMatchObject({ whyItFits: 'Zeta', desk: { credibility: 1 } });
      });
    });

    describe('hand edits', () => {
      /** The seeded file with its raw access; the case is skipped when the adapter gives none. */
      async function edited(ctx: TestContext) {
        const seed = await seeded();
        if (!seed.raw) ctx.skip();
        return { ...seed, raw: seed.raw! };
      }

      it('reports a bad row and keeps it byte-for-byte through applies to other rows', async (ctx) => {
        const { store, ref, raw, partnerId, otherPartnerId } = await edited(ctx);
        await raw.breakRow(ref.fileId, 'partner', otherPartnerId);
        const badRow = await raw.rowOf(ref.fileId, 'partner', otherPartnerId);
        const read = snapshotOf(await store.read(ref));
        expect(read.issues.length).toBeGreaterThan(0);
        expect(read.issues.every((i) => i.tab.length > 0 && i.row > 0)).toBe(true);
        expect(read.value.partners.map((p) => p.id)).toEqual([partnerId]);

        const added = await apply(store, ref, { kind: 'add', entity: 'partner', values: { accountId: read.value.accounts[0]!.id, partnerType: 'var' } });
        await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'Called back' } });
        await apply(store, ref, { kind: 'setStep', partnerId, to: 'discovery_call' });

        expect(await raw.rowIds(ref.fileId, 'partner')).toEqual([partnerId, otherPartnerId, added.entityId]);
        expect(await raw.rowOf(ref.fileId, 'partner', otherPartnerId)).toEqual(badRow);
        const after = snapshotOf(await store.read(ref));
        expect(after.issues.length).toBe(read.issues.length);
        expect(after.value.partners.find((p) => p.id === partnerId)?.whyItFits).toBe('Called back');
      });

      it('keeps a bad hand-edited row byte-for-byte through a batch', async (ctx) => {
        const { store, ref, raw, otherPartnerId } = await edited(ctx);
        await raw.breakRow(ref.fileId, 'partner', otherPartnerId);
        const badRow = await raw.rowOf(ref.fileId, 'partner', otherPartnerId);
        const result = expectOk(await store.applyMany(ref, [
          { kind: 'add', entity: 'account', values: { id: 'tmp_aa', company: 'Kappa GmbH' } },
          { kind: 'add', entity: 'partner', values: { id: 'tmp_a', accountId: 'tmp_aa', partnerType: 'reseller' } },
          { kind: 'add', entity: 'marketLink', values: { partnerId: 'tmp_a', marketId: 'm_other00001' } },
        ], stamp));
        expect(await raw.rowOf(ref.fileId, 'partner', otherPartnerId)).toEqual(badRow);
        expect((await raw.rowIds(ref.fileId, 'partner')).at(-1)).toBe(result.entityIds[1]);
      });

      it('keeps a column the user added, and never fills a row that has only the user’s notes', async (ctx) => {
        const { store, ref, raw, partnerId, otherPartnerId, book } = await edited(ctx);
        await raw.addUserNotes(ref.fileId, 'partner', 'My notes', { [partnerId]: 'keep me' }, 'Call Omega back in May');
        await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'Great call' } });
        const added = await apply(store, ref, { kind: 'add', entity: 'partner', values: { accountId: book.accounts[0]!.id, partnerType: 'var' } });
        const notes = await raw.userNotes(ref.fileId, 'partner', 'My notes');
        expect(notes.find((n) => n.id === partnerId)?.note).toBe('keep me');
        expect(notes.filter((n) => n.id === null)).toEqual([{ id: null, note: 'Call Omega back in May' }]);
        expect(notes.find((n) => n.id === added.entityId)?.note ?? '').toBe('');
        expect((await raw.rowIds(ref.fileId, 'partner')).filter((id) => id !== '')).toEqual([partnerId, otherPartnerId, added.entityId]);
        const after = snapshotOf(await store.read(ref));
        expect(after.value.partners.map((p) => p.id)).toEqual([partnerId, otherPartnerId, added.entityId]);
        expect(after.issues).toEqual([]);
      });

      it('never overwrites a value it cannot read, unless that field is edited', async (ctx) => {
        const { store, ref, raw, partnerId } = await edited(ctx);
        await raw.breakField(ref.fileId, 'partner', partnerId, 'desk.credibility');
        const typed = await raw.fieldOf(ref.fileId, 'partner', partnerId, 'desk.credibility');
        const read = snapshotOf(await store.read(ref));
        expect(read.issues.length).toBeGreaterThan(0);
        expect(read.value.partners.find((p) => p.id === partnerId)?.desk.credibility).toBeNull();

        await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'Called back' } });
        expect(await raw.fieldOf(ref.fileId, 'partner', partnerId, 'desk.credibility')).toEqual(typed);
        expect(snapshotOf(await store.read(ref)).issues.length).toBe(read.issues.length);

        await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { desk: { credibility: 2 } } });
        const after = snapshotOf(await store.read(ref));
        expect(after.value.partners.find((p) => p.id === partnerId)?.desk.credibility).toBe(2);
        expect(after.issues).toEqual([]);
      });

      it('refuses a MAP health save to a partner type row it can’t read, and leaves the file untouched', async (ctx) => {
        const { store, ref, raw, otherPartnerId } = await edited(ctx);
        await raw.breakRow(ref.fileId, 'partner', otherPartnerId);
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, { kind: 'setMapSummary', partnerId: otherPartnerId, health: 'off_track', nextMilestone: '2026-12-01' }, stamp))
          .toMatchObject({ ok: false, error: 'not_found' });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });

      it('writes a MAP health without touching a value it can’t read, nor a column the person added', async (ctx) => {
        const { store, ref, raw, partnerId } = await edited(ctx);
        await raw.breakField(ref.fileId, 'partner', partnerId, 'desk.credibility');
        await raw.addUserNotes(ref.fileId, 'partner', 'My notes', { [partnerId]: 'keep me' }, 'Call Omega back in May');
        const typed = await raw.fieldOf(ref.fileId, 'partner', partnerId, 'desk.credibility');
        const issues = snapshotOf(await store.read(ref)).issues;
        await apply(store, ref, { kind: 'setMapSummary', partnerId, health: 'at_risk', nextMilestone: '2026-11-20' });
        expect(await raw.fieldOf(ref.fileId, 'partner', partnerId, 'desk.credibility')).toEqual(typed);
        expect((await raw.userNotes(ref.fileId, 'partner', 'My notes')).find((n) => n.id === partnerId)?.note).toBe('keep me');
        const after = snapshotOf(await store.read(ref));
        expect(after.issues).toEqual(issues);
        expect(after.value.partners.find((p) => p.id === partnerId)).toMatchObject({ mapHealth: 'at_risk', mapNextMilestone: '2026-11-20' });
      });

      it('keeps a hand edit to one sub-field when the app changes a sibling', async (ctx) => {
        const { store, ref, raw, partnerId, book } = await edited(ctx);
        const callId = book.calls[0]!.id;
        await raw.editSubField(ref.fileId, 'partner', partnerId, 'desk', 'capability', 0);
        await raw.editSubField(ref.fileId, 'call', callId, 'topics', 'costDrivers', 'Typed in the sheet');
        await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { desk: { credibility: 3 } } });
        await apply(store, ref, { kind: 'update', entity: 'call', id: callId, patch: { topics: { revenueModel: 'Licenses only' } } });
        const after = snapshotOf(await store.read(ref));
        expect(after.value.partners.find((p) => p.id === partnerId)?.desk).toMatchObject({ credibility: 3, capability: 0 });
        expect(after.value.calls.find((k) => k.id === callId)?.topics).toMatchObject({ revenueModel: 'Licenses only', costDrivers: 'Typed in the sheet' });
        expect(after.issues).toEqual([]);
      });

      it('gives a row typed without an id a real id on the next apply', async (ctx) => {
        const { store, ref, raw, partnerId, accountId } = await edited(ctx);
        await raw.typeRowWithoutId(ref.fileId, 'person', { accountId, name: 'Typed Person' });
        expect(snapshotOf(await store.read(ref)).value.people.find((e) => e.name === 'Typed Person')?.id).toEqual(expect.any(String));
        await apply(store, ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'Great call' } });
        const after = snapshotOf(await store.read(ref));
        expect(after.value.people.find((e) => e.name === 'Typed Person')?.id).toMatch(/^e_[0-9a-z]{6}$/);
        expect(after.issues).toEqual([]);
      });

      it('keeps both rows of a copy-pasted row and gives the copy a new id', async (ctx) => {
        const { store, ref, raw, book } = await edited(ctx);
        const original = book.people[0]!;
        await raw.copyRow(ref.fileId, 'person', original.id);
        expect(snapshotOf(await store.read(ref)).value.people.filter((e) => e.name === original.name)).toHaveLength(2);
        await apply(store, ref, { kind: 'update', entity: 'partner', id: book.partners[0]!.id, patch: { whyItFits: 'Again' } });
        const after = snapshotOf(await store.read(ref));
        const copies = after.value.people.filter((e) => e.name === original.name);
        expect(copies).toHaveLength(2);
        expect(copies[0]!.id).toBe(original.id);
        expect(copies[1]!.id).toMatch(/^e_[0-9a-z]{6}$/);
        expect(copies[1]!.id).not.toBe(original.id);
        expect(after.issues).toEqual([]);
      });

      it('an existing version 4 file upgrades on its next save, keeping the person’s own columns and tabs', async (ctx) => {
        const { store, ref, raw, book, accountId, partnerId } = await edited(ctx);
        // The file as a version 4 build left it: no Proposals tab, and version 4 in _meta. The person added a column of
        // their own to the Partners tab and a tab of their own.
        const { tab } = await raw.removeTab(ref.fileId, 'proposalItem');
        await raw.setSchemaVersion(ref.fileId, 4);
        await raw.addUserNotes(ref.fileId, 'partner', 'My notes', { [partnerId]: 'keep me' }, 'Call Omega back in May');
        await raw.addTab(ref.fileId, 'My ideas', [['Idea', 'When'], ['Ask Alpha about training', '2026-11-10'], ['', ''], ['=1+1', 42]]);
        const notes = await raw.userNotes(ref.fileId, 'partner', 'My notes');
        const ideas = await raw.tabRows(ref.fileId, 'My ideas');
        const unread = await raw.dump(ref.fileId);
        const read = snapshotOf(await store.read(ref));
        expect(read.value).toEqual({ ...book, proposalItems: [] });
        expect(read.issues).toEqual([]);
        // Reading writes nothing: no Proposals tab, no version 5, not a cell.
        expect(await raw.tabRows(ref.fileId, tab)).toBeNull();
        expect(await raw.dump(ref.fileId)).toEqual(unread);

        await apply(store, ref, { kind: 'update', entity: 'account', id: accountId, patch: { comments: 'Met at the fair' } });
        expect(await raw.tabRows(ref.fileId, tab)).toEqual([PARTNERS_LAYOUT.columns.proposalItem.map((col) => col.header)]);
        expect((await raw.tabRows(ref.fileId, PARTNERS_LAYOUT.tabs.meta))?.find((row) => row[0] === 'schemaVersion')).toEqual(['schemaVersion', 5]);
        expect(await raw.userNotes(ref.fileId, 'partner', 'My notes')).toEqual(notes);
        expect(await raw.tabRows(ref.fileId, 'My ideas')).toEqual(ideas);
        const after = snapshotOf(await store.read(ref));
        expect(after.value).toEqual({
          ...book, proposalItems: [],
          accounts: book.accounts.map((a) => (a.id === accountId ? { ...a, comments: 'Met at the fair', updatedAt: NOW, updatedBy: 'Ruth' } : a)),
        });
        expect(after.issues).toEqual([]);

        // The first proposal goes into the new tab.
        const added = await apply(store, ref, { kind: 'add', entity: 'proposalItem', values: CASES(partnerId, accountId).proposalItem.add });
        expect(await raw.rowIds(ref.fileId, 'proposalItem')).toEqual([added.entityId]);
        expect(await raw.tabRows(ref.fileId, 'My ideas')).toEqual(ideas);
      });

      it('names a tab of the person’s own that has the name of a tab the upgrade adds in other letters, and writes nothing', async (ctx) => {
        // Google takes two tab names that differ only in letter case as one name (fake Google does too): the upgrade
        // can't add its Proposals tab next to the person's "proposals", so the save says which tab to rename.
        const { store, ref, raw, accountId } = await edited(ctx);
        const { tab } = await raw.removeTab(ref.fileId, 'proposalItem');
        await raw.setSchemaVersion(ref.fileId, 4);
        const theirs = tab.toLowerCase();
        await raw.addTab(ref.fileId, theirs, [['What', 'Who'], ['Ask about training', 'Eva']]);
        expect(snapshotOf(await store.read(ref)).issues).toEqual([]);
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, { kind: 'update', entity: 'account', id: accountId, patch: { comments: 'Met at the fair' } }, stamp))
          .toEqual({ ok: false, error: 'structure', tab: theirs, message: SHEET_COPY.ISSUES.TAB_NAME_TAKEN(theirs, tab) });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });

      it('reports a missing tab as a structure error naming it, and an apply writes nothing', async (ctx) => {
        const { store, ref, raw, partnerId } = await edited(ctx);
        const { tab } = await raw.removeTab(ref.fileId, 'person');
        expect(await store.read(ref)).toMatchObject({ ok: false, error: 'structure', tab });
        const before = await raw.dump(ref.fileId);
        expect(await store.apply(ref, { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: 'x' } }, stamp))
          .toMatchObject({ ok: false, error: 'structure', tab });
        expect(await store.apply(ref, { kind: 'add', entity: 'call', values: { partnerId, date: '2026-10-20', kind: 'discovery' } }, stamp))
          .toMatchObject({ ok: false, error: 'structure', tab });
        expect(await raw.dump(ref.fileId)).toEqual(before);
      });
    });

    it('trashes a file without throwing, even one already trashed or one that never existed', async () => {
      const { store, ref } = await seeded();
      await expect(store.trash(ref)).resolves.toBeUndefined();
      await expect(store.trash(ref)).resolves.toBeUndefined();
      await expect(store.trash({ fileId: 'does-not-exist' })).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    it('discards a file without throwing, even one already discarded or one that never existed', async () => {
      const { store, ref } = await seeded();
      await expect(store.discard(ref)).resolves.toBeUndefined();
      await expect(store.discard(ref)).resolves.toBeUndefined();
      await expect(store.discard({ fileId: 'does-not-exist' })).resolves.toBeUndefined();
      expect(await store.read(ref)).toMatchObject({ ok: false, error: 'file_not_found' });
    });

    it('reports unknown files', async () => {
      const { store } = make();
      expect(await store.read({ fileId: 'does-not-exist' })).toMatchObject({ ok: false, error: 'file_not_found' });
      expect(await store.apply({ fileId: 'does-not-exist' }, { kind: 'reopen', partnerId: 'p_missing' }, stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    });
  });
}

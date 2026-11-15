// The write path (apply, applyMany, growing a tab, concurrent saves), on the Partners and market workbooks.
import { describe, expect, it } from 'vitest';
import { deleteSectionChanges, MAX_BATCH, parsePartnerChanges, type MarketChange, type PartnerChange } from '@partner-desk/core';
import { NOW, sampleMarket } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { encodePartnerBook } from '../sheet-codec/encode';
import type { Cell } from '../sheet-codec/grid';
import { MARKET_LAYOUT, PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { asMarketVersion1, asPartnersVersion2, asPartnersVersion3, PARTNERS_META, richBook } from '../sheet-codec/test-fixtures';
import { MemoryFileLock, serializeApplies } from '../serialize';
import type { MarketStore } from '../types';
import { FakeGoogle, fakeClient } from './fake-google';
import { MemoryFolderStore } from './folders';
import { createGoogleMarketStore } from './market-store';
import { createSheetMetaCache, type SheetMetaCache } from './meta-cache';
import { createGooglePartnerBookStore } from './partner-book-store';

const owner = { userId: 'u_1', displayName: 'Anna Keller' };
const stamp = { now: NOW, actor: 'Ruth' };
const T = PARTNERS_LAYOUT.tabs;
const X = MARKET_LAYOUT.tabs.exclusion;
const col = (key: string) => PARTNERS_LAYOUT.columns.partner.findIndex((c) => c.key === key);
type ValuesBody = { valueInputOption: string; data: Array<{ range: string; values: Cell[][] }> };

function setup(options: { metaCache?: SheetMetaCache } = {}) {
  const fake = new FakeGoogle();
  const opts = { client: fakeClient(fake), folders: new MemoryFolderStore(), ...options };
  return { fake, books: createGooglePartnerBookStore(opts), markets: createGoogleMarketStore(opts) };
}

/** A Partners file holding richBook(): p_1 to p_4 in sheet rows 2 to 5. */
async function seeded(options: { metaCache?: SheetMetaCache } = {}) {
  const env = setup(options);
  const { fileId } = await env.books.create(owner, 'co_abcdefghij');
  env.fake.setWorkbook(fileId, encodePartnerBook(richBook(), PARTNERS_META));
  return { ...env, fileId };
}

/** A market file holding sampleMarket(): one exclusion, Omega GmbH. */
async function marketFile() {
  const env = setup();
  const { fileId } = await env.markets.create(owner, sampleMarket());
  return { ...env, fileId };
}

const isIdCheck = (call: { url: URL }) =>
  call.url.pathname.endsWith('/values:batchGet') && call.url.searchParams.getAll('ranges').every((r) => r.includes('!'));
const isWholeRead = (call: { url: URL }) =>
  call.url.pathname.endsWith('/values:batchGet') && call.url.searchParams.getAll('ranges').some((r) => !r.includes('!'));
const sheetWrites = (fake: FakeGoogle) => fake.calls.filter((c) => c.method === 'POST' && c.url.pathname.includes('/v4/'));
const partnerRow = (id: string, company: string) => {
  const row: Cell[] = PARTNERS_LAYOUT.columns.partner.map(() => '');
  row[0] = id;
  row[1] = company;
  return row;
};
const exclusionRow = (company: string): Cell[] => ['', company, '', 'Typed by hand', '', ''];

/** Someone inserting a row at the top of Partners by hand. */
const insertRowAtTop = (fake: FakeGoogle, fileId: string) => {
  const wb = fake.getWorkbook(fileId);
  wb[T.partner]!.splice(1, 0, partnerRow('p_byhand', 'Inserted by hand'));
  fake.setWorkbook(fileId, wb);
};

/** Runs `edit` once, on the first request after the apply's whole-tab read. */
const editAfterLoad = (fake: FakeGoogle, edit: () => void) => {
  let loaded = false;
  let edited = false;
  fake.beforeRequest = (call) => {
    if (loaded && !edited) {
      edited = true;
      edit();
    }
    if (isWholeRead(call)) loaded = true;
  };
};

const companies = (fake: FakeGoogle, fileId: string) => fake.getWorkbook(fileId)[X]!.slice(1).map((row) => row[1]);

describe('Google stores: apply', () => {
  it('reads the file afresh before every apply', async () => {
    const { fake, books, fileId } = await seeded();
    await books.read({ fileId });
    fake.calls.length = 0;
    await books.apply({ fileId }, { kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' }, stamp);
    await books.apply({ fileId }, { kind: 'setStep', partnerId: 'p_1', to: 'qualification' }, stamp);
    expect(fake.calls.filter(isWholeRead)).toHaveLength(2);
  });

  it('writes only the changed row’s cells, as RAW, and returns the fresh snapshot', async () => {
    const { fake, books, fileId } = await seeded();
    fake.calls.length = 0;
    const result = await books.apply({ fileId }, { kind: 'setStep', partnerId: 'p_1', to: 'discovery_call' }, stamp);
    if (!result.ok) throw new Error(result.message);
    const [valueWrite] = sheetWrites(fake);
    const body = valueWrite!.body as ValuesBody;
    expect(body.valueInputOption).toBe('RAW');
    // Step (E), Updated (AB) and Updated by (AC) change; the cells between are left alone (null).
    const values: Cell[] = Array.from({ length: col('updatedBy') - col('step') + 1 }, () => null);
    values[0] = 'Discovery call';
    values[col('updatedAt') - col('step')] = NOW;
    values[col('updatedBy') - col('step')] = 'Ruth';
    expect(body.data).toEqual([{ range: "'Partners'!E2:AC2", values: [values] }]);
    expect(result.snapshot.value.partners.find((p) => p.id === 'p_1')).toMatchObject({ step: 'discovery_call', updatedAt: NOW });
    expect(await books.read({ fileId })).toEqual({ ok: true, snapshot: result.snapshot });
  });

  it('re-reads and writes to the right row when rows moved since the read', async () => {
    const { fake, books, fileId } = await seeded();
    let moved = false;
    fake.beforeRequest = (call) => {
      if (!moved && isIdCheck(call)) {
        moved = true;
        insertRowAtTop(fake, fileId);
      }
    };
    const result = await books.apply({ fileId }, { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Moved but found' } }, stamp);
    expect(result.ok).toBe(true);
    const rows = fake.getWorkbook(fileId)[T.partner]!;
    expect(rows.find((r) => r[0] === 'p_1')?.[col('whyItFits')]).toBe('Moved but found');
    expect(rows.find((r) => r[0] === 'p_byhand')).toEqual(partnerRow('p_byhand', 'Inserted by hand'));
  });

  it('returns a conflict and writes nothing when the sheet keeps changing', async () => {
    const { fake, books, fileId } = await seeded();
    fake.calls.length = 0;
    fake.beforeRequest = (call) => {
      if (isIdCheck(call)) insertRowAtTop(fake, fileId);
    };
    const result = await books.apply({ fileId }, { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Never lands' } }, stamp);
    expect(result).toMatchObject({ ok: false, error: 'conflict', message: 'Someone was editing this file while you saved' });
    expect(sheetWrites(fake)).toEqual([]);
  });

  it('deletes a hand-typed row that had no ID yet', async () => {
    const { fake, markets, fileId } = await marketFile();
    const wb = fake.getWorkbook(fileId);
    wb[X]!.push(exclusionRow('Typed GmbH'));
    fake.setWorkbook(fileId, wb);
    const read = await markets.read({ fileId });
    if (!read.ok) throw new Error(read.message);
    const typed = read.snapshot.value.exclusions.find((x) => x.company === 'Typed GmbH')!;
    expect((await markets.apply({ fileId }, { kind: 'delete', entity: 'exclusion', id: typed.id }, stamp)).ok).toBe(true);
    expect(companies(fake, fileId)).toEqual(['Omega GmbH']);
  });

  it('appends after the last row with content and deletes a row last', async () => {
    const { fake, books, fileId } = await seeded();
    const added = await books.apply({ fileId }, { kind: 'add', entity: 'partner', values: { accountId: 'a_4', partnerType: 'var' } }, stamp);
    if (!added.ok) throw new Error(added.message);
    expect(fake.getWorkbook(fileId)[T.partner]![5]?.slice(0, 2)).toEqual([added.entityId, 'a_4']);
    fake.calls.length = 0;
    expect((await books.apply({ fileId }, { kind: 'delete', entity: 'partner', id: 'p_4' }, stamp)).ok).toBe(true);
    const posts = sheetWrites(fake);
    expect(Object.keys((posts.at(-1)!.body as { requests: Array<Record<string, unknown>> }).requests[0]!)).toEqual(['deleteDimension']);
    expect(fake.getWorkbook(fileId)[T.partner]!.map((r) => r[0])).toEqual(['ID', 'p_1', 'p_2', 'p_3', added.entityId]);
  });

  it('re-checks the delete row right before deleting, and never deletes a neighbor', async () => {
    const { fake, books, fileId } = await seeded();
    let checked = false;
    let moved = false;
    fake.beforeRequest = (call) => {
      if (checked && !moved) {
        moved = true;
        insertRowAtTop(fake, fileId);
      }
      if (isIdCheck(call)) checked = true;
    };
    expect((await books.apply({ fileId }, { kind: 'delete', entity: 'partner', id: 'p_4' }, stamp)).ok).toBe(true);
    expect(moved).toBe(true);
    expect(fake.getWorkbook(fileId)[T.partner]!.map((r) => r[0])).toEqual(['ID', 'p_byhand', 'p_1', 'p_2', 'p_3']);
  });

  it('deletes a company’s last partner type, its people and the company in one row delete request', async () => {
    const { fake, books, fileId } = await seeded();
    fake.calls.length = 0;
    const result = await books.applyMany({ fileId }, deleteSectionChanges(richBook(), 'p_2'), stamp);
    if (!result.ok) throw new Error(result.message);
    const posts = sheetWrites(fake);
    expect(posts).toHaveLength(1);
    const requests = (posts[0]!.body as { requests: Array<{ deleteDimension?: { range: { startIndex: number } } }> }).requests;
    expect(requests.map((r) => r.deleteDimension?.range.startIndex)).toEqual([2, 2, 2]);
    const ids = (tab: string) => fake.getWorkbook(fileId)[tab]!.map((r) => r[0]);
    expect(ids(T.account)).toEqual(['ID', 'a_1', 'a_4']);
    expect(ids(T.partner)).toEqual(['ID', 'p_1', 'p_3', 'p_4']);
    expect(ids(T.person)).toEqual(['ID', 'e_1']);
    expect(result.snapshot.value.accounts.map((a) => a.id)).toEqual(['a_1', 'a_4']);
    expect(await books.read({ fileId })).toEqual({ ok: true, snapshot: result.snapshot });
  });

  it('re-checks every row of a batch right before deleting, and never deletes a neighbor', async () => {
    const { fake, books, fileId } = await seeded();
    let checked = false;
    let moved = false;
    fake.beforeRequest = (call) => {
      if (checked && !moved) {
        moved = true;
        const wb = fake.getWorkbook(fileId);
        // A contact of another company (Acme), typed at the top: every row below moves down one.
        wb[T.person]!.splice(1, 0, ['e_byhand', 'a_1', 'Typed by hand', '', '', 'Contact', '', '', '']);
        fake.setWorkbook(fileId, wb);
      }
      if (isIdCheck(call)) checked = true;
    };
    expect((await books.applyMany({ fileId }, deleteSectionChanges(richBook(), 'p_2'), stamp)).ok).toBe(true);
    expect(moved).toBe(true);
    const ids = (tab: string) => fake.getWorkbook(fileId)[tab]!.map((r) => r[0]);
    expect(ids(T.person)).toEqual(['ID', 'e_byhand', 'e_1']);
    expect(ids(T.partner)).toEqual(['ID', 'p_1', 'p_3', 'p_4']);
    expect(ids(T.account)).toEqual(['ID', 'a_1', 'a_4']);
  });

  it('deletes nothing when a contact of the company is typed in while it is being removed', async () => {
    const { fake, books, fileId } = await seeded();
    let checked = false;
    let typed = false;
    fake.beforeRequest = (call) => {
      if (checked && !typed) {
        typed = true;
        const wb = fake.getWorkbook(fileId);
        wb[T.person]!.splice(1, 0, ['e_byhand', 'a_2', 'Typed by hand', '', '', 'Contact', '', '', '']);
        fake.setWorkbook(fileId, wb);
      }
      if (isIdCheck(call)) checked = true;
    };
    const result = await books.applyMany({ fileId }, deleteSectionChanges(richBook(), 'p_2'), stamp);
    expect(typed).toBe(true);
    // The second plan sees Beta's new contact: the company can't go while a contact names it, so nothing is deleted.
    expect(result).toMatchObject({ ok: false, error: 'invalid', message: COPY.PARTNER_HAS_CONTACTS });
    const ids = (tab: string) => fake.getWorkbook(fileId)[tab]!.map((r) => r[0]);
    expect(ids(T.person)).toEqual(['ID', 'e_byhand', 'e_1', 'e_2']);
    expect(ids(T.partner)).toEqual(['ID', 'p_1', 'p_2', 'p_3', 'p_4']);
    expect(ids(T.account)).toEqual(['ID', 'a_1', 'a_2', 'a_4']);
  });

  it('never plans a mixed batch again once its cells are written: a row moved before the delete is a conflict', async () => {
    const { fake, books, fileId } = await seeded();
    let idChecks = 0;
    fake.beforeRequest = (call) => {
      if (!isIdCheck(call)) return;
      idChecks += 1;
      // The second check is the one just before the delete, after the new person's row was written.
      if (idChecks === 2) {
        const wb = fake.getWorkbook(fileId);
        wb[T.person]!.splice(1, 0, ['e_byhand', 'a_2', 'Typed by hand', '', '', 'Contact', '', '', '']);
        fake.setWorkbook(fileId, wb);
      }
    };
    const result = await books.applyMany({ fileId }, [
      { kind: 'add', entity: 'person', values: { id: 'e_new', accountId: 'a_1', name: 'Nora Neu' } },
      { kind: 'delete', entity: 'person', id: 'e_1' },
    ], stamp);
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
    const names = fake.getWorkbook(fileId)[T.person]!.slice(1).map((r) => r[2]);
    expect(names.filter((name) => name === 'Nora Neu')).toHaveLength(1);
    expect(fake.getWorkbook(fileId)[T.person]!.map((r) => r[0])).toContain('e_1');
  });

  it('refuses to delete a company while a partner type row it can’t read still names it, and changes nothing', async () => {
    const { fake, books, fileId } = await seeded();
    const wb = fake.getWorkbook(fileId);
    // p_3, Acme's second partner type: an unreadable Closed cell leaves the row out.
    const p3 = wb[T.partner]!.findIndex((r) => r[0] === 'p_3');
    wb[T.partner]![p3]![col('closed')] = 'Maybe';
    fake.setWorkbook(fileId, wb);
    const before = fake.getWorkbook(fileId);
    const read = await books.read({ fileId });
    if (!read.ok) throw new Error(read.message);
    expect(read.snapshot.value.partners.map((p) => p.id)).not.toContain('p_3');
    const changes = deleteSectionChanges(read.snapshot.value, 'p_1');
    expect(changes.map((c) => ('entity' in c ? c.entity : c.kind))).toEqual(['partner', 'person', 'account']);
    const result = await books.applyMany({ fileId }, changes, stamp);
    expect(result).toMatchObject({ ok: false, error: 'invalid', message: expect.stringContaining(`Row ${p3 + 1} on the "${T.partner}" tab`) });
    const after = fake.getWorkbook(fileId);
    for (const tab of [T.account, T.person, T.partner]) expect(after[tab]).toEqual(before[tab]);
  });

  it('leaves a partner type whose company id was changed by hand out of every save, and counts it', async () => {
    const { fake, books, fileId } = await seeded();
    const wb = fake.getWorkbook(fileId);
    wb[T.partner]![2]![col('accountId')] = 'a_typo01';
    fake.setWorkbook(fileId, wb);
    const handRow = wb[T.partner]![2]!.slice();
    const read = await books.read({ fileId });
    if (!read.ok) throw new Error(read.message);
    expect(read.snapshot.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_3', 'p_4']);
    expect(read.snapshot.issues).toEqual([{ tab: T.partner, row: 3, message: expect.stringContaining('Partner account') }]);
    for (const change of [
      { kind: 'update', entity: 'account', id: 'a_2', patch: { comments: 'Typed elsewhere' } },
      { kind: 'add', entity: 'partner', values: { accountId: 'a_2', partnerType: 'distributor' } },
      { kind: 'delete', entity: 'partner', id: 'p_1' },
    ] satisfies PartnerChange[]) {
      const result = await books.apply({ fileId }, change, stamp);
      if (!result.ok) throw new Error(result.message);
      expect(fake.getWorkbook(fileId)[T.partner]!.find((r) => r[0] === 'p_2')).toEqual(handRow);
      expect(result.snapshot.issues).toHaveLength(1);
    }
  });

  it('never overwrites a row typed at the bottom of a tab between the read and the append', async () => {
    const { fake, markets, fileId } = await marketFile();
    editAfterLoad(fake, () => {
      const wb = fake.getWorkbook(fileId);
      wb[X]!.push(exclusionRow('Typed at the bottom'));
      fake.setWorkbook(fileId, wb);
    });
    expect((await markets.apply({ fileId }, { kind: 'add', entity: 'exclusion', values: { company: 'Psi AG' } }, stamp)).ok).toBe(true);
    expect(companies(fake, fileId)).toEqual(['Omega GmbH', 'Typed at the bottom', 'Psi AG']);
  });

  it('never deletes another ID-less row that was sorted into the target’s place', async () => {
    const { fake, markets, fileId } = await marketFile();
    const wb = fake.getWorkbook(fileId);
    wb[X]!.push(exclusionRow('Typed first'), exclusionRow('Typed second'));
    fake.setWorkbook(fileId, wb);
    const read = await markets.read({ fileId });
    if (!read.ok) throw new Error(read.message);
    const second = read.snapshot.value.exclusions.find((x) => x.company === 'Typed second')!;
    editAfterLoad(fake, () => {
      const sorted = fake.getWorkbook(fileId);
      const rows = sorted[X]!;
      [rows[rows.length - 2], rows[rows.length - 1]] = [rows[rows.length - 1]!, rows[rows.length - 2]!];
      fake.setWorkbook(fileId, sorted);
    });
    // Its id is row-number based, so after a re-read it would name "Typed first": a conflict, deleting nothing.
    expect(await markets.apply({ fileId }, { kind: 'delete', entity: 'exclusion', id: second.id }, stamp)).toMatchObject({ ok: false, error: 'conflict' });
    expect(companies(fake, fileId)).toEqual(['Omega GmbH', 'Typed second', 'Typed first']);
  });

  it('re-reads when an ID-less row it gives an ID to was edited meanwhile, and IDs the right row', async () => {
    const { fake, markets, fileId } = await marketFile();
    const wb = fake.getWorkbook(fileId);
    wb[X]!.push(exclusionRow('Typed first'), exclusionRow('Typed second'));
    fake.setWorkbook(fileId, wb);
    editAfterLoad(fake, () => {
      const sorted = fake.getWorkbook(fileId);
      const rows = sorted[X]!;
      [rows[rows.length - 2], rows[rows.length - 1]] = [rows[rows.length - 1]!, rows[rows.length - 2]!];
      fake.setWorkbook(fileId, sorted);
    });
    let n = 0;
    const result = await markets.apply({ fileId }, { kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { name: 'Still lands' } },
      { ...stamp, newId: (entity) => `${entity}_new${++n}` });
    expect(result.ok).toBe(true);
    // The first plan (new1, new2) is dropped; the re-read sees "Typed second" first and gives it new3.
    const rows = fake.getWorkbook(fileId)[X]!;
    expect(rows.find((row) => row[1] === 'Typed second')?.[0]).toBe('exclusion_new3');
    expect(rows.find((row) => row[1] === 'Typed first')?.[0]).toBe('exclusion_new4');
    expect(fake.getWorkbook(fileId)[MARKET_LAYOUT.tabs.hypothesis]!.find((row) => row[0] === 'h_1')?.[1]).toBe('Still lands');
  });

  it('maps an auth failure during a save to auth', async () => {
    const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock: () => 0 });
    const { fake, books, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    fake.failNext(401, 2);
    expect(await books.apply({ fileId }, { kind: 'reopen', partnerId: 'p_3' }, stamp)).toMatchObject({ ok: false, error: 'auth' });
  });

  it('reports a missing tab as a structure error naming it, writing nothing', async () => {
    const { fake, books, fileId } = await seeded();
    const wb = fake.getWorkbook(fileId);
    delete wb[T.call];
    fake.setWorkbook(fileId, wb);
    fake.calls.length = 0;
    expect(await books.apply({ fileId }, { kind: 'reopen', partnerId: 'p_3' }, stamp)).toEqual({
      ok: false, error: 'structure', tab: 'Calls', message: 'The "Calls" tab is missing',
    });
    expect(sheetWrites(fake)).toEqual([]);
  });
});

describe('Google stores: applyMany', () => {
  const imported = (n: number): PartnerChange[] => Array.from({ length: n }, (_, i): PartnerChange[] => [
    { kind: 'add', entity: 'account', values: { id: `tmp_a${i}`, company: `Company ${i}` } },
    { kind: 'add', entity: 'partner', values: { id: `tmp_${i}`, accountId: `tmp_a${i}`, partnerType: 'reseller', source: 'ai_search' } },
    { kind: 'add', entity: 'qualification', values: { partnerId: `tmp_${i}`, deskNotes: { customerBase: `Evidence ${i}` } } },
  ]).flat();

  it('imports 25 companies with one read, one row check and one values write', async () => {
    const { fake, books, fileId } = await seeded();
    fake.calls.length = 0;
    const result = await books.applyMany({ fileId }, imported(25), stamp);
    if (!result.ok) throw new Error(result.message);
    const reads = fake.calls.filter((c) => c.url.pathname.endsWith('/values:batchGet'));
    const posts = fake.calls.filter((c) => c.method === 'POST');
    // The layout and the trash check, the tabs, then the row check.
    expect(fake.calls.filter((c) => c.method === 'GET')).toHaveLength(4);
    expect(reads.map(isWholeRead)).toEqual([true, false]);
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.pathname).toMatch(/\/values:batchUpdate$/);
    expect((posts[0]!.body as ValuesBody).data).toHaveLength(75);
    const after = await books.read({ fileId });
    if (!after.ok) throw new Error(after.message);
    const { accounts, partners } = after.snapshot.value;
    expect(partners).toHaveLength(4 + 25);
    for (const q of after.snapshot.value.qualifications.slice(-25)) {
      const accountId = partners.find((p) => p.id === q.partnerId)?.accountId;
      expect(accounts.find((a) => a.id === accountId)?.company).toBe(`Company ${q.deskNotes.customerBase.split(' ')[1]}`);
    }
  });
});

describe('Google stores: a full import', () => {
  /** What the market page sends for one AI import: per company the account, the partner, its market link and its desk notes. */
  const fullImport = (n: number): PartnerChange[] => Array.from({ length: n }, (_, i): PartnerChange[] => [
    { kind: 'add', entity: 'account', values: { id: `tmp_a${i}`, company: `Company ${i}` } },
    { kind: 'add', entity: 'partner', values: { id: `tmp_${i}`, accountId: `tmp_a${i}`, partnerType: 'reseller', source: 'ai_search' } },
    { kind: 'add', entity: 'marketLink', values: { partnerId: `tmp_${i}`, marketId: 'm_abcdefghij', hypothesisId: i % 2 ? 'h_1' : null } },
    { kind: 'add', entity: 'qualification', values: { partnerId: `tmp_${i}`, deskNotes: { customerBase: `Evidence ${i}` } } },
  ]).flat();

  it('writes MAX_BATCH changes on four tabs in one values write, and reads them back', async () => {
    const { fake, books, fileId } = await seeded();
    const changes = fullImport(MAX_BATCH / 4);
    expect(changes).toHaveLength(MAX_BATCH);
    expect(parsePartnerChanges(changes).ok).toBe(true);
    fake.calls.length = 0;
    const result = await books.applyMany({ fileId }, changes, stamp);
    if (!result.ok) throw new Error(result.message);
    const posts = fake.calls.filter((c) => c.method === 'POST');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.url.pathname).toMatch(/\/values:batchUpdate$/);
    const ranges = (posts[0]!.body as ValuesBody).data.map((d) => d.range.split('!')[0]!.replace(/'/g, ''));
    expect(new Set(ranges)).toEqual(new Set([T.account, T.partner, T.marketLink, T.qualification]));
    expect(ranges).toHaveLength(MAX_BATCH);

    const after = await books.read({ fileId });
    if (!after.ok) throw new Error(after.message);
    const { accounts, partners, marketLinks, qualifications } = after.snapshot.value;
    const added = partners.slice(-MAX_BATCH / 4);
    expect(added.map((p) => accounts.find((a) => a.id === p.accountId)?.company)).toEqual(Array.from({ length: MAX_BATCH / 4 }, (_, i) => `Company ${i}`));
    for (const [i, partner] of added.entries()) {
      expect(marketLinks.filter((l) => l.partnerId === partner.id)).toEqual([
        expect.objectContaining({ marketId: 'm_abcdefghij', hypothesisId: i % 2 ? 'h_1' : null }),
      ]);
      expect(qualifications.find((q) => q.partnerId === partner.id)?.deskNotes.customerBase).toBe(`Evidence ${i}`);
    }
    expect(after.snapshot.issues).toEqual([]);
  });
});

describe('Google stores: tabs past 1000 rows', () => {
  type Validation = { range: { sheetId: number; startRowIndex: number; endRowIndex: number; startColumnIndex: number } };

  /** A Partners file whose Partners tab holds 999 partners: its 1000 rows are full. */
  async function fullPartners(options: { metaCache?: SheetMetaCache } = {}) {
    const env = await seeded(options);
    const wb = env.fake.getWorkbook(env.fileId);
    const template = wb[T.partner]![1]!;
    wb[T.partner] = [wb[T.partner]![0]!, ...Array.from({ length: 999 }, (_, i) => {
      const row = template.slice();
      row[0] = `p_f${String(i).padStart(4, '0')}`;
      return row;
    })];
    env.fake.setWorkbook(env.fileId, wb);
    expect(env.fake.spreadsheet(env.fileId)!.sheets.find((t) => t.title === T.partner)!.rowCount).toBe(1000);
    return env;
  }
  const add = (partnerType: string): PartnerChange => ({ kind: 'add', entity: 'partner', values: { accountId: 'a_2', partnerType } });

  it('grows a full tab before writing past row 1000, and gives the new rows their dropdowns', async () => {
    const { fake, books, fileId } = await fullPartners();
    fake.calls.length = 0;
    const added = await books.apply({ fileId }, add('reseller'), stamp);
    if (!added.ok) throw new Error(added.message);
    const tab = fake.spreadsheet(fileId)!.sheets.find((t) => t.title === T.partner)!;
    expect(tab.rowCount).toBe(1501);
    expect(tab.grid[1000]![0]).toBe(added.entityId);
    expect((fake.spreadsheet(fileId)!.validations as Validation[]).filter((v) => v.range.sheetId === tab.sheetId && v.range.startColumnIndex === col('stage'))
      .map((v) => [v.range.startRowIndex, v.range.endRowIndex])).toEqual([[1, 1000], [1000, 1501]]);
    // The tab grows in one batchUpdate, before the row checks and the values write.
    const order = fake.calls.filter((c) => c.method === 'POST' || c.url.pathname.endsWith('/values:batchGet')).map((c) => c.url.pathname.split(':').pop());
    expect(order).toEqual(['batchGet', 'batchUpdate', 'batchGet', 'batchUpdate']);
    const after = await books.read({ fileId });
    expect(after.ok && after.snapshot.value.partners.at(-1)?.id).toBe(added.entityId);
  });

  it('writes past row 1000 again once the tab has grown, without growing it again', async () => {
    const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock: () => 0 });
    const { fake, books, fileId } = await fullPartners({ metaCache });
    await books.apply({ fileId }, add('reseller'), stamp);
    fake.calls.length = 0;
    expect((await books.apply({ fileId }, add('distributor'), stamp)).ok).toBe(true);
    expect(fake.calls.filter((c) => c.url.pathname.endsWith(':batchUpdate') && !c.url.pathname.includes('/values'))).toHaveLength(0);
  });

  it('reads the layout again when a cached row count is out of date, and grows the tab', async () => {
    const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock: () => 0 });
    const { fake, books, fileId } = await fullPartners({ metaCache });
    await books.apply({ fileId }, add('reseller'), stamp);
    // Someone deletes the empty rows at the bottom: the cached 1501 rows are now 1001.
    fake.setRowCount(fileId, T.partner, 1001);
    const again = await books.apply({ fileId }, add('distributor'), stamp);
    if (!again.ok) throw new Error(again.message);
    expect(fake.getWorkbook(fileId)[T.partner]![1001]![0]).toBe(again.entityId);
  });
});

describe('Google stores: concurrent applies', () => {
  const addExclusion = (store: MarketStore, fileId: string, company: string) =>
    store.apply({ fileId }, { kind: 'add', entity: 'exclusion', values: { company } } as MarketChange, stamp);

  it('never loses an update when two applies to the same file run at once, serialized', async () => {
    const { fake, markets, fileId } = await marketFile();
    const store = serializeApplies(markets, new MemoryFileLock());
    const results = await Promise.all([addExclusion(store, fileId, 'Psi AG'), addExclusion(store, fileId, 'Rho AG')]);
    expect(results.map((r) => r.ok)).toEqual([true, true]);
    expect(companies(fake, fileId)).toEqual(['Omega GmbH', 'Psi AG', 'Rho AG']);
  });
});

describe('Google stores: a tab made again by hand', () => {
  it('deletes a row in it, fetching its new id once', async () => {
    const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock: () => 0 });
    const { fake, books, fileId } = await seeded({ metaCache });
    await books.read({ fileId }); // caches the Partners sheetId
    // Partners deleted and made again by hand: same title and rows, a new sheetId.
    const wb = fake.getWorkbook(fileId);
    const partners = wb[T.partner]!;
    delete wb[T.partner];
    fake.setWorkbook(fileId, wb);
    fake.setWorkbook(fileId, { ...wb, [T.partner]: partners });
    const newId = fake.spreadsheet(fileId)!.sheets.find((s) => s.title === T.partner)!.sheetId;
    fake.calls.length = 0;

    expect((await books.apply({ fileId }, { kind: 'delete', entity: 'partner', id: 'p_4' }, stamp)).ok).toBe(true);
    const deletes = fake.calls.filter((c) => c.url.pathname.endsWith(':batchUpdate') && JSON.stringify(c.body).includes('deleteDimension'));
    expect(deletes.map((c) => (c.body as { requests: Array<{ deleteDimension: { range: { sheetId: number } } }> }).requests[0]!.deleteDimension.range.sheetId))
      .toEqual([PARTNERS_LAYOUT.tabOrder.indexOf(T.partner), newId]);
    expect(fake.getWorkbook(fileId)[T.partner]!.map((row) => row[0])).toEqual(['ID', 'p_1', 'p_2', 'p_3']);
  });
});

describe('Google stores: an older file is upgraded on its next save', () => {
  const tabsBut = (wb: Record<string, Cell[][]>, ...skip: string[]) => Object.fromEntries(Object.entries(wb).filter(([tab]) => !skip.includes(tab)));

  it('reads a version 2 Partners file with no program links; one ordinary save adds the columns and the version, and keeps everything else', async () => {
    const { fake, books, fileId } = await seeded();
    const v2 = asPartnersVersion2(encodePartnerBook(richBook(), PARTNERS_META));
    const width = v2[T.partner]![0]!.length;
    v2[T.partner]![0]![width] = 'My notes';
    v2[T.partner]![1]![width] = 'keep me';
    fake.setWorkbook(fileId, v2);
    // The tab as Google made it for a version 2 file: 26 columns, all of them in use now.
    fake.spreadsheet(fileId)!.sheets.find((s) => s.title === T.partner)!.columnCount = 26;
    expect(width + 1).toBe(26);

    fake.calls.length = 0;
    const read = await books.read({ fileId });
    expect(read.ok && read.snapshot.issues).toEqual([]);
    expect(read.ok && read.snapshot.value.partners.map((p) => [p.id, p.programId, p.level, p.mapHealth])).toEqual([
      ['p_1', null, null, null], ['p_2', null, null, null], ['p_3', null, null, null], ['p_4', null, null, null],
    ]);
    expect(fake.calls.filter((c) => c.method !== 'GET')).toEqual([]);

    const before = fake.getWorkbook(fileId);
    const saved = await books.apply({ fileId }, { kind: 'update', entity: 'partner', id: 'p_3', patch: { whyItFits: 'Strong' } }, stamp);
    expect(saved.ok).toBe(true);
    const after = fake.getWorkbook(fileId);
    expect(after['_meta']).toEqual(before['_meta']!.map((row) => (row[0] === 'schemaVersion' ? ['schemaVersion', 5] : row)));
    expect(after[T.partner]![0]).toEqual([...before[T.partner]![0]!, 'Program', 'Level', 'MAP health', 'Next milestone']);
    // Every other row and tab as it was, the person's own column included; p_3 changed only where the save says.
    expect(tabsBut(after, T.partner, '_meta', T.proposalItem)).toEqual(tabsBut(before, T.partner, '_meta'));
    expect(after[T.proposalItem]).toEqual([PARTNERS_LAYOUT.columns.proposalItem.map((c) => c.header)]);
    expect(after[T.partner]!.filter((_, i) => i !== 0 && i !== 3)).toEqual(before[T.partner]!.filter((_, i) => i !== 0 && i !== 3));
    const changed = after[T.partner]![3]!.flatMap((cell, i) => (cell === before[T.partner]![3]![i] ? [] : [before[T.partner]![0]![i]]));
    expect(changed).toEqual(['Why it fits', 'Updated', 'Updated by']);
    expect(after[T.partner]![1]![width]).toBe('keep me');

    const reread = await books.read({ fileId });
    expect(reread.ok && reread.snapshot.issues).toEqual([]);
    const placed = await books.apply({ fileId }, { kind: 'update', entity: 'partner', id: 'p_2', patch: { programId: 'pg_dach0001', level: 'pref' } }, stamp);
    expect(placed.ok && placed.snapshot.value.partners.find((p) => p.id === 'p_2')).toMatchObject({ programId: 'pg_dach0001', level: 'pref' });
    const last = fake.getWorkbook(fileId)[T.partner]!;
    expect(last[2]!.slice(width + 1)).toEqual(['pg_dach0001', 'Preferred']);
    expect(last[0]!.slice(width)).toEqual(['My notes', 'Program', 'Level', 'MAP health', 'Next milestone']);
  });

  it('reads a version 3 Partners file with no MAP fields; the next save writes the two columns and the version, and keeps everything else', async () => {
    const { fake, books, fileId } = await seeded();
    const v3 = asPartnersVersion3(encodePartnerBook(richBook(), PARTNERS_META));
    const width = v3[T.partner]![0]!.length;
    v3[T.partner]![0]![width] = 'My notes';
    v3[T.partner]![2]![width] = 'keep me';
    fake.setWorkbook(fileId, v3);

    const read = await books.read({ fileId });
    expect(read.ok && read.snapshot.issues).toEqual([]);
    expect(read.ok && read.snapshot.value.partners.map((p) => [p.id, p.mapHealth, p.mapNextMilestone])).toEqual([
      ['p_1', null, null], ['p_2', null, null], ['p_3', null, null], ['p_4', null, null],
    ]);

    const before = fake.getWorkbook(fileId);
    const saved = await books.apply({ fileId }, { kind: 'update', entity: 'partner', id: 'p_2', patch: { mapHealth: 'at_risk', mapNextMilestone: '2026-11-20' } }, stamp);
    expect(saved.ok && saved.snapshot.value.partners.find((p) => p.id === 'p_2')).toMatchObject({ mapHealth: 'at_risk', mapNextMilestone: '2026-11-20' });
    const after = fake.getWorkbook(fileId);
    expect(after['_meta']).toEqual(before['_meta']!.map((row) => (row[0] === 'schemaVersion' ? ['schemaVersion', 5] : row)));
    expect(after[T.partner]![0]).toEqual([...before[T.partner]![0]!, 'MAP health', 'Next milestone']);
    expect(tabsBut(after, T.partner, '_meta', T.proposalItem)).toEqual(tabsBut(before, T.partner, '_meta'));
    expect(after[T.proposalItem]).toEqual([PARTNERS_LAYOUT.columns.proposalItem.map((c) => c.header)]);
    expect(after[T.partner]!.filter((_, i) => i !== 0 && i !== 2)).toEqual(before[T.partner]!.filter((_, i) => i !== 0 && i !== 2));
    const header = after[T.partner]![0]!;
    const changed = after[T.partner]![2]!.flatMap((cell, i) => (cell === before[T.partner]![2]![i] ? [] : [header[i]]));
    expect(changed).toEqual(['Updated', 'Updated by', 'MAP health', 'Next milestone']);
    expect(after[T.partner]![2]!.slice(width)).toEqual(['keep me', 'At risk', '2026-11-20']);
    const reread = await books.read({ fileId });
    expect(reread.ok && reread.snapshot).toEqual(saved.ok && saved.snapshot);
  });

  it('reads a version 1 market as feeding no program; one ordinary save adds the row and the version, and keeps everything else', async () => {
    const { fake, markets, fileId } = await marketFile();
    const v1 = asMarketVersion1(fake.getWorkbook(fileId));
    fake.setWorkbook(fileId, v1);
    const read = await markets.read({ fileId });
    expect(read.ok && read.snapshot.issues).toEqual([]);
    expect(read.ok && read.snapshot.value.info.feedsProgramId).toBeNull();

    const saved = await markets.apply({ fileId }, { kind: 'add', entity: 'exclusion', values: { company: 'Psi AG' } }, stamp);
    expect(saved.ok).toBe(true);
    const after = fake.getWorkbook(fileId);
    expect(after['_meta']).toEqual(v1['_meta']!.map((row) => (row[0] === 'schemaVersion' ? ['schemaVersion', 2] : row)));
    expect(after[MARKET_LAYOUT.tabs.info]).toEqual([...v1[MARKET_LAYOUT.tabs.info]!, ['Feeds program']]);
    expect(tabsBut(after, MARKET_LAYOUT.tabs.info, X, '_meta')).toEqual(tabsBut(v1, MARKET_LAYOUT.tabs.info, X, '_meta'));
    expect(after[X]!.slice(0, v1[X]!.length)).toEqual(v1[X]);

    const fed = await markets.apply({ fileId }, { kind: 'updateInfo', patch: { feedsProgramId: 'pg_dach0001' } }, stamp);
    expect(fed.ok && fed.snapshot.value.info.feedsProgramId).toBe('pg_dach0001');
    expect(fed.ok && fed.snapshot.issues).toEqual([]);
    expect(fake.getWorkbook(fileId)[MARKET_LAYOUT.tabs.info]!.at(-1)).toEqual(['Feeds program', 'pg_dach0001']);
  });

  it('fills a version 1 market’s new row in the save that adds it', async () => {
    const { fake, markets, fileId } = await marketFile();
    fake.setWorkbook(fileId, asMarketVersion1(fake.getWorkbook(fileId)));
    const fed = await markets.apply({ fileId }, { kind: 'updateInfo', patch: { feedsProgramId: 'pg_dach0001' } }, stamp);
    expect(fed.ok && fed.snapshot.value.info.feedsProgramId).toBe('pg_dach0001');
    const after = fake.getWorkbook(fileId);
    expect(after[MARKET_LAYOUT.tabs.info]!.at(-1)!.slice(0, 2)).toEqual(['Feeds program', 'pg_dach0001']);
    expect(after['_meta']!.find((r) => r[0] === 'schemaVersion')).toEqual(['schemaVersion', 2]);
  });

  it('gives an upgraded Partners tab’s new Level and MAP health columns their dropdowns on the rows it already has', async () => {
    const { fake, books, fileId } = await seeded();
    fake.setWorkbook(fileId, asPartnersVersion2(encodePartnerBook(richBook(), PARTNERS_META)));
    const sheet = () => fake.spreadsheet(fileId)!.sheets.find((s) => s.title === T.partner)!;
    sheet().columnCount = 26;
    const width = 25;
    const before = fake.spreadsheet(fileId)!.validations.length;
    expect((await books.apply({ fileId }, { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Strong' } }, stamp)).ok).toBe(true);
    const added = fake.spreadsheet(fileId)!.validations.slice(before) as Array<{ range: Record<string, number>; rule: { condition: { values: Array<{ userEnteredValue: string }> } } }>;
    const onTab = (sheetId: number) => added.filter((v) => v.range.sheetId === sheetId).map((v) => [v.range, v.rule.condition.values.map((c) => c.userEnteredValue)]);
    expect(onTab(sheet().sheetId)).toEqual([
      [
        { sheetId: sheet().sheetId, startRowIndex: 1, endRowIndex: sheet().rowCount, startColumnIndex: width + 1, endColumnIndex: width + 2 },
        ['Registered', 'Preferred'],
      ],
      [
        { sheetId: sheet().sheetId, startRowIndex: 1, endRowIndex: sheet().rowCount, startColumnIndex: width + 2, endColumnIndex: width + 3 },
        ['On track', 'At risk', 'Off track'],
      ],
    ]);
    // The save also made the Proposals tab (version 5), with its own three dropdowns.
    const proposals = fake.spreadsheet(fileId)!.sheets.find((s) => s.title === T.proposalItem)!;
    expect(onTab(proposals.sheetId).map(([range]) => (range as Record<string, number>).startColumnIndex)).toEqual(
      (['kind', 'what', 'status'] as const).map((key) => PARTNERS_LAYOUT.columns.proposalItem.findIndex((c) => c.key === key)),
    );
    expect(added.every((v) => [sheet().sheetId, proposals.sheetId].includes(v.range.sheetId!))).toBe(true);
  });

  it('never writes a new header over one typed into its cell after the read: the save reads again and goes after it', async () => {
    const { fake, books, fileId } = await seeded();
    fake.setWorkbook(fileId, asPartnersVersion2(encodePartnerBook(richBook(), PARTNERS_META)));
    const width = 25;
    let typed = false;
    fake.beforeRequest = (call) => {
      if (typed || !isIdCheck(call)) return;
      typed = true;
      fake.spreadsheet(fileId)!.sheets.find((s) => s.title === T.partner)!.grid[0]![width] = 'Region';
    };
    const saved = await books.apply({ fileId }, { kind: 'update', entity: 'partner', id: 'p_1', patch: { whyItFits: 'Strong' } }, stamp);
    expect(saved.ok).toBe(true);
    expect(typed).toBe(true);
    expect(fake.getWorkbook(fileId)[T.partner]![0]!.slice(width)).toEqual(['Region', 'Program', 'Level', 'MAP health', 'Next milestone']);
    expect(saved.ok && saved.snapshot.issues).toEqual([]);
  });

  it('puts a version 1 market’s new row and a missing row it adds back on rows of their own, as the snapshot says', async () => {
    const { fake, markets, fileId } = await marketFile();
    const v1 = asMarketVersion1(fake.getWorkbook(fileId));
    v1[MARKET_LAYOUT.tabs.info] = v1[MARKET_LAYOUT.tabs.info]!.filter((row) => row[0] !== 'Updated');
    fake.setWorkbook(fileId, v1);
    const last = v1[MARKET_LAYOUT.tabs.info]!.length;
    const fed = await markets.apply({ fileId }, { kind: 'updateInfo', patch: { feedsProgramId: 'pg_dach0001' } }, stamp);
    expect(fed.ok).toBe(true);
    const info = fake.getWorkbook(fileId)[MARKET_LAYOUT.tabs.info]!;
    expect(info.slice(0, last)).toEqual(v1[MARKET_LAYOUT.tabs.info]!.map((row) => (row[0] === 'Updated by' ? ['Updated by', 'Ruth', ''] : row)));
    expect(info.slice(last).map((row) => row.slice(0, 2))).toEqual([['Feeds program', 'pg_dach0001'], ['Updated', NOW]]);
    const read = await markets.read({ fileId });
    expect(read.ok && read.snapshot).toEqual(fed.ok && fed.snapshot);
    expect(read.ok && read.snapshot.issues).toEqual([]);
    expect(read.ok && read.snapshot.value.info).toMatchObject({ feedsProgramId: 'pg_dach0001', updatedAt: NOW, updatedBy: 'Ruth' });
  });
});

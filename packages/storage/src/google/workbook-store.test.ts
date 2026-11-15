// Create, read, discard and the layout cache, for both stores. The write path's cases are in workbook-store-writes.test.ts.
import { describe, expect, it } from 'vitest';
import { NOW, sampleMarket } from '@partner-desk/core/test-builders';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { ReconnectRequired, StoreFailure, TokenUnavailable } from '../errors';
import { encodePartnerBook } from '../sheet-codec/encode';
import type { Cell } from '../sheet-codec/grid';
import { PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { asPartnersVersion4, PARTNERS_META, richBook } from '../sheet-codec/test-fixtures';
import { FakeGoogle, fakeClient } from './fake-google';
import { MemoryFolderStore } from './folders';
import { createGoogleMarketStore, marketFileName } from './market-store';
import { createSheetMetaCache, type SheetMetaCache } from './meta-cache';
import { createGooglePartnerBookStore } from './partner-book-store';

const owner = { userId: 'u_1', displayName: 'Anna Keller' };
const stamp = { now: NOW, actor: 'Ruth' };
const COMPANY = 'co_abcdefghij';
const T = PARTNERS_LAYOUT.tabs;
/** Drive's answer when the owner's storage is full. */
const QUOTA_BODY = { error: { code: 403, message: 'The user’s Drive storage quota has been exceeded.', errors: [{ domain: 'usageLimits', reason: 'storageQuotaExceeded' }] } };
type ValuesBody = { valueInputOption: string; data: Array<{ range: string; values: Cell[][] }> };

function setup(token?: () => Promise<string>, options: { metaCache?: SheetMetaCache } = {}) {
  const fake = new FakeGoogle();
  const folders = new MemoryFolderStore();
  const opts = { client: fakeClient(fake, token), folders, appBaseUrl: 'https://desk.test', ...options };
  return { fake, folders, opts, books: createGooglePartnerBookStore(opts), markets: createGoogleMarketStore(opts) };
}

/** A Partners file holding richBook(): four partners and a row of every other kind. */
async function seeded(options: { metaCache?: SheetMetaCache } = {}) {
  const env = setup(undefined, options);
  const { fileId } = await env.books.create(owner, COMPANY);
  env.fake.setWorkbook(fileId, encodePartnerBook(richBook(), PARTNERS_META));
  return { ...env, fileId };
}

/** Every request that writes cell values. */
const valueWrites = (fake: FakeGoogle) => fake.calls.filter((c) => c.method !== 'GET' && c.url.pathname.includes('/values'));
/** Each call: the Drive trash check, the layout, or a values read. */
const kinds = (fake: FakeGoogle) =>
  fake.calls.map((c) => (c.url.pathname.endsWith('/values:batchGet') ? 'values' : c.url.pathname.includes('/drive/') ? 'trash' : 'layout'));

describe('Google stores: create', () => {
  it('makes the Partners workbook in PartnerStandard / PartnerStandard Desk and links to it', async () => {
    const { fake, books } = setup();
    const created = await books.create(owner, COMPANY);
    const sheet = fake.spreadsheet(created.fileId)!;
    expect(sheet.name).toBe('PartnerStandard Desk – Partners');
    const [root, desk] = fake.folders();
    expect([root!.name, desk!.name]).toEqual(['PartnerStandard', 'PartnerStandard Desk']);
    expect(sheet.parents).toEqual([desk!.id]);
    expect(created.fileUrl).toBe(`https://docs.google.com/spreadsheets/d/${created.fileId}/edit`);
    const wb = fake.getWorkbook(created.fileId);
    expect(wb[T.start]!.flat()).toContain('https://desk.test/partners');
    expect(wb[T.meta]).toEqual([['key', 'value'], ['schemaVersion', 5], ['companyId', COMPANY], ['createdWith', 'desk.partnerstandard.com']]);
    expect(wb[T.account]).toEqual([PARTNERS_LAYOUT.columns.account.map((c) => c.header)]);
  });

  it('names a market’s file after the market and its partner type, and links to the market', async () => {
    const { fake, markets } = setup();
    const { fileId } = await markets.create(owner, sampleMarket());
    expect(fake.spreadsheet(fileId)!.name).toBe('PartnerStandard Desk – Austria · Reseller');
    expect(marketFileName({ marketName: 'DACH', partnerType: 'system-integrator' })).toBe(SHEET_COPY.DRIVE.marketFile('DACH', 'System Integrator (SI)'));
    expect(fake.getWorkbook(fileId)['Start here']!.flat()).toContain('https://desk.test/markets/m_abcdefghij');
  });

  it('sets the sheet up: every tab in order, _meta hidden, dropdowns and protected ID columns', async () => {
    const { fake, books } = setup();
    const { fileId } = await books.create(owner, COMPANY);
    const sheet = fake.spreadsheet(fileId)!;
    expect([...sheet.sheets].sort((a, b) => a.index - b.index).map((s) => s.title)).toEqual(PARTNERS_LAYOUT.tabOrder);
    expect(sheet.sheets.filter((s) => s.hidden).map((s) => s.title)).toEqual(['_meta']);
    expect(sheet.validations).toHaveLength(25);
    const partners = sheet.sheets.find((s) => s.title === T.partner)!;
    expect(partners.columnCount).toBe(29);
    expect(sheet.protections).toContainEqual(expect.objectContaining({ range: { sheetId: partners.sheetId, startColumnIndex: 0, endColumnIndex: 1 }, warningOnly: true }));
  });

  it('a create that fails half-way trashes the new file', async () => {
    const { fake, books } = setup();
    // Folders, the spreadsheet and its setup succeed; the value write after setup fails for good.
    fake.beforeRequest = (call) => {
      if (call.url.pathname.endsWith(':batchUpdate') && !call.url.pathname.includes('/values')) {
        fake.beforeRequest = undefined;
        fake.failNext(400);
      }
    };
    await expect(books.create(owner, COMPANY)).rejects.toMatchObject({ code: 'unavailable' });
    const trashed = fake.calls.find((c) => c.method === 'PATCH');
    expect(trashed?.body).toEqual({ trashed: true });
    const fileId = trashed!.url.pathname.split('/files/')[1]!;
    expect(fake.spreadsheet(fileId)).toMatchObject({ trashed: true });
  });

  it('says the Drive is full, not that a file is missing, when Google refuses for lack of space', async () => {
    const { fake, markets } = setup();
    fake.failNext(403, 1, QUOTA_BODY);
    await expect(markets.create(owner, sampleMarket())).rejects.toMatchObject({ code: 'quota', message: COPY.QUOTA_MESSAGE });
  });

  it('turns a failure outside Google (the folder record’s database) into an unavailable StoreFailure', async () => {
    const { fake, folders, books } = setup();
    folders.get = async () => { throw new Error('database said no: SQLITE_BUSY'); };
    const failure = await books.create(owner, COMPANY).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StoreFailure);
    expect(failure).toMatchObject({ code: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    expect(fake.calls).toEqual([]);
  });

  it('throws an auth StoreFailure when Google access must be reconnected, creating nothing', async () => {
    const { fake, books } = setup(async () => { throw new ReconnectRequired(); });
    const failure = await books.create(owner, COMPANY).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(StoreFailure);
    expect(failure).toMatchObject({ code: 'auth', message: COPY.AUTH_MESSAGE });
    expect(fake.folders()).toEqual([]);
  });
});

describe('Google stores: values are written as RAW text', () => {
  it('formula-like text is stored raw', async () => {
    const { fake, books, fileId } = await seeded();
    const formulas = ['=HYPERLINK("https://evil.test","Acme")', '+43 1 234 56', '@acme', '-x'];
    const [company, website, comments, whyItFits] = formulas;
    fake.calls.length = 0;
    const added = await books.applyMany({ fileId }, [
      { kind: 'add', entity: 'account', values: { id: 'tmp_a', company, website, comments } },
      { kind: 'add', entity: 'partner', values: { accountId: 'tmp_a', whyItFits, partnerType: 'reseller' } },
    ], stamp);
    if (!added.ok) throw new Error(added.message);

    const [write] = valueWrites(fake);
    expect(write!.url.pathname).toMatch(/\/values:batchUpdate$/);
    expect((write!.body as ValuesBody).valueInputOption).toBe('RAW');
    expect((write!.body as ValuesBody).data.flatMap((d) => d.values.flat())).toEqual(expect.arrayContaining(formulas));
    const wb = fake.getWorkbook(fileId);
    const cell = (entity: 'account' | 'partner', id: string | null, key: string) =>
      wb[T[entity]]!.find((r) => r[0] === id)![PARTNERS_LAYOUT.columns[entity].findIndex((c) => c.key === key)];
    const [accountId, partnerId] = added.entityIds;
    expect([cell('account', accountId!, 'company'), cell('account', accountId!, 'website'), cell('account', accountId!, 'comments'), cell('partner', partnerId!, 'whyItFits')])
      .toEqual(formulas);
  });

  it('writes a new file’s values as RAW too', async () => {
    const { fake, markets } = setup();
    await markets.create(owner, sampleMarket({ info: { ...sampleMarket().info, statement: '=SUM(1,2)\n+1' } }));
    const writes = valueWrites(fake);
    expect(writes).toHaveLength(1);
    expect((writes[0]!.body as ValuesBody).valueInputOption).toBe('RAW');
    expect((writes[0]!.body as ValuesBody).data.flatMap((d) => d.values.flat())).toContain('=SUM(1,2)\n+1');
  });
});

describe('Google stores: read', () => {
  it('reads in three calls: the trash check and the layout side by side, then one unformatted batchGet', async () => {
    const { fake, books, fileId } = await seeded();
    fake.calls.length = 0;
    const read = await books.read({ fileId });
    expect(read).toEqual({ ok: true, snapshot: { value: richBook(), issues: [] } });
    expect(kinds(fake).sort()).toEqual(['layout', 'trash', 'values']);
    const query = fake.calls.find((c) => c.url.pathname.endsWith('/values:batchGet'))!.url.searchParams;
    expect(query.getAll('ranges')).toEqual([
      "'Accounts'", "'Partners'", "'Market links'", "'People'", "'Calls'", "'Qualification'", "'Proposals'", "'_meta'",
    ]);
    expect(query.get('valueRenderOption')).toBe('UNFORMATTED_VALUE');
    expect(query.get('dateTimeRenderOption')).toBe('SERIAL_NUMBER');
  });

  it('reads a hand-typed date-time serial as UTC', async () => {
    const { fake, books, fileId } = await seeded();
    const wb = fake.getWorkbook(fileId);
    wb[T.partner]![1]![PARTNERS_LAYOUT.columns.partner.findIndex((c) => c.key === 'updatedAt')] = 46311.75;
    fake.setWorkbook(fileId, wb);
    const read = await books.read({ fileId });
    expect(read.ok && read.snapshot.value.partners[0]!.updatedAt).toBe('2026-10-16T18:00:00.000Z');
  });

  it('maps Google failures to store errors', async () => {
    const { fake, books, fileId } = await seeded({ metaCache: createSheetMetaCache({ ttlMs: 600_000, clock: () => 0 }) });
    await books.read({ fileId }); // caches the layout: one values call per read from here
    expect(await books.read({ fileId: 'missing-file-id-000000' })).toMatchObject({ ok: false, error: 'file_not_found' });
    fake.failNext(503, 4);
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE });
    fake.failNext(403);
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found', message: COPY.FILE_GONE });
    fake.failNext(401, 2);
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    fake.failNext(403, 1, QUOTA_BODY);
    expect(await books.read({ fileId })).toEqual({ ok: false, error: 'quota', message: COPY.QUOTA_MESSAGE });
  });

  it('reports Google failing on the layout and the trash check as unavailable', async () => {
    const { fake, books, fileId } = await seeded();
    fake.failNext(503, 8); // four tries each
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('reports a sign-in that isn’t answering as unavailable', async () => {
    let down = false;
    const { books } = setup(async () => { if (down) throw new TokenUnavailable(); return 'test-token'; });
    const { fileId } = await books.create(owner, COMPANY);
    down = true;
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'unavailable' });
  });

  it('rejects ids that cannot be Google file ids without calling Google', async () => {
    const { fake, books } = setup();
    expect(await books.read({ fileId: '../etc/passwd' })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await books.apply({ fileId: '../etc/passwd' }, { kind: 'reopen', partnerId: 'p_1' }, stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(fake.calls).toEqual([]);
  });

  it('reads a file in the Drive trash as gone, and an apply writes nothing to it', async () => {
    const { fake, books, fileId } = await seeded();
    fake.trash(fileId);
    expect(await books.read({ fileId })).toEqual({ ok: false, error: 'file_not_found', message: COPY.FILE_GONE });
    fake.calls.length = 0;
    expect(await books.apply({ fileId }, { kind: 'reopen', partnerId: 'p_3' }, stamp)).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(fake.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('opens the file id it is given, whatever company _meta names, and never looks for that company’s file', async () => {
    const { fake, books, fileId } = await seeded();
    const other = await books.create(owner, 'co_other00001');
    const wb = fake.getWorkbook(fileId);
    wb[T.meta]![2]![1] = 'co_other00001';
    fake.setWorkbook(fileId, wb);
    fake.calls.length = 0;
    const read = await books.read({ fileId });
    expect(read.ok && read.snapshot.value.partners.map((p) => p.id)).toEqual(['p_1', 'p_2', 'p_3', 'p_4']);
    expect(read.ok && read.snapshot.value.companyId).toBe('co_other00001');
    expect(fake.calls.every((c) => c.url.pathname.includes(fileId) && !c.url.pathname.includes(other.fileId))).toBe(true);
  });

  it('reads a Partners file made by the first version as old_version, and an apply writes nothing to it', async () => {
    const { fake, books, fileId } = await seeded();
    const wb = fake.getWorkbook(fileId);
    wb[T.meta]![1]![1] = 1;
    fake.setWorkbook(fileId, wb);
    const old = { ok: false, error: 'old_version', tab: '_meta', message: 'This Partners file was made by an earlier test version of PartnerStandard Desk.' };
    expect(await books.read({ fileId })).toEqual(old);
    fake.calls.length = 0;
    expect(await books.apply({ fileId }, { kind: 'reopen', partnerId: 'p_3' }, stamp)).toEqual(old);
    expect(fake.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });

  it('reports a file that isn’t a PartnerStandard Desk file as a structure problem', async () => {
    const { fake, books, markets, fileId } = await seeded();
    const wb = fake.getWorkbook(fileId);
    wb[T.meta] = [['something else']];
    fake.setWorkbook(fileId, wb);
    expect(await books.read({ fileId })).toEqual({ ok: false, error: 'structure', tab: '_meta', message: SHEET_COPY.ISSUES.NOT_OURS });
    // A Partners file is not a market.
    const { fileId: book } = await books.create(owner, COMPANY);
    expect(await markets.read({ fileId: book })).toMatchObject({ ok: false, error: 'structure' });
  });
});

describe('Google stores: the tab layout cache', () => {
  function cachedSetup() {
    let now = 0;
    const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock: () => now });
    return { metaCache, advance: (ms: number) => { now += ms; } };
  }

  it('asks for the layout once, then reads with one call', async () => {
    const { metaCache } = cachedSetup();
    const { fake, books, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    fake.calls.length = 0;
    expect(await books.read({ fileId })).toMatchObject({ ok: true, snapshot: { value: richBook() } });
    expect(kinds(fake)).toEqual(['values']);
  });

  it('shares the layout with the next request’s store', async () => {
    const { metaCache } = cachedSetup();
    const { fake, books, opts, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    const next = createGooglePartnerBookStore({ ...opts, client: fakeClient(fake) });
    fake.calls.length = 0;
    await next.read({ fileId });
    expect(kinds(fake)).toEqual(['values']);
  });

  it('asks for the layout again, with the trash check, after ten minutes', async () => {
    const { metaCache, advance } = cachedSetup();
    const { fake, books, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    advance(600_001);
    fake.calls.length = 0;
    await books.read({ fileId });
    expect(kinds(fake).sort()).toEqual(['layout', 'trash', 'values']);
  });

  it('a cached layout that Google refuses is fetched again once', async () => {
    const { metaCache } = cachedSetup();
    const { fake, books, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    const wb = fake.getWorkbook(fileId);
    delete wb[T.person];
    fake.setWorkbook(fileId, wb);
    fake.calls.length = 0;
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'structure', tab: T.person });
    // Google can't parse the cached People range (400), so the layout is fetched once and the remaining tabs read.
    const seen = kinds(fake);
    expect(seen[0]).toBe('values');
    expect(seen.slice(1, 3).sort()).toEqual(['layout', 'trash']);
    expect(seen.slice(3)).toEqual(['values']);
    // A layout that lacks a tab the codec reads is never cached.
    expect(metaCache.get(fileId)).toBeNull();
  });

  it('the next save of a version 4 file adds the Proposals tab in one batchUpdate and drops the cached layout', async () => {
    const { metaCache } = cachedSetup();
    const { fake, books, fileId } = await seeded({ metaCache });
    fake.setWorkbook(fileId, asPartnersVersion4(encodePartnerBook(richBook(), PARTNERS_META)));
    const tabs = () => [...fake.spreadsheet(fileId)!.sheets].sort((a, b) => a.index - b.index).map((sheet) => sheet.title);
    expect(tabs()).not.toContain('Proposals');

    // Read as it is, writing nothing. A layout that lacks a tab the codec reads is never cached.
    fake.calls.length = 0;
    expect(await books.read({ fileId })).toEqual({ ok: true, snapshot: { value: richBook(), issues: [] } });
    expect(fake.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect(metaCache.get(fileId)).toBeNull();

    fake.calls.length = 0;
    const saved = await books.apply({ fileId }, { kind: 'update', entity: 'account', id: 'a_2', patch: { comments: 'Met again' } }, stamp);
    expect(saved.ok && saved.snapshot.value.accounts.find((a) => a.id === 'a_2')!.comments).toBe('Met again');
    const sheetUpdates = fake.calls.filter((c) => c.method === 'POST' && c.url.pathname.endsWith(':batchUpdate') && !c.url.pathname.includes('/values'));
    expect(sheetUpdates).toHaveLength(1);
    type Request = { addSheet?: { properties: { title: string; index: number } } };
    const added = (sheetUpdates[0]!.body as { requests: Request[] }).requests.flatMap((r) => (r.addSheet ? [r.addSheet.properties] : []));
    expect(added).toEqual([expect.objectContaining({ title: 'Proposals', index: PARTNERS_LAYOUT.tabOrder.indexOf('Proposals') })]);
    expect(tabs()).toEqual(PARTNERS_LAYOUT.tabOrder);
    const wb = fake.getWorkbook(fileId);
    expect(wb[T.proposalItem]).toEqual([PARTNERS_LAYOUT.columns.proposalItem.map((c) => c.header)]);
    expect(wb[T.meta]![1]).toEqual(['schemaVersion', 5]);
    // The save made a tab, so the layout is fetched afresh and cached again: from then on, one call per read.
    expect(metaCache.get(fileId)).toBeNull();
    fake.calls.length = 0;
    expect(await books.read({ fileId })).toMatchObject({ ok: true, snapshot: { issues: [] } });
    expect(kinds(fake).sort()).toEqual(['layout', 'trash', 'values']);
    expect(metaCache.get(fileId)).not.toBeNull();
    fake.calls.length = 0;
    await books.read({ fileId });
    expect(kinds(fake)).toEqual(['values']);
  });

  it('notices a file moved to the Drive trash once the cached layout is gone', async () => {
    const { metaCache, advance } = cachedSetup();
    const { fake, books, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    fake.trash(fileId);
    advance(600_001);
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });
});

describe('Google stores: trash', () => {
  it('moves the Partners file to the Drive trash with files.update, so the next read finds it gone', async () => {
    const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock: () => 0 });
    const { fake, books, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    fake.calls.length = 0;
    await books.trash({ fileId });
    expect(fake.calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([['PATCH', `/drive/v3/files/${fileId}`, { trashed: true }]]);
    expect(fake.spreadsheet(fileId)!.trashed).toBe(true);
    expect(metaCache.get(fileId)).toBeNull();
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('never throws: not for a file already gone, an id that can’t be Google’s, or Google failing', async () => {
    const { fake, books } = setup();
    const { fileId } = await books.create(owner, COMPANY);
    fake.failNext(503, 4);
    await expect(books.trash({ fileId })).resolves.toBeUndefined();
    fake.remove(fileId);
    await expect(books.trash({ fileId })).resolves.toBeUndefined();
    fake.calls.length = 0;
    await expect(books.trash({ fileId: '../etc/passwd' })).resolves.toBeUndefined();
    expect(fake.calls).toEqual([]);
  });
});

describe('Google stores: discard', () => {
  it('moves the file to the Drive trash, never deleting it for good', async () => {
    const { fake, books } = setup();
    const { fileId } = await books.create(owner, COMPANY);
    fake.calls.length = 0;
    await books.discard({ fileId });
    expect(fake.calls.map((c) => [c.method, c.url.pathname, c.body])).toEqual([['PATCH', `/drive/v3/files/${fileId}`, { trashed: true }]]);
    expect(fake.spreadsheet(fileId)!.trashed).toBe(true);
  });

  it('never throws for a file that is already gone, or when Google keeps failing', async () => {
    const { fake, books } = setup();
    const { fileId } = await books.create(owner, COMPANY);
    fake.failNext(503, 4);
    await expect(books.discard({ fileId })).resolves.toBeUndefined();
    fake.remove(fileId);
    await expect(books.discard({ fileId })).resolves.toBeUndefined();
  });

  it('sends nothing for an id that can’t be Google’s', async () => {
    const { fake, books } = setup();
    await expect(books.discard({ fileId: '../etc/passwd' })).resolves.toBeUndefined();
    expect(fake.calls).toEqual([]);
  });

  it('forgets the file’s cached layout, so the next read sees it in the trash', async () => {
    const metaCache = createSheetMetaCache({ ttlMs: 600_000, clock: () => 0 });
    const { books, fileId } = await seeded({ metaCache });
    await books.read({ fileId });
    expect(metaCache.get(fileId)).not.toBeNull();
    await books.discard({ fileId });
    expect(metaCache.get(fileId)).toBeNull();
    expect(await books.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });
});

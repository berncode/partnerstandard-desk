// The live Google tests: the token exchange, the skip rule and the timeouts.
import { describe, expect, it, vi } from 'vitest';
import type { PartnerChange } from '@partner-desk/core';
import { runMarketStoreContract, runPartnerBookStoreContract } from '../contract';
import { expectOk } from '../contract-helpers';
import { withQuery } from '../http/retry';
import { PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { cellRange, tabRange } from './a1';
import { GoogleClient, SHEETS_API } from './client';
import { MemoryFolderStore } from './folders';
import { createGoogleMarketStore } from './market-store';
import { createGooglePartnerBookStore } from './partner-book-store';

/**
 * The storage contract and the three questions of spec 6.3, against real Google. Runs only with GOOGLE_LIVE_TEST=1,
 * plus GOOGLE_LIVE_CLIENT_ID, GOOGLE_LIVE_CLIENT_SECRET and GOOGLE_LIVE_REFRESH_TOKEN (a refresh token with the
 * drive.file scope for a test account: see scripts/google-refresh-token.md). A run makes its own
 * "PartnerStandard / PartnerStandard Desk" folders in that account and adds a few dozen small spreadsheets; the discard checks
 * move some of them to the trash. The hand-edit cases are skipped: they need the fake.
 *
 * Question 3 (do the four apps and PartnerStandard Desk see each other's files under one OAuth client) needs the other apps'
 * files and is a manual step.
 *
 * Questions 4 and 5 are the agent proposals plan's (spec 12, step 1): a version 4 Partners file upgrades to 5 on its
 * next save, and what Google answers when the upgrade adds its Proposals tab next to a person's own "proposals" tab
 * (Google may treat tab names that differ only in case as the same name).
 */
const live = process.env.GOOGLE_LIVE_TEST === '1';
const clientId = process.env.GOOGLE_LIVE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_LIVE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_LIVE_REFRESH_TOKEN;

const COMPANY_ID = 'co_livecheck1';
const OWNER = { userId: 'u_live', displayName: 'Live check' };
const APP_URL = 'https://desk.partnerstandard.com';

if (live) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('GOOGLE_LIVE_TEST=1 needs GOOGLE_LIVE_CLIENT_ID, GOOGLE_LIVE_CLIENT_SECRET and GOOGLE_LIVE_REFRESH_TOKEN');
  }
  vi.setConfig({ testTimeout: 300_000 });
  let cached: { token: string; expiresAt: number } | null = null;
  const getAccessToken = async () => {
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
    });
    if (!response.ok) throw new Error(`Token refresh failed with ${response.status}`);
    const body = (await response.json()) as { access_token: string; expires_in: number };
    cached = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
    return cached.token;
  };
  const folders = new MemoryFolderStore(); // one folder pair per run
  const options = () => ({ client: new GoogleClient({ getAccessToken }), folders, appBaseUrl: APP_URL });

  runPartnerBookStoreContract('google (live)', () => ({ store: createGooglePartnerBookStore(options()), owner: OWNER }));
  runMarketStoreContract('google (live)', () => ({ store: createGoogleMarketStore(options()), owner: OWNER }));

  describe('google (live): spec 6.3 questions 1 and 2', () => {
    const stamp = (now = new Date().toISOString()) => ({ now, actor: 'Live check' });

    /** The changes for 200 companies, each a partner with a person, 1 or 2 calls and, for some, a qualification. One batch per 12 partners. */
    function batches(): PartnerChange[][] {
      const out: PartnerChange[][] = [];
      let calls = 0;
      let qualifications = 0;
      for (let first = 0; first < 200; first += 12) {
        const batch: PartnerChange[] = [];
        for (let i = first; i < Math.min(first + 12, 200); i++) {
          const tmp = `tmp_${i}`;
          batch.push({ kind: 'add', entity: 'account', values: { id: `${tmp}_a`, company: `Live partner ${i}` } });
          batch.push({ kind: 'add', entity: 'partner', values: { id: tmp, accountId: `${tmp}_a`, partnerType: 'reseller' } });
          batch.push({ kind: 'add', entity: 'person', values: { accountId: `${tmp}_a`, name: `Contact ${i}`, role: 'seller' } });
          // 300 calls: partners 0 to 99 get two, the rest get one.
          for (let c = 0; c < (i < 100 ? 2 : 1); c++, calls++) {
            batch.push({ kind: 'add', entity: 'call', values: { partnerId: tmp, date: '2026-10-20', kind: 'discovery', notes: `Call ${calls}` } });
          }
          if (i % 2 === 0) { qualifications++; batch.push({ kind: 'add', entity: 'qualification', values: { partnerId: tmp, q1Overlap: `Overlap ${i}` } }); }
        }
        out.push(batch);
      }
      expect(calls).toBe(300);
      expect(qualifications).toBe(100);
      return out;
    }

    it('reads a Partners workbook of 200 partners, 200 people, 300 calls and 100 qualifications (question 1)', async () => {
      const store = createGooglePartnerBookStore(options());
      const { fileId } = await store.create(OWNER, COMPANY_ID);
      try {
        const setupStart = Date.now();
        for (const batch of batches()) expectOk(await store.applyMany({ fileId }, batch, stamp()));
        console.info(`live check 1: filled the workbook in ${Date.now() - setupStart} ms`);
        const timings: number[] = [];
        for (let run = 0; run < 3; run++) {
          const start = Date.now();
          const read = expectOk(await store.read({ fileId }));
          timings.push(Date.now() - start);
          const book = read.snapshot.value;
          expect([book.accounts.length, book.partners.length, book.people.length, book.calls.length, book.qualifications.length]).toEqual([200, 200, 200, 300, 100]);
        }
        console.info(`live check 1: read of 200 partners, 200 people, 300 calls, 100 qualifications took ${timings.join(', ')} ms (three reads)`);
      } finally {
        await store.discard({ fileId });
      }
    });

    it('saves five times to one partner in 10 seconds, none failing (question 2)', async () => {
      const store = createGooglePartnerBookStore(options());
      const { fileId } = await store.create(OWNER, COMPANY_ID);
      try {
        const added = expectOk(await store.applyMany({ fileId }, [
          { kind: 'add', entity: 'account', values: { id: 'tmp_qa', company: 'Quick saves AG' } },
          { kind: 'add', entity: 'partner', values: { accountId: 'tmp_qa', partnerType: 'reseller' } },
        ], stamp()));
        const partnerId = added.entityIds[1]!;
        const start = Date.now();
        const times: number[] = [];
        for (let save = 0; save < 5; save++) {
          const at = Date.now();
          // One save as the app makes it: a change to the partner row and a new row in Calls.
          expectOk(await store.applyMany({ fileId }, [
            { kind: 'update', entity: 'partner', id: partnerId, patch: { whyItFits: `Save ${save}` } },
            { kind: 'add', entity: 'call', values: { partnerId, date: '2026-10-21', kind: 'follow_up', notes: `Save ${save}` } },
          ], stamp()));
          times.push(Date.now() - at);
        }
        const total = Date.now() - start;
        console.info(`live check 2: five saves took ${times.join(', ')} ms, ${total} ms in all`);
        expect(total).toBeLessThan(10_000);
        const book = expectOk(await store.read({ fileId })).snapshot.value;
        expect(book.calls).toHaveLength(5);
        expect(book.partners[0]!.whyItFits).toBe('Save 4');
      } finally {
        await store.discard({ fileId });
      }
    });
  });

  describe('google (live): agent proposals, Partners format 4 to 5 (questions 4 and 5)', () => {
    const stamp = (now = new Date().toISOString()) => ({ now, actor: 'Live check' });
    const client = new GoogleClient({ getAccessToken });
    const PROPOSALS = PARTNERS_LAYOUT.tabs.proposalItem;
    const META = PARTNERS_LAYOUT.tabs.meta;
    const PARTNERS = PARTNERS_LAYOUT.tabs.partner;
    const PROPOSAL_HEADERS = PARTNERS_LAYOUT.columns.proposalItem.map((col) => col.header);

    type Tab = { sheetId: number; title: string; gridProperties?: { columnCount?: number } };
    const tabsOf = async (fileId: string): Promise<Tab[]> =>
      ((await client.get<{ sheets?: Array<{ properties: Tab }> }>(withQuery(`${SHEETS_API}/${fileId}`, {
        fields: 'sheets.properties(sheetId,title,gridProperties.columnCount)',
      }))).sheets ?? []).map((sheet) => sheet.properties);
    const titlesOf = async (fileId: string) => (await tabsOf(fileId)).map((tab) => tab.title);
    const rowsOf = async (fileId: string, title: string): Promise<unknown[][]> =>
      (await client.get<{ valueRanges?: Array<{ values?: unknown[][] }> }>(withQuery(`${SHEETS_API}/${fileId}/values:batchGet`, {
        ranges: [tabRange(title)], majorDimension: 'ROWS', valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER',
      }))).valueRanges?.[0]?.values ?? [];
    const batchUpdate = (fileId: string, requests: unknown[]) => client.post(`${SHEETS_API}/${fileId}:batchUpdate`, { requests });
    const write = (fileId: string, range: string, values: unknown[][]) =>
      client.post(`${SHEETS_API}/${fileId}/values:batchUpdate`, { valueInputOption: 'RAW', data: [{ range, values }] }, { idempotent: true });
    const schemaVersion = async (fileId: string) => (await rowsOf(fileId, META)).find((row) => row[0] === 'schemaVersion')?.[1];

    /** A Partners file with one reseller, as a version 4 build left it: no Proposals tab, version 4 in _meta. */
    async function version4File(store: ReturnType<typeof createGooglePartnerBookStore>) {
      const { fileId } = await store.create(OWNER, COMPANY_ID);
      const added = expectOk(await store.applyMany({ fileId }, [
        { kind: 'add', entity: 'account', values: { id: 'tmp_v4', company: 'Version four AG' } },
        { kind: 'add', entity: 'partner', values: { accountId: 'tmp_v4', partnerType: 'reseller' } },
      ], stamp()));
      const proposals = (await tabsOf(fileId)).find((tab) => tab.title === PROPOSALS)!;
      await batchUpdate(fileId, [{ deleteSheet: { sheetId: proposals.sheetId } }]);
      const versionRow = (await rowsOf(fileId, META)).findIndex((row) => row[0] === 'schemaVersion');
      await write(fileId, cellRange(META, versionRow + 1, 1), [[4]]);
      expect(await schemaVersion(fileId)).toBe(4);
      expect(await titlesOf(fileId)).not.toContain(PROPOSALS);
      return { fileId, accountId: added.entityIds[0]!, partnerId: added.entityIds[1]! };
    }

    /** A tab of the person's own, made by hand in Google Sheets, with a few rows. */
    async function ownTab(fileId: string, title: string, rows: unknown[][]) {
      await batchUpdate(fileId, [{ addSheet: { properties: { title } } }]);
      await write(fileId, tabRange(title), rows);
    }

    it('a version 4 Partners file in Drive upgrades to 5 on its next save and reads back (question 4)', async () => {
      const store = createGooglePartnerBookStore(options());
      const { fileId, accountId, partnerId } = await version4File(store);
      try {
        // The person's own column on the Partners tab (after every column in use) and a tab of their own.
        const partnersTab = (await tabsOf(fileId)).find((tab) => tab.title === PARTNERS)!;
        const header = (await rowsOf(fileId, PARTNERS))[0] ?? [];
        if ((partnersTab.gridProperties?.columnCount ?? 26) <= header.length) {
          await batchUpdate(fileId, [{ appendDimension: { sheetId: partnersTab.sheetId, dimension: 'COLUMNS', length: 1 } }]);
        }
        await write(fileId, `${cellRange(PARTNERS, 1, header.length)}:${cellRange(PARTNERS, 2, header.length).split('!')[1]}`, [['My notes'], ['keep me']]);
        const ideas = [['Idea', 'When'], ['Ask Alpha about training', '2026-11-10']];
        await ownTab(fileId, 'My ideas', ideas);

        // Reading a version 4 file: no proposal rows, no issue, and nothing written.
        const read = expectOk(await store.read({ fileId })).snapshot;
        expect(read.value.proposalItems).toEqual([]);
        expect(read.value.partners.map((p) => p.id)).toEqual([partnerId]);
        expect(read.issues).toEqual([]);
        expect(await titlesOf(fileId)).not.toContain(PROPOSALS);
        expect(await schemaVersion(fileId)).toBe(4);

        // The next save adds the Proposals tab with its header row and sets _meta to 5; the person's own column and tab stay.
        const start = Date.now();
        expectOk(await store.apply({ fileId }, { kind: 'update', entity: 'account', id: accountId, patch: { comments: 'Met at the fair' } }, stamp()));
        console.info(`live check 4: the save that upgraded the file from 4 to 5 took ${Date.now() - start} ms`);
        expect(await titlesOf(fileId)).toContain(PROPOSALS);
        expect(await rowsOf(fileId, PROPOSALS)).toEqual([PROPOSAL_HEADERS]);
        expect(await schemaVersion(fileId)).toBe(5);
        expect((await rowsOf(fileId, PARTNERS)).map((row) => row[header.length])).toEqual(['My notes', 'keep me']);
        expect(await rowsOf(fileId, 'My ideas')).toEqual(ideas);

        // It reads back, and the first proposal row goes into the new tab.
        const after = expectOk(await store.read({ fileId })).snapshot;
        expect(after.value.accounts.find((a) => a.id === accountId)?.comments).toBe('Met at the fair');
        expect(after.value.proposalItems).toEqual([]);
        expect(after.issues).toEqual([]);
        const now = new Date().toISOString();
        expectOk(await store.apply({ fileId }, {
          kind: 'add', entity: 'proposalItem', values: {
            proposalId: 'prp_livecheck', kind: 'fourC', accountId, partnerId, about: 'Version four AG', what: 'desk.credibility', proposed: '3',
            evidence: 'Ten customers named on their site', proposedBy: 'Claude for Live check', proposedOn: now,
            expiresOn: new Date(Date.now() + 30 * 86_400_000).toISOString(), targetUpdated: now,
          },
        }, stamp()));
        const withProposal = expectOk(await store.read({ fileId })).snapshot;
        expect(withProposal.value.proposalItems.map((r) => [r.proposalId, r.what, r.proposed, r.status])).toEqual([['prp_livecheck', 'desk.credibility', '3', 'waiting']]);
        expect(withProposal.issues).toEqual([]);
        expect(await rowsOf(fileId, 'My ideas')).toEqual(ideas);
      } finally {
        await store.discard({ fileId });
      }
    });

    it('a person’s own "proposals" tab next to the Proposals tab the upgrade adds: what Google answers (question 5)', async () => {
      const store = createGooglePartnerBookStore(options());
      const { fileId, accountId } = await version4File(store);
      try {
        const own = [['My proposals', 'For'], ['Training day', 'Alpha']];
        await ownTab(fileId, 'proposals', own);
        // A tab the app doesn't know is left alone: the file reads.
        expect(expectOk(await store.read({ fileId })).snapshot.value.proposalItems).toEqual([]);

        // The save names the person's tab before it asks Google for anything: nothing is written, still version 4.
        const result = await store.apply({ fileId }, { kind: 'update', entity: 'account', id: accountId, patch: { comments: 'Next save' } }, stamp());
        expect(result).toMatchObject({ ok: false, error: 'structure', tab: 'proposals' });
        expect(await schemaVersion(fileId)).toBe(4);
        expect(await titlesOf(fileId)).not.toContain(PROPOSALS);
        // What Google itself answers to a "Proposals" tab next to "proposals", asked directly (the answer the check needs).
        const refused = await batchUpdate(fileId, [{ addSheet: { properties: { title: PROPOSALS } } }]).then(() => false, () => true);
        console.info(`live check 5: Google ${refused ? 'refused' : 'took'} a "${PROPOSALS}" tab next to "proposals"; the save answered ${
          result.ok ? 'ok' : `${result.error} ("${result.message}")`}`);
        // Either way the person's own tab keeps its rows.
        expect(await rowsOf(fileId, 'proposals')).toEqual(own);
      } finally {
        await store.discard({ fileId });
      }
    });
  });
} else {
  describe.skip('google (live): set GOOGLE_LIVE_TEST=1 and the GOOGLE_LIVE_* credentials to run', () => {
    it('is skipped', () => {});
  });
}

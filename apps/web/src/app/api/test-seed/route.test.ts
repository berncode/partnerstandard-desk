import {
  listCases, listMaps, listPrograms, readCase, readCaseSources, readCompanyFacts, readMap, readMarket, readPartners, readProgram, refreshProgramOutputs,
  type Actor,
} from '@partner-desk/commands';
import { simulateCase, viewOf, type PartnerBook } from '@partner-desk/core';
import { SHEET_COPY } from '@partner-desk/copy';
import { memoryTrashedPartnerFiles, resetMemoryBookTestState } from '@partner-desk/storage';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { TursoApiKeys, type Db } from '@partner-desk/platform';
import { createTestDb } from '@partner-desk/platform/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OwnerSession } from '@/server/runtime';

const COMPANY = 'co_aaaaaaaaaa';
const state = vi.hoisted(() => ({
  testMode: true,
  session: null as OwnerSession | null,
  deps: null as unknown as ReturnType<typeof makeTestDeps>,
  db: null as unknown as Db,
}));
vi.mock('@partner-desk/platform', async (orig) => ({
  ...(await orig<typeof import('@partner-desk/platform')>()), testSignInEnabled: () => state.testMode,
}));
vi.mock('@/server/runtime', () => ({
  currentOwner: async () => state.session,
  depsFor: () => state.deps,
  apiKeys: () => new TursoApiKeys(state.db),
  companyFor: async () => ({ companyId: COMPANY, name: '' }),
  actorFor: (session: OwnerSession): Actor => ({ kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName }),
}));

const { POST, GET } = await import('./route');

/** The section of the account named `company`. Company facts live on the account, not the section. */
function byCompany(book: PartnerBook, company: string) {
  const account = book.accounts.find((a) => a.company === company);
  const section = book.partners.find((p) => p.accountId === account?.id);
  if (!account || !section) throw new Error(`no section for ${company}`);
  return { account, section };
}
const post = (body: unknown) => POST(new Request('http://127.0.0.1:3800/api/test-seed', { method: 'POST', body: JSON.stringify(body) }));
const testUser: OwnerSession = { owner: { userId: 'u_anna', displayName: 'Anna' }, email: 'test-a@example.test', storage: 'memory', personId: 'u_anna', member: null };
const anna: Actor = { kind: 'owner', userId: 'u_anna', displayName: 'Anna' };

beforeEach(async () => {
  state.db = await createTestDb();
  state.testMode = true;
  state.session = testUser;
  state.deps = makeTestDeps({ companies: { u_anna: 'co_aaaaaaaaaa' } });
  resetMemoryBookTestState();
});

describe('POST /api/test-seed', () => {
  it('is not there when test sign-in is off', async () => {
    state.testMode = false;
    expect((await post({ fixture: 'sample' })).status).toBe(404);
  });

  it('refuses a visitor who is signed out, or signed in with Google', async () => {
    state.session = null;
    expect((await post({ fixture: 'sample' })).status).toBe(401);
    state.session = { ...testUser, storage: 'google' };
    expect((await post({ fixture: 'sample' })).status).toBe(401);
    expect(state.deps.events.events).toEqual([]);
  });

  it('on the database edition serves a test user only, never a person signed in another way (task 14’s review)', async () => {
    state.session = { ...testUser, storage: 'database', email: 'anna@halden.example' };
    expect((await post({ fixture: 'sample' })).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect(state.deps.events.events).toEqual([]);
  });

  it('refuses an unknown fixture, and a company id in the body', async () => {
    expect((await post({ fixture: 'everything' })).status).toBe(400);
    expect((await post({ fixture: 'sample', companyId: 'co_bbbbbbbbbb' })).status).toBe(400);
  });

  it('adds the sample markets and partners to the test user’s own book through the commands', async () => {
    const response = await post({ fixture: 'sample' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { partnerIds: string[]; accountIds: string[]; marketIds: string[] };
    expect(Object.keys(body).sort()).toEqual(['accountIds', 'marketIds', 'partnerIds', 'partnersFileId']);
    expect(body.partnerIds).toHaveLength(11);
    expect(body.accountIds).toHaveLength(11);
    expect(body.marketIds).toHaveLength(2);
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    if (!read.ok) throw new Error(read.message);
    const book = read.value.value;
    expect(book.accounts).toHaveLength(body.partnerIds.length);
    expect(new Set(book.partners.map((p) => p.accountId)).size).toBe(book.partners.length);
    expect(book.partners.map((p) => p.id)).toEqual(body.partnerIds);
    expect(book.partners.map((p) => p.accountId)).toEqual(body.accountIds);
    expect(book.partners.every((p) => p.updatedBy === 'Anna')).toBe(true);
    const views = book.partners.reduce<Record<string, number>>((all, p) => ({ ...all, [viewOf(p)]: (all[viewOf(p)] ?? 0) + 1 }), {});
    expect(views).toEqual({ potential: 6, active: 2, closed: 3 });
    expect(book.partners.map((p) => p.step ?? p.stage).sort()).toEqual(
      ['discovery_call', 'exit', 'growth', 'map', 'onboarding', 'qualification', 'researched', 'researched', 'researched', 'researched', 'researched'],
    );
  });

  it('covers every place, the two-market partner and the long name', async () => {
    const body = (await (await post({ fixture: 'sample' })).json()) as { marketIds: string[] };
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    if (!read.ok) throw new Error(read.message);
    const book = read.value.value;
    const byName = (name: string) => byCompany(book, name).section;
    expect(book.marketLinks.filter((l) => l.partnerId === byName('Tailspin Solutions').id).map((l) => l.marketId).sort()).toEqual([...body.marketIds].sort());
    expect(byName('Proseware Ltd')).toMatchObject({ closed: 'not_now' });
    expect(byName('Humongous Insurance')).toMatchObject({ closed: 'no' });
    expect(byName('Lucerne Publishing')).toMatchObject({ exitedDate: '2026-10-21' });
    expect(byName('Wingtip Digital')).toMatchObject({ stage: 'growth' });
    const long = byCompany(book, 'Northern Isles Maritime Logistics And Trading Group Holdings');
    expect(long.account.company).toHaveLength(60);
    expect(long.account.website).toBe('');
    expect(long.section.partnerType).toBe('managed');
  });

  it('gives Austria a partner hypothesis that holds, and Tailspin’s Austria link names it', async () => {
    const body = (await (await post({ fixture: 'sample' })).json()) as { marketIds: string[] };
    const austria = await readMarket(state.deps, anna, { marketId: body.marketIds[0] });
    if (!austria.ok) throw new Error(austria.message);
    const [hypothesis] = austria.value.value.hypotheses;
    expect(hypothesis).toMatchObject({ name: 'Mid-size IT resellers', status: 'holds' });
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    if (!read.ok) throw new Error(read.message);
    const tailspin = byCompany(read.value.value, 'Tailspin Solutions').section;
    const links = read.value.value.marketLinks.filter((l) => l.partnerId === tailspin.id);
    expect(links.find((l) => l.marketId === body.marketIds[0])?.hypothesisId).toBe(hypothesis!.id);
    expect(links.find((l) => l.marketId === body.marketIds[1])?.hypothesisId).toBeNull();
  });

  it('can also put the closed and the exited partner in Austria', async () => {
    const body = (await (await post({ fixture: 'sample', closedInMarket: true })).json()) as { marketIds: string[] };
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    if (!read.ok) throw new Error(read.message);
    const { partners, marketLinks } = read.value.value;
    const inAustria = marketLinks.filter((l) => l.marketId === body.marketIds[0]).map((l) => {
      const section = partners.find((p) => p.id === l.partnerId)!;
      return read.value.value.accounts.find((a) => a.id === section.accountId)!.company;
    });
    expect(inAustria.sort()).toEqual(['Lucerne Publishing', 'Northwind Consulting', 'Proseware Ltd', 'Tailspin Solutions']);
  });

  it('can also log a discovery call with Tailspin, dated today, with one note', async () => {
    await post({ fixture: 'sample', callInMarket: true });
    const read = await readPartners(state.deps, anna, { companyId: COMPANY });
    if (!read.ok) throw new Error(read.message);
    const tailspin = byCompany(read.value.value, 'Tailspin Solutions').section;
    expect(read.value.value.calls).toEqual([expect.objectContaining({
      partnerId: tailspin.id, kind: 'discovery', date: state.deps.clock().slice(0, 10),
      topics: expect.objectContaining({ customerPains: 'Customers ask for security they can run without a security team.' }),
    })]);
  });

  it('can throw the Partners file away afterwards, so the next read says it is gone', async () => {
    const body = (await (await post({ fixture: 'sample', lose: 'partners' })).json()) as { marketIds: string[] };
    expect(await readPartners(state.deps, anna, { companyId: COMPANY })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await readMarket(state.deps, anna, { marketId: body.marketIds[0]! })).toMatchObject({ ok: true });
  });

  it('can mark the Partners file as an earlier version, and a trash is listed for the test', async () => {
    const body = (await (await post({ fixture: 'sample', oldPartners: true })).json()) as { partnersFileId: string };
    expect(await readPartners(state.deps, anna, { companyId: COMPANY })).toMatchObject({
      ok: false, error: 'old_version', message: SHEET_COPY.ISSUES.OLD_VERSION,
    });
    await state.deps.partnerBooks.trash({ fileId: body.partnersFileId });
    expect(memoryTrashedPartnerFiles()).toContain(body.partnersFileId);
    expect(await (await GET()).json()).toMatchObject({ trashedPartnerFiles: [body.partnersFileId] });
  });

  it('lists trashed files only for a signed-in test user, and only while test sign-in is on', async () => {
    state.session = null;
    expect((await GET()).status).toBe(401);
    state.session = { ...testUser, storage: 'google' };
    expect((await GET()).status).toBe(401);
    state.session = testUser;
    expect((await GET()).status).toBe(200);
    state.testMode = false;
    expect((await GET()).status).toBe(404);
  });

  it('can throw the first market’s file away afterwards, and only that one', async () => {
    const body = (await (await post({ fixture: 'sample', lose: 'market' })).json()) as { marketIds: string[] };
    expect(await readMarket(state.deps, anna, { marketId: body.marketIds[0]! })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await readMarket(state.deps, anna, { marketId: body.marketIds[1]! })).toMatchObject({ ok: true });
    expect(await readPartners(state.deps, anna, { companyId: COMPANY })).toMatchObject({ ok: true });
  });

  it('can give Austria two confirmed value points, and a reseller program it feeds, with Tailspin in it', async () => {
    const answer = (await (await post({ fixture: 'sample', valuePoints: true, feedingProgram: true, joinProgram: true })).json()) as {
      marketIds: string[]; programId: string;
    };
    expect(answer.programId).toMatch(/^pg_/);
    const austria = await readMarket(state.deps, anna, { marketId: answer.marketIds[0]! });
    if (!austria.ok) throw new Error(austria.error);
    expect(austria.value.value.valuePoints.map((v) => [v.text, v.state])).toEqual([
      ['Leads from us in your region', 'confirmed'], ['A product your customers renew', 'confirmed'],
    ]);
    expect(austria.value.value.info.feedsProgramId).toBe(answer.programId);
    const book = await readPartners(state.deps, anna, { companyId: COMPANY });
    if (!book.ok) throw new Error(book.error);
    expect(byCompany(book.value.value, 'Tailspin Solutions').section).toMatchObject({ programId: answer.programId, level: 'reg' });
    expect(book.value.value.partners.filter((p) => p.programId !== null)).toHaveLength(1);
  });

  it('throws a program’s file away as if trashed by hand, and only the user’s own', async () => {
    const { programId } = (await (await post({ fixture: 'sample', feedingProgram: true })).json()) as { programId: string };
    expect((await post({ fixture: 'trashProgram', programId })).status).toBe(200);
    expect(await readProgram(state.deps, anna, { programId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect((await post({ fixture: 'trashProgram', programId: 'pg_zzzzzzzzzz' })).status).toBe(404);
  });

  it('throws a MAP’s file away as if trashed by hand: still listed, can’t be read; only the user’s own', async () => {
    const { partnerIds } = (await (await post({ fixture: 'sample' })).json()) as { partnerIds: string[] };
    const { mapId } = (await (await post({ fixture: 'map', partnerId: partnerIds[0] })).json()) as { mapId: string };
    expect((await post({ fixture: 'trashMap', mapId })).status).toBe(200);
    expect(await readMap(state.deps, anna, { mapId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await listMaps(state.deps, anna, { companyId: COMPANY })).toMatchObject({ ok: true, value: [{ mapId }] });
    expect((await post({ fixture: 'trashMap', mapId: 'map_zzzzzzzzzz' })).status).toBe(404);
  });

  it('makes two reseller programs, the second with the focus DACH', async () => {
    const body = (await (await post({ fixture: 'programs' })).json()) as { programIds: string[] };
    const listed = await listPrograms(state.deps, anna, { companyId: COMPANY });
    expect(listed).toEqual({
      ok: true,
      value: [
        { programId: body.programIds[0], label: 'Reseller', partnerType: 'reseller' },
        { programId: body.programIds[1], label: 'Reseller · DACH', partnerType: 'reseller' },
      ],
    });
  });

  it('edits the Company facts file by hand: the value changes, its Updated stays', async () => {
    const before = await readCompanyFacts(state.deps, anna, { companyId: COMPANY });
    expect((await post({ fixture: 'handEditFacts' })).status).toBe(200);
    const after = await readCompanyFacts(state.deps, anna, { companyId: COMPANY });
    expect(before.ok && after.ok).toBe(true);
    if (!before.ok || !after.ok) return;
    expect(after.value.value).toEqual({ ...before.value.value, yearly: 21000 });
  });

  it('edits a program file by hand: the lead changes, its Updated stays', async () => {
    const { programIds } = (await (await post({ fixture: 'programs' })).json()) as { programIds: string[] };
    const programId = programIds[0]!;
    const before = await readProgram(state.deps, anna, { programId });
    expect((await post({ fixture: 'handEditProgram', programId })).status).toBe(200);
    const after = await readProgram(state.deps, anna, { programId });
    if (!before.ok || !after.ok) throw new Error('not read');
    expect(after.value.value).toEqual({ ...before.value.value, lead: 'Typed in the sheet' });
  });

  it('gives a program file an unreadable row, and refuses a program that isn’t the user’s', async () => {
    const { programIds } = (await (await post({ fixture: 'programs' })).json()) as { programIds: string[] };
    const programId = programIds[0]!;
    expect((await post({ fixture: 'programRowIssue', programId })).status).toBe(200);
    expect(await readProgram(state.deps, anna, { programId })).toMatchObject({ ok: true, value: { issues: [{ tab: 'Reasons', row: 4 }] } });
    expect((await post({ fixture: 'programRowIssue', programId: 'pg_zzzzzzzzzz' })).status).toBe(404);
    expect((await post({ fixture: 'programRowIssue' })).status).toBe(400);
  });

  it('answers the outputs last written to a program’s file, for the e2e', async () => {
    const { programIds } = (await (await post({ fixture: 'programs' })).json()) as { programIds: string[] };
    const programId = programIds[0]!;
    const get = () => GET(new Request(`http://127.0.0.1:3800/api/test-seed?programId=${programId}`));
    expect(await (await get()).json()).toMatchObject({ programOutputs: null });
    await refreshProgramOutputs(state.deps, anna, { programId });
    expect(await (await get()).json()).toMatchObject({ programOutputs: { publicText: expect.stringMatching(/^# /) } });
  });

  it('makes a business case for Acme as a reseller through the commands, and needs the partner type', async () => {
    const { acmePartnerIds } = (await (await post({ fixture: 'sample', twoTypes: true })).json()) as { acmePartnerIds: { reseller: string; technology: string } };
    const made = await post({ fixture: 'case', partnerId: acmePartnerIds.reseller });
    expect(made.status).toBe(200);
    const { caseId } = (await made.json()) as { caseId: string };
    expect(await listCases(state.deps, anna, { companyId: COMPANY })).toMatchObject({ ok: true, value: [{ caseId, partnerId: acmePartnerIds.reseller, partnerType: 'reseller' }] });
    expect((await post({ fixture: 'case' })).status).toBe(400);
    expect((await post({ fixture: 'case', partnerId: 'p_zzzzzzzzzz' })).status).toBe(500);
  });

  it('deletes a partner type’s row as a hand edit, leaving its case listed, and throws the Partners file away', async () => {
    const { acmePartnerIds } = (await (await post({ fixture: 'sample', twoTypes: true })).json()) as { acmePartnerIds: { reseller: string; technology: string } };
    const { caseId } = (await (await post({ fixture: 'case', partnerId: acmePartnerIds.reseller })).json()) as { caseId: string };
    expect((await post({ fixture: 'handRemovePartner', partnerId: acmePartnerIds.reseller })).status).toBe(200);
    const book = await readPartners(state.deps, anna, { companyId: COMPANY });
    expect(book.ok && book.value.value.partners.some((p) => p.id === acmePartnerIds.reseller)).toBe(false);
    expect(await readCaseSources(state.deps, anna, { caseId })).toMatchObject({ ok: true, value: { partnerTypeGone: true } });
    expect((await post({ fixture: 'handRemovePartner' })).status).toBe(400);
    expect((await post({ fixture: 'losePartners' })).status).toBe(200);
    expect(await readPartners(state.deps, anna, { companyId: COMPANY })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(await listCases(state.deps, anna, { companyId: COMPANY })).toMatchObject({ ok: true, value: [{ caseId }] });
  });
  it('saves Company facts with a typical customer, and makes a program named Member and Gold with the partner type in it', async () => {
    const { acmePartnerIds } = (await (await post({ fixture: 'sample', twoTypes: true, referral: true })).json()) as {
      acmePartnerIds: { reseller: string; technology: string; referral: string };
    };
    expect((await post({ fixture: 'caseFacts' })).status).toBe(200);
    expect(await readCompanyFacts(state.deps, anna, { companyId: COMPANY })).toMatchObject({ ok: true, value: { value: { yearly: 24000, once: 4000, renew: 90 } } });

    const { programId } = (await (await post({ fixture: 'caseProgram', partnerId: acmePartnerIds.reseller })).json()) as { programId: string };
    expect(await readProgram(state.deps, anna, { programId })).toMatchObject({ ok: true, value: { value: { type: 'reseller', regName: 'Member', prefName: 'Gold' } } });
    const book = await readPartners(state.deps, anna, { companyId: COMPANY });
    expect(book.ok && book.value.value.partners.find((p) => p.id === acmePartnerIds.reseller)).toMatchObject({ programId, level: 'reg' });

    const flat = (await (await post({ fixture: 'caseProgram', partnerId: acmePartnerIds.referral, flatFee: true })).json()) as { programId: string };
    expect(await readProgram(state.deps, anna, { programId: flat.programId })).toMatchObject({ ok: true, value: { value: { type: 'referral', money: { model: 'fee' } } } });
    expect((await post({ fixture: 'caseProgram' })).status).toBe(400);
    expect((await post({ fixture: 'caseProgram', partnerId: 'p_zzzzzzzzzz' })).status).toBe(404);
  });

  it('makes a case with the SaaS example’s partner side, with the Business Case app’s numbers', async () => {
    const { acmePartnerIds } = (await (await post({ fixture: 'sample', twoTypes: true })).json()) as { acmePartnerIds: { reseller: string } };
    const made = await post({ fixture: 'exampleCase', partnerId: acmePartnerIds.reseller });
    expect(made.status).toBe(200);
    const { caseId } = (await made.json()) as { caseId: string };
    const read = await readCase(state.deps, anna, { caseId });
    if (!read.ok) throw new Error(read.error);
    const result = simulateCase(read.value.value);
    expect(Math.round(result.earnings)).toBe(578608);
    expect(Math.round(result.profit)).toBe(479507);
    expect(read.value.value).toMatchObject({ partnerId: acmePartnerIds.reseller, partner: 'Acme', deals: [3, 7, 11, 15, 19] });
    expect((await post({ fixture: 'exampleCase' })).status).toBe(400);
  });

  it('with oursMarkers, marks every text and some amounts of our case, to look for on the partner’s page', async () => {
    const { acmePartnerIds } = (await (await post({ fixture: 'sample', twoTypes: true })).json()) as { acmePartnerIds: { reseller: string } };
    const made = await post({ fixture: 'exampleCase', partnerId: acmePartnerIds.reseller, oursMarkers: true });
    const { caseId } = (await made.json()) as { caseId: string };
    const read = await readCase(state.deps, anna, { caseId });
    if (!read.ok) throw new Error(read.error);
    const o = read.value.value.ours;
    expect(o).toMatchObject({
      recommendation: 'OURS-MARKER-RECOMMENDATION', ask: 'OURS-MARKER-ASK', preparedBy: 'OURS-MARKER-PREPARED',
      risk: { why: 'OURS-MARKER-RISK', amount: 919191 }, efficiency: { note: 'OURS-MARKER-EFFICIENCY' }, churn: { note: 'OURS-MARKER-CHURN' },
      strategic: [expect.objectContaining({ text: 'OURS-MARKER-REASON' })],
    });
    expect(o.costs.map((x) => x.name)).toContain('OURS-MARKER-COST');
    expect(o.alone.costs.map((x) => x.name)).toContain('OURS-MARKER-ALONE');
    // The partner side is the example's, unchanged.
    expect(Math.round(simulateCase(read.value.value).profit)).toBe(479507);
  });

  it('makes an API key for the test user with its name and level, and turns it off again', async () => {
    const keys = new TursoApiKeys(state.db);
    const made = (await (await post({ fixture: 'apiKey', name: 'n8n e2e', level: 'change' })).json()) as { keyId: string; key: string };
    expect(made.key).toMatch(/^pd_/);
    expect(await keys.verify(made.key)).toEqual({ id: made.keyId, userId: 'u_anna', name: 'n8n e2e', level: 'change' });
    const readOnly = (await (await post({ fixture: 'apiKey', name: 'script' })).json()) as { key: string };
    expect((await keys.verify(readOnly.key))?.level).toBe('read');
    const proposer = (await (await post({ fixture: 'apiKey', name: 'proposer', level: 'propose' })).json()) as { key: string };
    expect((await keys.verify(proposer.key))?.level).toBe('propose');

    expect((await post({ fixture: 'revokeApiKey', keyId: made.keyId })).status).toBe(200);
    expect(await keys.verify(made.key)).toBeNull();
    expect((await post({ fixture: 'revokeApiKey', keyId: made.keyId })).status).toBe(404);
  });

  it('makes no key without a name, nor outside test sign-in, and turns off no other person’s key', async () => {
    const keys = new TursoApiKeys(state.db);
    expect((await post({ fixture: 'apiKey' })).status).toBe(400);
    expect((await post({ fixture: 'apiKey', name: 'n8n', level: 'owner' })).status).toBe(400);
    state.testMode = false;
    expect((await post({ fixture: 'apiKey', name: 'n8n' })).status).toBe(404);
    state.testMode = true;
    expect(await keys.list('u_anna')).toEqual([]);

    const ben = await keys.create({ userId: 'u_ben', name: 'Ben’s', level: 'read' });
    expect((await post({ fixture: 'revokeApiKey', keyId: ben.id })).status).toBe(404);
    expect(await keys.verify(ben.key)).toMatchObject({ userId: 'u_ben' });
  });
});

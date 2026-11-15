import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COPY } from '@partner-desk/copy';
import type { Db } from '../db/client';
import {
  account, apiKeys, businessCases, companies, events, fileWrites, fileLocks, mapEvents, mapLinks, maps, mapSessions, markets, notificationLog,
  oauthClient, oauthConsent, oauthRefreshToken, partnerBooks, proposals, reviewLinks, session, shareLinks, storageFolders, user, webhookDeliveries, webhookMarks,
  webhooks,
} from '../db/schema';
import { createTestDb } from '../db/test-db';
import { TursoAgentGrants } from '../db/turso-agent-grants';
import { TursoApiKeys } from '../db/turso-api-keys';
import { TursoCompanies } from '../db/turso-companies';
import { TursoDirectory } from '../db/turso-directory';
import { TursoEventSink } from '../db/turso-events';
import { TursoFolderStore } from '../db/turso-folders';
import { TursoFileLock } from '../db/turso-lock';
import { TursoMapLinks } from '../db/turso-map-links';
import { TursoMapEvents, TursoNotificationLog } from '../db/turso-notifications';
import { TursoProposals } from '../db/turso-proposals';
import { TursoReviewLinks } from '../db/turso-review-links';
import { TursoShareLinks } from '../db/turso-share-links';
import { TursoUserRecords } from '../db/turso-users';
import { TursoWebhooks } from '../db/turso-webhooks';
import { TursoWriteMarks } from '../db/turso-write-marks';
import { TursoWorkspace } from '../db/turso-workspace';
import { DELETE_FAILED, deleteAccount, type AccountDeps } from './account-service';

const T0 = '2026-10-21T08:00:00.000Z';
const FUTURE = new Date('2026-11-20T00:00:00.000Z');

/**
 * Anna (u_anna) owns the Partner book book-anna and the markets m_1 and the archived m_2. Ben (u_ben) owns book-ben and
 * m_10, whose ids look like Anna's. Each has a row in every table the app writes.
 */
async function seed(): Promise<Db> {
  const db = await createTestDb();
  await db.insert(user).values([
    { id: 'u_anna', name: 'Anna Keller', email: 'anna@example.com' },
    { id: 'u_ben', name: 'Ben Ito', email: 'ben@example.com' },
  ]);
  await db.insert(session).values([
    { id: 's_anna', token: 'tok-anna', userId: 'u_anna', expiresAt: FUTURE },
    { id: 's_ben', token: 'tok-ben', userId: 'u_ben', expiresAt: FUTURE },
  ]);
  await db.insert(account).values([
    { id: 'acc_anna', accountId: 'sub-anna', providerId: 'google', userId: 'u_anna', accessToken: 'enc-a', refreshToken: 'enc-r', scope: 'openid' },
    { id: 'acc_ben', accountId: 'sub-ben', providerId: 'google', userId: 'u_ben', accessToken: 'enc-b', refreshToken: 'enc-rb', scope: 'openid' },
  ]);
  await db.insert(companies).values([
    { id: 'c_anna', ownerUserId: 'u_anna', name: 'Northwind', createdAt: T0 },
    { id: 'c_ben', ownerUserId: 'u_ben', name: 'Acme', createdAt: T0 },
  ]);
  await db.insert(partnerBooks).values([
    { companyId: 'c_anna', ownerUserId: 'u_anna', fileId: 'file-book-anna', createdAt: T0 },
    { companyId: 'c_ben', ownerUserId: 'u_ben', fileId: 'file-book-ben', createdAt: T0 },
  ]);
  const market = (id: string, companyId: string, ownerUserId: string, archivedAt: string | null = null) => ({
    id, companyId, ownerUserId, fileId: `file-${id}`, displayName: 'Austria · Reseller', createdAt: T0, archivedAt,
  });
  await db.insert(markets).values([market('m_1', 'c_anna', 'u_anna'), market('m_2', 'c_anna', 'u_anna', T0), market('m_10', 'c_ben', 'u_ben')]);
  const businessCase = (id: string, companyId: string, ownerUserId: string) => ({
    id, companyId, ownerUserId, fileId: `file-${id}`, partnerId: 'p_1', partnerType: 'reseller', displayName: 'Case of 21 Oct 2026', createdAt: T0,
  });
  await db.insert(businessCases).values([businessCase('case_a', 'c_anna', 'u_anna'), businessCase('case_b', 'c_ben', 'u_ben')]);
  await db.insert(shareLinks).values([
    { id: 'sl_a', ownerUserId: 'u_anna', caseId: 'case_a', tokenHash: 'hash-a', createdAt: T0, revokedAt: null },
    { id: 'sl_a_off', ownerUserId: 'u_anna', caseId: 'case_a', tokenHash: 'hash-a-off', createdAt: T0, revokedAt: T0 },
    { id: 'sl_b', ownerUserId: 'u_ben', caseId: 'case_b', tokenHash: 'hash-b', createdAt: T0, revokedAt: null },
  ]);
  const map = (id: string, companyId: string, ownerUserId: string) => ({
    id, companyId, ownerUserId, fileId: `file-${id}`, partnerId: `p_${id}`, partnerType: 'reseller', displayName: 'Acme as reseller', createdAt: T0,
  });
  await db.insert(maps).values([map('map_a', 'c_anna', 'u_anna'), map('map_b', 'c_ben', 'u_ben')]);
  await db.insert(reviewLinks).values([
    { id: 'rl_a', ownerUserId: 'u_anna', mapId: 'map_a', reviewId: 'rv_1', tokenHash: 'review-a', createdAt: T0, revokedAt: null },
    { id: 'rl_a_off', ownerUserId: 'u_anna', mapId: 'map_a', reviewId: 'rv_1', tokenHash: 'review-a-off', createdAt: T0, revokedAt: T0 },
    { id: 'rl_b', ownerUserId: 'u_ben', mapId: 'map_b', reviewId: 'rv_1', tokenHash: 'review-b', createdAt: T0, revokedAt: null },
  ]);
  const mapLink = (id: string, mapId: string, ownerUserId: string, revokedAt: string | null = null) => ({
    id, mapId, ownerUserId, personId: 'pe_1', side: 'partner' as const, emailHash: `email-${id}`, tokenHash: `hash-${id}`, createdAt: T0, revokedAt,
  });
  await db.insert(mapLinks).values([mapLink('ml_a', 'map_a', 'u_anna'), mapLink('ml_a_off', 'map_a', 'u_anna', T0), mapLink('ml_b', 'map_b', 'u_ben')]);
  await db.insert(mapSessions).values([
    { id: 'ms_a', linkId: 'ml_a', mapId: 'map_a', tokenHash: 'session-a', expiresAt: T0 },
    { id: 'ms_b', linkId: 'ml_b', mapId: 'map_b', tokenHash: 'session-b', expiresAt: T0 },
  ]);
  await db.insert(mapEvents).values([
    { mapId: 'map_a', entityType: 'activity', entityId: 'act_1', action: 'updated', actorRef: 'ml_a', at: T0 },
    { mapId: 'map_b', entityType: 'activity', entityId: 'act_1', action: 'updated', actorRef: 'ml_b', at: T0 },
  ]);
  const logRow = (dedupeKey: string, mapId: string | null) => ({ dedupeKey, type: 'digest', mapId, recipientEmail: 'x@example.com', claimedAt: T0 });
  await db.insert(notificationLog).values([
    logRow('momentum:map_a:on_track:2026-10-21', 'map_a'), logRow('digest:u_anna:2026-10-21', null),
    logRow('momentum:map_b:on_track:2026-10-21', 'map_b'), logRow('digest:u_ben:2026-10-21', null),
  ]);
  await db.insert(storageFolders).values([
    { userId: 'u_anna', folderId: 'folder-anna' },
    { userId: 'u_ben', folderId: 'folder-ben' },
  ]);
  await db.insert(fileLocks).values([
    { key: 'file-m_1', holder: 'h1', expiresAt: 1 },
    { key: 'file-m_10', holder: 'h10', expiresAt: 1 },
  ]);
  await db.insert(fileWrites).values([
    { fileId: 'file-m_1', writtenAt: 1 },
    { fileId: 'file-m_2', writtenAt: 2 },
    { fileId: 'file-book-anna', writtenAt: 3 },
    { fileId: 'file-m_10', writtenAt: 10 },
    { fileId: 'file-case_a', writtenAt: 11 },
  ]);
  const event = (id: string, fileId: string, actorUserId: string) => ({
    id, at: T0, command: 'addPartner', actorKind: 'owner', actorUserId, fileId, entityIds: 'p_1',
  });
  await db.insert(events).values([
    event('e_1', 'file-m_1', 'u_anna'), event('e_2', 'file-book-anna', 'u_anna'), event('e_3', 'file-m_10', 'u_ben'),
    // Ben's event on Anna's case file: only the case's file id finds it.
    event('e_4', 'file-case_a', 'u_ben'),
  ]);
  // Agents: an API key each (Anna's second one turned off), and both allowed Claude, which registered without a session.
  const key = (id: string, userId: string, revokedAt: string | null = null) => ({
    id, userId, name: 'n8n', level: 'read' as const, keyHash: `hash-${id}`, prefix: 'pd_abcde', createdAt: T0, revokedAt,
  });
  await db.insert(apiKeys).values([key('ak_anna', 'u_anna'), key('ak_anna_off', 'u_anna', T0), key('ak_ben', 'u_ben')]);
  await db.insert(oauthClient).values({ id: 'oc_1', clientId: 'c_claude', name: 'Claude', redirectUris: '["http://127.0.0.1:5000/callback"]' });
  await db.insert(oauthConsent).values([
    { id: 'co_anna', clientId: 'c_claude', userId: 'u_anna', scopes: '["pd.read"]' },
    { id: 'co_ben', clientId: 'c_claude', userId: 'u_ben', scopes: '["pd.read"]' },
  ]);
  await db.insert(oauthRefreshToken).values([
    { id: 'rt_anna', token: 'rt-hash-anna', clientId: 'c_claude', userId: 'u_anna', sessionId: 's_anna', scopes: '["pd.read"]' },
    { id: 'rt_ben', token: 'rt-hash-ben', clientId: 'c_claude', userId: 'u_ben', sessionId: 's_ben', scopes: '["pd.read"]' },
  ]);
  // Webhooks: one each, a delivery waiting for each, and a mark each (the same key: marks are per person).
  const hook = (id: string, userId: string) => ({
    id, userId, url: `https://${id}.example.com/in`, events: '["partner.signed"]', secretEnc: 'enc', status: 'active' as const, createdAt: T0,
  });
  await db.insert(webhooks).values([hook('wh_anna', 'u_anna'), hook('wh_ben', 'u_ben')]);
  const delivery = (webhookId: string) => ({ id: 'evt_1', webhookId, type: 'partner.signed', data: '{}', occurredAt: T0, attempts: 0, nextTryAt: 0 });
  await db.insert(webhookDeliveries).values([delivery('wh_anna'), delivery('wh_ben')]);
  await db.insert(webhookMarks).values([{ userId: 'u_anna', key: 'review:rv_1', at: T0 }, { userId: 'u_ben', key: 'review:rv_1', at: T0 }]);
  // Agent proposals: one waiting and one answered for Anna, one for Ben.
  const proposal = (id: string, userId: string, status: 'waiting' | 'accepted' = 'waiting') => ({
    id, userId, kind: 'stage' as const, partnerId: 'p_1', accountId: 'a_1', status, createdAt: T0, answeredAt: status === 'waiting' ? null : T0,
    expiresAt: '2026-11-20T08:00:00.000Z', makerKind: 'app' as const, makerName: 'Claude', clientId: 'c_claude', fileId: `file-book-${userId}`,
  });
  await db.insert(proposals).values([proposal('prp_anna_1', 'u_anna'), proposal('prp_anna_2', 'u_anna', 'accepted'), proposal('prp_ben_1', 'u_ben')]);
  return db;
}

const depsFor = (db: Db, log = vi.fn()): AccountDeps => ({
  apiKeys: new TursoApiKeys(db),
  agentGrants: new TursoAgentGrants(db),
  webhooks: new TursoWebhooks(db, { key: 'test-secret-at-least-32-characters-long', allowPrivate: false }),
  proposals: new TursoProposals(db),
  directory: new TursoDirectory(db),
  shareLinks: new TursoShareLinks(db),
  reviewLinks: new TursoReviewLinks(db),
  mapLinks: new TursoMapLinks(db),
  notifications: new TursoNotificationLog(db),
  mapEvents: new TursoMapEvents(db),
  events: new TursoEventSink(db),
  locks: new TursoFileLock(db),
  writeMarks: new TursoWriteMarks(db),
  companies: new TursoCompanies(db),
  folders: new TursoFolderStore(db),
  users: new TursoUserRecords(db),
  log,
});

async function tables(db: Db) {
  const ids = async <T>(rows: Promise<T[]>, pick: (row: T) => string) => (await rows).map(pick).sort();
  return {
    user: await ids(db.select({ id: user.id }).from(user), (r) => r.id),
    session: await ids(db.select({ id: session.id }).from(session), (r) => r.id),
    account: await ids(db.select({ id: account.id }).from(account), (r) => r.id),
    companies: await ids(db.select({ id: companies.id }).from(companies), (r) => r.id),
    partnerBooks: await ids(db.select({ id: partnerBooks.companyId }).from(partnerBooks), (r) => r.id),
    markets: await ids(db.select({ id: markets.id }).from(markets), (r) => r.id),
    businessCases: await ids(db.select({ id: businessCases.id }).from(businessCases), (r) => r.id),
    shareLinks: await ids(db.select({ id: shareLinks.id }).from(shareLinks), (r) => r.id),
    reviewLinks: await ids(db.select({ id: reviewLinks.id }).from(reviewLinks), (r) => r.id),
    maps: await ids(db.select({ id: maps.id }).from(maps), (r) => r.id),
    mapLinks: await ids(db.select({ id: mapLinks.id }).from(mapLinks), (r) => r.id),
    mapSessions: await ids(db.select({ id: mapSessions.id }).from(mapSessions), (r) => r.id),
    storageFolders: await ids(db.select({ id: storageFolders.userId }).from(storageFolders), (r) => r.id),
    fileLocks: await ids(db.select({ id: fileLocks.key }).from(fileLocks), (r) => r.id),
    fileWrites: await ids(db.select({ id: fileWrites.fileId }).from(fileWrites), (r) => r.id),
    events: await ids(db.select({ id: events.id }).from(events), (r) => r.id),
    mapEvents: await ids(db.select({ id: mapEvents.actorRef }).from(mapEvents), (r) => r.id),
    notificationLog: await ids(db.select({ id: notificationLog.dedupeKey }).from(notificationLog), (r) => r.id),
    apiKeys: await ids(db.select({ id: apiKeys.id }).from(apiKeys), (r) => r.id),
    agentGrants: await ids(db.select({ id: oauthConsent.id }).from(oauthConsent), (r) => r.id),
    refreshTokens: await ids(db.select({ id: oauthRefreshToken.id }).from(oauthRefreshToken), (r) => r.id),
    agentApps: await ids(db.select({ id: oauthClient.clientId }).from(oauthClient), (r) => r.id),
    webhooks: await ids(db.select({ id: webhooks.id }).from(webhooks), (r) => r.id),
    webhookDeliveries: await ids(db.select({ id: webhookDeliveries.webhookId }).from(webhookDeliveries), (r) => r.id),
    webhookMarks: await ids(db.select({ id: webhookMarks.userId }).from(webhookMarks), (r) => r.id),
    proposals: await ids(db.select({ id: proposals.id }).from(proposals), (r) => r.id),
  };
}

const BEN_ONLY = {
  user: ['u_ben'], session: ['s_ben'], account: ['acc_ben'], companies: ['c_ben'], partnerBooks: ['c_ben'], markets: ['m_10'],
  businessCases: ['case_b'], shareLinks: ['sl_b'], reviewLinks: ['rl_b'], maps: ['map_b'], mapLinks: ['ml_b'], mapSessions: ['ms_b'], storageFolders: ['u_ben'], fileLocks: ['file-m_10'], fileWrites: ['file-m_10'], events: ['e_3'],
  mapEvents: ['ml_b'], notificationLog: ['digest:u_ben:2026-10-21', 'momentum:map_b:on_track:2026-10-21'],
  // The agent app stays: Ben still uses it, and nobody signed in registered it.
  apiKeys: ['ak_ben'], agentGrants: ['co_ben'], refreshTokens: ['rt_ben'], agentApps: ['c_claude'],
  webhooks: ['wh_ben'], webhookDeliveries: ['wh_ben'], webhookMarks: ['u_ben'], proposals: ['prp_ben_1'],
};

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchSpy = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchSpy);
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe('deleteAccount', () => {
  it('removes the owner’s rows from every table, archived markets, the Partner book, cases, MAPs and all links (review summary links too) included', async () => {
    const db = await seed();
    expect(await deleteAccount(depsFor(db), 'u_anna')).toEqual({ ok: true });
    expect(await tables(db)).toEqual(BEN_ONLY);
  });

  it('delete account removes keys and grants (before the user, whose links from them don’t cascade), deletes the Google account row as before, and leaves Ben’s rows', async () => {
    const db = await seed();
    expect(await deleteAccount(depsFor(db), 'u_anna')).toEqual({ ok: true });
    const after = await tables(db);
    expect(after.apiKeys).toEqual(['ak_ben']);
    expect(after.agentGrants).toEqual(['co_ben']);
    expect(after.refreshTokens).toEqual(['rt_ben']);
    expect(after.account).toEqual(['acc_ben']);
  });

  it('delete account removes the person’s webhooks, their deliveries and marks, and leaves Ben’s', async () => {
    const db = await seed();
    expect(await deleteAccount(depsFor(db), 'u_anna')).toEqual({ ok: true });
    const after = await tables(db);
    expect(after.webhooks).toEqual(['wh_ben']);
    expect(after.webhookDeliveries).toEqual(['wh_ben']);
    expect(after.webhookMarks).toEqual(['u_ben']);
    expect(after.user).toEqual(['u_ben']);
  });

  it('deleteAccount removes the person’s proposal rows, waiting or answered, and leaves Ben’s', async () => {
    const db = await seed();
    expect(await deleteAccount(depsFor(db), 'u_anna')).toEqual({ ok: true });
    expect((await tables(db)).proposals).toEqual(['prp_ben_1']);
  });

  it('deleteAccount removes events of the user’s files, and only theirs', async () => {
    const db = await seed();
    await deleteAccount(depsFor(db), 'u_anna');
    expect((await tables(db)).events).toEqual(['e_3']);
  });

  it('deleteAccount never calls fetch (no revoke of the shared Google grant)', async () => {
    const db = await seed();
    await deleteAccount(depsFor(db), 'u_anna');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('leaves another owner’s rows untouched, and a second run changes nothing', async () => {
    const db = await seed();
    expect(await deleteAccount(depsFor(db), 'u_ben')).toEqual({ ok: true });
    expect(await deleteAccount(depsFor(db), 'u_ben')).toEqual({ ok: true });
    expect(await tables(db)).toEqual({
      user: ['u_anna'], session: ['s_anna'], account: ['acc_anna'], companies: ['c_anna'], partnerBooks: ['c_anna'],
      markets: ['m_1', 'm_2'], businessCases: ['case_a'], shareLinks: ['sl_a', 'sl_a_off'], reviewLinks: ['rl_a', 'rl_a_off'], maps: ['map_a'], mapLinks: ['ml_a', 'ml_a_off'],
      mapSessions: ['ms_a'], storageFolders: ['u_anna'], fileLocks: ['file-m_1'],
      fileWrites: ['file-book-anna', 'file-case_a', 'file-m_1', 'file-m_2'], events: ['e_1', 'e_2'],
      mapEvents: ['ml_a'], notificationLog: ['digest:u_anna:2026-10-21', 'momentum:map_a:on_track:2026-10-21'],
      apiKeys: ['ak_anna', 'ak_anna_off'], agentGrants: ['co_anna'], refreshTokens: ['rt_anna'], agentApps: ['c_claude'],
      webhooks: ['wh_anna'], webhookDeliveries: ['wh_anna'], webhookMarks: ['u_anna'], proposals: ['prp_anna_1', 'prp_anna_2'],
    });
  });

  it('works for an owner with no files', async () => {
    const db = await seed();
    await db.insert(user).values({ id: 'u_new', name: 'New Owner', email: 'new@example.com' });
    expect(await deleteAccount(depsFor(db), 'u_new')).toEqual({ ok: true });
    const after = await tables(db);
    expect(after.user).toEqual(['u_anna', 'u_ben']);
    expect(after.markets).toEqual(['m_1', 'm_10', 'm_2']);
  });

  it('stops at a failing step, logs the step and the user id only, and a retry finishes the job', async () => {
    const db = await seed();
    const log = vi.fn();
    const deps = depsFor(db, log);
    const companiesStore = new TursoCompanies(db);
    const failing = vi.fn().mockRejectedValueOnce(new Error('DELETE … Northwind anna@example.com')).mockImplementation((id: string) => companiesStore.deleteForUser(id));
    const flaky: AccountDeps = { ...deps, companies: { deleteForUser: failing } };

    expect(await deleteAccount(flaky, 'u_anna')).toEqual({ ok: false, message: DELETE_FAILED });
    expect(log).toHaveBeenCalledWith('account_delete_failed', { step: 'company', userId: 'u_anna' });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/@|Northwind/);
    // The user is still there, so they can sign in again and retry.
    const halfway = await tables(db);
    expect(halfway.user).toEqual(['u_anna', 'u_ben']);
    expect(halfway.companies).toEqual(['c_anna', 'c_ben']);

    expect(await deleteAccount(flaky, 'u_anna')).toEqual({ ok: true });
    expect(await tables(db)).toEqual({ ...BEN_ONLY, fileWrites: ['file-m_10'] });
  });

  it('a failure at the events step leaves the directory rows, and a retry removes everything', async () => {
    const db = await seed();
    const deps = depsFor(db);
    const failing = vi.fn().mockRejectedValueOnce(new Error('down')).mockImplementation((ids: readonly string[]) => deps.events.deleteForFiles(ids));
    const flaky: AccountDeps = { ...deps, events: { deleteForFiles: failing, deleteForActor: (id: string) => deps.events.deleteForActor(id) } };
    expect(await deleteAccount(flaky, 'u_anna')).toEqual({ ok: false, message: DELETE_FAILED });
    const halfway = await tables(db);
    expect(halfway.markets).toEqual(['m_1', 'm_10', 'm_2']);
    expect(halfway.partnerBooks).toEqual(['c_anna', 'c_ben']);
    expect(halfway.events).toEqual(['e_1', 'e_2', 'e_3', 'e_4']);
    expect(await deleteAccount(flaky, 'u_anna')).toEqual({ ok: true });
    expect(await tables(db)).toEqual(BEN_ONLY);
  });

  it('removes events on a superseded Partner book file, which the directory no longer lists', async () => {
    const db = await seed();
    await db.insert(events).values({ id: 'e_old', at: T0, command: 'addPartner', actorKind: 'owner', actorUserId: 'u_anna', fileId: 'file-book-old', entityIds: 'p_1' });
    await deleteAccount(depsFor(db), 'u_anna');
    expect((await tables(db)).events).toEqual(['e_3']);
  });

  it('runs the steps in order: file ids, MAP ids, API keys, agent grants, webhooks, proposals, share links, review links, MAP links, email log, link holders’ changes, events, events by actor, locks, write marks, directory, company, folders, user', async () => {
    const db = await seed();
    const real = depsFor(db);
    const steps: string[] = [];
    const spy = <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) => async (...args: A) => {
      steps.push(name);
      return fn(...args);
    };
    const deps: AccountDeps = {
      apiKeys: { deleteForUser: spy('api_keys', (id: string) => real.apiKeys.deleteForUser(id)) },
      agentGrants: { deleteForUser: spy('agent_grants', (id: string) => real.agentGrants.deleteForUser(id)) },
      webhooks: { deleteForUser: spy('webhooks', (id: string) => real.webhooks.deleteForUser(id)) },
      proposals: { deleteForUser: spy('proposals', (id: string) => real.proposals.deleteForUser(id)) },
      directory: {
        fileIdsForOwner: spy('file_ids', (id: string) => real.directory.fileIdsForOwner(id)),
        mapIdsForOwner: spy('map_ids', (id: string) => real.directory.mapIdsForOwner(id)),
        deleteForOwner: spy('directory', (id: string) => real.directory.deleteForOwner(id)),
      },
      shareLinks: { deleteForOwner: spy('share_links', (id: string) => real.shareLinks.deleteForOwner(id)) },
      reviewLinks: { deleteForOwner: spy('review_links', (id: string) => real.reviewLinks.deleteForOwner(id)) },
      mapLinks: { deleteForOwner: spy('map_links', (id: string) => real.mapLinks.deleteForOwner(id)) },
      notifications: { deleteForOwner: spy('notifications', (id: string, maps: string[]) => real.notifications.deleteForOwner(id, maps)) },
      mapEvents: { deleteForMaps: spy('map_events', (maps: string[]) => real.mapEvents.deleteForMaps(maps)) },
      events: {
        deleteForFiles: spy('events', (ids: readonly string[]) => real.events.deleteForFiles(ids)),
        deleteForActor: spy('events_by_actor', (id: string) => real.events.deleteForActor(id)),
      },
      locks: { deleteForFiles: spy('locks', (ids: readonly string[]) => real.locks.deleteForFiles(ids)) },
      writeMarks: { deleteForFiles: spy('write_marks', (ids: readonly string[]) => real.writeMarks.deleteForFiles(ids)) },
      companies: { deleteForUser: spy('company', (id: string) => real.companies.deleteForUser(id)) },
      folders: { delete: spy('folders', (id: string) => real.folders.delete(id)) },
      users: { deleteUser: spy('user', (id: string) => real.users.deleteUser(id)) },
    };
    await deleteAccount(deps, 'u_anna');
    expect(steps).toEqual(['file_ids', 'map_ids', 'api_keys', 'agent_grants', 'webhooks', 'proposals', 'share_links', 'review_links', 'map_links', 'notifications', 'map_events', 'events', 'events_by_actor', 'locks', 'write_marks', 'directory', 'company', 'folders', 'user']);
  });

  it('asks the user to sign in again before a retry, since deletion signs them out first', () => {
    expect(DELETE_FAILED).toBe('We couldn’t finish deleting your account. Sign in again and retry, or email hello@partnerstandard.com.');
  });
});

describe('deleteAccount on a company server (plan 15)', () => {
  async function team() {
    const db = await createTestDb();
    await db.insert(user).values([
      { id: 'u_anna', name: 'Anna', email: 'anna@halden.example' }, { id: 'u_ben', name: 'Ben', email: 'ben@halden.example' },
    ]);
    const ws = new TursoWorkspace(db);
    await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
    await ws.addMember({ personId: 'u_ben', role: 'admin', addedBy: 'u_anna' });
    await new TursoEventSink(db).record({
      id: 'e_team', at: '2026-11-09T10:00:00.000Z', command: 'partners.change', actorKind: 'owner', actorUserId: 'u_anna', fileId: 'f_book', entityIds: ['p_1'],
    });
    return { db, ws, deps: { ...depsFor(db), workspace: ws } };
  }

  it('the member leaves the workspace and their account goes; who did what on the company’s work stays', async () => {
    const { db, ws, deps } = await team();
    expect(await deleteAccount(deps, 'u_anna', { member: true })).toEqual({ ok: true });
    expect((await ws.members()).map((m) => m.personId)).toEqual(['u_ben']);
    expect((await db.select({ id: user.id }).from(user)).map((r) => r.id)).toEqual(['u_ben']);
    expect((await db.select({ id: events.id, actor: events.actorUserId }).from(events))).toEqual([{ id: 'e_team', actor: 'u_anna' }]);
  });

  it('refuses the last admin: they stay a member with their account, so the company always keeps one', async () => {
    const { db, ws, deps } = await team();
    await ws.setRole('u_anna', 'viewer');
    expect(await deleteAccount(deps, 'u_ben', { member: true })).toEqual({ ok: false, message: COPY.DELETE_ACCOUNT_LAST_ADMIN });
    expect((await ws.members()).map((m) => m.personId)).toEqual(['u_anna', 'u_ben']);
    expect((await db.select({ id: user.id }).from(user)).map((r) => r.id).sort()).toEqual(['u_anna', 'u_ben']);
  });

  it('keeps the membership when a step before it fails, so the person can sign in and retry', async () => {
    const { ws, deps } = await team();
    const failing = { ...deps, apiKeys: { deleteForUser: async () => { throw new Error('down'); } } };
    expect(await deleteAccount(failing, 'u_anna', { member: true })).toEqual({ ok: false, message: COPY.DELETE_ACCOUNT_FAILED_COMPANY });
    expect((await ws.members()).map((m) => m.personId)).toEqual(['u_anna', 'u_ben']);
    expect(await deleteAccount(deps, 'u_anna', { member: true })).toEqual({ ok: true });
  });

  it('sends a company server’s member to their admin when deleting fails, not to PartnerStandard', async () => {
    const { deps } = await team();
    const failing = { ...deps, apiKeys: { deleteForUser: async () => { throw new Error('down'); } } };
    expect(await deleteAccount(failing, 'u_anna', { member: true })).toEqual({ ok: false, message: COPY.DELETE_ACCOUNT_FAILED_COMPANY });
    expect(COPY.DELETE_ACCOUNT_FAILED_COMPANY).not.toContain('@');
  });

  it('fails plainly without the workspace, and keeps the user', async () => {
    const { db } = await team();
    expect(await deleteAccount(depsFor(db), 'u_anna', { member: true })).toEqual({ ok: false, message: COPY.DELETE_ACCOUNT_FAILED_COMPANY });
    expect((await db.select({ id: user.id }).from(user)).map((r) => r.id).sort()).toEqual(['u_anna', 'u_ben']);
  });
});

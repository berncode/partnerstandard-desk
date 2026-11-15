// The server's runtime: globalThis singletons, lazy auth and database, a React-cached session. Google and test sign-in only.
import {
  endMapSession, ownerTimeZone, resolveMapSession, type Actor, type Deps, type EmailPrefs, type MapAccessDeps, type MapLinkMail,
  type RelinkDeps, type ShareDeps,
} from '@partner-desk/commands';
import {
  accountRow, agentOAuthPlugins, buildAuth, pruneExpiredVerifications, checkTarget, createDb, editionFlags, googleTokenProvider, SqliteWorkFiles, postWebhook, serverEnv, TursoAgentGrants, TursoApiKeys, TursoCompanies, TursoDirectory,
  TursoEmailPrefs, TursoEventSink, TursoFileLock, TursoFolderStore, TursoMapEvents, TursoMapLinks, TursoMapSessions, TursoNotificationLog,
  TursoProposals, TursoRateLimiter, TursoReviewLinks, TursoShareLinks, TursoUserRecords, TursoWebhooks, TursoWorkspace, TursoWriteMarks, ownerContact,
  ownerDisplayName, workspaceAccess, type AccountDeps, type Auth, type Db, type MemberOf, type SendSignInLink, type WorkspaceAccess,
} from '@partner-desk/platform';
import {
  createMemoryCaseStore, createMemoryCompanyFactsStore, createMemoryMapStore, createMemoryMarketStore, createMemoryPartnerBookStore,
  createMemoryProgramStore, createReadCache, MemoryFileLock, serializeApplies, type OwnerContext,
} from '@partner-desk/storage';
import { createSheetMetaCache, GoogleClient } from '@partner-desk/storage/google';
import type { BetterAuthPlugin } from 'better-auth';
import { nextCookies } from 'better-auth/next-js';
import { testUtils } from 'better-auth/plugins';
import { cookies, headers } from 'next/headers';
import { redirect, unstable_rethrow } from 'next/navigation';
import { after, connection } from 'next/server';
import { cache } from 'react';
import { buildDeps, storageFor, type StorageKind, type Wiring } from './deps';
import type { EmailActionDeps } from './email-actions';
import { log } from './log';
import { AllowlistMailer, MemoryMailer, ResendMailer, type Mailer } from './mailer';
import { inviteEmail } from './emails/invite';
import { signInConfirmUrl, signInEmail } from './emails/sign-in';
import { mailMapLink, type LinkMailDeps, type MailSender } from './map-link-mail';
import { pauseForAuth, TICK_DEADLINE_MS, type CleanupDeps, type NotifyDeps, type OwnerOf } from './map-notifications';
import { isMapId, mapCookieName, mapLinkUrl } from './map-session';
import type { UnsubscribeDeps } from './unsubscribe';
import { mailReviewSummary, type SummaryMailDeps, type SummarySend } from './review-summary-mail';
import { buildShareDeps, shareLinkUrl, summaryLinkUrl } from './share-deps';
import { AFTER_DEADLINE_MS, deliverDue, REQUEST_TIMEOUT_MS, type DeliveryDeps } from './webhook-delivery';
import { createUpdateCheck, DEFAULT_RELEASE_REPO, updateCheckOn, type UpdateStatus } from './update-check';
import { onVercel } from '@partner-desk/platform/env';

interface Shared extends Wiring {
  auth: Auth;
  /** Test sign-in only: the MAP emails, kept in this process instead of sent (e2e reads them). */
  outbox: MemoryMailer;
}

// globalThis keeps one set across dev hot reloads.
const memo = globalThis as unknown as { __partnerDeskShared?: Shared };

/**
 * Better Auth's plugins: testUtils first and only in test sign-in mode; then the agents' sign-in (jwt and the OAuth
 * provider, on an https or local `appUrl` only); nextCookies always, and last.
 */
export function authPlugins(testMode: boolean, appUrl: string): BetterAuthPlugin[] {
  return [...(testMode ? [testUtils()] : []), ...agentOAuthPlugins(appUrl), nextCookies()];
}

function shared(): Shared {
  if (!memo.__partnerDeskShared) {
    const env = serverEnv();
    const db = createDb(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN);
    const auth = buildAuth({ db, env, plugins: authPlugins(env.PD_TEST_AUTH, env.APP_URL), sendSignInLink: (link) => sendSignInLink(env.APP_URL, link) });
    const lock = new MemoryFileLock();
    memo.__partnerDeskShared = {
      db,
      auth,
      appUrl: env.APP_URL,
      googleClient: (userId) => new GoogleClient({ getAccessToken: googleTokenProvider({ auth, db, userId }) }),
      cache: createReadCache({ ttlMs: 60_000, clock: Date.now }),
      metaCache: createSheetMetaCache({ ttlMs: 600_000, clock: Date.now }),
      // Test users' files, in this process, shared by every test session so e2e state lasts across requests.
      memory: {
        partnerBooks: serializeApplies(createMemoryPartnerBookStore(), lock),
        markets: serializeApplies(createMemoryMarketStore(), lock),
        programs: serializeApplies(createMemoryProgramStore(), lock),
        companyFacts: serializeApplies(createMemoryCompanyFactsStore(), lock),
        cases: serializeApplies(createMemoryCaseStore(), lock),
        maps: serializeApplies(createMemoryMapStore(), lock),
      },
      // The database edition's files; hosted, nothing reaches this table (plan 13).
      workFiles: new SqliteWorkFiles(db),
      localLock: new MemoryFileLock(),
      outbox: new MemoryMailer(),
      log,
      webhooks: {
        key: env.BETTER_AUTH_SECRET, allowPrivate: env.WEBHOOKS_ALLOW_PRIVATE,
        // Right after the command when the function has time (spec 7.4); what is left, the scheduled job sends.
        afterEnqueue: (userId) => after(() => deliverDue(deliveryDeps(), new Date(), { deadlineMs: AFTER_DEADLINE_MS, userId })
          .then(() => {}, () => { log('webhook_delivery_run_failed', { userId }); })),
      },
    };
  }
  return memo.__partnerDeskShared;
}

export const getDb = (): Db => shared().db;
export const getAuth = (): Auth => shared().auth;

export interface OwnerSession {
  /** `userId`: the workspace's key, whose work this person reaches (on hosted, the person's own id). */
  owner: OwnerContext;
  email: string;
  storage: StorageKind;
  /** The signed-in person's own id: their keys, agents, webhooks and email settings key on it (plan 15). */
  personId: string;
  /** A company server's member: their role. Null on hosted and for test users, who own a workspace of one. */
  member: MemberOf | null;
}

/**
 * The signed-in person, or null. The only place the app works out who that is. Read once per request with React
 * cache: the page and its children share one session lookup. Sign-in and sign-out happen in route handlers or client
 * calls, never later in the same request, so the cached value can't go stale.
 *
 * Request time only. `connection()` waits for a real request: in a build prerender and in a prefetch (the
 * per-session App Shell that Partial Prefetching renders with the request's headers) it never resolves, so the
 * database is never asked there. Before it, a prefetch did read the session, Next.js stopped the prerender, and
 * libSQL's fetch failed under Better Auth.
 *
 * A failed read throws a plain error (`session_read_failed`, `google_account_read_failed`): the driver's error
 * carries the query's parameters, a session token or a user id, and Next.js logs what a page throws.
 */
export const currentOwner = cache(async (): Promise<OwnerSession | null> => {
  await connection();
  const requestHeaders = await headers();
  let session: Awaited<ReturnType<Auth['api']['getSession']>>;
  try {
    session = await getAuth().api.getSession({ headers: requestHeaders });
  } catch (error) {
    // Defensive: getSession turns what it catches into an APIError, so no Next.js error is expected here.
    unstable_rethrow(error);
    shared().log('session_read_failed', {});
    throw new Error('session_read_failed');
  }
  if (!session) return null;
  const { user } = session;
  // A company server's person who is no member (removed, never invited) reaches nothing: signed out (plan 15).
  const access = await accessFor(user);
  if (access.kind === 'none') return null;
  let google: Awaited<ReturnType<typeof accountRow>>;
  try {
    google = await accountRow(getDb(), user.id);
  } catch (error) {
    unstable_rethrow(error);
    throw new Error('google_account_read_failed');
  }
  return {
    owner: { userId: access.userId, displayName: user.name || user.email },
    email: user.email,
    storage: storageFor({ hasGoogleAccount: google !== null, testMode: serverEnv().PD_TEST_AUTH, edition: editionFlags(serverEnv()).edition }),
    personId: user.id,
    member: access.kind === 'member' ? access.member : null,
  };
});

/** Whose work the person reaches (`workspaceAccess`): read failures throw a plain error, never the driver's. */
export async function accessFor(person: { id: string; email: string }): Promise<WorkspaceAccess> {
  const env = serverEnv();
  const flags = editionFlags(env);
  try {
    return await workspaceAccess(workspace(), person, { edition: flags.edition, adminEmail: flags.adminEmail, testMode: env.PD_TEST_AUTH });
  } catch (error) {
    unstable_rethrow(error);
    shared().log('workspace_read_failed', {});
    throw new Error('workspace_read_failed');
  }
}

/** The person as the commands see them: an owner, and every write carries their name. */
export function actorFor(session: OwnerSession): Actor {
  return {
    kind: 'owner', userId: session.owner.userId, displayName: session.owner.displayName,
    ...(session.member ? { member: { personId: session.member.personId, role: session.member.role } } : {}),
  };
}

/** The commands' dependencies for this person: Google stores for a Google account, memory for a test user. */
export function depsFor(session: OwnerSession): Deps {
  return buildDeps(shared(), { userId: session.owner.userId, storage: session.storage, team: session.member !== null });
}

/**
 * The commands' dependencies for the person an agent or an API key acts for, chosen as `depsFor` chooses: Google
 * stores for a Google account, memory for a test user in test sign-in mode.
 */
export async function agentDepsFor(userId: string): Promise<Deps> {
  const storage = storageFor({ hasGoogleAccount: (await accountRow(getDb(), userId)) !== null, testMode: serverEnv().PD_TEST_AUTH, edition: editionFlags(serverEnv()).edition });
  return buildDeps(shared(), { userId, storage });
}

/** What sending webhook deliveries needs: the queue, the address check, and the sender (the scheduled job uses it too). */
export function deliveryDeps(): DeliveryDeps {
  const { db, log: record } = shared();
  const env = serverEnv();
  return {
    store: new TursoWebhooks(db, { key: env.BETTER_AUTH_SECRET, allowPrivate: env.WEBHOOKS_ALLOW_PRIVATE }),
    send: (url, request) => postWebhook(url, { ...request, timeoutMs: REQUEST_TIMEOUT_MS, allowPrivate: env.WEBHOOKS_ALLOW_PRIVATE }),
    checkTarget: (url) => checkTarget(url, { allowPrivate: env.WEBHOOKS_ALLOW_PRIVATE }),
    clock: Date.now,
    log: record,
  };
}

/** API keys (Settings, `resolveAgent`). */
export const apiKeys = (): TursoApiKeys => new TursoApiKeys(shared().db);

/** What people allowed agent apps on the allow page (Settings, `resolveAgent`). */
export const agentGrants = (): TursoAgentGrants => new TursoAgentGrants(shared().db);

/**
 * The signed-in person's own company, made on first use. Every command gets its company id from here and only from
 * here, never from a form, a URL or a request body: that is what keeps one person out of another's company.
 */
export function companyFor(session: OwnerSession): Promise<{ companyId: string; name: string }> {
  return new TursoCompanies(getDb()).forUser(session.owner.userId);
}

/** The partner's page's dependencies: no session, the owner's case read straight from the file (share-deps.ts). */
export function shareDeps(): ShareDeps {
  return buildShareDeps(shared(), { testMode: serverEnv().PD_TEST_AUTH, edition: editionFlags(serverEnv()).edition });
}

/** The address of a share link with `token`, on APP_URL. */
export function shareUrl(token: string): string {
  return shareLinkUrl(serverEnv().APP_URL, token);
}

/** What Delete account touches: our own records only. Nothing here reaches Google. */
export function accountDeps(): AccountDeps {
  const { db, log: record } = shared();
  return {
    apiKeys: new TursoApiKeys(db),
    agentGrants: new TursoAgentGrants(db),
    webhooks: new TursoWebhooks(db, { key: serverEnv().BETTER_AUTH_SECRET, allowPrivate: serverEnv().WEBHOOKS_ALLOW_PRIVATE }),
    proposals: new TursoProposals(db),
    directory: new TursoDirectory(db),
    shareLinks: new TursoShareLinks(db),
    reviewLinks: new TursoReviewLinks(db),
    mapLinks: new TursoMapLinks(db),
    notifications: new TursoNotificationLog(db),
    mapEvents: new TursoMapEvents(db),
    events: new TursoEventSink(db, record),
    locks: new TursoFileLock(db),
    writeMarks: new TursoWriteMarks(db),
    companies: new TursoCompanies(db),
    folders: new TursoFolderStore(db),
    users: new TursoUserRecords(db),
    workspace: new TursoWorkspace(db),
    log: record,
  };
}

/** A company server's workspace, its members and invites (plan 15). Hosted never writes it. */
export const workspace = (): TursoWorkspace => new TursoWorkspace(shared().db);

/** The signed-in person and their dependencies, or a redirect to /sign-in?next=… when signed out. */
export async function requireOwner(next: string): Promise<{ session: OwnerSession; deps: Deps }> {
  const session = await currentOwner();
  if (!session) redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  return { session, deps: depsFor(session) };
}

export const googleSignInEnabled = (): boolean => Boolean(serverEnv().GOOGLE_CLIENT_ID && serverEnv().GOOGLE_CLIENT_SECRET);

// ---------------------------------------------------------------------------------------------------------------------
// A person with a link to a MAP (spec 4): no account, a session cookie per MAP.

/** What opening a MAP link and finding a link holder's session need: our tables only, never the owner's files. */
export function mapAccessDeps(): MapAccessDeps {
  const { db, log: record } = shared();
  return {
    directory: new TursoDirectory(db), mapLinks: new TursoMapLinks(db), mapSessions: new TursoMapSessions(db),
    clock: () => new Date().toISOString(), log: record,
  };
}

/** "Send me a new link": rate limited; without email set up it sends nothing and says so. */
export function relinkDeps(): RelinkDeps {
  const mail: MapLinkMail | null = mailer() ? { sendLink: async (to, token) => { await mailMapLink(linkMailDeps(), to, token); } } : null;
  return { ...mapAccessDeps(), rateLimits: new TursoRateLimiter(shared().db), mail, defer: (work) => after(work) };
}

/** The address of a MAP link with `token`, on APP_URL. */
export function mapLinkFor(token: string): string {
  return mapLinkUrl(serverEnv().APP_URL, token);
}

/** The app's public address: where a MAP link's cookie is Secure (https). */
export const appUrl = (): string => serverEnv().APP_URL;

export type CurrentLinkHolder =
  | {
    kind: 'active';
    actor: Extract<Actor, { kind: 'link' }>;
    /** The commands' dependencies for the MAP's owner, whose files the link reaches. */
    deps: Deps;
    /** The owner's name, and their company's (empty until Settings names it): who shared the MAP, and our side's name. */
    ownerName: string;
    ourName: string;
    /** The cookie's session token, to end the session with (Sign out, a MAP that is gone). */
    sessionToken: string;
  }
  | { kind: 'expired'; mapId: string }
  | { kind: 'revoked' }
  | { kind: 'none' };

/**
 * The person behind this request's link cookie for `mapId`, checked on every request through the commands
 * (`resolveMapSession`): revoking, deleting the MAP or removing its partner type ends the session at once. Read once
 * per request with React cache. An owner whose account is gone has no files to reach: the session ends.
 */
export const currentLinkHolder = cache(async (mapId: string): Promise<CurrentLinkHolder> => {
  await connection();
  if (!isMapId(mapId)) return { kind: 'none' };
  const sessionToken = (await cookies()).get(mapCookieName(mapId))?.value;
  if (!sessionToken) return { kind: 'none' };
  const access = mapAccessDeps();
  const resolved = await resolveMapSession(access, sessionToken, mapId);
  if (resolved.kind !== 'active') return resolved;
  const { db } = shared();
  const ownerUserId = resolved.actor.userId;
  const ownerName = await ownerDisplayName(db, ownerUserId);
  if (ownerName === null) {
    await endMapSession(access, sessionToken, mapId);
    return { kind: 'none' };
  }
  const storage = storageFor({ hasGoogleAccount: (await accountRow(db, ownerUserId)) !== null, testMode: serverEnv().PD_TEST_AUTH, edition: editionFlags(serverEnv()).edition });
  return {
    kind: 'active',
    actor: resolved.actor,
    deps: buildDeps(shared(), { userId: ownerUserId, storage }),
    ownerName,
    ourName: (await new TursoCompanies(db).nameOf(ownerUserId)) ?? '',
    sessionToken,
  };
});

// ---------------------------------------------------------------------------------------------------------------------
// MAP emails (task 8)

/**
 * The mailer: test sign-in keeps every email in this process (e2e reads them); otherwise Resend once RESEND_API_KEY and
 * EMAIL_FROM are set, else none, and nothing is sent. With EMAIL_ALLOWLIST (staging) every other recipient is dropped.
 */
export function mailer(): Mailer | null {
  const env = serverEnv();
  const base: Mailer | null = env.PD_TEST_AUTH
    ? shared().outbox
    : env.RESEND_API_KEY && env.EMAIL_FROM ? new ResendMailer({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM }) : null;
  if (!base) return null;
  return env.EMAIL_ALLOWLIST ? new AllowlistMailer(base, env.EMAIL_ALLOWLIST, shared().log) : base;
}

/** Whether emails go out: Send link and a new link by email need it. */
export const mailConfigured = (): boolean => mailer() !== null;

/** Test sign-in only: the emails kept instead of sent. */
export const testOutbox = (): MemoryMailer => shared().outbox;

/**
 * A company server's sign-in email (plan 14): sent through the app's mailer, or nowhere without mail settings (the
 * sign-in page says so). Logged without the address or the token.
 */
async function sendSignInLink(appUrl: string, { email, token, next, invitedBy }: Parameters<SendSignInLink>[0]): Promise<void> {
  const send = mailer();
  if (!send) return;
  const url = signInConfirmUrl(appUrl, token, next);
  // An invited address's first link is its invite (plan 15).
  const mail = invitedBy !== undefined ? await inviteEmail({ inviterName: invitedBy, url }) : await signInEmail({ url });
  const sent = await send.send({ to: email, ...mail });
  if (!sent.ok) log('sign_in_mail_failed', {});
}

/** A MAP's owner: their name and address for the emails, and the commands' dependencies reaching their files. */
const ownerFor: OwnerOf = async (ownerUserId) => {
  const { db } = shared();
  const contact = await ownerContact(db, ownerUserId);
  if (!contact) return null;
  const storage = storageFor({ hasGoogleAccount: (await accountRow(db, ownerUserId)) !== null, testMode: serverEnv().PD_TEST_AUTH, edition: editionFlags(serverEnv()).edition });
  return { contact: { userId: ownerUserId, ...contact }, deps: buildDeps(shared(), { userId: ownerUserId, storage }) };
};

function linkMailDeps(): LinkMailDeps {
  const { db, log: record } = shared();
  return { mailer: mailer(), owner: ownerFor, ourName: (id) => new TursoCompanies(db).nameOf(id), linkUrl: mapLinkFor, log: record };
}

/** Emails one person of the owner's MAP their new link (Share's Send link). True once sent. */
export function sendMapLink(to: Parameters<typeof mailMapLink>[1], token: string, sender?: MailSender): Promise<boolean> {
  return mailMapLink(linkMailDeps(), to, token, sender);
}

/** The address of a review's summary link with `token`, on APP_URL (reviews spec 5.6). */
export function summaryLinkFor(token: string): string {
  return summaryLinkUrl(serverEnv().APP_URL, token);
}

function summaryMailDeps(): SummaryMailDeps {
  const { db, log: record } = shared();
  return { mailer: mailer(), owner: ownerFor, ourName: (id) => new TursoCompanies(db).nameOf(id), summaryUrl: summaryLinkFor, log: record };
}

/**
 * Emails the partner-side people of one Send summary the review's summary link, the MAP read once: `shareSummary`'s mail.
 * Answers the ids of the people it went out to.
 */
export function sendReviewSummary(send: SummarySend, token: string, sender?: MailSender): Promise<string[]> {
  return mailReviewSummary(summaryMailDeps(), send, token, sender);
}

/** The scheduled job's dependencies: our tables, the mailer, and each owner's files through the commands. */
export function notifyDeps(): NotifyDeps {
  const { db, log: record } = shared();
  const env = serverEnv();
  const companies = new TursoCompanies(db);
  return {
    directory: new TursoDirectory(db), dedupe: new TursoNotificationLog(db), prefs: new TursoEmailPrefs(db), mapEvents: new TursoMapEvents(db),
    links: new TursoMapLinks(db), timeZoneOf: (id) => ownerTimeZone({ companies, log: record }, id), mailer: mailer(), owner: ownerFor,
    // The job's own queue, without the commands' `after` send: the job sends what is due itself, last.
    webhooks: new TursoWebhooks(db, { key: env.BETTER_AUTH_SECRET, allowPrivate: env.WEBHOOKS_ALLOW_PRIVATE }),
    deliverWebhooks: (now, deadlineMs) => deliverDue(deliveryDeps(), now, { deadlineMs }),
    appUrl: env.APP_URL, secret: env.BETTER_AUTH_SECRET, clock: Date.now, deadlineMs: TICK_DEADLINE_MS, log: record,
  };
}

/** The hourly housekeeping after the job. */
export function cleanupDeps(): CleanupDeps {
  const { db, log: record } = shared();
  return {
    sessions: new TursoMapSessions(db), rateLimits: new TursoRateLimiter(db), dedupe: new TursoNotificationLog(db), mapEvents: new TursoMapEvents(db),
    webhooks: new TursoWebhooks(db, { key: serverEnv().BETTER_AUTH_SECRET, allowPrivate: serverEnv().WEBHOOKS_ALLOW_PRIVATE }),
    proposals: new TursoProposals(db),
    // Only a company server has sign-in links; hosted's verification rows stay as they are (plan 14, task 4's review).
    verifications: { pruneExpired: async (now) => (editionFlags(serverEnv()).signIn === 'email' ? pruneExpiredVerifications(db, now) : 0) },
    invites: { pruneExpired: async (now) => (editionFlags(serverEnv()).edition === 'self-hosted' ? new TursoWorkspace(db, () => now).pruneExpiredInvites() : 0) },
    log: record,
  };
}

/** An email's buttons: the MAP read and changed as the person, through the commands. */
export function emailActionDeps(): EmailActionDeps {
  const { db, log: record } = shared();
  return {
    secret: serverEnv().BETTER_AUTH_SECRET, directory: new TursoDirectory(db), mapLinks: new TursoMapLinks(db),
    ownerDeps: async (id) => (await ownerFor(id))?.deps ?? null, limiter: new TursoRateLimiter(db), now: Date.now, log: record,
    // After the answer: the owner's Reconnect email never holds up the person's page.
    pause: async (mapId) => { after(() => pauseForAuth(notifyDeps(), mapId, new Date())); },
  };
}

/** A link holder's save met the owner's broken Google access: pause the MAP and tell the owner, after the answer. */
export function pauseMapForAuth(mapId: string): void {
  after(() => pauseForAuth(notifyDeps(), mapId, new Date()));
}

/** The email preferences, by the address's hash. */
export const emailPrefs = (): EmailPrefs => new TursoEmailPrefs(shared().db);

export function unsubscribeDeps(): UnsubscribeDeps {
  return { secret: serverEnv().BETTER_AUTH_SECRET, prefs: emailPrefs(), now: () => new Date().toISOString() };
}

// One update check per process, its answer kept for a day (plan 17, task 5).
const updates = globalThis as unknown as { __partnerDeskUpdates?: { status: () => Promise<UpdateStatus | null> } | null };

/**
 * The version this company server runs and a newer release, for Settings; null on hosted, with UPDATE_CHECK=off, or
 * in a build that isn't a release (no APP_VERSION). Never throws: Settings shows without it.
 */
export async function updateStatus(): Promise<UpdateStatus | null> {
  const env = serverEnv();
  if (!updateCheckOn({ edition: editionFlags(env).edition, setting: env.UPDATE_CHECK, onVercel: onVercel() })) return null;
  if (updates.__partnerDeskUpdates === undefined) {
    updates.__partnerDeskUpdates = createUpdateCheck({ current: env.APP_VERSION ?? null, repo: env.APP_REPO ?? DEFAULT_RELEASE_REPO, log });
  }
  return updates.__partnerDeskUpdates ? updates.__partnerDeskUpdates.status().catch(() => null) : null;
}

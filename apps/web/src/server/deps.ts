import type { Deps, WebhookStore } from '@partner-desk/commands';
import { randomSuffix } from '@partner-desk/core';
import { copyFor } from '@partner-desk/copy';
import {
  SqliteTrash, TursoCompanies, TursoDirectory, TursoEventSink, TursoTeam, TursoFileLock, TursoFolderStore, TursoMapEvents, TursoMapLinks, TursoMapSessions,
  TursoProposals, TursoRateLimiter, TursoReviewLinks, TursoShareLinks, TursoWebhooks, TursoWriteMarks, type Db, type EditionFlags,
} from '@partner-desk/platform';
import {
  cacheReads, createDatabaseCaseStore, createDatabaseCompanyFactsStore, createDatabaseMapStore, createDatabaseMarketStore,
  createDatabasePartnerBookStore, createDatabaseProgramStore, exportWorkFile, serializeApplies, type CaseStore, type CompanyFactsStore, type FileLock,
  type MapStore, type MarketStore, type PartnerBookStore, type ProgramStore, type ReadCache, type WorkFiles,
} from '@partner-desk/storage';
import {
  createGoogleCaseStore, createGoogleCompanyFactsStore, createGoogleMapStore, createGoogleMarketStore, createGooglePartnerBookStore,
  createGoogleProgramStore, type GoogleClient, type SheetMetaCache,
} from '@partner-desk/storage/google';
import type { Log } from './log';

export type { StorageKind } from '../storage-kind';
import type { StorageKind } from '../storage-kind';

/**
 * Self-hosted, everyone's files are in this server's database, test users' too (plan 13). Hosted, test users have no
 * Google account and keep their files in memory; outside test mode such a user still gets Google, whose token provider
 * then asks them to reconnect: memory is never used for a real person. Google is the only hosted provider.
 */
export function storageFor({ hasGoogleAccount, testMode, edition }: {
  hasGoogleAccount: boolean; testMode: boolean; edition: EditionFlags['edition'];
}): StorageKind {
  if (edition === 'self-hosted') return 'database';
  if (hasGoogleAccount) return 'google';
  return testMode ? 'memory' : 'google';
}

/** What the server holds once per process. runtime.ts makes it; tests pass their own. */
export interface Wiring {
  db: Db;
  /** The app's public origin, for the link on each workbook's Start here tab. */
  appUrl: string;
  /** A Google client acting for this user, with their access token. */
  googleClient(userId: string): GoogleClient;
  /** Snapshots of files, 60 seconds, per process. Memory only: never written anywhere. */
  cache: ReadCache;
  /** Google tab ids per file. Layout only, never content. */
  metaCache: SheetMetaCache;
  /** Test sign-in only, hosted: every test user's files, one set per server process. */
  memory: Stores;
  /** The database edition's files (`work_files`). Hosted, no store ever reaches it. */
  workFiles: WorkFiles;
  /** One lock for the process: saves to one database file go one at a time (one app instance while on SQLite). */
  localLock: FileLock;
  log: Log;
  webhooks: WebhookWiring;
}

/** What the webhook tables need, and what runs once an event is queued. */
export interface WebhookWiring {
  /** Encrypts the signing secrets: BETTER_AUTH_SECRET, as for the Google tokens. */
  key: string;
  /** WEBHOOKS_ALLOW_PRIVATE (self-hosted only). */
  allowPrivate: boolean;
  /** Sends the person's due deliveries once the answer is out (runtime: `after`). Absent: the scheduled job sends them. */
  afterEnqueue?: (userId: string) => void;
}

/** The file stores the commands use. */
export interface Stores {
  partnerBooks: PartnerBookStore;
  markets: MarketStore;
  programs: ProgramStore;
  companyFacts: CompanyFactsStore;
  cases: CaseStore;
  maps: MapStore;
}

/**
 * The one place a person's file stores are chosen: as they are, with no lock and no cache. The partner's pages read
 * through these straight from the file (share-deps.ts); everything else goes through `storesFor`.
 */
export function fileStoresFor(wiring: Wiring, userId: string, storage: StorageKind): Stores {
  if (storage === 'memory') return wiring.memory;
  if (storage === 'database') {
    const options = { files: wiring.workFiles, appBaseUrl: wiring.appUrl };
    return {
      partnerBooks: createDatabasePartnerBookStore(options), markets: createDatabaseMarketStore(options),
      programs: createDatabaseProgramStore(options), companyFacts: createDatabaseCompanyFactsStore(options),
      cases: createDatabaseCaseStore(options), maps: createDatabaseMapStore(options),
    };
  }
  if (storage !== 'google') {
    // Exhaustive: a storage kind added later must not silently get Google.
    const unknown: never = storage;
    throw new Error(`No stores for ${String(unknown)}`);
  }
  const options = {
    client: wiring.googleClient(userId), folders: new TursoFolderStore(wiring.db), appBaseUrl: wiring.appUrl, metaCache: wiring.metaCache,
  };
  return {
    partnerBooks: createGooglePartnerBookStore(options), markets: createGoogleMarketStore(options),
    programs: createGoogleProgramStore(options), companyFacts: createGoogleCompanyFactsStore(options),
    cases: createGoogleCaseStore(options), maps: createGoogleMapStore(options),
  };
}

function storesFor(wiring: Wiring, userId: string, storage: StorageKind): Stores {
  if (storage === 'memory') return wiring.memory;
  const raw = fileStoresFor(wiring, userId, storage);
  if (storage === 'database') {
    // One app instance: the process's lock puts saves to one file in a queue, and the revision check catches anything
    // else. A read is one local row: no read cache, no write marks.
    const lock = wiring.localLock;
    return {
      partnerBooks: serializeApplies(raw.partnerBooks, lock), markets: serializeApplies(raw.markets, lock),
      programs: serializeApplies(raw.programs, lock), companyFacts: serializeApplies(raw.companyFacts, lock),
      cases: serializeApplies(raw.cases, lock), maps: serializeApplies(raw.maps, lock),
    };
  }
  const { db, cache } = wiring;
  // The lock serializes saves to one file across serverless instances. Write marks live in Turso so every instance
  // sees a save; the cache is kept per person (keyPrefix), so nobody is served a copy another person's read cached.
  const lock = new TursoFileLock(db);
  const marks = new TursoWriteMarks(db);
  return {
    partnerBooks: cacheReads(serializeApplies(raw.partnerBooks, lock), cache, marks, { keyPrefix: userId }),
    markets: cacheReads(serializeApplies(raw.markets, lock), cache, marks, { keyPrefix: userId }),
    programs: cacheReads(serializeApplies(raw.programs, lock), cache, marks, { keyPrefix: userId }),
    companyFacts: cacheReads(serializeApplies(raw.companyFacts, lock), cache, marks, { keyPrefix: userId }),
    cases: cacheReads(serializeApplies(raw.cases, lock), cache, marks, { keyPrefix: userId }),
    maps: cacheReads(serializeApplies(raw.maps, lock), cache, marks, { keyPrefix: userId }),
  };
}

/**
 * The webhook tables for the commands. Once an event, a test or a Send again is queued, `afterEnqueue` sends the
 * person's due deliveries after the answer; if it can't be scheduled, the scheduled job sends them later. Never fails
 * the command.
 */
export function webhookStore(wiring: Wiring): WebhookStore {
  const store = new TursoWebhooks(wiring.db, { key: wiring.webhooks.key, allowPrivate: wiring.webhooks.allowPrivate });
  const { afterEnqueue } = wiring.webhooks;
  const sendSoon = (userId: string) => {
    if (!afterEnqueue) return;
    try {
      afterEnqueue(userId);
    } catch {
      wiring.log('webhook_send_soon_failed', { userId });
    }
  };
  return {
    list: (userId) => store.list(userId),
    subscriptions: (userId) => store.subscriptions(userId),
    create: (row) => store.create(row),
    remove: (userId, id) => store.remove(userId, id),
    setStatus: (userId, id, status) => store.setStatus(userId, id, status),
    recentDeliveries: (userId, id, limit) => store.recentDeliveries(userId, id, limit),
    checkTarget: (url) => store.checkTarget(url),
    async enqueue(userId, type, data, markKey, only) {
      await store.enqueue(userId, type, data, markKey, only);
      sendSoon(userId);
    },
    async resend(userId, webhookId, deliveryId) {
      const outcome = await store.resend(userId, webhookId, deliveryId);
      if (outcome === 'queued') sendSoon(userId);
      return outcome;
    },
    async sendTest(userId, id) {
      const eventId = await store.sendTest(userId, id);
      if (eventId !== null) sendSoon(userId);
      return eventId;
    },
  };
}

/** The commands' dependencies for one signed-in person. */
export function buildDeps(wiring: Wiring, { userId, storage, team = false }: {
  userId: string; storage: StorageKind;
  /** A company server's member (plan 15): the member and invite commands reach the team. */
  team?: boolean;
}): Deps {
  // The database edition's files as spreadsheets, for their download; hosted, Drive has the files (plan 13, task 12).
  // Its cases and MAPs always go to the trash, and its commands answer in the company server's words.
  const exports = storage === 'database'
    ? {
      fileExports: { export: (fileId: string) => exportWorkFile(wiring.workFiles, fileId) }, alwaysTrash: true, words: copyFor('database'),
      // Its trash, for an admin to restore from (plan 16).
      trash: new SqliteTrash(wiring.db),
    }
    : {};
  return {
    ...exports,
    ...storesFor(wiring, userId, storage),
    directory: new TursoDirectory(wiring.db),
    shareLinks: new TursoShareLinks(wiring.db),
    reviewLinks: new TursoReviewLinks(wiring.db),
    mapLinks: new TursoMapLinks(wiring.db),
    mapSessions: new TursoMapSessions(wiring.db),
    mapEvents: new TursoMapEvents(wiring.db),
    rateLimits: new TursoRateLimiter(wiring.db),
    companies: new TursoCompanies(wiring.db),
    // A failed event insert is logged with the event's id only.
    events: new TursoEventSink(wiring.db, wiring.log),
    webhooks: webhookStore(wiring),
    proposals: new TursoProposals(wiring.db),
    clock: () => new Date().toISOString(),
    log: wiring.log,
    ids: { event: () => `ev_${randomSuffix(16)}` },
    ...(team ? { team: new TursoTeam(wiring.db, { key: wiring.webhooks.key, allowPrivate: wiring.webhooks.allowPrivate }) } : {}),
  };
}

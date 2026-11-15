import type { Team } from './team';
import type { Trash } from './trash';
import type { IsoDateTime } from '@partner-desk/core';
import { COPY, type Copy } from '@partner-desk/copy';
import type { CaseStore, CompanyFactsStore, MapStore, MarketStore, PartnerBookStore, ProgramStore, ExportedFile } from '@partner-desk/storage';
import type { CompanyNames } from './companies';
import type { Directory, MapEventLog, MapLinks, MapSessions, RateLimiter, ReviewLinks, ShareLinks } from './directory';
import type { EventSink } from './events';
import type { ProposalIndex } from './proposal-index';
import type { WebhookStore } from './webhooks';

export interface Deps {
  partnerBooks: PartnerBookStore;
  markets: MarketStore;
  programs: ProgramStore;
  companyFacts: CompanyFactsStore;
  cases: CaseStore;
  maps: MapStore;
  directory: Directory;
  shareLinks: ShareLinks;
  /** Held reviews' summary links (reviews spec 5.6): ids and token hashes only. */
  reviewLinks: ReviewLinks;
  mapLinks: MapLinks;
  mapSessions: MapSessions;
  /** What people with a link changed, for the owner's partner alerts (ids and codes only). */
  mapEvents: MapEventLog;
  rateLimits: RateLimiter;
  companies: CompanyNames;
  events: EventSink;
  /** The person's webhooks and their delivery queue (agents spec 7): ids and settings only. */
  webhooks: WebhookStore;
  /** Agents' proposals (agent proposals spec 7.2): ids, codes and times only; the content is in the Partners file. */
  proposals: ProposalIndex;
  clock: () => IsoDateTime;
  /** A server log line for work that failed quietly: an event name and ids, never content. */
  log: (event: string, ids: Record<string, string>) => void;
  ids: { event(): string };
  /** The database edition's files as spreadsheets, for their download (plan 13). Absent on hosted: Drive has the files. */
  fileExports?: FileExports;
  /**
   * The database edition (plan 13): a removed partner type's or an old Partners file's cases and MAPs always go to the
   * trash, never kept where no one would see them (Drive shows a kept file; the database doesn't). Hosted: absent.
   */
  alwaysTrash?: boolean;
  /**
   * The texts a command's answer says, for where the work lives (plan 13, task 12's review): a company server's never
   * speak of Google Drive. Absent: COPY, as hosted says it.
   */
  words?: Copy;
  /** A company server's members and invites (plan 15). Absent on hosted and for a company server's test users. */
  team?: Team;
  /** A company server's trash (plan 16): what was deleted, to restore. Absent on hosted, where Drive has the trash. */
  trash?: Trash;
}

/** The texts this deployment's commands answer with. */
export const wordsOf = (deps: Pick<Deps, 'words'>): Copy => deps.words ?? COPY;

/** A database file's tabs, in its order and named as its Drive file would be; null when there is none. */
export interface FileExports {
  export(fileId: string): Promise<ExportedFile | null | 'unavailable'>;
}

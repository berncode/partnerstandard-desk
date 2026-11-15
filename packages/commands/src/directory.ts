import type { IsoDate, IsoDateTime, ProgramType, Side } from '@partner-desk/core';
import type { PartnerType } from '@partner-desk/method';

/** Thrown by an add when the key is taken: the company already has a book, or the market id exists. */
export class DuplicateEntry extends Error {
  constructor() {
    super('duplicate_entry');
    this.name = 'DuplicateEntry';
  }
}

export interface MarketListing {
  marketId: string;
  displayName: string;
  ownerUserId: string;
  archived: boolean;
}

/** A program's directory row: ids, its label ("Reseller · DACH") and its partner type, which is fixed. */
export interface ProgramEntry {
  fileId: string;
  ownerUserId: string;
  companyId: string;
  displayName: string;
  partnerType: ProgramType;
}

export interface ProgramListing {
  programId: string;
  displayName: string;
  ownerUserId: string;
  partnerType: ProgramType;
}

/**
 * A business case's directory row: ids, the partner type, its title as the display name, and when it was made. The
 * Business cases page is built from these rows alone, so it needs no Drive read per case.
 */
export interface CaseEntry {
  fileId: string;
  ownerUserId: string;
  companyId: string;
  /** The partner type's row id in Partners. */
  partnerId: string;
  partnerType: PartnerType;
  /** The case's title. */
  displayName: string;
  createdAt: IsoDateTime;
}

export type CaseListing = Omit<CaseEntry, 'fileId' | 'companyId'> & { caseId: string };

/**
 * A MAP's directory row (spec 7): ids, the partner type it belongs to (one MAP per partner type), its display name
 * ("Acme as reseller") and when it was made. `startedOn`: the day it was started, the MAP's planned start before signing
 * (ruling R3): the owner's date when it was made (question 20), or null for a MAP made before that was kept, which
 * counts from the UTC date of `createdAt`. Never plan content. `datesMovedFor`: the signing date its open dates were
 * last moved for; `datesMoveFailedFor`: the signing date a move was asked for and failed (spec 5.3, ruling R4).
 */
export interface MapEntry {
  fileId: string;
  ownerUserId: string;
  companyId: string;
  /** The partner type's row id in Partners. */
  partnerId: string;
  partnerType: PartnerType;
  displayName: string;
  createdAt: IsoDateTime;
  startedOn: IsoDate | null;
  datesMovedFor: IsoDate | null;
  datesMoveFailedFor: IsoDate | null;
  /**
   * When the MAP was last changed through PartnerStandard Desk, by anyone (ruling R6), or null when never since it was made.
   * The one "last progress" its health counts from, on every screen, in the partner row's copy and in the refresh.
   */
  lastChangeAt: IsoDateTime | null;
}

export type MapListing = Omit<MapEntry, 'fileId' | 'companyId'> & { mapId: string };

/** A MAP's own email settings (the MAP app's per-plan settings). Each one unset means the MAP app's default. */
export interface MapNotifySettings {
  dueSoonDays?: number;
  partnerDigest?: boolean;
  partnerAlerts?: 'instant' | 'daily' | 'off';
}

/**
 * What the scheduled job keeps per MAP (task 8): its settings, the health last warned about, last reported in a digest
 * and last told to the owner's webhooks, the partner alerts' cursor, and why its emails pause.
 */
export interface MapNotifyState {
  settings: MapNotifySettings;
  momentumState: 'on_track' | 'at_risk' | 'off_track' | null;
  pausedReason: string | null;
  digestHealth: 'on_track' | 'at_risk' | 'off_track' | null;
  /**
   * The health the owner's webhooks last heard of (agents spec 7.2, `health.changed`); null for none yet, for an empty
   * MAP, and while the owner has no webhook for it. Set by `setMapWebhookHealth` only.
   */
  webhookHealth: 'on_track' | 'at_risk' | 'off_track' | null;
  /** Changes by link holders up to this `MapEventLog` id are in a partner alert already; null: none yet. */
  partnerAlertsThrough: number | null;
}

/** A MAP as the scheduled job lists it: its directory row and its email state. */
export type JobMap = MapEntry & { mapId: string; notify: MapNotifyState };

/** Which file belongs to whom. `testing.ts` has a memory version; `@partner-desk/platform` has the Turso one. */
export interface Directory {
  partnerBook(companyId: string): Promise<{ fileId: string; ownerUserId: string } | null>;
  market(marketId: string): Promise<{ fileId: string; ownerUserId: string; companyId: string; displayName: string } | null>;
  markets(companyId: string): Promise<MarketListing[]>;
  /** Throws `DuplicateEntry` when the market id or the file id is already known. */
  addMarket(entry: { marketId: string; companyId: string; ownerUserId: string; fileId: string; displayName: string }): Promise<void>;
  /** Throws `DuplicateEntry` when the company already has a book (or the file id is known). */
  addPartnerBook(entry: { companyId: string; ownerUserId: string; fileId: string }): Promise<void>;
  /**
   * Points an existing book (same company, same owner) at a new file, for a book whose file is gone. A compare and
   * swap: it only succeeds while the book still points at `oldFileId`. Throws `DuplicateEntry` when it does not
   * (someone else replaced it first, or there is no such book), and the caller discards its own new file.
   */
  replacePartnerBook(entry: { companyId: string; ownerUserId: string; oldFileId: string; fileId: string }): Promise<void>;
  /** The name a market is listed under (`marketDisplayName`), after a rename or a new partner type. An unknown id changes nothing. */
  rename(marketId: string, displayName: string): Promise<void>;
  /** Archives a market at `at`, or brings it back with null. The file is never touched. An unknown id changes nothing. */
  setArchived(marketId: string, at: IsoDateTime | null): Promise<void>;
  /** The company's Company facts file, one per company. */
  companyFacts(companyId: string): Promise<{ fileId: string; ownerUserId: string } | null>;
  /** Throws `DuplicateEntry` when the company already has a Company facts file (or the file id is known). */
  addCompanyFacts(entry: { companyId: string; ownerUserId: string; fileId: string }): Promise<void>;
  program(programId: string): Promise<ProgramEntry | null>;
  /** The company's programs, oldest first. */
  programs(companyId: string): Promise<ProgramListing[]>;
  /** Throws `DuplicateEntry` when the program id or the file id is already known. */
  addProgram(entry: ProgramEntry & { programId: string }): Promise<void>;
  /** The label a program is listed under (`programLabel`), after a save. An unknown id changes nothing. */
  renameProgram(programId: string, displayName: string): Promise<void>;
  /** Removes a deleted program's row. The file is the caller's to trash. An unknown id changes nothing. */
  removeProgram(programId: string): Promise<void>;
  businessCase(caseId: string): Promise<CaseEntry | null>;
  /** The company's business cases, newest first. */
  businessCases(companyId: string): Promise<CaseListing[]>;
  /** Throws `DuplicateEntry` when the case id or the file id is already known. */
  addBusinessCase(entry: CaseEntry & { caseId: string }): Promise<void>;
  /** The title a case is listed under, after a save. An unknown id changes nothing. */
  renameBusinessCase(caseId: string, displayName: string): Promise<void>;
  /** Removes the rows of these cases. The files are the caller's to trash or keep. Unknown ids change nothing. */
  removeBusinessCases(caseIds: string[]): Promise<void>;
  map(mapId: string): Promise<MapEntry | null>;
  /** The MAP of a partner type of this company, if it has one. Partner type ids are unique only within a company. */
  mapFor(companyId: string, partnerId: string): Promise<(MapEntry & { mapId: string }) | null>;
  /** The company's MAPs, oldest first. */
  maps(companyId: string): Promise<MapListing[]>;
  /** Throws `DuplicateEntry` when the MAP id or the file id is known, or the company's partner type already has a MAP. */
  addMap(entry: Omit<MapEntry, 'startedOn' | 'datesMovedFor' | 'datesMoveFailedFor' | 'lastChangeAt'> & { mapId: string; startedOn: IsoDate }): Promise<void>;
  /** The name a MAP is listed under, after the partner was renamed. An unknown id changes nothing. */
  renameMap(mapId: string, displayName: string): Promise<void>;
  /** Removes the rows of these MAPs. The files are the caller's to trash or keep. Unknown ids change nothing. */
  removeMaps(mapIds: string[]): Promise<void>;
  /** Records a move of the MAP's open dates at signing: done for `movedFor`, or failed for `failedFor`. */
  setMapDatesMoved(mapId: string, state: { movedFor?: IsoDate | null; failedFor: IsoDate | null }): Promise<void>;
  /** Records a change to the MAP made through PartnerStandard Desk at `at`. An unknown id changes nothing. */
  setMapLastChange(mapId: string, at: IsoDateTime): Promise<void>;
  /** The MAP's email state (task 8). Null for an unknown id. */
  mapNotifyState(mapId: string): Promise<MapNotifyState | null>;
  /** Changes the MAP's email state; what is left out stays. An unknown id changes nothing. */
  setMapNotifyState(mapId: string, state: Partial<Omit<MapNotifyState, 'webhookHealth'>>): Promise<void>;
  /** The health the owner's webhooks last heard of (a code, or null). An unknown id changes nothing. */
  setMapWebhookHealth(mapId: string, health: MapNotifyState['webhookHealth']): Promise<void>;
  /** Forgets the health the webhooks last heard of on every MAP this person owns (a webhook turned on again). */
  forgetWebhookHealth(ownerUserId: string): Promise<void>;
  /** Every MAP, oldest first, with its email state (the scheduled job). */
  jobMaps(): Promise<JobMap[]>;
  /** Pauses the MAP's emails because its owner's Google access broke; true only when it wasn't paused already. */
  pauseMap(mapId: string): Promise<boolean>;
  /** Resumes these MAPs' emails; gives back the ones that were paused. */
  resumeMaps(mapIds: string[]): Promise<string[]>;
}

/** What a person with a link changed (the MAP app's plan_events): ids and codes only. */
export interface MapEvent {
  /** Orders the changes and moves the partner alerts' cursor. */
  id: number;
  entityType: string;
  entityId: string;
  action: 'created' | 'updated' | 'status_changed' | 'deleted';
  /** The link's id, or `email:{personId}` for an email button. */
  actorRef: string;
  at: IsoDateTime;
}

/** The changes people with a link made, for the owner's partner alerts. */
export interface MapEventLog {
  record(mapId: string, event: Omit<MapEvent, 'id'>): Promise<void>;
  /** The MAP's changes after `afterId` (all of them for null), oldest first. */
  since(mapId: string, afterId: number | null): Promise<MapEvent[]>;
  /** The MAP's latest change's id, or null. */
  latestId(mapId: string): Promise<number | null>;
  /** Removes changes older than `before` (the hourly clean-up); says how many. */
  prune(before: IsoDateTime): Promise<number>;
}

/** One row of share_links. The token itself is never here, only its SHA-256 hash. */
export interface ShareLink {
  id: string;
  ownerUserId: string;
  caseId: string;
  tokenHash: string;
  createdAt: IsoDateTime;
}

/**
 * The share links of business cases. A link works while its row is not turned off (revoked). `testing.ts` has a memory
 * version; `@partner-desk/platform` has the Turso one.
 */
export interface ShareLinks {
  create(link: ShareLink): Promise<void>;
  /** The link with this token hash, unless it was turned off. */
  findActive(tokenHash: string): Promise<{ ownerUserId: string; caseId: string } | null>;
  /** Turns off every link of these cases of one owner, at `at`. Links already off keep their time. */
  revokeCases(ownerUserId: string, caseIds: string[], at: IsoDateTime): Promise<void>;
  /** Removes every link of the user, turned off or not (account deletion). */
  deleteForOwner(userId: string): Promise<void>;
  /** The case's link that works now, if any: when it was made. */
  activeFor(ownerUserId: string, caseId: string): Promise<{ createdAt: IsoDateTime } | null>;
}

/** One row of review_links (reviews spec 5.6): a held review's summary link. The token is never here, only its SHA-256 hash. */
export interface ReviewLink {
  id: string;
  ownerUserId: string;
  mapId: string;
  /** The review's row id in the MAP file. */
  reviewId: string;
  tokenHash: string;
  createdAt: IsoDateTime;
}

/**
 * The summary links of held reviews, as the business case's share links: a link works while its row is not turned off.
 * `testing.ts` has a memory version; `@partner-desk/platform` has the Turso one.
 */
export interface ReviewLinks {
  create(link: ReviewLink): Promise<void>;
  /** The link with this token hash, unless it was turned off. */
  findActive(tokenHash: string): Promise<{ ownerUserId: string; mapId: string; reviewId: string } | null>;
  /** Turns off every link of one review of one owner, at `at` (a new send, Turn off the link). Links already off keep their time. */
  revokeReview(ownerUserId: string, mapId: string, reviewId: string, at: IsoDateTime): Promise<void>;
  /** Turns off every link of these MAPs of one owner (a MAP deleted, its partner type removed). */
  revokeMaps(ownerUserId: string, mapIds: string[], at: IsoDateTime): Promise<void>;
  /** Removes every link of the user, turned off or not (account deletion). */
  deleteForOwner(userId: string): Promise<void>;
  /** The review's link that works now, if any: when it was made. */
  activeFor(ownerUserId: string, mapId: string, reviewId: string): Promise<{ createdAt: IsoDateTime } | null>;
}

/**
 * One magic link to a MAP (spec 4, access by link): one person, one side, one MAP. The token is never here, only its
 * hash, and only the hash of the address it went to (to match a request for a new link).
 */
export interface MapLink {
  id: string;
  mapId: string;
  ownerUserId: string;
  /** The person's row id in the MAP's People tab. */
  personId: string;
  /** Fixed when the link is made, never read again from the sheet. */
  side: Side;
  emailHash: string;
  createdAt: IsoDateTime;
  lastUsedAt: IsoDateTime | null;
  revokedAt: IsoDateTime | null;
}

/** The magic links of MAPs. */
export interface MapLinks {
  /** Throws when the id or the token hash is taken. */
  create(link: Omit<MapLink, 'lastUsedAt' | 'revokedAt'> & { tokenHash: string }): Promise<void>;
  get(id: string): Promise<MapLink | null>;
  findByTokenHash(tokenHash: string): Promise<MapLink | null>;
  /** The MAP's links, oldest first, revoked ones included. */
  listForMap(mapId: string): Promise<MapLink[]>;
  /** Records the link's last use. */
  touch(id: string, at: IsoDateTime): Promise<void>;
  /** Turns off every working link of one person on one MAP; says how many. */
  revokePerson(mapId: string, personId: string, at: IsoDateTime): Promise<number>;
  /** Turns off every link of these MAPs. Links already off keep their time. */
  revokeMaps(mapIds: string[], at: IsoDateTime): Promise<void>;
  /** Account deletion: removes every link of the user's MAPs, turned off or not, and their sessions first. */
  deleteForOwner(userId: string): Promise<void>;
}

/** A link holder's browser session. The cookie's token is never here, only its hash. */
export interface MapSession {
  id: string;
  linkId: string;
  mapId: string;
  expiresAt: IsoDateTime;
}

export interface MapSessions {
  create(session: MapSession & { tokenHash: string }): Promise<void>;
  findByTokenHash(tokenHash: string): Promise<MapSession | null>;
  extend(id: string, expiresAt: IsoDateTime): Promise<void>;
  /** Ends one session. An unknown id changes nothing. */
  delete(id: string): Promise<void>;
  /** Ends every session of these MAPs. */
  deleteForMaps(mapIds: string[]): Promise<void>;
  /** Removes sessions that expired before `now` (the hourly clean-up); says how many. */
  deleteExpired(now: IsoDateTime): Promise<number>;
}

/** Fixed-window counting of attempts. Keys hold hashes, never an address or an IP. */
export interface RateLimiter {
  /** Counts one attempt for `key`; false when `limit` attempts were already counted in the current window. */
  hit(key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean>;
  /** Removes counters whose window started before `beforeMs` (the hourly clean-up); says how many. */
  prune(beforeMs: number): Promise<number>;
}

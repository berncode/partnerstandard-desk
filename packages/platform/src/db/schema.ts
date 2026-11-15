import { PROPOSAL_KINDS, PROPOSAL_STATUSES, WORKSPACE_ROLES } from '@partner-desk/core';
import { WORKBOOK_KINDS } from '@partner-desk/storage';
import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex, type SQLiteColumn } from 'drizzle-orm/sqlite-core';

export * from './auth-schema';

// Our database holds accounts, ids, a few display names, locks and id-only events.
// Never partner, market, call or person content (AGENTS.md, "Your work stays yours"). The one exception is `work_files`,
// which only the self-hosted edition writes: there the company's own database holds its work (plan 13). Hosted, the
// table exists and stays empty.

/** One company per account. */
export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull().unique(),
  name: text('name').notNull().default(''),
  createdAt: text('created_at').notNull(),
  /** The owner's IANA timezone, chosen in Settings (task 8): "today" and the 08:00 emails count in it. Null: Europe/Berlin. */
  timezone: text('timezone'),
});

/** The primary key on company_id makes the loser of a create race fail. */
export const partnerBooks = sqliteTable('partner_books', {
  companyId: text('company_id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  fileId: text('file_id').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

export const markets = sqliteTable('markets', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  fileId: text('file_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
  archivedAt: text('archived_at'),
}, (t) => [index('markets_company_id_idx').on(t.companyId)]);

/** One per program file: ids, its label ("Reseller · DACH") and its partner type, which never changes. */
export const programs = sqliteTable('programs', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  fileId: text('file_id').notNull().unique(),
  displayName: text('display_name').notNull(),
  partnerType: text('partner_type').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [index('programs_company_id_idx').on(t.companyId)]);

/** The Company facts file of each company. The primary key on company_id makes the loser of a create race fail. */
export const companyFacts = sqliteTable('company_facts', {
  companyId: text('company_id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  fileId: text('file_id').notNull().unique(),
  createdAt: text('created_at').notNull(),
});

/**
 * One per business case file: ids, the partner type, the case's title as its display name, and when it was made. The
 * Business cases page is built from these rows alone. Never a number or a note of the case.
 */
export const businessCases = sqliteTable('business_cases', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  fileId: text('file_id').notNull().unique(),
  partnerId: text('partner_id').notNull(),
  partnerType: text('partner_type').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
}, (t) => [index('business_cases_company_id_idx').on(t.companyId), index('business_cases_partner_id_idx').on(t.partnerId)]);

/** A business case's share links. The token itself is never here, only its SHA-256 hash. A link works until revoked. */
export const shareLinks = sqliteTable('share_links', {
  id: text('id').primaryKey(),
  caseId: text('case_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
}, (t) => [index('share_links_owner_case_idx').on(t.ownerUserId, t.caseId)]);

/**
 * A held review's summary links (reviews spec 5.6, 7): the review's MAP and its row id in the MAP file. The token itself
 * is never here, only its SHA-256 hash, nor who it went to, nor anything of the review. A link works until revoked.
 */
export const reviewLinks = sqliteTable('review_links', {
  id: text('id').primaryKey(),
  ownerUserId: text('owner_user_id').notNull(),
  mapId: text('map_id').notNull(),
  reviewId: text('review_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  revokedAt: text('revoked_at'),
}, (t) => [index('review_links_owner_map_idx').on(t.ownerUserId, t.mapId)]);

/**
 * One per MAP file (spec 7): ids, the partner type it belongs to (one MAP per partner type of a company: partner type
 * ids come from the company's Partners file, so they are unique only within it), its display name ("Acme as
 * reseller"), when it was made (the MAP's planned start before signing, ruling R3) and its email settings. Never plan
 * content. `datesMovedFor`: the signing date the MAP's open dates were last moved for; `datesMoveFailedFor`: the signing
 * date a move was asked for and failed (spec 5.3, ruling R4). So the MAP page can offer it again, and never moves twice.
 */
export const maps = sqliteTable('maps', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  fileId: text('file_id').notNull().unique(),
  partnerId: text('partner_id').notNull(),
  partnerType: text('partner_type').notNull(),
  displayName: text('display_name').notNull(),
  createdAt: text('created_at').notNull(),
  /**
   * The day the MAP was started, in its owner's timezone then (question 20): its planned start before signing. Null for a
   * MAP made before it was kept, which counts from the UTC date of `created_at`. A date only.
   */
  startedOn: text('started_on'),
  /** The MAP's email settings as JSON (task 8): due-soon days, the partner digest, partner alerts. Settings only. */
  notifySettings: text('notify_settings').notNull().default('{}'),
  /** The health last warned about (the MAP app's momentum warning): a warning goes out only on a change for the worse. */
  momentumState: text('momentum_state'),
  /** Why the MAP's emails are paused (the owner's Google access broke), or null. A code, never content. */
  pausedReason: text('paused_reason'),
  /** The health the last weekly digest reported (the MAP app's digest_health), so the next one can say it changed. */
  digestHealth: text('digest_health'),
  /**
   * The health the owner's webhooks last heard of (agents spec 7.2): `health.changed` goes out when it differs. A code,
   * never content; null for none yet, an empty MAP, or an owner without a webhook for it.
   */
  webhookHealth: text('webhook_health'),
  /** Changes by link holders up to this map_events id are in a partner alert already; null: none yet. */
  partnerAlertsThrough: integer('partner_alerts_through'),
  datesMovedFor: text('dates_moved_for'),
  datesMoveFailedFor: text('dates_move_failed_for'),
  /** When the MAP was last changed through PartnerStandard Desk (ruling R6): what its health counts progress from. A time only. */
  lastChangeAt: text('last_change_at'),
}, (t) => [
  index('maps_company_id_idx').on(t.companyId), index('maps_owner_user_id_idx').on(t.ownerUserId),
  uniqueIndex('maps_company_partner_unique').on(t.companyId, t.partnerId),
]);

/**
 * A MAP's magic links (spec 4, access by link): one person, one side, one MAP. The token itself is never here, only its
 * SHA-256 hash, nor the address it went to, only its hash (to match a request for a new link). A link works until it is
 * revoked or has been idle for 90 days.
 */
export const mapLinks = sqliteTable('map_links', {
  id: text('id').primaryKey(),
  mapId: text('map_id').notNull(),
  ownerUserId: text('owner_user_id').notNull(),
  /** Row id of the person in the MAP's People tab. */
  personId: text('person_id').notNull(),
  /** Fixed when the link is made; never read again from the sheet. */
  side: text('side', { enum: ['us', 'partner'] }).notNull(),
  emailHash: text('email_hash').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
}, (t) => [index('map_links_map_id_idx').on(t.mapId), index('map_links_owner_user_id_idx').on(t.ownerUserId)]);

/** A link holder's browser session: the cookie's token is never here, only its SHA-256 hash. */
export const mapSessions = sqliteTable('map_sessions', {
  id: text('id').primaryKey(),
  linkId: text('link_id').notNull(),
  mapId: text('map_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  expiresAt: text('expires_at').notNull(),
}, (t) => [index('map_sessions_link_id_idx').on(t.linkId), index('map_sessions_map_id_idx').on(t.mapId)]);

/**
 * A change made by a person with a link (or an email button), for the owner's partner alerts (the MAP app's
 * plan_events). Ids and codes only: which row, what kind of change, and which link or person. The id orders the
 * changes and moves the alert's cursor.
 */
export const mapEvents = sqliteTable('map_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  mapId: text('map_id').notNull(),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action', { enum: ['created', 'updated', 'status_changed', 'deleted'] }).notNull(),
  /** The link's id, or `email:{personId}` for an email button. */
  actorRef: text('actor_ref').notNull(),
  at: text('at').notNull(),
}, (t) => [index('map_events_map_id_idx').on(t.mapId, t.id)]);

/**
 * The email log (spec 7): a key is claimed before its email goes out, marked sent with Resend's id, or given back.
 * The recipient's address is the one piece of personal data; sent rows are kept 90 days, then pruned.
 */
export const notificationLog = sqliteTable('notification_log', {
  dedupeKey: text('dedupe_key').primaryKey(),
  type: text('type').notNull(),
  mapId: text('map_id'),
  recipientEmail: text('recipient_email'),
  claimedAt: text('claimed_at').notNull(),
  sentAt: text('sent_at'),
  resendId: text('resend_id'),
}, (t) => [index('notification_log_map_id_idx').on(t.mapId)]);

/** Unsubscribes per address and kind of email, by the address's SHA-256 only (the MAP app's email_prefs). */
export const emailPrefs = sqliteTable('email_prefs', {
  emailHash: text('email_hash').notNull(),
  type: text('type', { enum: ['nudges', 'digest', 'partner_alerts', 'momentum'] }).notNull(),
  unsubscribedAt: text('unsubscribed_at').notNull(),
}, (t) => [primaryKey({ columns: [t.emailHash, t.type] })]);

/** Fixed-window counters (asking for a new MAP link). Keys hold hashes, never an address or an IP. */
export const rateLimits = sqliteTable('rate_limits', {
  key: text('key').primaryKey(),
  windowStart: integer('window_start').notNull(),
  count: integer('count').notNull(),
});

export const storageFolders = sqliteTable('storage_folders', {
  userId: text('user_id').primaryKey(),
  folderId: text('folder_id').notNull(),
});

export const fileLocks = sqliteTable('file_locks', {
  key: text('key').primaryKey(),
  holder: text('holder').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const fileWrites = sqliteTable('file_writes', {
  fileId: text('file_id').primaryKey(),
  writtenAt: integer('written_at').notNull(),
});

/** Ids only. `entityIds` is comma-separated. */
export const events = sqliteTable('events', {
  id: text('id').primaryKey(),
  at: text('at').notNull(),
  command: text('command').notNull(),
  actorKind: text('actor_kind').notNull(),
  actorUserId: text('actor_user_id').notNull(),
  fileId: text('file_id').notNull(),
  entityIds: text('entity_ids').notNull(),
  /** The change's kind (a code such as `setStep`), never content. Null for events that carry no change. */
  change: text('change'),
  /** The agent proposal it made, answered or carried out (`prp_…`), or null. An id only. */
  proposalId: text('proposal_id'),
}, (t) => [index('events_file_id_idx').on(t.fileId), index('events_file_change_idx').on(t.fileId, t.change)]);

/**
 * API keys (agents spec 4.4): a person's key for n8n, Make or a script. Only the key's SHA-256 hash and its first 8
 * characters (to tell keys apart) are kept, never the key. Turned off keys keep their row until Delete account.
 */
export const apiKeys = sqliteTable('api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(),
  /** A TypeScript list on a text column: adding a level needs no migration. */
  level: text('level', { enum: ['read', 'change', 'propose'] }).notNull(),
  keyHash: text('key_hash').notNull().unique(),
  prefix: text('prefix').notNull(),
  createdAt: text('created_at').notNull(),
  lastUsedAt: text('last_used_at'),
  revokedAt: text('revoked_at'),
}, (t) => [index('api_keys_user_id_idx').on(t.userId)]);

/**
 * Webhooks (agents spec 7): a person's address, the events it gets, and its signing secret encrypted with the key that
 * encrypts the Google tokens. `firstFailureAt` (epoch ms): when the current run of failed deliveries began, null after a
 * success; 3 days of it turn the webhook `off_failing`.
 */
export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  url: text('url').notNull(),
  /** A JSON array of event types. */
  events: text('events').notNull(),
  secretEnc: text('secret_enc').notNull(),
  status: text('status', { enum: ['active', 'off_failing', 'off'] }).notNull(),
  createdAt: text('created_at').notNull(),
  firstFailureAt: integer('first_failure_at'),
  /**
   * When it was last turned on, null until a Turn on (question 27): the scheduled job's overdue and review events count
   * from then, else from `createdAt`.
   */
  turnedOnAt: text('turned_on_at'),
}, (t) => [index('webhooks_user_id_idx').on(t.userId)]);

/**
 * The delivery queue: one row per event and webhook, ids only (spec 7.3). `id` is the event id (`evt_…`, the
 * `webhook-id` header), the same for every webhook the event goes to. `nextTryAt` (epoch ms) is null once the row is
 * done or given up; `lastStatus` is the last answer's HTTP status, 0 for no answer;
 * a claim clears it, so it is null while the row is being sent and after Send again. Done and given-up rows go after 7 days.
 */
export const webhookDeliveries = sqliteTable('webhook_deliveries', {
  id: text('id').notNull(),
  webhookId: text('webhook_id').notNull(),
  type: text('type').notNull(),
  /** A JSON object of ids. */
  data: text('data').notNull(),
  occurredAt: text('occurred_at').notNull(),
  attempts: integer('attempts').notNull(),
  nextTryAt: integer('next_try_at'),
  lastStatus: integer('last_status'),
  doneAt: text('done_at'),
  givenUpAt: text('given_up_at'),
}, (t) => [
  primaryKey({ columns: [t.id, t.webhookId] }),
  index('webhook_deliveries_next_try_idx').on(t.nextTryAt),
  index('webhook_deliveries_webhook_id_idx').on(t.webhookId),
]);

/** An event the scheduled job sent once per key (an activity's overdue, a review coming up), per person. Kept 90 days. */
export const webhookMarks = sqliteTable('webhook_marks', {
  userId: text('user_id').notNull(),
  key: text('key').notNull(),
  at: text('at').notNull(),
}, (t) => [primaryKey({ columns: [t.userId, t.key] })]);

/**
 * The proposal index (agent proposals spec 7.2): one row per agent proposal, never per item, with ids, codes and times
 * only. No score, evidence, reason, company name, answer note or person's name: those are in the Partners file's
 * Proposals tab. Who made it: the app's name and its client id (`maker_kind` 'app'), or the key's id ('key'). Kind and
 * status are TypeScript lists on text columns. Answered rows go 90 days after their answer (the hourly clean-up).
 */
export const proposals = sqliteTable('proposals', {
  id: text('id').primaryKey(),
  /** The person it waits for. */
  userId: text('user_id').notNull(),
  kind: text('kind', { enum: PROPOSAL_KINDS }).notNull(),
  accountId: text('account_id'),
  partnerId: text('partner_id'),
  marketId: text('market_id'),
  hypothesisId: text('hypothesis_id'),
  status: text('status', { enum: PROPOSAL_STATUSES }).notNull(),
  createdAt: text('created_at').notNull(),
  answeredAt: text('answered_at'),
  expiresAt: text('expires_at').notNull(),
  makerKind: text('maker_kind', { enum: ['app', 'key'] }).notNull(),
  /** The app's name as the agent acts under it ('' for an app without one); null for a key. */
  makerName: text('maker_name'),
  clientId: text('client_id'),
  keyId: text('key_id'),
  /**
   * A company server's member whose app or key made it (plan 15): their own grants and keys name it. Null on hosted,
   * where that is `user_id`.
   */
  makerPersonId: text('maker_person_id'),
  /** The Partners file the content is in. */
  fileId: text('file_id').notNull(),
}, (t) => [index('proposals_user_status_idx').on(t.userId, t.status), index('proposals_status_expires_idx').on(t.status, t.expiresAt)]);

/**
 * The self-hosted edition's files (plan 13, spec 2026-11-07 §6.1): one row per file, holding the workbook the sheet codec
 * makes for Drive, as JSON. Hosted never writes here. A save writes only at the revision it read; deleting sets
 * `trashed_at` and keeps the row.
 */
export const workFiles = sqliteTable('work_files', {
  id: text('id').primaryKey(),
  kind: text('kind', { enum: WORKBOOK_KINDS }).notNull(),
  companyId: text('company_id').notNull(),
  formatVersion: integer('format_version').notNull(),
  revision: integer('revision').notNull().default(0),
  body: text('body').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  trashedAt: text('trashed_at'),
}, (t) => [index('work_files_company_idx').on(t.companyId)]);

/**
 * A company server's one workspace (plan 15, spec 2026-11-07 §7.2): its key stands where a hosted owner's user id stands, and is no person's,
 * so admins can come and go. `slot` is always 1, so two first calls at once end with one row. Hosted never writes here.
 */
export const workspace = sqliteTable('workspace', {
  slot: integer('slot').primaryKey(),
  id: text('id').notNull().unique(),
  createdAt: text('created_at').notNull(),
}, (t) => [check('workspace_one_row', sql`${t.slot} = 1`)]);

/** The database itself refuses a role that isn't one. */
const roleCheck = (role: SQLiteColumn) => sql`${role} IN (${sql.raw(WORKSPACE_ROLES.map((r) => `'${r}'`).join(', '))})`;

/** The workspace's members: a person's sign-in id and role. Hosted never writes here. */
export const workspaceMembers = sqliteTable('workspace_members', {
  personId: text('person_id').primaryKey(),
  role: text('role', { enum: WORKSPACE_ROLES }).notNull(),
  /** The admin who invited them; null for the first admin. */
  addedBy: text('added_by'),
  addedAt: text('added_at').notNull(),
}, (t) => [index('workspace_members_role_idx').on(t.role), check('workspace_members_role', roleCheck(t.role))]);

/**
 * Addresses an admin invited, one invite per address. The invited address is the one piece of personal data, kept until
 * the first sign-in, a cancel or the clean-up after it runs out. Hosted never writes here.
 */
export const workspaceInvites = sqliteTable('workspace_invites', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  role: text('role', { enum: WORKSPACE_ROLES }).notNull(),
  invitedBy: text('invited_by').notNull(),
  createdAt: text('created_at').notNull(),
  expiresAt: text('expires_at').notNull(),
}, (t) => [check('workspace_invites_role', roleCheck(t.role))]);

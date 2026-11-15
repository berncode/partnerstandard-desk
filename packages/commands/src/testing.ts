import {
  INVITE_DAYS, newCompanyId, newInviteId, newWorkspaceId, normalizeAddress as normalEmail, randomSuffix, WEBHOOK_TEST_EVENT, type IsoDateTime, type WorkspaceRole,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import {
  createMemoryCaseStore, createMemoryCompanyFactsStore, createMemoryMapStore, createMemoryMarketStore, createMemoryPartnerBookStore,
  createMemoryProgramStore,
} from '@partner-desk/storage';
import type { CompanyNameLookup, CompanyNames } from './companies';
import type { Deps } from './deps';
import {
  DuplicateEntry, type CaseEntry, type Directory, type MapEntry, type MapEvent, type MapEventLog, type MapLink, type MapLinks,
  type MapNotifyState, type MapSession, type MapSessions, type ProgramEntry, type RateLimiter, type ReviewLink, type ReviewLinks,
  type ShareLink, type ShareLinks,
} from './directory';
import { cleanAgentName } from './agents/context';
import type { CommandEvent, EventSink } from './events';
import { appMaker, makerKey, sameMaker, sameTarget, type ProposalEntry, type ProposalIndex } from './proposal-index';
import type { MemberRefusal, Workspace, WorkspaceInvite, WorkspaceMember } from './workspace';
import type { ResendOutcome, TargetCheck, WebhookDelivery, WebhookInfo, WebhookStore, WebhookSubscription } from './webhooks';

export const TEST_NOW = '2026-10-28T10:00:00.000Z';

export interface MemoryDirectory extends Directory {
  readonly books: Map<string, { fileId: string; ownerUserId: string }>;
}

export function createMemoryDirectory(): MemoryDirectory {
  const books = new Map<string, { fileId: string; ownerUserId: string }>();
  const facts = new Map<string, { fileId: string; ownerUserId: string }>();
  // A Map keeps insertion order: the programs list oldest first, as Turso does.
  const programs = new Map<string, ProgramEntry>();
  const markets = new Map<string, {
    marketId: string; companyId: string; ownerUserId: string; fileId: string; displayName: string; archivedAt: string | null;
  }>();
  // Insertion order breaks a tie in `createdAt`: the later one is newer, as Turso's rowid does.
  const cases = new Map<string, CaseEntry>();
  // Insertion order: oldest first, as Turso lists them.
  const maps = new Map<string, MapEntry & { notify: MapNotifyState }>();
  const mapEntry = (m: MapEntry): MapEntry => ({
    fileId: m.fileId, ownerUserId: m.ownerUserId, companyId: m.companyId, partnerId: m.partnerId, partnerType: m.partnerType,
    displayName: m.displayName, createdAt: m.createdAt, startedOn: m.startedOn, datesMovedFor: m.datesMovedFor,
    datesMoveFailedFor: m.datesMoveFailedFor, lastChangeAt: m.lastChangeAt,
  });
  return {
    books,
    async partnerBook(companyId) {
      return books.get(companyId) ?? null;
    },
    async market(marketId) {
      const m = markets.get(marketId);
      return m ? { fileId: m.fileId, ownerUserId: m.ownerUserId, companyId: m.companyId, displayName: m.displayName } : null;
    },
    async markets(companyId) {
      return [...markets.values()].filter((m) => m.companyId === companyId)
        .map((m) => ({ marketId: m.marketId, displayName: m.displayName, ownerUserId: m.ownerUserId, archived: m.archivedAt !== null }));
    },
    async addMarket(entry) {
      if (markets.has(entry.marketId)) throw new DuplicateEntry();
      markets.set(entry.marketId, { ...entry, archivedAt: null });
    },
    async addPartnerBook({ companyId, ownerUserId, fileId }) {
      if (books.has(companyId)) throw new DuplicateEntry();
      books.set(companyId, { fileId, ownerUserId });
    },
    async replacePartnerBook({ companyId, ownerUserId, oldFileId, fileId }) {
      const current = books.get(companyId);
      if (!current || current.ownerUserId !== ownerUserId || current.fileId !== oldFileId) throw new DuplicateEntry();
      books.set(companyId, { fileId, ownerUserId });
    },
    async rename(marketId, displayName) {
      const m = markets.get(marketId);
      if (m) m.displayName = displayName;
    },
    async setArchived(marketId, at) {
      const m = markets.get(marketId);
      if (m) m.archivedAt = at;
    },
    async companyFacts(companyId) {
      const entry = facts.get(companyId);
      return entry ? { ...entry } : null;
    },
    async addCompanyFacts({ companyId, ownerUserId, fileId }) {
      if (facts.has(companyId)) throw new DuplicateEntry();
      facts.set(companyId, { fileId, ownerUserId });
    },
    async program(programId) {
      const entry = programs.get(programId);
      return entry ? { ...entry } : null;
    },
    async programs(companyId) {
      return [...programs.entries()].filter(([, p]) => p.companyId === companyId)
        .map(([programId, p]) => ({ programId, displayName: p.displayName, ownerUserId: p.ownerUserId, partnerType: p.partnerType }));
    },
    async addProgram({ programId, ...entry }) {
      if (programs.has(programId) || [...programs.values()].some((p) => p.fileId === entry.fileId)) throw new DuplicateEntry();
      programs.set(programId, entry);
    },
    async renameProgram(programId, displayName) {
      const entry = programs.get(programId);
      if (entry) entry.displayName = displayName;
    },
    async removeProgram(programId) {
      programs.delete(programId);
    },
    async businessCase(caseId) {
      const entry = cases.get(caseId);
      return entry ? { ...entry } : null;
    },
    async businessCases(companyId) {
      return [...cases.entries()].filter(([, c]) => c.companyId === companyId).reverse()
        .sort(([, a], [, b]) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .map(([caseId, c]) => ({
          caseId, ownerUserId: c.ownerUserId, partnerId: c.partnerId, partnerType: c.partnerType, displayName: c.displayName, createdAt: c.createdAt,
        }));
    },
    async addBusinessCase({ caseId, ...entry }) {
      if (cases.has(caseId) || [...cases.values()].some((c) => c.fileId === entry.fileId)) throw new DuplicateEntry();
      cases.set(caseId, entry);
    },
    async renameBusinessCase(caseId, displayName) {
      const entry = cases.get(caseId);
      if (entry) entry.displayName = displayName;
    },
    async removeBusinessCases(caseIds) {
      for (const caseId of caseIds) cases.delete(caseId);
    },
    async map(mapId) {
      const entry = maps.get(mapId);
      return entry ? mapEntry(entry) : null;
    },
    async mapFor(companyId, partnerId) {
      const found = [...maps.entries()].find(([, m]) => m.companyId === companyId && m.partnerId === partnerId);
      return found ? { ...mapEntry(found[1]), mapId: found[0] } : null;
    },
    async maps(companyId) {
      return [...maps.entries()].filter(([, m]) => m.companyId === companyId)
        .map(([mapId, m]) => ({
          mapId, ownerUserId: m.ownerUserId, partnerId: m.partnerId, partnerType: m.partnerType, displayName: m.displayName,
          createdAt: m.createdAt, startedOn: m.startedOn, datesMovedFor: m.datesMovedFor, datesMoveFailedFor: m.datesMoveFailedFor,
          lastChangeAt: m.lastChangeAt,
        }));
    },
    async addMap({ mapId, ...entry }) {
      const taken = [...maps.values()].some((m) => m.fileId === entry.fileId || (m.companyId === entry.companyId && m.partnerId === entry.partnerId));
      if (maps.has(mapId) || taken) throw new DuplicateEntry();
      maps.set(mapId, { ...entry, datesMovedFor: null, datesMoveFailedFor: null, lastChangeAt: null, notify: emptyNotifyState() });
    },
    async renameMap(mapId, displayName) {
      const entry = maps.get(mapId);
      if (entry) entry.displayName = displayName;
    },
    async removeMaps(mapIds) {
      for (const mapId of mapIds) maps.delete(mapId);
    },
    async setMapDatesMoved(mapId, { movedFor, failedFor }) {
      const entry = maps.get(mapId);
      if (!entry) return;
      if (movedFor !== undefined) entry.datesMovedFor = movedFor;
      entry.datesMoveFailedFor = failedFor;
    },
    async setMapLastChange(mapId, at) {
      const entry = maps.get(mapId);
      if (entry) entry.lastChangeAt = at;
    },
    async mapNotifyState(mapId) {
      const entry = maps.get(mapId);
      return entry ? structuredClone(entry.notify) : null;
    },
    async setMapNotifyState(mapId, state) {
      const entry = maps.get(mapId);
      if (entry) entry.notify = { ...entry.notify, ...structuredClone(state) };
    },
    async setMapWebhookHealth(mapId, health) {
      const entry = maps.get(mapId);
      if (entry) entry.notify.webhookHealth = health;
    },
    async forgetWebhookHealth(ownerUserId) {
      for (const entry of maps.values()) if (entry.ownerUserId === ownerUserId) entry.notify.webhookHealth = null;
    },
    async jobMaps() {
      return [...maps.entries()].sort(([, a], [, b]) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
        .map(([mapId, m]) => ({ ...mapEntry(m), mapId, notify: structuredClone(m.notify) }));
    },
    async pauseMap(mapId) {
      const entry = maps.get(mapId);
      if (!entry || entry.notify.pausedReason) return false;
      entry.notify.pausedReason = 'auth';
      return true;
    },
    async resumeMaps(mapIds) {
      const resumed: string[] = [];
      for (const mapId of mapIds) {
        const entry = maps.get(mapId);
        if (entry?.notify.pausedReason) {
          entry.notify.pausedReason = null;
          resumed.push(mapId);
        }
      }
      return resumed;
    },
  };
}

/** A MAP's email state before anything was sent: the MAP app's defaults. */
export const emptyNotifyState = (): MapNotifyState => ({
  settings: {}, momentumState: null, pausedReason: null, digestHealth: null, webhookHealth: null, partnerAlertsThrough: null,
});

export interface MemoryMapEventLog extends MapEventLog {
  readonly rows: Array<MapEvent & { mapId: string }>;
}

/** The changes people with a link made, in memory (the MAP app's MemoryPlanEventLog). */
export function createMemoryMapEventLog(): MemoryMapEventLog {
  const rows: Array<MapEvent & { mapId: string }> = [];
  let next = 0;
  return {
    rows,
    async record(mapId, event) { rows.push({ ...event, mapId, id: ++next }); },
    async since(mapId, afterId) {
      return rows.filter((r) => r.mapId === mapId && (afterId === null || r.id > afterId))
        .map((r) => ({ id: r.id, entityType: r.entityType, entityId: r.entityId, action: r.action, actorRef: r.actorRef, at: r.at }));
    },
    async latestId(mapId) { return rows.findLast((r) => r.mapId === mapId)?.id ?? null; },
    async prune(before) {
      const keep = rows.filter((r) => r.at >= before);
      const gone = rows.length - keep.length;
      rows.splice(0, rows.length, ...keep);
      return gone;
    },
  };
}

export interface MemoryMapLinks extends MapLinks {
  /** Every link, turned off or not, with its token hash, as the table holds them. */
  readonly rows: Array<MapLink & { tokenHash: string }>;
}

export interface MemoryMapSessions extends MapSessions {
  readonly rows: Array<MapSession & { tokenHash: string }>;
}

/**
 * A MAP's links and their sessions in memory, split as PartnerStandard Desk's tables are.
 */
export function createMemoryMapAccess(): { links: MemoryMapLinks; sessions: MemoryMapSessions; limiter: RateLimiter } {
  const links: Array<MapLink & { tokenHash: string }> = [];
  const sessions: Array<MapSession & { tokenHash: string }> = [];
  const plain = (l: MapLink): MapLink => ({
    id: l.id, mapId: l.mapId, ownerUserId: l.ownerUserId, personId: l.personId, side: l.side, emailHash: l.emailHash,
    createdAt: l.createdAt, lastUsedAt: l.lastUsedAt, revokedAt: l.revokedAt,
  });
  const byAge = (a: MapLink, b: MapLink) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const windows = new Map<string, { start: number; count: number }>();
  return {
    links: {
      rows: links,
      async create(link) {
        if (links.some((l) => l.id === link.id || l.tokenHash === link.tokenHash)) throw new Error('map_links_create_failed');
        links.push({ ...link, lastUsedAt: null, revokedAt: null });
      },
      async get(id) {
        const link = links.find((l) => l.id === id);
        return link ? plain(link) : null;
      },
      async findByTokenHash(tokenHash) {
        const link = links.find((l) => l.tokenHash === tokenHash);
        return link ? plain(link) : null;
      },
      async listForMap(mapId) {
        return links.filter((l) => l.mapId === mapId).map(plain).sort(byAge);
      },
      async touch(id, at) {
        const link = links.find((l) => l.id === id);
        if (link) link.lastUsedAt = at;
      },
      async revokePerson(mapId, personId, at) {
        let count = 0;
        for (const l of links) {
          if (l.mapId !== mapId || l.personId !== personId || l.revokedAt !== null) continue;
          l.revokedAt = at;
          count += 1;
        }
        return count;
      },
      async revokeMaps(mapIds, at) {
        for (const l of links) if (mapIds.includes(l.mapId) && l.revokedAt === null) l.revokedAt = at;
      },
      async deleteForOwner(userId) {
        const gone = new Set(links.filter((l) => l.ownerUserId === userId).map((l) => l.id));
        for (let i = sessions.length - 1; i >= 0; i--) if (gone.has(sessions[i]!.linkId)) sessions.splice(i, 1);
        for (let i = links.length - 1; i >= 0; i--) if (gone.has(links[i]!.id)) links.splice(i, 1);
      },
    },
    sessions: {
      rows: sessions,
      async create(session) {
        if (sessions.some((x) => x.id === session.id || x.tokenHash === session.tokenHash)) throw new Error('map_sessions_create_failed');
        sessions.push({ ...session });
      },
      async findByTokenHash(tokenHash) {
        const found = sessions.find((x) => x.tokenHash === tokenHash);
        return found ? { id: found.id, linkId: found.linkId, mapId: found.mapId, expiresAt: found.expiresAt } : null;
      },
      async extend(id, expiresAt) {
        const found = sessions.find((x) => x.id === id);
        if (found) found.expiresAt = expiresAt;
      },
      async delete(id) {
        const at = sessions.findIndex((x) => x.id === id);
        if (at !== -1) sessions.splice(at, 1);
      },
      async deleteForMaps(mapIds) {
        for (let i = sessions.length - 1; i >= 0; i--) if (mapIds.includes(sessions[i]!.mapId)) sessions.splice(i, 1);
      },
      async deleteExpired(now) {
        let count = 0;
        for (let i = sessions.length - 1; i >= 0; i--) {
          if (sessions[i]!.expiresAt >= now) continue;
          sessions.splice(i, 1);
          count += 1;
        }
        return count;
      },
    },
    limiter: {
      async hit(key, limit, windowMs, nowMs) {
        const start = Math.floor(nowMs / windowMs) * windowMs;
        const current = windows.get(key);
        const count = current && current.start === start ? current.count + 1 : 1;
        windows.set(key, { start, count });
        return count <= limit;
      },
      async prune(beforeMs) {
        let count = 0;
        for (const [key, window] of windows) {
          if (window.start >= beforeMs) continue;
          windows.delete(key);
          count += 1;
        }
        return count;
      },
    },
  };
}

export interface MemoryShareLinks extends ShareLinks {
  /** Every link, turned off or not, as the table holds them. */
  readonly rows: Array<ShareLink & { revokedAt: string | null }>;
}

export function createMemoryShareLinks(): MemoryShareLinks {
  const rows: Array<ShareLink & { revokedAt: string | null }> = [];
  return {
    rows,
    async create(link) {
      // The token hash is unique, as in the table.
      if (rows.some((r) => r.tokenHash === link.tokenHash || r.id === link.id)) throw new Error('share_links_create_failed');
      rows.push({ ...link, revokedAt: null });
    },
    async findActive(tokenHash) {
      const row = rows.find((r) => r.tokenHash === tokenHash && r.revokedAt === null);
      return row ? { ownerUserId: row.ownerUserId, caseId: row.caseId } : null;
    },
    async revokeCases(ownerUserId, caseIds, at) {
      for (const r of rows) if (r.ownerUserId === ownerUserId && caseIds.includes(r.caseId) && r.revokedAt === null) r.revokedAt = at;
    },
    async deleteForOwner(userId) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.ownerUserId === userId) rows.splice(i, 1);
    },
    async activeFor(ownerUserId, caseId) {
      const row = rows.findLast((r) => r.ownerUserId === ownerUserId && r.caseId === caseId && r.revokedAt === null);
      return row ? { createdAt: row.createdAt } : null;
    },
  };
}

export interface MemoryReviewLinks extends ReviewLinks {
  /** Every link, turned off or not, as the table holds them. */
  readonly rows: Array<ReviewLink & { revokedAt: string | null }>;
}

export function createMemoryReviewLinks(): MemoryReviewLinks {
  const rows: Array<ReviewLink & { revokedAt: string | null }> = [];
  return {
    rows,
    async create(link) {
      // The token hash is unique, as in the table.
      if (rows.some((r) => r.tokenHash === link.tokenHash || r.id === link.id)) throw new Error('review_links_create_failed');
      rows.push({ ...link, revokedAt: null });
    },
    async findActive(tokenHash) {
      const row = rows.find((r) => r.tokenHash === tokenHash && r.revokedAt === null);
      return row ? { ownerUserId: row.ownerUserId, mapId: row.mapId, reviewId: row.reviewId } : null;
    },
    async revokeReview(ownerUserId, mapId, reviewId, at) {
      for (const r of rows) {
        if (r.ownerUserId === ownerUserId && r.mapId === mapId && r.reviewId === reviewId && r.revokedAt === null) r.revokedAt = at;
      }
    },
    async revokeMaps(ownerUserId, mapIds, at) {
      for (const r of rows) if (r.ownerUserId === ownerUserId && mapIds.includes(r.mapId) && r.revokedAt === null) r.revokedAt = at;
    },
    async deleteForOwner(userId) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.ownerUserId === userId) rows.splice(i, 1);
    },
    async activeFor(ownerUserId, mapId, reviewId) {
      const row = rows.findLast((r) => r.ownerUserId === ownerUserId && r.mapId === mapId && r.reviewId === reviewId && r.revokedAt === null);
      return row ? { createdAt: row.createdAt } : null;
    },
  };
}

export interface MemoryCompanyNames extends CompanyNames, CompanyNameLookup {
  /** The name each user gave their company. */
  readonly names: Map<string, string>;
}

/** `owned`: the company id each user already has (user id to company id); anyone else gets a new one on first use. */
export function createMemoryCompanyNames(owned: Record<string, string> = {}): MemoryCompanyNames {
  const names = new Map<string, string>();
  const ids = new Map<string, string>(Object.entries(owned));
  const zones = new Map<string, string>();
  return {
    names,
    async rename(userId, name) { names.set(userId, name); },
    async timeZoneOf(userId) { return zones.get(userId) ?? null; },
    async setTimeZone(userId, timeZone) {
      if (!ids.has(userId)) ids.set(userId, newCompanyId());
      zones.set(userId, timeZone);
    },
    async forUser(userId) {
      if (!ids.has(userId)) ids.set(userId, newCompanyId());
      return { companyId: ids.get(userId)!, name: names.get(userId) ?? '' };
    },
    async nameOf(userId) {
      // Read only: a user with no company yet gets none made.
      if (names.has(userId)) return names.get(userId)!;
      return ids.has(userId) ? '' : null;
    },
  };
}

export interface MemoryEventSink extends EventSink {
  readonly events: CommandEvent[];
}

export function createMemoryEventSink(): MemoryEventSink {
  const events: CommandEvent[] = [];
  return {
    events,
    async record(e) { events.push(structuredClone(e)); },
    async latestByEntity(fileId, change) {
      const latest: Record<string, IsoDateTime> = {};
      for (const e of events) {
        if (e.fileId !== fileId || e.change !== change) continue;
        for (const id of e.entityIds) if (!(id in latest) || e.at > latest[id]!) latest[id] = e.at;
      }
      return latest;
    },
  };
}

export interface MemoryWebhooks extends WebhookStore {
  /** A company server's workspaces and their members (plan 15), for a test to fill: the workspace's events reach them. */
  readonly members: Map<string, string[]>;
  /** Every webhook, with its secret as made, and when it was last turned on (null until a Turn on). */
  readonly rows: Array<WebhookInfo & { userId: string; secret: string; turnedOnAt: string | null }>;
  /**
   * Every delivery queued, oldest first. `status`: the last answer code a test sets, null until then; `doneAt` and
   * `givenUpAt` a test sets too, as the sender would.
   */
  readonly deliveries: Array<{
    id: string; webhookId: string; userId: string; type: string; data: Record<string, string>; occurredAt: string; status: number | null;
    doneAt: string | null; givenUpAt: string | null;
  }>;
  /** The marks made, as `userId key`. */
  readonly marks: Set<string>;
}

/**
 * Webhooks in memory. An address is fine when it is https and its host isn't a private one by its look (10.*, 127.*,
 * 192.168.*, localhost): a stand-in for platform's `checkTarget`, which resolves names.
 */
export function createMemoryWebhooks(now: () => string = () => TEST_NOW): MemoryWebhooks {
  const rows: MemoryWebhooks['rows'] = [];
  const deliveries: MemoryWebhooks['deliveries'] = [];
  const marks = new Set<string>();
  const members = new Map<string, string[]>();
  /** The webhooks an owner's events reach, as `TursoWebhooks` does: a person's own; a workspace's, every member's. */
  const reachedBy = (key: string) => (r: { userId: string }) => r.userId === key || (members.get(key) ?? []).includes(r.userId);
  const plain = ({ id, url, events, status, createdAt }: WebhookInfo): WebhookInfo => ({ id, url, events: [...events], status, createdAt });
  const queue = (userId: string, webhookIds: string[], type: string, data: Record<string, string>): string => {
    const id = `evt_${randomSuffix(16)}`;
    for (const webhookId of webhookIds) {
      deliveries.push({ id, webhookId, userId, type, data: { ...data }, occurredAt: now(), status: null, doneAt: null, givenUpAt: null });
    }
    return id;
  };
  const store: MemoryWebhooks = {
    rows, deliveries, marks, members,
    async list(userId) { return rows.filter((r) => r.userId === userId).map(plain); },
    async subscriptions(userId): Promise<WebhookSubscription[]> {
      return rows.filter(reachedBy(userId)).filter((r) => r.status === 'active').map((r) => ({
        id: r.id, events: [...r.events], activeSince: r.turnedOnAt ?? r.createdAt,
      }));
    },
    async create({ userId, url, events }) {
      const bytes = crypto.getRandomValues(new Uint8Array(24));
      const secret = `whsec_${btoa(String.fromCharCode(...bytes))}`;
      const row = { id: `wh_${randomSuffix(16)}`, userId, url, events: [...events], status: 'active' as const, createdAt: now(), secret, turnedOnAt: null };
      rows.push(row);
      return { webhook: plain(row), secret };
    },
    async remove(userId, id) {
      const at = rows.findIndex((r) => r.id === id && r.userId === userId);
      if (at === -1) return false;
      rows.splice(at, 1);
      for (let i = deliveries.length - 1; i >= 0; i--) if (deliveries[i]!.webhookId === id) deliveries.splice(i, 1);
      return true;
    },
    async setStatus(userId, id, status) {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      if (!row) return false;
      if (status === 'active' && row.status !== 'active') {
        row.turnedOnAt = now();
        // What waited while it was off is dropped; delivered and given-up ones stay.
        for (let i = deliveries.length - 1; i >= 0; i--) {
          const d = deliveries[i]!;
          if (d.webhookId === id && d.doneAt === null && d.givenUpAt === null) deliveries.splice(i, 1);
        }
      }
      row.status = status;
      return true;
    },
    async recentDeliveries(userId, id, limit): Promise<WebhookDelivery[] | null> {
      if (!rows.some((r) => r.id === id && r.userId === userId)) return null;
      return deliveries.filter((d) => d.webhookId === id).reverse().slice(0, limit)
        .map(({ id: eventId, occurredAt, type, status }) => ({ id: eventId, at: occurredAt, type, status }));
    },
    async enqueue(userId, type, data, markKey, only) {
      if (only !== undefined && only.length === 0) return;
      if (markKey !== undefined) {
        if (marks.has(`${userId} ${markKey}`)) return;
        marks.add(`${userId} ${markKey}`);
      }
      const to = rows.filter((r) => reachedBy(userId)(r) && r.status === 'active' && r.events.includes(type) && (only === undefined || only.includes(r.id)))
        .map((r) => r.id);
      if (to.length > 0) queue(userId, to, type, data);
    },
    async sendTest(userId, id) {
      const row = rows.find((r) => r.id === id && r.userId === userId);
      return row ? queue(userId, [row.id], WEBHOOK_TEST_EVENT, { webhookId: row.id }) : null;
    },
    async resend(userId, webhookId, deliveryId): Promise<ResendOutcome> {
      const row = rows.find((r) => r.id === webhookId && r.userId === userId);
      const d = row && deliveries.find((x) => x.webhookId === webhookId && x.id === deliveryId);
      if (!row || !d) return 'not_found';
      if (row.status !== 'active') return 'off';
      const failed = d.doneAt === null && d.status !== null && !(d.status >= 200 && d.status < 300);
      if (!failed) return 'not_failed';
      d.status = null;
      d.givenUpAt = null;
      return 'queued';
    },
    async checkTarget(url): Promise<TargetCheck> {
      let parsed: URL;
      try { parsed = new URL(url); } catch { return { ok: false, reason: 'not_https' }; }
      if (parsed.protocol !== 'https:') return { ok: false, reason: 'not_https' };
      if (parsed.username !== '' || parsed.password !== '') return { ok: false, reason: 'has_credentials' };
      return /^(10\.|127\.|192\.168\.|localhost$|\[)/.test(parsed.hostname) ? { ok: false, reason: 'private_address' } : { ok: true };
    },
  };
  return store;
}

type ProposalRow = Omit<ProposalEntry, 'agentName' | 'makerOn'>;

export interface MemoryProposals extends ProposalIndex {
  /** Every proposal, in the order added. */
  readonly rows: ProposalRow[];
  /** The person allows an app: a grant that is on, as a consent row in our database. */
  allowApp(userId: string, clientId: string, appName: string): void;
  /** Turn off in Settings: the grant goes. */
  turnOffApp(userId: string, clientId: string): void;
  /** The person makes a key, on. */
  addKey(userId: string, keyId: string, name: string): void;
  /** Turn off in Settings: the key stays, turned off. */
  turnOffKey(userId: string, keyId: string): void;
}

/**
 * The proposal index in memory, as platform's `TursoProposals` keeps it. An app or a key is on only once a test allows
 * it (`allowApp`, `addKey`), as in our database, where the index reads the person's grants and keys.
 */
export function createMemoryProposals(): MemoryProposals {
  const rows: ProposalRow[] = [];
  const apps: Array<{ userId: string; clientId: string; appName: string }> = [];
  const keys = new Map<string, { userId: string; name: string; on: boolean }>();
  const copy = (r: ProposalRow): ProposalRow => ({ ...r, madeBy: { ...r.madeBy } });
  const view = (r: ProposalRow): ProposalEntry => {
    const m = r.madeBy;
    // The person whose apps and keys made it: a company server's member, else the proposal's person (plan 15).
    const person = m.personId ?? r.userId;
    if (m.kind === 'key') {
      const key = keys.get(m.keyId);
      const own = key?.userId === person ? key : undefined;
      return { ...copy(r), agentName: cleanAgentName(own?.name ?? ''), makerOn: own?.on ?? false };
    }
    const on = apps.some((a) => a.userId === person && makerKey(appMaker(a.appName, a.clientId, m.personId)) === makerKey(m));
    return { ...copy(r), agentName: m.agentName || COPY.AGENT_FALLBACK_NAME, makerOn: on };
  };
  const newestFirst = (a: ProposalRow, b: ProposalRow) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
  const own = (userId: string, id: string) => rows.find((r) => r.userId === userId && r.id === id);
  return {
    rows,
    allowApp(userId, clientId, appName) {
      if (!apps.some((a) => a.userId === userId && a.clientId === clientId)) apps.push({ userId, clientId, appName });
    },
    turnOffApp(userId, clientId) {
      const at = apps.findIndex((a) => a.userId === userId && a.clientId === clientId);
      if (at !== -1) apps.splice(at, 1);
    },
    addKey(userId, keyId, name) { keys.set(keyId, { userId, name, on: true }); },
    turnOffKey(userId, keyId) {
      const key = keys.get(keyId);
      if (key?.userId === userId) key.on = false;
    },
    async add(entry, replaces) {
      // One batch: nothing changes when the new row can't be written.
      if (rows.some((r) => r.id === entry.id)) throw new Error('proposals_add_failed');
      const old = replaces === null ? undefined : own(entry.userId, replaces);
      if (old?.status === 'waiting') Object.assign(old, { status: 'replaced', answeredAt: entry.createdAt });
      rows.push(copy({ ...entry, status: 'waiting', answeredAt: null }));
    },
    async get(userId, id) {
      const row = own(userId, id);
      return row ? view(row) : null;
    },
    async list(userId, { since, maker, status, proposalId }) {
      return rows.filter((r) => r.userId === userId && r.createdAt >= since && (maker === undefined || sameMaker(r.madeBy, maker))
        && (status === undefined || r.status === status) && (proposalId === undefined || r.id === proposalId)).sort(newestFirst).map(view);
    },
    async waiting(userId, kind, target, maker) {
      const found = rows.filter((r) => r.userId === userId && r.status === 'waiting' && r.kind === kind && sameTarget(r, target)
        && sameMaker(r.madeBy, maker)).sort(newestFirst)[0];
      return found ? view(found) : null;
    },
    async answer(userId, id, to, at) {
      const row = own(userId, id);
      if (row?.status !== 'waiting') return false;
      Object.assign(row, { status: to, answeredAt: at });
      return true;
    },
    async countWaiting(userId, now, fileId) {
      const byMaker: Record<string, number> = {};
      let total = 0;
      for (const r of rows) {
        if (r.userId !== userId || r.fileId !== fileId || r.status !== 'waiting' || r.expiresAt <= now) continue;
        total += 1;
        const key = makerKey(r.madeBy);
        byMaker[key] = (byMaker[key] ?? 0) + 1;
      }
      return { total, byMaker };
    },
    async expire(now) {
      let n = 0;
      for (const r of rows) {
        if (r.status !== 'waiting' || r.expiresAt > now) continue;
        Object.assign(r, { status: 'expired', answeredAt: r.expiresAt });
        n += 1;
      }
      return n;
    },
    async prune(answeredBefore) {
      let n = 0;
      for (let i = rows.length - 1; i >= 0; i--) {
        const r = rows[i]!;
        if (r.status !== 'waiting' && r.answeredAt !== null && r.answeredAt < answeredBefore) {
          rows.splice(i, 1);
          n += 1;
        }
      }
      return n;
    },
    async deleteForUser(userId) {
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.userId === userId) rows.splice(i, 1);
    },
  };
}

/**
 * The commands' dependencies in memory with a fixed clock, for tests and the demo. `companies`: the company id each
 * user already has (user id to company id). Commands refuse any other company id for that user.
 */
export function makeTestDeps({ companies = {} }: { companies?: Record<string, string> } = {}): Deps & {
  directory: MemoryDirectory; events: MemoryEventSink; companies: MemoryCompanyNames; shareLinks: MemoryShareLinks; reviewLinks: MemoryReviewLinks;
  mapLinks: MemoryMapLinks; mapSessions: MemoryMapSessions; mapEvents: MemoryMapEventLog; webhooks: MemoryWebhooks; proposals: MemoryProposals;
} {
  let n = 0;
  const access = createMemoryMapAccess();
  return {
    partnerBooks: createMemoryPartnerBookStore(),
    markets: createMemoryMarketStore(),
    programs: createMemoryProgramStore(),
    companyFacts: createMemoryCompanyFactsStore(),
    cases: createMemoryCaseStore(),
    maps: createMemoryMapStore(),
    directory: createMemoryDirectory(),
    shareLinks: createMemoryShareLinks(),
    reviewLinks: createMemoryReviewLinks(),
    mapLinks: access.links,
    mapSessions: access.sessions,
    mapEvents: createMemoryMapEventLog(),
    rateLimits: access.limiter,
    companies: createMemoryCompanyNames(companies),
    events: createMemoryEventSink(),
    webhooks: createMemoryWebhooks(),
    proposals: createMemoryProposals(),
    clock: () => TEST_NOW,
    log: () => {},
    ids: { event: () => `ev_${++n}` },
  };
}

/**
 * A company server's workspace in memory (plan 15): the same rules as `TursoWorkspace`, the same contract. `seq` stands
 * for the database's rowid: lists sort by time, then by it, and a second invite to an address keeps the first one's.
 */
export function createMemoryWorkspace(now: () => Date = () => new Date(TEST_NOW)): Workspace {
  let key: string | null = null;
  let seq = 0;
  const members = new Map<string, { member: WorkspaceMember; seq: number }>();
  const invites = new Map<string, { invite: WorkspaceInvite; seq: number }>();
  const isOpen = (i: WorkspaceInvite, at: string): boolean => i.expiresAt > at;
  const admins = (): number => [...members.values()].filter(({ member }) => member.role === 'admin').length;
  const refusal = (personId: string, staysAdmin: boolean): MemberRefusal | null => {
    const m = members.get(personId)?.member;
    if (!m) return 'notMember';
    return m.role === 'admin' && !staysAdmin && admins() <= 1 ? 'lastAdmin' : null;
  };
  const add = (personId: string, role: WorkspaceRole, addedBy: string | null, addedAt: string): WorkspaceMember => {
    const had = members.get(personId);
    if (had) return { ...had.member };
    const member = { personId, role, addedBy, addedAt };
    members.set(personId, { member, seq: ++seq });
    return { ...member };
  };
  return {
    key: async () => (key ??= newWorkspaceId()),
    member: async (personId) => {
      const m = members.get(personId)?.member;
      return m ? { ...m } : null;
    },
    members: async () => [...members.values()]
      .sort((a, b) => a.member.addedAt.localeCompare(b.member.addedAt) || a.seq - b.seq).map(({ member }) => ({ ...member })),
    addMember: async ({ personId, role, addedBy }) => add(personId, role, addedBy, now().toISOString()),
    setRole: async (personId, role) => {
      const refused = refusal(personId, role === 'admin');
      if (refused) return refused;
      members.get(personId)!.member.role = role;
      return null;
    },
    removeMember: async (personId) => {
      const refused = refusal(personId, false);
      if (refused) return refused;
      members.delete(personId);
      return null;
    },
    invite: async ({ email, role, invitedBy }) => {
      const at = now();
      const invite: WorkspaceInvite = {
        id: newInviteId(), email: normalEmail(email), role, invitedBy, createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + INVITE_DAYS * 24 * 60 * 60_000).toISOString(),
      };
      invites.set(invite.email, { invite, seq: invites.get(invite.email)?.seq ?? ++seq });
      return { ...invite };
    },
    openInvites: async () => {
      const at = now().toISOString();
      return [...invites.values()].filter(({ invite }) => isOpen(invite, at))
        .sort((a, b) => b.invite.createdAt.localeCompare(a.invite.createdAt) || b.seq - a.seq).map(({ invite }) => ({ ...invite }));
    },
    inviteFor: async (email) => {
      const i = invites.get(normalEmail(email))?.invite;
      return i && isOpen(i, now().toISOString()) ? { ...i } : null;
    },
    cancelInvite: async (id) => {
      const found = [...invites.values()].find(({ invite }) => invite.id === id);
      if (!found) return false;
      invites.delete(found.invite.email);
      return true;
    },
    acceptInvite: async (email, personId) => {
      const at = now().toISOString();
      const i = invites.get(normalEmail(email))?.invite;
      if (!i || !isOpen(i, at)) return null;
      invites.delete(i.email);
      return add(personId, i.role, i.invitedBy, at);
    },
    pruneExpiredInvites: async () => {
      const at = now().toISOString();
      const gone = [...invites.values()].filter(({ invite }) => !isOpen(invite, at));
      for (const { invite } of gone) invites.delete(invite.email);
      return gone.length;
    },
  };
}

import { and, asc, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import {
  DuplicateEntry, type CaseEntry, type CaseListing, type Directory, type JobMap, type MapEntry, type MapListing, type MapNotifySettings,
  type MapNotifyState, type MarketListing, type ProgramEntry, type ProgramListing,
} from '@partner-desk/commands';
import type { ProgramType } from '@partner-desk/core';
import type { PartnerType } from '@partner-desk/method';
import type { Db } from './client';
import { guarded } from './guarded';
import { businessCases, companyFacts, maps, markets, partnerBooks, programs } from './schema';

/** SQLite reports a unique-index or primary-key violation as SQLITE_CONSTRAINT. */
const isConstraintError = (error: unknown): boolean => {
  const text = error instanceof Error ? `${error.message} ${String((error as { code?: unknown }).code ?? '')} ${String(error.cause ?? '')}` : '';
  return /SQLITE_CONSTRAINT|UNIQUE constraint failed/.test(text);
};

const MAP_ENTRY = {
  fileId: maps.fileId, ownerUserId: maps.ownerUserId, companyId: maps.companyId, partnerId: maps.partnerId, partnerType: maps.partnerType,
  displayName: maps.displayName, createdAt: maps.createdAt, startedOn: maps.startedOn, datesMovedFor: maps.datesMovedFor,
  datesMoveFailedFor: maps.datesMoveFailedFor, lastChangeAt: maps.lastChangeAt,
};
const HEALTHS = new Set(['on_track', 'at_risk', 'off_track']);
const ALERTS = new Set(['instant', 'daily', 'off']);

/** A MAP's email settings as stored, read tolerantly: anything that can't be read counts as not set. */
function readSettings(stored: string): MapNotifySettings {
  let raw: unknown;
  try {
    raw = JSON.parse(stored);
  } catch {
    return {};
  }
  if (typeof raw !== 'object' || raw === null) return {};
  const { dueSoonDays, partnerDigest, partnerAlerts } = raw as Record<string, unknown>;
  return {
    ...(typeof dueSoonDays === 'number' && Number.isInteger(dueSoonDays) ? { dueSoonDays } : {}),
    ...(typeof partnerDigest === 'boolean' ? { partnerDigest } : {}),
    ...(typeof partnerAlerts === 'string' && ALERTS.has(partnerAlerts) ? { partnerAlerts: partnerAlerts as MapNotifySettings['partnerAlerts'] } : {}),
  };
}

type Healthish = MapNotifyState['momentumState'];
const health = (value: string | null): Healthish => (value !== null && HEALTHS.has(value) ? value as Healthish : null);

const NOTIFY_COLUMNS = {
  settings: maps.notifySettings, momentumState: maps.momentumState, pausedReason: maps.pausedReason, digestHealth: maps.digestHealth,
  webhookHealth: maps.webhookHealth, partnerAlertsThrough: maps.partnerAlertsThrough,
};

interface NotifyRow {
  settings: string; momentumState: string | null; pausedReason: string | null; digestHealth: string | null; webhookHealth: string | null;
  partnerAlertsThrough: number | null;
}

/** The MAP's email state as stored, read tolerantly. */
const toNotifyState = (row: NotifyRow): MapNotifyState => ({
  settings: readSettings(row.settings), momentumState: health(row.momentumState), pausedReason: row.pausedReason,
  digestHealth: health(row.digestHealth), webhookHealth: health(row.webhookHealth), partnerAlertsThrough: row.partnerAlertsThrough,
});

const asMapEntry = (row: Omit<MapEntry, 'partnerType'> & { partnerType: string }): MapEntry => ({ ...row, partnerType: row.partnerType as PartnerType });

/**
 * Which file belongs to whom: the Partner book and the Company facts of each company, each market, each program, each
 * business case and each MAP. Ids, display names, partner types, dates and a MAP's email settings only.
 */
export class TursoDirectory implements Directory {
  constructor(private readonly db: Db, private readonly now: () => string = () => new Date().toISOString()) {}

  async partnerBook(companyId: string): Promise<{ fileId: string; ownerUserId: string } | null> {
    return guarded('partner_books_read_failed', async () => {
      const [row] = await this.db.select({ fileId: partnerBooks.fileId, ownerUserId: partnerBooks.ownerUserId })
        .from(partnerBooks).where(eq(partnerBooks.companyId, companyId)).limit(1);
      return row ?? null;
    });
  }

  async market(marketId: string): Promise<{ fileId: string; ownerUserId: string; companyId: string; displayName: string } | null> {
    return guarded('markets_read_failed', async () => {
      const [row] = await this.db.select({
        fileId: markets.fileId, ownerUserId: markets.ownerUserId, companyId: markets.companyId, displayName: markets.displayName,
      })
        .from(markets).where(eq(markets.id, marketId)).limit(1);
      return row ?? null;
    });
  }

  async markets(companyId: string): Promise<MarketListing[]> {
    return guarded('markets_list_failed', async () => {
      const rows = await this.db.select().from(markets).where(eq(markets.companyId, companyId)).orderBy(asc(markets.createdAt), asc(markets.id));
      return rows.map((row) => ({ marketId: row.id, displayName: row.displayName, ownerUserId: row.ownerUserId, archived: row.archivedAt !== null }));
    });
  }

  async addMarket(entry: { marketId: string; companyId: string; ownerUserId: string; fileId: string; displayName: string }): Promise<void> {
    try {
      await this.db.insert(markets).values({
        id: entry.marketId, companyId: entry.companyId, ownerUserId: entry.ownerUserId, fileId: entry.fileId,
        displayName: entry.displayName, createdAt: this.now(),
      });
    } catch (error) {
      if (isConstraintError(error)) throw new DuplicateEntry();
      // Driver errors carry the query's parameters (display name, file id): only the operation's name may leave here.
      throw new Error('markets_add_failed');
    }
  }

  async addPartnerBook(entry: { companyId: string; ownerUserId: string; fileId: string }): Promise<void> {
    try {
      await this.db.insert(partnerBooks).values({ companyId: entry.companyId, ownerUserId: entry.ownerUserId, fileId: entry.fileId, createdAt: this.now() });
    } catch (error) {
      if (isConstraintError(error)) throw new DuplicateEntry();
      throw new Error('partner_books_add_failed');
    }
  }

  async replacePartnerBook(entry: { companyId: string; ownerUserId: string; oldFileId: string; fileId: string }): Promise<void> {
    let changed: Array<{ companyId: string }>;
    try {
      changed = await this.db.update(partnerBooks).set({ fileId: entry.fileId })
        .where(and(eq(partnerBooks.companyId, entry.companyId), eq(partnerBooks.ownerUserId, entry.ownerUserId), eq(partnerBooks.fileId, entry.oldFileId)))
        .returning({ companyId: partnerBooks.companyId });
    } catch (error) {
      if (isConstraintError(error)) throw new DuplicateEntry();
      throw new Error('partner_books_replace_failed');
    }
    // Compare and swap: no row matched, so the book no longer points at the old file.
    if (changed.length === 0) throw new DuplicateEntry();
  }

  async rename(marketId: string, displayName: string): Promise<void> {
    await guarded('markets_rename_failed', () => this.db.update(markets).set({ displayName }).where(eq(markets.id, marketId)));
  }

  async setArchived(marketId: string, at: string | null): Promise<void> {
    await guarded('markets_archive_failed', () => this.db.update(markets).set({ archivedAt: at }).where(eq(markets.id, marketId)));
  }

  async companyFacts(companyId: string): Promise<{ fileId: string; ownerUserId: string } | null> {
    return guarded('company_facts_read_failed', async () => {
      const [row] = await this.db.select({ fileId: companyFacts.fileId, ownerUserId: companyFacts.ownerUserId })
        .from(companyFacts).where(eq(companyFacts.companyId, companyId)).limit(1);
      return row ?? null;
    });
  }

  async addCompanyFacts(entry: { companyId: string; ownerUserId: string; fileId: string }): Promise<void> {
    try {
      await this.db.insert(companyFacts).values({ companyId: entry.companyId, ownerUserId: entry.ownerUserId, fileId: entry.fileId, createdAt: this.now() });
    } catch (error) {
      if (isConstraintError(error)) throw new DuplicateEntry();
      throw new Error('company_facts_add_failed');
    }
  }

  async program(programId: string): Promise<ProgramEntry | null> {
    return guarded('programs_read_failed', async () => {
      const [row] = await this.db.select({
        fileId: programs.fileId, ownerUserId: programs.ownerUserId, companyId: programs.companyId,
        displayName: programs.displayName, partnerType: programs.partnerType,
      }).from(programs).where(eq(programs.id, programId)).limit(1);
      return row ? { ...row, partnerType: row.partnerType as ProgramType } : null;
    });
  }

  async programs(companyId: string): Promise<ProgramListing[]> {
    return guarded('programs_list_failed', async () => {
      const rows = await this.db.select().from(programs).where(eq(programs.companyId, companyId))
        .orderBy(asc(programs.createdAt), asc(programs.id));
      return rows.map((row) => ({
        programId: row.id, displayName: row.displayName, ownerUserId: row.ownerUserId, partnerType: row.partnerType as ProgramType,
      }));
    });
  }

  async addProgram(entry: ProgramEntry & { programId: string }): Promise<void> {
    try {
      await this.db.insert(programs).values({
        id: entry.programId, companyId: entry.companyId, ownerUserId: entry.ownerUserId, fileId: entry.fileId,
        displayName: entry.displayName, partnerType: entry.partnerType, createdAt: this.now(),
      });
    } catch (error) {
      if (isConstraintError(error)) throw new DuplicateEntry();
      // Driver errors carry the query's parameters (display name, file id): only the operation's name may leave here.
      throw new Error('programs_add_failed');
    }
  }

  async renameProgram(programId: string, displayName: string): Promise<void> {
    await guarded('programs_rename_failed', () => this.db.update(programs).set({ displayName }).where(eq(programs.id, programId)));
  }

  async removeProgram(programId: string): Promise<void> {
    await guarded('programs_remove_failed', () => this.db.delete(programs).where(eq(programs.id, programId)));
  }

  async businessCase(caseId: string): Promise<CaseEntry | null> {
    return guarded('business_cases_read_failed', async () => {
      const [row] = await this.db.select({
        fileId: businessCases.fileId, ownerUserId: businessCases.ownerUserId, companyId: businessCases.companyId,
        partnerId: businessCases.partnerId, partnerType: businessCases.partnerType, displayName: businessCases.displayName,
        createdAt: businessCases.createdAt,
      }).from(businessCases).where(eq(businessCases.id, caseId)).limit(1);
      return row ? { ...row, partnerType: row.partnerType as PartnerType } : null;
    });
  }

  /** Newest first; of two made at the same time, the one listed later first. */
  async businessCases(companyId: string): Promise<CaseListing[]> {
    return guarded('business_cases_list_failed', async () => {
      const rows = await this.db.select().from(businessCases).where(eq(businessCases.companyId, companyId))
        .orderBy(desc(businessCases.createdAt), sql`rowid desc`);
      return rows.map((row) => ({
        caseId: row.id, ownerUserId: row.ownerUserId, partnerId: row.partnerId, partnerType: row.partnerType as PartnerType,
        displayName: row.displayName, createdAt: row.createdAt,
      }));
    });
  }

  async addBusinessCase(entry: CaseEntry & { caseId: string }): Promise<void> {
    try {
      await this.db.insert(businessCases).values({
        id: entry.caseId, companyId: entry.companyId, ownerUserId: entry.ownerUserId, fileId: entry.fileId, partnerId: entry.partnerId,
        partnerType: entry.partnerType, displayName: entry.displayName, createdAt: entry.createdAt,
      });
    } catch (error) {
      if (isConstraintError(error)) throw new DuplicateEntry();
      // Driver errors carry the query's parameters (the title, file id): only the operation's name may leave here.
      throw new Error('business_cases_add_failed');
    }
  }

  async renameBusinessCase(caseId: string, displayName: string): Promise<void> {
    await guarded('business_cases_rename_failed', () => this.db.update(businessCases).set({ displayName }).where(eq(businessCases.id, caseId)));
  }

  async removeBusinessCases(caseIds: string[]): Promise<void> {
    if (caseIds.length === 0) return;
    await guarded('business_cases_remove_failed', () => this.db.delete(businessCases).where(inArray(businessCases.id, caseIds)));
  }

  async map(mapId: string): Promise<MapEntry | null> {
    return guarded('maps_read_failed', async () => {
      const [row] = await this.db.select(MAP_ENTRY).from(maps).where(eq(maps.id, mapId)).limit(1);
      return row ? asMapEntry(row) : null;
    });
  }

  async mapFor(companyId: string, partnerId: string): Promise<(MapEntry & { mapId: string }) | null> {
    return guarded('maps_read_failed', async () => {
      const [row] = await this.db.select({ ...MAP_ENTRY, mapId: maps.id }).from(maps)
        .where(and(eq(maps.companyId, companyId), eq(maps.partnerId, partnerId))).limit(1);
      return row ? asMapEntry(row) as MapEntry & { mapId: string } : null;
    });
  }

  /** Oldest first; of two made at the same time, the one listed first. */
  async maps(companyId: string): Promise<MapListing[]> {
    return guarded('maps_list_failed', async () => {
      const rows = await this.db.select().from(maps).where(eq(maps.companyId, companyId)).orderBy(asc(maps.createdAt), sql`rowid asc`);
      return rows.map((row) => ({
        mapId: row.id, ownerUserId: row.ownerUserId, partnerId: row.partnerId, partnerType: row.partnerType as PartnerType,
        displayName: row.displayName, createdAt: row.createdAt, startedOn: row.startedOn, datesMovedFor: row.datesMovedFor,
        datesMoveFailedFor: row.datesMoveFailedFor, lastChangeAt: row.lastChangeAt,
      }));
    });
  }

  async addMap(
    entry: Omit<MapEntry, 'startedOn' | 'datesMovedFor' | 'datesMoveFailedFor' | 'lastChangeAt'> & { mapId: string; startedOn: string },
  ): Promise<void> {
    try {
      await this.db.insert(maps).values({
        id: entry.mapId, companyId: entry.companyId, ownerUserId: entry.ownerUserId, fileId: entry.fileId, partnerId: entry.partnerId,
        partnerType: entry.partnerType, displayName: entry.displayName, createdAt: entry.createdAt, startedOn: entry.startedOn,
      });
    } catch (error) {
      if (isConstraintError(error)) throw new DuplicateEntry();
      // Driver errors carry the query's parameters (the display name, file id): only the operation's name may leave here.
      throw new Error('maps_add_failed');
    }
  }

  async renameMap(mapId: string, displayName: string): Promise<void> {
    await guarded('maps_rename_failed', () => this.db.update(maps).set({ displayName }).where(eq(maps.id, mapId)));
  }

  async removeMaps(mapIds: string[]): Promise<void> {
    if (mapIds.length === 0) return;
    await guarded('maps_remove_failed', () => this.db.delete(maps).where(inArray(maps.id, mapIds)));
  }

  async setMapDatesMoved(mapId: string, state: { movedFor?: string | null; failedFor: string | null }): Promise<void> {
    const set = { datesMoveFailedFor: state.failedFor, ...(state.movedFor !== undefined ? { datesMovedFor: state.movedFor } : {}) };
    await guarded('maps_update_failed', () => this.db.update(maps).set(set).where(eq(maps.id, mapId)));
  }

  async setMapLastChange(mapId: string, at: string): Promise<void> {
    await guarded('maps_update_failed', () => this.db.update(maps).set({ lastChangeAt: at }).where(eq(maps.id, mapId)));
  }

  async mapNotifyState(mapId: string): Promise<MapNotifyState | null> {
    return guarded('maps_read_failed', async () => {
      const [row] = await this.db.select(NOTIFY_COLUMNS).from(maps).where(eq(maps.id, mapId)).limit(1);
      return row ? toNotifyState(row) : null;
    });
  }

  async setMapNotifyState(mapId: string, state: Partial<Omit<MapNotifyState, 'webhookHealth'>>): Promise<void> {
    const set = {
      ...(state.settings !== undefined ? { notifySettings: JSON.stringify(state.settings) } : {}),
      ...(state.momentumState !== undefined ? { momentumState: state.momentumState } : {}),
      ...(state.pausedReason !== undefined ? { pausedReason: state.pausedReason } : {}),
      ...(state.digestHealth !== undefined ? { digestHealth: state.digestHealth } : {}),
      ...(state.partnerAlertsThrough !== undefined ? { partnerAlertsThrough: state.partnerAlertsThrough } : {}),
    };
    if (Object.keys(set).length === 0) return;
    await guarded('maps_update_failed', () => this.db.update(maps).set(set).where(eq(maps.id, mapId)));
  }

  async setMapWebhookHealth(mapId: string, value: MapNotifyState['webhookHealth']): Promise<void> {
    await guarded('maps_update_failed', () => this.db.update(maps).set({ webhookHealth: value }).where(eq(maps.id, mapId)));
  }

  /** One update for all of the person's MAPs: the health their webhooks last heard of goes. */
  async forgetWebhookHealth(ownerUserId: string): Promise<void> {
    await guarded('maps_update_failed', () => this.db.update(maps).set({ webhookHealth: null }).where(eq(maps.ownerUserId, ownerUserId)));
  }

  /** Every MAP, oldest first, with its email state: the scheduled job's list. */
  async jobMaps(): Promise<JobMap[]> {
    return guarded('maps_list_failed', async () => {
      const rows = await this.db.select({ ...MAP_ENTRY, mapId: maps.id, ...NOTIFY_COLUMNS }).from(maps).orderBy(asc(maps.createdAt), sql`rowid asc`);
      return rows.map(({ settings, momentumState, pausedReason, digestHealth, webhookHealth, partnerAlertsThrough, ...entry }) => ({
        ...asMapEntry(entry), mapId: entry.mapId,
        notify: toNotifyState({ settings, momentumState, pausedReason, digestHealth, webhookHealth, partnerAlertsThrough }),
      }));
    });
  }

  /** Pauses the MAP's emails (its owner's Google access broke): true only when this call paused it. */
  async pauseMap(mapId: string): Promise<boolean> {
    return guarded('maps_update_failed', async () => {
      const rows = await this.db.update(maps).set({ pausedReason: 'auth' })
        .where(and(eq(maps.id, mapId), isNull(maps.pausedReason))).returning({ id: maps.id });
      return rows.length > 0;
    });
  }

  async resumeMaps(mapIds: string[]): Promise<string[]> {
    if (mapIds.length === 0) return [];
    return guarded('maps_update_failed', async () => {
      const rows = await this.db.update(maps).set({ pausedReason: null })
        .where(and(inArray(maps.id, mapIds), isNotNull(maps.pausedReason))).returning({ id: maps.id });
      return rows.map((r) => r.id);
    });
  }

  /** Account deletion, read-only: the ids of this user's MAPs. */
  async mapIdsForOwner(userId: string): Promise<string[]> {
    return guarded('directory_file_ids_failed', async () => {
      const rows = await this.db.select({ id: maps.id }).from(maps).where(eq(maps.ownerUserId, userId));
      return rows.map((row) => row.id);
    });
  }

  /** Account deletion, read-only: the file ids of this user's markets, programs, cases, MAPs, Company facts and Partner book. */
  async fileIdsForOwner(userId: string): Promise<string[]> {
    return guarded('directory_file_ids_failed', async () => {
      const rows = await this.db.select({ fileId: markets.fileId }).from(markets).where(eq(markets.ownerUserId, userId));
      const books = await this.db.select({ fileId: partnerBooks.fileId }).from(partnerBooks).where(eq(partnerBooks.ownerUserId, userId));
      const owned = await this.db.select({ fileId: programs.fileId }).from(programs).where(eq(programs.ownerUserId, userId));
      const facts = await this.db.select({ fileId: companyFacts.fileId }).from(companyFacts).where(eq(companyFacts.ownerUserId, userId));
      const cases = await this.db.select({ fileId: businessCases.fileId }).from(businessCases).where(eq(businessCases.ownerUserId, userId));
      const plans = await this.db.select({ fileId: maps.fileId }).from(maps).where(eq(maps.ownerUserId, userId));
      return [...rows, ...books, ...owned, ...facts, ...cases, ...plans].map((row) => row.fileId);
    });
  }

  /**
   * Account deletion: removes this user's market, program, business case, MAP, Company facts and Partner book rows,
   * and says which files they were.
   */
  async deleteForOwner(userId: string): Promise<{ fileIds: string[] }> {
    return guarded('directory_delete_failed', async () => {
      const gone = await this.db.delete(markets).where(eq(markets.ownerUserId, userId)).returning({ fileId: markets.fileId });
      const owned = await this.db.delete(programs).where(eq(programs.ownerUserId, userId)).returning({ fileId: programs.fileId });
      const cases = await this.db.delete(businessCases).where(eq(businessCases.ownerUserId, userId)).returning({ fileId: businessCases.fileId });
      const plans = await this.db.delete(maps).where(eq(maps.ownerUserId, userId)).returning({ fileId: maps.fileId });
      const facts = await this.db.delete(companyFacts).where(eq(companyFacts.ownerUserId, userId)).returning({ fileId: companyFacts.fileId });
      const book = await this.db.delete(partnerBooks).where(eq(partnerBooks.ownerUserId, userId)).returning({ fileId: partnerBooks.fileId });
      return { fileIds: [...gone, ...owned, ...cases, ...plans, ...facts, ...book].map((row) => row.fileId) };
    });
  }
}

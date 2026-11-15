import { and, eq, inArray } from 'drizzle-orm';
import type { IsoDateTime } from '@partner-desk/core';
import type { CommandEvent, EventSink } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { events } from './schema';

type Log = (message: 'event_failed' | 'events_read_failed', fields: Record<string, string>) => void;

/**
 * Ids only. Best effort: a failed insert is logged with the event's id and never thrown, because the work the
 * event describes has already happened (a file is written) and the person must not see it fail.
 */
export class TursoEventSink implements EventSink {
  constructor(private readonly db: Db, private readonly log: Log = (message, fields) => console.error(message, fields)) {}

  async record(e: CommandEvent): Promise<void> {
    try {
      await this.db.insert(events).values({
        id: e.id, at: e.at, command: e.command, actorKind: e.actorKind, actorUserId: e.actorUserId, fileId: e.fileId,
        entityIds: e.entityIds.join(','), change: e.change ?? null, proposalId: e.proposalId ?? null,
      });
    } catch {
      // The driver's error would carry the query's parameters; only the event's id is logged.
      try { this.log('event_failed', { eventId: e.id }); } catch { /* logging must not throw either */ }
    }
  }

  /** Best effort, like `record`: a failed read is logged with the file id only and gives nothing. */
  async latestByEntity(fileId: string, change: string): Promise<Record<string, IsoDateTime>> {
    try {
      const rows = await this.db.select({ at: events.at, entityIds: events.entityIds }).from(events)
        .where(and(eq(events.fileId, fileId), eq(events.change, change)));
      const latest: Record<string, IsoDateTime> = {};
      for (const row of rows) {
        for (const id of row.entityIds.split(',')) {
          if (id !== '' && (!(id in latest) || row.at > latest[id]!)) latest[id] = row.at as IsoDateTime;
        }
      }
      return latest;
    } catch {
      try { this.log('events_read_failed', { fileId }); } catch { /* logging must not throw either */ }
      return {};
    }
  }

  /** Account deletion: removes the events of these files. */
  async deleteForFiles(fileIds: readonly string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await guarded('events_delete_failed', () => this.db.delete(events).where(inArray(events.fileId, [...fileIds])));
  }

  /**
   * Account deletion: removes every event this user recorded, on any file. Reaches events on a Partner book file the
   * directory no longer lists (a replaced book). Idempotent.
   */
  async deleteForActor(userId: string): Promise<void> {
    await guarded('events_delete_failed', () => this.db.delete(events).where(eq(events.actorUserId, userId)));
  }
}

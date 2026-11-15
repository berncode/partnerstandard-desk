import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { CommandEvent } from '@partner-desk/commands';
import { events } from './schema';
import { createTestDb } from './test-db';
import { TursoEventSink } from './turso-events';

const event = (id: string, fileId = 'f1'): CommandEvent => ({
  id, at: '2026-10-28T10:00:00.000Z', command: 'partners.change', actorKind: 'agent', actorUserId: 'u1', fileId, entityIds: ['p_1', 'p_2'],
});

describe('TursoEventSink', () => {
  it('stores the event with the id the caller gave and ids only', async () => {
    const db = await createTestDb();
    await new TursoEventSink(db).record(event('ev_1'));
    expect(await db.select().from(events)).toEqual([{
      id: 'ev_1', at: '2026-10-28T10:00:00.000Z', command: 'partners.change', actorKind: 'agent', actorUserId: 'u1', fileId: 'f1', entityIds: 'p_1,p_2', change: null,
      proposalId: null,
    }]);
  });

  it('stores the proposal an event carried out, by its id', async () => {
    const db = await createTestDb();
    await new TursoEventSink(db).record({ ...event('ev_1'), actorKind: 'owner', change: 'setStep', proposalId: 'prp_aaaaaaaaaa' });
    expect(await db.select({ change: events.change, proposalId: events.proposalId }).from(events)).toEqual([{ change: 'setStep', proposalId: 'prp_aaaaaaaaaa' }]);
  });

  it('an event insert failure never throws, and logs only the event id', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE events`);
    const logged: unknown[][] = [];
    const sink = new TursoEventSink(db, (...args) => { logged.push(args); });
    await expect(sink.record(event('ev_9'))).resolves.toBeUndefined();
    expect(logged).toEqual([['event_failed', { eventId: 'ev_9' }]]);
  });

  it('survives a log function that throws', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE events`);
    const sink = new TursoEventSink(db, () => { throw new Error('log down'); });
    await expect(sink.record(event('ev_9'))).resolves.toBeUndefined();
  });

  it('latestByEntity gives the newest setStep per partner and ignores other codes and files', async () => {
    const db = await createTestDb();
    const sink = new TursoEventSink(db);
    const at = (day: string) => `2026-10-${day}T10:00:00.000Z`;
    await sink.record({ ...event('ev_1'), at: at('10'), entityIds: ['p_1', 'p_2'], change: 'setStep' });
    await sink.record({ ...event('ev_2'), at: at('20'), entityIds: ['p_1'], change: 'setStep' });
    await sink.record({ ...event('ev_3'), at: at('25'), entityIds: ['p_2'], change: 'close' });
    await sink.record({ ...event('ev_4'), at: at('26'), entityIds: ['p_3'] });
    await sink.record({ ...event('ev_5', 'f2'), at: at('27'), entityIds: ['p_1'], change: 'setStep' });
    expect(await sink.latestByEntity('f1', 'setStep')).toEqual({ p_1: at('20'), p_2: at('10') });
    expect(await sink.latestByEntity('f_none', 'setStep')).toEqual({});
  });

  it('latestByEntity logs events_read_failed and gives nothing when the read fails', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE events`);
    const logged: unknown[][] = [];
    const sink = new TursoEventSink(db, (...args) => { logged.push(args); });
    expect(await sink.latestByEntity('f1', 'setStep')).toEqual({});
    expect(logged).toEqual([['events_read_failed', { fileId: 'f1' }]]);
  });

  it('removes the events of the given files only', async () => {
    const db = await createTestDb();
    const sink = new TursoEventSink(db);
    await sink.record(event('ev_1', 'f1'));
    await sink.record(event('ev_2', 'f2'));
    await sink.deleteForFiles([]);
    await sink.deleteForFiles(['f1']);
    expect((await db.select().from(events)).map((e) => e.id)).toEqual(['ev_2']);
  });

  it('deleteForActor removes every event the user recorded, on any file, and only theirs; twice is fine', async () => {
    const db = await createTestDb();
    const sink = new TursoEventSink(db);
    await sink.record({ ...event('ev_1', 'f1'), actorUserId: 'u_1' });
    await sink.record({ ...event('ev_2', 'f_old_book'), actorUserId: 'u_1' });
    await sink.record({ ...event('ev_3', 'f1'), actorUserId: 'u_2' });
    await sink.deleteForActor('u_1');
    await sink.deleteForActor('u_1');
    expect((await db.select().from(events)).map((e) => e.id)).toEqual(['ev_3']);
  });

  it('fails a delete with an error that names the operation only', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE events`);
    const error = await new TursoEventSink(db).deleteForFiles(['f_secret']).catch((e: unknown) => e);
    expect((error as Error).message).toBe('events_delete_failed');
  });
});

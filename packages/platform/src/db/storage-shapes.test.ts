import { getTableColumns } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import type { FileLock, WriteMarks } from '@partner-desk/storage';
import type { FolderStore } from '@partner-desk/storage/google';
import { events, proposals } from './schema';
import { createTestDb } from './test-db';
import { TursoFolderStore } from './turso-folders';
import { TursoFileLock } from './turso-lock';
import { TursoWriteMarks } from './turso-write-marks';

// Storage defines the small lock, write-mark and folder interfaces it needs and never imports platform. The type
// annotations below fail the typecheck if a Turso class stops fitting them.
describe('Turso stores fit the storage interfaces', () => {
  it('serializes applies on the file id, marks writes and remembers folders through them', async () => {
    const db = await createTestDb();
    const lock: FileLock = new TursoFileLock(db);
    const marks: WriteMarks = new TursoWriteMarks(db);
    const folders: FolderStore = new TursoFolderStore(db);
    const release = await lock.acquire('1shtFileId0001');
    expect(release).not.toBeNull();
    await release!();
    await marks.mark('1shtFileId0001', 5);
    expect(await marks.latest('1shtFileId0001')).toBe(5);
    await folders.set('u_1', 'fold0001');
    expect(await folders.get('u_1')).toBe('fold0001');
  });
});

// Agent proposals spec 7.2 and 11: the index holds ids, codes and times, and the app's name. No score, evidence, reason,
// company name, answer note or person's name: a column for any of them fails here.
describe('the proposal index', () => {
  const shape = (table: typeof proposals | typeof events) => Object.fromEntries(
    Object.values(getTableColumns(table)).map((c) => [c.name, `${c.getSQLType()}${c.notNull ? ' not null' : ''}`]),
  );

  it('the proposals table and events.proposal_id hold ids, codes and times only', () => {
    expect(shape(proposals)).toEqual({
      id: 'text not null', user_id: 'text not null', kind: 'text not null',
      account_id: 'text', partner_id: 'text', market_id: 'text', hypothesis_id: 'text',
      status: 'text not null', created_at: 'text not null', answered_at: 'text', expires_at: 'text not null',
      maker_kind: 'text not null', maker_name: 'text', client_id: 'text', key_id: 'text', maker_person_id: 'text', file_id: 'text not null',
    });
    expect(shape(events)).toMatchObject({ proposal_id: 'text' });
    // The codes are the core lists: a TypeScript enum on a text column.
    expect(proposals.kind.enumValues).toEqual(['fourC', 'stage', 'close', 'signed', 'partners', 'hypothesisStatus', 'marketStatus']);
    expect(proposals.status.enumValues).toEqual(['waiting', 'accepted', 'partly_accepted', 'rejected', 'withdrawn', 'replaced', 'expired']);
    expect(proposals.makerKind.enumValues).toEqual(['app', 'key']);
  });
});

import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from './test-db';
import { TursoWriteMarks } from './turso-write-marks';

describe('TursoWriteMarks', () => {
  it('records the latest write per file and never moves backwards', async () => {
    const marks = new TursoWriteMarks(await createTestDb());
    expect(await marks.latest('f1')).toBeNull();
    await marks.mark('f1', 500);
    await marks.mark('f1', 300);
    expect(await marks.latest('f1')).toBe(500);
    await marks.mark('f1', 900);
    expect(await marks.latest('f1')).toBe(900);
    expect(await marks.latest('f2')).toBeNull();
  });

  it('prunes marks written before the cutoff, counts them, and keeps the rest', async () => {
    const marks = new TursoWriteMarks(await createTestDb());
    await marks.mark('f_old', 999);
    await marks.mark('f_edge', 1_000);
    await marks.mark('f_new', 2_000);
    expect(await marks.prune(1_000)).toBe(1);
    expect(await marks.prune(1_000)).toBe(0);
    expect(await marks.latest('f_old')).toBeNull();
    expect(await marks.latest('f_edge')).toBe(1_000);
    expect(await marks.latest('f_new')).toBe(2_000);
  });

  it('fails a prune with an error that names the operation only', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE file_writes`);
    const error = await new TursoWriteMarks(db).prune(1_000).catch((e: unknown) => e);
    expect((error as Error).message).toBe('file_writes_prune_failed');
  });

  it('forgets the marks of the given files only', async () => {
    const marks = new TursoWriteMarks(await createTestDb());
    await marks.mark('f1', 1);
    await marks.mark('f2', 2);
    await marks.deleteForFiles(['f1']);
    await marks.deleteForFiles([]);
    expect(await marks.latest('f1')).toBeNull();
    expect(await marks.latest('f2')).toBe(2);
  });
});

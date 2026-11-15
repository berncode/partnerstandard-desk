import { describe, expect, it } from 'vitest';
import type { Db } from './client';
import { createTestDb } from './test-db';
import { TursoFileLock } from './turso-lock';

describe('TursoFileLock', () => {
  it('lets one holder at a time have a key', async () => {
    const db = await createTestDb();
    const lock = new TursoFileLock(db, { waitMs: 50, pollMs: 5 });
    const first = await lock.acquire('file-1');
    expect(first).not.toBeNull();
    expect(await lock.acquire('file-1')).toBeNull();
    expect(await lock.acquire('file-2')).not.toBeNull();
    await first!();
    expect(await lock.acquire('file-1')).not.toBeNull();
  });

  it('takes over a lease whose holder died (expired)', async () => {
    const db = await createTestDb();
    let now = 1_000_000;
    const lock = new TursoFileLock(db, { ttlMs: 30_000, waitMs: 0, clock: () => now });
    expect(await lock.acquire('file-1')).not.toBeNull();
    now += 30_001;
    expect(await lock.acquire('file-1')).not.toBeNull();
  });

  it('does not let a stale holder release a newer lease', async () => {
    const db = await createTestDb();
    let now = 1_000_000;
    const lock = new TursoFileLock(db, { ttlMs: 30_000, waitMs: 0, clock: () => now });
    const stale = await lock.acquire('file-1');
    now += 30_001;
    const fresh = await lock.acquire('file-1');
    await stale!();
    expect(fresh).not.toBeNull();
    expect(await lock.acquire('file-1')).toBeNull();
  });

  it('waits for a held key until it is released', async () => {
    const db = await createTestDb();
    const lock = new TursoFileLock(db, { waitMs: 1_000, pollMs: 5 });
    const first = await lock.acquire('file-1');
    setTimeout(() => void first!(), 30);
    expect(await lock.acquire('file-1')).not.toBeNull();
  });

  it('keeps renewing a held lease, so a long apply is not taken over', async () => {
    const db = await createTestDb();
    const lock = new TursoFileLock(db, { ttlMs: 60, renewEveryMs: 15, waitMs: 0 });
    const release = await lock.acquire('file-1');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(await lock.acquire('file-1')).toBeNull();
    await release!();
  });

  it('stops renewing once released', async () => {
    const db = await createTestDb();
    const lock = new TursoFileLock(db, { ttlMs: 60, renewEveryMs: 15, waitMs: 0 });
    const release = await lock.acquire('file-1');
    await release!();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(await lock.acquire('file-1')).not.toBeNull();
  });

  it('returns null instead of rejecting when the database fails', async () => {
    const db = { run: () => Promise.reject(new Error('down')), all: () => Promise.reject(new Error('down')) } as unknown as Db;
    const lock = new TursoFileLock(db, { waitMs: 0 });
    expect(await lock.acquire('file-1')).toBeNull();
  });

  it('forgets the leases of the given files only', async () => {
    const db = await createTestDb();
    const lock = new TursoFileLock(db, { waitMs: 0 });
    await lock.acquire('file-1');
    await lock.acquire('file-2');
    await lock.deleteForFiles(['file-1']);
    await lock.deleteForFiles([]);
    expect(await lock.acquire('file-1')).not.toBeNull();
    expect(await lock.acquire('file-2')).toBeNull();
  });

  it('forgets a file’s proposals lock too, also one a dead holder left', async () => {
    const db = await createTestDb();
    const lock = new TursoFileLock(db, { waitMs: 0 });
    await lock.acquire('file-1:proposals');
    await lock.acquire('file-2:proposals');
    await lock.deleteForFiles(['file-1']);
    expect(await lock.acquire('file-1:proposals')).not.toBeNull();
    expect(await lock.acquire('file-2:proposals')).toBeNull();
  });
});

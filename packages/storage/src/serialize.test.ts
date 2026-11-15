// Serialized writes for both stores, the lock keyed by bare file id.
import { describe, expect, it } from 'vitest';
import type { MarketChange } from '@partner-desk/core';
import { NOW, sampleMarket } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { createMemoryMarketStore } from './memory/market-store';
import { createMemoryPartnerBookStore } from './memory/partner-book-store';
import { lockKeysOf, MemoryFileLock, serializeApplies, type FileLock } from './serialize';
import type { MarketStore } from './types';

const owner = { userId: 'u_1', displayName: 'Anna Keller' };
const stamp = { now: NOW, actor: 'Ruth' };
const statusNote = (text: string): MarketChange => ({ kind: 'updateInfo', patch: { statusNote: text } });

/** A store whose applies take `ms`, recording how many run at once. */
function slowStore(inner: MarketStore, ms: number) {
  let running = 0;
  let peak = 0;
  const slow = async <T>(work: () => Promise<T>) => {
    running += 1;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, ms));
    try {
      return await work();
    } finally {
      running -= 1;
    }
  };
  const store: MarketStore = {
    create: (o, m) => inner.create(o, m),
    read: (r) => inner.read(r),
    urlFor: (r) => inner.urlFor(r),
    discard: (r) => inner.discard(r),
    apply: (ref, change, s) => slow(() => inner.apply(ref, change, s)),
    applyMany: (ref, changes, s) => slow(() => inner.applyMany(ref, changes, s)),
  };
  return { store, peak: () => peak };
}

/** `inner` with an apply that always throws. */
const throwingApply = (inner: MarketStore): MarketStore => ({
  create: (o, m) => inner.create(o, m),
  read: (r) => inner.read(r),
  urlFor: (r) => inner.urlFor(r),
  discard: (r) => inner.discard(r),
  apply: async () => { throw new Error('network'); },
  applyMany: async () => { throw new Error('network'); },
});

const failingRelease: FileLock = { acquire: async () => () => Promise.reject(new Error('release failed')) };

describe('serializeApplies', () => {
  it('passes create, read, urlFor and discard straight through', async () => {
    const memory = createMemoryMarketStore();
    const store = serializeApplies(memory, new MemoryFileLock());
    const { fileId, fileUrl } = await store.create(owner, sampleMarket());
    expect(store.urlFor({ fileId })).toBe(fileUrl);
    expect(await store.read({ fileId })).toEqual(await memory.read({ fileId }));
    await store.discard({ fileId });
    expect(await memory.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('wraps a Partner book store too, keeping its create and its trash', async () => {
    const memory = createMemoryPartnerBookStore();
    const store = serializeApplies(memory, new MemoryFileLock());
    const { fileId } = await store.create(owner, 'co_abcdefghij');
    const read = await store.read({ fileId });
    expect(read.ok && read.snapshot.value.companyId).toBe('co_abcdefghij');
    await store.trash({ fileId });
    expect(await memory.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
  });

  it('runs a Partner book’s exclusive work one at a time per file and scope, with the file’s applies inside it', async () => {
    const keys: string[] = [];
    const memoryLock = new MemoryFileLock();
    const lock: FileLock = { acquire: (key) => { keys.push(key); return memoryLock.acquire(key); } };
    const store = serializeApplies(createMemoryPartnerBookStore(), lock);
    const { fileId } = await store.create(owner, 'co_abcdefghij');
    let running = 0;
    let peak = 0;
    const work = async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      // The file's own lock is another key: an apply inside doesn't wait for the work around it.
      const out = await store.applyMany({ fileId }, [{ kind: 'add', entity: 'account', values: { company: 'Acme' } }], stamp);
      running -= 1;
      return out.ok;
    };
    expect(await Promise.all([store.exclusive!({ fileId }, 'proposals', work), store.exclusive!({ fileId }, 'proposals', work)])).toEqual([true, true]);
    expect(peak).toBe(1);
    expect(keys).toEqual([`${fileId}:proposals`, `${fileId}:proposals`, fileId, fileId]);
  });

  it('answers unavailable when the exclusive lock can’t be had, and runs nothing', async () => {
    const store = serializeApplies(createMemoryPartnerBookStore(), { acquire: async () => null });
    let ran = false;
    expect(await store.exclusive!({ fileId: 'f_1' }, 'proposals', async () => { ran = true; }))
      .toEqual({ ok: false, error: 'unavailable', message: COPY.BUSY_MESSAGE });
    expect(ran).toBe(false);
  });

  it('names every lock key of a file, for account deletion', () => {
    expect(lockKeysOf('f_1')).toEqual(['f_1', 'f_1:proposals']);
  });

  it('holds the lock by the bare file id, so account deletion can remove it by file id', async () => {
    const keys: string[] = [];
    const lock: FileLock = { acquire: async (key) => { keys.push(key); return async () => {}; } };
    const store = serializeApplies(createMemoryMarketStore(), lock);
    const { fileId } = await store.create(owner, sampleMarket());
    await store.apply({ fileId }, statusNote('one'), stamp);
    await store.applyMany({ fileId }, [statusNote('two')], stamp);
    expect(keys).toEqual([fileId, fileId]);
  });

  it('runs applies to the same file one at a time, in order', async () => {
    const slow = slowStore(createMemoryMarketStore(), 20);
    const store = serializeApplies(slow.store, new MemoryFileLock());
    const { fileId } = await store.create(owner, sampleMarket());
    const results = await Promise.all([store.apply({ fileId }, statusNote('one'), stamp), store.apply({ fileId }, statusNote('two'), stamp)]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(slow.peak()).toBe(1);
    const read = await store.read({ fileId });
    expect(read.ok && read.snapshot.value.info.statusNote).toBe('two');
  });

  it('runs a batch and single applies to the same file one at a time', async () => {
    const slow = slowStore(createMemoryMarketStore(), 20);
    const store = serializeApplies(slow.store, new MemoryFileLock());
    const { fileId } = await store.create(owner, sampleMarket());
    const results = await Promise.all([
      store.applyMany({ fileId }, [statusNote('one'), statusNote('two')], stamp), store.apply({ fileId }, statusNote('three'), stamp),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(slow.peak()).toBe(1);
  });

  it('lets different files save at the same time', async () => {
    const slow = slowStore(createMemoryMarketStore(), 20);
    const store = serializeApplies(slow.store, new MemoryFileLock());
    const a = await store.create(owner, sampleMarket());
    const b = await store.create(owner, sampleMarket());
    await Promise.all([store.apply({ fileId: a.fileId }, statusNote('a'), stamp), store.apply({ fileId: b.fileId }, statusNote('b'), stamp)]);
    expect(slow.peak()).toBe(2);
  });

  it('returns unavailable when the lock cannot be had, and writes nothing', async () => {
    const memory = createMemoryMarketStore();
    const lock = new MemoryFileLock({ waitMs: 10 });
    const store = serializeApplies(memory, lock);
    const { fileId } = await store.create(owner, sampleMarket());
    const release = await lock.acquire(fileId);
    expect(await store.apply({ fileId }, statusNote('blocked'), stamp)).toEqual({ ok: false, error: 'unavailable', message: COPY.BUSY_MESSAGE });
    expect(await store.applyMany({ fileId }, [statusNote('blocked')], stamp)).toEqual({ ok: false, error: 'unavailable', message: COPY.BUSY_MESSAGE });
    await release!();
    const read = await store.read({ fileId });
    expect(read.ok && read.snapshot.value.info.statusNote).toBe('Two calls back it up');
  });

  it('releases the lock when the inner apply throws', async () => {
    const lock = new MemoryFileLock({ waitMs: 10 });
    const store = serializeApplies(throwingApply(createMemoryMarketStore()), lock);
    await expect(store.apply({ fileId: 'f1' }, statusNote('x'), stamp)).rejects.toThrow('network');
    expect(await lock.acquire('f1')).not.toBeNull();
  });

  it('still returns the apply result when releasing the lock fails', async () => {
    const memory = createMemoryMarketStore();
    const store = serializeApplies(memory, failingRelease);
    const { fileId } = await store.create(owner, sampleMarket());
    expect((await store.apply({ fileId }, statusNote('saved'), stamp)).ok).toBe(true);
  });

  it('rethrows the apply error, not a release failure', async () => {
    const store = serializeApplies(throwingApply(createMemoryMarketStore()), failingRelease);
    await expect(store.apply({ fileId: 'f1' }, statusNote('x'), stamp)).rejects.toThrow('network');
  });
});

describe('MemoryFileLock', () => {
  it('lets a waiter that timed out give up its place, so a later waiter gets the key after release', async () => {
    const lock = new MemoryFileLock({ waitMs: 20 });
    const a = await lock.acquire('k');
    expect(a).not.toBeNull();
    expect(await lock.acquire('k')).toBeNull();
    const c = lock.acquire('k');
    await a!();
    expect(await c).not.toBeNull();
  });
});

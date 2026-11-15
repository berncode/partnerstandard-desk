// The read cache cases, for both stores.
import { describe, expect, it, vi } from 'vitest';
import { NOW, sampleMarket } from '@partner-desk/core/test-builders';
import { createMemoryMarketStore } from './memory/market-store';
import { createMemoryPartnerBookStore } from './memory/partner-book-store';
import { cacheReads, createReadCache } from './read-cache';
import { MemoryFileLock, serializeApplies } from './serialize';
import { MemoryWriteMarks } from './write-marks';

const owner = { userId: 'u_1', displayName: 'Anna Keller' };
const stamp = { now: NOW, actor: 'Ruth' };

function setup() {
  let now = 0;
  const memory = createMemoryMarketStore();
  const read = vi.spyOn(memory, 'read');
  const cache = createReadCache({ ttlMs: 60_000, clock: () => now });
  const store = cacheReads(memory, cache);
  return { memory, read, store, cache, advance: (ms: number) => { now += ms; } };
}

describe('cacheReads', () => {
  it('drops the cached snapshot when a file is discarded', async () => {
    const { store, read } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    await store.read({ fileId });
    await store.discard({ fileId });
    expect(await store.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('drops the cached snapshot when a Partners file is trashed, and marks it for other instances', async () => {
    const memory = createMemoryPartnerBookStore();
    const read = vi.spyOn(memory, 'read');
    const marks = { mark: vi.fn(async () => {}), latest: vi.fn(async () => null) };
    const store = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => 4242 }), marks);
    const { fileId } = await store.create(owner, 'co_abcdefghij');
    await store.read({ fileId });
    await store.trash({ fileId });
    expect(await store.read({ fileId })).toMatchObject({ ok: false, error: 'file_not_found' });
    expect(read).toHaveBeenCalledTimes(2);
    expect(marks.mark).toHaveBeenCalledWith(fileId, 4242);
  });

  it('serves a second read within 60 seconds from the cache', async () => {
    const { store, read, advance } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    await store.read({ fileId });
    advance(59_000);
    await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reads the file again after 60 seconds, so hand edits show up', async () => {
    const { store, read, advance } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    await store.read({ fileId });
    advance(60_001);
    await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('caches a Partner book store’s reads too, keeping its create', async () => {
    const memory = createMemoryPartnerBookStore();
    const read = vi.spyOn(memory, 'read');
    const store = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => 0 }));
    const { fileId } = await store.create(owner, 'co_abcdefghij');
    await store.read({ fileId });
    const again = await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(1);
    expect(again.ok && again.snapshot.value.companyId).toBe('co_abcdefghij');
  });

  it('passes a Partner book’s exclusive through to the lock beneath, and has none where the store beneath has none', async () => {
    const keys: string[] = [];
    const lock = new MemoryFileLock();
    const locked = serializeApplies(createMemoryPartnerBookStore(), { acquire: (key) => { keys.push(key); return lock.acquire(key); } });
    const store = cacheReads(locked, createReadCache({ ttlMs: 60_000, clock: () => 0 }));
    expect(await store.exclusive!({ fileId: 'f_1' }, 'proposals', async () => 'done')).toBe('done');
    expect(keys).toEqual(['f_1:proposals']);
    expect(cacheReads(createMemoryPartnerBookStore(), createReadCache({ ttlMs: 60_000, clock: () => 0 })).exclusive).toBeUndefined();
  });

  it('stores the snapshot an apply returns, so the next read sees the write', async () => {
    const { store, read } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    await store.read({ fileId });
    const applied = await store.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp);
    expect(applied.ok).toBe(true);
    const again = await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(1);
    expect(again.ok && again.snapshot.value.info.status).toBe('validated');
  });

  it('stores the snapshot a batch returns, and drops the entry when a batch fails', async () => {
    const { store, read } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    await store.read({ fileId });
    const applied = await store.applyMany({ fileId }, [{ kind: 'add', entity: 'exclusion', values: { company: 'Psi AG' } }], stamp);
    expect(applied.ok).toBe(true);
    const again = await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(1);
    expect(again.ok && again.snapshot.value.exclusions.map((x) => x.company)).toContain('Psi AG');
    expect(await store.applyMany({ fileId }, [{ kind: 'add', entity: 'exclusion', values: { company: ' ' } }], stamp)).toMatchObject({ ok: false });
    await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('drops the entry when an apply fails, because the file may have changed', async () => {
    const { store, read } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    await store.read({ fileId });
    await store.apply({ fileId }, { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'x' }, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' }, stamp);
    await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('drops the entry when an apply throws, and passes the error on', async () => {
    const { memory, store, read } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    await store.read({ fileId });
    vi.spyOn(memory, 'apply').mockRejectedValueOnce(new Error('network'));
    await expect(store.apply({ fileId }, { kind: 'updateInfo', patch: { statusNote: 'x' } }, stamp)).rejects.toThrow('network');
    await store.read({ fileId });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('never caches a failed read', async () => {
    const { store, read } = setup();
    await store.read({ fileId: 'missing' });
    await store.read({ fileId: 'missing' });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('hands out copies, so a caller changing a snapshot cannot corrupt the cache', async () => {
    const { store } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    const first = await store.read({ fileId });
    if (!first.ok) throw new Error(first.message);
    first.snapshot.value.info.marketName = 'Changed';
    const second = await store.read({ fileId });
    expect(second.ok && second.snapshot.value.info.marketName).toBe('Austria');
  });

  it('evicts the oldest entry past maxEntries', () => {
    const cache = createReadCache({ ttlMs: 60_000, clock: () => 0, maxEntries: 2 });
    const snapshot = { value: sampleMarket(), issues: [] };
    cache.set('a', snapshot);
    cache.set('b', snapshot);
    cache.set('c', snapshot);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('c')).toBeDefined();
  });

  it('does not let a slow read that started before an apply overwrite the applied snapshot', async () => {
    const { memory, read, store } = setup();
    const { fileId } = await store.create(owner, sampleMarket());
    const realRead = memory.read.bind(memory);
    let open!: () => void;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    read.mockImplementationOnce(async (ref) => {
      const stale = await realRead(ref);
      await gate;
      return stale;
    });
    const slow = store.read({ fileId });
    await store.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp);
    open();
    await slow;
    const next = await store.read({ fileId });
    expect(next.ok && next.snapshot.value.info.status).toBe('validated');
  });

  it('treats a hit as a miss when another instance wrote after it was stored', async () => {
    const memory = createMemoryMarketStore();
    const marks = new MemoryWriteMarks();
    let now = 100;
    const a = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => now }), marks);
    const b = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => now }), marks);
    const { fileId } = await a.create(owner, sampleMarket());
    await a.read({ fileId });
    now = 200;
    await b.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp);
    const seen = await a.read({ fileId });
    expect(seen.ok && seen.snapshot.value.info.status).toBe('validated');
  });

  describe('after a write that failed or may be half done', () => {
    const refused = { kind: 'update', entity: 'exclusion', id: 'x_1', patch: { reason: 'x' }, expectedUpdatedAt: '2000-01-01T00:00:00.000Z' } as const;
    const emptyRow = [{ kind: 'add', entity: 'exclusion', values: { company: ' ' } }] as const;
    function marked() {
      const memory = createMemoryMarketStore();
      const marks = { mark: vi.fn<(fileId: string, at: number) => Promise<void>>().mockResolvedValue(undefined), latest: vi.fn().mockResolvedValue(null) };
      const store = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => 4242 }), marks);
      return { memory, marks, store };
    }

    it('marks the file when an apply is refused, so other instances read it again', async () => {
      const { marks, store } = marked();
      const { fileId } = await store.create(owner, sampleMarket());
      expect(await store.apply({ fileId }, refused, stamp)).toMatchObject({ ok: false });
      expect(marks.mark).toHaveBeenCalledWith(fileId, 4242);
    });

    it('marks the file when a batch is refused', async () => {
      const { marks, store } = marked();
      const { fileId } = await store.create(owner, sampleMarket());
      expect(await store.applyMany({ fileId }, [...emptyRow], stamp)).toMatchObject({ ok: false });
      expect(marks.mark).toHaveBeenCalledWith(fileId, 4242);
    });

    it('marks the file when an apply or a batch throws, and passes the error on', async () => {
      const { memory, marks, store } = marked();
      const { fileId } = await store.create(owner, sampleMarket());
      vi.spyOn(memory, 'apply').mockRejectedValueOnce(new Error('network'));
      await expect(store.apply({ fileId }, { kind: 'updateInfo', patch: { statusNote: 'x' } }, stamp)).rejects.toThrow('network');
      expect(marks.mark).toHaveBeenCalledTimes(1);
      vi.spyOn(memory, 'applyMany').mockRejectedValueOnce(new Error('timeout'));
      await expect(store.applyMany({ fileId }, [{ kind: 'add', entity: 'exclusion', values: { company: 'Psi AG' } }], stamp)).rejects.toThrow('timeout');
      expect(marks.mark).toHaveBeenCalledTimes(2);
      expect(marks.mark).toHaveBeenLastCalledWith(fileId, 4242);
    });

    it('marks the file when it is discarded', async () => {
      const { marks, store } = marked();
      const { fileId } = await store.create(owner, sampleMarket());
      await store.discard({ fileId });
      expect(marks.mark).toHaveBeenCalledWith(fileId, 4242);
    });

    it('marks the file again after the trash, so a read in between is not served', async () => {
      const { memory, marks, store } = marked();
      const { fileId } = await store.create(owner, sampleMarket());
      vi.spyOn(memory, 'discard').mockImplementationOnce(async () => { await store.read({ fileId }); });
      await store.discard({ fileId });
      expect(marks.mark).toHaveBeenCalledTimes(2);
      vi.spyOn(memory, 'read');
      await store.read({ fileId });
      expect(memory.read).toHaveBeenCalledTimes(1);
    });

    it('marks it again even when the trash fails', async () => {
      const { memory, marks, store } = marked();
      const { fileId } = await store.create(owner, sampleMarket());
      vi.spyOn(memory, 'discard').mockRejectedValueOnce(new Error('drive'));
      await expect(store.discard({ fileId })).rejects.toThrow('drive');
      expect(marks.mark).toHaveBeenCalledTimes(2);
    });

    it('marks a good write once', async () => {
      const { marks, store } = marked();
      const { fileId } = await store.create(owner, sampleMarket());
      await store.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp);
      expect(marks.mark).toHaveBeenCalledTimes(1);
    });

    it('keeps the original result or error when the marks call fails too', async () => {
      const { memory, marks, store } = marked();
      marks.mark.mockRejectedValue(new Error('down'));
      const { fileId } = await store.create(owner, sampleMarket());
      expect(await store.apply({ fileId }, refused, stamp)).toMatchObject({ ok: false });
      vi.spyOn(memory, 'apply').mockRejectedValueOnce(new Error('network'));
      await expect(store.apply({ fileId }, { kind: 'updateInfo', patch: { statusNote: 'x' } }, stamp)).rejects.toThrow('network');
      await expect(store.discard({ fileId })).resolves.toBeUndefined();
    });

    it('lets another instance see a half-done write at once, not after its 60 seconds', async () => {
      const memory = createMemoryMarketStore();
      const marks = new MemoryWriteMarks();
      let now = 100;
      const a = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => now }), marks);
      const b = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => now }), marks);
      const { fileId } = await a.create(owner, sampleMarket());
      await b.read({ fileId });
      now = 200;
      // The write reached the file, then the call failed.
      const real = memory.apply.bind(memory);
      vi.spyOn(memory, 'apply').mockImplementationOnce(async (ref, change, at) => { await real(ref, change, at); throw new Error('timeout'); });
      await expect(a.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp)).rejects.toThrow('timeout');
      const seen = await b.read({ fileId });
      expect(seen.ok && seen.snapshot.value.info.status).toBe('validated');
    });
  });

  it('never fails a read or an apply because the write marks failed', async () => {
    const memory = createMemoryMarketStore();
    const broken = { mark: () => Promise.reject(new Error('down')), latest: () => Promise.reject(new Error('down')) };
    const store = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => 0 }), broken);
    const { fileId } = await store.create(owner, sampleMarket());
    expect((await store.read({ fileId })).ok).toBe(true);
    expect((await store.read({ fileId })).ok).toBe(true);
    expect((await store.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp)).ok).toBe(true);
  });

  it('keeps each owner’s cached copy apart when owners share one cache', async () => {
    const memory = createMemoryMarketStore();
    const read = vi.spyOn(memory, 'read');
    const cache = createReadCache({ ttlMs: 60_000, clock: () => 0 });
    const anna = cacheReads(memory, cache, undefined, { keyPrefix: 'u_1' });
    const ben = cacheReads(memory, cache, undefined, { keyPrefix: 'u_2' });
    const { fileId } = await anna.create(owner, sampleMarket());
    await anna.read({ fileId });
    await ben.read({ fileId });
    expect(read).toHaveBeenCalledTimes(2);
    await anna.read({ fileId });
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('a write by one owner makes another owner’s cached copy stale, the marks keyed by bare file id', async () => {
    const memory = createMemoryMarketStore();
    const marks = new MemoryWriteMarks();
    let now = 100;
    const cache = createReadCache({ ttlMs: 60_000, clock: () => now });
    const anna = cacheReads(memory, cache, marks, { keyPrefix: 'u_1' });
    const ben = cacheReads(memory, cache, marks, { keyPrefix: 'u_2' });
    const { fileId } = await anna.create(owner, sampleMarket());
    await ben.read({ fileId });
    now = 200;
    await anna.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp);
    expect(await marks.latest(fileId)).toBe(200);
    const seen = await ben.read({ fileId });
    expect(seen.ok && seen.snapshot.value.info.status).toBe('validated');
  });

  it('judges a hit by the time of the copy it read, even if the entry changes while marks are checked', async () => {
    const memory = createMemoryMarketStore();
    const inner = new MemoryWriteMarks();
    let open: (() => void) | null = null;
    const marks = {
      mark: (fileId: string, atMs: number) => inner.mark(fileId, atMs),
      latest: async (fileId: string) => {
        if (open === null) await new Promise<void>((resolve) => { open = resolve; });
        return inner.latest(fileId);
      },
    };
    let now = 100;
    const a = cacheReads(memory, createReadCache({ ttlMs: 60_000, clock: () => now }), marks);
    const { fileId } = await a.create(owner, sampleMarket());
    open = () => {};
    await a.read({ fileId }); // cached at 100
    open = null;
    const pending = a.read({ fileId }); // takes the copy from 100, then waits on marks
    await vi.waitFor(() => expect(open).not.toBeNull());
    now = 300;
    await a.apply({ fileId }, { kind: 'updateInfo', patch: { status: 'validated' } }, stamp); // entry now from 300, marked 300
    open!();
    const seen = await pending;
    expect(seen.ok && seen.snapshot.value.info.status).toBe('validated');
  });
});

describe('MemoryWriteMarks', () => {
  it('records the latest write per file and never moves backwards', async () => {
    const marks = new MemoryWriteMarks();
    expect(await marks.latest('f1')).toBeNull();
    await marks.mark('f1', 500);
    await marks.mark('f1', 300);
    expect(await marks.latest('f1')).toBe(500);
    await marks.mark('f1', 900);
    expect(await marks.latest('f1')).toBe(900);
    expect(await marks.latest('f2')).toBeNull();
  });

  it('prunes marks written before the cutoff, counts them, and keeps the rest', async () => {
    const marks = new MemoryWriteMarks();
    await marks.mark('f_old', 999);
    await marks.mark('f_edge', 1_000);
    await marks.mark('f_new', 2_000);
    expect(await marks.prune(1_000)).toBe(1);
    expect(await marks.prune(1_000)).toBe(0);
    expect(await marks.latest('f_old')).toBeNull();
    expect(await marks.latest('f_edge')).toBe(1_000);
    expect(await marks.latest('f_new')).toBe(2_000);
  });
});

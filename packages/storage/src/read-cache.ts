// The read cache, for both stores. The Recruitment app's `partial` failures were Notion's and are left out.
import type {
  CaseStore, CompanyFactsStore, FileRef, FileStore, MapStore, MarketStore, PartnerBookStore, ProgramStore, Snapshot, StoreError,
} from './types';
import type { ExclusiveScope } from './serialize';
import type { WriteMarks } from './write-marks';

/** Keys are file ids, or owner-scoped file ids (see cacheReads). */
export interface ReadCache {
  get(key: string): Snapshot<unknown> | undefined;
  /** When the read that produced the cached snapshot started (cache clock), if it is still cached. */
  storedAt(key: string): number | undefined;
  /** Stores a snapshot and bumps the key's generation, so reads already in flight won't overwrite it. */
  set(key: string, snapshot: Snapshot<unknown>, storedAt?: number): void;
  /** Drops the entry and bumps the key's generation. */
  delete(key: string): void;
  /** Stores a snapshot only if the key's generation is still `generation`. Returns whether it was stored. */
  setIfGeneration(key: string, generation: number, snapshot: Snapshot<unknown>, storedAt: number): boolean;
  generation(key: string): number;
  now(): number;
}

/**
 * Per-process read cache (the app uses a 60-second TTL; app writes refresh it). Snapshots stay in memory only: the
 * content of a person's files is never stored by us. Entries are copied in and out so no caller can change a cached one.
 */
export function createReadCache(opts: { ttlMs: number; clock: () => number; maxEntries?: number }): ReadCache {
  const maxEntries = opts.maxEntries ?? 500;
  const entries = new Map<string, { snapshot: Snapshot<unknown>; expiresAt: number; storedAt: number }>();
  const generations = new Map<string, number>();
  const generation = (key: string) => generations.get(key) ?? 0;
  const bump = (key: string) => generations.set(key, generation(key) + 1);

  const store = (key: string, snapshot: Snapshot<unknown>, storedAt: number) => {
    entries.delete(key);
    entries.set(key, { snapshot: structuredClone(snapshot), expiresAt: opts.clock() + opts.ttlMs, storedAt });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value!);
  };

  const live = (key: string) => {
    const entry = entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= opts.clock()) {
      entries.delete(key);
      return undefined;
    }
    return entry;
  };

  return {
    get: (key) => {
      const entry = live(key);
      return entry && structuredClone(entry.snapshot);
    },
    storedAt: (key) => live(key)?.storedAt,
    set(key, snapshot, storedAt) {
      bump(key);
      store(key, snapshot, storedAt ?? opts.clock());
    },
    delete(key) {
      bump(key);
      entries.delete(key);
    },
    setIfGeneration(key, expected, snapshot, storedAt) {
      if (generation(key) !== expected) return false;
      store(key, snapshot, storedAt);
      return true;
    },
    generation,
    now: opts.clock,
  };
}

type AnyStore = FileStore<unknown, unknown> & {
  create(...args: never[]): Promise<unknown>;
  trash?(ref: FileRef): Promise<void>;
  writeOutputs?(ref: FileRef, ...args: never[]): Promise<void>;
  exclusive?<R>(ref: FileRef, scope: ExclusiveScope, work: () => Promise<R>): Promise<R | StoreError>;
};
type AnyFileStore = PartnerBookStore | MarketStore | ProgramStore | CompanyFactsStore | CaseStore | MapStore;
type Marks = Pick<WriteMarks, 'mark' | 'latest'>;

/**
 * Reads through the cache; applies always go to the file and then refresh (or drop) the cached snapshot.
 * With `marks`, a cached copy older than another instance's write is treated as a miss. With `keyPrefix` (the
 * owner's user id), entries are kept per owner, so one owner is never served a copy another owner's read cached.
 * Write marks stay keyed by bare file id: a write by anyone makes every cached copy of the file stale.
 */
export function cacheReads(store: PartnerBookStore, cache: ReadCache, marks?: Marks, options?: { keyPrefix?: string }): PartnerBookStore;
export function cacheReads(store: MarketStore, cache: ReadCache, marks?: Marks, options?: { keyPrefix?: string }): MarketStore;
export function cacheReads(store: ProgramStore, cache: ReadCache, marks?: Marks, options?: { keyPrefix?: string }): ProgramStore;
export function cacheReads(store: CompanyFactsStore, cache: ReadCache, marks?: Marks, options?: { keyPrefix?: string }): CompanyFactsStore;
export function cacheReads(store: CaseStore, cache: ReadCache, marks?: Marks, options?: { keyPrefix?: string }): CaseStore;
export function cacheReads(store: MapStore, cache: ReadCache, marks?: Marks, options?: { keyPrefix?: string }): MapStore;
export function cacheReads(
  inner: AnyFileStore, cache: ReadCache, marks?: Marks, options: { keyPrefix?: string } = {},
): AnyFileStore {
  const store = inner as unknown as AnyStore;
  const keyFor = (fileId: string) => (options.keyPrefix === undefined ? fileId : `${options.keyPrefix}:${fileId}`);

  /** A cached snapshot unless another instance has written since it was read. A failing marks call means "miss". */
  async function fresh(fileId: string): Promise<Snapshot<unknown> | undefined> {
    const key = keyFor(fileId);
    // Snapshot and its time together: the entry may change while marks are checked.
    const cached = cache.get(key);
    const storedAt = cache.storedAt(key);
    if (!cached) return undefined;
    if (!marks) return cached;
    try {
      const latest = await marks.latest(fileId);
      if (latest !== null && storedAt !== undefined && latest > storedAt) return undefined;
      return cached;
    } catch {
      return undefined;
    }
  }

  /**
   * A write that failed or may be half done could have changed the file, so other instances must not serve their copy
   * for the rest of its 60 seconds. Best effort: a failing marks call changes nothing else.
   */
  async function markStale(fileId: string): Promise<void> {
    try {
      await marks?.mark(fileId, cache.now());
    } catch {
      // The copy here is dropped anyway; the other instances fall back to their 60 seconds.
    }
  }

  /** Runs a write, then caches the snapshot it returned; on any failure the cached copy is dropped. */
  async function refreshing<T extends { ok: true; snapshot: Snapshot<unknown> } | { ok: false }>(fileId: string, write: () => Promise<T>): Promise<T> {
    const key = keyFor(fileId);
    try {
      const result = await write();
      if (!result.ok) {
        cache.delete(key);
        await markStale(fileId);
        return result;
      }
      if (marks) {
        try {
          await marks.mark(fileId, cache.now());
        } catch {
          cache.delete(key);
          return result;
        }
      }
      cache.set(key, result.snapshot);
      return result;
    } catch (error) {
      cache.delete(key);
      await markStale(fileId);
      throw error;
    }
  }

  /** Drops the cached copy around a move to the trash, here and (by the marks) on other instances. */
  async function forgetting(ref: FileRef, trash: () => Promise<void>): Promise<void> {
    cache.delete(keyFor(ref.fileId));
    await markStale(ref.fileId);
    try {
      await trash();
    } finally {
      // A read between the first mark and the trash may have cached the file again, here or on another instance.
      cache.delete(keyFor(ref.fileId));
      await markStale(ref.fileId);
    }
  }

  const wrapped: AnyStore = {
    create: (...args) => store.create(...args),
    urlFor: (ref) => store.urlFor(ref),
    discard: (ref) => forgetting(ref, () => store.discard(ref)),
    async read(ref) {
      const cached = await fresh(ref.fileId);
      if (cached) return { ok: true, snapshot: cached };
      const key = keyFor(ref.fileId);
      const generation = cache.generation(key);
      const startedAt = cache.now();
      const result = await store.read(ref);
      if (result.ok) cache.setIfGeneration(key, generation, result.snapshot, startedAt);
      return result;
    },
    apply: (ref, change, stamp) => refreshing(ref.fileId, () => store.apply(ref, change, stamp)),
    applyMany: (ref, changes, stamp) => refreshing(ref.fileId, () => store.applyMany(ref, changes, stamp)),
  };
  if (store.trash) wrapped.trash = (ref) => forgetting(ref, () => store.trash!(ref));
  // The work's own reads and writes go through this cache: it only holds a lock beneath.
  if (store.exclusive) wrapped.exclusive = (ref, scope, work) => store.exclusive!(ref, scope, work);
  // The outputs are never read back: the cached snapshot stays right.
  if (store.writeOutputs) wrapped.writeOutputs = (ref, ...args) => store.writeOutputs!(ref, ...args);
  return wrapped as unknown as AnyFileStore;
}

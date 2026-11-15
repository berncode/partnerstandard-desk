// Serialized writes for both stores, the lock keyed by bare file id.
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from './errors';
import type {
  CaseStore, CompanyFactsStore, FileRef, FileStore, MapStore, MarketStore, PartnerBookStore, ProgramStore, StoreError,
} from './types';

export type ReleaseLock = () => Promise<void>;

/** The scopes of `PartnerBookStore.exclusive`: work that must not interleave, beside the file's own writes. */
export const EXCLUSIVE_SCOPES = ['proposals'] as const;
export type ExclusiveScope = (typeof EXCLUSIVE_SCOPES)[number];

/** A scope's lock key: the file id and the scope. */
export const exclusiveKey = (fileId: string, scope: ExclusiveScope): string => `${fileId}:${scope}`;

/** Every lock key a file can hold: its own and each scope's. Account deletion removes them all. */
export const lockKeysOf = (fileId: string): string[] => [fileId, ...EXCLUSIVE_SCOPES.map((scope) => exclusiveKey(fileId, scope))];

/**
 * One holder per key at a time. Keys are bare file ids: account deletion removes locks by file id. The platform's
 * TursoFileLock fits this shape; storage never imports it.
 */
export interface FileLock {
  /** Resolves with a release function once `key` is held, or null if it couldn't be had within the lock's wait limit. */
  acquire(key: string): Promise<ReleaseLock | null>;
}

/** In-process lock: a promise chain per key. For tests, development and the in-memory stores. */
export class MemoryFileLock implements FileLock {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly waitMs: number;

  constructor(opts: { waitMs?: number } = {}) {
    this.waitMs = opts.waitMs ?? 10_000;
  }

  async acquire(key: string): Promise<ReleaseLock | null> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((resolve) => { release = resolve; });
    const tail = previous.then(() => mine);
    this.tails.set(key, tail);
    const done = () => {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
      return Promise.resolve();
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => { timer = setTimeout(() => resolve('timeout'), this.waitMs); });
    const outcome = await Promise.race([previous.then(() => 'held' as const), timedOut]);
    clearTimeout(timer);
    if (outcome === 'timeout') {
      // Give up our place: release at once when our turn comes, so later waiters aren't blocked behind us.
      void previous.then(done);
      return null;
    }
    return done;
  }
}

type AnyStore = FileStore<unknown, unknown> & {
  create(...args: never[]): Promise<unknown>;
  trash?(ref: FileRef): Promise<void>;
  exclusive?<R>(ref: FileRef, scope: ExclusiveScope, work: () => Promise<R>): Promise<R | StoreError>;
  writeOutputs?(ref: FileRef, ...args: never[]): Promise<void>;
};
type AnyFileStore = PartnerBookStore | MarketStore | ProgramStore | CompanyFactsStore | CaseStore | MapStore;

/** Never runs two applies against the same file at once (the writer's adapter contract, workbook/writer.ts). */
export function serializeApplies(store: PartnerBookStore, lock: FileLock): PartnerBookStore;
export function serializeApplies(store: MarketStore, lock: FileLock): MarketStore;
export function serializeApplies(store: ProgramStore, lock: FileLock): ProgramStore;
export function serializeApplies(store: CompanyFactsStore, lock: FileLock): CompanyFactsStore;
export function serializeApplies(store: CaseStore, lock: FileLock): CaseStore;
export function serializeApplies(store: MapStore, lock: FileLock): MapStore;
export function serializeApplies(inner: AnyFileStore, lock: FileLock): AnyFileStore {
  const store = inner as unknown as AnyStore;
  const wrapped: AnyStore = {
    create: (...args) => store.create(...args),
    read: (ref) => store.read(ref),
    urlFor: (ref) => store.urlFor(ref),
    discard: (ref) => store.discard(ref),
    apply: (ref, change, stamp) => holding(ref.fileId, () => store.apply(ref, change, stamp)),
    applyMany: (ref, changes, stamp) => holding(ref.fileId, () => store.applyMany(ref, changes, stamp)),
  };
  // A Partner book store's trash, like discard, holds no lock: it writes no cells.
  if (store.trash) {
    wrapped.trash = (ref) => store.trash!(ref);
    // Work that reads, checks and writes as one: its own key beside the file's, so the applies inside take theirs.
    wrapped.exclusive = (ref, scope, work) => holding(exclusiveKey(ref.fileId, scope), work);
  }
  // A program's outputs are written under the file's lock too: two rewrites at once would mix their rows.
  if (store.writeOutputs) {
    wrapped.writeOutputs = async (ref, ...args) => {
      const release = await lock.acquire(ref.fileId);
      if (!release) throw new StoreFailure('unavailable', COPY.BUSY_MESSAGE);
      try {
        await store.writeOutputs!(ref, ...args);
      } finally {
        await release().catch(() => undefined);
      }
    };
  }
  return wrapped as unknown as AnyFileStore;

  async function holding<T>(key: string, work: () => Promise<T>): Promise<T | StoreError> {
    const release = await lock.acquire(key);
    if (!release) return { ok: false, error: 'unavailable', message: COPY.BUSY_MESSAGE };
    try {
      return await work();
    } finally {
      // A failed release must not replace the apply's outcome; a shared lock's lease expires by its TTL.
      await release().catch(() => undefined);
    }
  }
}

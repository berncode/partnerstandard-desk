// An in-memory store that holds domain values instead of sheet grids.
import { COPY } from '@partner-desk/copy';
import type { ChangeStamp } from '@partner-desk/core';
import type { ApplyManyResult, ApplyResult, FileRef, FileStore, ReadResult, StoreError } from '../types';

const FILE_NOT_FOUND: StoreError = { ok: false, error: 'file_not_found', message: COPY.FILE_GONE };

type Outcome<V> =
  | { ok: true; value: V; entityId: string | null }
  | { ok: false; error: 'not_found' | 'invalid' | 'conflict'; message: string; fieldErrors?: Record<string, string> };
type BatchOutcome<V> =
  | { ok: true; value: V; entityIds: Array<string | null> }
  | { ok: false; error: 'not_found' | 'invalid' | 'conflict'; message: string; fieldErrors?: Record<string, string>; valid: number };

export interface MemoryOps<V, C> {
  apply(value: V, change: C, stamp: ChangeStamp): Outcome<V>;
  applyMany(value: V, changes: C[], stamp: ChangeStamp): BatchOutcome<V>;
}

/** Files kept in memory as domain values, changed with the same core functions every adapter's callers rely on. */
export class MemoryFileStore<V, C> implements FileStore<V, C> {
  protected readonly files = new Map<string, V>();

  constructor(private readonly ops: MemoryOps<V, C>) {}

  protected put(value: V): { fileId: string; fileUrl: string } {
    const fileId = `mem_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    this.files.set(fileId, structuredClone(value));
    return { fileId, fileUrl: this.urlFor({ fileId }) };
  }

  urlFor(ref: FileRef): string {
    return `memory://${ref.fileId}`;
  }

  async read(ref: FileRef): Promise<ReadResult<V>> {
    const value = this.files.get(ref.fileId);
    return value === undefined ? FILE_NOT_FOUND : { ok: true, snapshot: { value: structuredClone(value), issues: [] } };
  }

  async apply(ref: FileRef, change: C, stamp: ChangeStamp): Promise<ApplyResult<V>> {
    const current = this.files.get(ref.fileId);
    if (current === undefined) return FILE_NOT_FOUND;
    const out = this.ops.apply(structuredClone(current), change, stamp);
    if (!out.ok) return out;
    this.files.set(ref.fileId, out.value);
    return { ok: true, snapshot: { value: structuredClone(out.value), issues: [] }, entityId: out.entityId };
  }

  async applyMany(ref: FileRef, changes: C[], stamp: ChangeStamp): Promise<ApplyManyResult<V>> {
    const current = this.files.get(ref.fileId);
    if (current === undefined) return FILE_NOT_FOUND;
    const out = this.ops.applyMany(structuredClone(current), changes, stamp);
    if (!out.ok) return out;
    this.files.set(ref.fileId, out.value);
    return { ok: true, snapshot: { value: structuredClone(out.value), issues: [] }, entityIds: out.entityIds };
  }

  async discard(ref: FileRef): Promise<void> {
    this.files.delete(ref.fileId);
  }
}

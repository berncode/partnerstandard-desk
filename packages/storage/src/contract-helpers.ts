import type { ApplyResult, ReadResult, Snapshot } from './types';

export const NOW = '2026-10-28T10:00:00.000Z';
export const STALE = '2000-01-01T00:00:00.000Z';

/** The snapshot of a result, or a thrown error that names the code (ids only). */
export function snapshotOf<T>(result: ReadResult<T> | ApplyResult<T>): Snapshot<T> {
  if (!result.ok) throw new Error(`${result.error}: ${result.message}`);
  return result.snapshot;
}

export function expectOk<R extends { ok: boolean }>(result: R): Extract<R, { ok: true }> {
  if (!result.ok) {
    const failure = result as unknown as { error: string; message: string };
    throw new Error(`${failure.error}: ${failure.message}`);
  }
  return result as Extract<R, { ok: true }>;
}

type Item = { id: string } & Record<string, unknown>;
export const without = (items: Item[], id: string | null) => items.filter((item) => item.id !== id);

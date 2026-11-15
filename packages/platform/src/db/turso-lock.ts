import { inArray, sql } from 'drizzle-orm';
import { randomSuffix } from '@partner-desk/core';
import { lockKeysOf } from '@partner-desk/storage';
import type { Db } from './client';
import { guarded } from './guarded';
import { fileLocks } from './schema';

export type ReleaseLock = () => Promise<void>;

/**
 * A lease per file in Turso, so writes are serialized across serverless instances. A live holder renews its lease
 * every `renewEveryMs` while it works, so a slow write is never taken over; a holder that dies stops renewing and
 * its lease expires after `ttlMs`.
 */
export class TursoFileLock {
  private readonly ttlMs: number;
  private readonly waitMs: number;
  private readonly pollMs: number;
  private readonly renewEveryMs: number;
  private readonly clock: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly db: Db, opts: {
    ttlMs?: number; renewEveryMs?: number; waitMs?: number; pollMs?: number; clock?: () => number; sleep?: (ms: number) => Promise<void>;
  } = {}) {
    this.ttlMs = opts.ttlMs ?? 30_000;
    this.waitMs = opts.waitMs ?? 10_000;
    this.pollMs = opts.pollMs ?? 150;
    this.renewEveryMs = opts.renewEveryMs ?? Math.floor(this.ttlMs / 3);
    this.clock = opts.clock ?? Date.now;
    this.sleep = opts.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  async acquire(key: string): Promise<ReleaseLock | null> {
    const holder = randomSuffix(16);
    const deadline = this.clock() + this.waitMs;
    try {
      for (;;) {
        if (await this.tryTake(key, holder)) return this.holdUntilReleased(key, holder);
        if (this.clock() >= deadline) return null;
        await this.sleep(this.pollMs);
      }
    } catch {
      return null; // Turso unreachable: the caller reports the file as busy rather than failing.
    }
  }

  /** Removes these files' leases (account deletion): each file's own key and its scopes' keys (`lockKeysOf`). */
  async deleteForFiles(fileIds: readonly string[]): Promise<void> {
    if (fileIds.length === 0) return;
    await guarded('file_locks_delete_failed', () => this.db.delete(fileLocks).where(inArray(fileLocks.key, fileIds.flatMap(lockKeysOf))));
  }

  private holdUntilReleased(key: string, holder: string): ReleaseLock {
    const timer = setInterval(() => {
      this.db
        .run(sql`UPDATE file_locks SET expires_at = ${this.clock() + this.ttlMs} WHERE key = ${key} AND holder = ${holder}`)
        .catch(() => undefined);
    }, this.renewEveryMs);
    timer.unref?.();
    return async () => {
      clearInterval(timer);
      await this.db.run(sql`DELETE FROM file_locks WHERE key = ${key} AND holder = ${holder}`);
    };
  }

  private async tryTake(key: string, holder: string): Promise<boolean> {
    const now = this.clock();
    await this.db.run(sql`
      INSERT INTO file_locks (key, holder, expires_at) VALUES (${key}, ${holder}, ${now + this.ttlMs})
      ON CONFLICT (key) DO UPDATE SET holder = excluded.holder, expires_at = excluded.expires_at
      WHERE file_locks.expires_at <= ${now}`);
    const rows = await this.db.all<{ holder: string }>(sql`SELECT holder FROM file_locks WHERE key = ${key}`);
    return rows[0]?.holder === holder;
  }
}

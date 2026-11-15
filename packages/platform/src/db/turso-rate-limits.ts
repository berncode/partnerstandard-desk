import { lt, sql } from 'drizzle-orm';
import type { RateLimiter } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { rateLimits } from './schema';

/** Fixed-window counters in rate_limits. Keys hold hashes; errors name the operation only. */
export class TursoRateLimiter implements RateLimiter {
  constructor(private readonly db: Db) {}

  /** One atomic upsert: a new window resets the count, the same window adds one. */
  async hit(key: string, limit: number, windowMs: number, nowMs: number): Promise<boolean> {
    const windowStart = Math.floor(nowMs / windowMs) * windowMs;
    const rows = await guarded('rate_limit_hit_failed', () => this.db.all<{ count: number }>(sql`
      INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT(key) DO UPDATE SET
        count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
        window_start = excluded.window_start
      RETURNING count`));
    return (rows[0]?.count ?? 1) <= limit;
  }

  async prune(beforeMs: number): Promise<number> {
    const deleted = await guarded('rate_limit_prune_failed', () => this.db.delete(rateLimits).where(lt(rateLimits.windowStart, beforeMs))
      .returning({ key: rateLimits.key }));
    return deleted.length;
  }
}

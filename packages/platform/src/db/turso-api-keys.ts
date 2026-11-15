import { createHash, randomBytes } from 'node:crypto';
import type { AgentLevel } from '@partner-desk/commands';
import { randomSuffix } from '@partner-desk/core';
import { and, desc, eq, isNull } from 'drizzle-orm';
import type { Db } from './client';
import { guarded } from './guarded';
import { apiKeys } from './schema';

/** Every key starts with this, so `resolveAgent` tells a key from a signed access token, and secret scanners find one. */
export const API_KEY_PREFIX = 'pd_';

/** How long a key's last use may be old before it is written again: one write a minute at most, not one per request. */
const MARK_EVERY_MS = 60_000;

/** The levels a key can be made at: the api_keys column's own list. */
type KeyLevel = (typeof apiKeys.$inferInsert)['level'];

const hashOf = (key: string): string => createHash('sha256').update(key).digest('hex');

export interface ApiKeyInfo {
  id: string;
  name: string;
  level: AgentLevel;
  /** The key's first 8 characters, to tell keys apart. */
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * The api_keys table (agents spec 4.4). The key itself is shown once, when made, and never stored: only its SHA-256
 * hash (a key is 32 random bytes, so a fast hash is enough) and its first 8 characters. Every call fails with the
 * operation's name only: its parameters include hashes.
 */
export class TursoApiKeys {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  /** A new key: `pd_` and 32 random bytes in base64url. Returned once; only its hash is kept. The levels are the column's. */
  async create({ userId, name, level }: { userId: string; name: string; level: KeyLevel }): Promise<{ id: string; key: string }> {
    const key = `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`;
    const id = `ak_${randomSuffix(16)}`;
    await guarded('api_keys_create_failed', () => this.db.insert(apiKeys).values({
      id, userId, name, level, keyHash: hashOf(key), prefix: key.slice(0, 8), createdAt: this.now().toISOString(),
    }));
    return { id, key };
  }

  /** The key's owner, name and level, or null for an unknown or turned off key. Marks its last use (once a minute). */
  async verify(key: string): Promise<{ id: string; userId: string; name: string; level: AgentLevel } | null> {
    if (!key.startsWith(API_KEY_PREFIX)) return null;
    const [row] = await guarded('api_keys_verify_failed', () => this.db.select({
      id: apiKeys.id, userId: apiKeys.userId, name: apiKeys.name, level: apiKeys.level, lastUsedAt: apiKeys.lastUsedAt,
    }).from(apiKeys).where(and(eq(apiKeys.keyHash, hashOf(key)), isNull(apiKeys.revokedAt))).limit(1));
    if (!row) return null;
    const now = this.now();
    if (!row.lastUsedAt || now.getTime() - new Date(row.lastUsedAt).getTime() >= MARK_EVERY_MS) {
      await guarded('api_keys_mark_failed', () => this.db.update(apiKeys).set({ lastUsedAt: now.toISOString() }).where(eq(apiKeys.id, row.id)));
    }
    return { id: row.id, userId: row.userId, name: row.name, level: row.level };
  }

  /** The person's keys that are on, newest first. Never the hash. */
  async list(userId: string): Promise<ApiKeyInfo[]> {
    return guarded('api_keys_list_failed', () => this.db.select({
      id: apiKeys.id, name: apiKeys.name, level: apiKeys.level, prefix: apiKeys.prefix, createdAt: apiKeys.createdAt, lastUsedAt: apiKeys.lastUsedAt,
    }).from(apiKeys).where(and(eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt))).orderBy(desc(apiKeys.createdAt), desc(apiKeys.id)));
  }

  /** Turns the person's key off at once. False when it isn't theirs or is already off. */
  async revoke(userId: string, id: string): Promise<boolean> {
    const changed = await guarded('api_keys_revoke_failed', () => this.db.update(apiKeys).set({ revokedAt: this.now().toISOString() })
      .where(and(eq(apiKeys.id, id), eq(apiKeys.userId, userId), isNull(apiKeys.revokedAt))).returning({ id: apiKeys.id }));
    return changed.length > 0;
  }

  /** Every key of the person, turned off or not (Delete account). */
  async deleteForUser(userId: string): Promise<void> {
    await guarded('api_keys_delete_failed', () => this.db.delete(apiKeys).where(eq(apiKeys.userId, userId)));
  }
}

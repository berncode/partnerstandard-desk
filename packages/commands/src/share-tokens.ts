import { createHash } from 'node:crypto';
import { randomSuffix } from '@partner-desk/core';

/** 256 random bits as 43 base64url characters: the secret in a share link. Never randomSuffix. */
export function newToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

/** What the database stores and looks a token up by: the token itself is never stored. */
export const hashToken = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

/** A string shaped like newToken(): anything else is refused before it is hashed or looked up. */
export const isToken = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);

/** A new share link id. Ids appear in logs, so they are ids, not secrets: the secret is the link's token. */
export const newShareLinkId = (): string => `sl_${randomSuffix(16)}`;

/** Retry helpers for the Google client: backoff, Retry-After handling and what counts as a transient network failure. */

/**
 * `url` with a query string: repeated keys for arrays, nothing added for no params, "&" when `url` has a query
 * already (none after a trailing "?" or "&"), and any "#fragment" kept last.
 */
export function withQuery(url: string, params: Record<string, string | string[]>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const v of Array.isArray(value) ? value : [value]) search.append(key, v);
  }
  const query = search.toString();
  if (!query) return url;
  const hashAt = url.indexOf('#');
  const base = hashAt === -1 ? url : url.slice(0, hashAt);
  const fragment = hashAt === -1 ? '' : url.slice(hashAt);
  const separator = !base.includes('?') ? '?' : base.endsWith('?') || base.endsWith('&') ? '' : '&';
  return `${base}${separator}${query}${fragment}`;
}

/** Truncated exponential backoff with jitter (Google's guidance): 1 s, 2 s, 4 s … up to 32 s, plus up to 1 s. */
export const backoffMs = (attempt: number, random: () => number): number =>
  Math.min(32_000, 1000 * 2 ** attempt) + Math.round(random() * 1000);

/** Retry-After never makes a request wait longer than this: past a minute, "unavailable" is the kinder answer. */
export const MAX_RETRY_AFTER_MS = 60_000;

/** The wait a Retry-After header asks for, in ms (seconds or an HTTP date), capped; null when absent or unreadable. */
export function retryAfterMs(value: string | null | undefined, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  const ms = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - now;
  if (!Number.isFinite(ms)) return null;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(0, ms));
}

/** The wait before retry number `attempt`: the backoff, or longer when the server said so. */
export const retryDelayMs = (attempt: number, random: () => number, retryAfter: number | null): number =>
  Math.max(backoffMs(attempt, random), retryAfter ?? 0);

/** A network failure or timeout from fetch. Worth retrying when the call is idempotent; any other throw is a bug. */
export const isTransientFetchError = (error: unknown): boolean =>
  error instanceof TypeError || (error instanceof DOMException && ['TimeoutError', 'AbortError'].includes(error.name));

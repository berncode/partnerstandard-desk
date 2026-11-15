import { describe, expect, it } from 'vitest';
import { backoffMs, isTransientFetchError, MAX_RETRY_AFTER_MS, retryAfterMs, retryDelayMs, withQuery } from './retry';

describe('withQuery', () => {
  it('builds query strings with repeated keys', () => {
    expect(withQuery('https://x.test/v', { ranges: ["'Market'", "'Partner hypotheses'"], majorDimension: 'ROWS' }))
      .toBe("https://x.test/v?ranges=%27Market%27&ranges=%27Partner+hypotheses%27&majorDimension=ROWS");
  });

  it('adds nothing for no params, and appends to an existing query', () => {
    expect(withQuery('https://x.test/v', {})).toBe('https://x.test/v');
    expect(withQuery('https://x.test/v?a=1', { b: '2' })).toBe('https://x.test/v?a=1&b=2');
  });

  it('adds to a URL ending in ? or &, and keeps a #fragment last', () => {
    expect(withQuery('https://x.test/v?', { b: '2' })).toBe('https://x.test/v?b=2');
    expect(withQuery('https://x.test/v?a=1&', { b: '2' })).toBe('https://x.test/v?a=1&b=2');
    expect(withQuery('https://x.test/v#top', { b: '2' })).toBe('https://x.test/v?b=2#top');
    expect(withQuery('https://x.test/v?a=1#top', { b: '2' })).toBe('https://x.test/v?a=1&b=2#top');
    expect(withQuery('https://x.test/v#a?b', { c: '3' })).toBe('https://x.test/v?c=3#a?b');
    expect(withQuery('https://x.test/v#top', {})).toBe('https://x.test/v#top');
  });
});

describe('retry timing', () => {
  it('backs off exponentially with jitter, capped at 32 s', () => {
    expect([0, 1, 2, 10].map((n) => backoffMs(n, () => 0.5))).toEqual([1500, 2500, 4500, 32_500]);
  });

  it('reads Retry-After as seconds or an HTTP date, capped at a minute', () => {
    const now = Date.parse('2026-10-19T10:00:00Z');
    expect(retryAfterMs('7', now)).toBe(7000);
    expect(retryAfterMs('600', now)).toBe(MAX_RETRY_AFTER_MS);
    expect(retryAfterMs('Mon, 19 Oct 2026 10:00:05 GMT', now)).toBe(5000);
    expect(retryAfterMs('Mon, 19 Oct 2026 09:00:00 GMT', now)).toBe(0);
    for (const missing of [null, undefined, '', 'soon']) expect(retryAfterMs(missing, now)).toBeNull();
  });

  it('waits for whichever is longer: the backoff or Retry-After', () => {
    expect(retryDelayMs(0, () => 0.5, null)).toBe(1500);
    expect(retryDelayMs(0, () => 0.5, 7000)).toBe(7000);
    expect(retryDelayMs(3, () => 0.5, 1000)).toBe(8500);
  });

  it('treats network failures and timeouts as transient, and nothing else', () => {
    expect(isTransientFetchError(new TypeError('fetch failed'))).toBe(true);
    expect(isTransientFetchError(new DOMException('t', 'TimeoutError'))).toBe(true);
    expect(isTransientFetchError(new DOMException('a', 'AbortError'))).toBe(true);
    expect(isTransientFetchError(new Error('bug'))).toBe(false);
  });
});

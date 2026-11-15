import { describe, expect, it, vi } from 'vitest';
import { ReconnectRequired, TokenUnavailable } from '../errors';
import { GoogleApiError, GoogleClient } from './client';

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const googleError = (code: number, status: string, extra: Record<string, unknown> = {}) => json(code, { error: { code, message: `${status} happened`, status, ...extra } });

function setup(responses: Array<Response | Error>, token = async () => 'token-1', options: { maxRetries?: number; deadlineMs?: number } = {}) {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => {
    const next = responses.shift();
    if (!next) throw new Error('no more responses');
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const client = new GoogleClient({
    getAccessToken: vi.fn(token), fetch, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0.5, ...options,
  });
  return { client, fetch, sleeps };
}

describe('GoogleClient', () => {
  it('sends the bearer token and JSON body, and parses the JSON reply', async () => {
    const { client, fetch } = setup([json(200, { id: 'x' })]);
    expect(await client.post('https://example.test/a', { name: 'n' })).toEqual({ id: 'x' });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://example.test/a');
    expect(init?.method).toBe('POST');
    expect(new Headers(init?.headers).get('authorization')).toBe('Bearer token-1');
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json');
    expect(init?.body).toBe('{"name":"n"}');
  });

  it('retries 429 and 5xx with growing, jittered delays, then succeeds', async () => {
    const { client, sleeps } = setup([googleError(429, 'RESOURCE_EXHAUSTED'), googleError(503, 'UNAVAILABLE'), json(200, { ok: 1 })]);
    expect(await client.get('https://example.test/a')).toEqual({ ok: 1 });
    expect(sleeps).toEqual([1500, 2500]); // 1000·2^n + 0.5·1000 jitter
  });

  it('gives up after 3 retries as unavailable', async () => {
    const { client, fetch, sleeps } = setup(Array.from({ length: 4 }, () => googleError(500, 'INTERNAL')));
    await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable', status: 500 });
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(sleeps).toHaveLength(3);
  });

  it('retries network errors and timeouts', async () => {
    const { client } = setup([new TypeError('fetch failed'), new DOMException('timed out', 'TimeoutError'), json(200, { ok: 1 })]);
    expect(await client.get('https://example.test/a')).toEqual({ ok: 1 });
  });

  it('retries a 401 once with a fresh token, then reports auth', async () => {
    let n = 0;
    const { client, fetch } = setup([googleError(401, 'UNAUTHENTICATED'), googleError(401, 'UNAUTHENTICATED')], async () => `token-${++n}`);
    await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'auth', status: 401 });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(new Headers(fetch.mock.calls[1]![1]?.headers).get('authorization')).toBe('Bearer token-2');
  });

  it('reports a full Drive (403 storageQuotaExceeded) as quota, without retrying', async () => {
    const { client, fetch } = setup([googleError(403, 'PERMISSION_DENIED', { errors: [{ domain: 'usageLimits', reason: 'storageQuotaExceeded' }] })]);
    await expect(client.post('https://example.test/a', {})).rejects.toMatchObject({ kind: 'quota', status: 403 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('reports a missing Drive permission (insufficient scope) as auth', async () => {
    const { client } = setup([googleError(403, 'PERMISSION_DENIED', { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] })]);
    await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'auth' });
  });

  it('retries Drive’s 403 rate-limit reasons', async () => {
    const { client } = setup([googleError(403, 'PERMISSION_DENIED', { errors: [{ reason: 'userRateLimitExceeded' }] }), json(200, { ok: 1 })]);
    expect(await client.get('https://example.test/a')).toEqual({ ok: 1 });
  });

  it('reports other 403s and 404s as not_found, and 400 as bad_request, without retrying', async () => {
    for (const [response, kind] of [
      [googleError(403, 'PERMISSION_DENIED'), 'not_found'],
      [googleError(404, 'NOT_FOUND'), 'not_found'],
      [googleError(400, 'INVALID_ARGUMENT'), 'bad_request'],
    ] as const) {
      const { client, fetch } = setup([response]);
      await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });

  it('turns ReconnectRequired from the token provider into an auth error, without calling Google', async () => {
    const { client, fetch } = setup([], async () => { throw new ReconnectRequired(); });
    await expect(client.get('https://example.test/a')).rejects.toBeInstanceOf(GoogleApiError);
    await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'auth' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('turns TokenUnavailable into a temporary failure, never a reconnect, without calling Google', async () => {
    const { client, fetch } = setup([], async () => { throw new TokenUnavailable(); });
    await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable', status: 0, message: 'Google sign-in isn’t responding' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('never puts the token or response bodies into error messages', async () => {
    const { client } = setup([json(404, { error: { code: 404, message: 'Requested entity was not found: secret-ish detail', status: 'NOT_FOUND' } })], async () => 'ya29.secret');
    const error = (await client.get('https://example.test/a').catch((e: unknown) => e)) as Error;
    expect(error.message).not.toMatch(/ya29|secret-ish/);
  });

  it('does not spend the retry budget on the 401 refresh', async () => {
    let n = 0;
    const { client, sleeps } = setup(
      [googleError(401, 'UNAUTHENTICATED'), googleError(503, 'UNAVAILABLE'), googleError(503, 'UNAVAILABLE'), googleError(503, 'UNAVAILABLE'), json(200, { ok: 1 })],
      async () => `token-${++n}`,
    );
    expect(await client.get('https://example.test/a')).toEqual({ ok: 1 });
    expect(sleeps).toEqual([1500, 2500, 4500]);
  });

  it('succeeds after a single 401 refresh', async () => {
    const { client, sleeps } = setup([googleError(401, 'UNAUTHENTICATED'), json(200, { ok: 1 })]);
    expect(await client.get('https://example.test/a')).toEqual({ ok: 1 });
    expect(sleeps).toEqual([]);
  });

  it('does not retry a non-idempotent POST on 5xx or network errors', async () => {
    for (const failure of [googleError(503, 'UNAVAILABLE'), new TypeError('fetch failed'), new DOMException('timed out', 'TimeoutError')]) {
      const { client, fetch } = setup([failure, json(200, { ok: 1 })]);
      await expect(client.post('https://example.test/a', {})).rejects.toMatchObject({ kind: 'unavailable' });
      expect(fetch).toHaveBeenCalledTimes(1);
    }
    const { client, fetch } = setup([new TypeError('fetch failed'), json(200, { ok: 1 })]);
    await expect(client.patch('https://example.test/a', {})).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('retries a non-idempotent POST on 429, since Google refused it', async () => {
    const { client, fetch } = setup([googleError(429, 'RESOURCE_EXHAUSTED'), json(200, { ok: 1 })]);
    expect(await client.post('https://example.test/a', {})).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries an idempotent POST and PATCH on 503', async () => {
    const a = setup([googleError(503, 'UNAVAILABLE'), json(200, { ok: 1 })]);
    expect(await a.client.post('https://example.test/a', {}, { idempotent: true })).toEqual({ ok: 1 });
    const b = setup([new TypeError('fetch failed'), json(200, { ok: 1 })]);
    expect(await b.client.patch('https://example.test/a', {}, { idempotent: true })).toEqual({ ok: 1 });
  });

  it('reports an unreadable 2xx body as unavailable without leaking it', async () => {
    const { client } = setup([new Response('not json {secret-body', { status: 200 })]);
    const error = (await client.get('https://example.test/a').catch((e: unknown) => e)) as GoogleApiError;
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error).toMatchObject({ kind: 'unavailable', status: 200 });
    expect(error.message).not.toMatch(/secret-body/);
  });

  it('retries 408 for every call, since Google didn’t read the request', async () => {
    const a = setup([googleError(408, 'REQUEST_TIMEOUT'), json(200, { ok: 1 })]);
    expect(await a.client.get('https://example.test/a')).toEqual({ ok: 1 });
    const b = setup([googleError(408, 'REQUEST_TIMEOUT'), json(200, { ok: 1 })]);
    expect(await b.client.post('https://example.test/a', {})).toEqual({ ok: 1 });
    expect(b.fetch).toHaveBeenCalledTimes(2);
    const c = setup([googleError(408, 'REQUEST_TIMEOUT'), json(200, { ok: 1 })]);
    expect(await c.client.patch('https://example.test/a', {})).toEqual({ ok: 1 });
    expect(c.fetch).toHaveBeenCalledTimes(2);
  });

  it('gives up on 408 after the retry budget', async () => {
    const { client, fetch } = setup(Array.from({ length: 4 }, () => googleError(408, 'REQUEST_TIMEOUT')));
    await expect(client.post('https://example.test/a', {})).rejects.toMatchObject({ kind: 'unavailable', status: 408 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('waits as long as Retry-After asks, capped at a minute', async () => {
    const limited = (seconds: string) => new Response(JSON.stringify({ error: { code: 429 } }), { status: 429, headers: { 'retry-after': seconds } });
    // A budget long enough for both waits: the deadline has its own tests.
    const { client, sleeps } = setup([limited('7'), limited('600'), json(200, { ok: 1 })], undefined, { deadlineMs: 120_000 });
    expect(await client.get('https://example.test/a')).toEqual({ ok: 1 });
    expect(sleeps).toEqual([7000, 60_000]);
  });

  describe('the time budget per request', () => {
    /** A client whose sleeps move a fake clock on, so the budget can be spent without waiting. */
    function timed(responses: Array<Response | Error>, options: { maxRetries?: number; deadlineMs?: number } = {}) {
      let now = 1_000_000;
      const sleeps: number[] = [];
      const fetch = vi.fn<typeof globalThis.fetch>(async () => {
        const next = responses.shift();
        if (!next) throw new Error('no more responses');
        if (next instanceof Error) throw next;
        return next;
      });
      const client = new GoogleClient({
        getAccessToken: async () => 'token-1', fetch, random: () => 0.5, now: () => now,
        sleep: async (ms) => { sleeps.push(ms); now += ms; }, ...options,
      });
      return { client, fetch, sleeps };
    }

    it('stops retrying once the next wait would pass 25 seconds, as unavailable', async () => {
      const { client, fetch, sleeps } = timed(Array.from({ length: 10 }, () => googleError(503, 'UNAVAILABLE')), { maxRetries: 9 });
      await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable' });
      // 1.5 + 2.5 + 4.5 + 8.5 = 17 s; the next wait (16.5 s) would end past 25 s.
      expect(sleeps).toEqual([1500, 2500, 4500, 8500]);
      expect(fetch).toHaveBeenCalledTimes(5);
    });

    it('never starts a Retry-After wait longer than the budget left', async () => {
      const limited = new Response(JSON.stringify({ error: { code: 429 } }), { status: 429, headers: { 'retry-after': '60' } });
      const { client, fetch, sleeps } = timed([limited, json(200, { ok: 1 })]);
      await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable', status: 429 });
      expect(sleeps).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('stops network retries at the deadline too, and honors a custom budget', async () => {
      const { client, sleeps } = timed(Array.from({ length: 5 }, () => new TypeError('fetch failed')), { deadlineMs: 3000 });
      await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable', status: 0 });
      expect(sleeps).toEqual([1500]);
    });

    it('still succeeds within the budget', async () => {
      const { client, sleeps } = timed([googleError(503, 'UNAVAILABLE'), json(200, { ok: 1 })]);
      expect(await client.get('https://example.test/a')).toEqual({ ok: 1 });
      expect(sleeps).toEqual([1500]);
    });
  });

  it('honors a custom retry budget', async () => {
    const { client, fetch } = setup([googleError(503, 'UNAVAILABLE'), googleError(503, 'UNAVAILABLE'), json(200, { ok: 1 })], undefined, { maxRetries: 1 });
    await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable', status: 503 });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('never retries with a retry budget of 0', async () => {
    for (const failure of [googleError(429, 'RESOURCE_EXHAUSTED'), googleError(503, 'UNAVAILABLE'), googleError(408, 'REQUEST_TIMEOUT'), new TypeError('fetch failed')]) {
      const { client, fetch, sleeps } = setup([failure, json(200, { ok: 1 })], undefined, { maxRetries: 0 });
      await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable' });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(sleeps).toEqual([]);
    }
  });

  it('gives up on Drive’s 403 rate limits after the retry budget', async () => {
    const rateLimited = () => googleError(403, 'PERMISSION_DENIED', { errors: [{ reason: 'rateLimitExceeded' }] });
    const { client, fetch } = setup([rateLimited(), rateLimited(), rateLimited(), rateLimited()]);
    await expect(client.get('https://example.test/a')).rejects.toMatchObject({ kind: 'unavailable', status: 403 });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('sends PATCH with a JSON body', async () => {
    const { client, fetch } = setup([json(200, { ok: 1 })]);
    await client.patch('https://example.test/a', { trashed: true }, { idempotent: true });
    expect(fetch.mock.calls[0]![1]).toMatchObject({ method: 'PATCH', body: '{"trashed":true}' });
  });

  it('retries a non-idempotent PATCH that Google refused (429), and refreshes its token on 401', async () => {
    let n = 0;
    const { client, fetch } = setup([googleError(401, 'UNAUTHENTICATED'), googleError(429, 'RESOURCE_EXHAUSTED'), json(200, { ok: 1 })], async () => `token-${++n}`);
    expect(await client.patch('https://example.test/a', { trashed: true })).toEqual({ ok: 1 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(new Headers(fetch.mock.calls[2]![1]?.headers).get('authorization')).toBe('Bearer token-2');
  });
});

import { inspect } from 'node:util';
import type { BetterAuthOptions } from 'better-auth';
import { testUtils } from 'better-auth/plugins';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestDb } from '../db/test-db';
import { authLogLine, buildAuth, GOOGLE_DRIVE_SCOPE } from './auth-config';
import { parseEnv } from '../env';

const env = (overrides: Record<string, string> = {}) => parseEnv({
  DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret', ...overrides,
});

/** The parts of Better Auth's testUtils plugin these tests use. */
interface TestHelpers {
  createUser(input: { email: string; name: string }): unknown;
  saveUser(user: unknown): Promise<{ id: string }>;
  login(input: { userId: string }): Promise<{ headers: Headers; token: string }>;
}

describe('buildAuth', () => {
  it('asks Google for the drive.file scope, offline access and consent, and encrypts tokens', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    const google = auth.options.socialProviders?.google;
    expect(google).toMatchObject({ clientId: 'cid', accessType: 'offline', prompt: 'select_account consent' });
    expect(google?.scope).toEqual([GOOGLE_DRIVE_SCOPE]);
    expect(auth.options.account?.encryptOAuthTokens).toBe(true);
    expect((auth.options as BetterAuthOptions).emailAndPassword?.enabled ?? false).toBe(false);
    expect(Object.keys(auth.options.socialProviders ?? {})).toEqual(['google']);
  });

  it('keeps accounts apart (no implicit linking) and sessions for 30 days', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    expect(auth.options.account?.accountLinking).toMatchObject({ enabled: true, disableImplicitLinking: true });
    expect(auth.options.session).toMatchObject({ expiresIn: 60 * 60 * 24 * 30 });
  });

  it('sends OAuth errors back to the sign-in page', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    expect(auth.options.onAPIError?.errorURL).toBe('/sign-in');
  });

  it('leaves Google out when test sign-in runs without credentials', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', PD_TEST_AUTH: '1' }) });
    expect(auth.options.socialProviders?.google).toBeUndefined();
  });

  it('creates a session in test mode that getSession accepts', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env({ PD_TEST_AUTH: '1' }), plugins: [testUtils()] });
    const test = (await auth.$context as unknown as { test: TestHelpers }).test;
    const user = await test.saveUser(test.createUser({ email: 'owner@example.test', name: 'Test Owner' }));
    const { headers } = await test.login({ userId: user.id });
    const session = await auth.api.getSession({ headers });
    expect(session?.user).toMatchObject({ id: user.id, name: 'Test Owner' });
  });

  it('has no test helpers outside test mode', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    expect((await auth.$context as unknown as { test?: unknown }).test).toBeUndefined();
  });
});

describe('buildAuth HTTP surface', () => {
  const post = (auth: ReturnType<typeof buildAuth>, path: string, body?: unknown) => auth.handler(new Request(`http://localhost:3000/api/auth${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: JSON.stringify(body ?? {}),
  }));

  it.each(['/refresh-token', '/get-access-token', '/link-social'])('does not expose %s over HTTP', async (path) => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    expect((await post(auth, path)).status).toBe(404);
  });

  it('sends Google sign-in to Google’s consent screen with identity and Drive file scopes, offline', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    const res = await post(auth, '/sign-in/social', { provider: 'google', callbackURL: '/partners', disableRedirect: true });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const authorize = new URL(url);
    expect(authorize.origin).toBe('https://accounts.google.com');
    expect(authorize.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', GOOGLE_DRIVE_SCOPE, 'openid', 'profile'].sort());
    expect(authorize.searchParams.get('access_type')).toBe('offline');
    expect(authorize.searchParams.get('prompt')).toBe('select_account consent');
    expect(authorize.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback/google');
  });

  it('rejects client-supplied scopes on social sign-in', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    const res = await post(auth, '/sign-in/social', { provider: 'google', scopes: ['https://www.googleapis.com/auth/drive'] });
    expect(res.status).toBe(400);
  });

  it('rejects client-supplied extra authorize parameters on social sign-in', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    const res = await post(auth, '/sign-in/social', { provider: 'google', additionalParams: { prompt: 'none' } });
    expect(res.status).toBe(400);
  });

  it('rejects a client-supplied idToken on social sign-in', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    const res = await post(auth, '/sign-in/social', { provider: 'google', idToken: { token: 'x' } });
    expect(res.status).toBe(400);
  });

  it('redirects a failed Google callback to /sign-in with an error code', async () => {
    const auth = buildAuth({ db: await createTestDb(), env: env() });
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {}); // Better Auth logs the unknown state
    const res = await auth.handler(new Request('http://localhost:3000/api/auth/callback/google?error=access_denied&state=unknown'));
    logged.mockRestore();
    expect(res.status).toBe(302);
    expect(new URL(res.headers.get('location')!, 'http://localhost:3000')).toMatchObject({ pathname: '/sign-in', search: expect.stringMatching(/^\?error=/) });
  });
});

describe('buildAuth logging', () => {
  /** Everything written to the console, as text, with errors and their causes spelled out. */
  function captureConsole(): { text: () => string } {
    const lines: string[] = [];
    const keep = (...args: unknown[]) => { lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 10 }))).join(' ')); };
    for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation(keep);
    return { text: () => lines.join('\n') };
  }

  afterEach(() => { vi.restoreAllMocks(); });

  /** A signed-in session whose table then goes away: the next session read fails with the token in the driver's error. */
  async function brokenSession() {
    const db = await createTestDb();
    const auth = buildAuth({ db, env: env({ PD_TEST_AUTH: '1' }), plugins: [testUtils()] });
    const test = (await auth.$context as unknown as { test: TestHelpers }).test;
    const user = await test.saveUser(test.createUser({ email: 'owner@example.test', name: 'Test Owner' }));
    const { headers, token } = await test.login({ userId: user.id });
    await db.run(sql`ALTER TABLE session RENAME TO session_gone`);
    return { auth, headers, token };
  }

  it('never logs the session token when the session read fails (server call)', async () => {
    const { auth, headers, token } = await brokenSession();
    const out = captureConsole();
    await expect(auth.api.getSession({ headers })).rejects.toThrow();
    expect(out.text()).not.toBe('');
    expect(out.text()).not.toContain(token);
    expect(out.text()).not.toContain('select');
  });

  it('never logs the session token when the session read fails (HTTP)', async () => {
    const { auth, headers, token } = await brokenSession();
    const out = captureConsole();
    const res = await auth.handler(new Request('http://localhost:3000/api/auth/get-session', { headers }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain(token);
    expect(out.text()).not.toContain(token);
    expect(out.text()).not.toContain('select');
  });
});

describe('buildAuth errors that are not Better Auth errors', () => {
  function captureConsole(): () => string {
    const lines: string[] = [];
    const keep = (...args: unknown[]) => { lines.push(args.map((a) => (typeof a === 'string' ? a : inspect(a, { depth: 10 }))).join(' ')); };
    for (const method of ['error', 'warn', 'log', 'info', 'debug'] as const) vi.spyOn(console, method).mockImplementation(keep);
    return () => lines.join('\n');
  }

  afterEach(() => { vi.restoreAllMocks(); });

  async function signedInTwice() {
    const db = await createTestDb();
    const auth = buildAuth({ db, env: env({ PD_TEST_AUTH: '1' }), plugins: [testUtils()] });
    const test = (await auth.$context as unknown as { test: TestHelpers }).test;
    const user = await test.saveUser(test.createUser({ email: 'owner@example.test', name: 'Test Owner' }));
    const first = await test.login({ userId: user.id });
    const second = await test.login({ userId: user.id });
    return { db, auth, user, first, second };
  }

  it('throws a failed delete out of the handler (for the route to answer) and prints nothing of it', async () => {
    const { db, auth, first, second } = await signedInTwice();
    await db.run(sql`CREATE TRIGGER no_delete BEFORE DELETE ON session BEGIN SELECT RAISE(ABORT, 'no delete'); END`);
    const logged = captureConsole();
    const request = new Request('http://localhost:3000/api/auth/revoke-other-sessions', {
      method: 'POST', headers: { cookie: first.headers.get('cookie') ?? '', 'content-type': 'application/json', origin: 'http://localhost:3000' }, body: '{}',
    });
    const outcome = await auth.handler(request).then((res) => res.status, () => 'thrown');
    expect(logged()).not.toContain(second.token);
    expect(logged()).not.toContain(first.token);
    expect(logged()).not.toMatch(/select|delete from/i);
    expect(outcome).toBe('thrown');
  });

  it('throws a failed session insert in the Google callback out of the handler and prints nothing of it', async () => {
    const db = await createTestDb();
    const auth = buildAuth({ db, env: env() });
    const start = await auth.handler(new Request('http://localhost:3000/api/auth/sign-in/social', {
      method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ provider: 'google', callbackURL: '/partners', disableRedirect: true }),
    }));
    const state = new URL(((await start.json()) as { url: string }).url).searchParams.get('state')!;
    const cookie = start.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const base64url = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const idToken = `${base64url({ alg: 'none' })}.${base64url({
      iss: 'https://accounts.google.com', aud: 'cid', sub: 'google-anna', email: 'anna.callback@example.com', email_verified: true, name: 'Anna',
    })}.`;
    const realFetch = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url.startsWith('https://oauth2.googleapis.com/token')) {
        return Response.json({ access_token: 'at', id_token: idToken, expires_in: 3600, token_type: 'Bearer', scope: `openid email profile ${GOOGLE_DRIVE_SCOPE}` });
      }
      return realFetch(input, init);
    });
    await db.run(sql`CREATE TRIGGER no_session BEFORE INSERT ON session BEGIN SELECT RAISE(ABORT, 'no session'); END`);
    const logged = captureConsole();
    const outcome = await auth.handler(new Request(`http://localhost:3000/api/auth/callback/google?code=abc&state=${state}`, { headers: { cookie } }))
      .then((res) => res.status, () => 'thrown');
    const users = await db.run(sql`SELECT id FROM user`);
    const userId = String(users.rows[0]?.id ?? 'none');
    expect(userId).not.toBe('none'); // the callback got as far as making the user
    expect(logged()).not.toContain(userId);
    expect(logged()).not.toMatch(/insert into|anna\.callback/i);
    expect(outcome).toBe('thrown');
  });

  it('still answers get-session normally', async () => {
    const { auth, first, user } = await signedInTwice();
    const res = await auth.handler(new Request('http://localhost:3000/api/auth/get-session', { headers: first.headers }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { user: { id: string } }).user.id).toBe(user.id);
  });

  it('accepts one Better Auth path that prints a user query: a failed user lookup shows the user id, never the token', async () => {
    const { db, auth, first } = await signedInTwice();
    await db.run(sql`ALTER TABLE user RENAME TO user_gone`);
    const logged = captureConsole();
    await expect(auth.api.getSession({ headers: first.headers })).rejects.toThrow();
    expect(logged()).not.toContain(first.token);
  });
});

describe('authLogLine', () => {
  const secret = 'Zk9f8e7d6c5b4a3210Qw'; // gitleaks:allow (a made-up test value)

  it('keeps a status code and the error names, never the message text', () => {
    const cause = Object.assign(new Error(`During prerendering, fetch() rejects ${secret}`), { digest: 'HANGING_PROMISE_REJECTION' });
    class DrizzleQueryError extends Error { override name = 'DrizzleQueryError'; }
    const error = new DrizzleQueryError(`Failed query: select * from "session" where "token" = ? params: ${secret}`, { cause });
    const line = authLogLine('error', 'INTERNAL_SERVER_ERROR', [error]);
    expect(line).toBe('[auth] error INTERNAL_SERVER_ERROR DrizzleQueryError < Error HANGING_PROMISE_REJECTION');
    expect(line).not.toContain(secret);
  });

  it('keeps Better Auth\'s lower-case codes', () => {
    for (const code of ['account_not_linked', 'unable_to_create_user', 'signup_disabled', 'state_mismatch']) {
      expect(authLogLine('error', code, [])).toBe(`[auth] error ${code}`);
    }
  });

  it('keeps a fixed phrase, cut at the first colon', () => {
    expect(authLogLine('error', 'State not found', [])).toBe('[auth] error State not found');
    expect(authLogLine('error', 'Invalid origin: https://evil.example', [])).toBe('[auth] error Invalid origin');
    expect(authLogLine('error', 'missing clientId', [])).toBe('[auth] error missing clientId');
    expect(authLogLine('warn', 'Base URL is not set', [])).toBe('[auth] warn Base URL is not set');
    expect(authLogLine('error', `Failed query: select ... params: ${secret}`, [])).toBe('[auth] error Failed query');
  });

  it('hides a token, an email, a URL, a number and a query', () => {
    for (const text of [secret, `Session ${secret}`, 'No user for anna@example.com', 'Redirect to https://evil.example',
      'Redirect to www.evil.example', 'Tried 3 times', 'select "id" from "session" where "token" = ?']) {
      expect(authLogLine('error', text, [])).toBe('[auth] error message_hidden');
    }
  });

  it('takes an error passed as the message', () => {
    expect(authLogLine('error', new TypeError(secret) as unknown as string, [])).toBe('[auth] error TypeError');
  });

  it('drops names and codes that are not plain words', () => {
    const odd = Object.assign(new Error('x'), { name: `Bad ${secret}`, code: `lower_${secret}` });
    expect(authLogLine('error', 'INTERNAL_SERVER_ERROR', [odd])).toBe('[auth] error INTERNAL_SERVER_ERROR');
  });
});

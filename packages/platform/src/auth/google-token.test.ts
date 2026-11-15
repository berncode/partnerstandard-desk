import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReconnectRequired, TokenUnavailable } from '@partner-desk/storage';
import { account, user } from '../db/schema';
import { createTestDb } from '../db/test-db';
import { buildAuth, GOOGLE_DRIVE_SCOPE } from './auth-config';
import { parseEnv } from '../env';
import { googleTokenProvider } from './google-token';

async function setup(accountRow?: Partial<typeof account.$inferInsert>) {
  const db = await createTestDb();
  const auth = buildAuth({ db, env: parseEnv({ DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'cs' }) });
  await db.insert(user).values({ id: 'u_1', name: 'Anna Keller', email: 'anna@example.com' });
  if (accountRow) {
    await db.insert(account).values({
      id: 'acc_1', accountId: 'google-sub-1', providerId: 'google', userId: 'u_1',
      // Non-hex plain text: Better Auth's decryption leaves values that don't look encrypted unchanged.
      accessToken: 'test-access-token', refreshToken: 'test-refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3_600_000), scope: `openid,email,profile,${GOOGLE_DRIVE_SCOPE}`,
      ...accountRow,
    });
  }
  return { db, auth };
}

afterEach(() => { vi.unstubAllGlobals(); });

describe('googleTokenProvider', () => {
  it('returns the stored access token while it is valid', async () => {
    const { db, auth } = await setup({});
    await expect(googleTokenProvider({ auth, db, userId: 'u_1' })()).resolves.toBe('test-access-token');
  });

  it('asks for a reconnect when the user has no Google account', async () => {
    const { db, auth } = await setup();
    await expect(googleTokenProvider({ auth, db, userId: 'u_1' })()).rejects.toBeInstanceOf(ReconnectRequired);
  });

  it('asks for a reconnect when Better Auth cannot produce a token (refresh refused)', async () => {
    // Expired, and Google refuses the refresh. Better Auth refreshes through the global fetch, so stub it.
    const googleFetch = vi.fn(async () => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    vi.stubGlobal('fetch', googleFetch);
    const { db, auth } = await setup({ accessTokenExpiresAt: new Date(Date.now() - 60_000) });
    await expect(googleTokenProvider({ auth, db, userId: 'u_1' })()).rejects.toBeInstanceOf(ReconnectRequired);
    expect(googleFetch).toHaveBeenCalled();
  });
});

describe('googleTokenProvider when the stored scope lacks Drive', () => {
  // Better Auth writes account.scope only when the row is created, so a later grant has to be checked with Google.
  const NO_DRIVE = 'openid,email,profile';
  const tokeninfo = (body: unknown, status = 200) => vi.fn<typeof fetch>(async () => Response.json(body, { status }));
  const storedScope = async (db: Awaited<ReturnType<typeof setup>>['db']) =>
    (await db.select({ scope: account.scope }).from(account).where(eq(account.id, 'acc_1')))[0]?.scope;

  it('asks Google for the token’s real scopes and remembers a later Drive grant', async () => {
    const { db, auth } = await setup({ scope: NO_DRIVE });
    const fetchFn = tokeninfo({ scope: `openid https://www.googleapis.com/auth/userinfo.email ${GOOGLE_DRIVE_SCOPE}`, expires_in: '3500' });
    const getToken = googleTokenProvider({ auth, db, userId: 'u_1', fetch: fetchFn });
    await expect(getToken()).resolves.toBe('test-access-token');

    expect(fetchFn).toHaveBeenCalledTimes(1);
    const [url, init] = fetchFn.mock.calls[0]!;
    expect(String(url)).toBe('https://oauth2.googleapis.com/tokeninfo');
    expect(String(url)).not.toContain('test-access-token');
    expect(init?.method).toBe('POST');
    expect(String(init?.body)).toBe('access_token=test-access-token');
    expect((await storedScope(db))?.split(/[ ,]/)).toContain(GOOGLE_DRIVE_SCOPE);

    await expect(getToken()).resolves.toBe('test-access-token');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('asks for a reconnect when Google says Drive is still not granted', async () => {
    const { db, auth } = await setup({ scope: NO_DRIVE });
    const fetchFn = tokeninfo({ scope: 'openid https://www.googleapis.com/auth/userinfo.email' });
    await expect(googleTokenProvider({ auth, db, userId: 'u_1', fetch: fetchFn })()).rejects.toBeInstanceOf(ReconnectRequired);
    expect(await storedScope(db)).toBe(NO_DRIVE);
  });

  it.each([
    ['a refusal', tokeninfo({ error: 'invalid_token' }, 400)],
    ['an answer without scopes', tokeninfo({})],
  ])('asks for a reconnect when Google answers but grants no Drive (%s)', async (_label, fetchFn) => {
    const { db, auth } = await setup({ scope: NO_DRIVE });
    await expect(googleTokenProvider({ auth, db, userId: 'u_1', fetch: fetchFn })()).rejects.toBeInstanceOf(ReconnectRequired);
    expect(await storedScope(db)).toBe(NO_DRIVE);
  });

  it.each([
    ['a network failure', vi.fn<typeof fetch>(async () => { throw new TypeError('fetch failed'); })],
    ['a server error', tokeninfo({ error: 'backend_error' }, 503)],
    ['too many requests', tokeninfo({ error: 'rate_limited' }, 429)],
    ['a request timeout', tokeninfo({ error: 'timeout' }, 408)],
    ['an unreadable answer', vi.fn<typeof fetch>(async () => new Response('not json', { status: 200 }))],
  ])('says try later, not reconnect, when tokeninfo doesn’t answer (%s)', async (_label, fetchFn) => {
    const { db, auth } = await setup({ scope: NO_DRIVE });
    await expect(googleTokenProvider({ auth, db, userId: 'u_1', fetch: fetchFn })()).rejects.toBeInstanceOf(TokenUnavailable);
    expect(await storedScope(db)).toBe(NO_DRIVE);
  });

  it('returns the token even when remembering the Drive grant fails', async () => {
    const { db, auth } = await setup({ scope: NO_DRIVE });
    // The write-back comes after tokeninfo, so the database goes away only then.
    const fetchFn = vi.fn<typeof fetch>(async () => {
      vi.spyOn(db, 'update').mockImplementation(() => { throw new Error('Turso is down'); });
      return Response.json({ scope: `openid ${GOOGLE_DRIVE_SCOPE}` });
    });
    await expect(googleTokenProvider({ auth, db, userId: 'u_1', fetch: fetchFn })()).resolves.toBe('test-access-token');
  });
});

describe('googleTokenProvider when the database doesn’t answer', () => {
  const tursoDown = (): never => { throw new Error('Turso is down'); };

  it('reads the account row again after one failed read', async () => {
    const { db, auth } = await setup({});
    vi.spyOn(db, 'select').mockImplementationOnce(tursoDown);
    await expect(googleTokenProvider({ auth, db, userId: 'u_1' })()).resolves.toBe('test-access-token');
  });

  it('says try later, without asking Better Auth, when the account row can’t be read twice', async () => {
    const { db, auth } = await setup({});
    vi.spyOn(db, 'select').mockImplementation(tursoDown);
    const getAccessToken = vi.spyOn(auth.api, 'getAccessToken');
    await expect(googleTokenProvider({ auth, db, userId: 'u_1' })()).rejects.toBeInstanceOf(TokenUnavailable);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it('says try later when Better Auth fails because the database went away', async () => {
    const { db, auth } = await setup({});
    const real = db.select.bind(db);
    // The provider's first read works. Every read after it fails: Better Auth's own, then the provider's re-read.
    vi.spyOn(db, 'select').mockImplementation(tursoDown).mockImplementationOnce(real);
    await expect(googleTokenProvider({ auth, db, userId: 'u_1' })()).rejects.toBeInstanceOf(TokenUnavailable);
  });

  it('asks for a reconnect when the refresh fails while the database answers', async () => {
    const { db, auth } = await setup({});
    vi.spyOn(auth.api, 'getAccessToken').mockRejectedValueOnce(new Error('refresh refused'));
    await expect(googleTokenProvider({ auth, db, userId: 'u_1' })()).rejects.toBeInstanceOf(ReconnectRequired);
  });
});

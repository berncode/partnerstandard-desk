import { testUtils } from 'better-auth/plugins';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { createTestDb } from '../db/test-db';
import { oauthClient } from '../db/schema';
import { TursoAgentGrants } from '../db/turso-agent-grants';
import { parseEnv } from '../env';
import {
  AGENT_CHALLENGE_SCOPES, AGENT_CLIENT_SCOPES, agentChallenge, askedScopes, agentOAuthPlugins, agentSignInAvailable, answerAllow, levelsOffered, returnAddress, scopeForLevel,
  verifyAgentAccessToken, verifyAllowQuery,
} from './agent-oauth';
import { connectAgent } from './agent-oauth-testing';
import { buildAuth, GOOGLE_DRIVE_SCOPE } from './auth-config';

const APP = 'http://localhost:3000';

interface TestHelpers {
  createUser(input: { email: string; name: string }): unknown;
  saveUser(user: unknown): Promise<{ id: string }>;
  login(input: { userId: string }): Promise<{ headers: Headers; token: string }>;
}

/** PartnerStandard Desk's auth with the agents' OAuth provider, as the app builds it, and test sign-in. */
async function setup(appUrl = APP) {
  const env = parseEnv({
    DATABASE_URL: 'file:unused', BETTER_AUTH_SECRET: 'x'.repeat(32), APP_URL: appUrl, GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'csecret',
  });
  const db = await createTestDb();
  const auth = buildAuth({ db, env, plugins: [testUtils(), ...agentOAuthPlugins(appUrl)] });
  const test = ((await auth.$context) as unknown as { test: TestHelpers }).test;
  const signIn = async (name = 'Anna') => {
    const user = await test.saveUser(test.createUser({ email: `${name.toLowerCase()}@example.test`, name }));
    return { userId: user.id, headers: (await test.login({ userId: user.id })).headers };
  };
  return { auth, db, signIn };
}

const register = (auth: Awaited<ReturnType<typeof setup>>['auth'], body: Record<string, unknown>) => auth.handler(new Request(`${APP}/api/auth/oauth2/register`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ client_name: 'Claude', redirect_uris: ['http://127.0.0.1:5173/callback'], token_endpoint_auth_method: 'none', ...body }),
}));

describe('agentSignInAvailable', () => {
  it('needs https, except on this machine', () => {
    expect(agentSignInAvailable('https://desk.partnerstandard.com')).toBe(true);
    expect(agentSignInAvailable('http://localhost:3000')).toBe(true);
    expect(agentSignInAvailable('http://127.0.0.1:3800')).toBe(true);
    expect(agentSignInAvailable('http://desk.internal')).toBe(false);
    expect(agentOAuthPlugins('http://desk.internal')).toEqual([]);
  });

  it('adds the signing keys and the OAuth provider', () => {
    expect(agentOAuthPlugins(APP).map((plugin) => plugin.id)).toEqual(['jwt', 'oauth-provider']);
  });
});

describe('client registration', () => {
  it('gives a registered client pd.read, pd.change, pd.propose and offline_access, nothing else, and only code and refresh grants', async () => {
    const { auth } = await setup();
    const res = await register(auth, { grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    expect(res.status).toBe(201);
    const client = (await res.json()) as { scope: string; grant_types: string[] };
    expect(client.scope.split(' ').sort()).toEqual(['offline_access', 'pd.change', 'pd.propose', 'pd.read']);
    expect(client.grant_types.sort()).toEqual(['authorization_code', 'refresh_token']);
  });

  it.each(['openid', 'email', 'profile', 'pd.read openid'])('refuses a client that asks for %s', async (scope) => {
    const { auth } = await setup();
    const res = await register(auth, { scope });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_scope' });
  });

  it('refuses a client that asks for client credentials', async () => {
    const { auth } = await setup();
    const res = await register(auth, { grant_types: ['client_credentials'], token_endpoint_auth_method: 'client_secret_basic' });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_client_metadata' });
  });

  it('advertises only the code and refresh grants', async () => {
    const { auth } = await setup();
    const res = await auth.handler(new Request(`${APP}/.well-known/oauth-authorization-server/api/auth`));
    expect(res.status).toBe(200);
    const metadata = (await res.json()) as { grant_types_supported: string[]; issuer: string };
    expect(metadata.grant_types_supported.sort()).toEqual(['authorization_code', 'refresh_token']);
    expect(metadata.issuer).toBe(`${APP}/api/auth`);
  });

  it('serves the protected resource metadata of the MCP address', async () => {
    const { auth } = await setup();
    const res = await auth.handler(new Request(`${APP}/.well-known/oauth-protected-resource/mcp`));
    expect(await res.json()).toMatchObject({ resource: `${APP}/mcp`, authorization_servers: [`${APP}/api/auth`], scopes_supported: ['pd.read', 'pd.change', 'pd.propose'] });
  });

  it('an app connected at the third level gets a token with pd.read pd.change pd.propose offline_access', async () => {
    const { auth, signIn } = await setup();
    const { headers } = await signIn();
    const all = 'pd.read pd.change pd.propose offline_access';
    const { accessToken, scope } = await connectAgent(auth, { appUrl: APP, headers, asked: all, allow: all });
    expect(scope).toBe(all);
    expect(await verifyAgentAccessToken(auth, APP, accessToken)).toMatchObject({ scope: all });
  });

  it('a registration holds all a client may hold, whatever scope the app sends', async () => {
    const { auth } = await setup();
    const res = await register(auth, { scope: 'pd.read pd.change offline_access' });
    expect(((await res.json()) as { scope: string }).scope.split(' ').sort()).toEqual(['offline_access', 'pd.change', 'pd.propose', 'pd.read']);
  });

  it('an app registered before pd.propose existed is refused pd.propose before the allow page, and may still ask for less', async () => {
    const { auth, db, signIn } = await setup();
    const { headers } = await signIn();
    const { client_id: clientId } = (await (await register(auth, {})).json()) as { client_id: string };
    // Its registration row as one made before this change holds it (as the agent proposals live check found it).
    await db.update(oauthClient).set({ scopes: JSON.stringify(['pd.read', 'pd.change', 'offline_access']) }).where(eq(oauthClient.clientId, clientId));
    const authorize = async (scope: string) => {
      const res = await auth.handler(new Request(`${APP}/api/auth/oauth2/authorize?${new URLSearchParams({
        response_type: 'code', client_id: clientId, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', redirect_uri: 'http://127.0.0.1:5173/callback',
        scope, state: 'st', resource: `${APP}/mcp`, prompt: 'consent',
      })}`, { headers: { cookie: headers.get('cookie') ?? '', accept: 'application/json' } }));
      return new URL(((await res.json()) as { url: string }).url, APP);
    };
    const refused = await authorize('pd.read pd.change pd.propose offline_access');
    expect(refused.pathname).toBe('/callback');
    expect(refused.searchParams.get('error')).toBe('invalid_scope');
    expect((await authorize('pd.read pd.change offline_access')).pathname).toBe('/oauth/allow');
  });

  it('refuses a registered client that asks to authorize openid', async () => {
    const { auth, signIn } = await setup();
    const { headers } = await signIn();
    await expect(connectAgent(auth, { appUrl: APP, headers, asked: 'openid pd.read', allow: 'pd.read' })).rejects.toThrow(/authorize went to .*invalid_scope/);
  });
});

describe('the Google sign-in with the provider on', () => {
  const post = (auth: Awaited<ReturnType<typeof setup>>['auth'], body: unknown) => auth.handler(new Request(`${APP}/api/auth/sign-in/social`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: APP }, body: JSON.stringify(body),
  }));
  const google = async (res: Response) => new URL(((await res.json()) as { url: string }).url);

  it('asks Google for the same scopes, offline, with consent, with or without an agent waiting', async () => {
    const { auth } = await setup();
    const plain = await google(await post(auth, { provider: 'google', callbackURL: '/partners', disableRedirect: true }));
    // A signed-out person on their way to the allow page: the plugin sends them to sign in with the signed request,
    // and the sign-in carries it on (oauth_query).
    const registered = await register(auth, { grant_types: ['authorization_code'], response_types: ['code'] });
    const { client_id: clientId } = (await registered.json()) as { client_id: string };
    const toLogin = await auth.handler(new Request(`${APP}/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', redirect_uri: 'http://127.0.0.1:5173/callback',
      scope: 'pd.read', state: 's', resource: `${APP}/mcp`,
    })}`, { headers: { accept: 'application/json' } }));
    const loginPage = new URL(((await toLogin.json()) as { url: string }).url, APP);
    expect(loginPage.pathname).toBe('/sign-in');
    const allowQuery = loginPage.search.slice(1);
    const withAgent = await google(await post(auth, { provider: 'google', callbackURL: '/partners', disableRedirect: true, oauth_query: allowQuery }));

    for (const url of [plain, withAgent]) {
      expect(url.origin).toBe('https://accounts.google.com');
      expect(url.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', GOOGLE_DRIVE_SCOPE, 'openid', 'profile'].sort());
      expect(url.searchParams.get('access_type')).toBe('offline');
      expect(url.searchParams.get('prompt')).toBe('select_account consent');
      expect(url.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/callback/google`);
    }
  });

  it('refuses a sign-in with a forged agent request', async () => {
    const { auth } = await setup();
    const res = await post(auth, { provider: 'google', callbackURL: '/partners', disableRedirect: true, oauth_query: 'client_id=x&exp=9999999999&sig=forged' });
    expect(res.status).toBe(400);
  });

  it('does not expose the session as a token (/token)', async () => {
    const { auth, signIn } = await setup();
    const { headers } = await signIn();
    const res = await auth.handler(new Request(`${APP}/api/auth/token`, { headers: { cookie: headers.get('cookie') ?? '' } }));
    expect(res.status).toBe(404);
  });
});

describe('the paths open over HTTP', () => {
  // Every path the OAuth provider adds that the app doesn't need over HTTP: client and consent management (a person
  // could make a client with openid, or change or end a grant outside the commands), the allow page's own consent
  // (called in process), OIDC's userinfo and sign-out, introspection, key rotation, the plugin's own pages' helpers.
  const CLOSED = [
    '/oauth2/create-client', '/oauth2/update-client', '/oauth2/delete-client', '/oauth2/get-client', '/oauth2/get-clients',
    '/oauth2/client/rotate-secret', '/oauth2/client/rotate-keys', '/oauth2/get-consent', '/oauth2/get-consents', '/oauth2/update-consent',
    '/oauth2/delete-consent', '/oauth2/consent', '/oauth2/continue', '/oauth2/public-client', '/oauth2/public-client-prelogin', '/oauth2/userinfo',
    '/oauth2/end-session', '/oauth2/end-session/confirm', '/oauth2/introspect', '/admin/oauth2/create-client', '/admin/oauth2/update-client',
    '/admin/oauth2/resources', '/admin/oauth2/resources/x', '/admin/oauth2/resources/x/clients/y', '/token',
  ];

  it.each(CLOSED)('%s answers 404 to a signed-in person, GET or POST', async (path) => {
    const { auth, signIn } = await setup();
    const { headers } = await signIn();
    const cookie = headers.get('cookie') ?? '';
    for (const method of ['GET', 'POST']) {
      const res = await auth.handler(new Request(`${APP}/api/auth${path}`, {
        method, headers: { cookie, origin: APP, 'content-type': 'application/json' }, ...(method === 'POST' ? { body: '{}' } : {}),
      }));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it('keeps registration, authorize, the token exchange, the keys, revocation and discovery open', async () => {
    const { auth } = await setup();
    const get = (path: string) => auth.handler(new Request(`${APP}/api/auth${path}`));
    const post = (path: string, body: URLSearchParams) => auth.handler(new Request(`${APP}/api/auth${path}`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    }));
    expect((await register(auth, {})).status).toBe(201);
    expect((await get('/oauth2/authorize?client_id=unknown')).status).not.toBe(404);
    expect((await post('/oauth2/token', new URLSearchParams({ grant_type: 'authorization_code', code: 'x' }))).status).not.toBe(404);
    expect((await post('/oauth2/revoke', new URLSearchParams({ token: 'x' }))).status).not.toBe(404);
    expect((await get('/jwks')).status).toBe(200);
    expect((await get('/.well-known/oauth-authorization-server')).status).not.toBe(404);
  });

  it('closes nothing the app calls in process: the allow page’s consent and the keys', async () => {
    const { auth, signIn } = await setup();
    const { headers } = await signIn();
    // connectAgent answers the allow page through answerAllow (auth.api.oauth2Consent), as the page does.
    const { accessToken } = await connectAgent(auth, { appUrl: APP, headers });
    expect(await verifyAgentAccessToken(auth, APP, accessToken)).toMatchObject({ scope: 'pd.read offline_access' });
  });
});

describe('verifyAgentAccessToken', () => {
  it('reads the person, the app and the allowed scopes from a token, and refuses a changed one', async () => {
    const { auth, signIn } = await setup();
    const { userId, headers } = await signIn();
    const { clientId, accessToken, refreshToken, scope } = await connectAgent(auth, { appUrl: APP, headers });
    expect(scope).toBe('pd.read offline_access');
    expect(refreshToken).toBeTruthy();
    const claims = await verifyAgentAccessToken(auth, APP, accessToken);
    expect(claims).toMatchObject({ sub: userId, azp: clientId, scope: 'pd.read offline_access', aud: `${APP}/mcp`, iss: `${APP}/api/auth` });
    // A changed signature: one byte in its middle flipped, so the decoded bytes always differ (changing the last
    // base64url characters can decode to the same bytes).
    const [head, body, sig] = accessToken.split('.');
    const bytes = Buffer.from(sig!, 'base64url');
    const middle = bytes.length >> 1;
    bytes[middle] = bytes[middle]! ^ 0xff;
    const changed = bytes.toString('base64url');
    expect(changed).not.toBe(sig);
    await expect(verifyAgentAccessToken(auth, APP, `${head}.${body}.${changed}`)).rejects.toThrow();
  });

  it('refuses a token made for another address', async () => {
    const { auth, signIn } = await setup();
    const { headers } = await signIn();
    const { accessToken } = await connectAgent(auth, { appUrl: APP, headers });
    await expect(verifyAgentAccessToken(auth, 'http://localhost:4000', accessToken)).rejects.toThrow();
  });
});

describe('the allow page’s answer', () => {
  /** Signs Anna in and starts an agent's request; returns the allow page's signed query. */
  async function pending(asked = 'pd.read pd.change offline_access') {
    const { auth, db, signIn } = await setup();
    const { headers } = await signIn();
    const registered = await register(auth, { grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
    const { client_id: clientId } = (await registered.json()) as { client_id: string };
    const res = await auth.handler(new Request(`${APP}/api/auth/oauth2/authorize?${new URLSearchParams({
      response_type: 'code', client_id: clientId, code_challenge: 'x'.repeat(43), code_challenge_method: 'S256', redirect_uri: 'http://127.0.0.1:5173/callback',
      scope: asked, state: 'st', resource: `${APP}/mcp`, prompt: 'consent',
    })}`, { headers: { cookie: headers.get('cookie') ?? '', accept: 'application/json' } }));
    const query = new URL(((await res.json()) as { url: string }).url, APP).search.slice(1);
    return { auth, db, headers, query, clientId };
  }

  it('names where the app sends the person back: the request’s address, one the app registered', async () => {
    const { db, query, clientId } = await pending();
    const app = await new TursoAgentGrants(db).app(clientId);
    expect(app).toEqual({ name: 'Claude', redirectUris: ['http://127.0.0.1:5173/callback'] });
    expect(returnAddress(new URLSearchParams(query).get('redirect_uri'), app!.redirectUris)).toEqual({ kind: 'web', host: '127.0.0.1:5173' });
  });

  it('checks the signature of the request it shows', async () => {
    const { auth, query } = await pending();
    expect(await verifyAllowQuery(auth, query)).toBe(true);
    expect(await verifyAllowQuery(auth, query.replace('client_id=', 'client_id=x'))).toBe(false);
    expect(await verifyAllowQuery(auth, '')).toBe(false);
  });

  it('Allow with Read only sends a code back to the app', async () => {
    const { auth, headers, query } = await pending();
    const url = await answerAllow(auth, { appUrl: APP, headers, oauthQuery: query, accept: true, scope: scopeForLevel(['pd.read', 'pd.change', 'offline_access'], 'read') });
    const back = new URL(url!);
    expect(`${back.origin}${back.pathname}`).toBe('http://127.0.0.1:5173/callback');
    expect(back.searchParams.get('code')).toBeTruthy();
    expect(back.searchParams.get('state')).toBe('st');
  });

  it('Cancel sends access_denied back to the app', async () => {
    const { auth, headers, query } = await pending();
    const url = await answerAllow(auth, { appUrl: APP, headers, oauthQuery: query, accept: false, scope: [] });
    expect(new URL(url!).searchParams.get('error')).toBe('access_denied');
  });

  it('gives nothing back without a session', async () => {
    const { auth, query } = await pending();
    expect(await answerAllow(auth, { appUrl: APP, headers: new Headers(), oauthQuery: query, accept: true, scope: ['pd.read'] })).toBeNull();
  });
});

describe('levels', () => {
  it('levelsOffered lists three levels only when the app asked for pd.propose', () => {
    expect(levelsOffered(['pd.read', 'pd.change', 'pd.propose', 'offline_access'])).toEqual(['read', 'change', 'propose']);
    expect(levelsOffered(['pd.read', 'pd.change', 'offline_access'])).toEqual(['read', 'change']);
    // Proposing needs changing too: pd.propose without pd.change offers no third level.
    expect(levelsOffered(['pd.read', 'pd.propose', 'offline_access'])).toEqual(['read']);
  });

  it('scopeForLevel at propose grants "pd.read pd.change pd.propose offline_access"', () => {
    const asked = ['pd.read', 'pd.change', 'pd.propose', 'offline_access'];
    expect(scopeForLevel(asked, 'propose').join(' ')).toBe('pd.read pd.change pd.propose offline_access');
    expect(scopeForLevel(asked, 'change')).toEqual(['pd.read', 'pd.change', 'offline_access']);
    expect(scopeForLevel(asked, 'read')).toEqual(['pd.read', 'offline_access']);
    // Never more than was asked.
    expect(scopeForLevel(['pd.read', 'pd.change', 'offline_access'], 'propose')).toEqual(['pd.read', 'pd.change', 'offline_access']);
  });

  it('offers the levels the app asked for, and narrows the scope to the level picked', () => {
    expect(levelsOffered(['pd.read', 'pd.change', 'offline_access'])).toEqual(['read', 'change']);
    expect(levelsOffered(['pd.read'])).toEqual(['read']);
    expect(levelsOffered(['pd.change'])).toEqual(['change']);
    expect(levelsOffered(['offline_access'])).toEqual([]);
    expect(scopeForLevel(['pd.read', 'pd.change', 'offline_access'], 'read')).toEqual(['pd.read', 'offline_access']);
    expect(scopeForLevel(['pd.read', 'pd.change', 'offline_access'], 'change')).toEqual(['pd.read', 'pd.change', 'offline_access']);
    expect(scopeForLevel(['pd.read'], 'change')).toEqual(['pd.read']);
  });

  it('reads the scopes a request asks for; none named means all a client may hold', () => {
    expect(askedScopes('client_id=c&scope=pd.read+offline_access')).toEqual(['pd.read', 'offline_access']);
    expect(askedScopes('client_id=c')).toEqual(['pd.read', 'pd.change', 'pd.propose', 'offline_access']);
  });
});

describe('returnAddress', () => {
  const CLAUDE = ['https://claude.ai/api/mcp/auth_callback'];
  const web = (host: string) => ({ kind: 'web', host });
  const app = (scheme: string) => ({ kind: 'app', scheme });
  const same = (uri: string) => returnAddress(uri, [uri]);

  it('answers a web address’s host only, with a port that isn’t the default, never the path or the query', () => {
    expect(returnAddress('https://claude.ai/api/mcp/auth_callback', CLAUDE)).toEqual(web('claude.ai'));
    expect(same('https://tools.example.com:8443/cb?x=1')).toEqual(web('tools.example.com:8443'));
    expect(same('https://claude.ai:443/cb')).toEqual(web('claude.ai'));
  });

  it('shows an address on this machine as it is, whatever port the app picked (only the port may change there)', () => {
    expect(same('http://127.0.0.1:5173/callback')).toEqual(web('127.0.0.1:5173'));
    expect(returnAddress('http://localhost:61234/callback', ['http://localhost/callback'])).toEqual(web('localhost:61234'));
    expect(returnAddress('http://127.0.0.1:61234/callback', ['http://127.0.0.1:5173/callback'])).toEqual(web('127.0.0.1:61234'));
    expect(returnAddress('http://[::1]:7000/cb', ['http://[::1]/cb'])).toEqual(web('[::1]:7000'));
    expect(returnAddress('http://127.0.0.1:5173/other', ['http://127.0.0.1:5173/callback'])).toBeNull();
  });

  it('shows a look-alike name as the address it really is', () => {
    expect(same('https://сlaude.ai/cb')).toEqual(web('xn--laude-0ye.ai'));
  });

  it('names an app’s own scheme as an app on this device, never as a web host, so `claude.ai:` can’t pass for claude.ai', () => {
    expect(same('cursor://anysphere.cursor-mcp/oauth/callback')).toEqual(app('cursor:'));
    expect(same('com.example.app:/oauth/callback')).toEqual(app('com.example.app:'));
    expect(same('claude.ai:/callback')).toEqual(app('claude.ai:'));
    expect(same('claude.ai://x/cb')).toEqual(app('claude.ai:'));
  });

  it('answers nothing for an address that is missing, can’t be read, or the app didn’t register', () => {
    expect(returnAddress(null, CLAUDE)).toBeNull();
    expect(returnAddress('', CLAUDE)).toBeNull();
    expect(same('not an address')).toBeNull();
    expect(returnAddress('https://evil.example/cb', CLAUDE)).toBeNull();
    expect(returnAddress('https://claude.ai/api/mcp/auth_callback', [])).toBeNull();
    expect(returnAddress('https://claude.ai:8443/api/mcp/auth_callback', CLAUDE)).toBeNull();
  });
});

describe('agentChallenge', () => {
  it('points to the protected resource metadata and names the scopes with offline_access', () => {
    expect(AGENT_CHALLENGE_SCOPES).toEqual(['pd.read', 'pd.change', 'pd.propose', 'offline_access']);
    expect(AGENT_CLIENT_SCOPES).toEqual(['pd.read', 'pd.change', 'pd.propose', 'offline_access']);
    expect(agentChallenge(APP)).toBe(`Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp", scope="pd.read pd.change pd.propose offline_access"`);
    expect(agentChallenge(`${APP}/`, 'invalid_token')).toBe(
      `Bearer error="invalid_token", resource_metadata="${APP}/.well-known/oauth-protected-resource/mcp", scope="pd.read pd.change pd.propose offline_access"`,
    );
  });
});

import { createHash, randomBytes } from 'node:crypto';
import { answerAllow } from './agent-oauth';
import type { Auth } from './auth-config';

/**
 * Test only: connects an agent app the way an MCP client does (as the clients did in the live check), through
 * the auth handler with no server: register, authorize with PKCE as the signed-in person, answer the allow page
 * (in process, as the page does), swap the code for tokens. `headers` carry the person's session cookie (testUtils' login).
 */
export async function connectAgent(auth: Auth, {
  appUrl, headers, clientName = 'Claude', asked = 'pd.read pd.change offline_access', allow = 'pd.read offline_access',
  redirectUri = 'http://127.0.0.1:5173/callback',
}: {
  appUrl: string; headers: Headers; clientName?: string; asked?: string; allow?: string; redirectUri?: string;
}): Promise<{ clientId: string; accessToken: string; refreshToken: string | undefined; scope: string }> {
  const api = `${appUrl}/api/auth`;
  const registered = await auth.handler(new Request(`${api}/oauth2/register`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: clientName, redirect_uris: [redirectUri], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: 'pd.read pd.change offline_access',
    }),
  }));
  if (registered.status !== 201 && registered.status !== 200) throw new Error(`register ${registered.status}`);
  const { client_id: clientId } = (await registered.json()) as { client_id: string };

  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  const authorizeUrl = new URL(`${api}/oauth2/authorize`);
  for (const [key, value] of Object.entries({
    response_type: 'code', client_id: clientId, code_challenge: challenge, code_challenge_method: 'S256', redirect_uri: redirectUri,
    scope: asked, state: 'state-1', resource: `${appUrl}/mcp`, prompt: 'consent',
  })) authorizeUrl.searchParams.set(key, value);
  const cookie = headers.get('cookie') ?? '';
  const toAllow = await auth.handler(new Request(authorizeUrl, { headers: { cookie, accept: 'application/json' } }));
  const allowPage = new URL(((await toAllow.json()) as { url: string }).url, appUrl);
  if (allowPage.pathname !== '/oauth/allow') throw new Error(`authorize went to ${allowPage.pathname}${allowPage.search}`);

  // The allow page's answer, in process as the page gives it (the consent path is closed over HTTP).
  const answered = await answerAllow(auth, {
    appUrl, headers: new Headers({ cookie }), oauthQuery: allowPage.search.slice(1), accept: true, scope: allow.split(' ').filter(Boolean),
  });
  if (!answered) throw new Error('consent gave nothing');
  const back = new URL(answered);
  const code = back.searchParams.get('code');
  if (!code) throw new Error(`consent gave ${back.search}`);

  const token = await auth.handler(new Request(`${api}/oauth2/token`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: clientId, resource: `${appUrl}/mcp`,
    }),
  }));
  const tokens = (await token.json()) as { access_token?: string; refresh_token?: string; scope: string };
  if (!tokens.access_token) throw new Error(`token ${token.status}`);
  return { clientId, accessToken: tokens.access_token, refreshToken: tokens.refresh_token, scope: tokens.scope };
}

import { mcp } from '@better-auth/mcp';
import { verifyOAuthQueryParams } from '@better-auth/oauth-provider';
import { levelAtLeast, type AgentLevel } from '@partner-desk/commands';
import type { BetterAuthPlugin } from 'better-auth';
import { verifyJwsAccessToken } from 'better-auth/oauth2';
import { jwt } from 'better-auth/plugins';
import { SCOPE_CHANGE, SCOPE_PROPOSE, SCOPE_READ } from '../db/turso-agent-grants';
import type { Auth } from './auth-config';

// The agents' sign-in (agents spec 4.3): Better Auth's OAuth provider set up for MCP (`@better-auth/mcp`, with `jwt()`),
// as the agents live check of 2026-11 ran it. Nothing here touches the Google sign-in.

/** Lets a client keep going without asking the person again every hour (a refresh token). */
const OFFLINE = 'offline_access';

/**
 * All a registered client may hold: the three levels and a refresh token. Never `openid`, `email` or `profile`. An app
 * registered before `pd.propose` existed keeps the list it registered with, so it is refused `pd.propose` until it
 * registers again (seen in the agent proposals live check); its grant keeps its level.
 */
export const AGENT_CLIENT_SCOPES = [SCOPE_READ, SCOPE_CHANGE, SCOPE_PROPOSE, OFFLINE];

/**
 * The scopes the 401 answer names. The protected resource metadata may not list `offline_access`, and the clients ask
 * for what they are told, so the challenge names it, or they get no refresh token.
 */
export const AGENT_CHALLENGE_SCOPES = [SCOPE_READ, SCOPE_CHANGE, SCOPE_PROPOSE, OFFLINE];

const HOUR = 60 * 60;

/**
 * The provider's paths closed over HTTP (`disabledPaths` in buildAuth; the app's own `auth.api` calls still work).
 * `mcp()` brings every endpoint of `oauthProvider()`, and these would let any signed-in person make or change a client
 * past the registration rules (openid, no PKCE), or read, change or end a grant outside the commands. Also closed: the
 * allow page's consent (the page calls it in process), the plugin's own consent-page helpers, OIDC's userinfo and
 * sign-out, introspection, key rotation, and the admin paths (server only already).
 *
 * Open, because agent apps need them: `/oauth2/register` (dynamic registration, limited to the agents' scopes and
 * grants), `/oauth2/authorize`, `/oauth2/token`, `/oauth2/revoke` (an app ends its own token, RFC 7009), `/jwks` (the
 * public keys) and the discovery documents.
 */
export const AGENT_CLOSED_PATHS = [
  '/oauth2/create-client', '/oauth2/update-client', '/oauth2/delete-client', '/oauth2/get-client', '/oauth2/get-clients',
  '/oauth2/client/rotate-secret', '/oauth2/client/rotate-keys',
  '/oauth2/get-consent', '/oauth2/get-consents', '/oauth2/update-consent', '/oauth2/delete-consent', '/oauth2/consent',
  '/oauth2/continue', '/oauth2/public-client', '/oauth2/public-client-prelogin',
  '/oauth2/userinfo', '/oauth2/end-session', '/oauth2/end-session/confirm', '/oauth2/introspect',
  '/admin/oauth2/create-client', '/admin/oauth2/update-client', '/admin/oauth2/resources',
];

const base = (appUrl: string): string => appUrl.replace(/\/+$/, '');

/** The MCP address the access tokens are bound to (their audience). */
export const agentResource = (appUrl: string): string => `${base(appUrl)}/mcp`;

/** Who signs the access tokens: Better Auth at its base path. */
export const agentIssuer = (appUrl: string): string => `${base(appUrl)}/api/auth`;

const isLoopback = (hostname: string): boolean =>
  hostname === 'localhost' || hostname === '[::1]' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);

/**
 * Agents sign in only over https, or on this machine: the MCP address must be https (the plugin refuses to start
 * otherwise). A self-hosted PartnerStandard Desk on plain http elsewhere runs without agent sign-in; API keys still work.
 */
export function agentSignInAvailable(appUrl: string): boolean {
  try {
    const url = new URL(appUrl);
    return url.protocol === 'https:' || (url.protocol === 'http:' && isLoopback(url.hostname));
  } catch {
    return false;
  }
}

/**
 * Better Auth's plugins for the agents' sign-in: `jwt()` signs the access tokens, `mcp()` is the OAuth provider for
 * the MCP address. Registration is open (an agent app registers before anyone signs in), but a registered app may only
 * hold pd.read, pd.change, pd.propose and offline_access, and use the code and refresh grants. PKCE is always on for the public
 * clients agents are; S256 only. Access tokens last an hour; refresh tokens rotate and end after 30 days unused.
 * None on a plain-http address (`agentSignInAvailable`).
 */
export function agentOAuthPlugins(appUrl: string): BetterAuthPlugin[] {
  if (!agentSignInAvailable(appUrl)) return [];
  return [
    // The session-as-JWT endpoint (/token) is off in buildAuth's disabledPaths; the header would hand it out too.
    jwt({ disableSettingJwtHeader: true }),
    mcp({
      loginPage: '/sign-in',
      consentPage: '/oauth/allow',
      resource: agentResource(appUrl),
      // The server's scopes as the live check ran them; what a client can hold is the registration's list below.
      scopes: ['openid', 'profile', 'email', OFFLINE, SCOPE_READ, SCOPE_CHANGE, SCOPE_PROPOSE],
      clientRegistrationDefaultScopes: AGENT_CLIENT_SCOPES,
      clientRegistrationAllowedScopes: AGENT_CLIENT_SCOPES,
      grantTypes: ['authorization_code', 'refresh_token'],
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Older clients leave out application_type; a loopback or custom-scheme callback then counts as a native app.
      clientRegistrationDefaultApplicationType: 'infer',
      accessTokenExpiresIn: HOUR,
      refreshTokenExpiresIn: 30 * 24 * HOUR,
    }) as unknown as BetterAuthPlugin,
  ];
}

type JwksFetch = Exclude<Parameters<typeof verifyJwsAccessToken>[1]['jwksFetch'], string>;
type Claims = Awaited<ReturnType<typeof verifyJwsAccessToken>>;

/** The two endpoints the app calls itself. `buildAuth` takes plugins as a plain list, so `Auth` doesn't type them. */
interface AgentOAuthApi {
  getJwks: JwksFetch;
  oauth2Consent(input: { headers: Headers; request: Request; body: { accept: boolean; scope?: string; oauth_query: string } }): Promise<unknown>;
}
const agentApi = (auth: Auth): AgentOAuthApi => auth.api as unknown as AgentOAuthApi;

/**
 * Checks an access token in process (signature, issuer, the MCP address as audience, expiry) and answers its claims:
 * `sub` (the person), `azp` (the app), `scope`. Throws on any failure. The keys come from the auth instance, cached
 * per instance, never over HTTP from our own address.
 */
export function verifyAgentAccessToken(auth: Auth, appUrl: string, token: string): Promise<Claims> {
  return verifyJwsAccessToken(token, {
    jwksFetch: () => agentApi(auth).getJwks(),
    jwksCacheKey: auth,
    verifyOptions: { issuer: agentIssuer(appUrl), audience: agentResource(appUrl) },
  });
}

/** The 401 answer's header: where the client learns how to sign in, and the scopes to ask (RFC 9728, RFC 6750). */
export function agentChallenge(appUrl: string, error?: 'invalid_token'): string {
  const metadata = `${new URL(base(appUrl)).origin}/.well-known/oauth-protected-resource${new URL(agentResource(appUrl)).pathname}`;
  return [
    'Bearer',
    [...(error ? [`error="${error}"`] : []), `resource_metadata="${metadata}"`, `scope="${AGENT_CHALLENGE_SCOPES.join(' ')}"`].join(', '),
  ].join(' ');
}

/** Whether the allow page's address is a request the plugin signed and that hasn't expired. */
export async function verifyAllowQuery(auth: Auth, query: string): Promise<boolean> {
  if (!query) return false;
  const { secret } = (await auth.$context) as unknown as { secret: string };
  try {
    return await verifyOAuthQueryParams(query, secret);
  } catch {
    return false;
  }
}

/**
 * Whether the request's return address is one the app registered, as the provider checks it: the same address, or on
 * http on this machine the same but for the port (RFC 8252 7.3: a native app picks a free port each time).
 */
function registeredReturn(registered: readonly string[], requested: string): boolean {
  return registered.some((one) => {
    if (one === requested) return true;
    try {
      const [a, b] = [new URL(one), new URL(requested)];
      if (a.protocol !== 'http:' || b.protocol !== 'http:' || !isLoopback(a.hostname)) return false;
      a.port = '';
      b.port = '';
      return a.href === b.href;
    } catch {
      return false;
    }
  });
}

/** Where an app sends the person back: a web address (its host), or an app on this device (its own scheme). */
export type ReturnAddress = { kind: 'web'; host: string } | { kind: 'app'; scheme: string };

/**
 * Where the allow page says the app sends the person back (the owner, 2026-11-02). A web address (http or https)
 * answers its host, with its port when it isn't the default, never the path or the query, so a look-alike app shows its
 * real address; a look-alike name shows as the address it really is (`xn--…`). Any other address is an app's own
 * scheme on this device (`cursor:`, `com.example.app:`), and never stands in the web host's place: open registration
 * accepts a scheme like `claude.ai:`, which must not read as claude.ai. Null when the address is missing, can't be
 * read, or isn't one the app registered (the provider refuses those before the page, so null means a changed
 * request): the page then refuses.
 */
export function returnAddress(redirectUri: string | null | undefined, registered: readonly string[]): ReturnAddress | null {
  if (!redirectUri || !registeredReturn(registered, redirectUri)) return null;
  let url: URL;
  try {
    url = new URL(redirectUri);
  } catch {
    return null;
  }
  if (url.protocol === 'https:' || url.protocol === 'http:') return url.host ? { kind: 'web', host: url.host } : null;
  return { kind: 'app', scheme: url.protocol };
}

/** The scopes an allow page's request asks for; a request that names none asks for all a client may hold. */
export function askedScopes(oauthQuery: string): string[] {
  const scope = new URLSearchParams(oauthQuery).get('scope')?.split(' ').filter(Boolean) ?? [];
  return scope.length > 0 ? scope : [...AGENT_CLIENT_SCOPES];
}

/**
 * The levels the allow page offers: those the app asked for. The third ("Read, change and propose") needs both
 * pd.change and pd.propose, as `levelOf` reads it. Picking one can only narrow what was asked.
 */
export function levelsOffered(asked: readonly string[]): AgentLevel[] {
  const change = asked.includes(SCOPE_CHANGE);
  return [
    ...(asked.includes(SCOPE_READ) ? ['read' as const] : []),
    ...(change ? ['change' as const] : []),
    ...(change && asked.includes(SCOPE_PROPOSE) ? ['propose' as const] : []),
  ];
}

/**
 * The scopes to allow for the level picked, out of those asked: "Read only" drops pd.change and pd.propose, "Read and
 * change" drops pd.propose, the third keeps both.
 */
export function scopeForLevel(asked: readonly string[], level: AgentLevel): string[] {
  return asked.filter((scope) => scope === OFFLINE || scope === SCOPE_READ
    || (scope === SCOPE_CHANGE && levelAtLeast(level, 'change')) || (scope === SCOPE_PROPOSE && level === 'propose'));
}

/**
 * Answers the allow page as the signed-in person (`headers` carry their cookie): Allow with the scopes, or Cancel.
 * Answers the address to send the browser to (the app's callback with a code, or with `access_denied`), or null when
 * the plugin refused (no session, an expired or changed request). Learnings, "The allow page": the consent runs the
 * authorize step, which needs a request, and asks for JSON so a browser's headers don't make it throw its redirect.
 */
export async function answerAllow(auth: Auth, { appUrl, headers, oauthQuery, accept, scope }: {
  appUrl: string; headers: Headers; oauthQuery: string; accept: boolean; scope: readonly string[];
}): Promise<string | null> {
  const consentHeaders = new Headers(headers);
  consentHeaders.set('accept', 'application/json');
  consentHeaders.delete('sec-fetch-mode');
  const request = new Request(`${agentIssuer(appUrl)}/oauth2/consent`, { method: 'POST', headers: consentHeaders });
  let answer: unknown;
  try {
    answer = await agentApi(auth).oauth2Consent({
      headers: consentHeaders, request, body: { accept, oauth_query: oauthQuery, ...(accept ? { scope: scope.join(' ') } : {}) },
    });
  } catch {
    return null;
  }
  // Given a request, Better Auth answers with a Response, as its HTTP handler would.
  if (answer instanceof Response) {
    if (!answer.ok) return null;
    answer = answer.headers.get('location') ? { url: answer.headers.get('location') } : await answer.json().catch(() => null);
  }
  const url = (answer as { url?: unknown } | null)?.url;
  return typeof url === 'string' && url ? url : null;
}

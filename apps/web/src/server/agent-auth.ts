import { agentContext, levelAtLeast, levelWithinRole, type AgentContext, type AgentLevel, type AgentVia } from '@partner-desk/commands';
import {
  agentChallenge, agentSignInAvailable, API_KEY_PREFIX, editionFlags, levelOf, serverEnv, userContact, verifyAgentAccessToken,
} from '@partner-desk/platform';
import { accessFor, agentDepsFor, agentGrants, apiKeys, getAuth, getDb } from './runtime';

/**
 * Requests a minute per grant and per key (agents spec 8): hosted 60, below Google's 60 reads a minute per person; on a
 * company server, AGENT_REQUESTS_PER_MINUTE when set (plan 13, spec 2026-11-07 §11), read in env.ts.
 */
const MINUTE_MS = 60_000;

export type AgentAuth =
  /** `grantKey`: `key:<id>` for an API key, `oauth:<clientId>:<userId>` for an app allowed on the allow page. */
  | { ok: true; ctx: AgentContext; grantKey: string }
  | { ok: false; status: 401 | 429; headers: Record<string, string> };

/** Who a checked credential acts for, before the person and their company are looked up. */
interface Credential { userId: string; agentName: string; level: AgentLevel; via: AgentVia; grantKey: string }

/**
 * A signed access token from the allow page, checked in process (signature, issuer, the MCP address, expiry), then
 * against the database on every request: the grant must still be on (Turn off deletes it, and a signed token is never
 * stored, so this is what ends it at once). The level is the lower of the token's and the grant's (read < change <
 * propose): allowing less takes effect at once, allowing more with the app's next token. Refused: a token bound to a
 * key (`cnf`, DPoP, which we don't support), one without pd.read or pd.change, a turned off app.
 */
async function fromAccessToken(token: string, appUrl: string): Promise<Credential | null> {
  if (!agentSignInAvailable(appUrl)) return null;
  let claims: Awaited<ReturnType<typeof verifyAgentAccessToken>>;
  try {
    claims = await verifyAgentAccessToken(getAuth(), appUrl, token);
  } catch {
    return null;
  }
  if (claims.cnf !== undefined) return null;
  const userId = typeof claims.sub === 'string' ? claims.sub : '';
  const clientId = typeof claims.azp === 'string' ? claims.azp : '';
  const tokenLevel = levelOf(typeof claims.scope === 'string' ? claims.scope.split(' ') : []);
  if (!userId || !clientId || !tokenLevel) return null;
  const grant = await agentGrants().find(userId, clientId);
  const grantLevel = grant ? levelOf(grant.scopes) : null;
  if (!grant || !grantLevel) return null;
  const level: AgentLevel = levelAtLeast(tokenLevel, grantLevel) ? grantLevel : tokenLevel;
  return { userId, agentName: grant.appName, level, via: { kind: 'app', clientId }, grantKey: `oauth:${clientId}:${userId}` };
}

/** An API key (`pd_…`): its owner, name and level, or null when unknown or turned off. */
async function fromApiKey(key: string): Promise<Credential | null> {
  const found = await apiKeys().verify(key);
  return found ? { userId: found.userId, agentName: found.name, level: found.level, via: { kind: 'key', keyId: found.id }, grantKey: `key:${found.id}` } : null;
}

/**
 * Turns an MCP or REST request into the agent's context: its person, their own company and the commands'
 * dependencies, or the answer to refuse it with. `Authorization: Bearer pd_…` is an API key; any other bearer is an
 * access token from the allow page. Refused with 401 (and the header that tells a client where to sign in): no bearer,
 * an unknown, changed, expired or turned off credential, and a person who no longer exists (checked before anything
 * makes their company row). Over the edition's limit in the minute (60 hosted; AGENT_REQUESTS_PER_MINUTE on a company server), 429 with `Retry-After`.
 *
 * A database failure throws: the route answers it as any failed request. Nothing here logs the credential.
 */
export async function resolveAgent(request: Request, now: number = Date.now()): Promise<AgentAuth> {
  const appUrl = serverEnv().APP_URL;
  const refuse = (error?: 'invalid_token'): AgentAuth => ({ ok: false, status: 401, headers: { 'WWW-Authenticate': agentChallenge(appUrl, error) } });

  const bearer = /^Bearer +(\S+) *$/i.exec(request.headers.get('authorization') ?? '')?.[1];
  if (!bearer) return refuse();
  const credential = bearer.startsWith(API_KEY_PREFIX) ? await fromApiKey(bearer) : await fromAccessToken(bearer, appUrl);
  if (!credential) return refuse('invalid_token');

  // A deleted account: no person to act for, and `companies.forUser` would make a new, empty company for them. On a
  // company server, a person who is no longer a member: nothing to reach (plan 15).
  const person = await userContact(getDb(), credential.userId);
  if (person === null) return refuse('invalid_token');
  const access = await accessFor({ id: credential.userId, email: person.email });
  if (access.kind === 'none') return refuse('invalid_token');

  const deps = await agentDepsFor(access.userId);
  if (!(await deps.rateLimits.hit(credential.grantKey, editionFlags(serverEnv()).agentRequestsPerMinute, MINUTE_MS, now))) {
    const windowEnd = (Math.floor(now / MINUTE_MS) + 1) * MINUTE_MS;
    return { ok: false, status: 429, headers: { 'Retry-After': String(Math.max(1, Math.ceil((windowEnd - now) / 1000))) } };
  }
  const ctx = await agentContext(deps, {
    userId: access.userId, displayName: person.name, agentName: credential.agentName, via: credential.via,
    // Within the member's role: a viewer's agent reads only, whatever its grant or key says (plan 15).
    level: levelWithinRole(credential.level, access.kind === 'member' ? access.member.role : undefined),
    ...(access.kind === 'member' ? { member: access.member } : {}),
  });
  return { ok: true, ctx, grantKey: credential.grantKey };
}

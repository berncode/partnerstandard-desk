import { eq } from 'drizzle-orm';
import { ReconnectRequired, TokenUnavailable } from '@partner-desk/storage';
import type { Db } from '../db/client';
import { account } from '../db/schema';
import { accountRowForToken, refreshFailure } from './accounts';
import { GOOGLE_DRIVE_SCOPE, type Auth } from './auth-config';

const hasDrive = (scope: string | null | undefined) => (scope ?? '').split(/[ ,]+/).includes(GOOGLE_DRIVE_SCOPE);

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo';

/**
 * The scopes Google says `accessToken` carries. A refusal (4xx) or an answer without scopes is []: the token can't
 * use Drive. No answer (network, 5xx, 429, 408, an unreadable body) throws TokenUnavailable. The token goes in the body, never
 * the URL.
 */
async function grantedScopes(fetchFn: typeof fetch, accessToken: string): Promise<string[]> {
  let response: Response;
  try {
    response = await fetchFn(TOKENINFO_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ access_token: accessToken }).toString(),
    });
  } catch {
    throw new TokenUnavailable();
  }
  // Busy or timed out is no answer either: only a real refusal means the token can't use Drive.
  if (response.status >= 500 || response.status === 429 || response.status === 408) throw new TokenUnavailable();
  if (!response.ok) return [];
  let scope: unknown;
  try {
    scope = ((await response.json()) as { scope?: unknown } | null)?.scope;
  } catch {
    throw new TokenUnavailable();
  }
  return typeof scope === 'string' ? scope.split(' ').filter(Boolean) : [];
}

/**
 * A fresh Google access token for `userId`, refreshed by Better Auth when it is about to expire:
 * - The account row is read twice before the database is blamed (TokenUnavailable).
 * - Better Auth reports every refresh failure the same way, so after one the row is read again. If the database
 *   answers, the refresh was refused (ReconnectRequired); if not, the database was the problem (TokenUnavailable).
 *
 * Google lets people untick the Drive permission at consent; without it every Sheets call would fail. Better Auth
 * stores the granted scopes only when the account row is created, so a stored scope without Drive may be stale
 * (the person granted it on a later sign-in): then Google's tokeninfo decides, and a grant is written back.
 */
export function googleTokenProvider({ auth, db, userId, fetch: fetchFn = fetch }: {
  auth: Auth; db: Db; userId: string; fetch?: typeof fetch;
}): () => Promise<string> {
  return async () => {
    const row = await accountRowForToken(db, userId);
    if (!row) throw new ReconnectRequired();
    let accessToken: string | undefined;
    try {
      ({ accessToken } = await auth.api.getAccessToken({ body: { accountId: row.id, userId } }));
    } catch {
      throw await refreshFailure(db, userId);
    }
    if (!accessToken) throw new ReconnectRequired();
    if (hasDrive(row.scope)) return accessToken;

    const scopes = await grantedScopes(fetchFn, accessToken);
    if (!scopes.includes(GOOGLE_DRIVE_SCOPE)) throw new ReconnectRequired();
    try {
      // Better Auth's own format: comma-separated.
      await db.update(account).set({ scope: scopes.join(',') }).where(eq(account.id, row.id));
    } catch {
      // Best effort: the token works, and tokeninfo is asked again next time.
    }
    return accessToken;
  };
}

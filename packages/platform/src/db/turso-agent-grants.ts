import type { AgentLevel } from '@partner-desk/commands';
import { and, eq, inArray, or, sql } from 'drizzle-orm';
import type { Db } from './client';
import { guarded } from './guarded';
import { oauthAccessToken, oauthClient, oauthClientResource, oauthConsent, oauthRefreshToken } from './schema';

/** The scopes that give an agent its level (the allow page's choices). Proposing needs changing too (spec 5.2). */
export const SCOPE_READ = 'pd.read';
export const SCOPE_CHANGE = 'pd.change';
export const SCOPE_PROPOSE = 'pd.propose';

/** An agent app a person allowed, as Settings lists it. */
export interface AgentGrant {
  clientId: string;
  /** The name the app registered with (`client_name`); '' when it gave none. */
  appName: string;
  level: AgentLevel;
  /** When the person last pressed Allow for it. */
  allowedAt: string;
  /** When the app last renewed its access (about once an hour while it works), or null. */
  lastUsedAt: string | null;
}

/**
 * The plugin stores a scope list as JSON text. Read tolerantly: a space-separated string counts too, anything else is
 * no scopes.
 */
export function parseScopes(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return value.split(/\s+/).filter(Boolean);
  }
}

/** The plugin stores a client's return addresses as a JSON list. Read tolerantly: anything else is none. */
function parseUris(value: string | null | undefined): string[] {
  try {
    const parsed: unknown = JSON.parse(value ?? '');
    return Array.isArray(parsed) ? parsed.filter((uri): uri is string => typeof uri === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * The level a set of scopes gives: propose with `pd.propose` and `pd.change`, change with `pd.change`, read with
 * `pd.read`, else none. `pd.propose` without `pd.change` adds nothing (builder's call): it is read with `pd.read`.
 */
export function levelOf(scopes: readonly string[]): AgentLevel | null {
  if (scopes.includes(SCOPE_CHANGE)) return scopes.includes(SCOPE_PROPOSE) ? 'propose' : 'change';
  if (scopes.includes(SCOPE_READ)) return 'read';
  return null;
}

const iso = (value: Date | number | null | undefined): string | null => (value === null || value === undefined ? null : new Date(value).toISOString());

/**
 * A person's grants to agent apps, kept in the OAuth provider's own tables: the consent row is the grant (its scopes
 * are the level), the refresh tokens keep it going. Access tokens are signed and never stored, so `resolveAgent` checks
 * on every request that the consent row is still there: deleting it turns the app off at once. Every call fails with
 * the operation's name only.
 */
export class TursoAgentGrants {
  constructor(private readonly db: Db) {}

  /** The apps the person allowed, the last allowed first. */
  async list(userId: string): Promise<AgentGrant[]> {
    const consents = await guarded('agent_grants_list_failed', () => this.db.select({
      clientId: oauthConsent.clientId, scopes: oauthConsent.scopes, createdAt: oauthConsent.createdAt, updatedAt: oauthConsent.updatedAt,
      name: oauthClient.name,
    }).from(oauthConsent).innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId)).where(eq(oauthConsent.userId, userId)));
    const uses = await guarded('agent_grants_list_failed', () => this.db.select({
      clientId: oauthRefreshToken.clientId, at: sql<number | null>`max(${oauthRefreshToken.createdAt})`,
    }).from(oauthRefreshToken).where(eq(oauthRefreshToken.userId, userId)).groupBy(oauthRefreshToken.clientId));
    const lastUse = new Map(uses.map((use) => [use.clientId, iso(use.at)]));
    return consents.flatMap((row): AgentGrant[] => {
      const level = levelOf(parseScopes(row.scopes));
      const allowedAt = iso(row.updatedAt ?? row.createdAt);
      if (!level || !allowedAt) return [];
      return [{ clientId: row.clientId, appName: row.name ?? '', level, allowedAt, lastUsedAt: lastUse.get(row.clientId) ?? null }];
    }).sort((a, b) => b.allowedAt.localeCompare(a.allowedAt));
  }

  /** The person's grant to this app, if it is on: the app's name and the scopes allowed. Null once turned off. */
  async find(userId: string, clientId: string): Promise<{ appName: string; scopes: string[] } | null> {
    const [row] = await guarded('agent_grants_find_failed', () => this.db.select({
      scopes: oauthConsent.scopes, name: oauthClient.name, disabled: oauthClient.disabled,
    }).from(oauthConsent).innerJoin(oauthClient, eq(oauthClient.clientId, oauthConsent.clientId))
      .where(and(eq(oauthConsent.userId, userId), eq(oauthConsent.clientId, clientId))).limit(1));
    if (!row || row.disabled) return null;
    return { appName: row.name ?? '', scopes: parseScopes(row.scopes) };
  }

  /**
   * The registered app: its name ('' when it gave none) and the return addresses it registered (the allow page shows
   * where it sends the person back), or null when no app has this id.
   */
  async app(clientId: string): Promise<{ name: string; redirectUris: string[] } | null> {
    const [row] = await guarded('agent_grants_app_failed', () => this.db.select({ name: oauthClient.name, redirectUris: oauthClient.redirectUris })
      .from(oauthClient).where(eq(oauthClient.clientId, clientId)).limit(1));
    return row ? { name: row.name ?? '', redirectUris: parseUris(row.redirectUris) } : null;
  }

  /**
   * Turn off: deletes the person's consent and refresh tokens for this app (and stored access tokens, should there
   * ever be any), in one batch. The app's signed access token stops working at once, because `resolveAgent` finds no
   * consent. Another person's grant to the same app stays. True when there was a grant to turn off.
   */
  async revoke(userId: string, clientId: string): Promise<boolean> {
    const mine = <T extends typeof oauthAccessToken | typeof oauthRefreshToken | typeof oauthConsent>(table: T) =>
      and(eq(table.userId, userId), eq(table.clientId, clientId));
    const [, , consents] = await guarded('agent_grants_revoke_failed', () => this.db.batch([
      this.db.delete(oauthAccessToken).where(mine(oauthAccessToken)),
      this.db.delete(oauthRefreshToken).where(mine(oauthRefreshToken)),
      this.db.delete(oauthConsent).where(mine(oauthConsent)).returning({ id: oauthConsent.id }),
    ]));
    return consents.length > 0;
  }

  /**
   * Delete account: the person's grants and tokens, and the apps they registered while signed in (with every grant
   * and token to those apps). The plugin's user links don't cascade, so these go before the user row. One batch.
   */
  async deleteForUser(userId: string): Promise<void> {
    const owned = this.db.select({ clientId: oauthClient.clientId }).from(oauthClient).where(eq(oauthClient.userId, userId));
    const theirs = <T extends typeof oauthAccessToken | typeof oauthRefreshToken | typeof oauthConsent>(table: T) =>
      or(eq(table.userId, userId), inArray(table.clientId, owned));
    await guarded('agent_grants_delete_failed', () => this.db.batch([
      this.db.delete(oauthAccessToken).where(theirs(oauthAccessToken)),
      this.db.delete(oauthRefreshToken).where(theirs(oauthRefreshToken)),
      this.db.delete(oauthConsent).where(theirs(oauthConsent)),
      this.db.delete(oauthClientResource).where(inArray(oauthClientResource.clientId, owned)),
      this.db.delete(oauthClient).where(eq(oauthClient.userId, userId)),
    ]));
  }
}

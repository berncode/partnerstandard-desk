import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

const timestamps = {
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`).$onUpdate(() => new Date()).notNull(),
};

/** Better Auth's tables (owner identity). `account` holds the Google tokens, encrypted by Better Auth. */
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).default(false).notNull(),
  image: text('image'),
  ...timestamps,
});

export const session = sqliteTable('session', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  token: text('token').notNull().unique(),
  ...timestamps,
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
}, (t) => [index('session_userId_idx').on(t.userId)]);

export const account = sqliteTable('account', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
  refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
  scope: text('scope'),
  password: text('password'),
  ...timestamps,
}, (t) => [index('account_userId_idx').on(t.userId)]);

export const verification = sqliteTable('verification', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
  ...timestamps,
}, (t) => [index('verification_identifier_idx').on(t.identifier)]);

// The OAuth provider's tables, for agents (`@better-auth/mcp`, `oauthProvider()` underneath, with `jwt()`). Keys and
// columns as the plugins define them (checked in the agents live check, 2026-11): arrays
// and JSON are text, dates are milliseconds. Ids, hashes, client names and addresses only: no partner content.
// The plugin's user links don't cascade: Delete account removes these rows first (TursoAgentGrants.deleteForUser).

/** The signing keys of the access tokens. The private key is encrypted with BETTER_AUTH_SECRET. */
export const jwks = sqliteTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  alg: text('alg'),
  crv: text('crv'),
});

/** A registered agent app: its id, its name ("Claude Code (partner-desk)") and its redirect addresses. */
export const oauthClient = sqliteTable('oauth_client', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  clientDiscoveryId: text('client_discovery_id'),
  disabled: integer('disabled', { mode: 'boolean' }).default(false),
  skipConsent: integer('skip_consent', { mode: 'boolean' }),
  enableEndSession: integer('enable_end_session', { mode: 'boolean' }),
  subjectType: text('subject_type'),
  scopes: text('scopes'),
  clientCredentialsScopes: text('client_credentials_scopes').default('[]'),
  userId: text('user_id').references(() => user.id),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  name: text('name'),
  uri: text('uri'),
  icon: text('icon'),
  contacts: text('contacts'),
  tos: text('tos'),
  policy: text('policy'),
  softwareId: text('software_id'),
  softwareVersion: text('software_version'),
  softwareStatement: text('software_statement'),
  redirectUris: text('redirect_uris').notNull(),
  postLogoutRedirectUris: text('post_logout_redirect_uris'),
  backchannelLogoutUri: text('backchannel_logout_uri'),
  backchannelLogoutSessionRequired: integer('backchannel_logout_session_required', { mode: 'boolean' }),
  tokenEndpointAuthMethod: text('token_endpoint_auth_method'),
  applicationType: text('application_type'),
  jwks: text('jwks'),
  jwksUri: text('jwks_uri'),
  grantTypes: text('grant_types'),
  responseTypes: text('response_types'),
  requirePKCE: integer('require_p_k_c_e', { mode: 'boolean' }),
  dpopBoundAccessTokens: integer('dpop_bound_access_tokens', { mode: 'boolean' }).default(false),
  referenceId: text('reference_id'),
  metadata: text('metadata'),
}, (t) => [index('oauthClient_userId_idx').on(t.userId)]);

/** The MCP address the tokens are bound to, written by the plugin at start. */
export const oauthResource = sqliteTable('oauth_resource', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull().unique(),
  name: text('name').notNull(),
  accessTokenTtl: integer('access_token_ttl'),
  refreshTokenTtl: integer('refresh_token_ttl'),
  signingAlgorithm: text('signing_algorithm'),
  signingKeyId: text('signing_key_id'),
  allowedScopes: text('allowed_scopes'),
  customClaims: text('custom_claims'),
  dpopBoundAccessTokensRequired: integer('dpop_bound_access_tokens_required', { mode: 'boolean' }).default(false),
  disabled: integer('disabled', { mode: 'boolean' }).default(false),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
  policyVersion: integer('policy_version').default(1),
  metadata: text('metadata'),
});

export const oauthClientResource = sqliteTable('oauth_client_resource', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId, { onDelete: 'cascade' }),
  resourceId: text('resource_id').notNull().references(() => oauthResource.identifier, { onDelete: 'cascade' }),
  metadata: text('metadata'),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
}, (t) => [index('oauthClientResource_clientId_idx').on(t.clientId), index('oauthClientResource_resourceId_idx').on(t.resourceId)]);

/** Refresh tokens, stored as a hash of the token, never the token. */
export const oauthRefreshToken = sqliteTable('oauth_refresh_token', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: text('user_id').notNull().references(() => user.id),
  referenceId: text('reference_id'),
  authorizationCodeId: text('authorization_code_id'),
  resources: text('resources'),
  requestedUserInfoClaims: text('requested_user_info_claims'),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  revoked: integer('revoked', { mode: 'timestamp_ms' }),
  rotatedAt: integer('rotated_at', { mode: 'timestamp_ms' }),
  rotationReplayResponse: text('rotation_replay_response'),
  rotationReplayExpiresAt: integer('rotation_replay_expires_at', { mode: 'timestamp_ms' }),
  authTime: integer('auth_time', { mode: 'timestamp_ms' }),
  confirmation: text('confirmation'),
  scopes: text('scopes').notNull(),
}, (t) => [
  index('oauthRefreshToken_clientId_idx').on(t.clientId), index('oauthRefreshToken_sessionId_idx').on(t.sessionId),
  index('oauthRefreshToken_userId_idx').on(t.userId), index('oauthRefreshToken_authorizationCodeId_idx').on(t.authorizationCodeId),
]);

/** Opaque access tokens only. Ours are signed and never stored, so this table stays empty. */
export const oauthAccessToken = sqliteTable('oauth_access_token', {
  id: text('id').primaryKey(),
  token: text('token').unique(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId),
  sessionId: text('session_id').references(() => session.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => user.id),
  referenceId: text('reference_id'),
  authorizationCodeId: text('authorization_code_id'),
  resources: text('resources'),
  requestedUserInfoClaims: text('requested_user_info_claims'),
  refreshId: text('refresh_id').references(() => oauthRefreshToken.id),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  revoked: integer('revoked', { mode: 'timestamp_ms' }),
  confirmation: text('confirmation'),
  scopes: text('scopes').notNull(),
}, (t) => [
  index('oauthAccessToken_clientId_idx').on(t.clientId), index('oauthAccessToken_sessionId_idx').on(t.sessionId),
  index('oauthAccessToken_userId_idx').on(t.userId), index('oauthAccessToken_authorizationCodeId_idx').on(t.authorizationCodeId),
  index('oauthAccessToken_refreshId_idx').on(t.refreshId),
]);

/** What a person allowed an agent app: one row per person and app, its scopes say the level. Turn off deletes it. */
export const oauthConsent = sqliteTable('oauth_consent', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull().references(() => oauthClient.clientId),
  userId: text('user_id').references(() => user.id),
  referenceId: text('reference_id'),
  resources: text('resources'),
  requestedUserInfoClaims: text('requested_user_info_claims'),
  scopes: text('scopes').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
}, (t) => [index('oauthConsent_clientId_idx').on(t.clientId), index('oauthConsent_userId_idx').on(t.userId)]);

export const oauthClientAssertion = sqliteTable('oauth_client_assertion', {
  id: text('id').primaryKey(),
  expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
});

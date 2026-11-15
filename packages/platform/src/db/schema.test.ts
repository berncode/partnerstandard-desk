import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as schema from './schema';
import { createTestDb } from './test-db';

// Better Auth's tables, and the OAuth provider's (agents): their shapes are the plugins', checked in turso-agent-grants.
const authTables = new Set([
  'user', 'session', 'account', 'verification', 'jwks', 'oauth_client', 'oauth_resource', 'oauth_client_resource', 'oauth_refresh_token',
  'oauth_access_token', 'oauth_consent', 'oauth_client_assertion',
]);

function ownTables() {
  return (Object.values(schema) as unknown[])
    .filter((v): v is SQLiteTable => is(v, SQLiteTable))
    .filter((t) => !authTables.has(getTableName(t)));
}

describe('schema', () => {
  it('has no content columns', () => {
    const actual = Object.fromEntries(
      ownTables().map((t) => [getTableName(t), Object.values(getTableColumns(t)).map((c) => c.name).sort()]),
    );
    expect(actual).toEqual({
      companies: ['created_at', 'id', 'name', 'owner_user_id', 'timezone'],
      partner_books: ['company_id', 'created_at', 'file_id', 'owner_user_id'],
      markets: ['archived_at', 'company_id', 'created_at', 'display_name', 'file_id', 'id', 'owner_user_id'],
      programs: ['company_id', 'created_at', 'display_name', 'file_id', 'id', 'owner_user_id', 'partner_type'],
      company_facts: ['company_id', 'created_at', 'file_id', 'owner_user_id'],
      business_cases: ['company_id', 'created_at', 'display_name', 'file_id', 'id', 'owner_user_id', 'partner_id', 'partner_type'],
      share_links: ['case_id', 'created_at', 'id', 'owner_user_id', 'revoked_at', 'token_hash'],
      // A held review's summary links: ids and the token's hash, never the review or who it went to (reviews spec 7).
      review_links: ['created_at', 'id', 'map_id', 'owner_user_id', 'review_id', 'revoked_at', 'token_hash'],
      maps: [
        'company_id', 'created_at', 'dates_move_failed_for', 'dates_moved_for', 'digest_health', 'display_name', 'file_id', 'id', 'last_change_at',
        'momentum_state', 'notify_settings', 'owner_user_id', 'partner_alerts_through', 'partner_id', 'partner_type', 'paused_reason', 'started_on',
        'webhook_health',
      ],
      map_links: ['created_at', 'email_hash', 'id', 'last_used_at', 'map_id', 'owner_user_id', 'person_id', 'revoked_at', 'side', 'token_hash'],
      map_sessions: ['expires_at', 'id', 'link_id', 'map_id', 'token_hash'],
      // Ids and codes of a link holder's change, never what they wrote.
      map_events: ['action', 'actor_ref', 'at', 'entity_id', 'entity_type', 'id', 'map_id'],
      // The recipient's address is the one piece of personal data: kept 90 days for de-duplication (spec 7).
      notification_log: ['claimed_at', 'dedupe_key', 'map_id', 'recipient_email', 'resend_id', 'sent_at', 'type'],
      email_prefs: ['email_hash', 'type', 'unsubscribed_at'],
      rate_limits: ['count', 'key', 'window_start'],
      storage_folders: ['folder_id', 'user_id'],
      file_locks: ['expires_at', 'holder', 'key'],
      file_writes: ['file_id', 'written_at'],
      events: ['actor_kind', 'actor_user_id', 'at', 'change', 'command', 'entity_ids', 'file_id', 'id', 'proposal_id'],
      // The one content table, approved for the self-hosted edition only (spec 2026-11-07 §14): there the company's own
      // database holds its work. Hosted never writes it; plan 13's wiring test proves that.
      work_files: ['body', 'company_id', 'created_at', 'format_version', 'id', 'kind', 'revision', 'trashed_at', 'updated_at'],
      // One row per agent proposal: ids, codes and times, and the app's name (agent proposals spec 7.2). Never its content.
      proposals: [
        'account_id', 'answered_at', 'client_id', 'created_at', 'expires_at', 'file_id', 'hypothesis_id', 'id', 'key_id', 'kind', 'maker_kind',
        'maker_name', 'maker_person_id', 'market_id', 'partner_id', 'status', 'user_id',
      ],
      // An API key's name, level and the hash of the key, never the key (agents spec 4.4).
      api_keys: ['created_at', 'id', 'key_hash', 'last_used_at', 'level', 'name', 'prefix', 'revoked_at', 'user_id'],
      // A webhook's address, events and encrypted secret; its deliveries hold event types and ids, never content (agents spec 7.3, 9).
      webhooks: ['created_at', 'events', 'first_failure_at', 'id', 'secret_enc', 'status', 'turned_on_at', 'url', 'user_id'],
      webhook_deliveries: ['attempts', 'data', 'done_at', 'given_up_at', 'id', 'last_status', 'next_try_at', 'occurred_at', 'type', 'webhook_id'],
      webhook_marks: ['at', 'key', 'user_id'],
      // A company server's workspace (plan 15): its key, its members' ids and roles, and the invited addresses until the
      // first sign-in. Hosted never writes these.
      workspace: ['created_at', 'id', 'slot'],
      workspace_members: ['added_at', 'added_by', 'person_id', 'role'],
      workspace_invites: ['created_at', 'email', 'expires_at', 'id', 'invited_by', 'role'],
    });
  });

  it('migrates a fresh database and enforces one company per account', async () => {
    const db = await createTestDb();
    const row = { ownerUserId: 'u1', createdAt: '2026-10-28T00:00:00Z' };
    await db.insert(schema.companies).values({ id: 'co_aaaaaaaaaa', ...row });
    await expect(db.insert(schema.companies).values({ id: 'co_bbbbbbbbbb', ...row })).rejects.toThrow();
  });

  it('keeps one MAP per partner type and one directory row per MAP file', async () => {
    const db = await createTestDb();
    const row = { companyId: 'co_a', ownerUserId: 'u1', partnerType: 'reseller', displayName: 'Acme as reseller', createdAt: 'x' };
    await db.insert(schema.maps).values({ ...row, id: 'map_1', fileId: 'f1', partnerId: 'p_1' });
    await expect(db.insert(schema.maps).values({ ...row, id: 'map_2', fileId: 'f2', partnerId: 'p_1' })).rejects.toThrow();
    await expect(db.insert(schema.maps).values({ ...row, id: 'map_3', fileId: 'f1', partnerId: 'p_2' })).rejects.toThrow();
  });

  it('lets only one partner book per company win', async () => {
    const db = await createTestDb();
    const row = { companyId: 'co_a', ownerUserId: 'u1', createdAt: 'x' };
    await db.insert(schema.partnerBooks).values({ ...row, fileId: 'f1' });
    await expect(db.insert(schema.partnerBooks).values({ ...row, fileId: 'f2' })).rejects.toThrow();
  });
});

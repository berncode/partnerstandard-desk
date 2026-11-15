import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { COMMAND_NAMES, UNRECORDED_COMMANDS } from '@partner-desk/commands';
import { describe, expect, it } from 'vitest';
import { createDb } from './client';
import {
  apiKeys, businessCases, events, mapLinks, maps, mapSessions, programs, proposals, rateLimits, reviewLinks, shareLinks, webhookDeliveries, webhookMarks, webhooks,
  workFiles, workspace, workspaceInvites, workspaceMembers,
} from './schema';

const MIGRATIONS = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** The migrations folder as it was before migration `tag`: the same files, the journal cut off before it. */
function folderBefore(tag: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'pd-migrations-'));
  cpSync(MIGRATIONS, dir, { recursive: true });
  const path = join(dir, 'meta', '_journal.json');
  const journal = JSON.parse(readFileSync(path, 'utf8')) as { entries: Array<{ tag: string }> };
  const at = journal.entries.findIndex((e) => e.tag === tag);
  expect(at).toBeGreaterThan(-1);
  writeFileSync(path, JSON.stringify({ ...journal, entries: journal.entries.slice(0, at) }));
  return dir;
}

describe('migrations', () => {
  it('0017 adds the maker’s person to proposals, empty for those made before, right after 0016, and keeps every proposal', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0017_proposal_maker_person') });
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf('0017_proposal_maker_person') - 1]).toBe('0016_workspace');
    await db.run(sql`INSERT INTO proposals (id, user_id, kind, status, created_at, expires_at, maker_kind, key_id, file_id)
      VALUES ('prp_1', 'u1', 'fourC', 'waiting', 'x', 'y', 'key', 'ak_1', 'f1')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: proposals.id, person: proposals.makerPersonId }).from(proposals)).toEqual([{ id: 'prp_1', person: null }]);
  });

  it('0016 adds the workspace, its members and its invites, empty, right after 0015, and keeps every company and file', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0016_workspace') });
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf('0016_workspace') - 1]).toBe('0015_work_files');
    await db.run(sql`INSERT INTO companies (id, owner_user_id, name, created_at) VALUES ('co_1', 'u1', 'Halden', 'x')`);
    await db.insert(workFiles).values({ id: 'wf_1', kind: 'partners', companyId: 'co_1', formatVersion: 5, body: '{}', createdAt: 'x', updatedAt: 'x' });

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.all(sql`SELECT id, owner_user_id FROM companies`)).toEqual([{ id: 'co_1', owner_user_id: 'u1' }]);
    expect(await db.select({ id: workFiles.id }).from(workFiles)).toEqual([{ id: 'wf_1' }]);
    // Hosted, the three tables exist and stay empty: only a company server writes them.
    expect(await db.select().from(workspace)).toEqual([]);
    expect(await db.select().from(workspaceMembers)).toEqual([]);
    expect(await db.select().from(workspaceInvites)).toEqual([]);
    const indexes = (await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'workspace%' AND name NOT LIKE 'sqlite_%'`,
    )).map((i) => i.name).sort();
    expect(indexes).toEqual(['workspace_id_unique', 'workspace_invites_email_unique', 'workspace_members_role_idx']);
  });

  it('0015 adds the work_files table, empty, with its index, right after 0014, and keeps every proposal and event', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0015_work_files') });
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf('0015_work_files') - 1]).toBe('0014_proposals');
    // Raw SQL: the schema has columns later migrations add (0017's maker_person_id).
    await db.run(sql`INSERT INTO proposals (id, user_id, kind, status, created_at, expires_at, maker_kind, key_id, file_id)
      VALUES ('prp_1', 'u1', 'fourC', 'waiting', 'x', 'y', 'key', 'ak_1', 'f1')`);
    await db.run(sql`INSERT INTO events (id, at, command, actor_kind, actor_user_id, file_id, entity_ids, change)
      VALUES ('ev_1', '2026-11-07T10:00:00.000Z', 'partners.change', 'owner', 'u1', 'f1', 'p_1', 'setStep')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: proposals.id }).from(proposals)).toEqual([{ id: 'prp_1' }]);
    expect(await db.select({ id: events.id }).from(events)).toEqual([{ id: 'ev_1' }]);
    // Hosted, the table exists and stays empty: only the self-hosted edition writes it (spec 2026-11-07 §14).
    expect(await db.select().from(workFiles)).toEqual([]);
    const indexes = (await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'work_files' AND name NOT LIKE 'sqlite_%'`,
    )).map((i) => i.name);
    expect(indexes).toEqual(['work_files_company_idx']);
    await db.insert(workFiles).values({ id: 'wf_1', kind: 'partners', companyId: 'co_1', formatVersion: 5, body: '{}', createdAt: 'x', updatedAt: 'x' });
    expect(await db.select({ revision: workFiles.revision, trashedAt: workFiles.trashedAt }).from(workFiles)).toEqual([{ revision: 0, trashedAt: null }]);
  });

  it('the migration applies after 0013: the proposal index with its indexes, events gain an empty proposal id, and every event stays', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0014_proposals') });
    const journal = JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8')) as { entries: Array<{ tag: string }> };
    // 0014 comes straight after 0013 (later migrations may follow it).
    const tags = journal.entries.map((e) => e.tag);
    expect(tags[tags.indexOf('0014_proposals') - 1]).toBe('0013_webhook_turned_on_at');
    await db.run(sql`INSERT INTO events (id, at, command, actor_kind, actor_user_id, file_id, entity_ids, change)
      VALUES ('ev_1', '2026-11-04T10:00:00.000Z', 'partners.change', 'owner', 'u1', 'f1', 'p_1', 'setStep')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: events.id, change: events.change, proposalId: events.proposalId }).from(events))
      .toEqual([{ id: 'ev_1', change: 'setStep', proposalId: null }]);
    await db.insert(proposals).values({
      id: 'prp_1', userId: 'u1', kind: 'fourC', accountId: 'a_1', partnerId: 'p_1', status: 'waiting', createdAt: 'x', expiresAt: 'y',
      makerKind: 'app', makerName: 'Claude', clientId: 'c_1', fileId: 'f1',
    });
    await expect(db.insert(proposals).values({
      id: 'prp_1', userId: 'u1', kind: 'stage', status: 'waiting', createdAt: 'x', expiresAt: 'y', makerKind: 'key', keyId: 'ak_1', fileId: 'f1',
    })).rejects.toThrow();
    const indexes = (await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'proposals' AND name NOT LIKE 'sqlite_%'`,
    )).map((i) => i.name).sort();
    expect(indexes).toEqual(['proposals_status_expires_idx', 'proposals_user_status_idx']);
  });

  it('0012 adds the day a MAP was started, empty for the MAPs made before, and keeps every MAP', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0012_map_started_on') });
    await db.run(sql`INSERT INTO maps (id, company_id, owner_user_id, file_id, partner_id, partner_type, display_name, created_at)
      VALUES ('map_1', 'co_1', 'u1', 'fm1', 'p_1', 'reseller', 'Acme as reseller', '2026-11-03T23:30:00.000Z')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    // No backfill: a MAP made before keeps the UTC date of its created time (question 20).
    expect(await db.select({ id: maps.id, createdAt: maps.createdAt, startedOn: maps.startedOn }).from(maps))
      .toEqual([{ id: 'map_1', createdAt: '2026-11-03T23:30:00.000Z', startedOn: null }]);
  });

  it('0011 adds the MAP health the webhooks last heard of, empty, and keeps every MAP and its digest health', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0011_webhook_health') });
    await db.run(sql`INSERT INTO maps (id, company_id, owner_user_id, file_id, partner_id, partner_type, display_name, created_at, digest_health)
      VALUES ('map_1', 'co_1', 'u1', 'fm1', 'p_1', 'reseller', 'Acme as reseller', '2026-10-31T00:00:00.000Z', 'at_risk')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: maps.id, digestHealth: maps.digestHealth, webhookHealth: maps.webhookHealth }).from(maps))
      .toEqual([{ id: 'map_1', digestHealth: 'at_risk', webhookHealth: null }]);
  });

  it('0010 adds the webhook tables with their keys and indexes, and keeps every API key', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0010_webhooks') });
    await db.run(sql`INSERT INTO api_keys (id, user_id, name, level, key_hash, prefix, created_at)
      VALUES ('ak_1', 'u1', 'n8n', 'read', 'h1', 'pd_abcde', '2026-11-01T00:00:00.000Z')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: apiKeys.id }).from(apiKeys)).toEqual([{ id: 'ak_1' }]);
    await db.insert(webhooks).values({ id: 'wh_1', userId: 'u1', url: 'https://x.example.com', events: '[]', secretEnc: 'e', status: 'active', createdAt: 'x' });
    const delivery = { id: 'evt_1', webhookId: 'wh_1', type: 'partner.signed', data: '{}', occurredAt: 'x', attempts: 0, nextTryAt: 1 };
    await db.insert(webhookDeliveries).values(delivery);
    // One row per event and webhook.
    await expect(db.insert(webhookDeliveries).values(delivery)).rejects.toThrow();
    await db.insert(webhookMarks).values({ userId: 'u1', key: 'k', at: 'x' });
    await expect(db.insert(webhookMarks).values({ userId: 'u1', key: 'k', at: 'y' })).rejects.toThrow();
    const indexes = (await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name LIKE 'webhook%' AND name NOT LIKE 'sqlite_%'`,
    )).map((i) => i.name).sort();
    expect(indexes).toEqual(['webhook_deliveries_next_try_idx', 'webhook_deliveries_webhook_id_idx', 'webhooks_user_id_idx']);
  });

  it('0008 adds the review summary links with their indexes, and keeps every MAP', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0008_review_links') });
    await db.run(sql`INSERT INTO maps (id, company_id, owner_user_id, file_id, partner_id, partner_type, display_name, created_at)
      VALUES ('map_1', 'co_1', 'u1', 'fm1', 'p_1', 'reseller', 'Acme as reseller', '2026-10-31T00:00:00.000Z')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: maps.id }).from(maps)).toEqual([{ id: 'map_1' }]);
    await db.insert(reviewLinks).values({ id: 'rl_1', ownerUserId: 'u1', mapId: 'map_1', reviewId: 'rv_1', tokenHash: 'h1', createdAt: 'x' });
    await expect(db.insert(reviewLinks).values({ id: 'rl_2', ownerUserId: 'u1', mapId: 'map_1', reviewId: 'rv_2', tokenHash: 'h1', createdAt: 'x' }))
      .rejects.toThrow();
    const indexes = (await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'review_links' AND name NOT LIKE 'sqlite_%'`,
    )).map((i) => i.name).sort();
    expect(indexes).toEqual(['review_links_owner_map_idx', 'review_links_token_hash_unique']);
  });

  it('0005 adds the MAP\'s last change, empty for the MAPs already listed', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0005_map_last_change') });
    await db.run(sql`INSERT INTO maps (id, company_id, owner_user_id, file_id, partner_id, partner_type, display_name, created_at)
      VALUES ('map_1', 'co_1', 'u1', 'fm1', 'p_1', 'reseller', 'Acme as reseller', '2026-10-31T00:00:00.000Z')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: maps.id, last: maps.lastChangeAt }).from(maps)).toEqual([{ id: 'map_1', last: null }]);
  });

  it('0004 adds the MAP directory, link, session and rate limit tables with their indexes, and keeps every row', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0004_maps') });
    await db.run(sql`INSERT INTO business_cases (id, company_id, owner_user_id, file_id, partner_id, partner_type, display_name, created_at)
      VALUES ('case_1', 'co_1', 'u1', 'f1', 'p_1', 'reseller', 'Case', '2026-10-31T00:00:00.000Z')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: businessCases.id }).from(businessCases)).toEqual([{ id: 'case_1' }]);
    await db.insert(maps).values({
      id: 'map_1', companyId: 'co_1', ownerUserId: 'u1', fileId: 'fm1', partnerId: 'p_1', partnerType: 'reseller', displayName: 'Acme as reseller', createdAt: 'x',
    });
    expect(await db.select({ notify: maps.notifySettings, momentum: maps.momentumState, paused: maps.pausedReason }).from(maps))
      .toEqual([{ notify: '{}', momentum: null, paused: null }]);
    await db.insert(mapLinks).values({
      id: 'ml_1', mapId: 'map_1', ownerUserId: 'u1', personId: 'pe_1', side: 'partner', emailHash: 'e1', tokenHash: 'h1', createdAt: 'x',
    });
    await db.insert(mapSessions).values({ id: 'ms_1', linkId: 'ml_1', mapId: 'map_1', tokenHash: 's1', expiresAt: 'x' });
    await db.insert(rateLimits).values({ key: 'k', windowStart: 1, count: 1 });
    const indexes = async (table: string) => (await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ${table} AND name NOT LIKE 'sqlite_%'`,
    )).map((i) => i.name).sort();
    expect(await indexes('maps')).toEqual(['maps_company_id_idx', 'maps_company_partner_unique', 'maps_file_id_unique', 'maps_owner_user_id_idx']);
    expect(await indexes('map_links')).toEqual(['map_links_map_id_idx', 'map_links_owner_user_id_idx', 'map_links_token_hash_unique']);
    expect(await indexes('map_sessions')).toEqual(['map_sessions_link_id_idx', 'map_sessions_map_id_idx', 'map_sessions_token_hash_unique']);
    expect(await indexes('rate_limits')).toEqual([]);
  });

  it('0003 adds the business case and share link tables with their indexes, and keeps every row', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0003_business_cases') });
    await db.run(sql`INSERT INTO programs (id, company_id, owner_user_id, file_id, display_name, partner_type, created_at)
      VALUES ('pg_1', 'co_1', 'u1', 'f1', 'Reseller', 'reseller', '2026-10-30T00:00:00.000Z')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select({ id: programs.id }).from(programs)).toEqual([{ id: 'pg_1' }]);
    await db.insert(businessCases).values({
      id: 'case_1', companyId: 'co_1', ownerUserId: 'u1', fileId: 'fc1', partnerId: 'p_1', partnerType: 'reseller', displayName: 'Case', createdAt: 'x',
    });
    await db.insert(shareLinks).values({ id: 'sl_1', ownerUserId: 'u1', caseId: 'case_1', tokenHash: 'h1', createdAt: 'x' });
    const indexes = async (table: string) => (await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ${table} AND name NOT LIKE 'sqlite_%'`,
    )).map((i) => i.name).sort();
    expect(await indexes('business_cases')).toEqual(['business_cases_company_id_idx', 'business_cases_file_id_unique', 'business_cases_partner_id_idx']);
    expect(await indexes('share_links')).toEqual(['share_links_owner_case_idx', 'share_links_token_hash_unique']);
  });

  it('0002 renames the programmes table to programs and keeps its rows', async () => {
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0002_rename_programs') });
    await db.run(sql`INSERT INTO programmes (id, company_id, owner_user_id, file_id, display_name, partner_type, created_at)
      VALUES ('pg_1', 'co_1', 'u1', 'f1', 'Reseller · DACH', 'reseller', '2026-10-30T00:00:00.000Z')`);

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect(await db.select().from(programs)).toEqual([{
      id: 'pg_1', companyId: 'co_1', ownerUserId: 'u1', fileId: 'f1', displayName: 'Reseller · DACH', partnerType: 'reseller',
      createdAt: '2026-10-30T00:00:00.000Z',
    }]);
    const indexes = await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'programs' AND name NOT LIKE 'sqlite_%'`);
    expect(indexes.map((i) => i.name).sort()).toEqual(['programs_company_id_idx', 'programs_file_id_unique']);
  });

  it('0018 deletes the events of the commands that record none, as they were on 2026-11-14, and keeps every other', async () => {
    // Frozen: the migration's list can't change once it has run. Each is still a command that records no event.
    const deleted = ['partners.read', 'markets.read', 'markets.list', 'companyFacts.read', 'programs.list', 'programs.read', 'cases.list',
      'cases.read', 'maps.list', 'maps.read', 'reviews.list', 'reviews.read', 'week.read', 'webhooks.list', 'webhooks.deliveries',
      'proposals.list', 'members.list', 'company.read', 'maps.notifyRead', 'files.export'];
    for (const command of deleted) expect(UNRECORDED_COMMANDS).toContain(command);
    const db = createDb(`file:${join(mkdtempSync(join(tmpdir(), 'pd-db-')), 'test.db')}`);
    await migrate(db, { migrationsFolder: folderBefore('0018_drop_read_events') });
    for (const [i, command] of COMMAND_NAMES.entries()) {
      await db.run(sql`INSERT INTO events (id, at, command, actor_kind, actor_user_id, file_id, entity_ids)
        VALUES (${`ev_${i}`}, 'x', ${command}, 'owner', 'u1', 'f1', '')`);
    }

    await migrate(db, { migrationsFolder: MIGRATIONS });

    expect((await db.select({ command: events.command }).from(events)).map((e) => e.command).sort())
      .toEqual(COMMAND_NAMES.filter((c) => !deleted.includes(c)).sort());
  });
});

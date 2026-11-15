import { describeProposalIndexContract } from '@partner-desk/commands/proposal-contract';
import { describe, expect, it } from 'vitest';
import { apiKeys, oauthClient, oauthConsent, proposals, user } from './schema';
import { createTestDb } from './test-db';
import { TursoAgentGrants } from './turso-agent-grants';
import { TursoApiKeys } from './turso-api-keys';
import { TursoProposals } from './turso-proposals';

describeProposalIndexContract('Turso', async () => {
  const db = await createTestDb();
  await db.insert(user).values([
    { id: 'u_anna', name: 'Anna Keller', email: 'anna@example.com' },
    { id: 'u_ben', name: 'Ben Ito', email: 'ben@example.com' },
  ]);
  const grants = new TursoAgentGrants(db);
  const keys = new TursoApiKeys(db);
  return {
    index: new TursoProposals(db),
    async allowApp(userId, clientId, appName) {
      await db.insert(oauthClient).values({ id: `row_${clientId}`, clientId, name: appName || null, redirectUris: '[]' }).onConflictDoNothing();
      await db.insert(oauthConsent).values({ id: `co_${userId}_${clientId}`, clientId, userId, scopes: '["pd.read","pd.change","pd.propose"]' });
    },
    async turnOffApp(userId, clientId) {
      await grants.revoke(userId, clientId);
    },
    async addKey(userId, keyId, name) {
      await db.insert(apiKeys).values({ id: keyId, userId, name, level: 'propose', keyHash: `hash_${keyId}`, prefix: 'pd_abcde', createdAt: 'x' });
    },
    async turnOffKey(userId, keyId) {
      await keys.revoke(userId, keyId);
    },
  };
});

describe('TursoProposals', () => {
  const row = {
    id: 'prp_aaaaaaaaaa', userId: 'u_anna', kind: 'fourC' as const, accountId: 'a_1', partnerId: 'p_1', marketId: null, hypothesisId: null,
    createdAt: '2026-11-04T10:00:00.000Z', expiresAt: '2026-12-04T10:00:00.000Z', fileId: 'file-book', madeBy: { kind: 'key' as const, keyId: 'ak_1' },
  };

  it('keeps ids, codes and times only: the app’s name, its client id, or the key id', async () => {
    const db = await createTestDb();
    const index = new TursoProposals(db);
    await index.add(row, null);
    await index.add({ ...row, id: 'prp_bbbbbbbbbb', madeBy: { kind: 'app', agentName: 'Claude', clientId: 'c_claude' } }, null);
    expect(await db.select().from(proposals).orderBy(proposals.id)).toEqual([
      {
        id: 'prp_aaaaaaaaaa', userId: 'u_anna', kind: 'fourC', accountId: 'a_1', partnerId: 'p_1', marketId: null, hypothesisId: null, status: 'waiting',
        createdAt: '2026-11-04T10:00:00.000Z', answeredAt: null, expiresAt: '2026-12-04T10:00:00.000Z', makerKind: 'key', makerName: null,
        clientId: null, keyId: 'ak_1', makerPersonId: null, fileId: 'file-book',
      },
      {
        id: 'prp_bbbbbbbbbb', userId: 'u_anna', kind: 'fourC', accountId: 'a_1', partnerId: 'p_1', marketId: null, hypothesisId: null, status: 'waiting',
        createdAt: '2026-11-04T10:00:00.000Z', answeredAt: null, expiresAt: '2026-12-04T10:00:00.000Z', makerKind: 'app', makerName: 'Claude',
        clientId: 'c_claude', keyId: null, makerPersonId: null, fileId: 'file-book',
      },
    ]);
  });

  it('a key that is gone reads with the fallback name, turned off', async () => {
    const db = await createTestDb();
    const index = new TursoProposals(db);
    await index.add(row, null);
    expect(await index.get('u_anna', row.id)).toMatchObject({ agentName: 'Agent', makerOn: false });
  });

  it('fails with the operation’s name only', async () => {
    const db = await createTestDb();
    const index = new TursoProposals(db);
    await index.add(row, null);
    await expect(index.add(row, null)).rejects.toThrow(/^proposals_add_failed$/);
  });
});

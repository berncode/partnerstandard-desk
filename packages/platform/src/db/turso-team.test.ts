import { describe, expect, it } from 'vitest';
import { apiKeys, session, user, webhooks } from './schema';
import { createTestDb } from './test-db';
import { TursoApiKeys } from './turso-api-keys';
import { TursoTeam } from './turso-team';
import { TursoWebhooks } from './turso-webhooks';

const OPTIONS = { key: 'test-secret-at-least-32-characters-long', allowPrivate: false, lookup: async () => ['93.184.215.14'] };

async function setup() {
  const db = await createTestDb();
  await db.insert(user).values([
    { id: 'u_anna', name: 'Anna', email: 'anna@halden.example' }, { id: 'u_ben', name: '', email: 'ben@halden.example' },
  ]);
  const team = new TursoTeam(db, OPTIONS);
  await team.workspace.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
  await team.workspace.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
  return { db, team };
}

describe('TursoTeam (plan 15, task 6)', () => {
  it('names people by their account, their address when they gave no name, and leaves out one whose account is gone', async () => {
    const { team } = await setup();
    expect(await team.contacts(['u_anna', 'u_ben', 'u_gone'])).toEqual(new Map([
      ['u_anna', { name: 'Anna', email: 'anna@halden.example' }], ['u_ben', { name: 'ben@halden.example', email: 'ben@halden.example' }],
    ]));
    expect(await team.contacts([])).toEqual(new Map());
  });

  it('knows a member’s address, in any letters, and not a stranger’s', async () => {
    const { db, team } = await setup();
    await db.insert(user).values({ id: 'u_sam', name: 'Sam', email: 'sam@halden.example' });
    expect(await team.memberWithEmail(' Ben@Halden.example ')).toBe(true);
    expect(await team.memberWithEmail('sam@halden.example')).toBe(false);
  });

  it('ending a member’s access signs them out and ends their keys and webhooks, never another member’s', async () => {
    const { db, team } = await setup();
    const now = new Date();
    await db.insert(session).values([
      { id: 's_ben', token: 't_ben', userId: 'u_ben', expiresAt: new Date(now.getTime() + 60_000), createdAt: now, updatedAt: now },
      { id: 's_anna', token: 't_anna', userId: 'u_anna', expiresAt: new Date(now.getTime() + 60_000), createdAt: now, updatedAt: now },
    ]);
    const keys = new TursoApiKeys(db);
    await keys.create({ userId: 'u_ben', name: 'n8n', level: 'read' });
    await keys.create({ userId: 'u_anna', name: 'n8n', level: 'read' });
    const hooks = new TursoWebhooks(db, OPTIONS);
    await hooks.create({ userId: 'u_ben', url: 'https://hooks.example.com/in', events: ['partner.signed'] });
    await hooks.create({ userId: 'u_anna', url: 'https://hooks.example.com/in', events: ['partner.signed'] });
    await team.endAccess('u_ben');
    expect((await db.select({ userId: session.userId }).from(session)).map((r) => r.userId)).toEqual(['u_anna']);
    expect((await db.select({ userId: apiKeys.userId }).from(apiKeys)).map((r) => r.userId)).toEqual(['u_anna']);
    expect((await db.select({ userId: webhooks.userId }).from(webhooks)).map((r) => r.userId)).toEqual(['u_anna']);
    // The person's account stays: their name stays on what they changed.
    expect((await db.select({ id: user.id }).from(user)).map((r) => r.id).sort()).toEqual(['u_anna', 'u_ben']);
  });
});

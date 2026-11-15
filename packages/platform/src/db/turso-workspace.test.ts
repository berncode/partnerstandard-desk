import { describeWorkspaceContract } from '@partner-desk/commands/workspace-contract';
import { sql } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { workspace, workspaceInvites } from './schema';
import { createTestDb } from './test-db';
import { TursoWorkspace } from './turso-workspace';

describeWorkspaceContract('Turso', async (clock) => new TursoWorkspace(await createTestDb(), () => clock.now));

describe('TursoWorkspace', () => {
  it('keeps one workspace row, whatever is written', async () => {
    const db = await createTestDb();
    const key = await new TursoWorkspace(db).key();
    await expect(db.insert(workspace).values({ slot: 2, id: 'ws_other', createdAt: 'x' })).rejects.toThrow();
    expect(await db.select().from(workspace)).toEqual([{ slot: 1, id: key, createdAt: expect.any(String) }]);
    expect(await new TursoWorkspace(db).key()).toBe(key);
  });

  it('refuses a role that isn’t one, in the database itself', async () => {
    const db = await createTestDb();
    await expect(db.run(sql`INSERT INTO workspace_members (person_id, role, added_at) VALUES ('u_anna', 'owner', 'x')`)).rejects.toThrow();
    await expect(db.run(sql`INSERT INTO workspace_invites (id, email, role, invited_by, created_at, expires_at)
      VALUES ('inv_1', 'ben@example.com', 'Admin', 'u_anna', 'x', 'y')`)).rejects.toThrow();
    await db.run(sql`INSERT INTO workspace_members (person_id, role, added_at) VALUES ('u_anna', 'partnerManager', 'x')`);
  });

  it('the clean-up takes the addresses out of the database', async () => {
    const db = await createTestDb();
    const clock = { now: new Date('2026-11-08T10:00:00.000Z') };
    const ws = new TursoWorkspace(db, () => clock.now);
    await ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' });
    clock.now = new Date('2026-11-15T10:00:00.000Z');
    await ws.pruneExpiredInvites();
    expect(await db.select().from(workspaceInvites)).toEqual([]);
  });

  it('names only the operation when the database fails, never an id or an address', async () => {
    const db = await createTestDb();
    await db.run(sql`DROP TABLE workspace_invites`);
    const ws = new TursoWorkspace(db);
    await expect(ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' })).rejects.toThrow(/^workspace_invite_failed$/);
    await expect(ws.inviteFor('ben@example.com')).rejects.toThrow(/^workspace_read_failed$/);
  });
});

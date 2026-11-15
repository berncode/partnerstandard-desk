import { createMemoryWorkspace } from '@partner-desk/commands/testing';
import { describe, expect, it } from 'vitest';
import { workspaceAccess } from './workspace-access';

const SELF = { edition: 'self-hosted' as const, adminEmail: 'Admin@Halden.example', testMode: false };
const anna = { id: 'u_anna', email: 'admin@halden.example' };
const ben = { id: 'u_ben', email: 'ben@halden.example' };

describe('workspaceAccess', () => {
  it('hosted: every person owns a workspace of one, keyed by their own id, and no workspace is made', async () => {
    const ws = createMemoryWorkspace();
    expect(await workspaceAccess(ws, anna, { edition: 'hosted', adminEmail: null, testMode: false })).toEqual({ kind: 'own', userId: 'u_anna' });
    expect(await ws.members()).toEqual([]);
  });

  it('a company server’s test users keep their own, in test mode only', async () => {
    const ws = createMemoryWorkspace();
    const tester = { id: 'u_t', email: 'test-abc@example.test' };
    expect(await workspaceAccess(ws, tester, { ...SELF, testMode: true })).toEqual({ kind: 'own', userId: 'u_t' });
    expect(await workspaceAccess(ws, tester, SELF)).toEqual({ kind: 'none' });
  });

  it('makes ADMIN_EMAIL the first admin at its first sign-in, in the workspace, whatever the address’s letters', async () => {
    const ws = createMemoryWorkspace();
    const access = await workspaceAccess(ws, anna, SELF);
    const key = await ws.key();
    expect(key).toMatch(/^ws_/);
    expect(access).toEqual({ kind: 'member', userId: key, member: { personId: 'u_anna', role: 'admin' } });
    expect(await ws.members()).toEqual([{ personId: 'u_anna', role: 'admin', addedBy: null, addedAt: expect.any(String) }]);
    expect(await workspaceAccess(ws, anna, SELF)).toEqual(access);
  });

  it('gives every member the same workspace, with their own id and role', async () => {
    const ws = createMemoryWorkspace();
    await workspaceAccess(ws, anna, SELF);
    await ws.addMember({ personId: 'u_ben', role: 'viewer', addedBy: 'u_anna' });
    const key = await ws.key();
    expect(await workspaceAccess(ws, ben, SELF)).toEqual({ kind: 'member', userId: key, member: { personId: 'u_ben', role: 'viewer' } });
  });

  it('a person who is no member reaches nothing, and is never made one', async () => {
    const ws = createMemoryWorkspace();
    expect(await workspaceAccess(ws, ben, SELF)).toEqual({ kind: 'none' });
    expect(await workspaceAccess(ws, ben, { ...SELF, adminEmail: null })).toEqual({ kind: 'none' });
    expect(await ws.members()).toEqual([]);
  });

  it('once there is an admin, ADMIN_EMAIL is a person like any other: removed, it stays out', async () => {
    const ws = createMemoryWorkspace();
    await workspaceAccess(ws, anna, SELF);
    await ws.addMember({ personId: 'u_ben', role: 'admin', addedBy: 'u_anna' });
    expect(await ws.removeMember('u_anna')).toBeNull();
    expect(await workspaceAccess(ws, anna, SELF)).toEqual({ kind: 'none' });
    // Another account with the same address (deleted and made again) is no member either.
    expect(await workspaceAccess(ws, { id: 'u_anna_2', email: anna.email }, SELF)).toEqual({ kind: 'none' });
    expect((await ws.members()).map((m) => m.personId)).toEqual(['u_ben']);
  });

  it('makes an invited address a member at its first sign-in, with the invite’s role, once', async () => {
    const ws = createMemoryWorkspace();
    await workspaceAccess(ws, anna, SELF);
    await ws.invite({ email: 'Ben@Halden.example', role: 'partnerManager', invitedBy: 'u_anna' });
    const key = await ws.key();
    expect(await workspaceAccess(ws, ben, SELF)).toEqual({ kind: 'member', userId: key, member: { personId: 'u_ben', role: 'partnerManager' } });
    expect(await ws.openInvites()).toEqual([]);
    expect(await ws.member('u_ben')).toMatchObject({ addedBy: 'u_anna' });
  });
});

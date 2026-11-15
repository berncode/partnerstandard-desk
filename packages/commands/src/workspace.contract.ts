// The workspace's contract (plan 15, task 1): every Workspace (our database, and the one in memory) must pass this suite.
import { describe, expect, it } from 'vitest';
import type { Workspace } from './workspace';

/** A test's clock: the store reads `now` on every call, and the test moves it. */
export interface WorkspaceClock {
  now: Date;
}

const T0 = '2026-11-08T10:00:00.000Z';
const DAY_MS = 24 * 60 * 60_000;
const at = (base: string, ms: number): Date => new Date(Date.parse(base) + ms);

export function describeWorkspaceContract(name: string, make: (clock: WorkspaceClock) => Promise<Workspace>) {
  describe(`Workspace contract: ${name}`, () => {
    const setUp = async () => {
      const clock: WorkspaceClock = { now: new Date(T0) };
      return { clock, ws: await make(clock) };
    };

    it('makes its key once, also when asked twice at once, and the key is no person’s', async () => {
      const { ws } = await setUp();
      const [a, b, c] = await Promise.all([ws.key(), ws.key(), ws.key()]);
      expect(a).toMatch(/^ws_[0-9a-z]{10}$/);
      expect([b, c]).toEqual([a, a]);
      expect(await ws.key()).toBe(a);
    });

    it('adds members, the earliest first, and one added again keeps their role', async () => {
      const { clock, ws } = await setUp();
      expect(await ws.members()).toEqual([]);
      expect(await ws.member('u_anna')).toBeNull();
      const anna = await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
      expect(anna).toEqual({ personId: 'u_anna', role: 'admin', addedBy: null, addedAt: T0 });
      clock.now = at(T0, 60_000);
      await ws.addMember({ personId: 'u_ben', role: 'viewer', addedBy: 'u_anna' });
      expect(await ws.addMember({ personId: 'u_anna', role: 'viewer', addedBy: 'u_ben' })).toEqual(anna);
      expect(await ws.member('u_anna')).toEqual(anna);
      expect(await ws.members()).toEqual([
        anna, { personId: 'u_ben', role: 'viewer', addedBy: 'u_anna', addedAt: at(T0, 60_000).toISOString() },
      ]);
    });

    it('changes a role, and never makes the last admin anything else', async () => {
      const { ws } = await setUp();
      await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
      await ws.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
      expect(await ws.setRole('u_ben', 'viewer')).toBeNull();
      expect((await ws.member('u_ben'))?.role).toBe('viewer');
      expect(await ws.setRole('u_anna', 'partnerManager')).toBe('lastAdmin');
      expect(await ws.setRole('u_anna', 'viewer')).toBe('lastAdmin');
      expect(await ws.setRole('u_anna', 'admin')).toBeNull();
      expect((await ws.member('u_anna'))?.role).toBe('admin');
      expect(await ws.setRole('u_nobody', 'admin')).toBe('notMember');
      expect(await ws.member('u_nobody')).toBeNull();
      // With a second admin, one of them may step down; then the other is the last.
      expect(await ws.setRole('u_ben', 'admin')).toBeNull();
      expect(await ws.setRole('u_anna', 'viewer')).toBeNull();
      expect(await ws.setRole('u_ben', 'viewer')).toBe('lastAdmin');
      expect((await ws.members()).map((m) => [m.personId, m.role])).toEqual([['u_anna', 'viewer'], ['u_ben', 'admin']]);
    });

    it('removes a member, and never the last admin', async () => {
      const { ws } = await setUp();
      await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
      await ws.addMember({ personId: 'u_ben', role: 'viewer', addedBy: 'u_anna' });
      expect(await ws.removeMember('u_anna')).toBe('lastAdmin');
      expect(await ws.removeMember('u_ben')).toBeNull();
      expect(await ws.removeMember('u_ben')).toBe('notMember');
      expect((await ws.members()).map((m) => m.personId)).toEqual(['u_anna']);
      await ws.addMember({ personId: 'u_cleo', role: 'admin', addedBy: 'u_anna' });
      expect(await ws.removeMember('u_anna')).toBeNull();
      expect(await ws.removeMember('u_cleo')).toBe('lastAdmin');
    });

    it('keeps one admin when two admins step down at once', async () => {
      const { ws } = await setUp();
      await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
      await ws.addMember({ personId: 'u_ben', role: 'admin', addedBy: 'u_anna' });
      const answers = await Promise.all([ws.setRole('u_anna', 'viewer'), ws.removeMember('u_ben')]);
      expect(answers.filter((a) => a === 'lastAdmin')).toHaveLength(1);
      expect((await ws.members()).filter((m) => m.role === 'admin')).toHaveLength(1);
    });

    it('invites an address for 7 days, in one form, and a second invite replaces the first', async () => {
      const { clock, ws } = await setUp();
      const first = await ws.invite({ email: '  Ben@Example.COM ', role: 'viewer', invitedBy: 'u_anna' });
      expect(first).toEqual({
        id: expect.stringMatching(/^inv_[0-9a-z]{16}$/), email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna', createdAt: T0,
        expiresAt: at(T0, 7 * DAY_MS).toISOString(),
      });
      expect(await ws.inviteFor('BEN@example.com')).toEqual(first);
      clock.now = at(T0, DAY_MS);
      const second = await ws.invite({ email: 'ben@example.com', role: 'partnerManager', invitedBy: 'u_cleo' });
      expect(second.id).not.toBe(first.id);
      expect(second.expiresAt).toBe(at(T0, 8 * DAY_MS).toISOString());
      expect(await ws.openInvites()).toEqual([second]);
      expect(await ws.cancelInvite(first.id)).toBe(false);
    });

    it('lists the open invites, the newest first, and lets them run out after 7 days', async () => {
      const { clock, ws } = await setUp();
      const ben = await ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' });
      clock.now = at(T0, DAY_MS);
      const cleo = await ws.invite({ email: 'cleo@example.com', role: 'partnerManager', invitedBy: 'u_anna' });
      expect(await ws.openInvites()).toEqual([cleo, ben]);
      clock.now = at(T0, 7 * DAY_MS - 1);
      expect(await ws.inviteFor('ben@example.com')).toEqual(ben);
      clock.now = at(T0, 7 * DAY_MS);
      expect(await ws.inviteFor('ben@example.com')).toBeNull();
      expect(await ws.openInvites()).toEqual([cleo]);
      expect(await ws.acceptInvite('ben@example.com', 'u_ben')).toBeNull();
      expect(await ws.member('u_ben')).toBeNull();
    });

    it('cancels an invite', async () => {
      const { ws } = await setUp();
      const ben = await ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' });
      expect(await ws.cancelInvite(ben.id)).toBe(true);
      expect(await ws.cancelInvite(ben.id)).toBe(false);
      expect(await ws.inviteFor('ben@example.com')).toBeNull();
      expect(await ws.acceptInvite('ben@example.com', 'u_ben')).toBeNull();
    });

    it('makes the member at the first sign-in, with the invite’s role, and ends the invite', async () => {
      const { clock, ws } = await setUp();
      await ws.invite({ email: 'ben@example.com', role: 'partnerManager', invitedBy: 'u_anna' });
      clock.now = at(T0, DAY_MS);
      expect(await ws.acceptInvite('Ben@Example.com', 'u_ben')).toEqual({
        personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna', addedAt: at(T0, DAY_MS).toISOString(),
      });
      expect(await ws.inviteFor('ben@example.com')).toBeNull();
      expect(await ws.openInvites()).toEqual([]);
      expect(await ws.acceptInvite('ben@example.com', 'u_ben')).toBeNull();
      expect(await ws.members()).toHaveLength(1);
    });

    it('keeps a member’s role when their address is invited again, and ends the invite', async () => {
      const { ws } = await setUp();
      await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
      await ws.invite({ email: 'anna@example.com', role: 'viewer', invitedBy: 'u_ben' });
      expect((await ws.acceptInvite('anna@example.com', 'u_anna'))?.role).toBe('admin');
      expect(await ws.openInvites()).toEqual([]);
    });

    it('lists invites made at the same time in the order they were made, and a second invite keeps its place', async () => {
      const { ws } = await setUp();
      const ben = await ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' });
      const cleo = await ws.invite({ email: 'cleo@example.com', role: 'viewer', invitedBy: 'u_anna' });
      expect((await ws.openInvites()).map((i) => i.id)).toEqual([cleo.id, ben.id]);
      const benAgain = await ws.invite({ email: 'ben@example.com', role: 'admin', invitedBy: 'u_anna' });
      expect((await ws.openInvites()).map((i) => i.id)).toEqual([cleo.id, benAgain.id]);
    });

    it('invites an address again after its invite ran out, before the clean-up', async () => {
      const { clock, ws } = await setUp();
      await ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' });
      clock.now = at(T0, 10 * DAY_MS);
      const again = await ws.invite({ email: 'ben@example.com', role: 'partnerManager', invitedBy: 'u_anna' });
      expect(await ws.openInvites()).toEqual([again]);
      expect((await ws.acceptInvite('ben@example.com', 'u_ben'))?.role).toBe('partnerManager');
    });

    it('keeps one invite when one address is invited twice at once, and it is one of the two', async () => {
      const { ws } = await setUp();
      const [a, b] = await Promise.all([
        ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' }),
        ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_cleo' }),
      ]);
      const [stayed] = await ws.openInvites();
      expect([a.id, b.id]).toContain(stayed!.id);
      expect(await ws.openInvites()).toHaveLength(1);
      expect(await ws.cancelInvite(stayed!.id)).toBe(true);
    });

    it('lists a member removed and added again last, with their new role', async () => {
      const { clock, ws } = await setUp();
      await ws.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
      await ws.addMember({ personId: 'u_ben', role: 'viewer', addedBy: 'u_anna' });
      await ws.addMember({ personId: 'u_cleo', role: 'viewer', addedBy: 'u_anna' });
      expect(await ws.removeMember('u_ben')).toBeNull();
      clock.now = at(T0, DAY_MS);
      await ws.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
      expect((await ws.members()).map((m) => [m.personId, m.role])).toEqual([['u_anna', 'admin'], ['u_cleo', 'viewer'], ['u_ben', 'partnerManager']]);
    });

    it('the clean-up removes the invites that ran out, and keeps the open ones', async () => {
      const { clock, ws } = await setUp();
      await ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' });
      clock.now = at(T0, 4 * DAY_MS);
      const cleo = await ws.invite({ email: 'cleo@example.com', role: 'viewer', invitedBy: 'u_anna' });
      clock.now = at(T0, 7 * DAY_MS);
      expect(await ws.pruneExpiredInvites()).toBe(1);
      expect(await ws.pruneExpiredInvites()).toBe(0);
      expect(await ws.openInvites()).toEqual([cleo]);
      clock.now = at(T0, 11 * DAY_MS);
      expect(await ws.pruneExpiredInvites()).toBe(1);
    });

    it('makes one member when the first sign-in comes twice at once', async () => {
      const { ws } = await setUp();
      await ws.invite({ email: 'ben@example.com', role: 'viewer', invitedBy: 'u_anna' });
      const made = await Promise.all([ws.acceptInvite('ben@example.com', 'u_ben'), ws.acceptInvite('ben@example.com', 'u_ben')]);
      expect(made.filter((m) => m !== null).length).toBeGreaterThanOrEqual(1);
      expect(await ws.members()).toEqual([{ personId: 'u_ben', role: 'viewer', addedBy: 'u_anna', addedAt: T0 }]);
      expect(await ws.openInvites()).toEqual([]);
    });
  });
}

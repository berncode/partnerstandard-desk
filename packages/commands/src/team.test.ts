import { COPY } from '@partner-desk/copy';
import { describe, expect, it } from 'vitest';
import type { Actor } from './actor';
import { FORBIDDEN } from './result';
import { cancelInvite, createInvite, listInvites, listMembers, removeMember, setMemberRole, type Team } from './team';
import { createMemoryWorkspace, makeTestDeps } from './testing';

const WS = 'ws_aaaaaaaaaa';
const as = (personId: string, role: 'admin' | 'partnerManager' | 'viewer'): Actor => ({
  kind: 'owner', userId: WS, displayName: personId, member: { personId, role },
});
const anna = as('u_anna', 'admin');

async function setup() {
  const workspace = createMemoryWorkspace();
  await workspace.addMember({ personId: 'u_anna', role: 'admin', addedBy: null });
  await workspace.addMember({ personId: 'u_ben', role: 'partnerManager', addedBy: 'u_anna' });
  await workspace.addMember({ personId: 'u_vera', role: 'viewer', addedBy: 'u_anna' });
  const people = new Map([
    ['u_anna', { name: 'Anna', email: 'anna@halden.example' }], ['u_ben', { name: 'Ben', email: 'ben@halden.example' }],
    ['u_vera', { name: 'Vera', email: 'vera@halden.example' }],
  ]);
  const ended: string[] = [];
  const team: Team = {
    workspace,
    contacts: async (ids) => new Map(ids.flatMap((id) => (people.has(id) ? [[id, people.get(id)!] as const] : []))),
    memberWithEmail: async (email) => [...people.values()].some((p) => p.email === email),
    endAccess: async (personId) => { ended.push(personId); },
  };
  const deps = { ...makeTestDeps(), team };
  return { deps, workspace, ended };
}

describe('members (plan 15, task 6)', () => {
  it('every member reads the list, with names, roles and which one is them', async () => {
    const { deps } = await setup();
    const listed = await listMembers(deps, as('u_vera', 'viewer'), {});
    expect(listed).toEqual({ ok: true, value: [
      { personId: 'u_anna', name: 'Anna', email: 'anna@halden.example', role: 'admin', you: false },
      { personId: 'u_ben', name: 'Ben', email: 'ben@halden.example', role: 'partnerManager', you: false },
      { personId: 'u_vera', name: 'Vera', email: 'vera@halden.example', role: 'viewer', you: true },
    ] });
  });

  it('only an admin changes a role or removes someone, and the last admin stays', async () => {
    const { deps, workspace, ended } = await setup();
    expect(await setMemberRole(deps, as('u_ben', 'partnerManager'), { personId: 'u_vera', role: 'admin' })).toEqual(FORBIDDEN);
    expect(await removeMember(deps, as('u_vera', 'viewer'), { personId: 'u_ben' })).toEqual(FORBIDDEN);
    expect(await setMemberRole(deps, anna, { personId: 'u_anna', role: 'viewer' })).toMatchObject({ ok: false, message: COPY.MEMBERS_LAST_ADMIN });
    expect(await removeMember(deps, anna, { personId: 'u_anna' })).toMatchObject({ ok: false, message: COPY.MEMBERS_LAST_ADMIN });
    expect((await setMemberRole(deps, anna, { personId: 'u_vera', role: 'partnerManager' })).ok).toBe(true);
    expect((await workspace.member('u_vera'))?.role).toBe('partnerManager');
    expect(await setMemberRole(deps, anna, { personId: 'u_vera', role: 'owner' })).toMatchObject({ ok: false, error: 'invalid' });
    expect(ended).toEqual([]);
  });

  it('removing a member ends their access and records ids only', async () => {
    const { deps, workspace, ended } = await setup();
    expect((await removeMember(deps, anna, { personId: 'u_ben' })).ok).toBe(true);
    expect(ended).toEqual(['u_ben']);
    expect(await workspace.member('u_ben')).toBeNull();
    expect(await removeMember(deps, anna, { personId: 'u_ben' })).toMatchObject({ ok: false, error: 'not_found' });
    // Asking again finishes a removal that failed half way: their access is ended again.
    expect(ended).toEqual(['u_ben', 'u_ben']);
    expect(deps.events.events.at(-1)).toMatchObject({ command: 'members.remove', actorUserId: 'u_anna', entityIds: ['u_ben'] });
  });

  it('a hosted owner and a test user have no members to manage', async () => {
    const deps = makeTestDeps();
    expect(await listMembers(deps, { kind: 'owner', userId: 'u1', displayName: 'Ruth' }, {})).toEqual(FORBIDDEN);
  });
});

describe('invites (plan 15, task 6)', () => {
  it('an admin invites an address in one form, lists and cancels it; the event holds no address', async () => {
    const { deps, workspace } = await setup();
    const made = await createInvite(deps, anna, { email: ' Cleo@Halden.example ', role: 'partnerManager' });
    if (!made.ok) throw new Error(made.message);
    expect(made.value).toMatchObject({ email: 'cleo@halden.example', role: 'partnerManager', invitedBy: 'u_anna' });
    expect((await listInvites(deps, anna, {}))).toEqual({ ok: true, value: [made.value] });
    expect(JSON.stringify(deps.events.events)).not.toContain('cleo');
    expect((await cancelInvite(deps, anna, { inviteId: made.value.id })).ok).toBe(true);
    expect(await workspace.openInvites()).toEqual([]);
    expect(await cancelInvite(deps, anna, { inviteId: made.value.id })).toMatchObject({ ok: false, message: COPY.INVITE_GONE });
  });

  it('refuses a member’s address, a bad address, and anyone but an admin', async () => {
    const { deps } = await setup();
    expect(await createInvite(deps, anna, { email: 'ben@halden.example', role: 'viewer' })).toMatchObject({ ok: false, message: COPY.INVITE_ALREADY_MEMBER });
    expect(await createInvite(deps, anna, { email: 'not an address', role: 'viewer' })).toMatchObject({ ok: false, message: COPY.INVITE_EMAIL_BAD });
    expect(await createInvite(deps, as('u_ben', 'partnerManager'), { email: 'cleo@halden.example', role: 'viewer' })).toEqual(FORBIDDEN);
    expect(await listInvites(deps, as('u_ben', 'partnerManager'), {})).toEqual(FORBIDDEN);
    const agent: Actor = { kind: 'agent', userId: WS, displayName: 'Anna', agentName: 'Claude', level: 'propose', via: { kind: 'key', keyId: 'k' }, member: { personId: 'u_anna', role: 'admin' } };
    expect(await createInvite(deps, agent, { email: 'cleo@halden.example', role: 'viewer' })).toEqual(FORBIDDEN);
  });
});

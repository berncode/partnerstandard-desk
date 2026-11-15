'use server';

// Settings' Members (plan 15, task 6): the member and invite commands, for a company server's signed-in member. An invite
// goes out as the address's first sign-in link (`requestSignInLink`), which the sign-in plugin sends as the invite email.
import {
  cancelInvite, createInvite, listInvites, listMembers, removeMember, setMemberRole, type MemberView, type WorkspaceInvite,
} from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { requestSignInLink } from '@partner-desk/platform';
import { headers } from 'next/headers';
import { actorFor, currentOwner, depsFor, getAuth, mailConfigured } from '@/server/runtime';
import { SIGNED_OUT } from '../actions/context';

type Failure = { ok: false; message: string; fieldErrors?: Record<string, string> };

async function asMember<R>(work: (deps: ReturnType<typeof depsFor>, actor: ReturnType<typeof actorFor>) => Promise<R>): Promise<R | Failure> {
  const session = await currentOwner();
  if (!session) return SIGNED_OUT;
  try {
    return await work(depsFor(session), actorFor(session));
  } catch {
    return { ok: false, message: COPY.SETTINGS_WRONG };
  }
}

const failed = (r: { message: string; fieldErrors?: Record<string, string> }): Failure =>
  ({ ok: false, message: r.message, ...(r.fieldErrors ? { fieldErrors: r.fieldErrors } : {}) });

/** Changes a member's role; answers the members as they are now. */
export async function changeMemberRole(personId: unknown, role: unknown): Promise<{ ok: true; members: MemberView[] } | Failure> {
  return asMember(async (deps, actor) => {
    const out = await setMemberRole(deps, actor, { personId, role });
    if (!out.ok) return failed(out);
    const members = await listMembers(deps, actor, {});
    return members.ok ? { ok: true as const, members: members.value } : failed(members);
  });
}

/** Removes a member, which ends their sessions, agents, keys and webhooks; answers the members as they are now. */
export async function removeTeamMember(personId: unknown): Promise<{ ok: true; members: MemberView[] } | Failure> {
  return asMember(async (deps, actor) => {
    const out = await removeMember(deps, actor, { personId });
    if (!out.ok) return failed(out);
    const members = await listMembers(deps, actor, {});
    return members.ok ? { ok: true as const, members: members.value } : failed(members);
  });
}

/**
 * Invites an address with a role and emails the invite, when this server has mail settings. Answers the open invites
 * and a line to show: sent, not sent, or no mail settings (the invite stands: the address can ask on the sign-in page).
 */
export async function inviteMember(email: unknown, role: unknown): Promise<{ ok: true; invites: WorkspaceInvite[]; message: string } | Failure> {
  return asMember(async (deps, actor) => {
    const out = await createInvite(deps, actor, { email, role });
    if (!out.ok) return failed(out);
    const address = out.value.email;
    let message: string = COPY.INVITE_NO_MAIL;
    if (mailConfigured()) {
      message = (await requestSignInLink(getAuth(), address, await headers())) ? COPY.INVITE_SENT(address) : COPY.INVITE_NOT_SENT(address);
    }
    const invites = await listInvites(deps, actor, {});
    return invites.ok ? { ok: true as const, invites: invites.value, message } : failed(invites);
  });
}

/** Cancels an invite; answers the open invites. */
export async function cancelInvitation(inviteId: unknown): Promise<{ ok: true; invites: WorkspaceInvite[] } | Failure> {
  return asMember(async (deps, actor) => {
    const out = await cancelInvite(deps, actor, { inviteId });
    if (!out.ok) return failed(out);
    const invites = await listInvites(deps, actor, {});
    return invites.ok ? { ok: true as const, invites: invites.value } : failed(invites);
  });
}

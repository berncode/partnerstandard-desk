// A company server's members and invites (plan 15, task 6; spec 2026-11-07 §7.1). Admins manage them; every member reads
// the list. Events hold ids and the role only: never an address.
import { normalizeAddress, WORKSPACE_ROLES, type WorkspaceRole } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { can, type CommandName } from './access';
import { personOf, type Actor } from './actor';
import type { Deps } from './deps';
import { FORBIDDEN, invalid, ok, record, type CommandResult, type Failure } from './result';
import { refused } from './shared';
import type { Workspace, WorkspaceInvite } from './workspace';

/** What the member commands need beyond the workspace itself: who people are, and ending a member's access. */
export interface Team {
  workspace: Workspace;
  /** The name (else address) and address of each person with an account; a person whose account is gone is left out. */
  contacts(personIds: readonly string[]): Promise<Map<string, { name: string; email: string }>>;
  /** Whether a member has an account with this address. */
  memberWithEmail(email: string): Promise<boolean>;
  /** A removed member's sessions, agents, API keys and webhooks end. What they changed keeps their name. */
  endAccess(personId: string): Promise<void>;
}

/** One member as Settings lists them. */
export interface MemberView {
  personId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
  /** The signed-in person themselves. */
  you: boolean;
}

const GONE: Failure = { ok: false, error: 'not_found', message: COPY.MEMBER_GONE };

/** The team, when this is a company server and the actor may run the command; else the refusal. */
function teamFor(deps: Deps, actor: Actor, command: CommandName): Team | Failure {
  if (!deps.team || !can(actor, command, { ownerUserId: actor.userId })) return FORBIDDEN;
  return deps.team;
}
const refusal = (t: Team | Failure): t is Failure => 'ok' in t;

const nothing = z.object({}).strict();
const roleInput = z.object({ personId: z.string().min(1).max(64), role: z.enum(WORKSPACE_ROLES) }).strict();
const personInput = z.object({ personId: z.string().min(1).max(64) }).strict();
const inviteInput = z.object({ email: z.email().max(254), role: z.enum(WORKSPACE_ROLES) }).strict();
const inviteIdInput = z.object({ inviteId: z.string().min(1).max(64) }).strict();

/** The members, the earliest added first, with their name, address and role. Every member reads it. */
export async function listMembers(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MemberView[]>> {
  if (!nothing.safeParse(input).success) return invalid();
  const team = teamFor(deps, actor, 'members.list');
  if (refusal(team)) return team;
  const members = await team.workspace.members();
  const contacts = await team.contacts(members.map((m) => m.personId));
  const me = personOf(actor);
  return ok(members.flatMap((m) => {
    const contact = contacts.get(m.personId);
    return contact ? [{ personId: m.personId, name: contact.name, email: contact.email, role: m.role, you: m.personId === me }] : [];
  }));
}

/** Changes a member's role. The last admin stays an admin. */
export async function setMemberRole(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ personId: string; role: WorkspaceRole }>> {
  const parsed = roleInput.safeParse(input);
  if (!parsed.success) return invalid();
  const team = teamFor(deps, actor, 'members.setRole');
  if (refusal(team)) return team;
  const refused_ = await team.workspace.setRole(parsed.data.personId, parsed.data.role);
  if (refused_ === 'notMember') return GONE;
  if (refused_ === 'lastAdmin') return refused('role', COPY.MEMBERS_LAST_ADMIN);
  await record(deps, actor, 'members.setRole', '', [parsed.data.personId], parsed.data.role);
  return ok(parsed.data);
}

/**
 * Removes a member: their sessions, agents, API keys and webhooks end at once, and their name stays on what they
 * changed. The last admin stays.
 */
export async function removeMember(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ personId: string }>> {
  const parsed = personInput.safeParse(input);
  if (!parsed.success) return invalid();
  const team = teamFor(deps, actor, 'members.remove');
  if (refusal(team)) return team;
  const refused_ = await team.workspace.removeMember(parsed.data.personId);
  if (refused_ === 'lastAdmin') return refused('personId', COPY.MEMBERS_LAST_ADMIN);
  // Ended again when they are gone already: a removal that failed half way is finished by asking again (task 6's review).
  await team.endAccess(parsed.data.personId);
  if (refused_ === 'notMember') return GONE;
  await record(deps, actor, 'members.remove', '', [parsed.data.personId]);
  return ok(parsed.data);
}

/** The invites that haven't run out, the newest first. Admins only: they name addresses. */
export async function listInvites(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<WorkspaceInvite[]>> {
  if (!nothing.safeParse(input).success) return invalid();
  const team = teamFor(deps, actor, 'invites.list');
  if (refusal(team)) return team;
  return ok(await team.workspace.openInvites());
}

/**
 * Invites an address with a role, for 7 days; inviting it again replaces the earlier invite. A member's address is
 * refused: change their role instead. The invite email goes out from the caller, as the address's first sign-in link.
 */
export async function createInvite(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<WorkspaceInvite>> {
  const parsed = inviteInput.safeParse(typeof input === 'object' && input !== null && 'email' in input
    ? { ...input, email: typeof input.email === 'string' ? normalizeAddress(input.email) : input.email } : input);
  if (!parsed.success) {
    return parsed.error.issues.some((i) => i.path[0] === 'email') ? refused('email', COPY.INVITE_EMAIL_BAD) : invalid();
  }
  const team = teamFor(deps, actor, 'invites.create');
  if (refusal(team)) return team;
  if (await team.memberWithEmail(parsed.data.email)) return refused('email', COPY.INVITE_ALREADY_MEMBER);
  const invite = await team.workspace.invite({ email: parsed.data.email, role: parsed.data.role, invitedBy: personOf(actor) });
  await record(deps, actor, 'invites.create', '', [invite.id], parsed.data.role);
  return ok(invite);
}

/** Cancels an invite: the address can't ask for a sign-in link any more. */
export async function cancelInvite(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ inviteId: string }>> {
  const parsed = inviteIdInput.safeParse(input);
  if (!parsed.success) return invalid();
  const team = teamFor(deps, actor, 'invites.cancel');
  if (refusal(team)) return team;
  if (!(await team.workspace.cancelInvite(parsed.data.inviteId))) return { ok: false, error: 'not_found', message: COPY.INVITE_GONE };
  await record(deps, actor, 'invites.cancel', '', [parsed.data.inviteId]);
  return ok(parsed.data);
}

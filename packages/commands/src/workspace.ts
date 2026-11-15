import type { WorkspaceRole } from '@partner-desk/core';

/** A person in a company server's workspace (plan 15). The person id is their sign-in user id. */
export interface WorkspaceMember {
  personId: string;
  role: WorkspaceRole;
  /** Who added them: the admin who invited them, or null for the first admin. */
  addedBy: string | null;
  addedAt: string;
}

/** An address an admin invited: for `INVITE_DAYS` it may ask for a sign-in link, and its first sign-in makes the member. */
export interface WorkspaceInvite {
  id: string;
  /** Trimmed and lower case. */
  email: string;
  role: WorkspaceRole;
  invitedBy: string;
  createdAt: string;
  expiresAt: string;
}

/**
 * Why a change to a member did nothing: they aren't a member, or they are the last admin (there is always one,
 * spec 2026-11-07 §7.1).
 */
export type MemberRefusal = 'notMember' | 'lastAdmin';

/**
 * A company server's one workspace, its members and its open invites (plan 15). Ids, roles, times and invited
 * addresses only. `TursoWorkspace` in `@partner-desk/platform` keeps it in the database; the testing package has one in
 * memory. Both pass `describeWorkspaceContract`.
 */
export interface Workspace {
  /** The workspace key (`ws_…`), made on the first call. Two calls at once give the same key. */
  key(): Promise<string>;
  member(personId: string): Promise<WorkspaceMember | null>;
  /** Every member, the earliest added first. */
  members(): Promise<WorkspaceMember[]>;
  /** Adds the person with the role. One who is a member already keeps the role they have. */
  addMember(member: { personId: string; role: WorkspaceRole; addedBy: string | null }): Promise<WorkspaceMember>;
  /** Changes the role. Refused for the last admin unless the new role is admin too. */
  setRole(personId: string, role: WorkspaceRole): Promise<MemberRefusal | null>;
  /** Removes the member. Refused for the last admin. */
  removeMember(personId: string): Promise<MemberRefusal | null>;
  /** Invites the address for `INVITE_DAYS`. Inviting it again replaces the earlier invite, with the new role and days. */
  invite(invite: { email: string; role: WorkspaceRole; invitedBy: string }): Promise<WorkspaceInvite>;
  /** The invites that haven't run out, the newest first. */
  openInvites(): Promise<WorkspaceInvite[]>;
  /** The address's invite if it hasn't run out, else null. */
  inviteFor(email: string): Promise<WorkspaceInvite | null>;
  /** True when there was such an invite. */
  cancelInvite(id: string): Promise<boolean>;
  /**
   * The address's first sign-in: makes the person a member with the invite's role and ends the invite. Null when the
   * address has no invite that hasn't run out. A person who is a member already keeps their role, and the invite ends.
   */
  acceptInvite(email: string, personId: string): Promise<WorkspaceMember | null>;
  /** The clean-up: removes the invites that ran out, and with them the addresses. How many went. */
  pruneExpiredInvites(): Promise<number>;
}

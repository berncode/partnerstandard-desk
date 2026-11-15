import { normalizeAddress, type WorkspaceRole } from '@partner-desk/core';
import type { Workspace } from '@partner-desk/commands';
import type { EditionFlags } from '../env';
import { isTestUser } from './test-users';

/** A member's own id and role, as the actor carries them on a company server (plan 15). */
export interface MemberOf {
  personId: string;
  role: WorkspaceRole;
}

/**
 * Whose work a signed-in person reaches. `own`: their own workspace, keyed by their own user id (hosted, and a company
 * server's test users, so the e2e tests stay apart). `member`: the company server's one workspace, with their role.
 * `none`: a company server's person who is no member (removed, or never invited): they reach nothing.
 */
export type WorkspaceAccess =
  | { kind: 'own'; userId: string }
  | { kind: 'member'; userId: string; member: MemberOf }
  | { kind: 'none' };

/**
 * The one rule for who works in which workspace (plan 15, spec 2026-11-07 §7.2 and §8.2). On a company server, until
 * there is an admin, `ADMIN_EMAIL` becomes the first admin at its first sign-in; after that it is a person like any other,
 * so an admin who removed it isn't overruled by a setting. An address an admin invited becomes a member at its first
 * sign-in, with the invite's role.
 */
export async function workspaceAccess(
  workspace: Workspace,
  person: { id: string; email: string },
  { edition, adminEmail, testMode }: { edition: EditionFlags['edition']; adminEmail: string | null; testMode: boolean },
): Promise<WorkspaceAccess> {
  if (edition === 'hosted' || (testMode && isTestUser(person.email))) return { kind: 'own', userId: person.id };
  let found = await workspace.member(person.id);
  if (!found && adminEmail !== null && normalizeAddress(person.email) === normalizeAddress(adminEmail)
    && !(await workspace.members()).some((m) => m.role === 'admin')) {
    found = await workspace.addMember({ personId: person.id, role: 'admin', addedBy: null });
  }
  // An invited address's first sign-in makes the member, with the invite's role (plan 15).
  found ??= await workspace.acceptInvite(person.email, person.id);
  if (!found) return { kind: 'none' };
  return { kind: 'member', userId: await workspace.key(), member: { personId: found.personId, role: found.role } };
}

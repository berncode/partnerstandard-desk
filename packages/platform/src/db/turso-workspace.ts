import { and, asc, desc, eq, gt, lte, sql } from 'drizzle-orm';
import { INVITE_DAYS, newInviteId, newWorkspaceId, normalizeAddress as normalEmail, type WorkspaceRole } from '@partner-desk/core';
import type { MemberRefusal, Workspace, WorkspaceInvite, WorkspaceMember } from '@partner-desk/commands';
import type { Db } from './client';
import { guarded } from './guarded';
import { workspace, workspaceInvites, workspaceMembers } from './schema';

const DAY_MS = 24 * 60 * 60_000;

/**
 * A company server's workspace in the company's database (plan 15). Each rule that must hold with two requests at once
 * is one statement: the one row's key (`slot` 1), the last admin (the count is in the update's own condition), and the
 * first sign-in (the member comes from the invite in one insert).
 */
export class TursoWorkspace implements Workspace {
  constructor(private readonly db: Db, private readonly now: () => Date = () => new Date()) {}

  async key(): Promise<string> {
    return guarded('workspace_read_failed', async () => {
      const found = await this.findKey();
      if (found) return found;
      await this.db.insert(workspace).values({ slot: 1, id: newWorkspaceId(), createdAt: this.now().toISOString() }).onConflictDoNothing();
      const made = await this.findKey();
      if (!made) throw new Error('workspace_missing');
      return made;
    });
  }

  async member(personId: string): Promise<WorkspaceMember | null> {
    return guarded('workspace_read_failed', async () => {
      const [row] = await this.db.select().from(workspaceMembers).where(eq(workspaceMembers.personId, personId)).limit(1);
      return row ?? null;
    });
  }

  async members(): Promise<WorkspaceMember[]> {
    return guarded('workspace_read_failed', () => this.db.select().from(workspaceMembers).orderBy(asc(workspaceMembers.addedAt), sql`rowid`));
  }

  async addMember({ personId, role, addedBy }: { personId: string; role: WorkspaceRole; addedBy: string | null }): Promise<WorkspaceMember> {
    await guarded('workspace_add_failed', () => this.db.insert(workspaceMembers)
      .values({ personId, role, addedBy, addedAt: this.now().toISOString() }).onConflictDoNothing());
    const made = await this.member(personId);
    if (!made) throw new Error('workspace_add_failed');
    return made;
  }

  async setRole(personId: string, role: WorkspaceRole): Promise<MemberRefusal | null> {
    const changed = await guarded('workspace_update_failed', () => this.db.update(workspaceMembers).set({ role })
      .where(and(eq(workspaceMembers.personId, personId), role === 'admin' ? undefined : this.notLastAdmin()))
      .returning({ personId: workspaceMembers.personId }));
    return changed.length > 0 ? null : this.whyRefused(personId);
  }

  async removeMember(personId: string): Promise<MemberRefusal | null> {
    const gone = await guarded('workspace_remove_failed', () => this.db.delete(workspaceMembers)
      .where(and(eq(workspaceMembers.personId, personId), this.notLastAdmin()))
      .returning({ personId: workspaceMembers.personId }));
    return gone.length > 0 ? null : this.whyRefused(personId);
  }

  /** The row as stored when it returns, read back after the save. */
  async invite({ email, role, invitedBy }: { email: string; role: WorkspaceRole; invitedBy: string }): Promise<WorkspaceInvite> {
    const at = this.now();
    const row: WorkspaceInvite = {
      id: newInviteId(), email: normalEmail(email), role, invitedBy, createdAt: at.toISOString(),
      expiresAt: new Date(at.getTime() + INVITE_DAYS * DAY_MS).toISOString(),
    };
    await guarded('workspace_invite_failed', () => this.db.insert(workspaceInvites).values(row).onConflictDoUpdate({
      target: workspaceInvites.email,
      set: { id: row.id, role, invitedBy, createdAt: row.createdAt, expiresAt: row.expiresAt },
    }));
    const [stored] = await guarded('workspace_invite_failed', () => this.db.select().from(workspaceInvites)
      .where(eq(workspaceInvites.email, row.email)).limit(1));
    if (!stored) throw new Error('workspace_invite_failed');
    return stored;
  }

  async openInvites(): Promise<WorkspaceInvite[]> {
    return guarded('workspace_read_failed', () => this.db.select().from(workspaceInvites)
      .where(gt(workspaceInvites.expiresAt, this.now().toISOString()))
      .orderBy(desc(workspaceInvites.createdAt), desc(sql`rowid`)));
  }

  async inviteFor(email: string): Promise<WorkspaceInvite | null> {
    return guarded('workspace_read_failed', async () => {
      const [row] = await this.db.select().from(workspaceInvites).where(this.openFor(email, this.now().toISOString())).limit(1);
      return row ?? null;
    });
  }

  async cancelInvite(id: string): Promise<boolean> {
    const gone = await guarded('workspace_cancel_failed', () => this.db.delete(workspaceInvites).where(eq(workspaceInvites.id, id))
      .returning({ id: workspaceInvites.id }));
    return gone.length > 0;
  }

  /**
   * In one batch: the member from the open invite (one who is a member already keeps their role), then the invite ends.
   * Two first sign-ins at once make one member. One time for both statements, so the invite can't run out between them.
   */
  async acceptInvite(email: string, personId: string): Promise<WorkspaceMember | null> {
    const addedAt = this.now().toISOString();
    const open = this.openFor(email, addedAt);
    const [, ended] = await guarded('workspace_accept_failed', () => this.db.batch([
      this.db.insert(workspaceMembers).select(this.db.select({
        personId: sql<string>`${personId}`.as('person_id'), role: workspaceInvites.role, addedBy: workspaceInvites.invitedBy,
        addedAt: sql<string>`${addedAt}`.as('added_at'),
      }).from(workspaceInvites).where(open)).onConflictDoNothing(),
      this.db.delete(workspaceInvites).where(open).returning({ id: workspaceInvites.id }),
    ]));
    return ended.length > 0 ? this.member(personId) : null;
  }

  /** The clean-up: removes the invites that ran out, and with them the addresses. */
  async pruneExpiredInvites(): Promise<number> {
    const gone = await guarded('workspace_prune_failed', () => this.db.delete(workspaceInvites)
      .where(lte(workspaceInvites.expiresAt, this.now().toISOString())).returning({ id: workspaceInvites.id }));
    return gone.length;
  }

  private async findKey(): Promise<string | null> {
    const [row] = await this.db.select({ id: workspace.id }).from(workspace).where(eq(workspace.slot, 1)).limit(1);
    return row?.id ?? null;
  }

  private openFor(email: string, at: string) {
    return and(eq(workspaceInvites.email, normalEmail(email)), gt(workspaceInvites.expiresAt, at));
  }

  /** Not an admin, or not the last one. In the statement's own condition, so two at once can't both pass. */
  private notLastAdmin() {
    return sql`(${workspaceMembers.role} != 'admin' OR (SELECT count(*) FROM ${workspaceMembers} WHERE ${workspaceMembers.role} = 'admin') > 1)`;
  }

  private async whyRefused(personId: string): Promise<MemberRefusal> {
    return (await this.member(personId)) ? 'lastAdmin' : 'notMember';
  }
}

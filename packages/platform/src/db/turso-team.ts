import type { Team, Workspace } from '@partner-desk/commands';
import { normalizeAddress } from '@partner-desk/core';
import { and, eq, inArray } from 'drizzle-orm';
import type { Db } from './client';
import { guarded } from './guarded';
import { session, user, workspaceMembers } from './schema';
import { TursoAgentGrants } from './turso-agent-grants';
import { TursoApiKeys } from './turso-api-keys';
import { TursoWebhooks, type WebhookOptions } from './turso-webhooks';
import { TursoWorkspace } from './turso-workspace';

/**
 * A company server's team for the member commands (plan 15, task 6): the workspace, who its people are, and ending a
 * removed member's access. Ending it removes their sessions, so their next request is signed out, then their agents'
 * grants, API keys and webhooks, as Delete account does; their user row and what they changed stay.
 */
export class TursoTeam implements Team {
  readonly workspace: Workspace;

  constructor(private readonly db: Db, private readonly webhookOptions: WebhookOptions) {
    this.workspace = new TursoWorkspace(db);
  }

  async contacts(personIds: readonly string[]): Promise<Map<string, { name: string; email: string }>> {
    if (personIds.length === 0) return new Map();
    const rows = await guarded('team_read_failed', () => this.db.select({ id: user.id, name: user.name, email: user.email }).from(user)
      .where(inArray(user.id, [...personIds])));
    return new Map(rows.map((r) => [r.id, { name: r.name || r.email, email: r.email }]));
  }

  async memberWithEmail(email: string): Promise<boolean> {
    const [row] = await guarded('team_read_failed', () => this.db.select({ id: user.id }).from(user)
      .innerJoin(workspaceMembers, eq(workspaceMembers.personId, user.id)).where(and(eq(user.email, normalizeAddress(email)))).limit(1));
    return row !== undefined;
  }

  async endAccess(personId: string): Promise<void> {
    await guarded('team_end_failed', () => this.db.delete(session).where(eq(session.userId, personId)));
    await new TursoAgentGrants(this.db).deleteForUser(personId);
    await new TursoApiKeys(this.db).deleteForUser(personId);
    await new TursoWebhooks(this.db, this.webhookOptions).deleteForUser(personId);
  }
}

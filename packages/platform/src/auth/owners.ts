import { asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { companies, user, workspace, workspaceMembers } from '../db/schema';
import { userContact, userDisplayName, userExists } from './accounts';

// The owner of a company's work: a person on hosted, the workspace key on a company server (plan 15). The key is no
// person, so "no user row" mustn't read as "gone" for it: its company's name stands where an owner's name stood, and its
// emails go to every admin and partner manager (plan 15, task 5).

async function isWorkspaceKey(db: Db, id: string): Promise<boolean> {
  if (!id.startsWith('ws_')) return false;
  const [row] = await db.select({ id: workspace.id }).from(workspace).where(eq(workspace.id, id)).limit(1);
  return row !== undefined;
}

/** The workspace's earliest admin who still has an account: their name (else address) and address. */
async function firstAdmin(db: Db): Promise<{ name: string; email: string } | null> {
  const [row] = await db.select({ name: user.name, email: user.email }).from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.personId))
    .where(eq(workspaceMembers.role, 'admin')).orderBy(asc(workspaceMembers.addedAt)).limit(1);
  return row ? { name: row.name || row.email, email: row.email } : null;
}

async function companyName(db: Db, key: string): Promise<string> {
  const [row] = await db.select({ name: companies.name }).from(companies).where(eq(companies.ownerUserId, key)).limit(1);
  return row?.name.trim() ?? '';
}

/** Whether the owner is still there: a person with an account, or the company server's workspace. */
export async function ownerExists(db: Db, ownerUserId: string): Promise<boolean> {
  return (await isWorkspaceKey(db, ownerUserId)) || userExists(db, ownerUserId);
}

/** The name an owner goes by: a person's name (else address); the workspace's company name, else its first admin's. */
export async function ownerDisplayName(db: Db, ownerUserId: string): Promise<string | null> {
  if (!(await isWorkspaceKey(db, ownerUserId))) return userDisplayName(db, ownerUserId);
  return (await companyName(db, ownerUserId)) || (await firstAdmin(db))?.name || '';
}

/** One of our side's people an email to the owner goes to. */
export interface Recipient {
  name: string;
  email: string;
}

/**
 * Who stands for the owner in the MAP's emails. `email`: the address replies go to, and the reconnect email's; on a
 * company server none, since no one person speaks for the company (plan 15). `recipients`: who gets the emails to our
 * side (momentum, digest, partner alerts): the owner on hosted; every admin and partner manager with an account on a
 * company server, each turning them off for themselves (spec 2026-11-07 §7.3). `team`: a company server's, so each
 * recipient has their own "sent once" mark. Null once a person's account is gone; a workspace is never gone.
 */
export interface OwnerContact {
  name: string;
  email: string | null;
  recipients: Recipient[];
  team: boolean;
}

export async function ownerContact(db: Db, ownerUserId: string): Promise<OwnerContact | null> {
  if (!(await isWorkspaceKey(db, ownerUserId))) {
    const person = await userContact(db, ownerUserId);
    return person ? { ...person, recipients: [person], team: false } : null;
  }
  const rows = await db.select({ name: user.name, email: user.email }).from(workspaceMembers)
    .innerJoin(user, eq(user.id, workspaceMembers.personId))
    .where(inArray(workspaceMembers.role, ['admin', 'partnerManager'])).orderBy(asc(workspaceMembers.addedAt), sql`${workspaceMembers}.rowid`);
  const name = (await companyName(db, ownerUserId)) || (await firstAdmin(db))?.name || '';
  return { name, email: null, recipients: rows.map((r) => ({ name: r.name || r.email, email: r.email })), team: true };
}

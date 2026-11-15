// The email link a company server signs in with (plan 14, task 2; owner, 2026-11-08: email link only). Better Auth's
// magic link plugin makes and checks the token; its own link, a GET that signs in on a visit, is switched off, and our
// email links to our confirm page, whose button (a POST) signs in (AGENTS.md: emails never act on a GET).
import { createHash } from 'node:crypto';
import { magicLink } from 'better-auth/plugins';
import { normalizeAddress } from '@partner-desk/core';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client';
import { user, workspaceMembers } from '../db/schema';
import { TursoWorkspace } from '../db/turso-workspace';
import { editionFlags, type ServerEnv } from '../env';
import { safeNextPath } from './next-path';
import { isTestUser } from './test-users';

/** A link works this long: 15 minutes (spec §8.1). */
export const SIGN_IN_LINK_SECONDS = 15 * 60;

/**
 * Sends one sign-in link: the address, the bare token for the app's own confirm page, and where it goes on to. `invitedBy`:
 * the name of the admin who invited an address that isn't a member, so its email is the invite (plan 15).
 */
export type SendSignInLink = (link: { email: string; token: string; next: string; invitedBy?: string }) => Promise<void>;

/** Whether the company server has an admin yet: until then `ADMIN_EMAIL` signs in to become the first (spec §8.2). */
async function hasAdmin(db: Db): Promise<boolean> {
  const [row] = await db.select({ id: workspaceMembers.personId }).from(workspaceMembers).where(eq(workspaceMembers.role, 'admin')).limit(1);
  return row !== undefined;
}

/** The account with this address, if it is a member, and whether it has an account at all. */
async function accountOf(db: Db, address: string): Promise<{ exists: boolean; member: boolean }> {
  const [row] = await db.select({ id: user.id, member: workspaceMembers.personId }).from(user)
    .leftJoin(workspaceMembers, eq(workspaceMembers.personId, user.id)).where(eq(user.email, address)).limit(1);
  return { exists: row !== undefined, member: row?.member != null };
}

const firstAdmin = async (env: ServerEnv, db: Db, address: string): Promise<boolean> => {
  const { adminEmail } = editionFlags(env);
  return adminEmail !== null && address === adminEmail && !(await hasAdmin(db));
};

/**
 * Who may get a sign-in link on a company server (plan 15): `ADMIN_EMAIL` until there is an admin, an address an admin
 * invited (for 7 days), and a member. Anyone else gets no email; the page answers the same, so it never says who.
 */
export async function mayUseSignInLink(env: ServerEnv, db: Db, email: string): Promise<boolean> {
  const address = normalizeAddress(email);
  if (await firstAdmin(env, db, address)) return true;
  if (await new TursoWorkspace(db).inviteFor(address)) return true;
  return (await accountOf(db, address)).member;
}

/** Who may become a user on a company server: the first admin, an invited address, and test sign-in's own users in test mode. */
export async function mayBecomeUser(env: ServerEnv, db: Db, email: string): Promise<boolean> {
  const address = normalizeAddress(email);
  if (env.PD_TEST_AUTH && isTestUser(address)) return true;
  return (await firstAdmin(env, db, address)) || (await new TursoWorkspace(db).inviteFor(address)) !== null;
}

/**
 * The inviter's name for an invited address that isn't a member: its link goes out as the invite (plan 15), also to a
 * former member invited again.
 */
async function invitedBy(db: Db, address: string): Promise<string | undefined> {
  const invite = await new TursoWorkspace(db).inviteFor(address);
  if (!invite || (await accountOf(db, address)).member) return undefined;
  const [row] = await db.select({ name: user.name, email: user.email }).from(user).where(eq(user.id, invite.invitedBy)).limit(1);
  return row ? row.name || row.email : '';
}

/**
 * The plugin, for a company server. A link to an address that may not sign in is never sent; the page answers the
 * same either way, so it never says who may sign in. The token is stored hashed, works once and for 15 minutes.
 */
export function signInLinkPlugin(env: ServerEnv, db: Db, send: SendSignInLink, log: (event: string) => void = (event) => console.error(`[auth] ${event}`)) {
  return magicLink({
    storeToken: 'hashed',
    expiresIn: SIGN_IN_LINK_SECONDS,
    sendMagicLink: async ({ email, token, url }) => {
      // Detached, checks and all: the answer comes as fast for an address that may sign in as for any other, so its
      // timing gives nothing away (plan 14's review; plan 15's review: the checks read the database). The app's sender
      // never throws; a failed send is logged there, without the address.
      void (async () => {
        const address = normalizeAddress(email);
        if (!(await mayUseSignInLink(env, db, address))) return;
        // The page asked with `callbackURL`, which the plugin puts in its own link: ours goes on to the same place.
        const next = safeNextPath(new URL(url).searchParams.get('callbackURL'));
        const inviter = await invitedBy(db, address);
        await send({ email: address, token, next, ...(inviter !== undefined ? { invitedBy: inviter } : {}) });
      })().catch(() => {
        // A database that doesn't answer: the page said "on its way", so the operator needs this line. No address, no token.
        log('sign_in_link_check_failed');
      });
    },
  });
}

/** The plugin's own key for a token, as it stores it: `magic-link:` and the token's SHA-256, base64url. */
export const signInLinkIdentifier = (token: string): string => `magic-link:${createHash('sha256').update(token).digest('base64url')}`;

/** The two endpoints of the plugin the pages call, which Better Auth's types don't name when the plugin is optional. */
interface SignInLinkApi {
  signInMagicLink(input: { body: { email: string; callbackURL: string }; headers: Headers }): Promise<unknown>;
  magicLinkVerify(input: { query: { token: string }; headers: Headers; returnHeaders: true }): Promise<{ headers: Headers }>;
}
/** The parts of Better Auth these helpers read. */
interface AuthLike {
  api: unknown;
  $context: Promise<{ internalAdapter: { findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date } | null> } }>;
}

/**
 * Asks for a link to `email` that goes on to `next` (a path of this app). Answers the same whether or not the address
 * may sign in; false only when it failed.
 */
export async function requestSignInLink(auth: AuthLike, email: string, headers: Headers, next = '/this-week'): Promise<boolean> {
  try {
    await (auth.api as SignInLinkApi).signInMagicLink({ body: { email: email.trim().toLowerCase(), callbackURL: safeNextPath(next) }, headers });
    return true;
  } catch {
    return false;
  }
}

/**
 * The address a link is for, read from the stored link and never from the address bar, for the confirm page: null when
 * the link is unknown, used or past its time. Only reads: the link still works.
 */
export async function signInLinkEmail(auth: AuthLike, token: string): Promise<string | null> {
  if (!/^[A-Za-z0-9]{16,128}$/.test(token)) return null;
  try {
    const row = await (await auth.$context).internalAdapter.findVerificationValue(signInLinkIdentifier(token));
    if (!row || new Date(row.expiresAt).getTime() <= Date.now()) return null;
    const value = JSON.parse(row.value) as { type?: unknown; email?: unknown };
    return value.type === 'magic-link' && typeof value.email === 'string' ? value.email : null;
  } catch {
    return null;
  }
}

/**
 * Redeems a link: signs in, once. Answers the session cookie Better Auth sets (the app's nextCookies plugin also writes
 * it), or null when the link is unknown, used or past its time.
 */
export async function redeemSignInLink(auth: AuthLike, token: string, headers: Headers): Promise<Headers | null> {
  if (!/^[A-Za-z0-9]{16,128}$/.test(token)) return null;
  try {
    const { headers: out } = await (auth.api as SignInLinkApi).magicLinkVerify({ query: { token }, headers, returnHeaders: true });
    return out.get('set-cookie') ? out : null;
  } catch {
    return null;
  }
}

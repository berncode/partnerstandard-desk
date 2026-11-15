'use server';

import { addressHash } from '@partner-desk/commands';
import { NOTIFICATION_TYPES, type NotificationType } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { deleteAccount } from '@partner-desk/platform';
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { accountDeps, currentOwner, emailPrefs, getAuth, workspace } from '@/server/runtime';
import { SIGNED_OUT } from '../actions/context';

/**
 * Deletes our records of the signed-in person (platform `deleteAccount`). Sign-out comes first, while the request
 * still holds the cookie. The spreadsheets stay in their Drive and Google's grant is never revoked: all PartnerStandard
 * tools share it.
 */
export async function deleteMyAccount(confirm: unknown): Promise<{ ok: false; message: string } | void> {
  const session = await currentOwner();
  if (!session) return SIGNED_OUT;
  if (confirm !== 'DELETE') return { ok: false, message: COPY.SETTINGS_DELETE_TYPE };
  // A company's last admin stays (plan 15): asked before signing out, so they can still make someone else admin.
  if (session.member?.role === 'admin' && (await workspace().members()).filter((m) => m.role === 'admin').length <= 1) {
    return { ok: false, message: COPY.DELETE_ACCOUNT_LAST_ADMIN };
  }
  await getAuth().api.signOut({ headers: await headers() });
  const result = await deleteAccount(accountDeps(), session.personId, { member: session.member !== null });
  if (!result.ok) return result;
  redirect('/?account=deleted');
}

const isNotificationType = (value: unknown): value is NotificationType =>
  typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value);

/**
 * On or off for one kind of MAP email, for the signed-in person's own address only, as its unsubscribe link does. Our
 * database keeps the address's hash only [builder's call: settings of our own tables, not a command].
 */
export async function setEmailType(type: unknown, on: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const session = await currentOwner();
  if (!session) return SIGNED_OUT;
  if (!isNotificationType(type) || typeof on !== 'boolean') return { ok: false, message: COPY.SETTINGS_WRONG };
  const hash = addressHash(session.email);
  if (on) await emailPrefs().resubscribe(hash, type);
  else await emailPrefs().unsubscribe(hash, type, new Date().toISOString());
  return { ok: true };
}

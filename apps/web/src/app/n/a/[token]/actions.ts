'use server';

import { headers } from 'next/headers';
import { performAction, type ActionOutcome } from '@/server/email-actions';
import { emailActionDeps } from '@/server/runtime';

/** The confirmation page's POST. Arguments are untrusted: the token is checked again and the MAP read again. */
export async function confirmEmailAction(token: string, input: { status?: string; note?: string }): Promise<ActionOutcome> {
  const forwarded = (await headers()).get('x-forwarded-for');
  const ip = forwarded?.split(',')[0]?.trim() || null;
  const fields: { status?: unknown; note?: unknown } = typeof input === 'object' && input !== null ? input : {};
  return performAction(emailActionDeps(), token, { status: fields.status, note: fields.note }, ip);
}

// Signed tokens for the email buttons and the unsubscribe link, for MAP ids.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { addressHash } from '@partner-desk/commands';
import { NOTIFICATION_TYPES, type NotificationType } from '@partner-desk/core';

/** Reminder buttons stop working after this (the MAP app's spec 5.2). */
export const ACTION_TTL_DAYS = 14;
export const EMAIL_ACTIONS = ['done', 'in_progress', 'update'] as const;
export type EmailAction = (typeof EMAIL_ACTIONS)[number];

/** One MAP, one activity, one action, one person: single-purpose. */
export interface ActionClaims { mapId: string; activityId: string; action: EmailAction; personId: string; emailHash: string; exp: number }

const ACTION_LABEL = 'pd:map-action:v1';
const UNSUBSCRIBE_LABEL = 'pd:map-unsub:v1';
/** payload.signature: a SHA-256 signature is 43 base64url characters. */
const SHAPE = /^[A-Za-z0-9_-]{1,900}\.[A-Za-z0-9_-]{43}$/;

/** The first 16 hex characters of the address's SHA-256: enough to notice the sheet's address changed. */
export const shortEmailHash = (email: string): string => addressHash(email).slice(0, 16);

/** Each purpose signs with its own key, derived from the app secret, so no new secret is needed (the MAP app's Decision 9). */
const signature = (secret: string, label: string, payload: string): Buffer =>
  createHmac('sha256', createHmac('sha256', secret).update(label).digest()).update(payload).digest();

function sign(secret: string, label: string, claims: object): string {
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
  return `${payload}.${signature(secret, label, payload).toString('base64url')}`;
}

/** The signed JSON, or null for anything malformed or not signed for `label`. Never throws. */
function open(secret: string, label: string, token: unknown): unknown {
  if (typeof token !== 'string' || !SHAPE.test(token)) return null;
  const [payload = '', given = ''] = token.split('.');
  // Compared as text: the canonical encoding only, since base64url decoding ignores the last character's spare bits.
  const expected = Buffer.from(signature(secret, label, payload).toString('base64url'), 'utf8');
  const actual = Buffer.from(given, 'utf8');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

const actionSchema = z.object({
  v: z.literal(1),
  p: z.string().regex(/^map_[0-9a-z]{10}$/),
  a: z.string().min(1).max(64),
  x: z.enum(EMAIL_ACTIONS),
  r: z.string().min(1).max(64),
  e: z.string().regex(/^[0-9a-f]{16}$/),
  exp: z.number().int().positive(),
}).strict();

const unsubscribeSchema = z.object({ v: z.literal(1), h: z.string().regex(/^[0-9a-f]{64}$/), t: z.enum(NOTIFICATION_TYPES) }).strict();

export function signAction(secret: string, claims: Omit<ActionClaims, 'exp'>, nowMs: number): string {
  return sign(secret, ACTION_LABEL, {
    v: 1, p: claims.mapId, a: claims.activityId, x: claims.action, r: claims.personId, e: claims.emailHash,
    exp: Math.floor(nowMs / 1000) + ACTION_TTL_DAYS * 86_400,
  });
}

/**
 * When the button was signed, in epoch milliseconds, to the second: its expiry less the 14 days. It assumes
 * ACTION_TTL_DAYS hasn't changed since the token was signed; changing it shifts every older button's time by the difference.
 */
export const issuedAtOf = (claims: ActionClaims): number => claims.exp * 1000 - ACTION_TTL_DAYS * 86_400_000;

export function verifyAction(secret: string, token: unknown, nowMs: number): ActionClaims | null {
  const parsed = actionSchema.safeParse(open(secret, ACTION_LABEL, token));
  if (!parsed.success || parsed.data.exp * 1000 <= nowMs) return null;
  const { p, a, x, r, e, exp } = parsed.data;
  return { mapId: p, activityId: a, action: x, personId: r, emailHash: e, exp };
}

/** One-click unsubscribe for one address and kind. No expiry; it carries the address's hash only (the MAP app's Decision 8). */
export function signUnsubscribe(secret: string, email: string, type: NotificationType): string {
  return sign(secret, UNSUBSCRIBE_LABEL, { v: 1, h: addressHash(email), t: type });
}

export function verifyUnsubscribe(secret: string, token: unknown): { emailHash: string; type: NotificationType } | null {
  const parsed = unsubscribeSchema.safeParse(open(secret, UNSUBSCRIBE_LABEL, token));
  return parsed.success ? { emailHash: parsed.data.h, type: parsed.data.t } : null;
}

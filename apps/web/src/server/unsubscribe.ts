import type { EmailPrefs } from '@partner-desk/commands';
import { TYPE_LABEL, type IsoDateTime, type NotificationType } from '@partner-desk/core';
import { verifyUnsubscribe } from './signed-tokens';

export interface UnsubscribeDeps { secret: string; prefs: EmailPrefs; now: () => IsoDateTime }
export type UnsubscribeView = { kind: 'confirm' | 'done'; type: NotificationType; label: string } | { kind: 'invalid' };

/** GET: whether this address still gets `type`. It only reads: link scanners open every link. */
export async function unsubscribeView(deps: UnsubscribeDeps, token: unknown): Promise<UnsubscribeView> {
  const claims = verifyUnsubscribe(deps.secret, token);
  if (!claims) return { kind: 'invalid' };
  const done = await deps.prefs.isUnsubscribed(claims.emailHash, claims.type);
  return { kind: done ? 'done' : 'confirm', type: claims.type, label: TYPE_LABEL[claims.type] };
}

/** POST, from the page's button or a mail provider's one-click (RFC 8058). Idempotent. */
export async function unsubscribe(deps: UnsubscribeDeps, token: unknown): Promise<{ ok: true; label: string } | { ok: false }> {
  const claims = verifyUnsubscribe(deps.secret, token);
  if (!claims) return { ok: false };
  await deps.prefs.unsubscribe(claims.emailHash, claims.type, deps.now());
  return { ok: true, label: TYPE_LABEL[claims.type] };
}

// When a webhook delivery is tried again, and when a failing webhook turns off (agents spec 7.4). Pure.

/**
 * The events a webhook can subscribe to (agents spec 7.2), and an agent's proposal made or answered (agent proposals
 * spec 9): ids and the kind code only.
 */
export const WEBHOOK_EVENTS = [
  'partner.stage_changed', 'partner.signed', 'activity.overdue', 'health.changed', 'review.due', 'proposal.created', 'proposal.answered',
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

/** What "Send test" sends: not an event anyone subscribes to, so it goes to the one webhook tested. */
export const WEBHOOK_TEST_EVENT = 'webhook.test';

/** The waits before each retry: 1, 5 and 30 minutes, 2, 6 and 12 hours, about a day in all [builder's call, spec 7.4]. */
export const RETRY_AFTER_MS = [60_000, 300_000, 1_800_000, 7_200_000, 21_600_000, 43_200_000] as const;

/** A webhook whose every delivery failed for this long turns off (spec 7.4). */
export const TURN_OFF_AFTER_MS = 3 * 24 * 60 * 60_000;

/** Delivered and given-up rows are kept this long (spec 7.4). */
export const DELIVERY_KEEP_MS = 7 * 24 * 60 * 60_000;

/** Marks ("this activity's overdue was sent") are kept this long, longer than anything that could fire twice. */
export const MARK_KEEP_MS = 90 * 24 * 60 * 60_000;

/**
 * When to try a delivery next, after `attempts` tries that all failed: now when it wasn't tried yet, then after each
 * wait in turn, and null once the last retry failed (the delivery is given up).
 */
export function nextTryAt(attempts: number, now: number): number | null {
  if (attempts < 1) return now;
  const wait = RETRY_AFTER_MS[attempts - 1];
  return wait === undefined ? null : now + wait;
}

/** True when the webhook's failing streak (since `firstFailureAt`, null without one) has lasted 3 days. */
export function shouldTurnOff(firstFailureAt: number | null, now: number): boolean {
  return firstFailureAt !== null && now - firstFailureAt >= TURN_OFF_AFTER_MS;
}

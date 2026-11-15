// Sends the webhook deliveries that are due (agents spec 7.4): right after a command when the function has time
// (`after`), and from the scheduled job. Each request is signed as Standard Webhooks has it and carries ids only.
import { nextTryAt, shouldTurnOff } from '@partner-desk/core';
import { signatureHeaders, type TargetCheck, type TursoWebhooks } from '@partner-desk/platform';
import type { Log } from './log';

/** How long one request may take, all of it [builder's call]. */
export const REQUEST_TIMEOUT_MS = 10_000;
/** How long a sender holds a delivery it claimed: longer than one request, so no other run sends it meanwhile. */
export const CLAIM_LEASE_MS = 60_000;
/** The time `after` gives deliveries once a command answered [builder's call]: well inside the function's 60 seconds. */
export const AFTER_DEADLINE_MS = 20_000;

/** One signed request, as `send` gets it. */
export interface WebhookRequest { body: string; headers: Record<string, string> }

export interface DeliveryDeps {
  store: Pick<TursoWebhooks, 'claimDue' | 'markDone' | 'markFailed' | 'turnOffFailing'>;
  /**
   * POSTs one request and answers its HTTP status, 0 for no answer; never follows a redirect, never throws. The app's
   * is platform's `postWebhook`, which connects only to the address its own lookup checked.
   */
  send: (url: string, request: WebhookRequest) => Promise<number>;
  /** The address check again before each request: a name can come to point inside since the webhook was saved. */
  checkTarget: (url: string) => Promise<TargetCheck>;
  /** The clock (epoch ms): the deadline, and the time of each claim, try and signature. */
  clock: () => number;
  log: Log;
}

/**
 * Sends the due deliveries one at a time until none is left or `deadlineMs` has passed; with `userId`, only that
 * person's (after their own command). `now` is when the run started; each delivery is claimed, signed and scheduled
 * at the time it is sent (`now` plus what the clock says has passed since), so a late claim still holds its full lease.
 * A 2xx answer is done. Anything else is a failure: a redirect too, which is never followed, and no answer (status 0).
 * A failure is tried again after the next wait, or given up after the last; a webhook whose failures have run 3 days
 * turns off. Logs hold ids and the status only: never the address, the body, the answer or the secret.
 */
export async function deliverDue(
  deps: DeliveryDeps, now: Date, opts: { deadlineMs: number; userId?: string },
): Promise<{ sent: number; failed: number; turnedOff: number }> {
  const started = deps.clock();
  const result = { sent: 0, failed: 0, turnedOff: 0 };
  for (;;) {
    const elapsed = deps.clock() - started;
    if (elapsed >= opts.deadlineMs) break;
    const at = now.getTime() + elapsed;
    const [delivery] = await deps.store.claimDue(at, { limit: 1, leaseMs: CLAIM_LEASE_MS, ...(opts.userId !== undefined ? { userId: opts.userId } : {}) });
    if (!delivery) break;
    const status = await attempt(deps, delivery, at);
    if (status >= 200 && status < 300) {
      await deps.store.markDone(delivery, { status, nowMs: at });
      result.sent++;
      continue;
    }
    result.failed++;
    deps.log('webhook_delivery_failed', { webhookId: delivery.webhookId, deliveryId: delivery.id, status: String(status) });
    const { firstFailureAt } = await deps.store.markFailed(delivery, { status, nowMs: at, nextTryAt: nextTryAt(delivery.attempts + 1, at) });
    if (shouldTurnOff(firstFailureAt, at) && (await deps.store.turnOffFailing(delivery.webhookId))) {
      result.turnedOff++;
      deps.log('webhook_turned_off', { webhookId: delivery.webhookId });
    }
  }
  return result;
}

/** One request, signed at `at`. Its status; 0 when it isn't sent or gets no answer. Never throws. */
async function attempt(deps: DeliveryDeps, d: Awaited<ReturnType<DeliveryDeps['store']['claimDue']>>[number], at: number): Promise<number> {
  if (d.secret === null) return 0;
  try {
    if (!(await deps.checkTarget(d.url)).ok) return 0;
    // The body of spec 7.3: what happened and to which records, never their content.
    const body = JSON.stringify({ type: d.type, id: d.id, occurredAt: d.occurredAt, data: d.data });
    return await deps.send(d.url, {
      body,
      headers: { 'content-type': 'application/json', 'user-agent': 'PartnerDesk-Webhooks/1', ...signatureHeaders(d.secret, d.id, Math.floor(at / 1000), body) },
    });
  } catch {
    return 0;
  }
}

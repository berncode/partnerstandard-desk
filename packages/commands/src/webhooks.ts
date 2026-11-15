// Webhooks (agents spec 7): a person's subscriptions, and the events the commands send them. A webhook belongs to a
// person, not a company; every command acts on the actor's own rows only, and another person's webhook id answers as a
// missing one does (spec 6.1).
import { WEBHOOK_EVENTS, type PartnerBook, type WebhookEvent } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { can } from './access';
import { personOf, type Actor } from './actor';
import type { Deps } from './deps';
import type { ProposalEntry } from './proposal-index';
import { FORBIDDEN, invalid, ok, record, type CommandResult, type Failure } from './result';

export type WebhookStatus = 'active' | 'off_failing' | 'off';

/** A webhook as the person and their agents see it. Never its secret. */
export interface WebhookInfo {
  id: string;
  url: string;
  events: WebhookEvent[];
  /** `off_failing`: turned off after 3 days of failed deliveries (spec 7.4). */
  status: WebhookStatus;
  createdAt: string;
}

/**
 * One delivery as Settings shows it (spec 7.1): when the event happened, its type, and the receiver's last answer code
 * (0 for no answer, null while it waits to be sent), and its event id, for Send again; never its body or the address.
 */
export interface WebhookDelivery {
  /** The event id (`evt_…`), for the Send again button only; Settings never shows it. */
  id: string;
  at: string;
  type: string;
  status: number | null;
}

/**
 * What Send again found (question 28). `queued`: due now, waiting, with the same event id. `not_found`: no such delivery,
 * or not the person's webhook. `off`: the webhook is off, so nothing would go. `not_failed`: delivered, or waiting with no
 * failed answer (also while a sender has it). `sending`: a sender, or another Send again, took it meanwhile.
 */
export type ResendOutcome = 'queued' | 'not_found' | 'off' | 'not_failed' | 'sending';

/**
 * An active webhook as the scheduled job needs it (question 27): its events, and since when it is on: when it was last
 * turned on, else when it was added. The job's overdue and review events go only to webhooks on since before they happened.
 */
export interface WebhookSubscription {
  id: string;
  events: WebhookEvent[];
  activeSince: string;
}

/** Whether an address may receive webhooks: https and public when hosted (spec 7.4). */
export type TargetCheck = { ok: true } | { ok: false; reason: 'not_https' | 'has_credentials' | 'private_address' | 'unresolvable' };

/**
 * The webhook tables (`TursoWebhooks` in platform). Deliveries hold ids only (spec 7.3); the secret is stored encrypted
 * and leaves only once, from `create`.
 */
export interface WebhookStore {
  /** The person's webhooks, oldest first. */
  list(userId: string): Promise<WebhookInfo[]>;
  /** The owner's active webhooks, oldest first, with since when each is on: a company server's workspace, every member's. */
  subscriptions(userId: string): Promise<WebhookSubscription[]>;
  /** A new webhook with a new signing secret, returned this once. */
  create(row: { userId: string; url: string; events: WebhookEvent[] }): Promise<{ webhook: WebhookInfo; secret: string }>;
  /** Deletes the person's webhook and its deliveries. False when it isn't theirs. */
  remove(userId: string, id: string): Promise<boolean>;
  /**
   * False when it isn't theirs. Turning one on (`active`) that was off drops its waiting deliveries (question 28), ends
   * its failing streak, so it isn't turned off again at once, and records when it was turned on (`activeSince`).
   * Delivered and given-up ones stay. Turning on one that is on changes nothing and drops nothing.
   */
  setStatus(userId: string, id: string, status: WebhookStatus): Promise<boolean>;
  /** The webhook's newest deliveries first, at most `limit`; null when it isn't theirs. */
  recentDeliveries(userId: string, id: string, limit: number): Promise<WebhookDelivery[] | null>;
  /**
   * One delivery of this event, with these ids as its data, to each of the owner's active webhooks (a company server's
   * workspace: every member's) subscribed to
   * `type`, all with one event id. With `markKey` (activity.overdue, review.due: once per key) the mark is made first,
   * and nothing happens when the person's mark already exists. With `only`, just to those of them; an empty `only`
   * makes no mark and queues nothing.
   */
  enqueue(userId: string, type: WebhookEvent, data: Record<string, string>, markKey?: string, only?: readonly string[]): Promise<void>;
  /** "Send test": one `webhook.test` delivery to this webhook. Its event id; null when it isn't theirs. */
  sendTest(userId: string, id: string): Promise<string | null>;
  /**
   * "Send again": puts one failed delivery (not done, its last answer not 2xx) of the person's active webhook back,
   * due now, not given up, its last answer cleared, with the same event id. Its tries go on counting. One
   * compare-and-set: never two sends of one delivery.
   */
  resend(userId: string, webhookId: string, deliveryId: string): Promise<ResendOutcome>;
  /** Checks an address before it is saved (https and public when hosted). */
  checkTarget(url: string): Promise<TargetCheck>;
}

/** The most webhooks one person keeps [builder's call]: each event goes to each of them. */
export const MAX_WEBHOOKS = 10;

/** How many of a webhook's deliveries Settings shows (spec 7.1). */
export const RECENT_DELIVERIES = 10;

const webhookId = z.string().min(1).max(64);
const listInput = z.object({}).strict();
/** A webhook's events, each once: the command's input and the add_webhook tool's, so both refuse a list the same way. */
export const webhookEvents = z.array(z.enum(WEBHOOK_EVENTS)).min(1).max(WEBHOOK_EVENTS.length)
  .refine((list) => new Set(list).size === list.length, { message: 'Send each event once.' });
const createInput = z.object({
  url: z.string().min(1).max(2048),
  events: webhookEvents,
}).strict();
const oneInput = z.object({ webhookId }).strict();
const resendInput = z.object({ webhookId, deliveryId: z.string().min(1).max(64) }).strict();

const GONE: Failure = { ok: false, error: 'not_found', message: COPY.WEBHOOK_GONE };
const RESEND_REFUSED: Record<Exclude<ResendOutcome, 'queued'>, Failure> = {
  not_found: { ok: false, error: 'not_found', message: COPY.WEBHOOK_DELIVERY_GONE },
  off: { ok: false, error: 'invalid', message: COPY.WEBHOOK_SEND_AGAIN_OFF },
  not_failed: { ok: false, error: 'invalid', message: COPY.WEBHOOK_SEND_AGAIN_NOT_FAILED },
  sending: { ok: false, error: 'conflict', message: COPY.WEBHOOK_SEND_AGAIN_BUSY },
};
const TARGET_MESSAGES: Record<Exclude<TargetCheck, { ok: true }>['reason'], string> = {
  not_https: COPY.WEBHOOK_URL_HTTPS, has_credentials: COPY.WEBHOOK_URL_CREDENTIALS, private_address: COPY.WEBHOOK_URL_PRIVATE, unresolvable: COPY.WEBHOOK_URL_UNKNOWN,
};

/** The access check runs on the actor's workspace; the store keys every webhook on its person (`personOf`, plan 15). */
const own = (actor: Actor) => ({ ownerUserId: actor.userId });

/** The person's webhooks. Never a secret. */
export async function listWebhooks(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<WebhookInfo[]>> {
  if (!listInput.safeParse(input).success) return invalid();
  if (!can(actor, 'webhooks.list', own(actor))) return FORBIDDEN;
  const list = await deps.webhooks.list(personOf(actor));
  await record(deps, actor, 'webhooks.list', '', []);
  return ok(list);
}

/**
 * Adds a webhook for the person. The address is checked first (https and public when hosted); a refused one is
 * `invalid` on `url`, and nothing is saved. The answer holds the signing secret: the only time anyone sees it.
 */
export async function createWebhook(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ webhook: WebhookInfo; secret: string }>> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'webhooks.create', own(actor))) return FORBIDDEN;
  const target = await deps.webhooks.checkTarget(parsed.data.url);
  if (!target.ok) return invalid({ url: TARGET_MESSAGES[target.reason] });
  if ((await deps.webhooks.list(personOf(actor))).length >= MAX_WEBHOOKS) {
    return { ok: false, error: 'invalid', message: COPY.WEBHOOK_LIMIT(MAX_WEBHOOKS) };
  }
  const made = await deps.webhooks.create({ userId: personOf(actor), url: parsed.data.url, events: parsed.data.events });
  await record(deps, actor, 'webhooks.create', '', [made.webhook.id]);
  return ok(made);
}

/** Deletes one of the person's webhooks, and the deliveries still waiting for it. */
export async function deleteWebhook(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ deleted: true }>> {
  const parsed = oneInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'webhooks.delete', own(actor))) return FORBIDDEN;
  if (!(await deps.webhooks.remove(personOf(actor), parsed.data.webhookId))) return GONE;
  await record(deps, actor, 'webhooks.delete', '', [parsed.data.webhookId]);
  return ok({ deleted: true });
}

/** "Send test": queues one `webhook.test` delivery to one of the person's webhooks. Sent as soon as the function has time. */
export async function testWebhook(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ eventId: string }>> {
  const parsed = oneInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'webhooks.test', own(actor))) return FORBIDDEN;
  const eventId = await deps.webhooks.sendTest(personOf(actor), parsed.data.webhookId);
  if (eventId === null) return GONE;
  await record(deps, actor, 'webhooks.test', '', [parsed.data.webhookId]);
  return ok({ eventId });
}

/**
 * "Send again" (question 28): puts one failed delivery of the person's active webhook back in the queue, with the same
 * event id, so the receiver's `webhook-id` is the same, as Standard Webhooks asks of a retry; it is signed again when it
 * is sent. The person only, never an agent. Sent as soon as the function has time.
 */
export async function resendWebhookDelivery(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ eventId: string }>> {
  const parsed = resendInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'webhooks.resend', own(actor))) return FORBIDDEN;
  const { webhookId, deliveryId } = parsed.data;
  const outcome = await deps.webhooks.resend(personOf(actor), webhookId, deliveryId);
  if (outcome !== 'queued') return RESEND_REFUSED[outcome];
  await record(deps, actor, 'webhooks.resend', '', [webhookId, deliveryId]);
  return ok({ eventId: deliveryId });
}

/** A webhook's last deliveries, newest first: time, event and answer code, and the event id for Send again (spec 7.1). */
export async function listWebhookDeliveries(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<WebhookDelivery[]>> {
  const parsed = oneInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'webhooks.deliveries', own(actor))) return FORBIDDEN;
  const list = await deps.webhooks.recentDeliveries(personOf(actor), parsed.data.webhookId, RECENT_DELIVERIES);
  if (list === null) return GONE;
  await record(deps, actor, 'webhooks.deliveries', '', [parsed.data.webhookId]);
  return ok(list);
}

/** Sets one of the person's webhooks on or off, and answers it as it is now. */
async function switchWebhook(
  deps: Deps, actor: Actor, input: unknown, command: 'webhooks.turnOff' | 'webhooks.turnOn',
): Promise<CommandResult<{ webhook: WebhookInfo }>> {
  const parsed = oneInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, command, own(actor))) return FORBIDDEN;
  const { webhookId } = parsed.data;
  const turnOn = command === 'webhooks.turnOn';
  // Turn on reads the webhooks first: only a real off to on forgets the health heard of (below).
  const before = turnOn ? await deps.webhooks.list(personOf(actor)) : [];
  if (!(await deps.webhooks.setStatus(personOf(actor), webhookId, turnOn ? 'active' : 'off'))) return GONE;
  const webhook = (await deps.webhooks.list(personOf(actor))).find((w) => w.id === webhookId);
  // Deleted between the two calls: as gone as one never made.
  if (!webhook) return GONE;
  if (turnOn) await forgetHealthOnTurnOn(deps, actor.userId, webhookId, before);
  await record(deps, actor, command, '', [webhookId]);
  return ok({ webhook });
}

/**
 * A webhook for `health.changed` turned on again, while no other webhook on hears of health (on a company server, any
 * member's): the health stored for the MAPs is from before it was off, so it is forgotten, and the next run stores the
 * health it finds without an event, as for a new webhook [builder's call]. Otherwise a change made while it was off would arrive
 * as news. Another webhook on for `health.changed` kept the stored health current, so it stays. Best effort: a failure
 * is logged by ids and never fails the Turn on.
 */
async function forgetHealthOnTurnOn(deps: Deps, userId: string, webhookId: string, before: readonly WebhookInfo[]): Promise<void> {
  const was = before.find((w) => w.id === webhookId);
  if (!was || was.status === 'active' || !was.events.includes('health.changed')) return;
  try {
    // Every webhook the owner's events reach: on a company server, every member's too (plan 15).
    const others = await deps.webhooks.subscriptions(userId);
    if (others.some((w) => w.id !== webhookId && w.events.includes('health.changed'))) return;
    await deps.directory.forgetWebhookHealth(userId);
  } catch {
    deps.log('webhook_health_failed', { userId, webhookId });
  }
}

/** Turns one of the person's webhooks off: no event goes to it until it is turned on. Its waiting deliveries wait, unsent. */
export async function turnOffWebhook(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ webhook: WebhookInfo }>> {
  return switchWebhook(deps, actor, input, 'webhooks.turnOff');
}

/**
 * Turns one of the person's webhooks on again, also one turned off after 3 days of failures, with the same secret. Its
 * failing streak starts over [builder's call], and what waited while it was off is dropped (question 28): only what
 * happens from now on goes. Its delivered and given-up deliveries stay in Last deliveries. On already: nothing changes.
 * For a webhook with `health.changed`, the health its MAPs last told of is forgotten, so the first one after is news to
 * nobody (`forgetHealthOnTurnOn`).
 */
export async function turnOnWebhook(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ webhook: WebhookInfo }>> {
  return switchWebhook(deps, actor, input, 'webhooks.turnOn');
}

/**
 * Tells the person's webhooks that a partner type was signed or its stage changed, after the save and its event: the
 * account, the partner type and its MAP (when it has one), by id. Best effort: a failure is logged by ids (the event
 * type, the person, the account) and never fails the change, which is saved already.
 */
export async function partnerWebhooks(
  deps: Deps, userId: string, companyId: string, type: Extract<WebhookEvent, 'partner.signed' | 'partner.stage_changed'>, partnerId: string,
  book: PartnerBook,
): Promise<void> {
  // A row the store answered with is always there; were it not, the event goes without an account rather than with ''.
  const accountId = book.partners.find((p) => p.id === partnerId)?.accountId;
  const account: Record<string, string> = accountId !== undefined ? { accountId } : {};
  try {
    const map = await deps.directory.mapFor(companyId, partnerId);
    await deps.webhooks.enqueue(userId, type, { ...account, partnerId, ...(map ? { mapId: map.mapId } : {}) });
  } catch {
    try {
      deps.log('webhook_enqueue_failed', { type, userId, ...account });
    } catch { /* logging must not throw either */ }
  }
}

/**
 * Tells the person's webhooks that an agent made a proposal, or that the person answered one (agent proposals spec 9):
 * the proposal's id, its kind (a code) and the target ids it has. A withdrawn, replaced or expired one sends nothing.
 * Best effort: a failure is logged by ids and never fails the proposal or its answer.
 */
export async function proposalWebhooks(
  deps: Deps, userId: string, type: Extract<WebhookEvent, 'proposal.created' | 'proposal.answered'>, entry: ProposalEntry,
): Promise<void> {
  const targets = { accountId: entry.accountId, partnerId: entry.partnerId, marketId: entry.marketId, hypothesisId: entry.hypothesisId };
  const ids = Object.fromEntries(Object.entries(targets).filter((pair): pair is [string, string] => pair[1] !== null));
  try {
    await deps.webhooks.enqueue(userId, type, { proposalId: entry.id, kind: entry.kind, ...ids });
  } catch {
    try {
      deps.log('webhook_enqueue_failed', { type, userId, proposalId: entry.id });
    } catch { /* logging must not throw either */ }
  }
}

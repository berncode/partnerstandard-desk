'use server';

// Settings, "Agents and API" (agents spec 4.5, 7.1): the signed-in person's own connected agents, API keys and webhooks.
// Keys and grants are account records, managed through their stores as Delete account does; webhooks go through the
// commands. Every action acts for the signed-in person only, as an owner, and never touches the Google grant.
import {
  createWebhook, deleteWebhook, levelsWithinRole, listWebhookDeliveries, resendWebhookDelivery, testWebhook, turnOffWebhook, turnOnWebhook, type CommandResult,
  type WebhookDelivery, type WebhookInfo,
} from '@partner-desk/commands';
import { WEBHOOK_EVENTS } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { AgentGrant, ApiKeyInfo } from '@partner-desk/platform';
import { z } from 'zod';
import { actorFor, agentGrants, apiKeys, currentOwner, depsFor, type OwnerSession } from '@/server/runtime';
import { SIGNED_OUT } from '../actions/context';
import { MAX_KEY_NAME, withinRole } from './agents-shared';

export type AgentsFailure = { ok: false; message: string; fieldErrors?: Record<string, string> };
export type WebhookView = WebhookInfo & { deliveries: WebhookDelivery[] };


const recordId = z.string().min(1).max(128);
const level = z.enum(['read', 'change', 'propose']);

const WRONG: AgentsFailure = { ok: false, message: COPY.SETTINGS_WRONG };

/** A command's refusal as the panel shows it: its message, and the field it is about. */
function refusal(result: Extract<CommandResult<unknown>, { ok: false }>): AgentsFailure {
  return { ok: false, message: result.message, ...(result.fieldErrors ? { fieldErrors: result.fieldErrors } : {}) };
}

async function signedIn<R>(work: (session: OwnerSession) => Promise<R>): Promise<R | AgentsFailure> {
  const session = await currentOwner();
  if (!session) return SIGNED_OUT;
  const out = await work(session);
  // A company server's viewer is told why, as on every other page (plan 15, final review).
  const forbidden = typeof out === 'object' && out !== null && (out as { ok?: unknown }).ok === false
    && (out as { message?: unknown }).message === COPY.FORBIDDEN;
  return session.member?.role === 'viewer' && forbidden ? { ...(out as unknown as AgentsFailure), message: COPY.VIEWER_READ_ONLY } : out;
}

/**
 * A new API key for the person: shown once, here; the list keeps only its first characters. The name is trimmed;
 * the level is "read", "change" or "propose" (Read, change and propose).
 */
export async function createApiKey(name: unknown, keyLevel: unknown): Promise<{ ok: true; key: string; keys: ApiKeyInfo[] } | AgentsFailure> {
  return signedIn(async (session) => {
    if (typeof name !== 'string') return WRONG;
    const trimmed = name.trim();
    if (trimmed === '') return { ok: false, message: COPY.FIX_FIELDS, fieldErrors: { name: COPY.API_KEY_NAME_MISSING } };
    if (trimmed.length > MAX_KEY_NAME) return { ok: false, message: COPY.FIX_FIELDS, fieldErrors: { name: COPY.API_KEY_NAME_LONG(MAX_KEY_NAME) } };
    const parsedLevel = level.safeParse(keyLevel);
    if (!parsedLevel.success) return WRONG;
    const userId = session.personId;
    const role = session.member?.role;
    // A company server's viewer makes read-only keys alone (plan 15); the form offers no other.
    if (!levelsWithinRole([parsedLevel.data], role).length) return WRONG;
    const { key } = await apiKeys().create({ userId, name: trimmed, level: parsedLevel.data });
    return { ok: true, key, keys: withinRole(await apiKeys().list(userId), role) };
  });
}

/** Turns one of the person's keys off at once. A key already off, or someone else's, changes nothing. */
export async function turnOffApiKey(id: unknown): Promise<{ ok: true; keys: ApiKeyInfo[] } | AgentsFailure> {
  return signedIn(async (session) => {
    const parsed = recordId.safeParse(id);
    if (!parsed.success) return WRONG;
    await apiKeys().revoke(session.personId, parsed.data);
    return { ok: true, keys: withinRole(await apiKeys().list(session.personId), session.member?.role) };
  });
}

/**
 * Turns off an app the person allowed: its grant and refresh tokens go, so its next request is refused. Only our own
 * rows: the Google grant all PartnerStandard tools share is never revoked.
 */
export async function turnOffAgent(clientId: unknown): Promise<{ ok: true; agents: AgentGrant[] } | AgentsFailure> {
  return signedIn(async (session) => {
    const parsed = recordId.safeParse(clientId);
    if (!parsed.success) return WRONG;
    await agentGrants().revoke(session.personId, parsed.data);
    return { ok: true, agents: withinRole(await agentGrants().list(session.personId), session.member?.role) };
  });
}

const eventsInput = z.array(z.enum(WEBHOOK_EVENTS));

/** Adds a webhook through the command, which checks the address. The signing secret is in this answer only. */
export async function addWebhook(url: unknown, events: unknown): Promise<{ ok: true; secret: string; webhook: WebhookView } | AgentsFailure> {
  return signedIn(async (session) => {
    const picked = eventsInput.safeParse(events);
    if (!picked.success) return WRONG;
    if (picked.data.length === 0) return { ok: false, message: COPY.FIX_FIELDS, fieldErrors: { events: COPY.WEBHOOK_EVENTS_MISSING } };
    const made = await createWebhook(depsFor(session), actorFor(session), { url: typeof url === 'string' ? url.trim() : url, events: picked.data });
    if (!made.ok) return refusal(made);
    return { ok: true, secret: made.value.secret, webhook: { ...made.value.webhook, deliveries: [] } };
  });
}

/** The webhook's last deliveries: time, event and answer code. */
export async function webhookDeliveries(webhookId: unknown): Promise<{ ok: true; deliveries: WebhookDelivery[] } | AgentsFailure> {
  return signedIn(async (session) => {
    const listed = await listWebhookDeliveries(depsFor(session), actorFor(session), { webhookId });
    return listed.ok ? { ok: true, deliveries: listed.value } : refusal(listed);
  });
}

/** "Send test": queues a `webhook.test` delivery, sent right after this answer; answers the deliveries with it waiting. */
export async function sendWebhookTest(webhookId: unknown): Promise<{ ok: true; deliveries: WebhookDelivery[] } | AgentsFailure> {
  return signedIn(async (session) => {
    const deps = depsFor(session);
    const actor = actorFor(session);
    const sent = await testWebhook(deps, actor, { webhookId });
    if (!sent.ok) return refusal(sent);
    const listed = await listWebhookDeliveries(deps, actor, { webhookId });
    return listed.ok ? { ok: true, deliveries: listed.value } : refusal(listed);
  });
}

/**
 * "Send again": puts one failed delivery back, sent right after this answer with the same event id; answers the
 * deliveries with it waiting.
 */
export async function sendWebhookAgain(
  webhookId: unknown, deliveryId: unknown,
): Promise<{ ok: true; deliveries: WebhookDelivery[] } | AgentsFailure> {
  return signedIn(async (session) => {
    const deps = depsFor(session);
    const actor = actorFor(session);
    const sent = await resendWebhookDelivery(deps, actor, { webhookId, deliveryId });
    if (!sent.ok) return refusal(sent);
    const listed = await listWebhookDeliveries(deps, actor, { webhookId });
    return listed.ok ? { ok: true, deliveries: listed.value } : refusal(listed);
  });
}

export async function turnWebhookOff(webhookId: unknown): Promise<{ ok: true; webhook: WebhookInfo } | AgentsFailure> {
  return signedIn(async (session) => {
    const done = await turnOffWebhook(depsFor(session), actorFor(session), { webhookId });
    return done.ok ? { ok: true, webhook: done.value.webhook } : refusal(done);
  });
}

/**
 * Turns a webhook on again, also one turned off after 3 days of failures; its failing streak starts over, and what
 * waited while it was off is dropped. Answers its deliveries as they are now, without those.
 */
export async function turnWebhookOn(
  webhookId: unknown,
): Promise<{ ok: true; webhook: WebhookInfo; deliveries: WebhookDelivery[] } | AgentsFailure> {
  return signedIn(async (session) => {
    const deps = depsFor(session);
    const actor = actorFor(session);
    const done = await turnOnWebhook(deps, actor, { webhookId });
    if (!done.ok) return refusal(done);
    const listed = await listWebhookDeliveries(deps, actor, { webhookId });
    return listed.ok ? { ok: true, webhook: done.value.webhook, deliveries: listed.value } : refusal(listed);
  });
}

export async function removeWebhook(webhookId: unknown): Promise<{ ok: true } | AgentsFailure> {
  return signedIn(async (session) => {
    const done = await deleteWebhook(depsFor(session), actorFor(session), { webhookId });
    return done.ok ? { ok: true } : refusal(done);
  });
}

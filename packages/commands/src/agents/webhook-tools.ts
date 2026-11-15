// The webhook tools (agents spec 7.1): an agent or n8n subscribes itself, as Settings does. A webhook is its person's,
// whoever made it; another person's webhook id answers as a missing one does.
import { z } from 'zod';
import type { CommandResult } from '../result';
import { createWebhook, deleteWebhook, listWebhooks, webhookEvents, type WebhookInfo } from '../webhooks';
import type { AgentTool } from './tools';

/** Types each tool's input and output, and keeps its own type out of the registry's list. */
const tool = <I, O>(t: AgentTool<I, O>): AgentTool => t as unknown as AgentTool;

export const WEBHOOK_TOOLS: readonly AgentTool[] = [
  tool({
    name: 'list_webhooks', title: 'List webhooks', level: 'read', rest: { method: 'GET', path: '/webhooks' },
    description: 'Lists the webhooks of the person you act for: id, address, the events each gets, and its status '
      + '(active; off_failing when it was turned off after 3 days of failed deliveries; off). Never a signing secret.',
    input: z.object({}).strict(),
    run: (ctx): Promise<CommandResult<WebhookInfo[]>> => listWebhooks(ctx.deps, ctx.actor, {}),
  }),
  tool({
    name: 'add_webhook', title: 'Add a webhook', level: 'change', rest: { method: 'POST', path: '/webhooks' },
    description: 'Adds a webhook: PartnerStandard Desk POSTs each chosen event to the https address, signed as Standard Webhooks '
      + 'does (webhook-id, webhook-timestamp, webhook-signature headers). Events: partner.stage_changed (every stage change: '
      + 'a stage move, a signing, an exit, an undone signing), partner.signed, activity.overdue, health.changed, review.due, '
      + 'proposal.created, proposal.answered (a proposal made by an agent, or answered by the person: its proposalId and kind). '
      + 'A delivery carries ids only (accountId, partnerId, mapId and so on); '
      + 'read the details with the other tools. It gets only what happens after it is added; read what is there now with the other tools. '
      + 'The answer holds the signing secret, shown this once: keep it.',
    input: z.object({
      url: z.string().min(1).max(2048).describe('A public https address.'),
      events: webhookEvents.describe('Each event once.'),
    }).strict(),
    run: (ctx, input): Promise<CommandResult<{ webhook: WebhookInfo; secret: string }>> => createWebhook(ctx.deps, ctx.actor, input),
  }),
  tool({
    name: 'delete_webhook', title: 'Delete a webhook', level: 'change', rest: { method: 'POST', path: '/webhooks/{webhookId}/delete' },
    description: 'Deletes a webhook (webhookId from list_webhooks) and the deliveries still waiting for it.',
    input: z.object({ webhookId: z.string().min(1).max(64) }).strict(),
    run: (ctx, input): Promise<CommandResult<{ deleted: true }>> => deleteWebhook(ctx.deps, ctx.actor, input),
  }),
];

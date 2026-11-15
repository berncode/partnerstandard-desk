import {
  appMaker, countProposals, keyMaker, levelsWithinRole, listWebhookDeliveries, listWebhooks, makerKey, type Actor, type Deps,
} from '@partner-desk/commands';
import { agentResource, agentSignInAvailable } from '@partner-desk/platform';
import { log as serverLog, type Log } from '@/server/log';
import { agentGrants, apiKeys, appUrl, type OwnerSession } from '@/server/runtime';
import type { AgentsPanelProps } from './agents-panel';
import { withinRole } from './agents-shared';

/** A refusal from the commands, not a throw: its code goes in the log line in place of an error's name. */
class Refused extends Error {
  constructor(code: string) {
    super(code);
    this.name = code;
  }
}

/**
 * How many proposals wait for the person, by agent (`makerKey`), from our index alone. A count that can't be read is
 * no count, logged by the error's name only: the lists still show, so an agent can still be turned off [builder's call].
 */
async function waitingByMaker(deps: Deps, actor: Actor, userId: string, log: Log): Promise<Record<string, number>> {
  try {
    const counted = await countProposals(deps, actor);
    if (!counted.ok) throw new Refused(counted.error);
    return counted.value.byMaker;
  } catch (error) {
    try {
      log('settings_proposals_count_failed', { userId, error: error instanceof Error ? error.name : 'unknown' });
    } catch { /* logging must not throw either */ }
    return {};
  }
}

/**
 * What "Agents and API" shows: the connector address, and the person's own agents, keys and webhooks with each
 * webhook's last deliveries, and how many proposals wait from each agent and key. Our tables only; never a key or a
 * secret. Null when a list couldn't be read (a throw, or the commands refusing the webhooks), logged by the error's
 * name only: the card then says so, rather than an empty list, and the rest of Settings still shows.
 *
 * Each row's agent, as the index counts it, is worked out here (`makerKeys`): two client ids of one reconnected app
 * are one agent, as on This week's count. The rows only look it up, so the browser needs none of the commands.
 */
export async function agentsPanelData(
  session: OwnerSession, deps: Deps, actor: Actor, timeZone: string, log: Log = serverLog,
): Promise<AgentsPanelProps | null> {
  const userId = session.owner.userId;
  // A person's own agents and keys (plan 15): the workspace's work is everyone's, these are the person's.
  const personId = session.personId;
  try {
    const role = session.member?.role;
    // Each shown at the level it really has: a company server's viewer's agents and keys read only (plan 15).
    const [agents, keys, listed] = await Promise.all([
      agentGrants().list(personId).then((list) => withinRole(list, role)),
      apiKeys().list(personId).then((list) => withinRole(list, role)),
      listWebhooks(deps, actor, {}),
    ]);
    if (!listed.ok) throw new Refused(listed.error);
    const webhooks = await Promise.all(listed.value.map(async (webhook) => {
      const deliveries = await listWebhookDeliveries(deps, actor, { webhookId: webhook.id });
      return { ...webhook, deliveries: deliveries.ok ? deliveries.value : [] };
    }));
    const url = appUrl();
    // Read once the lists are: a card that can't show them has no rows to count for.
    const proposalsWaiting = await waitingByMaker(deps, actor, userId, log);
    const makerKeys = {
      // On a company server, the member's own agents (plan 15): another member's "Claude" is another agent.
      apps: Object.fromEntries(agents.map((agent) => [agent.clientId, makerKey(appMaker(agent.appName, agent.clientId, session.member?.personId))])),
      keys: Object.fromEntries(keys.map((key) => [key.id, makerKey(keyMaker(key.id, session.member?.personId))])),
    };
    return {
      connectorUrl: agentSignInAvailable(url) ? agentResource(url) : null, personName: session.owner.displayName, timeZone, agents, keys, webhooks,
      proposalsWaiting, makerKeys, ...(role === 'viewer' ? { keyLevels: levelsWithinRole(['read', 'change', 'propose'], role) } : {}),
    };
  } catch (error) {
    try {
      log('settings_agents_failed', { userId, error: error instanceof Error ? error.name : 'unknown' });
    } catch { /* logging must not throw either */ }
    return null;
  }
}

'use client';

import type { AgentLevel } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import type { AgentGrant, ApiKeyInfo } from '@partner-desk/platform';
import { CopyButton } from '@/ui/copy-button';
import { FieldRow } from '@/ui/pieces';
import type { WebhookView } from './agents-actions';
import { ConnectedAgents } from './agents-list';
import { ApiKeys } from './api-keys-list';
import { Webhooks } from './webhooks-list';

export interface AgentsPanelProps {
  /** The connector address (`<APP_URL>/mcp`), or null when agents can't sign in here (plain http, self-hosted). */
  connectorUrl: string | null;
  /** The person's name, for the example in the key dialog ("Desk Agent for Anna"). */
  personName: string;
  /** The person's timezone (Settings): dates read the same on the server and in the browser. */
  timeZone: string;
  agents: AgentGrant[];
  keys: ApiKeyInfo[];
  webhooks: WebhookView[];
  /** How many proposals wait for the person, by agent (`makerKey`): Settings shows each row's count when above 0. */
  proposalsWaiting: Record<string, number>;
  /** Each row's agent as `proposalsWaiting` counts it: an app by its client id, a key by its id. */
  makerKeys: MakerKeys;
  /** The levels a new key may have (plan 15: a company server's viewer, "Read only" alone). All when absent. */
  keyLevels?: AgentLevel[];
}

/** Each listed app's and key's `makerKey`, worked out on the server. */
export interface MakerKeys {
  apps: Record<string, string>;
  keys: Record<string, string>;
}

/** The row's "N proposals waiting", or nothing when none wait. */
export function waitingFact(proposalsWaiting: Record<string, number>, maker: string | undefined): string[] {
  const n = maker === undefined ? 0 : (proposalsWaiting[maker] ?? 0);
  return n > 0 ? [COPY.SETTINGS_PROPOSALS_WAITING(n)] : [];
}

/** The card when its lists couldn't be read: one line, so nothing looks empty that isn't. */
export function AgentsUnavailable() {
  return <p role="status" className="text-sm text-ink-3">{COPY.AGENTS_LOAD_FAILED}</p>;
}

/**
 * Settings, "Agents and API" (agents spec 4.5, 7.1, 10): the connector address to copy, then the three lists the
 * person turns off: connected agents, API keys and webhooks. The lists live in their own files beside this one.
 */
export function AgentsPanel({ connectorUrl, personName, timeZone, agents, keys, webhooks, proposalsWaiting, makerKeys, keyLevels }: AgentsPanelProps) {
  return (
    <div className="grid min-w-0 gap-3">
      {connectorUrl ? (
        <div>
          <FieldRow label={COPY.AGENTS_ADDRESS}>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <code className="min-w-0 rounded-md bg-surface-2 px-2 py-1 font-mono text-[13px] break-all">{connectorUrl}</code>
              <CopyButton size="sm" text={connectorUrl}>{COPY.AGENTS_COPY_ADDRESS}</CopyButton>
            </div>
            <p className="mt-1 text-xs text-ink-3">{COPY.AGENTS_CONNECT_HINT}</p>
          </FieldRow>
        </div>
      ) : <p className="text-sm text-ink-3">{COPY.AGENTS_CONNECT_NEEDS_HTTPS}</p>}
      <ConnectedAgents initial={agents} timeZone={timeZone} waiting={(agent) => waitingFact(proposalsWaiting, makerKeys.apps[agent.clientId])} />
      <ApiKeys initial={keys} personName={personName} timeZone={timeZone} waiting={(key) => waitingFact(proposalsWaiting, makerKeys.keys[key.id])}
        {...(keyLevels ? { levels: keyLevels } : {})} />
      <Webhooks initial={webhooks} timeZone={timeZone} />
    </div>
  );
}

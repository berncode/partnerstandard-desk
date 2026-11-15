'use client';

import { COPY } from '@partner-desk/copy';
import type { AgentGrant } from '@partner-desk/platform';
import { useId, useState, useTransition } from 'react';
import { Button } from '@/ui/button';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { useCopy } from '@/storage-context';
import { turnOffAgent } from './agents-actions';
import { dayIn, EmptyLine, Facts, lastUsed, LEVEL_LABEL, SubSection } from './agents-shared';

const nameOf = (agent: AgentGrant): string => agent.appName.trim() || COPY.AGENT_FALLBACK_NAME;

/**
 * The apps the person allowed on the allow page, each with its level, its dates, how many of its proposals wait, and
 * Turn off (asked first). Only our rows go; Google's grant stays.
 */
export function ConnectedAgents({ initial, timeZone, waiting }: {
  initial: AgentGrant[]; timeZone: string; waiting: (agent: AgentGrant) => string[];
}) {
  const [agents, setAgents] = useState(initial);
  const [confirming, setConfirming] = useState<AgentGrant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();
  const headingId = useId();
  const words = useCopy();

  const turnOff = (agent: AgentGrant) => startPending(async () => {
    setError(null);
    try {
      const result = await turnOffAgent(agent.clientId);
      if (result.ok) setAgents(result.agents);
      else setError(result.message);
    } catch {
      setError(COPY.SETTINGS_WRONG);
    }
    setConfirming(null);
  });

  return (
    <SubSection id={headingId} title={COPY.AGENTS_CONNECTED}>
      {agents.length === 0 ? <EmptyLine>{COPY.AGENTS_NONE}</EmptyLine> : (
        <ul className="divide-y divide-line">
          {agents.map((agent) => <AgentRow key={agent.clientId} agent={agent} timeZone={timeZone} waiting={waiting(agent)} disabled={pending} onTurnOff={() => setConfirming(agent)} />)}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-danger">{error}</p>}
      <ConfirmDialog open={confirming !== null} onOpenChange={(open) => { if (!open) setConfirming(null); }} busy={pending}
        title={COPY.TURN_OFF_TITLE(confirming ? nameOf(confirming) : '')} text={words.AGENT_TURN_OFF_TEXT} action={COPY.TURN_OFF}
        onConfirm={() => { if (confirming) turnOff(confirming); }} />
    </SubSection>
  );
}

function AgentRow({ agent, timeZone, waiting, disabled, onTurnOff }: {
  agent: AgentGrant; timeZone: string; waiting: string[]; disabled: boolean; onTurnOff: () => void;
}) {
  const nameId = useId();
  const name = nameOf(agent);
  return (
    <li aria-labelledby={nameId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 first:pt-0">
      <div className="min-w-0 flex-1 basis-48">
        <p id={nameId} className="truncate text-sm font-medium">{name}</p>
        <Facts items={[LEVEL_LABEL[agent.level], COPY.AGENTS_ALLOWED_ON(dayIn(agent.allowedAt, timeZone)), lastUsed(agent.lastUsedAt, timeZone), ...waiting]} />
      </div>
      <Button size="sm" variant="ghost" aria-label={COPY.TURN_OFF_NAMED(name)} disabled={disabled} onClick={onTurnOff}>{COPY.TURN_OFF}</Button>
    </li>
  );
}

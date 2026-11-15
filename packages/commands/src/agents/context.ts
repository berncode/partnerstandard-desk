import { COPY } from '@partner-desk/copy';
import type { AgentActor, AgentLevel, AgentVia, Member } from '../actor';
import type { Deps } from '../deps';

/** What the MCP server and the REST API hand every command for one agent request: its person's company and actor. */
export interface AgentContext {
  deps: Deps;
  actor: AgentActor;
  companyId: string;
}

const MAX_AGENT_NAME = 40;

/**
 * The agent's name as a client gave it, trimmed and cut: Settings shows it, and it tells agents apart; elsewhere an agent is "Desk Agent for Ruth". A client that gave none
 * is "Agent". The proposal index reads app and key names through it too, so it knows an agent by the name it acts as.
 */
export const cleanAgentName = (name: string): string => name.trim().slice(0, MAX_AGENT_NAME).trim() || COPY.AGENT_FALLBACK_NAME;

/** The company is its workspace's (`companies.forUser`, made on first use); an agent never names another. */
export async function agentContext(
  deps: Deps, who: { userId: string; displayName: string; agentName: string; level: AgentLevel; via: AgentVia; member?: Member },
): Promise<AgentContext> {
  const { companyId } = await deps.companies.forUser(who.userId);
  return {
    deps, companyId,
    actor: {
      kind: 'agent', userId: who.userId, displayName: who.displayName, agentName: cleanAgentName(who.agentName), level: who.level,
      via: who.via.kind === 'app' ? { kind: 'app', clientId: who.via.clientId } : { kind: 'key', keyId: who.via.keyId },
      ...(who.member ? { member: { personId: who.member.personId, role: who.member.role } } : {}),
    },
  };
}

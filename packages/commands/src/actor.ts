import type { Side, WorkspaceRole } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';

/**
 * What a grant lets an agent do: read; read and change; or read, change and propose (agent proposals spec 5.1). Each
 * level holds the one before it: `levelAtLeast`.
 */
export type AgentLevel = 'read' | 'change' | 'propose';

/** How an agent came in: an app the person allowed (its OAuth client id), or an API key (its id). Spec 5.3. */
export type AgentVia = { kind: 'app'; clientId: string } | { kind: 'key'; keyId: string };

/**
 * A company server's member (plan 15): their own id and role. There `userId` is the workspace key, whose work every
 * member shares; hosted, and for a company server's test users, there is no member and `userId` is the person.
 */
export interface Member {
  personId: string;
  role: WorkspaceRole;
}

export type Actor =
  /** `proposal`: the person accepting an agent's proposal, so every write says "Ruth, proposed by Desk Agent". */
  | { kind: 'owner'; userId: string; displayName: string; proposal?: { id: string; agentName: string }; member?: Member }
  | { kind: 'agent'; userId: string; displayName: string; agentName: string; level: AgentLevel; via: AgentVia; member?: Member }
  /**
   * A person with a magic link to one MAP (spec 4): a partner contact or a colleague, on one side. `userId` is the MAP's
   * owner, whose files the link reaches; `name` is the person's name in the MAP's People tab, or '' until it is read.
   */
  | { kind: 'link'; userId: string; linkId: string; mapId: string; personId: string; side: Side; name: string };

export type AgentActor = Extract<Actor, { kind: 'agent' }>;
export type OwnerActor = Extract<Actor, { kind: 'owner' }>;

const LEVEL_RANK: Readonly<Record<AgentLevel, number>> = { read: 0, change: 1, propose: 2 };

/** Whether `level` holds `floor`: read < change < propose. A propose agent may do all a change agent may (spec 5.2). */
export const levelAtLeast = (level: AgentLevel, floor: AgentLevel): boolean => LEVEL_RANK[level] >= LEVEL_RANK[floor];

/**
 * The person behind an actor: a member's own id on a company server, else `userId`. Who did what (events) and a person's
 * own things (keys, grants, webhooks, email settings) key on it. A link holder has no account: their MAP's owner.
 */
export const personOf = (actor: Actor): string => (actor.kind !== 'link' && actor.member ? actor.member.personId : actor.userId);

/**
 * The most an agent may do for a member of this role (spec 2026-11-07 §7.1, plan 15): a viewer's agent reads only;
 * a partner manager's and an admin's are as their grant says. Without a member (hosted), the grant alone counts.
 */
export function levelWithinRole(level: AgentLevel, role: WorkspaceRole | undefined): AgentLevel {
  return role === 'viewer' ? 'read' : level;
}

/** The levels to offer a member of this role, out of those an app asked for: a viewer is offered "Read only" alone. */
export function levelsWithinRole(levels: readonly AgentLevel[], role: WorkspaceRole | undefined): AgentLevel[] {
  return role === 'viewer' ? levels.filter((level) => level === 'read') : [...levels];
}

/** The person, accepting one agent's proposal: the same access, and the writes name the agent too (spec 10.3). */
export function withProposal(actor: OwnerActor, proposal: { id: string; agentName: string }): Actor {
  return { ...actor, proposal: { id: proposal.id, agentName: proposal.agentName } };
}

/**
 * The label every write carries: "Ruth", "Desk Agent for Ruth", "Ruth, proposed by Desk Agent" (the person accepting
 * a proposal), or "Lena Ortiz (by link)" [builder's call]. An agent is always "Desk Agent" here (owner, 2026-11-14); its own
 * name stays in Settings and tells agents apart.
 */
export function actorLabel(actor: Actor): string {
  if (actor.kind === 'agent') return `${COPY.DESK_AGENT} for ${actor.displayName}`;
  if (actor.kind === 'link') return COPY.LINK_ACTOR(actor.name);
  return actor.proposal ? COPY.ACTOR_PROPOSED_BY(actor.displayName, COPY.DESK_AGENT) : actor.displayName;
}

/**
 * Whose Drive a new file goes to, and the name it is made by. Only a person or their agent makes files; a person with
 * a link never does (`can` refuses them), so their files would carry no name.
 */
export function ownerOf(actor: Actor): { userId: string; displayName: string } {
  return { userId: actor.userId, displayName: actor.kind === 'link' ? '' : actor.displayName };
}

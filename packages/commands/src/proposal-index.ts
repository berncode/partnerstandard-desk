// The proposal index (agent proposals spec 7.2): one row per proposal in our database, with ids, codes and times only.
// The content (scores, evidence, reasons, companies, the person's answer) lives in the Partners file's Proposals tab.
import type { IsoDateTime, ProposalKind, ProposalStatus, ProposalTarget } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { AgentActor } from './actor';
import { cleanAgentName } from './agents/context';

/**
 * Who made a proposal (spec 5.3). Through MCP the app's name for the person, with the client id beside it for the record;
 * `agentName` is '' for an app that registered without a name. Through the API the key.
 */
export type ProposalMaker = ({ kind: 'app'; agentName: string; clientId: string } | { kind: 'key'; keyId: string }) & {
  /**
   * A company server's member the agent acts for (plan 15): their own apps and keys. Two members' "Claude" are two
   * agents. Absent on hosted, where the person is the proposal's `userId`.
   */
  personId?: string;
};

/**
 * Who "the same agent" is (spec 5.3): `app:<agentName>` (a reconnected Claude under a new client id is still Claude),
 * `key:<keyId>`, or `client:<clientId>` for an app without a name [builder's call]: two unnamed apps of one person would
 * otherwise share every proposal.
 */
export function makerKey(m: ProposalMaker): string {
  const agent = m.kind === 'key' ? `key:${m.keyId}` : m.agentName === '' ? `client:${m.clientId}` : `app:${m.agentName}`;
  return m.personId === undefined ? agent : `${m.personId}/${agent}`;
}

/**
 * An app as a proposal's maker, from the name it registered with: the name it acts under (`cleanAgentName`), or '' when
 * it gave none. An app that calls itself by the fallback name ("Agent") is known by its client id too: the agent can't
 * tell the two apart, so this errs on keeping apps apart.
 */
export function appMaker(appName: string, clientId: string, personId?: string): ProposalMaker {
  const name = cleanAgentName(appName);
  return { kind: 'app', agentName: name === COPY.AGENT_FALLBACK_NAME ? '' : name, clientId, ...(personId !== undefined ? { personId } : {}) };
}

/** A key as a proposal's maker; on a company server, with its member (plan 15). */
export const keyMaker = (keyId: string, personId?: string): ProposalMaker =>
  ({ kind: 'key', keyId, ...(personId !== undefined ? { personId } : {}) });

/** The maker of an agent's proposals: its app, by name, or its key; on a company server, with the member it acts for. */
export const makerOf = (actor: AgentActor): ProposalMaker =>
  actor.via.kind === 'app' ? appMaker(actor.agentName, actor.via.clientId, actor.member?.personId) : keyMaker(actor.via.keyId, actor.member?.personId);

export interface ProposalEntry extends ProposalTarget {
  id: string;
  /** The person it waits for. */
  userId: string;
  kind: ProposalKind;
  status: ProposalStatus;
  createdAt: IsoDateTime;
  /** When it was answered, withdrawn, replaced or expired (an expired one: its expiry). Null while it waits. */
  answeredAt: IsoDateTime | null;
  expiresAt: IsoDateTime;
  madeBy: ProposalMaker;
  /** The Partners file its content is in. */
  fileId: string;
  /** The app's name, or the key's name (read from api_keys); "Agent" for one without a name. */
  agentName: string;
  /** An on grant of that app name for the person (for an unnamed app: of that client id), or the key not turned off. */
  makerOn: boolean;
}

export interface ProposalIndex {
  /** A new waiting proposal, and the one it replaces set `replaced` (answered at the new one's time): one batch. */
  add(entry: Omit<ProposalEntry, 'status' | 'answeredAt' | 'agentName' | 'makerOn'>, replaces: string | null): Promise<void>;
  /** The person's proposal; another person's id is null, as a missing one. */
  get(userId: string, id: string): Promise<ProposalEntry | null>;
  /** The person's proposals made since `since`, newest first. */
  list(userId: string, filter: { since: IsoDateTime; maker?: ProposalMaker; status?: ProposalStatus; proposalId?: string }): Promise<ProposalEntry[]>;
  /** The maker's waiting proposal of this kind for this target, if any (spec 8: one per target and kind per agent). */
  waiting(userId: string, kind: ProposalKind, target: ProposalTarget, maker: ProposalMaker): Promise<ProposalEntry | null>;
  /** Compare-and-set from waiting: false when it isn't the person's or doesn't wait any more. */
  answer(userId: string, id: string, to: Exclude<ProposalStatus, 'waiting'>, at: IsoDateTime): Promise<boolean>;
  /** The person's waiting proposals of one Partners file (`fileId`) not expired by `now`, in all and by `makerKey`. */
  countWaiting(userId: string, now: IsoDateTime, fileId: string): Promise<{ total: number; byMaker: Record<string, number> }>;
  /** Waiting ones past their expiry become expired, answered at their expiry. How many. */
  expire(now: IsoDateTime): Promise<number>;
  /** Every non-waiting row answered before `answeredBefore` goes. How many. */
  prune(answeredBefore: IsoDateTime): Promise<number>;
  /** Delete account. */
  deleteForUser(userId: string): Promise<void>;
}

/** The same target: the same four ids, empty ones included. */
export const sameTarget = (a: ProposalTarget, b: ProposalTarget): boolean =>
  a.accountId === b.accountId && a.partnerId === b.partnerId && a.marketId === b.marketId && a.hypothesisId === b.hypothesisId;

/** Whether a stored maker is the same agent as `maker` (`makerKey`). */
export const sameMaker = (a: ProposalMaker, b: ProposalMaker): boolean => makerKey(a) === makerKey(b);

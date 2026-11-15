import type { MarketEntity } from './markets/types';
import type { PartnerEntity } from './partners/types';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';
const PREFIX: Record<PartnerEntity | MarketEntity, string> = {
  account: 'a',
  partner: 'p',
  person: 'e',
  call: 'k',
  qualification: 'q',
  marketLink: 'l',
  proposalItem: 'r',
  valuePoint: 'v',
  hypothesis: 'h',
  exclusion: 'x',
  change: 'g',
};

export function randomSuffix(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

export function newId(kind: PartnerEntity | MarketEntity): string {
  return `${PREFIX[kind]}_${randomSuffix()}`;
}

export function newMarketId(): string {
  return `m_${randomSuffix(10)}`;
}

export function newCompanyId(): string {
  return `co_${randomSuffix(10)}`;
}

/** An agent proposal's id (agent proposals spec 7.2): the same on all its items in the Proposals tab and in our index. */
export function newProposalId(): string {
  return `prp_${randomSuffix(10)}`;
}

/** A company server's workspace (plan 15): its one key, never a person's id, so admins can come and go (spec 2026-11-07 §7.2). */
export function newWorkspaceId(): string {
  return `ws_${randomSuffix(10)}`;
}

/** An invite to a company server's workspace (plan 15). */
export function newInviteId(): string {
  return `inv_${randomSuffix(16)}`;
}

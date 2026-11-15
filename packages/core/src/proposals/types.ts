// An agent's proposals (spec 7.1): one row per item in the Partners file's Proposals tab. A 4C proposal has one item per
// letter, a new-partners proposal one per company, every other kind one. Only the proposals commands write these rows.
import type { IsoDateTime } from '../partners/types';

/** The kinds of proposal (owner, 2026-11-04): a step and a stage are one kind. */
export const PROPOSAL_KINDS = ['fourC', 'stage', 'close', 'signed', 'partners', 'hypothesisStatus', 'marketStatus'] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

/** What an item proposes to set: always a desk score, never a confirmed one. `company` is a new partner. */
export const PROPOSAL_FIELDS = [
  'desk.customerBase', 'desk.credibility', 'desk.capability', 'desk.commitment', 'step', 'stage',
  'closed', 'signedDate', 'company', 'hypothesisStatus', 'marketStatus',
] as const;
export type ProposalField = (typeof PROPOSAL_FIELDS)[number];

/** Where an item stands. `not_sent`: its proposal never reached our index, so nobody was shown it. */
export const PROPOSAL_ITEM_STATUSES = ['waiting', 'accepted', 'rejected', 'withdrawn', 'replaced', 'expired', 'not_sent'] as const;
export type ProposalItemStatus = (typeof PROPOSAL_ITEM_STATUSES)[number];

/**
 * One item of a proposal. The target is named by ids (`accountId` to `hypothesisId`, as the Market links tab does) and,
 * for people, by `about`: its name when proposed. `what` and `proposed` say what it would set, `proposed` in the words
 * the screen shows. `details` holds a new partner's import columns, one "Label: value" line each. `targetUpdated` is the
 * target's `updatedAt` when proposed, to tell whether it changed since.
 */
export interface ProposalItem {
  id: string;
  proposalId: string;
  kind: ProposalKind;
  accountId: string | null;
  partnerId: string | null;
  marketId: string | null;
  hypothesisId: string | null;
  about: string;
  what: ProposalField;
  proposed: string;
  details: string;
  evidence: string;
  proposedBy: string;
  status: ProposalItemStatus;
  answerNote: string;
  proposedOn: IsoDateTime;
  answeredOn: IsoDateTime | null;
  expiresOn: IsoDateTime;
  targetUpdated: IsoDateTime | null;
  updatedAt: IsoDateTime | null;
  updatedBy: string;
}

/**
 * Where a whole proposal stands, in our index (spec 7.2): one per proposal. `partly_accepted`: some of its items were
 * accepted, the others rejected. Its items' own statuses sit in the Proposals tab.
 */
export const PROPOSAL_STATUSES = ['waiting', 'accepted', 'partly_accepted', 'rejected', 'withdrawn', 'replaced', 'expired'] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

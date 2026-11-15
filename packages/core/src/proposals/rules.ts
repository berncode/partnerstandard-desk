// "Possible now" (agent proposals design, spec 4): a proposal is checked against the file as it is when it is made, and
// again when its card is shown, with the same pure rules the screens use, so the agent learns at once and the person
// sees why one can't apply any more.
import { FOUR_C, RECRUITMENT_STEPS, type RecruitmentStep } from '@partner-desk/method';
import { COPY, CLOSED_LABELS } from '@partner-desk/copy';
import type { Market } from '../markets/types';
import { checkClose, checkSign, checkStage, checkStep, type RuleResult } from '../partners/lifecycle';
import type { IsoDateTime, Partner, PartnerBook } from '../partners/types';
import { PROPOSAL_EXPIRES_DAYS, type ProposalInput } from './input';

/** What a proposal is checked against: the Partners file, and for a market kind its market and whether it is archived. */
export interface ProposalScene { book: PartnerBook; market: Market | null; archived: boolean }

const OK: RuleResult = { ok: true };
const refuse = (message: string): RuleResult => ({ ok: false, message });
const DAY_MS = 24 * 60 * 60 * 1000;

const isStep = (to: string): to is RecruitmentStep => (RECRUITMENT_STEPS as readonly string[]).includes(to);
const partnerOf = (book: PartnerBook, partnerId: string): Partner | undefined => book.partners.find((p) => p.id === partnerId);
const marketOf = (scene: ProposalScene, marketId: string): Market | null =>
  scene.market !== null && scene.market.info.marketId === marketId ? scene.market : null;

/** The partner kinds' rules, once the partner type is known to be there and not exited. */
function partnerRule(input: Extract<ProposalInput, { partnerId: string }>, p: Partner): RuleResult {
  switch (input.kind) {
    case 'fourC':
      return p.closed !== null ? refuse(COPY.CLOSED_ALREADY(CLOSED_LABELS[p.closed])) : OK;
    case 'stage':
      return isStep(input.to) ? checkStep(p, input.to) : checkStage(p, input.to);
    case 'close':
      if (p.closed !== null) return refuse(COPY.CLOSED_ALREADY(CLOSED_LABELS[p.closed]));
      return checkClose(p, input.reason);
    case 'signed':
      return checkSign(p);
  }
}

/**
 * Whether the proposal could be accepted now, apart from being what is there already: its target is there, the
 * lifecycle allows the move, and the market isn't archived. A refusal says why in the rule's own words.
 */
export function possibleNow(input: ProposalInput, scene: ProposalScene): RuleResult {
  switch (input.kind) {
    case 'fourC': case 'stage': case 'close': case 'signed': {
      if (input.kind === 'stage' && input.to === 'exit') return refuse(COPY.PROPOSAL_NO_EXIT);
      const p = partnerOf(scene.book, input.partnerId);
      if (!p) return refuse(COPY.GONE);
      if (p.exitedDate !== null) return refuse(COPY.ALREADY_EXITED);
      return partnerRule(input, p);
    }
    case 'partners': {
      const market = marketOf(scene, input.marketId);
      if (!market) return refuse(COPY.GONE);
      if (input.hypothesisId !== null && !market.hypotheses.some((h) => h.id === input.hypothesisId)) return refuse(COPY.GONE);
      return scene.archived ? refuse(COPY.PROPOSAL_MARKET_ARCHIVED) : OK;
    }
    case 'hypothesisStatus': {
      const market = marketOf(scene, input.marketId);
      return market && market.hypotheses.some((h) => h.id === input.hypothesisId) ? OK : refuse(COPY.GONE);
    }
    case 'marketStatus': {
      if (!marketOf(scene, input.marketId)) return refuse(COPY.GONE);
      return scene.archived ? refuse(COPY.PROPOSAL_MARKET_ARCHIVED) : OK;
    }
  }
}

/**
 * Whether the target already holds what the proposal sets: every letter's desk score, the step or stage, the
 * hypothesis's or the market's status. Closing and signing have their own lifecycle message instead; new partners are
 * never "already so" here (the import preview marks the known ones).
 */
export function alreadySo(input: ProposalInput, scene: ProposalScene): boolean {
  switch (input.kind) {
    case 'fourC': {
      const p = partnerOf(scene.book, input.partnerId);
      return p !== undefined && FOUR_C.every((c) => input.letters[c] === undefined || p.desk[c] === input.letters[c]!.score);
    }
    case 'stage': {
      const p = partnerOf(scene.book, input.partnerId);
      if (!p) return false;
      return isStep(input.to) ? p.stage === 'recruitment' && p.step === input.to : p.stage === input.to;
    }
    case 'hypothesisStatus':
      return marketOf(scene, input.marketId)?.hypotheses.find((h) => h.id === input.hypothesisId)?.status === input.to;
    case 'marketStatus':
      return marketOf(scene, input.marketId)?.info.status === input.to;
    case 'close': case 'signed': case 'partners':
      return false;
  }
}

/** "Possible now" (spec 4): `possibleNow`, then a proposal equal to what is there is refused too. */
export function checkProposal(input: ProposalInput, scene: ProposalScene): RuleResult {
  const verdict = possibleNow(input, scene);
  if (!verdict.ok) return verdict;
  return alreadySo(input, scene) ? refuse(COPY.PROPOSAL_ALREADY_SO) : OK;
}

/**
 * The target's `updatedAt` as the proposal is made, kept to tell later whether it changed since: the partner type's
 * row, the hypothesis's row or the market's details. Null for new partners (nothing to change since) or a missing target.
 */
export function targetUpdatedAt(input: ProposalInput, scene: ProposalScene): IsoDateTime | null {
  switch (input.kind) {
    case 'fourC': case 'stage': case 'close': case 'signed':
      return partnerOf(scene.book, input.partnerId)?.updatedAt ?? null;
    case 'hypothesisStatus':
      return marketOf(scene, input.marketId)?.hypotheses.find((h) => h.id === input.hypothesisId)?.updatedAt ?? null;
    case 'marketStatus':
      return marketOf(scene, input.marketId)?.info.updatedAt ?? null;
    case 'partners':
      return null;
  }
}

/** When a proposal made at `createdAt` expires unanswered: 30 days later, to the millisecond. */
export function expiresAt(createdAt: IsoDateTime): IsoDateTime {
  return new Date(Date.parse(createdAt) + PROPOSAL_EXPIRES_DAYS * DAY_MS).toISOString();
}

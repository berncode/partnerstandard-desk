// The propose tools (agent proposals spec 6.1, 6.2): at the level "Read, change and propose", an agent proposes a
// decision and withdraws one of its own that waits. Each runs `createProposal` or `withdrawProposal`: nothing changes
// before the person accepts it in PartnerStandard Desk. Always the desk check: no tool has a field for the confirmed check.
import {
  CLOSED_AS, HYPOTHESIS_STATUSES, isoDateSchema, MARKET_STATUSES, PROPOSAL_MAX_COMPANIES, PROPOSAL_STAGES, PROPOSAL_TEXT_MAX,
  proposalLettersSchema, proposedCompanySchema,
} from '@partner-desk/core';
import { RECRUITMENT_STEPS } from '@partner-desk/method';
import { z } from 'zod';
import { createProposal, withdrawProposal, type ProposalMade } from '../proposals';
import { ok, type CommandResult } from '../result';
import type { AgentContext } from './context';
import type { AgentTool } from './tools';

/** Types each tool's input and output, and keeps its own type out of the registry's list. */
const tool = <I, O>(t: AgentTool<I, O>): AgentTool => t as unknown as AgentTool;

const id = z.string().min(1).max(64);
/** The target's `updatedAt` as the agent read it (null for one never saved in PartnerStandard Desk). */
const readAt = (what: string) => z.string().max(40).nullable().describe(`The updatedAt of ${what}, as you read it.`);
const reason = z.string().trim().min(1).max(PROPOSAL_TEXT_MAX).describe('Why you propose it, for the person: at most 2,000 characters.');

/** What an agent hears back (spec 6.1): the id, the status and the line to pass on; for new partners, the ones known. */
export type ProposeAnswer = Pick<ProposalMade, 'proposalId' | 'status' | 'message' | 'alreadyPartners'>;

/** One proposal through `createProposal`, for the agent's own company. */
async function propose(ctx: AgentContext, proposal: Record<string, unknown>): Promise<CommandResult<ProposeAnswer>> {
  const made = await createProposal(ctx.deps, ctx.actor, { companyId: ctx.companyId, proposal });
  if (!made.ok) return made;
  const { proposalId, status, message, alreadyPartners } = made.value;
  return ok({ proposalId, status, message, ...(alreadyPartners ? { alreadyPartners } : {}) });
}

const AFTER = 'The person accepts or rejects it in PartnerStandard Desk; nothing changes before. A new proposal of yours for the same '
  + 'target replaces your waiting one.';

export const PROPOSE_TOOLS: readonly AgentTool[] = [
  tool({
    name: 'propose_4c_scores', title: 'Propose 4C scores', level: 'propose', rest: { method: 'POST', path: '/proposals/4c-scores' },
    description: 'Proposes desk check 4C scores for one partner type, each letter with a score from 0 to 3 and its evidence, for example '
      + 'from a web search or from a call\'s notes. The person accepts or rejects each letter in PartnerStandard Desk. The confirmed check is the '
      + 'person\'s own; this tool never changes it.',
    input: z.object({
      partnerId: id, expectedUpdatedAt: readAt('the partner type'),
      letters: proposalLettersSchema.describe('One to four of customerBase, credibility, capability and commitment, each { score: 0 to 3, evidence }. '
        + 'Send every letter in one proposal.'),
    }).strict(),
    run: (ctx, input) => propose(ctx, { kind: 'fourC', ...input }),
  }),
  tool({
    name: 'propose_stage', title: 'Propose a stage', level: 'propose', rest: { method: 'POST', path: '/proposals/stage' },
    description: 'Proposes moving one partner type to another step in Recruitment (researched, discovery_call, qualification, map) '
      + 'or, once signed, to another stage up to Expansion (onboarding, growth, expansion). Moving into Exit is the person\'s alone. '
      + AFTER,
    input: z.object({
      partnerId: id, expectedUpdatedAt: readAt('the partner type'), to: z.enum([...RECRUITMENT_STEPS, ...PROPOSAL_STAGES]), reason,
    }).strict(),
    run: (ctx, input) => propose(ctx, { kind: 'stage', ...input }),
  }),
  tool({
    name: 'propose_close', title: 'Propose closing a partner', level: 'propose', rest: { method: 'POST', path: '/proposals/close' },
    description: 'Proposes closing one partner type before signing, as not_now or no, with your reason. ' + AFTER,
    input: z.object({ partnerId: id, expectedUpdatedAt: readAt('the partner type'), as: z.enum(CLOSED_AS), reason }).strict(),
    run: (ctx, input) => propose(ctx, { kind: 'close', ...input }),
  }),
  tool({
    name: 'propose_signed', title: 'Propose signing', level: 'propose', rest: { method: 'POST', path: '/proposals/signed' },
    description: 'Proposes marking one partner type signed, with the date it was signed (YYYY-MM-DD). ' + AFTER,
    input: z.object({ partnerId: id, expectedUpdatedAt: readAt('the partner type'), signedDate: isoDateSchema, reason }).strict(),
    run: (ctx, input) => propose(ctx, { kind: 'signed', ...input }),
  }),
  tool({
    name: 'propose_partners', title: 'Propose new partners', level: 'propose', rest: { method: 'POST', path: '/proposals/partners' },
    description: 'Proposes 1 to 50 companies as new partners for one market (marketId from list_markets), and a partner hypothesis '
      + 'of it if you name one, each company with the import table\'s columns. alreadyPartners in the answer lists, by their place '
      + 'in companies (0 first), the ones that are partners already. The person picks which to add in PartnerStandard Desk; nothing is added '
      + 'before. A new proposal of yours for the same market and hypothesis replaces your waiting one: send the whole list.',
    input: z.object({
      marketId: id, hypothesisId: id.nullable().optional().describe('A partner hypothesis of the market, from get_market. Leave out, or null, for none.'),
      companies: z.array(proposedCompanySchema).min(1).max(PROPOSAL_MAX_COMPANIES), reason,
    }).strict(),
    run: (ctx, input) => propose(ctx, { kind: 'partners', ...input, hypothesisId: input.hypothesisId ?? null }),
  }),
  tool({
    name: 'propose_hypothesis_status', title: 'Propose a hypothesis status', level: 'propose',
    rest: { method: 'POST', path: '/proposals/hypothesis-status' },
    description: 'Proposes a partner hypothesis\'s status (draft, holds or dropped), with your reason. ' + AFTER,
    input: z.object({
      marketId: id, hypothesisId: id, expectedUpdatedAt: readAt('the partner hypothesis'), to: z.enum(HYPOTHESIS_STATUSES), reason,
    }).strict(),
    run: (ctx, input) => propose(ctx, { kind: 'hypothesisStatus', ...input }),
  }),
  tool({
    name: 'propose_market_status', title: 'Propose a market status', level: 'propose',
    rest: { method: 'POST', path: '/proposals/market-status' },
    description: 'Proposes a market\'s status (open, validated, partly_validated or invalidated) with its status note, and your '
      + 'reason. ' + AFTER,
    input: z.object({
      marketId: id, expectedUpdatedAt: readAt('the market\'s info'), to: z.enum(MARKET_STATUSES),
      note: z.string().max(PROPOSAL_TEXT_MAX).describe('The status note the market would show. Empty keeps the person\'s note.'), reason,
    }).strict(),
    run: (ctx, input) => propose(ctx, { kind: 'marketStatus', ...input }),
  }),
  tool({
    name: 'withdraw_proposal', title: 'Withdraw a proposal', level: 'propose',
    rest: { method: 'POST', path: '/proposals/{proposalId}/withdraw' },
    description: 'Takes back one of your own proposals while it waits (proposalId from list_proposals). One the person answered '
      + 'can\'t be withdrawn.',
    input: z.object({ proposalId: id }).strict(),
    run: (ctx, input) => withdrawProposal(ctx.deps, ctx.actor, { companyId: ctx.companyId, proposalId: input.proposalId }),
  }),
];

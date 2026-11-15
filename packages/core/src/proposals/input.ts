// What an agent may propose (agent proposals design, spec 4 and 6.1): the input of each kind, and its target.
import { z } from 'zod';
import { FOUR_C, RECRUITMENT_STEPS, type FourC, type RecruitmentStep } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { HYPOTHESIS_STATUSES, MARKET_STATUSES, type HypothesisStatus, type MarketStatus } from '../markets/types';
import { CLOSED_AS, type ClosedAs, type IsoDate, type IsoDateTime, type PartnerBook, type Score } from '../partners/types';
import { isoDateSchema } from '../shared/schemas';

/** A proposal nobody answers expires this many days after it is made (owner, 2026-11-04). */
export const PROPOSAL_EXPIRES_DAYS = 30;
/** An answered or expired proposal's card stays on its page this many days. */
export const PROPOSAL_SHOWN_AFTER_DAYS = 30;
/** Answered index rows go after this many days; the Proposals tab keeps its rows. */
export const PROPOSAL_INDEX_KEEP_DAYS = 90;
/** The most characters of a reason, a letter's evidence, a market status note, an answer note or a company's column. */
export const PROPOSAL_TEXT_MAX = 2000;
/** The most companies in one new partners proposal. */
export const PROPOSAL_MAX_COMPANIES = 50;

/** The stages a partner type may be proposed into after signing. Exit passes the schema so the rule refuses it in words. */
export const PROPOSAL_STAGES = ['onboarding', 'growth', 'expansion', 'exit'] as const;
export type ProposalStageTo = RecruitmentStep | (typeof PROPOSAL_STAGES)[number];

/** One company of a new partners proposal: the import table's columns, as plain text (the preview reads them). */
export interface ProposedCompany {
  company: string;
  website: string;
  country: string;
  vertical: string;
  subVertical: string;
  partnerType: string;
  targetCustomerType: string;
  whyItFits: string;
  sourceDetail: string;
}

type PartnerTarget = { partnerId: string; expectedUpdatedAt: IsoDateTime | null };

export type ProposalInput =
  | (PartnerTarget & { kind: 'fourC'; letters: Partial<Record<FourC, { score: Score; evidence: string }>> })
  | (PartnerTarget & { kind: 'stage'; to: ProposalStageTo; reason: string })
  | (PartnerTarget & { kind: 'close'; as: ClosedAs; reason: string })
  | (PartnerTarget & { kind: 'signed'; signedDate: IsoDate; reason: string })
  | { kind: 'partners'; marketId: string; hypothesisId: string | null; companies: ProposedCompany[]; reason: string }
  | { kind: 'hypothesisStatus'; marketId: string; hypothesisId: string; expectedUpdatedAt: IsoDateTime | null; to: HypothesisStatus; reason: string }
  | { kind: 'marketStatus'; marketId: string; expectedUpdatedAt: IsoDateTime | null; to: MarketStatus; note: string; reason: string };

const id = z.string().min(1).max(64);
const expectedUpdatedAt = z.string().max(40).nullable();
const text = z.string().max(PROPOSAL_TEXT_MAX);
/** A reason or evidence: something to say, at most 2,000 characters. */
const said = z.string().trim().min(1).max(PROPOSAL_TEXT_MAX);
const column = text.default('');

export const proposedCompanySchema: z.ZodType<ProposedCompany> = z.object({
  company: said,
  website: column, country: column, vertical: column, subVertical: column, partnerType: column, targetCustomerType: column,
  whyItFits: column, sourceDetail: column,
}).strict();

/** Always the desk check: there is no field for the confirmed check, and the objects refuse any field they don't name. */
const letter = z.object({ score: z.literal([0, 1, 2, 3]), evidence: said }).strict();
/** One to four letters, each a desk score and its evidence. The agent tool takes this schema as it is (agent proposals task 9). */
export const proposalLettersSchema = z.object(Object.fromEntries(FOUR_C.map((c) => [c, letter.optional()])) as Record<FourC, z.ZodOptional<typeof letter>>)
  .strict()
  .refine((value) => Object.values(value).some((v) => v !== undefined), { message: COPY.PROPOSAL_NO_LETTER });

export const proposalInputSchema: z.ZodType<ProposalInput> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('fourC'), partnerId: id, expectedUpdatedAt, letters: proposalLettersSchema }).strict(),
  z.object({ kind: z.literal('stage'), partnerId: id, expectedUpdatedAt, to: z.enum([...RECRUITMENT_STEPS, ...PROPOSAL_STAGES]), reason: said }).strict(),
  z.object({ kind: z.literal('close'), partnerId: id, expectedUpdatedAt, as: z.enum(CLOSED_AS), reason: said }).strict(),
  z.object({ kind: z.literal('signed'), partnerId: id, expectedUpdatedAt, signedDate: isoDateSchema, reason: said }).strict(),
  z.object({
    kind: z.literal('partners'), marketId: id, hypothesisId: id.nullable(),
    companies: z.array(proposedCompanySchema).min(1).max(PROPOSAL_MAX_COMPANIES), reason: said,
  }).strict(),
  z.object({
    kind: z.literal('hypothesisStatus'), marketId: id, hypothesisId: id, expectedUpdatedAt, to: z.enum(HYPOTHESIS_STATUSES), reason: said,
  }).strict(),
  z.object({
    kind: z.literal('marketStatus'), marketId: id, expectedUpdatedAt, to: z.enum(MARKET_STATUSES), note: text, reason: said,
  }).strict(),
]);

/** What a proposal is about, by ids (as the Market links tab names them): the ones its kind has, the others null. */
export interface ProposalTarget { accountId: string | null; partnerId: string | null; marketId: string | null; hypothesisId: string | null }

export function targetOf(input: ProposalInput, book: PartnerBook): ProposalTarget {
  switch (input.kind) {
    case 'fourC': case 'stage': case 'close': case 'signed': {
      const accountId = book.partners.find((p) => p.id === input.partnerId)?.accountId ?? null;
      return { accountId, partnerId: input.partnerId, marketId: null, hypothesisId: null };
    }
    case 'partners': case 'hypothesisStatus':
      return { accountId: null, partnerId: null, marketId: input.marketId, hypothesisId: input.hypothesisId };
    case 'marketStatus':
      return { accountId: null, partnerId: null, marketId: input.marketId, hypothesisId: null };
  }
}

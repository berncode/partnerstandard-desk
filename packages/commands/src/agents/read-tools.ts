// The read tools (spec 5.1): each runs one read command with the agent's own company, and answers what it returns.
import {
  PROPOSAL_STATUSES, type ClosedAs, type Health, type IsoDate, type IsoDateTime, type PartnerBook, type ProposalKind, type ProposalStatus,
  type ThisWeek,
} from '@partner-desk/core';
import { PARTNER_TYPES, STAGES, type PartnerType, type RecruitmentStep, type Stage } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { listCases, readCase, type CaseRead } from '../cases';
import { listMaps, readMap, type MapRead } from '../maps';
import { listMarkets, readMarket } from '../markets';
import { readPartners } from '../partners';
import { listPrograms, readCompanyFacts, readProgram } from '../programs';
import { countProposals, listProposals } from '../proposals';
import { ok, type CommandResult } from '../result';
import { listReviews, readReview, type ReviewLine } from '../reviews';
import { readThisWeek } from '../this-week';
import type { AgentContext } from './context';
import { page } from './paging';
import type { AgentTool } from './tools';

/** The commands' id pattern. */
const id = z.string().min(1).max(64);
/** 50 a page unless the agent asks for up to 100 (spec 5.1, 6.1) [builder's call]. */
const PAGE_SIZE = 50;
const paging = {
  cursor: z.string().max(64).optional().describe('nextCursor from the previous page. Leave out for the first page.'),
  limit: z.number().int().min(1).max(100).optional().describe('Items per page, 1 to 100. 50 when left out.'),
};

/** One page of a list, and the cursor for the next (null on the last page). */
export interface Page<T> { items: T[]; nextCursor: string | null }

/** One row of `list_partners`: a partner type of an account, with what the Partners list shows of it. */
export interface PartnerRow {
  accountId: string;
  partnerId: string;
  /** The account's company name. */
  name: string;
  partnerType: PartnerType;
  stage: Stage;
  step: RecruitmentStep | null;
  /** Closed in recruitment ("not now" or "no"), or null. */
  closed: ClosedAs | null;
  /** The MAP's health, as the partner row last copied it; null without a MAP. */
  mapHealth: Health | null;
  /** The MAP's next milestone date, as the partner row last copied it; null without one. */
  nextDate: IsoDate | null;
}

/** What `get_partner` can read besides the Partners file, when asked (question 22): each one opens more files. */
export const PARTNER_INCLUDES = ['map', 'cases', 'reviews'] as const;
export type PartnerInclude = (typeof PARTNER_INCLUDES)[number];

/**
 * One account as `get_partner` answers it: the account and everything the Partners file holds for it, and what
 * `include` asked for. A file that can't be read answers its own failure in its item's `read`; the rest still comes.
 */
export interface PartnerAccountRead {
  account: PartnerBook['accounts'][number];
  /** Its partner types (one section each): stage, step, signing, 4C scores, program and MAP summary. */
  partners: PartnerBook['partners'];
  people: PartnerBook['people'];
  calls: PartnerBook['calls'];
  /** The 4C notes and the recruitment questions, one per partner type. */
  qualifications: PartnerBook['qualifications'];
  marketLinks: PartnerBook['marketLinks'];
  /** With include map: each of its partner types that has a MAP, as `get_map` answers it. */
  maps?: Array<{ partnerId: string; mapId: string; read: CommandResult<MapRead> }>;
  /** With include cases: its partner types' business cases, the 20 newest first, each as `get_case` answers it. */
  cases?: Array<{ partnerId: string; caseId: string; read: CommandResult<CaseRead> }>;
  /** With include cases, only when it has more than 20: true, and `list_cases` with a partnerId lists the rest. */
  casesTruncated?: true;
  /** With include reviews: for each partner type with a MAP, its next review and its held ones, as `list_reviews` lists them. */
  reviews?: Array<{ partnerId: string; read: CommandResult<ReviewLine[]> }>;
}

const NO_ACCOUNT = { ok: false as const, error: 'not_found' as const, message: COPY.GONE };

/**
 * One row of `list_proposals` (agent proposals spec 6.2): what our index keeps of a proposal, by ids and dates, and for
 * an answered one the person's note, read from the Proposals tab (null when there is none, or it isn't answered).
 */
export interface ProposalRow {
  proposalId: string;
  kind: ProposalKind;
  status: ProposalStatus;
  accountId: string | null;
  partnerId: string | null;
  marketId: string | null;
  hypothesisId: string | null;
  createdAt: IsoDateTime;
  answeredAt: IsoDateTime | null;
  expiresAt: IsoDateTime;
  answerNote: string | null;
}

/** The statuses a person's answer gives, whose note `list_proposals` reads. */
const ANSWERED: readonly ProposalStatus[] = ['accepted', 'partly_accepted', 'rejected'];

/** This week, and how many proposals wait for the person (all agents together), for a "Weekly review" prompt. */
export type ThisWeekRead = ThisWeek & { proposalsWaiting: number };

/** A command's list, paged; a refusal passes through as it is. */
function paged<T>(result: CommandResult<T[]>, input: { cursor?: string | undefined; limit?: number | undefined }): CommandResult<Page<T>> {
  return result.ok ? ok(page(result.value, input.cursor, input.limit ?? PAGE_SIZE)) : result;
}

function toRows(book: PartnerBook): PartnerRow[] {
  const names = new Map(book.accounts.map((a) => [a.id, a.company]));
  return book.partners.map((p) => ({
    accountId: p.accountId, partnerId: p.id, name: names.get(p.accountId) ?? '', partnerType: p.partnerType, stage: p.stage,
    step: p.step, closed: p.closed, mapHealth: p.mapHealth, nextDate: p.mapNextMilestone,
  }));
}

/** The most cases `get_partner` reads in one call [builder's call]: each is one file. */
export const MAX_INCLUDED_CASES = 20;

/** Newest first, by when the case was made; a tie keeps its order. */
const newestFirst = (a: { createdAt: string }, b: { createdAt: string }) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0);

/**
 * What `get_partner`'s include asked for, for the account's partner types, through the same commands the agent would
 * call one by one (each checks access and records its own event). One after the other, as they share the person's
 * Google budget; each asked once however often it is named. The account's MAPs come from `listMaps` (the person's own
 * only), its cases from `listCases`, the 20 newest. A file that can't be read is its own item's failure; a list the
 * commands refuse refuses the call.
 */
async function included(
  ctx: AgentContext, partnerIds: string[], include: ReadonlySet<PartnerInclude>,
): Promise<CommandResult<Pick<PartnerAccountRead, 'maps' | 'cases' | 'casesTruncated' | 'reviews'>>> {
  const answer: Pick<PartnerAccountRead, 'maps' | 'cases' | 'casesTruncated' | 'reviews'> = {};
  const { deps, actor, companyId } = ctx;
  const ours = new Set(partnerIds);
  const withMap: Array<{ partnerId: string; mapId: string }> = [];
  if (include.has('map') || include.has('reviews')) {
    const list = await listMaps(deps, actor, { companyId });
    if (!list.ok) return list;
    for (const { partnerId, mapId } of list.value) if (ours.has(partnerId)) withMap.push({ partnerId, mapId });
  }
  if (include.has('map')) {
    const maps: NonNullable<PartnerAccountRead['maps']> = [];
    for (const m of withMap) maps.push({ ...m, read: await readMap(deps, actor, { mapId: m.mapId }) });
    answer.maps = maps;
  }
  if (include.has('cases')) {
    const listed: Array<{ partnerId: string; caseId: string; createdAt: string }> = [];
    for (const partnerId of partnerIds) {
      const list = await listCases(deps, actor, { companyId, partnerId });
      if (!list.ok) return list;
      listed.push(...list.value);
    }
    const cases: NonNullable<PartnerAccountRead['cases']> = [];
    for (const { partnerId, caseId } of listed.sort(newestFirst).slice(0, MAX_INCLUDED_CASES)) {
      cases.push({ partnerId, caseId, read: await readCase(deps, actor, { caseId }) });
    }
    answer.cases = cases;
    if (listed.length > MAX_INCLUDED_CASES) answer.casesTruncated = true;
  }
  if (include.has('reviews')) {
    const reviews: NonNullable<PartnerAccountRead['reviews']> = [];
    for (const { partnerId } of withMap) reviews.push({ partnerId, read: await listReviews(deps, actor, { companyId, partnerId }) });
    answer.reviews = reviews;
  }
  return ok(answer);
}

/** Types each tool's input and output, and keeps its own type out of the registry's list. */
const tool = <I, O>(t: AgentTool<I, O>): AgentTool => t as unknown as AgentTool;

const companyOnly = (ctx: AgentContext) => ({ companyId: ctx.companyId });
/** The partner filter as the list commands take it: left out when not given (their schemas are strict). */
const partnerOf = (input: { partnerId?: string | undefined }) => (input.partnerId === undefined ? {} : { partnerId: input.partnerId });

export const READ_TOOLS: readonly AgentTool[] = [
  tool({
    name: 'this_week', title: 'This week', level: 'read', rest: { method: 'GET', path: '/this-week' },
    description: 'What needs the partner manager this week: business reviews coming up, partnerships that need attention, '
      + 'MAP activities due, and partners waiting in recruitment. Each item has its mapId or partnerId for get_map or list_partners. '
      + 'proposalsWaiting counts the proposals, from all agents, that wait for the person.',
    input: z.object({}).strict(),
    run: async (ctx): Promise<CommandResult<ThisWeekRead>> => {
      const week = await readThisWeek(ctx.deps, ctx.actor, companyOnly(ctx));
      if (!week.ok) return week;
      const waiting = await countProposals(ctx.deps, ctx.actor);
      if (!waiting.ok) return waiting;
      // The person's proposal cards are the screen's; an agent reads its own through list_proposals.
      const { reviews, needYou, due, waiting: inRecruitment } = week.value;
      return ok({ reviews, needYou, due, waiting: inRecruitment, proposalsWaiting: waiting.value.total });
    },
  }),
  tool({
    name: 'list_partners', title: 'List partners', level: 'read', rest: { method: 'GET', path: '/partners' },
    description: 'The partners, one row per partner type of a company: accountId, partnerId, name, partner type, stage, step, '
      + 'MAP health and next date. Filter by stage, partnerType or marketId. Paged: pass nextCursor as cursor. '
      + 'Use get_partner with the accountId for the details.',
    input: z.object({
      stage: z.enum(STAGES).optional(), partnerType: z.enum(PARTNER_TYPES).optional(), marketId: id.optional(), ...paging,
    }).strict(),
    run: async (ctx, input) => {
      const read = await readPartners(ctx.deps, ctx.actor, companyOnly(ctx));
      if (!read.ok) return read;
      const book = read.value.value;
      const inMarket = input.marketId === undefined
        ? null
        : new Set(book.marketLinks.filter((l) => l.marketId === input.marketId).map((l) => l.partnerId));
      const rows = toRows(book).filter((r) => (input.stage === undefined || r.stage === input.stage)
        && (input.partnerType === undefined || r.partnerType === input.partnerType)
        && (inMarket === null || inMarket.has(r.partnerId)));
      return ok(page(rows, input.cursor, input.limit ?? PAGE_SIZE));
    },
  }),
  tool({
    name: 'get_partner', title: 'Get a partner', level: 'read', rest: { method: 'GET', path: '/partners/{accountId}' },
    description: 'One partner company by accountId: its facts, its partner types (stage, step, signing, 4C scores, MAP health), '
      + 'people, calls, 4C notes and market links. Add include to read its MAP, business cases or reviews in the same call; '
      + 'each one opens more files, so ask only for what you need.',
    input: z.object({
      accountId: id,
      include: z.array(z.enum(PARTNER_INCLUDES)).min(1).max(3).optional()
        .describe('What else to read: map, cases, reviews. In a URL, repeat it or separate with commas, for example include=map,cases. '
          + 'Cases are the 20 newest; when there are more, casesTruncated is true and list_cases gives the rest.'),
    }).strict(),
    run: async (ctx, input): Promise<CommandResult<PartnerAccountRead>> => {
      const read = await readPartners(ctx.deps, ctx.actor, companyOnly(ctx));
      if (!read.ok) return read;
      const book = read.value.value;
      const account = book.accounts.find((a) => a.id === input.accountId);
      if (!account) return NO_ACCOUNT;
      const partners = book.partners.filter((p) => p.accountId === account.id);
      const ids = new Set(partners.map((p) => p.id));
      const extra = await included(ctx, partners.map((p) => p.id), new Set(input.include ?? []));
      if (!extra.ok) return extra;
      return ok({
        account, partners,
        people: book.people.filter((p) => p.accountId === account.id),
        calls: book.calls.filter((c) => ids.has(c.partnerId)),
        qualifications: book.qualifications.filter((q) => ids.has(q.partnerId)),
        marketLinks: book.marketLinks.filter((l) => ids.has(l.partnerId)),
        ...extra.value,
      });
    },
  }),
  tool({
    name: 'list_markets', title: 'List markets', level: 'read', rest: { method: 'GET', path: '/markets' },
    description: 'The markets, archived ones flagged. Paged: pass nextCursor as cursor. Use get_market with a marketId for one.',
    input: z.object(paging).strict(),
    run: async (ctx, input) => paged(await listMarkets(ctx.deps, ctx.actor, companyOnly(ctx)), input),
  }),
  tool({
    name: 'get_market', title: 'Get a market', level: 'read', rest: { method: 'GET', path: '/markets/{marketId}' },
    description: 'One market by marketId: its texts, value points, partner hypotheses, exclusions and recorded changes.',
    input: z.object({ marketId: id }).strict(),
    run: (ctx, input) => readMarket(ctx.deps, ctx.actor, input),
  }),
  tool({
    name: 'list_programs', title: 'List programs', level: 'read', rest: { method: 'GET', path: '/programs' },
    description: 'The partner programs, each with its programId and partner type. Paged: pass nextCursor as cursor. '
      + 'Use get_program for one.',
    input: z.object(paging).strict(),
    run: async (ctx, input) => paged(await listPrograms(ctx.deps, ctx.actor, companyOnly(ctx)), input),
  }),
  tool({
    name: 'get_program', title: 'Get a program', level: 'read', rest: { method: 'GET', path: '/programs/{programId}' },
    description: 'One partner program by programId: its levels, benefits, requirements and costs.',
    input: z.object({ programId: id }).strict(),
    run: (ctx, input) => readProgram(ctx.deps, ctx.actor, input),
  }),
  tool({
    name: 'get_company_facts', title: 'Get company facts', level: 'read', rest: { method: 'GET', path: '/company-facts' },
    description: 'The facts about our own company that business cases and programs use.',
    input: z.object({}).strict(),
    run: (ctx) => readCompanyFacts(ctx.deps, ctx.actor, companyOnly(ctx)),
  }),
  tool({
    name: 'list_cases', title: 'List business cases', level: 'read', rest: { method: 'GET', path: '/cases' },
    description: 'The business cases, newest first, each with its caseId and partnerId. Give a partnerId for one partner type\'s '
      + 'cases. Paged: pass nextCursor as cursor. Use get_case for one.',
    input: z.object({ partnerId: id.optional(), ...paging }).strict(),
    run: async (ctx, input) => paged(await listCases(ctx.deps, ctx.actor, { ...companyOnly(ctx), ...partnerOf(input) }), input),
  }),
  tool({
    name: 'get_case', title: 'Get a business case', level: 'read', rest: { method: 'GET', path: '/cases/{caseId}' },
    description: 'One business case by caseId, with what the partner gets and what we get.',
    input: z.object({ caseId: id }).strict(),
    run: (ctx, input) => readCase(ctx.deps, ctx.actor, input),
  }),
  tool({
    name: 'list_maps', title: 'List MAPs', level: 'read', rest: { method: 'GET', path: '/maps' },
    description: 'The Mutual Action Plans, each with its mapId, partnerId, stage, health and next milestone. Give a partnerId '
      + 'for one partner type\'s MAP. Paged: pass nextCursor as cursor. Use get_map for one.',
    input: z.object({ partnerId: id.optional(), ...paging }).strict(),
    run: async (ctx, input) => paged(await listMaps(ctx.deps, ctx.actor, { ...companyOnly(ctx), ...partnerOf(input) }), input),
  }),
  tool({
    name: 'get_map', title: 'Get a MAP', level: 'read', rest: { method: 'GET', path: '/maps/{mapId}' },
    description: 'One Mutual Action Plan by mapId: objectives, activities, milestones, people on both sides, and its horizons. '
      + 'Activity and milestone ids are for the change tools.',
    input: z.object({ mapId: id }).strict(),
    run: (ctx, input) => readMap(ctx.deps, ctx.actor, input),
  }),
  tool({
    name: 'list_reviews', title: 'List business reviews', level: 'read', rest: { method: 'GET', path: '/reviews' },
    description: 'Each MAP\'s next business review and its held ones, by date, with mapId and reviewId (null before the prep '
      + 'starts). Paged: pass nextCursor as cursor. Use get_review with the mapId '
      + 'for the coming one, or with both ids for a held one.',
    input: z.object(paging).strict(),
    run: async (ctx, input) => paged(await listReviews(ctx.deps, ctx.actor, companyOnly(ctx)), input),
  }),
  tool({
    name: 'get_review', title: 'Get a business review', level: 'read', rest: { method: 'GET', path: '/reviews/{mapId}' },
    description: 'One business review of a MAP by mapId: its status, prep, scorecard numbers, blockers and commitments, and the '
      + 'horizon\'s work. Leave out reviewId for the coming review (review is null before its prep starts); give a reviewId '
      + 'from list_reviews for a held one.',
    input: z.object({ mapId: id, reviewId: id.optional() }).strict(),
    run: (ctx, input) => readReview(ctx.deps, ctx.actor, input.reviewId === undefined ? { mapId: input.mapId } : input),
  }),
  tool({
    name: 'list_proposals', title: 'List your proposals', level: 'read', rest: { method: 'GET', path: '/proposals' },
    description: 'Your own proposals of the last 90 days, newest first: proposalId, kind, the ids of what it is about, status '
      + '(waiting, accepted, partly_accepted, rejected, withdrawn, replaced or expired), when it was made, answered and expires, '
      + 'and the person\'s note when they gave one. Filter by status, or give a proposalId for one. Paged: pass nextCursor as cursor. '
      + 'Read it before you propose again.',
    input: z.object({ status: z.enum(PROPOSAL_STATUSES).optional(), proposalId: id.optional(), ...paging }).strict(),
    run: async (ctx, input): Promise<CommandResult<Page<ProposalRow>>> => {
      const list = await listProposals(ctx.deps, ctx.actor, {
        ...(input.status !== undefined ? { status: input.status } : {}), ...(input.proposalId !== undefined ? { proposalId: input.proposalId } : {}),
      });
      if (!list.ok) return list;
      const { items, nextCursor } = page(list.value, input.cursor, input.limit ?? PAGE_SIZE);
      // The notes are in the Proposals tab: one read of the Partners file, only when an answered one is on this page.
      const notes = new Map<string, string>();
      if (items.some((e) => ANSWERED.includes(e.status))) {
        const read = await readPartners(ctx.deps, ctx.actor, companyOnly(ctx));
        if (!read.ok) return read;
        for (const item of read.value.value.proposalItems) {
          if (item.answerNote.trim() !== '' && !notes.has(item.proposalId)) notes.set(item.proposalId, item.answerNote);
        }
      }
      return ok({
        nextCursor,
        items: items.map((e) => ({
          proposalId: e.id, kind: e.kind, status: e.status, accountId: e.accountId, partnerId: e.partnerId, marketId: e.marketId,
          hypothesisId: e.hypothesisId, createdAt: e.createdAt, answeredAt: e.answeredAt, expiresAt: e.expiresAt,
          answerNote: ANSWERED.includes(e.status) ? notes.get(e.id) ?? null : null,
        })),
      });
    },
  }),
];

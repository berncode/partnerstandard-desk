// The change tools (spec 5.2): small changes at the level "Read and change", each made through the commands as the
// screens make it. No tool offers a decision: a stage, a step, signing, closing, exit, 4C scores, an import, a
// hypothesis's or a market's status, sharing or deleting (spec 5.3, 13 questions 2 and 3). Their strict schemas refuse
// those fields, so an agent's input never reaches a command with one, whatever `can` would allow.
import {
  ACTIVITY_SIDES, ACTIVITY_STATUSES, ACTIVITY_TITLE_MAX, CALL_KINDS, CASE_SOURCES, CATEGORIES, caseSchema, companyFactsSchema,
  HOW_MARKET_BUYS, isoDateSchema, PERSON_ROLES, SCORE_KEYS, sortNotes, TARGET_CUSTOMER_TYPES, TEXT_MAX,
  type Activity, type CaseSource, type Call, type Hypothesis, type MapChange, type MarketInfo, type Milestone, type PartnerBook,
  type PartnerChange, type ScoreKey,
} from '@partner-desk/core';
import { PARTNER_TYPES, TOPICS, type Topic } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { readCase, saveCase } from '../cases';
import { changeMap } from '../maps';
import { changeMarket } from '../markets';
import { changePartner, readPartners } from '../partners';
import { readCompanyFacts, saveCompanyFacts } from '../programs';
import { ok, type CommandResult, type Failure } from '../result';
import { openReview, readReview } from '../reviews';
import type { AgentContext } from './context';
import type { AgentTool } from './tools';

/** Types each tool's input and output, and keeps its own type out of the registry's list. */
const tool = <I, O>(t: AgentTool<I, O>): AgentTool => t as unknown as AgentTool;

const id = z.string().min(1).max(64);
const text = z.string().max(TEXT_MAX);
const named = z.string().min(1).max(TEXT_MAX);
const date = isoDateSchema.nullable();
/** The row's `updatedAt` as the agent read it (null for a row never saved in PartnerStandard Desk): required on every update. */
const readAt = z.string().max(40).nullable().describe('The updatedAt of what you change, as you read it.');
/** A whole-record save's `updatedAt` as read. */
const savedAt = z.string().max(40).describe('The updatedAt of what you change, as you read it.');

const NOT_THERE: Failure = { ok: false, error: 'not_found', message: COPY.GONE };
const nothing = { message: COPY.AGENT_NOTHING_TO_CHANGE };

/** True when the object sets a field besides `ids`. */
const setsSomething = (ids: readonly string[]) => (o: object): boolean =>
  Object.entries(o).some(([key, v]) => !ids.includes(key) && v !== undefined);

/** The fields given, without `omit`: a field left out stays as it is. */
function given(o: object, omit: readonly string[] = []): Record<string, unknown> {
  return Object.fromEntries(Object.entries(o).filter(([key, v]) => v !== undefined && !omit.includes(key)));
}

/** A conflict tells the agent to read again (spec 5.2): the commands' words are for a person looking at a screen. */
function forAgent<T>(result: CommandResult<T>): CommandResult<T> {
  return result.ok || result.error !== 'conflict' ? result : { ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT };
}

/**
 * Runs changes one after another, each its own write [builder's call]. The first refusal stops the rest and is the
 * answer; when some were saved before it, the answer says how many. A change that throws (a database or Google failure
 * the command doesn't catch) is thrown on when nothing was saved, for the server to answer; after a saved change it
 * becomes `unavailable` with how many saved, so the agent reads again instead of sending the saved ones twice. The log
 * line names the tool and the step, never the error's text.
 */
async function inTurn(ctx: AgentContext, toolName: string, steps: Array<() => Promise<CommandResult<unknown>>>): Promise<Failure | null> {
  for (const [index, step] of steps.entries()) {
    let result: CommandResult<unknown>;
    try {
      result = forAgent(await step());
    } catch (error) {
      if (index === 0) throw error;
      try {
        ctx.deps.log('agent_step_failed', { tool: toolName, step: String(index + 1), of: String(steps.length) });
      } catch { /* logging must not throw either */ }
      return { ok: false, error: 'unavailable', message: COPY.AGENT_SAVED_PART(index, steps.length, COPY.AGENT_STEP_FAILED) };
    }
    if (!result.ok) return index === 0 ? result : { ...result, message: COPY.AGENT_SAVED_PART(index, steps.length, result.message) };
  }
  return null;
}

const partnerChange = (ctx: AgentContext, change: PartnerChange) =>
  changePartner(ctx.deps, ctx.actor, { companyId: ctx.companyId, change });
const mapChange = (ctx: AgentContext, mapId: string, change: MapChange) => changeMap(ctx.deps, ctx.actor, { mapId, change });

async function bookOf(ctx: AgentContext): Promise<CommandResult<PartnerBook>> {
  const read = await readPartners(ctx.deps, ctx.actor, { companyId: ctx.companyId });
  return read.ok ? ok(read.value.value) : read;
}

const emptyTopics = (): Record<Topic, string> => Object.fromEntries(TOPICS.map((t) => [t, ''])) as Record<Topic, string>;

// ---------------------------------------------------------------------------------------------------------------------
// Partners

const accountPatch = z.object({
  expectedUpdatedAt: readAt,
  website: text.optional(), country: text.optional(), vertical: text.optional(), subVertical: text.optional(),
  targetCustomerType: z.enum(TARGET_CUSTOMER_TYPES).optional(), comments: text.optional(),
}).strict().refine(setsSomething(['expectedUpdatedAt']), nothing);

const contactFields = {
  title: text.optional(), email: z.email().nullable().optional(), role: z.enum(PERSON_ROLES).optional(), activeSeller: z.boolean().optional(),
};
const newContact = z.object({ name: named, ...contactFields }).strict();
const contactPatch = z.object({ id, expectedUpdatedAt: readAt, name: named.optional(), ...contactFields }).strict()
  .refine(setsSomething(['id', 'expectedUpdatedAt']), nothing);

/**
 * A partner type's notes, as its tab lets a person write them: why it fits and where it came from (the source's
 * detail). Never its stage, step, signing, closing, exit, 4C scores, source, program or level.
 */
const partnerTypeNotes = z.object({
  partnerType: z.enum(PARTNER_TYPES), expectedUpdatedAt: readAt, whyItFits: text.optional(), sourceDetail: text.optional(),
}).strict().refine(setsSomething(['partnerType', 'expectedUpdatedAt']), nothing);

/** One account as `update_partner` answers it, with its partner types. */
export interface AccountChanged {
  account: PartnerBook['accounts'][number];
  partners: PartnerBook['partners'];
  people: PartnerBook['people'];
}

// ---------------------------------------------------------------------------------------------------------------------
// Reviews

const amount = z.number().min(0).nullable();
const caseSource = z.enum(CASE_SOURCES as unknown as [CaseSource, ...CaseSource[]]);
const reviewNumber = z.object({
  key: z.enum(SCORE_KEYS), actual: amount.optional(), note: text.optional(), nextTarget: amount.optional(), source: caseSource.nullable().optional(),
}).strict().refine(setsSomething(['key']), nothing);
const commitment = z.object({
  title: z.string().min(1).max(ACTIVITY_TITLE_MAX), side: z.enum(ACTIVITY_SIDES), ownerId: id.nullable().optional(),
  dueDate: date.optional(), milestoneId: id.nullable().optional(),
}).strict();

// ---------------------------------------------------------------------------------------------------------------------
// Markets

const marketTexts = z.object({
  expectedUpdatedAt: readAt,
  marketName: named.optional(), ourProduct: named.optional(), ourTargetCustomers: named.optional(), whyPartnerRoute: text.optional(),
  mustHaves: z.array(text).max(100).optional(), howMarketBuys: z.enum(HOW_MARKET_BUYS).optional(), howMarketBuysNote: text.optional(),
  statement: text.optional(),
}).strict().refine(setsSomething(['expectedUpdatedAt']), nothing);
const hypothesisTexts = z.object({
  id, expectedUpdatedAt: readAt,
  name: named.optional(), theirSide: text.optional(), theirEvidence: text.optional(), ourSide: text.optional(), ourEvidence: text.optional(),
  lookalike: text.optional(),
}).strict().refine(setsSomething(['id', 'expectedUpdatedAt']), nothing);

// ---------------------------------------------------------------------------------------------------------------------
// Business cases and company facts

/** A case's inputs. What the case belongs to, its sharing and its stamps stay the case's own (`saveCase`). */
const caseInputs = caseSchema.pick({
  title: true, startsAs: true, deals: true, scenario: true, implementation: true, managed: true, other: true, serviceProfit: true,
  supportCost: true, costs: true, benefits: true, offer: true, ours: true,
}).partial().strict().refine(setsSomething([]), nothing);
const factsInputs = companyFactsSchema.pick({
  currency: true, yearly: true, once: true, renew: true, spend: true, revenue: true, rules: true, ours: true,
}).partial().strict().refine(setsSomething([]), nothing);

export const CHANGE_TOOLS: readonly AgentTool[] = [
  tool({
    name: 'log_call', title: 'Log a call', level: 'change', rest: { method: 'POST', path: '/partners/{accountId}/calls' },
    description: 'Logs a call with a partner company for one of its partner types (accountId and partnerType from list_partners). '
      + 'For a discovery call, notes under the six topic headings (Revenue Model, Cost Drivers, Differentiators, Strategic Bets, '
      + 'Customer Pains, Partnership Experience) go into those topics and the rest into Other notes, as "Sort into topics" does; '
      + 'topicsFound says whether any heading was found. A follow-up call keeps its notes as they are.',
    input: z.object({
      accountId: id, partnerType: z.enum(PARTNER_TYPES), date: isoDateSchema, kind: z.enum(CALL_KINDS),
      notes: z.string().max(TEXT_MAX * (TOPICS.length + 1)),
    }).strict(),
    run: async (ctx, input): Promise<CommandResult<{ call: Call; topicsFound: boolean }>> => {
      const book = await bookOf(ctx);
      if (!book.ok) return book;
      const partner = book.value.partners.find((p) => p.accountId === input.accountId && p.partnerType === input.partnerType);
      if (!partner) return NOT_THERE;
      const sorted = input.kind === 'discovery' ? sortNotes(input.notes) : null;
      const values = {
        partnerId: partner.id, date: input.date, kind: input.kind, topics: sorted?.topics ?? emptyTopics(), notes: sorted?.notes ?? input.notes,
      };
      const out = forAgent(await partnerChange(ctx, { kind: 'add', entity: 'call', values }));
      if (!out.ok) return out;
      const call = out.value.snapshot.value.calls.find((c) => c.id === out.value.entityId);
      return call ? ok({ call, topicsFound: sorted?.foundHeadings ?? false }) : NOT_THERE;
    },
  }),
  tool({
    name: 'update_partner', title: 'Update a partner company', level: 'change', rest: { method: 'PATCH', path: '/partners/{accountId}' },
    description: 'Changes a partner company\'s facts (account: website, country, vertical, subVertical, targetCustomerType, '
      + 'comments, with the account\'s updatedAt as expectedUpdatedAt), a partner type\'s notes (partnerTypes: whyItFits and '
      + 'sourceDetail, each with its partnerType and the partner type\'s updatedAt), adds contacts (addContacts) and changes '
      + 'contacts (updateContacts, each with its id and updatedAt). Never a stage, step, signing, closing, exit, 4C score, '
      + 'source, program or level: the person decides those. Changes are saved one after another; if one fails, the answer '
      + 'says how many were saved.',
    input: z.object({
      accountId: id, account: accountPatch.optional(),
      partnerTypes: z.array(partnerTypeNotes).max(PARTNER_TYPES.length)
        .refine((list) => new Set(list.map((p) => p.partnerType)).size === list.length, { message: 'Send each partner type once.' }).optional(),
      addContacts: z.array(newContact).max(20).optional(), updateContacts: z.array(contactPatch).max(20).optional(),
    }).strict().refine((o) => o.account !== undefined || [o.partnerTypes, o.addContacts, o.updateContacts].some((l) => (l?.length ?? 0) > 0), nothing),
    run: async (ctx, input): Promise<CommandResult<AccountChanged>> => {
      const book = await bookOf(ctx);
      if (!book.ok) return book;
      const account = book.value.accounts.find((a) => a.id === input.accountId);
      if (!account) return NOT_THERE;
      const contacts = input.updateContacts ?? [];
      if (!contacts.every((c) => book.value.people.some((p) => p.id === c.id && p.accountId === account.id))) return NOT_THERE;
      const notes = (input.partnerTypes ?? []).map((n) => ({
        ...n, partner: book.value.partners.find((p) => p.accountId === account.id && p.partnerType === n.partnerType),
      }));
      if (notes.some((n) => !n.partner)) return NOT_THERE;
      let last = book.value;
      const write = (change: PartnerChange) => async () => {
        const out = await partnerChange(ctx, change);
        if (out.ok) last = out.value.snapshot.value;
        return out;
      };
      const { account: patch } = input;
      const failed = await inTurn(ctx, 'update_partner', [
        ...(patch ? [write({ kind: 'update', entity: 'account', id: account.id, patch: given(patch, ['expectedUpdatedAt']), expectedUpdatedAt: patch.expectedUpdatedAt })] : []),
        ...notes.map((n) => write({
          kind: 'update', entity: 'partner', id: n.partner!.id, patch: given(n, ['partnerType', 'expectedUpdatedAt', 'partner']),
          expectedUpdatedAt: n.expectedUpdatedAt,
        })),
        ...(input.addContacts ?? []).map((c) => write({ kind: 'add', entity: 'person', values: { ...given(c), accountId: account.id } })),
        ...contacts.map((c) => write({ kind: 'update', entity: 'person', id: c.id, patch: given(c, ['id', 'expectedUpdatedAt']), expectedUpdatedAt: c.expectedUpdatedAt })),
      ]);
      if (failed) return failed;
      const now = last.accounts.find((a) => a.id === account.id);
      return now
        ? ok({ account: now, partners: last.partners.filter((p) => p.accountId === account.id), people: last.people.filter((p) => p.accountId === account.id) })
        : NOT_THERE;
    },
  }),
  tool({
    name: 'add_activity', title: 'Add a MAP activity', level: 'change', rest: { method: 'POST', path: '/maps/{mapId}/activities' },
    description: 'Adds an activity to a Mutual Action Plan: its title, side (us, partner or joint), and optionally its category, '
      + 'owner (a person id of the MAP), due date, status, note and milestone. Answers the new activity with its id and updatedAt.',
    input: z.object({
      mapId: id, title: z.string().min(1).max(ACTIVITY_TITLE_MAX), side: z.enum(ACTIVITY_SIDES).optional(), category: z.enum(CATEGORIES).optional(),
      ownerId: id.nullable().optional(), dueDate: date.optional(), status: z.enum(ACTIVITY_STATUSES).optional(), note: z.string().max(2000).optional(),
      milestoneId: id.nullable().optional(),
    }).strict(),
    run: async (ctx, input): Promise<CommandResult<{ activity: Activity }>> => {
      const out = forAgent(await mapChange(ctx, input.mapId, { kind: 'add', entity: 'activity', values: given(input, ['mapId']) }));
      if (!out.ok) return out;
      const activity = out.value.snapshot.value.activities.find((a) => a.id === out.value.entityId);
      return activity ? ok({ activity }) : NOT_THERE;
    },
  }),
  tool({
    name: 'update_activity', title: 'Update a MAP activity', level: 'change',
    rest: { method: 'PATCH', path: '/maps/{mapId}/activities/{activityId}' },
    description: 'Changes a MAP activity\'s title, owner, due date, status or note. Send the activity\'s updatedAt from get_map as '
      + 'expectedUpdatedAt: if it changed since, the answer is a conflict and nothing is written; read the MAP again.',
    input: z.object({
      mapId: id, activityId: id, expectedUpdatedAt: readAt,
      title: z.string().min(1).max(ACTIVITY_TITLE_MAX).optional(), ownerId: id.nullable().optional(), dueDate: date.optional(),
      status: z.enum(ACTIVITY_STATUSES).optional(), note: z.string().max(2000).optional(),
    }).strict().refine(setsSomething(['mapId', 'activityId', 'expectedUpdatedAt']), nothing),
    run: async (ctx, input): Promise<CommandResult<{ activity: Activity }>> => {
      const out = forAgent(await mapChange(ctx, input.mapId, {
        kind: 'update', entity: 'activity', id: input.activityId, patch: given(input, ['mapId', 'activityId', 'expectedUpdatedAt']),
        expectedUpdatedAt: input.expectedUpdatedAt,
      }));
      if (!out.ok) return out;
      const activity = out.value.snapshot.value.activities.find((a) => a.id === input.activityId);
      return activity ? ok({ activity }) : NOT_THERE;
    },
  }),
  tool({
    name: 'update_milestone', title: 'Update a MAP milestone', level: 'change',
    rest: { method: 'PATCH', path: '/maps/{mapId}/milestones/{milestoneId}' },
    description: 'Changes a MAP milestone\'s target date, or marks it achieved with the day it was (achievedDate; null to undo).',
    input: z.object({ mapId: id, milestoneId: id, targetDate: date.optional(), achievedDate: date.optional() }).strict()
      .refine(setsSomething(['mapId', 'milestoneId']), nothing),
    run: async (ctx, input): Promise<CommandResult<{ milestone: Milestone }>> => {
      const out = forAgent(await mapChange(ctx, input.mapId, {
        kind: 'update', entity: 'milestone', id: input.milestoneId, patch: given(input, ['mapId', 'milestoneId']),
      }));
      if (!out.ok) return out;
      const milestone = out.value.snapshot.value.milestones.find((m) => m.id === input.milestoneId);
      return milestone ? ok({ milestone }) : NOT_THERE;
    },
  }),
  tool({
    name: 'prepare_review', title: 'Prepare a business review', level: 'change', rest: { method: 'POST', path: '/reviews/{mapId}/prep' },
    description: 'Starts the prep of a MAP\'s coming business review if it hasn\'t started, then fills it: a reason for each '
      + 'activity of the horizon that isn\'t done (reasons, by activityId), scorecard numbers (numbers, by key), blockers, and '
      + 'commitments for the next horizon. A reason or a number given again replaces the one there. Changes are saved one '
      + 'after another; if one fails, the answer says how many were saved. Answers the review as get_review does. Never holds '
      + 'the review: the person does that.',
    input: z.object({
      mapId: id,
      reasons: z.array(z.object({ activityId: id, reason: text }).strict()).max(50)
        .refine((list) => new Set(list.map((r) => r.activityId)).size === list.length, { message: 'Send each activityId once.' }).optional(),
      numbers: z.array(reviewNumber).max(SCORE_KEYS.length)
        .refine((list) => new Set(list.map((n) => n.key)).size === list.length, { message: 'Send each key once.' }).optional(),
      blockers: z.array(z.object({ title: named, side: z.enum(ACTIVITY_SIDES).optional() }).strict()).max(20).optional(),
      commitments: z.array(commitment).max(20).optional(),
    }).strict(),
    run: async (ctx, input) => {
      const { mapId } = input;
      const opened = forAgent(await openReview(ctx.deps, ctx.actor, { mapId }));
      if (!opened.ok) return opened;
      const read = opened.value;
      const review = read.review;
      if (!review) return { ok: false, error: 'invalid', message: COPY.REVIEW_NOT_NOW };
      const reviewId = review.id;
      const reasons = (input.reasons ?? []).map((r) => ({
        ...r, item: read.items.find((i) => i.kind === 'notDone' && i.refId === r.activityId), activity: read.work.find((a) => a.id === r.activityId),
      }));
      // Every reason names work of this review, checked before anything is written.
      if (reasons.some((r) => !r.item && !r.activity)) return NOT_THERE;
      const add = (values: Record<string, unknown>) => () => mapChange(ctx, mapId, { kind: 'add', entity: 'reviewItem', values: { reviewId, ...values } });
      const failed = await inTurn(ctx, 'prepare_review', [
        ...reasons.map((r) => (r.item
          ? () => mapChange(ctx, mapId, { kind: 'update', entity: 'reviewItem', id: r.item!.id, patch: { note: r.reason } })
          : add({ kind: 'notDone', refId: r.activity!.id, title: r.activity!.title, side: r.activity!.side, note: r.reason }))),
        ...(input.numbers ?? []).map((n) => {
          const row = read.numbers.find((x) => x.key === n.key);
          const patch = given(n, ['key']);
          // A new number keeps the target it is checked against, as the review page does (reviews spec 5.3).
          return row
            ? () => mapChange(ctx, mapId, { kind: 'update', entity: 'reviewNumber', id: row.id, patch })
            : () => mapChange(ctx, mapId, {
              kind: 'add', entity: 'reviewNumber', values: { reviewId, key: n.key, target: read.targets[n.key as ScoreKey] ?? null, ...patch },
            });
        }),
        // A blocker is the partner's side unless told otherwise, as the review page adds one.
        ...(input.blockers ?? []).map((b) => add({ kind: 'blocker', title: b.title, side: b.side ?? 'partner' })),
        ...(input.commitments ?? []).map((c) => add({ kind: 'commitment', ...given(c) })),
      ]);
      if (failed) return failed;
      return readReview(ctx.deps, ctx.actor, { mapId, reviewId });
    },
  }),
  tool({
    name: 'update_market', title: 'Update a market', level: 'change', rest: { method: 'PATCH', path: '/markets/{marketId}' },
    description: 'Changes a market\'s texts (market, with the market\'s info.updatedAt as expectedUpdatedAt) and one partner '
      + 'hypothesis\'s texts (hypothesis, with its id and updatedAt). Never a status: whether a hypothesis holds or a market is '
      + 'validated is the person\'s decision. Changes are saved one after another; if one fails, the answer says how many were saved.',
    input: z.object({ marketId: id, market: marketTexts.optional(), hypothesis: hypothesisTexts.optional() }).strict()
      .refine((o) => o.market !== undefined || o.hypothesis !== undefined, nothing),
    run: async (ctx, input): Promise<CommandResult<{ info: MarketInfo; hypothesis: Hypothesis | null }>> => {
      const { marketId, market, hypothesis } = input;
      let last: { info: MarketInfo; hypotheses: Hypothesis[] } | null = null;
      const write = (change: Record<string, unknown>) => async () => {
        const out = await changeMarket(ctx.deps, ctx.actor, { marketId, change });
        if (out.ok) last = out.value.snapshot.value;
        return out;
      };
      const failed = await inTurn(ctx, 'update_market', [
        ...(market ? [write({ kind: 'updateInfo', patch: given(market, ['expectedUpdatedAt']), expectedUpdatedAt: market.expectedUpdatedAt })] : []),
        ...(hypothesis ? [write({
          kind: 'update', entity: 'hypothesis', id: hypothesis.id, patch: given(hypothesis, ['id', 'expectedUpdatedAt']), expectedUpdatedAt: hypothesis.expectedUpdatedAt,
        })] : []),
      ]);
      if (failed) return failed;
      const saved = last as { info: MarketInfo; hypotheses: Hypothesis[] } | null;
      if (!saved) return NOT_THERE;
      return ok({ info: saved.info, hypothesis: hypothesis ? saved.hypotheses.find((h) => h.id === hypothesis.id) ?? null : null });
    },
  }),
  tool({
    name: 'update_case', title: 'Update a business case', level: 'change', rest: { method: 'PATCH', path: '/cases/{caseId}' },
    description: 'Changes a business case\'s inputs: send the fields to change in case (title, startsAs, deals, scenario, '
      + 'implementation, managed, other, serviceProfit, supportCost, costs, benefits, offer, ours), each whole as get_case '
      + 'returns it, and the case\'s updatedAt as expectedUpdatedAt. Fields left out stay as they are. Answers the saved case. '
      + 'Never shares the case.',
    input: z.object({ caseId: id, expectedUpdatedAt: savedAt, case: caseInputs }).strict(),
    run: async (ctx, input) => {
      const read = await readCase(ctx.deps, ctx.actor, { caseId: input.caseId });
      if (!read.ok) return read;
      const base = read.value.value;
      const saved = forAgent(await saveCase(ctx.deps, ctx.actor, {
        caseId: input.caseId, case: { ...base, ...input.case }, base, expectedUpdatedAt: input.expectedUpdatedAt,
      }));
      return saved.ok ? ok(saved.value.snapshot) : saved;
    },
  }),
  tool({
    name: 'save_company_facts', title: 'Save company facts', level: 'change', rest: { method: 'PATCH', path: '/company-facts' },
    description: 'Changes the facts about our own company (facts: currency, yearly, once, renew, spend, revenue, rules, ours), '
      + 'with their updatedAt from get_company_facts as expectedUpdatedAt. Facts left out stay as they are.',
    input: z.object({ expectedUpdatedAt: savedAt, facts: factsInputs }).strict(),
    run: async (ctx, input) => {
      const read = await readCompanyFacts(ctx.deps, ctx.actor, { companyId: ctx.companyId });
      if (!read.ok) return read;
      const base = read.value.value;
      return forAgent(await saveCompanyFacts(ctx.deps, ctx.actor, {
        companyId: ctx.companyId, facts: { ...base, ...input.facts }, base, expectedUpdatedAt: input.expectedUpdatedAt,
      }));
    },
  }),
];

// Agents' proposals (agent proposals design, spec 5 to 10): an agent at level propose proposes a decision, lists its own
// proposals and withdraws one that waits; the person accepts or rejects it. The content goes into the Partners file's
// Proposals tab, written by these commands only; our index keeps one row per proposal with ids, codes and times (spec
// 7.2). Accepting runs the command a person runs (changePartner, importPartners, changeMarket), as the person with the
// proposal attached (spec 10.3).
import {
  acceptChange, canTick, checkProposal, CLOSED_AS, companyItems, expiresAt, importChanges, isoDateSchema, newId, newProposalId,
  overallStatus, previewImport, PROPOSAL_INDEX_KEEP_DAYS, PROPOSAL_MAX_COMPANIES, PROPOSAL_STATUSES, PROPOSAL_TEXT_MAX,
  proposalInputSchema, proposalRows, proposalTable, proposalViews, proposedValue, statusRows, targetOf, targetUpdatedAt, tidyRows,
  toFieldErrors,
  type IsoDateTime, type Market, type MarketChange, type PartnerBook, type PartnerChange, type ProposalInput, type ProposalItem,
  type ProposalScene, type ProposalStatus, type ProposalTarget, type ProposalView,
} from '@partner-desk/core';
import { FOUR_C } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, withProposal, type Actor, type AgentActor, type OwnerActor } from './actor';
import type { Deps } from './deps';
import { ownerToday } from './map-shared';
import { changeMarket } from './markets';
import { companyOf, ownCompanyOnly } from './own-company';
import { changePartner, importPartners } from './partners';
import { makerOf, sameMaker, type ProposalEntry } from './proposal-index';
import { FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, record, type CommandResult, type Failure } from './result';
import { proposalWebhooks } from './webhooks';

/** What an agent hears back once its proposal is made (spec 6.1). */
export interface ProposalMade {
  proposalId: string;
  status: 'waiting';
  /** "Proposed. It waits for Ruth in PartnerStandard Desk.": for the agent to pass on. */
  message: string;
  /** The agent's own waiting proposal of this kind for this target that this one replaced (spec 8), else null. */
  replaced: string | null;
  /**
   * New partners only: the companies (by their 0-based index in the proposal) that are partners already, of this type
   * (in this market or not) or of another. One on the market's Exclusions isn't a partner and isn't named.
   */
  alreadyPartners?: number[];
}

const companyId = z.string().regex(/^co_[0-9a-z]{10}$/);
const proposalId = z.string().min(1).max(64);
const createInput = z.object({ companyId, proposal: z.unknown() }).strict();
const listInput = z.object({ status: z.enum(PROPOSAL_STATUSES).optional(), proposalId: proposalId.optional() }).strict();
const withdrawInput = z.object({ companyId, proposalId }).strict();

const DAY_MS = 24 * 60 * 60 * 1000;
/** The lock scope (`PartnerBookStore.exclusive`) of every proposals command that reads the index, then writes. */
const SCOPE = 'proposals';

/** Another person's proposal, another agent's, or none: the same answer (spec 5.3). */
const GONE: Failure = { ok: false, error: 'not_found', message: COPY.GONE };
/** The agent read the target before it changed: it reads again before the person ever sees the proposal (spec 6.1). */
const READ_AGAIN: Failure = { ok: false, error: 'conflict', message: COPY.AGENT_CONFLICT };
const INDEX_FAILED: Failure = { ok: false, error: 'unavailable', message: COPY.AGENT_TRY_AGAIN };
const EXPIRED: Failure = { ok: false, error: 'invalid', message: COPY.PROPOSAL_EXPIRED };
const REPLACED: Failure = { ok: false, error: 'conflict', message: COPY.PROPOSAL_REPLACED_ALREADY };
/** For the agent: "Ruth already answered this proposal." */
const answeredAlready = (actor: Actor): Failure =>
  ({ ok: false, error: 'conflict', message: COPY.PROPOSAL_ANSWERED_ALREADY(actor.kind === 'link' ? '' : actor.displayName) });
/** For the person, who reads it on their own screen: "You already answered this proposal." */
const YOU_ANSWERED: Failure = { ok: false, error: 'conflict', message: COPY.PROPOSAL_YOU_ANSWERED };

/** The person's own: a proposal is never anyone else's resource. */
const own = (actor: Actor) => ({ ownerUserId: actor.userId });
const daysBefore = (now: IsoDateTime, days: number): IsoDateTime => new Date(Date.parse(now) - days * DAY_MS).toISOString();
const isPast = (at: IsoDateTime, now: IsoDateTime) => Date.parse(at) <= Date.parse(now);
const targetIds = (t: ProposalTarget): string[] =>
  [t.accountId, t.partnerId, t.marketId, t.hypothesisId].filter((id): id is string => id !== null);

/**
 * The schema's refusal, for an agent (only agents propose): the field errors under `proposal.`, and the schema's own
 * words as the message when it wrote some, such as "Propose at least one letter." for a 4C proposal with none.
 */
function refusedProposal(error: z.ZodError): Failure {
  const fieldErrors = Object.fromEntries(Object.entries(toFieldErrors(error)).map(([at, message]) => [at === '_' ? 'proposal' : `proposal.${at}`, message]));
  const said = error.issues.find((issue) => issue.code === 'custom');
  return { ok: false, error: 'invalid', message: said?.message ?? COPY.FIX_FIELDS, fieldErrors };
}

/**
 * `work` while no other proposals command of this Partners file runs (`PartnerBookStore.exclusive`), so the index's
 * "the one waiting" read, the file's write and the index's write never interleave with another's [builder's call]. A
 * store without the lock (tests, the demo) runs it at once.
 */
async function oneAtATime<T>(deps: Deps, fileId: string, work: () => Promise<CommandResult<T>>): Promise<CommandResult<T>> {
  try {
    if (!deps.partnerBooks.exclusive) return await work();
    const out = await deps.partnerBooks.exclusive({ fileId }, SCOPE, work);
    return out.ok ? out : fromStore(out);
  } catch (error) {
    if (!(error instanceof IndexDown)) throw error;
    try {
      deps.log('proposal_index_failed', { userId: error.userId, step: error.step });
    } catch { /* logging must not throw */ }
    return INDEX_FAILED;
  }
}

/** Our index failed during a proposals command: the person's id and the step's name, never the error's text. */
class IndexDown extends Error {
  constructor(readonly userId: string, readonly step: string) {
    super('proposal_index_failed');
    this.name = 'IndexDown';
  }
}

/**
 * One call of our index inside `oneAtATime`: a throw becomes `unavailable` ("try again") and an ids-only log line
 * [builder's call]. Google's own failures don't come through here and keep their codes.
 */
async function fromIndex<T>(userId: string, step: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch {
    throw new IndexDown(userId, step);
  }
}

/**
 * What the tab's next write tidies (spec 7.3, `tidyRows`), from the person's index of the last 90 days: rows Waiting of a
 * proposal the index replaced or withdrew take that status, rows of a proposal the index doesn't know become Not sent.
 * Answered rows stay as they are, whatever the index says [builder's call].
 */
async function tidy(deps: Deps, userId: string, items: readonly ProposalItem[], now: IsoDateTime): Promise<PartnerChange[]> {
  if (!items.some((item) => item.status === 'waiting')) return [];
  const listed = await fromIndex(userId, 'list', () => deps.proposals.list(userId, { since: daysBefore(now, PROPOSAL_INDEX_KEEP_DAYS) }));
  const marked = new Map<string, 'replaced' | 'withdrawn'>();
  for (const e of listed) if (e.status === 'replaced' || e.status === 'withdrawn') marked.set(e.id, e.status);
  return tidyRows(items, {
    waiting: new Set(listed.filter((e) => e.status === 'waiting').map((e) => e.id)), known: new Set(listed.map((e) => e.id)), marked,
  }, now);
}

type MarketRead = { ok: true; market: Snapshot<Market>; archived: boolean } | { ok: true; market: null } | Failure;

/** The market a proposal is about, and whether it is archived; `market: null` when the directory has none of this person's. */
async function marketOf(deps: Deps, actor: Actor, company: string, marketId: string): Promise<MarketRead> {
  const entry = await deps.directory.market(marketId);
  if (!entry || entry.companyId !== company || !isOwner(actor, entry)) return { ok: true, market: null };
  if (!can(actor, 'markets.read', entry)) return FORBIDDEN;
  const read = await deps.markets.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const archived = (await deps.directory.markets(company)).find((m) => m.marketId === marketId)?.archived ?? false;
  // The ids the directory names: `_meta` can be edited by hand.
  const value: Market = { ...read.snapshot.value, info: { ...read.snapshot.value.info, marketId, companyId: company } };
  return { ok: true, market: { ...read.snapshot, value }, archived };
}

/** What a proposal is checked against: the Partners file, and for a market kind its market and whether it is archived. */
async function sceneOf(
  deps: Deps, actor: Actor, company: string, fileId: string, input: ProposalInput,
): Promise<{ ok: true; scene: ProposalScene } | Failure> {
  const read = await deps.partnerBooks.read({ fileId });
  if (!read.ok) return fromStore(read);
  const book = read.snapshot.value;
  if (!('marketId' in input)) return { ok: true, scene: { book, market: null, archived: false } };
  const market = await marketOf(deps, actor, company, input.marketId);
  if (!market.ok) return market;
  if (!market.market) return NOT_FOUND_FILE;
  return { ok: true, scene: { book, market: market.market.value, archived: market.archived } };
}

/**
 * An agent proposes a decision (spec 6.1): checked against the file as it is now, written to the Proposals tab, then to
 * the index. Its own waiting proposal of the same kind for the same target is replaced (spec 8), in the same write;
 * one past its expiry is left for the clean-up, which marks it expired [builder's call]. The rows are the proposals
 * commands' own: no `changePartner`, so `can` judges `proposals.create` only, and the write carries the agent's label.
 */
export const createProposal = ownCompanyOnly(async function createProposal(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<ProposalMade>> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalid();
  const proposal = proposalInputSchema.safeParse(parsed.data.proposal);
  if (!proposal.success) return refusedProposal(proposal.error);
  const company = parsed.data.companyId;
  const entry = await deps.directory.partnerBook(company);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (actor.kind !== 'agent' || !can(actor, 'proposals.create', entry)) return FORBIDDEN;
  const agent: AgentActor = actor;
  const made = await oneAtATime(deps, entry.fileId, () => propose(deps, agent, company, entry.fileId, proposal.data));
  if (!made.ok) return made;
  const { index, answer } = made.value;
  await record(deps, actor, 'proposals.create', entry.fileId, [index.id, ...targetIds(index)], index.kind, index.id);
  await proposalWebhooks(deps, actor.userId, 'proposal.created', index);
  return ok(answer);
});

/** `createProposal`'s check and its two writes, under the file's proposals lock. */
async function propose(
  deps: Deps, actor: AgentActor, company: string, fileId: string, input: ProposalInput,
): Promise<CommandResult<{ index: ProposalEntry; answer: ProposalMade }>> {
  const loaded = await sceneOf(deps, actor, company, fileId, input);
  if (!loaded.ok) return loaded;
  const { scene } = loaded;
  if (input.kind !== 'partners' && input.expectedUpdatedAt !== targetUpdatedAt(input, scene)) return READ_AGAIN;
  const verdict = checkProposal(input, scene);
  if (!verdict.ok) return { ok: false, error: 'invalid', message: verdict.message };

  const now = deps.clock();
  const maker = makerOf(actor);
  const target = targetOf(input, scene.book);
  const old = await fromIndex(actor.userId, 'waiting', () => deps.proposals.waiting(actor.userId, input.kind, target, maker));
  const replaces = old !== null && !isPast(old.expiresAt, now) ? old : null;
  const id = newProposalId();
  const label = actorLabel(actor);
  const oldItems = replaces ? scene.book.proposalItems.filter((i) => i.proposalId === replaces.id) : [];
  const others = scene.book.proposalItems.filter((i) => i.proposalId !== replaces?.id);
  // One write: the new rows, the replaced one's rows still waiting (an answered row stays answered), and the tidy-up.
  // Built here from a validated proposal, so no 100-change cap: 50 companies replacing 50 is one write.
  const changes = [
    ...proposalRows(input, scene, { proposalId: id, proposedBy: label, now, ids: () => newId('proposalItem') }),
    ...statusRows(oldItems.filter((i) => i.status === 'waiting'), 'replaced', now),
    ...await tidy(deps, actor.userId, others, now),
  ];
  const out = await deps.partnerBooks.applyMany({ fileId }, changes, { now, actor: label });
  if (!out.ok) return out.error === 'conflict' ? READ_AGAIN : fromStore(out);

  const row = { id, userId: actor.userId, kind: input.kind, ...target, createdAt: now, expiresAt: expiresAt(now), madeBy: maker, fileId };
  try {
    await deps.proposals.add(row, replaces?.id ?? null);
  } catch {
    // The rows stay Waiting; the tab's next write marks them Not sent (spec 7.3). Nobody is shown them.
    try {
      deps.log('proposal_index_failed', { userId: actor.userId, proposalId: id });
    } catch { /* logging must not throw */ }
    return INDEX_FAILED;
  }

  const answer: ProposalMade = { proposalId: id, status: 'waiting', message: COPY.PROPOSAL_MADE(actor.displayName), replaced: replaces?.id ?? null };
  if (input.kind === 'partners' && scene.market) {
    // The preview's duplicate check, run once at proposing, on the file before this write; it runs again at accepting.
    const items = out.snapshot.value.proposalItems.filter((i) => i.proposalId === id);
    const { rows } = previewImport({ book: scene.book, market: scene.market, table: proposalTable(items) });
    // Every company is a partner from the day it is added: one of another type is a partner already too. An exclusion isn't.
    const known = new Set(['linked', 'existing', 'other_type']);
    answer.alreadyPartners = rows.flatMap((r, i) => (r.duplicate && known.has(r.duplicate.kind) ? [i] : []));
  }
  return ok({ index: { ...row, status: 'waiting', answeredAt: null, agentName: actor.agentName, makerOn: true }, answer });
}

/**
 * The proposals of the last 90 days (spec 6.2), newest first: an agent sees only its own (its app by name, or its key),
 * the person all of theirs. With `proposalId`, the one: someone else's, or none, is `not_found`.
 */
export async function listProposals(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<ProposalEntry[]>> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'proposals.list', own(actor))) return FORBIDDEN;
  const { status, proposalId: one } = parsed.data;
  const since = daysBefore(deps.clock(), PROPOSAL_INDEX_KEEP_DAYS);
  const list = await deps.proposals.list(actor.userId, {
    since, ...(actor.kind === 'agent' ? { maker: makerOf(actor) } : {}), ...(one !== undefined ? { proposalId: one } : { ...(status ? { status } : {}) }),
  });
  if (one !== undefined && list.length === 0) return GONE;
  await record(deps, actor, 'proposals.list', '', []);
  return ok(one !== undefined && status !== undefined ? list.filter((e) => e.status === status) : list);
}

/**
 * How many proposals wait for the person (not expired by now), in all and by agent (`makerKey`): from the index and the
 * directory, no Google read. Only those of the person's current Partners file, as This week lists them: a file made
 * again leaves the old file's out. No Partners file yet: none.
 */
export async function countProposals(deps: Deps, actor: Actor): Promise<CommandResult<{ total: number; byMaker: Record<string, number> }>> {
  if (!can(actor, 'proposals.list', own(actor))) return FORBIDDEN;
  const entry = await deps.directory.partnerBook(await companyOf(deps, actor.userId));
  if (!entry || !isOwner(actor, entry)) return ok({ total: 0, byMaker: {} });
  return ok(await deps.proposals.countWaiting(actor.userId, deps.clock(), entry.fileId));
}

/**
 * The agent takes back one of its own waiting proposals (spec 6.2): its rows become Withdrawn, then the index. One the
 * person answered is a conflict ("Ruth already answered this proposal."), also when only its rows say so; one past
 * its expiry has expired; one withdrawn already answers as withdrawn and writes nothing [builder's call]. Another
 * agent's or person's id is `not_found`. No webhook (spec 9).
 */
export const withdrawProposal = ownCompanyOnly(async function withdrawProposal(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ proposalId: string; status: 'withdrawn' }>> {
  const parsed = withdrawInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await deps.directory.partnerBook(parsed.data.companyId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (actor.kind !== 'agent' || !can(actor, 'proposals.withdraw', entry)) return FORBIDDEN;
  const id = parsed.data.proposalId;
  const done = { proposalId: id, status: 'withdrawn' as const };
  const maker = makerOf(actor);
  return oneAtATime(deps, entry.fileId, async () => {
    const found = await fromIndex(actor.userId, 'get', () => deps.proposals.get(actor.userId, id));
    if (!found || !sameMaker(found.madeBy, maker)) return GONE;
    const now = deps.clock();
    const refused = refusal(found.status, found.expiresAt, now, actor);
    if (refused === 'done') return ok(done);
    if (refused) return refused;
    const read = await deps.partnerBooks.read({ fileId: entry.fileId });
    if (!read.ok) return fromStore(read);
    const items = read.snapshot.value.proposalItems;
    const mine = items.filter((i) => i.proposalId === id);
    // Answered rows win over a waiting index row: the person's answer reached the tab, its index write didn't.
    if (mine.some((i) => i.status === 'accepted' || i.status === 'rejected')) return answeredAlready(actor);
    const changes = [
      ...statusRows(mine.filter((i) => i.status === 'waiting'), 'withdrawn', now),
      ...await tidy(deps, actor.userId, items.filter((i) => i.proposalId !== id), now),
    ];
    if (changes.length > 0) {
      const out = await deps.partnerBooks.applyMany({ fileId: entry.fileId }, changes, { now, actor: actorLabel(actor) });
      if (!out.ok) return out.error === 'conflict' ? READ_AGAIN : fromStore(out);
    }
    // The rows say Withdrawn already: a failure here leaves the index waiting, and the agent's retry ends it.
    if (!(await fromIndex(actor.userId, 'answer', () => deps.proposals.answer(actor.userId, id, 'withdrawn', now)))) {
      const now2 = await fromIndex(actor.userId, 'get', () => deps.proposals.get(actor.userId, id));
      const again = now2 ? refusal(now2.status, now2.expiresAt, now, actor) : GONE;
      return again === 'done' ? ok(done) : again ?? answeredAlready(actor);
    }
    await record(deps, actor, 'proposals.withdraw', entry.fileId, [id, ...targetIds(found)], 'withdrawn', id);
    return ok(done);
  });
});

/** Why a proposal can't be withdrawn now, 'done' when it is withdrawn already, or null when it waits. */
function refusal(status: ProposalStatus, expires: IsoDateTime, now: IsoDateTime, actor: Actor): Failure | 'done' | null {
  switch (status) {
    case 'withdrawn': return 'done';
    case 'replaced': return REPLACED;
    case 'expired': return EXPIRED;
    case 'waiting': return isPast(expires, now) ? EXPIRED : null;
    case 'accepted': case 'partly_accepted': case 'rejected': return answeredAlready(actor);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The person's answer (spec 10.3): accepting runs the command a person runs, as the person with the proposal attached
// ("Ruth, proposed by Desk Agent"); rejecting marks the rows Rejected with the person's note. Then the index, the
// proposal's own event and the `proposal.answered` webhook.

const answerTarget = { companyId, proposalId };
const acceptInput = z.object({
  ...answerTarget,
  /** The target's `updatedAt` as the card showed it (`ProposalView.targetUpdatedAt`); else the proposal's own. */
  expectedUpdatedAt: z.string().min(1).max(64).nullable().optional(),
  /** 4C: the letters accepted ("Accept some"); the others are rejected. All when not given. */
  letters: z.array(z.enum(FOUR_C)).min(1).max(FOUR_C.length).optional(),
  /** New partners: the preview's rows ticked, by index. The preview's own choice when not given. */
  ticked: z.array(z.number().int().min(0).max(PROPOSAL_MAX_COMPANIES - 1)).max(PROPOSAL_MAX_COMPANIES).optional(),
  /** The sign dialog's date, the close dialog's choice and reason: they win over the proposal's. */
  signedDate: isoDateSchema.optional(),
  as: z.enum(CLOSED_AS).optional(),
  reason: z.string().max(PROPOSAL_TEXT_MAX).optional(),
  /** The sign dialog's question: move the MAP's open dates too. */
  shiftMapDates: z.boolean().optional(),
  /** "Accept some": the person's "Why not?" for the letters or companies left out, as a rejection's note. */
  note: z.string().max(PROPOSAL_TEXT_MAX).optional(),
}).strict();
const rejectInput = z.object({ ...answerTarget, note: z.string().max(PROPOSAL_TEXT_MAX).optional() }).strict();
type AcceptInput = z.infer<typeof acceptInput>;

/** What the person's accept answers: the proposal's status, the Partners file (and the market) as written. */
export interface ProposalAccepted {
  status: 'accepted' | 'partly_accepted';
  book: Snapshot<PartnerBook>;
  market?: Snapshot<Market>;
  mapDates?: { moved: boolean; days: number };
}

/** The target changed again after the person opened the page: nothing is written, and the page offers Refresh. */
const CHANGED: Failure = { ok: false, error: 'conflict', message: COPY.CONFLICT };
/** The proposal's rows are gone from the tab, or can't be read as the preview's table. */
const ROWS_GONE: Failure = { ok: false, error: 'invalid', message: COPY.GONE };
const NOTHING_TICKED: Failure = { ok: false, error: 'invalid', message: COPY.IMPORT_NOTHING_TICKED, fieldErrors: { ticked: COPY.IMPORT_NOTHING_TICKED } };
const refuse = (message: string): Failure => ({ ok: false, error: 'invalid', message });
const conflictOf = (out: Failure): Failure => (out.error === 'conflict' ? CHANGED : out);

/** Which of the accept's choices fit which kind: one that doesn't fit is invalid, not ignored. */
const FITS: Record<'letters' | 'ticked' | 'signedDate' | 'as' | 'reason' | 'shiftMapDates' | 'note', readonly ProposalEntry['kind'][]> = {
  letters: ['fourC'], ticked: ['partners'], signedDate: ['signed'], as: ['close'], reason: ['close'], shiftMapDates: ['signed'],
  note: ['fourC', 'partners'],
};
const fits = (input: AcceptInput, kind: ProposalEntry['kind']) =>
  (Object.keys(FITS) as Array<keyof typeof FITS>).every((field) => input[field] === undefined || FITS[field].includes(kind));

/**
 * The person's proposal that still waits for an answer. Another person's, one of another Partners file (a recreated
 * one), or none: `not_found`. Withdrawn or replaced since the page was opened, or answered: a conflict that says so.
 * An index that can't be read answers `unavailable` (`fromIndex`).
 */
async function waitingEntry(deps: Deps, owner: OwnerActor, id: string, fileId: string): Promise<{ ok: true; entry: ProposalEntry } | Failure> {
  const found = await fromIndex(owner.userId, 'get', () => deps.proposals.get(owner.userId, id));
  if (!found || found.fileId !== fileId) return GONE;
  switch (found.status) {
    case 'waiting': return isPast(found.expiresAt, deps.clock()) ? EXPIRED : { ok: true, entry: found };
    case 'expired': return EXPIRED;
    case 'withdrawn': return { ok: false, error: 'conflict', message: COPY.PROPOSAL_WITHDRAWN_BY(COPY.DESK_AGENT) };
    case 'replaced': return { ok: false, error: 'conflict', message: COPY.PROPOSAL_REPLACED_BY(COPY.DESK_AGENT) };
    case 'accepted': case 'partly_accepted': case 'rejected': return YOU_ANSWERED;
  }
}

/** The index's answer, best effort: the file holds the answer already, and the card shows it from the rows. */
async function answerIndex(deps: Deps, userId: string, id: string, to: Exclude<ProposalStatus, 'waiting'>, now: IsoDateTime): Promise<void> {
  try {
    // False: the hourly clean-up marked it expired meanwhile; the rows' answer wins on screen.
    await deps.proposals.answer(userId, id, to, now);
  } catch {
    try {
      deps.log('proposal_index_failed', { userId, proposalId: id });
    } catch { /* logging must not throw */ }
  }
}

/**
 * The file holds an answer the index doesn't (its write failed after the file's): the index takes the rows' answer,
 * and the person hears they answered already.
 */
async function answeredInFile(deps: Deps, owner: OwnerActor, entry: ProposalEntry, items: readonly ProposalItem[]): Promise<Failure> {
  const accepted = items.filter((i) => i.status === 'accepted').length;
  await answerIndex(deps, owner.userId, entry.id, overallStatus(accepted, items.length), deps.clock());
  return YOU_ANSWERED;
}

/** Each waiting item's answer: accepted when `accepted` says so, rejected otherwise (with the person's note, if any). */
function answerRows(items: readonly ProposalItem[], accepted: (item: ProposalItem) => boolean, now: IsoDateTime, note?: string) {
  const waiting = items.filter((i) => i.status === 'waiting');
  const yes = waiting.filter(accepted);
  const why = note !== undefined && note.trim() !== '' ? note : undefined;
  return {
    changes: [...statusRows(yes, 'accepted', now), ...statusRows(waiting.filter((i) => !accepted(i)), 'rejected', now, why)],
    status: overallStatus(yes.length, waiting.length) as ProposalAccepted['status'],
  };
}

/**
 * The person accepts an agent's proposal (spec 10.3), all of it or some (4C letters, new partners' rows), with the
 * values of the dialog it opens (close, sign). A person only. The proposal must still wait and still apply to the
 * file as it is now (`proposalViews`); a target that changed since the person opened the page is a conflict.
 * - 4C, stage, close, signed: `changePartner` with the desk notes and the rows' answers in the same write, so every
 *   side effect of a person's change runs (webhooks, the MAP's summary, `shiftMapDates`).
 * - New partners: the import preview on the file as it is now, the ticked rows through `importPartners`, one write.
 * - A hypothesis's or market's status: `changeMarket`, then the rows, then the index (spec 7.3).
 * A target that is as proposed already is not written again: the proposal closes as accepted [builder's call].
 */
export const acceptProposal = ownCompanyOnly(async function acceptProposal(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<ProposalAccepted>> {
  const parsed = acceptInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await deps.directory.partnerBook(parsed.data.companyId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (actor.kind !== 'owner' || !can(actor, 'proposals.accept', entry)) return FORBIDDEN;
  const owner = actor;
  const done = await oneAtATime(deps, entry.fileId, () => accepting(deps, owner, parsed.data, entry.fileId));
  if (!done.ok) return done;
  const { index, answer } = done.value;
  await record(deps, owner, 'proposals.accept', entry.fileId, [index.id, ...targetIds(index)], answer.status, index.id);
  await proposalWebhooks(deps, owner.userId, 'proposal.answered', index);
  return ok(answer);
});

/** `acceptProposal`'s read, check and writes, under the file's proposals lock. */
async function accepting(
  deps: Deps, owner: OwnerActor, input: AcceptInput, fileId: string,
): Promise<CommandResult<{ index: ProposalEntry; answer: ProposalAccepted }>> {
  const found = await waitingEntry(deps, owner, input.proposalId, fileId);
  if (!found.ok) return found;
  const index = found.entry;
  if (!fits(input, index.kind)) return invalid();
  const read = await deps.partnerBooks.read({ fileId });
  if (!read.ok) return fromStore(read);
  const book = read.snapshot.value;
  let market: Extract<MarketRead, { ok: true }> = { ok: true, market: null };
  if (index.marketId !== null) {
    const loaded = await marketOf(deps, owner, input.companyId, index.marketId);
    if (!loaded.ok) return loaded;
    market = loaded;
  }
  const now = deps.clock();
  const markets = index.marketId === null ? {}
    : { [index.marketId]: market.market ? { market: market.market.value, archived: market.archived } : { market: null, archived: false } };
  const view = proposalViews([index], { book, markets }, now)[0];
  const items = book.proposalItems.filter((i) => i.proposalId === index.id);
  if (!view) return ROWS_GONE;
  if (view.state === 'cannot') return refuse(view.cannot ?? COPY.GONE);
  if (view.state === 'expired') return EXPIRED;
  if (view.state === 'answered') return answeredInFile(deps, owner, index, items);

  const scene: Scene = {
    deps, owner: withProposal(owner, { id: index.id, agentName: index.agentName }) as OwnerActor, input, fileId, index, view, items, book, now,
    tidied: await tidy(deps, owner.userId, book.proposalItems.filter((i) => i.proposalId !== index.id), now),
  };
  let answer: CommandResult<ProposalAccepted>;
  switch (index.kind) {
    case 'fourC': case 'stage': case 'close': case 'signed':
      answer = await acceptPartnerKind(scene);
      break;
    case 'partners':
      answer = market.market ? await acceptPartners(scene, market.market.value) : ROWS_GONE;
      break;
    case 'hypothesisStatus': case 'marketStatus':
      answer = market.market ? await acceptMarketKind(scene, market.market) : ROWS_GONE;
      break;
  }
  if (!answer.ok) return answer;
  await answerIndex(deps, owner.userId, index.id, answer.value.status, now);
  return ok({ index, answer: answer.value });
}

/** Everything an accept of one kind needs: the person (with the proposal attached), the card, its rows and the file. */
interface Scene {
  deps: Deps;
  owner: OwnerActor;
  input: AcceptInput;
  fileId: string;
  index: ProposalEntry;
  view: ProposalView;
  items: ProposalItem[];
  book: PartnerBook;
  now: IsoDateTime;
  /** The tab's tidy-up, written with the answer like every proposals write. */
  tidied: PartnerChange[];
}

/**
 * The `updatedAt` the person saw: the card's (`expectedUpdatedAt`), else the one the proposal kept. When the proposal
 * kept none (an empty Target updated), the one now: the card showed the value now beside the proposed one.
 */
const seenUpdatedAt = (s: Scene): IsoDateTime | null =>
  s.input.expectedUpdatedAt !== undefined ? s.input.expectedUpdatedAt : (s.items[0]?.targetUpdated ?? s.view.targetUpdatedAt);

/** The rows' answers alone (the target holds what was proposed already, or a market file written before), one write. */
async function writeAnswers(s: Scene, changes: PartnerChange[]): Promise<CommandResult<Snapshot<PartnerBook>>> {
  const all = [...changes, ...s.tidied];
  if (all.length === 0) {
    const read = await s.deps.partnerBooks.read({ fileId: s.fileId });
    return read.ok ? ok(read.snapshot) : fromStore(read);
  }
  const out = await s.deps.partnerBooks.applyMany({ fileId: s.fileId }, all, { now: s.now, actor: actorLabel(s.owner) });
  return out.ok ? ok(out.snapshot) : conflictOf(fromStore(out));
}

/** 4C, stage, close and signed: the person's change and the rows' answers in one write, through `changePartner`. */
async function acceptPartnerKind(s: Scene): Promise<CommandResult<ProposalAccepted>> {
  const { input, view, items, book } = s;
  const proposed = new Set(items.map((i) => i.what));
  if (input.letters?.some((c) => !proposed.has(`desk.${c}`))) return invalid();
  const picked = new Set(input.letters?.map((c) => `desk.${c}`) ?? proposed);
  const answers = answerRows(items, (i) => s.index.kind !== 'fourC' || picked.has(i.what), s.now, input.note);
  if (view.state === 'already') {
    const written = await writeAnswers(s, answers.changes);
    return written.ok ? ok({ status: answers.status, book: written.value }) : written;
  }
  const expected = seenUpdatedAt(s);
  const partner = book.partners.find((p) => p.id === view.target.partnerId);
  if (!partner) return ROWS_GONE;
  // The row changed after the person saw it (Review Focus 1): for every partner kind, as the 4C patch checks itself.
  if (partner.updatedAt !== expected) return CHANGED;
  const built = acceptChange(view, book, {
    ...(input.letters ? { letters: input.letters } : {}), ...(input.signedDate ? { signedDate: input.signedDate } : {}),
    ...(input.as ? { as: input.as } : {}), ...(input.reason !== undefined ? { reason: input.reason } : {}),
  }, expected);
  if (!('change' in built)) return refuse(built.ok ? COPY.GONE : built.message);
  const out = await changePartner(s.deps, s.owner, {
    companyId: input.companyId, change: built.change, ...(input.shiftMapDates !== undefined ? { shiftMapDates: input.shiftMapDates } : {}),
  }, { with: [...built.with, ...answers.changes, ...s.tidied] });
  if (!out.ok) return conflictOf(out);
  return ok({ status: answers.status, book: out.value.snapshot, ...(out.value.mapDates ? { mapDates: out.value.mapDates } : {}) });
}

/**
 * New partners: the import preview on the file as it is now (its duplicate check and the market's exclusions), the
 * ticked rows that can be added through `importPartners`, and every company's answer, in one write. A company ticked
 * that can't be added now (it got into this market since) is rejected.
 */
async function acceptPartners(s: Scene, market: Market): Promise<CommandResult<ProposalAccepted>> {
  const { deps, input, items, book } = s;
  const companies = companyItems(items);
  const { rows } = previewImport({ book, market, table: proposalTable(items) });
  if (rows.length !== companies.length) return ROWS_GONE;
  const ticked = input.ticked ?? rows.flatMap((row, i) => (row.selected ? [i] : []));
  if (ticked.some((i) => i >= rows.length)) return invalid();
  const chosen = new Set(ticked.filter((i) => canTick(rows[i]!)));
  if (chosen.size === 0) return NOTHING_TICKED;
  const hypothesis = market.hypotheses.find((h) => h.id === s.index.hypothesisId);
  const changes = importChanges(rows.map((row, i) => ({ ...row, selected: chosen.has(i) })), {
    marketId: market.info.marketId, hypothesisId: hypothesis?.id ?? null,
    hypothesisName: hypothesis ? hypothesis.name.trim() || COPY.UNTITLED_HYPOTHESIS : '', date: await ownerToday(deps, s.owner.userId),
  }, market);
  const yes = new Set(companies.filter((_, i) => chosen.has(i)).map((item) => item.id));
  const answers = answerRows(items, (i) => yes.has(i.id), s.now, input.note);
  const out = await importPartners(deps, s.owner, { companyId: input.companyId, marketId: market.info.marketId, changes }, {
    with: [...answers.changes, ...s.tidied],
  });
  if (!out.ok) return conflictOf(out);
  return ok({ status: answers.status, book: out.value.snapshot });
}

/**
 * A hypothesis's or the market's status (spec 7.3): the market file first, through `changeMarket` (skipped when it holds
 * the status already), then the rows. A rows write that fails leaves the market changed and the proposal waiting; the
 * next view says "already", and accepting then closes it.
 */
async function acceptMarketKind(s: Scene, market: Snapshot<Market>): Promise<CommandResult<ProposalAccepted>> {
  const { deps, view, items } = s;
  const value = items[0] ? proposedValue(items[0]) : null;
  let written = market;
  if (view.state !== 'already') {
    const expectedUpdatedAt = seenUpdatedAt(s);
    let change: MarketChange;
    if (value?.field === 'hypothesisStatus' && s.index.hypothesisId !== null) {
      change = { kind: 'update', entity: 'hypothesis', id: s.index.hypothesisId, patch: { status: value.to }, expectedUpdatedAt };
    } else if (value?.field === 'marketStatus') {
      // An empty proposed note leaves the person's note as it is [builder's call].
      change = { kind: 'updateInfo', patch: { status: value.to, ...(value.note.trim() !== '' ? { statusNote: value.note } : {}) }, expectedUpdatedAt };
    } else {
      return ROWS_GONE;
    }
    const out = await changeMarket(deps, s.owner, { marketId: market.value.info.marketId, change });
    if (!out.ok) return conflictOf(out);
    written = out.value.snapshot;
  }
  const answers = answerRows(items, () => true, s.now);
  const rows = await writeAnswers(s, answers.changes);
  if (!rows.ok) return rows;
  return ok({ status: answers.status, book: rows.value, market: written });
}

/**
 * The person rejects an agent's proposal, with an optional note (spec 10.1): every waiting row becomes Rejected with
 * the note, in the tab only; then the index, the event and `proposal.answered`. A proposal that can't apply any more
 * is rejected the same way (Review Focus 2). A person only.
 */
export const rejectProposal = ownCompanyOnly(async function rejectProposal(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ book: Snapshot<PartnerBook> }>> {
  const parsed = rejectInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await deps.directory.partnerBook(parsed.data.companyId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (actor.kind !== 'owner' || !can(actor, 'proposals.reject', entry)) return FORBIDDEN;
  const owner = actor;
  const { fileId } = entry;
  const done = await oneAtATime(deps, fileId, async (): Promise<CommandResult<{ index: ProposalEntry; book: Snapshot<PartnerBook> }>> => {
    const found = await waitingEntry(deps, owner, parsed.data.proposalId, fileId);
    if (!found.ok) return found;
    const index = found.entry;
    const read = await deps.partnerBooks.read({ fileId });
    if (!read.ok) return fromStore(read);
    const all = read.snapshot.value.proposalItems;
    const items = all.filter((i) => i.proposalId === index.id);
    if (items.some((i) => i.status === 'accepted' || i.status === 'rejected')) return answeredInFile(deps, owner, index, items);
    const now = deps.clock();
    const changes = [
      ...statusRows(items.filter((i) => i.status === 'waiting'), 'rejected', now, parsed.data.note),
      ...await tidy(deps, owner.userId, all.filter((i) => i.proposalId !== index.id), now),
    ];
    let book = read.snapshot;
    if (changes.length > 0) {
      const label = actorLabel(withProposal(owner, { id: index.id, agentName: index.agentName }));
      const out = await deps.partnerBooks.applyMany({ fileId }, changes, { now, actor: label });
      if (!out.ok) return conflictOf(fromStore(out));
      book = out.snapshot;
    }
    await answerIndex(deps, owner.userId, index.id, 'rejected', now);
    return ok({ index, book });
  });
  if (!done.ok) return done;
  const { index, book } = done.value;
  await record(deps, owner, 'proposals.reject', fileId, [index.id, ...targetIds(index)], 'rejected', index.id);
  await proposalWebhooks(deps, owner.userId, 'proposal.answered', index);
  return ok({ book });
});

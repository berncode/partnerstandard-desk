import {
  copyMarket as copyMarketDomain, marketDisplayName, marketInfoSchema, MARKET_INFO_FIXED, newId, newMarket, newMarketId,
  parseMarketChange, parseMarketChanges, toFieldErrors, type Market,
} from '@partner-desk/core';
import type { CreatedFile, Snapshot } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, ownerOf, type Actor } from './actor';
import type { Deps } from './deps';
import type { MarketListing } from './directory';
import { checkFeeds } from './program-links';
import { createFailed, FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, record, touchedIds, type CommandResult, type Failure } from './result';
import { ownCompanyOnly } from './own-company';

const id = z.string().min(1).max(64);
const companyIdSchema = z.string().regex(/^co_[0-9a-z]{10}$/);
const readInput = z.object({ marketId: id }).strict();
const changeInput = z.object({ marketId: id, change: z.unknown() }).strict();

/** What a person gives to start a market. The ids, the actor and the "copied from" note are the server's. */
const createInfo = marketInfoSchema
  .omit(Object.fromEntries(MARKET_INFO_FIXED.map((key) => [key, true])) as Record<(typeof MARKET_INFO_FIXED)[number], true>)
  .partial()
  .required({ marketName: true, partnerType: true, ourProduct: true, ourTargetCustomers: true })
  .strict();
const createInput = z.object({ companyId: companyIdSchema, info: createInfo }).strict();
const copyInput = z.object({ marketId: id, info: marketInfoSchema.pick({ marketName: true, partnerType: true }).strict() }).strict();

/**
 * Field errors from a failed `info` parse, only when every problem is a value the person typed (a missing text, one
 * that is too long). Zod's own English texts and paths like `_` never reach a user: any other problem gives none.
 */
function infoFieldErrors(error: z.ZodError): Record<string, string> | undefined {
  const own = (issue: z.core.$ZodIssue) =>
    issue.path[0] === 'info' && issue.path.length > 1 && (issue.code === 'too_small' || issue.code === 'too_big' || issue.code === 'custom');
  if (!error.issues.every(own)) return undefined;
  return toFieldErrors(new z.ZodError(error.issues.map((issue) => ({ ...issue, path: issue.path.slice(1) }))));
}

/** A market as read: its file's contents and the link that opens the file (for *Open in Google Sheets*). */
export type MarketRead = Snapshot<Market> & { fileUrl: string };

export async function readMarket(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MarketRead>> {
  const parsed = readInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await deps.directory.market(parsed.data.marketId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'markets.read', entry)) return FORBIDDEN;
  const read = await deps.markets.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  await record(deps, actor, 'markets.read', entry.fileId, [parsed.data.marketId]);
  return ok({ ...withIds(read.snapshot, parsed.data.marketId, entry.companyId), fileUrl: deps.markets.urlFor({ fileId: entry.fileId }) });
}

/** The market with the ids the directory names: `_meta` can be edited by hand. */
function withIds(snapshot: Snapshot<Market>, marketId: string, companyId: string): Snapshot<Market> {
  return { ...snapshot, value: { ...snapshot.value, info: { ...snapshot.value.info, marketId, companyId } } };
}

/**
 * Adds the market's file and its directory entry; when the directory fails, the new file is thrown away. A file the
 * store couldn't make comes back as a failure with its message.
 */
async function register(deps: Deps, actor: Actor, market: Market): Promise<{ ok: true; fileId: string } | Failure> {
  const { marketId, companyId } = market.info;
  let created: CreatedFile;
  try {
    created = await deps.markets.create(ownerOf(actor), market);
  } catch (error) {
    return createFailed(error);
  }
  try {
    await deps.directory.addMarket({
      marketId, companyId, ownerUserId: actor.userId, fileId: created.fileId, displayName: marketDisplayName(market.info),
    });
  } catch (error) {
    await deps.markets.discard({ fileId: created.fileId });
    throw error;
  }
  return { ok: true, fileId: created.fileId };
}

export const createMarket = ownCompanyOnly(async function createMarket(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ marketId: string; snapshot: Snapshot<Market> }>> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalid(infoFieldErrors(parsed.error));
  const { companyId, info } = parsed.data;
  const book = await deps.directory.partnerBook(companyId);
  if (!book || !isOwner(actor, book)) return NOT_FOUND_FILE;
  // A status given at the start is the person's decision as much as a change of it (agent proposals spec 5.2).
  if (!can(actor, 'markets.create', book, { kind: 'updateInfo', patch: info })) return FORBIDDEN;
  const feeds = await checkFeeds(deps, actor, companyId, info.feedsProgramId, async () => info.partnerType);
  if (feeds) return feeds;
  const marketId = newMarketId();
  const market = newMarket({ ...info, companyId, updatedBy: actorLabel(actor) }, marketId);
  const registered = await register(deps, actor, market);
  if (!registered.ok) return registered;
  await record(deps, actor, 'markets.create', registered.fileId, [marketId]);
  return ok({ marketId, snapshot: { value: market, issues: [] } });
});

export async function changeMarket(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ snapshot: Snapshot<Market>; entityId: string | null }>> {
  const parsed = changeInput.safeParse(input);
  if (!parsed.success) return invalid();
  const change = parseMarketChange(parsed.data.change);
  if (!change.ok) return invalid(change.fieldErrors);
  const { marketId } = parsed.data;
  const entry = await deps.directory.market(marketId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'markets.change', entry, change.change)) return FORBIDDEN;
  if (change.change.kind === 'updateInfo') {
    // The program the market feeds must be of its partner type: that costs a read of the market's file, only then.
    const feeds = await checkFeeds(deps, actor, entry.companyId, change.change.patch.feedsProgramId, async () => {
      const read = await deps.markets.read({ fileId: entry.fileId });
      return read.ok ? read.snapshot.value.info.partnerType : fromStore(read);
    });
    if (feeds) return feeds;
  }
  const out = await deps.markets.apply({ fileId: entry.fileId }, change.change, { now: deps.clock(), actor: actorLabel(actor) });
  if (!out.ok) return fromStore(out);
  const displayName = marketDisplayName(out.snapshot.value.info);
  if (change.change.kind === 'updateInfo' && displayName !== entry.displayName) {
    // Best effort, as in the Recruitment app: the file is saved either way, and the next rename puts the listed name right.
    try {
      await deps.directory.rename(marketId, displayName);
    } catch {
      try { deps.log('directory_rename_failed', { marketId }); } catch { /* logging must not throw either */ }
    }
  }
  await record(deps, actor, 'markets.change', entry.fileId, [marketId, ...touchedIds(change.change as { id?: string }, out.entityId)]);
  return ok({ snapshot: out.snapshot, entityId: out.entityId });
}

const importExclusionsInput = z.object({ marketId: id, changes: z.unknown() }).strict();

/**
 * Adds Exclusions to a market in one write, all or nothing (*Import from another market*): only adds of exclusions,
 * up to core's batch limit. Anything else goes through changeMarket.
 */
export async function importExclusions(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ snapshot: Snapshot<Market>; entityIds: Array<string | null> }>> {
  const parsed = importExclusionsInput.safeParse(input);
  if (!parsed.success) return invalid();
  const changes = parseMarketChanges(parsed.data.changes);
  if (!changes.ok) return invalid(changes.fieldErrors);
  if (changes.changes.some((c) => c.kind !== 'add' || c.entity !== 'exclusion')) return invalid();
  const { marketId } = parsed.data;
  const entry = await deps.directory.market(marketId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!changes.changes.every((change) => can(actor, 'markets.change', entry, change))) return FORBIDDEN;
  const out = await deps.markets.applyMany({ fileId: entry.fileId }, changes.changes, { now: deps.clock(), actor: actorLabel(actor) });
  if (!out.ok) return fromStore(out);
  await record(deps, actor, 'markets.change', entry.fileId, [marketId, ...out.entityIds.filter((x): x is string => x !== null)]);
  return ok({ snapshot: out.snapshot, entityIds: out.entityIds });
}

/** A new market from an existing one: its method content with new ids and every item flagged to check again. */
export async function copyMarket(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ marketId: string; snapshot: Snapshot<Market> }>> {
  const parsed = copyInput.safeParse(input);
  if (!parsed.success) return invalid(infoFieldErrors(parsed.error));
  const source = await deps.directory.market(parsed.data.marketId);
  if (!source || !isOwner(actor, source)) return NOT_FOUND_FILE;
  if (!can(actor, 'markets.copy', source)) return FORBIDDEN;
  const read = await deps.markets.read({ fileId: source.fileId });
  if (!read.ok) return fromStore(read);
  const marketId = newMarketId();
  const market = copyMarketDomain(
    // The directory says which company this is; the file can be edited by hand.
    { ...read.snapshot.value, info: { ...read.snapshot.value.info, companyId: source.companyId } },
    { ...parsed.data.info, updatedBy: actorLabel(actor) }, newId, marketId);
  const registered = await register(deps, actor, market);
  if (!registered.ok) return registered;
  await record(deps, actor, 'markets.copy', registered.fileId, [marketId, parsed.data.marketId]);
  return ok({ marketId, snapshot: { value: market, issues: [] } });
}

const listInput = z.object({ companyId: companyIdSchema }).strict();

/** The markets of one company that this person owns, archived ones included (they carry a flag). Anyone else gets an empty list. */
export const listMarkets = ownCompanyOnly(async function listMarkets(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<MarketListing[]>> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalid();
  const book = await deps.directory.partnerBook(parsed.data.companyId);
  if (!book || !isOwner(actor, book)) return ok([]);
  if (!can(actor, 'markets.list', book)) return FORBIDDEN;
  const all = await deps.directory.markets(parsed.data.companyId);
  const mine = all.filter((m) => isOwner(actor, m));
  await record(deps, actor, 'markets.list', book.fileId, mine.map((m) => m.marketId));
  return ok(mine);
});

const archiveInput = z.object({ marketId: id, archived: z.boolean() }).strict();

/**
 * Archives a market (it leaves the Markets screen) or brings it back. Only the directory changes, never the file, so
 * a market whose file is gone can be archived too. A person only, never an agent.
 */
export async function archiveMarket(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ marketId: string; archived: boolean }>> {
  const parsed = archiveInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { marketId, archived } = parsed.data;
  const entry = await deps.directory.market(marketId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'markets.archive', entry)) return FORBIDDEN;
  await deps.directory.setArchived(marketId, archived ? deps.clock() : null);
  await record(deps, actor, 'markets.archive', entry.fileId, [marketId]);
  return ok({ marketId, archived });
}

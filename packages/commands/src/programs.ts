import {
  marketTypeOfDisplayName, newProgram, OUT, parseCompanyFacts, parseProgram, programFromMarket, programLabel, PROGRAM_TYPES,
  programSheet, publicBlocks, publicPlain, randomSuffix, TYPE, type CompanyFacts, type Market, type MarketChange, type OutKey, type Program, type ProgramType,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { StoreFailure, type CreatedFile, type Snapshot } from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, ownerOf, type Actor } from './actor';
import type { Deps } from './deps';
import type { ProgramEntry } from './directory';
import { createFailed, FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, record, type CommandResult, type Failure } from './result';
import { factsEntry, logQuietly, refused, refusedIssues } from './shared';
import { ownCompanyOnly } from './own-company';

const id = z.string().min(1).max(64);
const companyId = z.string().regex(/^co_[0-9a-z]{10}$/);
/** A record as the screen sent it. Its fields are checked by `parseProgram` and `parseCompanyFacts`. */
const plainRecord = z.record(z.string(), z.unknown());
const updatedAt = z.string().max(64).nullable();

const companyInput = z.object({ companyId }).strict();
const programInput = z.object({ programId: id }).strict();
const saveFactsInput = z.object({ companyId, facts: plainRecord, base: plainRecord, expectedUpdatedAt: updatedAt }).strict();
const saveProgramInput = z.object({ programId: id, program: plainRecord, base: plainRecord, expectedUpdatedAt: updatedAt }).strict();
const createInput = z.object({
  companyId,
  partnerType: z.string().max(64),
  from: z.union([z.literal('fresh'), z.object({ copyOf: id }).strict(), z.object({ marketId: id }).strict()]),
}).strict();

/** Program Designer's longest program name. A default name ("{company} Value Added Distributor Program") is cut to it. */
const MAX_NAME = 80;

const newProgramId = (): string => `pg_${randomSuffix(10)}`;

/** A record as read, with the link that opens its file (*Open in Google Sheets*). */
export type FileRead<T> = Snapshot<T> & { fileUrl: string };

// ---------------------------------------------------------------------------------------------------------------------
// Company facts

/** Reads the company's facts. The first read for a company makes the file, but only for a person. */
export const readCompanyFacts = ownCompanyOnly(async function readCompanyFacts(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<FileRead<CompanyFacts>>> {
  const parsed = companyInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await factsEntry(deps, actor, parsed.data.companyId);
  if (!entry.ok) return entry;
  if (!can(actor, 'companyFacts.read', entry)) return FORBIDDEN;
  const read = await deps.companyFacts.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  await record(deps, actor, 'companyFacts.read', entry.fileId, []);
  return ok({ ...read.snapshot, fileUrl: deps.companyFacts.urlFor({ fileId: entry.fileId }) });
});

/**
 * Saves the facts whole. `base` is the facts as the screen read them and `expectedUpdatedAt` their Updated: the store
 * refuses with a conflict when the file changed since, in the app or by hand.
 */
export const saveCompanyFacts = ownCompanyOnly(async function saveCompanyFacts(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<Snapshot<CompanyFacts>>> {
  const parsed = saveFactsInput.safeParse(input);
  if (!parsed.success) return invalid();
  const entry = await deps.directory.companyFacts(parsed.data.companyId);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'companyFacts.save', entry)) return FORBIDDEN;
  const facts = parseCompanyFacts(parsed.data.facts);
  if (!facts.ok) return refusedIssues(facts.issues);
  const { base, expectedUpdatedAt } = parsed.data;
  const out = await deps.companyFacts.apply(
    { fileId: entry.fileId }, { kind: 'save', facts: facts.company, base: base as unknown as CompanyFacts, expectedUpdatedAt },
    { now: deps.clock(), actor: actorLabel(actor) },
  );
  if (!out.ok) return fromStore(out);
  await record(deps, actor, 'companyFacts.save', entry.fileId, []);
  return ok(out.snapshot);
});

// ---------------------------------------------------------------------------------------------------------------------
// Programs

/** The program's directory row, when it is this person's. Anyone else gets the answer for a program that isn't there. */
async function ownProgram(deps: Deps, actor: Actor, programId: string): Promise<ProgramEntry | null> {
  const entry = await deps.directory.program(programId);
  return entry && isOwner(actor, entry) ? entry : null;
}

export interface ProgramListItem {
  programId: string;
  /** "Reseller · DACH" (`programLabel`), as the directory lists it. */
  label: string;
  partnerType: ProgramType;
}

/** The company's programs that this person owns, oldest first, from the directory only (no file is read). */
export const listPrograms = ownCompanyOnly(async function listPrograms(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<ProgramListItem[]>> {
  const parsed = companyInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'programs.list', { ownerUserId: actor.userId })) return FORBIDDEN;
  const mine = (await deps.directory.programs(parsed.data.companyId)).filter((p) => isOwner(actor, p));
  if (mine.length === 0) return ok([]);
  // No one file: the event names the programs.
  await record(deps, actor, 'programs.list', '', mine.map((p) => p.programId));
  return ok(mine.map((p) => ({ programId: p.programId, label: p.displayName, partnerType: p.partnerType })));
});

export async function readProgram(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<FileRead<Program>>> {
  const parsed = programInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { programId } = parsed.data;
  const entry = await ownProgram(deps, actor, programId);
  if (!entry) return NOT_FOUND_FILE;
  if (!can(actor, 'programs.read', entry)) return FORBIDDEN;
  const read = await deps.programs.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  await record(deps, actor, 'programs.read', entry.fileId, [programId]);
  return ok({ ...read.snapshot, fileUrl: deps.programs.urlFor({ fileId: entry.fileId }) });
}

const isProgramType = (type: string): type is ProgramType => (PROGRAM_TYPES as string[]).includes(type);
const isOutKey = (type: string): type is OutKey => Object.hasOwn(OUT, type);

/** Whether the market a program started from now feeds it: `none` when it didn't start from a market. */
export type MarketLink = 'made' | 'failed' | 'none';

export interface CreatedProgram {
  programId: string;
  snapshot: Snapshot<Program>;
  fileUrl: string;
  marketLink: MarketLink;
  /** Set when the market link couldn't be made: the sentence the screen shows. */
  message?: string;
}

/**
 * A new program of a partner type (Add a program): fresh, a copy of one of the person's programs, or started from
 * one of the person's markets of that type (spec 4.3). A market start also makes the market feed the new program,
 * a second file: the program is made first, then the market is changed. When that change fails, the program is
 * kept and the answer says the link wasn't made [builder's call]. The Company facts file is made first when there is
 * none (by a person only, as `readCompanyFacts`).
 */
export const createProgram = ownCompanyOnly(async function createProgram(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<CreatedProgram>> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { companyId: company, partnerType: given, from } = parsed.data;
  if (!isProgramType(given)) return refused('partnerType', isOutKey(given) ? OUT[given] : COPY.PROGRAM_PICK_TYPE);
  const type = given;
  const facts = await factsEntry(deps, actor, company);
  if (!facts.ok) return facts;
  if (!can(actor, 'programs.create', facts)) return FORBIDDEN;

  // What the program starts from, checked before anything is made.
  let source: { program: Program } | { market: OwnMarket } | null = null;
  let sourceId: string | null = null;
  if (typeof from === 'object' && 'copyOf' in from) {
    const entry = await ownProgram(deps, actor, from.copyOf);
    if (!entry || entry.companyId !== company) return NOT_FOUND_FILE;
    if (!can(actor, 'programs.read', entry)) return FORBIDDEN;
    // A copy keeps its partner type (owner, 2026-10-30).
    if (entry.partnerType !== type) return refused('from', COPY.PROGRAM_COPY_OTHER_TYPE);
    const read = await deps.programs.read({ fileId: entry.fileId });
    if (!read.ok) return fromStore(read);
    source = { program: read.snapshot.value };
    sourceId = from.copyOf;
  } else if (typeof from === 'object') {
    const market = await readOwnMarket(deps, actor, company, from.marketId);
    if (!market.ok) return market;
    if (market.market.info.partnerType !== type) return refused('from', COPY.MARKET_OTHER_TYPE);
    source = { market };
    sourceId = from.marketId;
  }

  const factsRead = await deps.companyFacts.read({ fileId: facts.fileId });
  if (!factsRead.ok) return fromStore(factsRead);
  // The company the directory names: a program belongs to it, whatever the facts file says.
  const companyFacts = { ...factsRead.snapshot.value, id: company };
  const { name: companyName } = await deps.companies.forUser(actor.userId);
  const programId = newProgramId();
  const ids = { id: programId, companyName };
  const draft = source === null ? newProgram(type, companyFacts, ids)
    : 'program' in source ? newProgram(type, companyFacts, ids, source.program)
    : programFromMarket(type, companyFacts, source.market.market, ids);
  draft.name = draft.name.slice(0, MAX_NAME).trim();
  const checked = parseProgram(draft);
  if (!checked.ok) return refusedIssues(checked.issues);
  const program = checked.program;

  let created: CreatedFile;
  try {
    created = await deps.programs.create(ownerOf(actor), company, program);
  } catch (error) {
    return createFailed(error);
  }
  try {
    await deps.directory.addProgram({
      programId, companyId: company, ownerUserId: actor.userId, fileId: created.fileId, displayName: programLabel(program), partnerType: type,
    });
  } catch (error) {
    await deps.programs.discard({ fileId: created.fileId });
    throw error;
  }
  await record(deps, actor, 'programs.create', created.fileId, sourceId ? [programId, sourceId] : [programId]);

  const answer: CreatedProgram = { programId, snapshot: { value: program, issues: [] }, fileUrl: created.fileUrl, marketLink: 'none' };
  if (source === null || !('market' in source)) return ok(answer);
  const { marketId, fileId: marketFileId } = source.market;
  if (await linkMarket(deps, actor, marketId, marketFileId, programId)) return ok({ ...answer, marketLink: 'made' });
  logQuietly(deps, 'program_market_link_failed', { programId, marketId });
  return ok({ ...answer, marketLink: 'failed', message: COPY.MARKET_LINK_NOT_MADE });
});

interface OwnMarket {
  ok: true;
  marketId: string;
  fileId: string;
  market: Market;
}

/** The market change that sets its Feeds program: what `can` judges before the program exists, and what is written after. */
const feedsChange = (programId: string | null): MarketChange => ({ kind: 'updateInfo', patch: { feedsProgramId: programId } });

/** One of this company's markets that the person owns and may change, read. */
async function readOwnMarket(deps: Deps, actor: Actor, company: string, marketId: string): Promise<OwnMarket | Failure> {
  const entry = await deps.directory.market(marketId);
  if (!entry || entry.companyId !== company || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  // The market will feed the new program: a change to the market as well.
  if (!can(actor, 'markets.read', entry) || !can(actor, 'markets.change', entry, feedsChange(null))) return FORBIDDEN;
  const read = await deps.markets.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  return { ok: true, marketId, fileId: entry.fileId, market: read.snapshot.value };
}

/** Sets the market's Feeds program. False when the store refused or failed; the program stays either way. */
async function linkMarket(deps: Deps, actor: Actor, marketId: string, fileId: string, programId: string): Promise<boolean> {
  try {
    const out = await deps.markets.apply({ fileId }, feedsChange(programId), { now: deps.clock(), actor: actorLabel(actor) });
    if (!out.ok) return false;
  } catch (error) {
    if (error instanceof StoreFailure) return false;
    throw error;
  }
  await record(deps, actor, 'markets.change', fileId, [marketId]);
  return true;
}

/** The partners of the company's Partners file that are in this program: all of them, and those at Preferred. */
async function partnersIn(deps: Deps, actor: Actor, company: string, programId: string): Promise<{ ok: true; all: number; pref: number } | Failure> {
  const book = await deps.directory.partnerBook(company);
  if (!book || !isOwner(actor, book)) return { ok: true, all: 0, pref: 0 };
  const read = await deps.partnerBooks.read({ fileId: book.fileId });
  if (!read.ok) return fromStore(read);
  const inIt = read.snapshot.value.partners.filter((p) => p.programId === programId);
  return { ok: true, all: inIt.length, pref: inIt.filter((p) => p.level === 'pref').length };
}

/**
 * Why a save with another partner type is refused. When the screen read that type too (its base has it), the type was
 * typed over in the sheet, so the sentence says where to put it back [builder's call]; otherwise the type can't change.
 */
function typeChangedMessage(sent: unknown, read: unknown, fixed: ProgramType): string {
  const fromSheet = sent === read && typeof sent === 'string' && Object.hasOwn(TYPE, sent);
  return fromSheet ? COPY.PROGRAM_TYPE_CHANGED_IN_SHEET(TYPE[sent as keyof typeof TYPE], TYPE[fixed]) : COPY.PROGRAM_TYPE_FIXED;
}

/**
 * Saves a program whole, with the store's conflict checks (`base`, `expectedUpdatedAt`). Its partner type can't
 * change, and Preferred can't be removed while partners sit at it (Review Focus 2). The directory's label follows the
 * saved program, best effort. The outputs are not rewritten here: the screen asks for that (`refreshProgramOutputs`).
 */
export async function saveProgram(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ snapshot: Snapshot<Program> }>> {
  const parsed = saveProgramInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { programId, base, expectedUpdatedAt } = parsed.data;
  const entry = await ownProgram(deps, actor, programId);
  if (!entry) return NOT_FOUND_FILE;
  if (!can(actor, 'programs.save', entry)) return FORBIDDEN;
  // The type first: a new type also breaks other answers (its pay model), and this is the sentence that helps.
  if (parsed.data.program.type !== entry.partnerType) return refused('type', typeChangedMessage(parsed.data.program.type, base.type, entry.partnerType));
  const checked = parseProgram(parsed.data.program);
  if (!checked.ok) return refusedIssues(checked.issues);
  const program = checked.program;
  if (base.prefOn === true && !program.prefOn) {
    const partners = await partnersIn(deps, actor, entry.companyId, programId);
    if (!partners.ok) return partners;
    if (partners.pref > 0) return refused('prefOn', COPY.PREFERRED_IN_USE(partners.pref, program.prefName, program.regName));
  }
  const out = await deps.programs.apply(
    { fileId: entry.fileId }, { kind: 'save', program, base: base as unknown as Program, expectedUpdatedAt },
    { now: deps.clock(), actor: actorLabel(actor) },
  );
  if (!out.ok) return fromStore(out);
  const label = programLabel(out.snapshot.value);
  if (label !== entry.displayName) {
    // Best effort, as for a market: the file is saved either way, and the next save puts the listed label right.
    try {
      await deps.directory.renameProgram(programId, label);
    } catch {
      logQuietly(deps, 'directory_rename_failed', { programId });
    }
  }
  await record(deps, actor, 'programs.save', entry.fileId, [programId]);
  return ok({ snapshot: out.snapshot });
}

/**
 * How many of the company's markets feed the program. Archived markets are left out [builder's call], and so are
 * markets listed for another partner type: a market feeds only a program of its own type, so they are not read.
 */
async function marketsFeeding(
  deps: Deps, actor: Actor, company: string, programId: string, type: ProgramType,
): Promise<{ ok: true; count: number } | Failure> {
  let count = 0;
  for (const listed of await deps.directory.markets(company)) {
    if (listed.archived || !isOwner(actor, listed)) continue;
    // A listed name that names no type (never, unless the directory changed) is read, to be safe.
    if ((marketTypeOfDisplayName(listed.displayName) ?? type) !== type) continue;
    const entry = await deps.directory.market(listed.marketId);
    if (!entry) continue;
    // One read per market, one after another (Google allows about 60 a minute; reads are cached for a minute).
    const read = await deps.markets.read({ fileId: entry.fileId });
    if (!read.ok) {
      // A market whose file is gone feeds nothing. Any other trouble: we can't tell, so nothing is deleted.
      if (read.error === 'file_not_found') continue;
      return fromStore(read);
    }
    if (read.snapshot.value.info.feedsProgramId === programId) count++;
  }
  return { ok: true, count };
}

/**
 * Deletes a program: its file goes to the person's Drive trash, and its directory row goes. A decision: a person
 * only. Refused while partners or markets point to it, with the counts (Review Focus 1); that costs a read of the
 * Partners file and one of each of the company's open markets of the program's type.
 */
export async function deleteProgram(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ programId: string }>> {
  const parsed = programInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { programId } = parsed.data;
  const entry = await ownProgram(deps, actor, programId);
  if (!entry) return NOT_FOUND_FILE;
  if (!can(actor, 'programs.delete', entry)) return FORBIDDEN;
  const partners = await partnersIn(deps, actor, entry.companyId, programId);
  if (!partners.ok) return partners;
  const markets = await marketsFeeding(deps, actor, entry.companyId, programId, entry.partnerType);
  if (!markets.ok) return markets;
  if (partners.all > 0 || markets.count > 0) return { ok: false, error: 'invalid', message: COPY.PROGRAM_IN_USE(partners.all, markets.count) };
  // The row goes first: if that fails, nothing is trashed. Trashing is best effort; a file left over stays in Drive.
  await deps.directory.removeProgram(programId);
  await deps.programs.trash({ fileId: entry.fileId });
  await record(deps, actor, 'programs.delete', entry.fileId, [programId]);
  return ok({ programId });
}

/**
 * Rewrites the program's Program Sheet and Public page tabs from the program, the Company facts and the company's
 * name. A store failure (Google not answering, the file gone) comes back as a result; anything else is a bug and is
 * thrown on.
 */
export async function refreshProgramOutputs(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ programId: string }>> {
  const parsed = programInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { programId } = parsed.data;
  const entry = await ownProgram(deps, actor, programId);
  if (!entry) return NOT_FOUND_FILE;
  if (!can(actor, 'programs.refreshOutputs', entry)) return FORBIDDEN;
  const read = await deps.programs.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const facts = await factsEntry(deps, actor, entry.companyId);
  if (!facts.ok) return facts;
  const factsRead = await deps.companyFacts.read({ fileId: facts.fileId });
  if (!factsRead.ok) return fromStore(factsRead);
  const program = read.snapshot.value;
  const companyFacts = factsRead.snapshot.value;
  const { name } = await deps.companies.forUser(actor.userId);
  try {
    await deps.programs.writeOutputs(
      // A company without a name reads as the screens show it.
      { fileId: entry.fileId }, programSheet(companyFacts, program, name.trim() || COPY.COMPANY_UNNAMED),
      publicPlain(publicBlocks(companyFacts, program)),
    );
  } catch (error) {
    return createFailed(error);
  }
  await record(deps, actor, 'programs.refreshOutputs', entry.fileId, [programId]);
  return ok({ programId });
}

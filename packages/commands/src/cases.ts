// openSharedCase is built on the directory and the partner's side of a case.
import {
  newBusinessCase, parseCase, partnerSide, pickProgram, randomSuffix, recalculateCase as recalculate,
  type BusinessCase, type CaseSources, type IsoDateTime, type Partner, type PartnerBook, type PartnerCaseView, type Program,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import {
  ReconnectRequired, StoreFailure, type CaseStore, type MapStore, type PartnerBookStore, type Snapshot,
} from '@partner-desk/storage';
import { z } from 'zod';
import { can } from './access';
import { actorLabel, ownerOf, type Actor } from './actor';
import type { CompanyNameLookup, CompanyNames } from './companies';
import { type Deps, wordsOf } from './deps';
import type { CaseEntry, CaseListing, Directory, ReviewLinks, ShareLinks } from './directory';
import type { FileRead } from './programs';
import { factsEntry, isStorageFailure, logQuietly, reasonOf, refused, refusedIssues, removeCases } from './shared';
import { createFailed, FORBIDDEN, fromStore, invalid, isOwner, NOT_FOUND_FILE, ok, record, type CommandResult, type Failure } from './result';
import { hashToken, isToken, newShareLinkId, newToken } from './share-tokens';
import { ownCompanyOnly } from './own-company';

const id = z.string().min(1).max(64);
const companyId = z.string().regex(/^co_[0-9a-z]{10}$/);
/** A case as the screen sent it. Its fields are checked by `parseCase`. */
const plainRecord = z.record(z.string(), z.unknown());
const updatedAt = z.string().max(64).nullable();

const listInput = z.object({ companyId, partnerId: id.optional() }).strict();
const caseInput = z.object({ caseId: id }).strict();
const createInput = z.object({ companyId, partnerId: id, programId: id.optional() }).strict();
const saveInput = z.object({ caseId: id, case: plainRecord, base: plainRecord, expectedUpdatedAt: updatedAt }).strict();
const recalculateInput = z.object({ caseId: id, expectedUpdatedAt: updatedAt, programId: id.optional() }).strict();

/** The file changed since the screen read it: nothing is written. */
const CONFLICT: Failure = { ok: false, error: 'conflict', message: COPY.CONFLICT };
const TYPE_GONE: Failure = { ok: false, error: 'invalid', message: COPY.CASE_TYPE_GONE };
/**
 * The case isn't in the directory, or isn't this person's: removed with its partner type (its file maybe kept), deleted,
 * or never there (owner, 2026-10-30). A listed case whose file is gone shows the store's COPY.FILE_GONE text (`fromStore`) instead.
 */
/** No longer in the directory, in the words of where the work lives. */
const notListed = (deps: Deps): Failure => ({ ok: false, error: 'file_not_found', message: wordsOf(deps).CASE_NOT_LISTED });
/** The file has rows that can't be read: the partner's page would only say the case can't be shown (`openSharedCase`). */
const ROWS_UNREADABLE: Failure = { ok: false, error: 'invalid', message: COPY.CASE_SHARE_ROWS_UNREADABLE };

const newCaseId = (): string => `case_${randomSuffix(12)}`;
const newLineId = (): string => `line_${randomSuffix(12)}`;
const newCostId = (): string => `cost_${randomSuffix(12)}`;
const newReasonId = (): string => `reason_${randomSuffix(12)}`;

/** The Business Case app's longest name: a partner's name is cut to it. */
const MAX_NAME = 80;

/** The case's directory row, when it is this person's. Anyone else gets the answer for a case that isn't there. */
async function ownCase(deps: Deps, actor: Actor, caseId: string): Promise<CaseEntry | null> {
  const entry = await deps.directory.businessCase(caseId);
  return entry && isOwner(actor, entry) ? entry : null;
}

/** The company's name as it is now, else `stored` (a company without a name yet). A case shows it, never edits it. */
async function companyName(companies: Pick<CompanyNames, 'forUser'>, userId: string, stored: string): Promise<string> {
  const { name } = await companies.forUser(userId);
  return name.trim() || stored;
}

const withCompany = (c: BusinessCase, company: string): BusinessCase =>
  (company === c.offer.company ? c : { ...c, offer: { ...c.offer, company } });

/**
 * The partner's name in Partners now (owner, 2026-10-30): the account of the case's partner type, found by the
 * directory's partner type id and type. Null when the partner type is gone from Partners or its account has no name.
 */
function nameIn(book: PartnerBook, of: Pick<CaseEntry, 'partnerId' | 'partnerType'>): string | null {
  const row = book.partners.find((p) => p.id === of.partnerId && p.partnerType === of.partnerType);
  const account = row ? book.accounts.find((a) => a.id === row.accountId) : undefined;
  return (account?.company ?? '').trim().slice(0, MAX_NAME).trim() || null;
}

/** The partner's name in Partners now; `stored`, the name the case file holds, when Partners can't be read or has no name for it. */
async function partnerName(deps: Deps, actor: Actor, entry: CaseEntry, stored: string): Promise<string> {
  const book = await readBook(deps, actor, entry.companyId);
  return (book.ok ? nameIn(book.book, entry) : null) ?? stored;
}

/**
 * The case as the screens show it: the company and the partner named as they are now, and the partner type the
 * directory lists, never a hand edit of the file's (final review). Reads Partners (usually cached).
 */
async function named(deps: Deps, actor: Actor, entry: CaseEntry, c: BusinessCase): Promise<BusinessCase> {
  const company = await companyName(deps.companies, entry.ownerUserId, c.offer.company);
  const partner = await partnerName(deps, actor, entry, c.partner);
  return { ...withCompany(c, company), partner, partnerId: entry.partnerId, partnerType: entry.partnerType };
}

/** The company's Partners file, read, when it is this person's. */
async function readBook(deps: Deps, actor: Actor, company: string): Promise<{ ok: true; book: PartnerBook } | Failure> {
  const entry = await deps.directory.partnerBook(company);
  if (!entry || !isOwner(actor, entry)) return NOT_FOUND_FILE;
  if (!can(actor, 'partners.read', entry)) return FORBIDDEN;
  const read = await deps.partnerBooks.read({ fileId: entry.fileId });
  return read.ok ? { ok: true, book: read.snapshot.value } : fromStore(read);
}

/** The programs this company's markets linked to the partner type feed, in link order. A market whose file is gone feeds none. */
async function fedPrograms(deps: Deps, actor: Actor, company: string, book: PartnerBook, partnerId: string): Promise<{ ok: true; ids: string[] } | Failure> {
  const ids: string[] = [];
  for (const link of book.marketLinks.filter((l) => l.partnerId === partnerId)) {
    const entry = await deps.directory.market(link.marketId);
    if (!entry || entry.companyId !== company || !isOwner(actor, entry) || !can(actor, 'markets.read', entry)) continue;
    // One read per market, one after another (Google allows about 60 a minute; reads are cached for a minute).
    const read = await deps.markets.read({ fileId: entry.fileId });
    if (!read.ok) {
      if (read.error === 'file_not_found') continue;
      return fromStore(read);
    }
    const fed = read.snapshot.value.info.feedsProgramId;
    if (fed) ids.push(fed);
  }
  return { ok: true, ids };
}

/** Reads a program's file. `gone` when the file is gone (trashed by hand while the directory still lists it). */
async function readProgramFile(deps: Deps, actor: Actor, programId: string): Promise<{ ok: true; program: Program | null } | Failure> {
  const entry = await deps.directory.program(programId);
  if (!entry || !isOwner(actor, entry)) return { ok: true, program: null };
  if (!can(actor, 'programs.read', entry)) return FORBIDDEN;
  const read = await deps.programs.read({ fileId: entry.fileId });
  if (read.ok) return { ok: true, program: read.snapshot.value };
  return read.error === 'file_not_found' ? { ok: true, program: null } : fromStore(read);
}

/**
 * The program a case is filled from (spec 5.2), read: the one the person picked, which must be one of this company's
 * programs of the partner type; else the program the partner type is in; else the first a linked market feeds; else,
 * when the type has programs, the person picks (`keep`, the case's own program, when it is still one of them); else
 * none. A program whose file is gone (trashed by hand while the directory still lists it) counts as gone, and the
 * choice is made again without it (Review Focus 1). Any other trouble reading it is passed on.
 */
async function programFor(
  deps: Deps, actor: Actor, company: string, partner: Partner, book: PartnerBook, given: string | undefined, keep: string | null,
): Promise<{ ok: true; program: Program | null } | Failure> {
  if (given !== undefined) {
    const entry = await deps.directory.program(given);
    if (!entry || entry.companyId !== company || !isOwner(actor, entry)) return refused('programId', COPY.PROGRAM_NOT_FOUND);
    if (entry.partnerType !== partner.partnerType) return refused('programId', COPY.PROGRAM_OTHER_TYPE);
    const read = await readProgramFile(deps, actor, given);
    if (read.ok && read.program === null) return refused('programId', COPY.PROGRAM_NOT_FOUND);
    return read;
  }
  const listed = (await deps.directory.programs(company)).filter((p) => isOwner(actor, p));
  const gone = new Set<string>();
  let fed: string[] | null = null;
  // Each round either reads a program or leaves one more out, so it ends.
  for (;;) {
    const programs = listed.filter((p) => !gone.has(p.programId));
    const linked = partner.programId !== null && !gone.has(partner.programId) ? partner.programId : null;
    const inLinked = linked !== null && programs.some((p) => p.programId === linked && p.partnerType === partner.partnerType);
    // The markets are read only when the partner type's own program doesn't decide, and once.
    if (!inLinked && fed === null) {
      const found = await fedPrograms(deps, actor, company, book, partner.id);
      if (!found.ok) return found;
      fed = found.ids;
    }
    const picked = pickProgram(partner.partnerType, linked, (fed ?? []).filter((id) => !gone.has(id)), programs);
    let programId: string;
    if (picked.kind === 'one') programId = picked.programId;
    else if (picked.kind === 'none') return { ok: true, program: null };
    else if (keep !== null && picked.programIds.includes(keep)) programId = keep;
    else return refused('programId', COPY.CASE_PICK_PROGRAM);
    const read = await readProgramFile(deps, actor, programId);
    if (!read.ok || read.program !== null) return read;
    gone.add(programId);
  }
}

/** The company's Company facts, made on the first read (by a person only), with the company the directory names. */
async function readFacts(deps: Deps, actor: Actor, company: string) {
  const entry = await factsEntry(deps, actor, company);
  if (!entry.ok) return entry;
  if (!can(actor, 'companyFacts.read', entry)) return FORBIDDEN;
  const read = await deps.companyFacts.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  return { ok: true as const, facts: { ...read.snapshot.value, id: company } };
}

// ---------------------------------------------------------------------------------------------------------------------
// Reads

export interface CaseListItem {
  caseId: string;
  /** The case's title, as the directory lists it. */
  title: string;
  partnerId: string;
  partnerType: CaseListing['partnerType'];
  createdAt: IsoDateTime;
}

/**
 * The company's business cases that this person owns, newest first, from the directory only (no file is read): the
 * Business cases page, or one partner type's cases on its tab.
 */
export const listCases = ownCompanyOnly(async function listCases(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<CaseListItem[]>> {
  const parsed = listInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'cases.list', { ownerUserId: actor.userId })) return FORBIDDEN;
  const { partnerId } = parsed.data;
  const mine = (await deps.directory.businessCases(parsed.data.companyId))
    .filter((c) => isOwner(actor, c) && (partnerId === undefined || c.partnerId === partnerId));
  if (mine.length === 0) return ok([]);
  // No one file: the event names the cases.
  await record(deps, actor, 'cases.list', '', mine.map((c) => c.caseId));
  return ok(mine.map((c) => ({ caseId: c.caseId, title: c.displayName, partnerId: c.partnerId, partnerType: c.partnerType, createdAt: c.createdAt })));
});

export type CaseRead = FileRead<BusinessCase> & {
  /** The share link that works now, if any. The case's own `shared` stamp is kept as the Business Case app keeps it. */
  shared: { createdAt: IsoDateTime } | null;
};

/**
 * Reads a case, named with the company's name as it is now (BC v2 section 14) and the partner's name in Partners now
 * (owner, 2026-10-30), for the partner type the directory lists.
 */
export async function readCase(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<CaseRead>> {
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId } = parsed.data;
  const entry = await ownCase(deps, actor, caseId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.read', entry)) return FORBIDDEN;
  const read = await deps.cases.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const c = await named(deps, actor, entry, read.snapshot.value);
  const shared = await deps.shareLinks.activeFor(entry.ownerUserId, caseId);
  await record(deps, actor, 'cases.read', entry.fileId, [caseId]);
  return ok({ ...read.snapshot, value: c, fileUrl: deps.cases.urlFor({ fileId: entry.fileId }), shared });
}

export interface CaseSourcesRead {
  /** When Company facts were saved after the case was made or last recalculated; else null. */
  factsChangedAt: IsoDateTime | null;
  /** When the case's program was saved after that; null too when the program is gone. */
  programChangedAt: IsoDateTime | null;
  /** The partner type is no longer in Partners (removed by hand): the case still opens, and can't be recalculated. */
  partnerTypeGone: boolean;
}

/**
 * What changed since the case was filled (spec 5.4): two dates and whether its partner type is still in Partners.
 * Reads Partners, Company facts and the program (three reads, usually cached). A file that is gone has no date.
 */
export async function readCaseSources(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<CaseSourcesRead>> {
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId } = parsed.data;
  const entry = await ownCase(deps, actor, caseId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.read', entry)) return FORBIDDEN;
  const read = await deps.cases.read({ fileId: entry.fileId });
  if (!read.ok) return fromStore(read);
  const c = read.snapshot.value;
  const since = c.recalculatedAt ?? c.createdAt;
  const after = (at: string | undefined): IsoDateTime | null => (at && at > since ? at : null);

  const book = await readBook(deps, actor, entry.companyId);
  if (!book.ok) return book;
  const partner = book.book.partners.find((p) => p.id === entry.partnerId);
  const partnerTypeGone = !partner || partner.partnerType !== entry.partnerType;

  let factsChangedAt: IsoDateTime | null = null;
  const facts = await deps.directory.companyFacts(entry.companyId);
  if (facts && isOwner(actor, facts)) {
    const factsRead = await deps.companyFacts.read({ fileId: facts.fileId });
    if (factsRead.ok) factsChangedAt = after(factsRead.snapshot.value.updatedAt);
    else if (factsRead.error !== 'file_not_found') return fromStore(factsRead);
  }

  let programChangedAt: IsoDateTime | null = null;
  const program = c.programId === null ? null : await deps.directory.program(c.programId);
  if (program && isOwner(actor, program)) {
    const programRead = await deps.programs.read({ fileId: program.fileId });
    if (programRead.ok) programChangedAt = after(programRead.snapshot.value.updatedAt);
    else if (programRead.error !== 'file_not_found') return fromStore(programRead);
  }
  await record(deps, actor, 'cases.read', entry.fileId, [caseId]);
  return ok({ factsChangedAt, programChangedAt, partnerTypeGone });
}

// ---------------------------------------------------------------------------------------------------------------------
// Writes

/** Lists a case's new file in the directory, or throws its file away. */
async function listNewCase(deps: Deps, entry: CaseEntry & { caseId: string }): Promise<void> {
  try {
    await deps.directory.addBusinessCase(entry);
  } catch (error) {
    await deps.cases.discard({ fileId: entry.fileId });
    throw error;
  }
}

/**
 * A new case for a partner type (New case), filled from Company facts and its program as spec 5.2 says. When the
 * partner type is in no program and its type has some, the person picks one (`programId`): even one alone. The
 * Company facts file is made first when there is none (by a person only). Never moves a stage (spec 5.6).
 */
export const createCase = ownCompanyOnly(async function createCase(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ caseId: string }>> {
  const parsed = createInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { companyId: company, partnerId, programId: given } = parsed.data;
  // Access first: reading Company facts may make their file.
  if (!can(actor, 'cases.create', { ownerUserId: actor.userId })) return FORBIDDEN;
  const facts = await readFacts(deps, actor, company);
  if (!facts.ok) return facts;
  const book = await readBook(deps, actor, company);
  if (!book.ok) return book;
  const partner = book.book.partners.find((p) => p.id === partnerId);
  if (!partner) return refused('partnerId', COPY.CASE_TYPE_GONE);
  const program = await programFor(deps, actor, company, partner, book.book, given, null);
  if (!program.ok) return program;

  const account = book.book.accounts.find((a) => a.id === partner.accountId);
  const now = deps.clock();
  const src: CaseSources = {
    companyName: await companyName(deps.companies, actor.userId, COPY.COMPANY_UNNAMED),
    partnerName: (account?.company ?? '').trim().slice(0, MAX_NAME).trim(),
    partnerId,
    partnerType: partner.partnerType,
    stage: partner.stage,
    // The partner type's level counts in its own program only.
    level: program.program && partner.programId === program.program.id ? partner.level : null,
    facts: facts.facts,
    program: program.program,
  };
  const caseId = newCaseId();
  const checked = parseCase(newBusinessCase(src, { caseId, lineId: newLineId }, now));
  if (!checked.ok) return refusedIssues(checked.issues);
  const c = checked.case;

  let fileId: string;
  try {
    fileId = (await deps.cases.create(ownerOf(actor), company, c)).fileId;
  } catch (error) {
    return createFailed(error);
  }
  await listNewCase(deps, {
    caseId, fileId, ownerUserId: actor.userId, companyId: company, partnerId, partnerType: c.partnerType, displayName: c.title, createdAt: c.createdAt,
  });
  await record(deps, actor, 'cases.create', fileId, c.programId ? [caseId, partnerId, c.programId] : [caseId, partnerId]);
  return ok({ caseId });
});

/**
 * The case to write: what the screen sent, with what the file decides kept from the file (the company it belongs to,
 * its program, when it was made and the stage then, when it was recalculated, its share stamp), the partner type the
 * directory lists (a hand edit of the file's is put back), and the company and the partner named as they are now.
 */
function keepFixed(
  sent: Record<string, unknown>, stored: BusinessCase, entry: CaseEntry, names: { company: string; partner: string },
): Record<string, unknown> {
  const offer = typeof sent.offer === 'object' && sent.offer !== null ? { ...sent.offer, company: names.company } : sent.offer;
  return {
    ...sent,
    offer,
    partner: names.partner,
    companyId: stored.companyId,
    partnerId: entry.partnerId,
    partnerType: entry.partnerType,
    programId: stored.programId,
    createdAt: stored.createdAt,
    stageWhenMade: stored.stageWhenMade,
    recalculatedAt: stored.recalculatedAt,
    shared: stored.shared,
  };
}

/** Renames the case's directory row after its title changed. Best effort: the next save puts it right. */
async function renameRow(deps: Deps, entry: CaseEntry, caseId: string, title: string): Promise<void> {
  if (title === entry.displayName) return;
  try {
    await deps.directory.renameBusinessCase(caseId, title);
  } catch {
    logQuietly(deps, 'directory_rename_failed', { caseId });
  }
}

/**
 * Saves a case whole, with the store's conflict checks (`base`, `expectedUpdatedAt`). What the case belongs to
 * (company, partner type), its program, when it was made and recalculated, and its share stamp come from the file and
 * the directory, never from the input; the file is read first for them. The partner is named as Partners names it now,
 * else as the file does. A new title renames the directory row.
 */
export async function saveCase(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ snapshot: Snapshot<BusinessCase> }>> {
  const parsed = saveInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId, expectedUpdatedAt } = parsed.data;
  const entry = await ownCase(deps, actor, caseId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.save', entry)) return FORBIDDEN;
  const stored = await storedCase(deps, entry);
  if (!stored.ok) return stored;
  const company = await companyName(deps.companies, entry.ownerUserId, stored.case.offer.company);
  const partner = await partnerName(deps, actor, entry, stored.case.partner);
  const checked = parseCase(keepFixed(parsed.data.case, stored.case, entry, { company, partner }));
  if (!checked.ok) return refusedIssues(checked.issues);
  // The screen read the case named as the company is now (`readCase`); the file may still hold the name it was saved
  // with. That alone is no change in the file.
  const sentOffer = parsed.data.base.offer as { company?: unknown } | undefined;
  const byCompany = sentOffer?.company === company
    ? { ...parsed.data.base, offer: { ...sentOffer, company: stored.case.offer.company } }
    : parsed.data.base;
  // The partner's name and partner type are never the screen's: this save writes them from Partners and the directory.
  // A base that differs there (read before a rename in Partners, or before a hand edit of the file's) is no conflict.
  const base = { ...byCompany, partner: stored.case.partner, partnerId: stored.case.partnerId, partnerType: stored.case.partnerType };
  const out = await deps.cases.apply(
    { fileId: entry.fileId },
    { kind: 'save', case: checked.case, base: base as unknown as BusinessCase, expectedUpdatedAt },
    { now: deps.clock(), actor: actorLabel(actor) },
  );
  if (!out.ok) return fromStore(out);
  await renameRow(deps, entry, caseId, out.snapshot.value.title);
  await record(deps, actor, 'cases.save', entry.fileId, [caseId]);
  return ok({ snapshot: out.snapshot });
}

/** Reads the case for a command that writes it from what it holds now. */
async function storedCase(deps: Deps, entry: CaseEntry): Promise<{ ok: true; case: BusinessCase } | Failure> {
  const read = await deps.cases.read({ fileId: entry.fileId });
  return read.ok ? { ok: true, case: read.snapshot.value } : fromStore(read);
}

/**
 * A copy of a case (spec 5.4): the same partner type and numbers, made today, titled "Copy of" the original's title
 * (owner, 2026-10-30), with its own line ids and no share link. Its numbers were filled when the original was, so
 * "changed since" keeps counting from then. Made today, it takes the stage the partner type has now in Partners and
 * the partner's name there (one read, usually cached) [controller's ruling R9]; when the partner type is gone from
 * Partners, or Partners can't be read, it keeps the original's. Its partner type is the directory's.
 */
export async function copyCase(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ caseId: string }>> {
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId: sourceId } = parsed.data;
  const entry = await ownCase(deps, actor, sourceId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.copy', entry)) return FORBIDDEN;
  const source = await storedCase(deps, entry);
  if (!source.ok) return source;
  const from = source.case;
  const book = await readBook(deps, actor, entry.companyId);
  const partner = book.ok ? book.book.partners.find((p) => p.id === entry.partnerId && p.partnerType === entry.partnerType) : undefined;
  const now = deps.clock();
  const caseId = newCaseId();
  const checked = parseCase({
    ...structuredClone(from),
    id: caseId,
    title: COPY.CASE_COPY_OF(from.title).slice(0, MAX_NAME).trim(),
    partner: (book.ok ? nameIn(book.book, entry) : null) ?? from.partner,
    partnerId: entry.partnerId,
    partnerType: entry.partnerType,
    createdAt: now,
    stageWhenMade: partner?.stage ?? from.stageWhenMade,
    recalculatedAt: from.recalculatedAt ?? from.createdAt,
    costs: from.costs.map((c) => ({ ...c, id: newCostId() })),
    ours: {
      ...structuredClone(from.ours),
      costs: from.ours.costs.map((c) => ({ ...c, id: newCostId() })),
      strategic: from.ours.strategic.map((r) => ({ ...r, id: newReasonId() })),
      alone: { ...structuredClone(from.ours.alone), costs: from.ours.alone.costs.map((c) => ({ ...c, id: newCostId() })) },
    },
    shared: null,
    updatedAt: now,
  });
  if (!checked.ok) return refusedIssues(checked.issues);
  const c = checked.case;
  let fileId: string;
  try {
    fileId = (await deps.cases.create(ownerOf(actor), entry.companyId, c)).fileId;
  } catch (error) {
    return createFailed(error);
  }
  await listNewCase(deps, {
    caseId, fileId, ownerUserId: actor.userId, companyId: entry.companyId, partnerId: entry.partnerId, partnerType: entry.partnerType,
    displayName: c.title, createdAt: c.createdAt,
  });
  await record(deps, actor, 'cases.copy', fileId, [caseId, sourceId]);
  return ok({ caseId });
}

/**
 * Update from Company facts and program (spec 5.4): fills the terms again from the program the partner type is in now,
 * else spec 5.2's order. When the person must pick, the case keeps its own program if it is still one of the type's;
 * else `programId` names it. A program that is gone is no program: the case says so, and never fails on its id
 * (Review Focus 1). Refused when the partner type is gone from Partners (Review Focus 2), and when the case changed
 * since `expectedUpdatedAt` (Review Focus 4).
 */
export async function recalculateCase(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ snapshot: Snapshot<BusinessCase>; programId: string | null }>> {
  const parsed = recalculateInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId, expectedUpdatedAt, programId: given } = parsed.data;
  const entry = await ownCase(deps, actor, caseId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.recalculate', entry)) return FORBIDDEN;
  const stored = await storedCase(deps, entry);
  if (!stored.ok) return stored;
  const c = stored.case;
  if ((expectedUpdatedAt ?? '') !== c.updatedAt) return CONFLICT;
  const book = await readBook(deps, actor, entry.companyId);
  if (!book.ok) return book;
  const partner = book.book.partners.find((p) => p.id === entry.partnerId);
  if (!partner || partner.partnerType !== entry.partnerType) return TYPE_GONE;
  const program = await programFor(deps, actor, entry.companyId, partner, book.book, given, c.programId);
  if (!program.ok) return program;
  const facts = await readFacts(deps, actor, entry.companyId);
  if (!facts.ok) return facts;

  const now = deps.clock();
  // Always the case's own partner type, partner type row and stage, as the directory lists them: never another type's,
  // nor a hand edit of the file's (recalculate reads the type from its sources). The partner as Partners names it now.
  const own: BusinessCase = { ...c, partner: nameIn(book.book, entry) ?? c.partner, partnerId: entry.partnerId, partnerType: entry.partnerType };
  const src: CaseSources = {
    companyName: c.offer.company,
    partnerName: own.partner,
    partnerId: own.partnerId,
    partnerType: own.partnerType,
    stage: c.stageWhenMade,
    level: program.program && partner.programId === program.program.id ? partner.level : null,
    facts: facts.facts,
    program: program.program,
  };
  const checked = parseCase(recalculate(own, src, { lineId: newLineId }, now));
  if (!checked.ok) return refusedIssues(checked.issues);
  const out = await deps.cases.apply(
    { fileId: entry.fileId }, { kind: 'save', case: checked.case, base: c, expectedUpdatedAt: c.updatedAt },
    { now, actor: actorLabel(actor) },
  );
  if (!out.ok) return fromStore(out);
  const programId = out.snapshot.value.programId;
  await record(deps, actor, 'cases.recalculate', entry.fileId, programId ? [caseId, programId] : [caseId]);
  return ok({ snapshot: out.snapshot, programId });
}

/**
 * Deletes a case: its link is turned off, its row goes and its file goes to the person's Drive trash. A decision: a
 * person only.
 */
export async function deleteCase(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ caseId: string }>> {
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId } = parsed.data;
  const entry = await ownCase(deps, actor, caseId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.delete', entry)) return FORBIDDEN;
  await removeCases(deps, actor, [{ caseId, fileId: entry.fileId }], 'trash');
  return ok({ caseId });
}

/** Writes the case's share stamp, over what was just read: a write made in between is not overwritten. */
async function stamp(deps: Deps, actor: Actor, entry: CaseEntry, c: BusinessCase, shared: BusinessCase['shared']) {
  return deps.cases.apply(
    { fileId: entry.fileId }, { kind: 'save', case: { ...c, shared }, base: c, expectedUpdatedAt: c.updatedAt },
    { now: deps.clock(), actor: actorLabel(actor) },
  );
}

/**
 * Shares a case by a secret link (BC v2 section 9): stamps it shared, turns its old link off and makes a new one. Gives
 * back the token, which only the owner's screen ever holds; the database keeps its hash. A decision: a person only.
 * A case whose partner type left its own offer, or whose file has rows that can't be read, is refused: its link could
 * only say it can't be shown.
 */
export async function shareCase(
  deps: Deps, actor: Actor, input: unknown,
): Promise<CommandResult<{ token: string; snapshot: Snapshot<BusinessCase> }>> {
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId } = parsed.data;
  const entry = await ownCase(deps, actor, caseId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.share', entry)) return FORBIDDEN;
  const stored = await deps.cases.read({ fileId: entry.fileId });
  if (!stored.ok) return fromStore(stored);
  const checked = parseCase(stored.snapshot.value);
  if (!checked.ok) return refusedIssues(checked.issues);
  if (stored.snapshot.issues.length > 0) return ROWS_UNREADABLE;
  let snapshot = stored.snapshot;
  if (!checked.case.shared) {
    const written = await stamp(deps, actor, entry, stored.snapshot.value, { sharedAt: deps.clock() });
    if (!written.ok) return fromStore(written);
    snapshot = written.snapshot;
  }
  const at = deps.clock();
  await deps.shareLinks.revokeCases(entry.ownerUserId, [caseId], at);
  const token = newToken();
  await deps.shareLinks.create({ id: newShareLinkId(), ownerUserId: entry.ownerUserId, caseId, tokenHash: hashToken(token), createdAt: at });
  await record(deps, actor, 'cases.share', entry.fileId, [caseId]);
  return ok({ token, snapshot: { ...snapshot, value: await named(deps, actor, entry, snapshot.value) } });
}

/** Stops sharing a case: its links stop working at once, then its stamp is cleared. */
export async function unshareCase(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ snapshot: Snapshot<BusinessCase> }>> {
  const parsed = caseInput.safeParse(input);
  if (!parsed.success) return invalid();
  const { caseId } = parsed.data;
  const entry = await ownCase(deps, actor, caseId);
  if (!entry) return notListed(deps);
  if (!can(actor, 'cases.unshare', entry)) return FORBIDDEN;
  await deps.shareLinks.revokeCases(entry.ownerUserId, [caseId], deps.clock());
  const stored = await deps.cases.read({ fileId: entry.fileId });
  if (!stored.ok) return fromStore(stored);
  let snapshot = stored.snapshot;
  if (stored.snapshot.value.shared) {
    const written = await stamp(deps, actor, entry, stored.snapshot.value, null);
    if (!written.ok) return fromStore(written);
    snapshot = written.snapshot;
  }
  await record(deps, actor, 'cases.unshare', entry.fileId, [caseId]);
  return ok({ snapshot: { ...snapshot, value: await named(deps, actor, entry, snapshot.value) } });
}

// ---------------------------------------------------------------------------------------------------------------------
// The partner's page

/** What a share link shows: the partner's side of the case as it is now, a link that doesn't work, or a case that can't be read now. */
export type SharedView = { kind: 'ok'; view: PartnerCaseView } | { kind: 'gone' } | { kind: 'unavailable' };

/** What the partner's pages need, without a session: the business case's share link, and a review's summary link. */
export interface ShareDeps {
  /** `activeFor`: which case a review's summary names the currency of, as the review page picks it. */
  shareLinks: Pick<ShareLinks, 'findActive' | 'activeFor'>;
  /** Held reviews' summary links (reviews spec 5.6): looked up only, never written by a visit. */
  reviewLinks: Pick<ReviewLinks, 'findActive'>;
  directory: Pick<Directory, 'businessCase' | 'businessCases' | 'partnerBook' | 'map'>;
  /** The company's name, read only: the partner's page never makes a company (ruling R8). */
  companies: CompanyNameLookup;
  /** The owner's case store, built without a session; null when the owner is gone. */
  casesFor(ownerUserId: string): Promise<CaseStore | null>;
  /** The owner's Partners store, read only, for the partner's name; built without a session, null when the owner is gone. */
  partnerBooksFor(ownerUserId: string): Promise<Pick<PartnerBookStore, 'read'> | null>;
  /** The owner's MAP store, read only, for a review's summary; built without a session, null when the owner is gone. */
  mapsFor(ownerUserId: string): Promise<Pick<MapStore, 'read'> | null>;
  /** The owner's name: our side on a summary when the company has no name yet. Null when the owner is gone. */
  ownerName(ownerUserId: string): Promise<string | null>;
  log: (event: string, ids: Record<string, string>) => void;
}

/**
 * What the share link with `token` shows. Anything not shaped like a token is refused before the database is asked.
 * An unknown or turned-off link, a case no longer listed, stamped shared or in Drive, or an owner who is gone: the link
 * doesn't work. The owner's storage failing, or a case that can't be read whole: it can't be shown now, never stale or
 * partial numbers. A bug still throws. The company is named as it is now, and the partner as the owner's Partners names
 * it now (owner, 2026-10-30); when a read fails, or the partner type is gone from Partners, as stored with the case.
 * Logs carry event names and ids only, never the token or its hash.
 */
export async function openSharedCase(deps: ShareDeps, token: unknown): Promise<SharedView> {
  if (!isToken(token)) return { kind: 'gone' };
  const unavailable = (reason: string, ids: Record<string, string> = {}): SharedView => {
    logQuietly(deps, 'shared_case_unavailable', { reason, ...ids });
    return { kind: 'unavailable' };
  };
  let link: { ownerUserId: string; caseId: string } | null;
  let entry: CaseEntry | null;
  try {
    link = await deps.shareLinks.findActive(hashToken(token));
    entry = link ? await deps.directory.businessCase(link.caseId) : null;
  } catch (error) {
    return unavailable(reasonOf(error));
  }
  if (!link || !entry || entry.ownerUserId !== link.ownerUserId) return { kind: 'gone' };
  const ids = { ownerUserId: link.ownerUserId, caseId: link.caseId };
  let store: CaseStore | null;
  try {
    store = await deps.casesFor(link.ownerUserId);
  } catch (error) {
    return unavailable(reasonOf(error), ids);
  }
  if (!store) return { kind: 'gone' };
  let read: Awaited<ReturnType<CaseStore['read']>>;
  try {
    read = await store.read({ fileId: entry.fileId });
  } catch (error) {
    if (!isStorageFailure(error)) throw error;
    return unavailable(error instanceof StoreFailure ? error.code : error instanceof ReconnectRequired ? 'auth' : 'unavailable', ids);
  }
  if (!read.ok) {
    // A file in the trash (or deleted) is a case that is gone [builder's call]; anything else may pass.
    if (read.error === 'file_not_found') return { kind: 'gone' };
    return unavailable(read.error, ids);
  }
  if (read.snapshot.issues.length > 0) return unavailable('rows_unreadable', ids);
  const c = read.snapshot.value;
  if (!c.shared) return { kind: 'gone' };
  if (!c.offer.types.some((t) => t.id === c.typeId)) return unavailable('type_missing', ids);
  let company = c.offer.company;
  try {
    company = (await deps.companies.nameOf(link.ownerUserId))?.trim() || c.offer.company;
  } catch {
    // The name stored with the case shows, and the link still works.
  }
  return { kind: 'ok', view: partnerSide({ ...c, partner: await sharedPartnerName(deps, link.ownerUserId, entry, c.partner) }, company) };
}

/** The partner's name in the owner's own Partners now, for the partner's page; `stored` when it can't be read or has none. */
async function sharedPartnerName(deps: ShareDeps, ownerUserId: string, entry: CaseEntry, stored: string): Promise<string> {
  try {
    const book = await deps.directory.partnerBook(entry.companyId);
    if (!book || book.ownerUserId !== ownerUserId) return stored;
    const store = await deps.partnerBooksFor(ownerUserId);
    const read = store ? await store.read({ fileId: book.fileId }) : null;
    return (read?.ok ? nameIn(read.snapshot.value, entry) : null) ?? stored;
  } catch {
    // The name stored with the case shows, and the link still works.
    return stored;
  }
}

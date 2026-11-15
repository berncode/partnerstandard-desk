// Helpers the commands share. Not exported from the package: every command checks access itself.
import { newCompanyFacts, type Issue } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { ReconnectRequired, StoreFailure, TokenUnavailable, type CreatedFile } from '@partner-desk/storage';
import { ownerOf, type Actor } from './actor';
import type { Deps } from './deps';
import { DuplicateEntry } from './directory';
import { createFailed, isOwner, NOT_FOUND_FILE, record, type Failure } from './result';

/** A record core refuses: the first problem as the message, every problem by its path (as the stores answer). */
export function refusedIssues(issues: Array<Pick<Issue, 'path' | 'message'>>): Failure {
  return {
    ok: false, error: 'invalid', message: issues[0]?.message ?? COPY.FIX_FIELDS,
    fieldErrors: Object.fromEntries(issues.map((issue) => [issue.path, issue.message])),
  };
}

export const refused = (field: string, message: string): Failure => ({ ok: false, error: 'invalid', message, fieldErrors: { [field]: message } });

/** Best effort: a log line must never make a command fail. */
export function logQuietly(deps: Pick<Deps, 'log'>, event: string, ids: Record<string, string>): void {
  try { deps.log(event, ids); } catch { /* logging must not throw either */ }
}

/**
 * The company's Company facts file. The first time, it is made with the starting facts, as `readPartners` makes the
 * Partners file: only by a person, never an agent, and never for a company whose Partners file is someone else's. Two
 * first reads at once end with one file; the loser's is thrown away.
 */
export async function factsEntry(deps: Deps, actor: Actor, company: string): Promise<{ ok: true; fileId: string; ownerUserId: string } | Failure> {
  const found = await deps.directory.companyFacts(company);
  if (found) return isOwner(actor, found) ? { ok: true, ...found } : NOT_FOUND_FILE;
  if (actor.kind !== 'owner') return NOT_FOUND_FILE;
  const book = await deps.directory.partnerBook(company);
  if (book && !isOwner(actor, book)) return NOT_FOUND_FILE;
  let created: CreatedFile;
  try {
    created = await deps.companyFacts.create(ownerOf(actor), company, newCompanyFacts(company));
  } catch (error) {
    return createFailed(error);
  }
  try {
    await deps.directory.addCompanyFacts({ companyId: company, ownerUserId: actor.userId, fileId: created.fileId });
    return { ok: true, fileId: created.fileId, ownerUserId: actor.userId };
  } catch (error) {
    await deps.companyFacts.discard({ fileId: created.fileId });
    if (!(error instanceof DuplicateEntry)) throw error;
    // A second first read won the race: use the winner's file, and ours is gone.
    const winner = await deps.directory.companyFacts(company);
    if (!winner) throw error;
    return isOwner(actor, winner) ? { ok: true, ...winner } : NOT_FOUND_FILE;
  }
}

/**
 * Turns off the share links of these cases. A removal does it first, before anything else is written: a removal that
 * then fails leaves only the links off, and can be made again (spec 5.5).
 */
export async function revokeCaseLinks(deps: Deps, actor: Actor, cases: Array<{ caseId: string }>): Promise<void> {
  if (cases.length === 0) return;
  await deps.shareLinks.revokeCases(actor.userId, cases.map((c) => c.caseId), deps.clock());
}

/**
 * Removes these cases' rows; with `trash`, their files go to the Drive trash too. Their links must be off already
 * (`revokeCaseLinks`), so no link stays open for a case nobody sees.
 */
export async function dropCases(
  deps: Deps, actor: Actor, cases: Array<{ caseId: string; fileId: string }>, files: 'trash' | 'keep',
): Promise<void> {
  if (cases.length === 0) return;
  await deps.directory.removeBusinessCases(cases.map((c) => c.caseId));
  for (const { caseId, fileId } of cases) {
    if (files === 'trash') await deps.cases.trash({ fileId });
    await record(deps, actor, 'cases.delete', fileId, [caseId]);
  }
}

/** Turns off the links of these cases, then removes their rows (and with `trash`, their files). */
export async function removeCases(
  deps: Deps, actor: Actor, cases: Array<{ caseId: string; fileId: string }>, files: 'trash' | 'keep',
): Promise<void> {
  await revokeCaseLinks(deps, actor, cases);
  await dropCases(deps, actor, cases, files);
}

/** The person's cases of the company (of one partner type, when given), with their files: for spec 5.5. */
export async function casesOf(
  deps: Deps, actor: Actor, company: string, partnerId?: string,
): Promise<Array<{ caseId: string; fileId: string }>> {
  const listed = (await deps.directory.businessCases(company))
    .filter((c) => isOwner(actor, c) && (partnerId === undefined || c.partnerId === partnerId));
  const found: Array<{ caseId: string; fileId: string }> = [];
  for (const { caseId } of listed) {
    const entry = await deps.directory.businessCase(caseId);
    if (entry) found.push({ caseId, fileId: entry.fileId });
  }
  return found;
}

/** A guarded database error names its operation; anything else is named for what it is (a shared link's page). */
export const reasonOf = (error: unknown): string =>
  (error instanceof Error && /^[a-z_]+$/.test(error.message) ? error.message : 'database');

/** A failure of the owner's storage, not a bug (a shared link's page). */
export const isStorageFailure = (error: unknown): boolean =>
  error instanceof StoreFailure || error instanceof ReconnectRequired || error instanceof TokenUnavailable;

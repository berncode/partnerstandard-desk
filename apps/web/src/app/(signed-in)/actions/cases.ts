'use server';

import {
  copyCase, createCase, deleteCase, invalid, listCases, readCase, readCaseSources, recalculateCase, saveCase, shareCase, unshareCase,
  type CaseListItem, type CaseRead, type CaseSourcesRead,
} from '@partner-desk/commands';
import type { BusinessCase } from '@partner-desk/core';
import type { Snapshot } from '@partner-desk/storage';
import { z } from 'zod';
import type { RemoteOutcome, RemoteResult } from '@/editor/remote';
import { caseNumbers, type CaseAreaRow } from '@/cases/case-rows';
import { shareUrl } from '@/server/runtime';
import { asOwner, done, refused } from './context';

// Every action works on the signed-in person's own company: the company id comes from the session, never the input.
// Each one calls its command (spec 8, one way in).

const listInput = z.object({ partnerId: z.unknown().optional() }).strict();

/** The company's business cases, newest first, from the directory only (no file read); of one partner type with `partnerId`. */
export async function caseList(input: unknown): Promise<RemoteOutcome<{ cases: CaseListItem[] }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = listInput.safeParse(input ?? {});
    if (!parsed.success) return refused(invalid());
    const { partnerId } = parsed.data;
    const listed = await listCases(deps, actor, { companyId: await companyId(), ...(partnerId !== undefined ? { partnerId } : {}) });
    return listed.ok ? { ok: true, cases: listed.value } : refused(listed);
  });
}

const rowsInput = z.object({ partnerId: z.unknown() }).strict();

/**
 * A partner type's Business case area: its cases, newest first, each read once for the stage it was made in and its
 * two numbers [builder's call: a partner type has few cases]. A case that can't be read keeps its row, without numbers.
 */
export async function caseRows(input: unknown): Promise<RemoteOutcome<{ rows: CaseAreaRow[] }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = rowsInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const listed = await listCases(deps, actor, { companyId: await companyId(), partnerId: parsed.data.partnerId });
    if (!listed.ok) return refused(listed);
    const rows: CaseAreaRow[] = [];
    // One read after another (Google allows about 60 a minute; reads are cached for a minute).
    for (const c of listed.value) {
      const read = await readCase(deps, actor, { caseId: c.caseId });
      rows.push({ caseId: c.caseId, title: c.title, createdAt: c.createdAt, numbers: read.ok ? caseNumbers(read.value.value) : null });
    }
    return { ok: true, rows };
  });
}

const createInput = z.object({ partnerId: z.unknown(), programId: z.unknown().optional() }).strict();

/**
 * New case for a partner type, filled from Company facts and its program (spec 5.2). Refused with
 * `fieldErrors.programId` when the person must pick the program.
 */
export async function caseCreate(input: unknown): Promise<RemoteOutcome<{ caseId: string }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = createInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const { partnerId, programId } = parsed.data;
    return done(await createCase(deps, actor, { companyId: await companyId(), partnerId, ...(programId !== undefined ? { programId } : {}) }));
  });
}

const caseInput = z.object({ caseId: z.unknown() }).strict();

/** A copy of a case: the same partner type and numbers, made today, with no share link. */
export async function caseCopy(input: unknown): Promise<RemoteOutcome<{ caseId: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = caseInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await copyCase(deps, actor, parsed.data));
  });
}

/** Deletes a case: its share link stops working and its file goes to the Drive trash. */
export async function caseDelete(input: unknown): Promise<RemoteOutcome<{ caseId: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = caseInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await deleteCase(deps, actor, parsed.data));
  });
}

/** Reads a case, named with the company's name as it is now, with its working share link if any. */
export async function caseRead(input: unknown): Promise<RemoteOutcome<CaseRead>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = caseInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await readCase(deps, actor, parsed.data));
  });
}

/**
 * What changed since the case was filled (spec 5.4): when Company facts and its program were saved after it, and
 * whether its partner type is gone from Partners. Dates and a flag only.
 */
export async function caseSources(input: unknown): Promise<RemoteOutcome<CaseSourcesRead>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = caseInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await readCaseSources(deps, actor, parsed.data));
  });
}

const saveInput = z.object({ caseId: z.unknown(), case: z.unknown(), base: z.unknown(), expectedUpdatedAt: z.unknown() }).strict();

/** Saves a case whole, as `programSave` saves a program: a case changed since the screen read it is refused with `conflict`. */
export async function caseSave(input: unknown): Promise<RemoteResult<BusinessCase>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = saveInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const saved = await saveCase(deps, actor, parsed.data);
    return saved.ok ? { ok: true, snapshot: saved.value.snapshot, entityId: null } : refused(saved);
  });
}

const recalculateInput = z.object({ caseId: z.unknown(), expectedUpdatedAt: z.unknown(), programId: z.unknown().optional() }).strict();

/** Update from Company facts and program (spec 5.4). Answers the case as saved and the program it used. */
export async function caseRecalculate(input: unknown): Promise<RemoteOutcome<{ snapshot: Snapshot<BusinessCase>; programId: string | null }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = recalculateInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const { programId, ...rest } = parsed.data;
    return done(await recalculateCase(deps, actor, { ...rest, ...(programId !== undefined ? { programId } : {}) }));
  });
}

/**
 * Shares a case by a new secret link. The link, on APP_URL (never a request's host), comes back to this screen only;
 * our database keeps its token's hash. Also the case as stamped, so the screen's next autosave starts from it.
 */
export async function caseShare(input: unknown): Promise<RemoteOutcome<{ url: string; snapshot: Snapshot<BusinessCase> }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = caseInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const shared = await shareCase(deps, actor, parsed.data);
    return shared.ok ? { ok: true, url: shareUrl(shared.value.token), snapshot: shared.value.snapshot } : refused(shared);
  });
}

/** Stops sharing a case: its links stop working at once. */
export async function caseUnshare(input: unknown): Promise<RemoteOutcome<{ snapshot: Snapshot<BusinessCase> }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = caseInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await unshareCase(deps, actor, parsed.data));
  });
}

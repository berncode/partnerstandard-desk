'use server';

import { createProgram, deleteProgram, invalid, saveCompanyFacts, saveProgram } from '@partner-desk/commands';
import type { CompanyFacts, Program } from '@partner-desk/core';
import { PARTNER_TYPES } from '@partner-desk/method';
import { z } from 'zod';
import type { RemoteOutcome, RemoteResult } from '@/editor/remote';
import type { ProgramLevels, StartMarket } from '@/programs/links';
import { marketsToStartFrom, programLevels } from '@/server/program-links';
import { asOwner, done, read, refused } from './context';

// Every action works on the signed-in person's own company: the company id comes from the session, never the input.

const factsSaveInput = z.object({ facts: z.unknown(), base: z.unknown(), expectedUpdatedAt: z.unknown() }).strict();

/**
 * Saves the company's facts whole (`{ facts, base, expectedUpdatedAt }`): `base` is the facts as the screen read them
 * and `expectedUpdatedAt` their Updated. A file changed since, in the app or by hand in the sheet, is refused with
 * `conflict` and nothing is written. The answer holds the facts as stored, the next save's `base`.
 */
export async function companyFactsSave(input: unknown): Promise<RemoteResult<CompanyFacts>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = factsSaveInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return read(await saveCompanyFacts(deps, actor, { companyId: await companyId(), ...parsed.data }));
  });
}

const createInput = z.object({ partnerType: z.unknown(), from: z.unknown() }).strict();

/**
 * Adds a program of a partner type to the person's company (Add a program): `from` is `'fresh'`,
 * `{ copyOf: programId }` or `{ marketId }` (Start from a market: the market then feeds it). Answers the new
 * program's id, and the sentence to show when the market couldn't be set to feed it.
 */
export async function programCreate(input: unknown): Promise<RemoteOutcome<{ programId: string; marketLinkMessage?: string }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = createInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const made = await createProgram(deps, actor, { companyId: await companyId(), ...parsed.data });
    if (!made.ok) return refused(made);
    const { programId, message } = made.value;
    return { ok: true, programId, ...(message ? { marketLinkMessage: message } : {}) };
  });
}

const saveInput = z.object({ programId: z.unknown(), program: z.unknown(), base: z.unknown(), expectedUpdatedAt: z.unknown() }).strict();

/**
 * Saves a program whole (`{ programId, program, base, expectedUpdatedAt }`), as `companyFactsSave` saves the facts:
 * a program changed since the screen read it (in the app or by hand in the sheet) is refused with `conflict`. The
 * answer holds the program as stored, the next save's `base`. The outputs are rewritten by the screen afterwards.
 */
export async function programSave(input: unknown): Promise<RemoteResult<Program>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = saveInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const saved = await saveProgram(deps, actor, parsed.data);
    return saved.ok ? { ok: true, snapshot: saved.value.snapshot, entityId: null } : refused(saved);
  });
}

const deleteInput = z.object({ programId: z.unknown() }).strict();

/** Deletes a program: refused while partners or markets point to it; otherwise its file goes to the Drive trash. */
export async function programDelete(input: unknown): Promise<RemoteOutcome<{ programId: string }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = deleteInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return done(await deleteProgram(deps, actor, parsed.data));
  });
}

const levelsInput = z.object({ programIds: z.array(z.string().max(64)).max(20) }).strict();

/**
 * The level names of some of the person's programs, and whether each has Preferred, for the partner page's Level:
 * one program file read each. A program that isn't there (or isn't the person's) is `gone`.
 */
export async function programLevelsRead(input: unknown): Promise<RemoteOutcome<{ levels: Record<string, ProgramLevels> }>> {
  return asOwner(async ({ deps, actor }) => {
    const parsed = levelsInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    return { ok: true, levels: await programLevels(deps, actor, parsed.data.programIds) };
  });
}

const startMarketsInput = z.object({ partnerType: z.enum(PARTNER_TYPES) }).strict();

/**
 * The person's open markets of a partner type with a partner hypothesis that holds: the markets Add a program offers
 * to start from. One read of each open market of the type.
 */
export async function programStartMarkets(input: unknown): Promise<RemoteOutcome<{ markets: StartMarket[] }>> {
  return asOwner(async ({ deps, actor, companyId }) => {
    const parsed = startMarketsInput.safeParse(input);
    if (!parsed.success) return refused(invalid());
    const offered = await marketsToStartFrom(deps, actor, await companyId(), parsed.data.partnerType);
    return offered.ok ? { ok: true, markets: offered.value } : refused(offered);
  });
}

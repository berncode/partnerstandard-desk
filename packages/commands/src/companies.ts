import { cleanCompanyName } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { z } from 'zod';
import { can } from './access';
import type { Actor } from './actor';
import type { Deps } from './deps';
import { FORBIDDEN, invalid, ok, record, type CommandResult, type Failure } from './result';

/** One company per account. The app asks for it after sign-in; `@partner-desk/platform` has the Turso version. */
export interface Companies {
  /** The user's company, made on first use. Two calls at once give the same company. */
  forUser(userId: string): Promise<{ companyId: string; name: string }>;
  rename(userId: string, name: string): Promise<void>;
  /** The owner's timezone as chosen in Settings, or null when none was chosen (or the user has no company). */
  timeZoneOf(userId: string): Promise<string | null>;
  /** Saves the owner's timezone on their company, made on first use. */
  setTimeZone(userId: string, timeZone: string): Promise<void>;
}

/**
 * What the commands need of the companies: renaming the actor's own, its name (a new program's default name) and its
 * timezone (the owner's "today"). `TursoCompanies` fits it.
 */
export type CompanyNames = Pick<Companies, 'rename' | 'forUser' | 'timeZoneOf' | 'setTimeZone'>;

/**
 * The company's name, read only: null when the user has no company. The partner's page uses it, and must never make a
 * company (`forUser` does). `TursoCompanies` fits it.
 */
export interface CompanyNameLookup {
  nameOf(userId: string): Promise<string | null>;
}

const renameInput = z.object({ name: z.string().max(1_000) }).strict();

const refused = (message: string): Failure => ({ ok: false, error: 'invalid', message, fieldErrors: { name: message } });

/**
 * Renames the actor's own company: the name is trimmed and at most 80 characters, and empty clears it. The company is
 * found by the person, never by an id from the input, so nobody can rename another company. A person only, never an agent.
 */
export async function renameCompany(deps: Deps, actor: Actor, input: unknown): Promise<CommandResult<{ name: string }>> {
  const parsed = renameInput.safeParse(input);
  if (!parsed.success) return invalid();
  if (!can(actor, 'company.rename', { ownerUserId: actor.userId })) return FORBIDDEN;
  const name = cleanCompanyName(parsed.data.name);
  if (!name.ok) return refused(name.reason === 'too_long' ? COPY.COMPANY_NAME_TOO_LONG : COPY.COMPANY_NAME_INVALID);
  await deps.companies.rename(actor.userId, name.value);
  // No file is involved: the event names none, and no name either.
  await record(deps, actor, 'company.rename', '', []);
  return ok({ name: name.value });
}

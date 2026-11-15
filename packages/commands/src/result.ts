import { COPY } from '@partner-desk/copy';
import { StoreFailure, type StoreError, type StoreErrorCode } from '@partner-desk/storage';
import { personOf, type Actor } from './actor';
import { READ_COMMANDS, type CommandName } from './access';
import type { Deps } from './deps';

/**
 * The commands that record no event: every read, and a database file's download, which is a read too though no agent
 * may run it (the owner, 2026-11-14).
 */
export const UNRECORDED_COMMANDS: readonly CommandName[] = [...READ_COMMANDS, 'files.export'];

export type CommandResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: StoreErrorCode | 'forbidden'; message: string; fieldErrors?: Record<string, string>; valid?: number };

export type Failure = Extract<CommandResult<never>, { ok: false }>;

export const ok = <T>(value: T): CommandResult<T> => ({ ok: true, value });
export const FORBIDDEN: Failure = { ok: false, error: 'forbidden', message: COPY.FORBIDDEN };
export const NOT_FOUND_FILE: Failure = { ok: false, error: 'file_not_found', message: COPY.NOT_FOUND_FILE };
export const invalid = (fieldErrors?: Record<string, string>): Failure => ({
  ok: false, error: 'invalid', message: COPY.FIX_FIELDS, ...(fieldErrors ? { fieldErrors } : {}),
});

/** A store error passes through with its code and its message; ids and codes only. */
export const fromStore = (e: StoreError & { valid?: number }): Failure => ({
  ok: false, error: e.error, message: e.message, ...(e.fieldErrors ? { fieldErrors: e.fieldErrors } : {}),
  ...('valid' in e && typeof e.valid === 'number' ? { valid: e.valid } : {}),
});

/**
 * A file the store couldn't make (no Google access, a full Drive, Google not answering): its code and message, for
 * the person. Anything else is a bug and is thrown on.
 */
export function createFailed(error: unknown): Failure {
  if (error instanceof StoreFailure) return { ok: false, error: error.code, message: error.message };
  throw error;
}

/**
 * Records what happened, by ids only. Called after a success, never after a refusal. A read leaves no event, whoever
 * reads (the owner, 2026-11-14: nothing used them; data we have no use for, we don't keep). `proposalId`: the proposal the proposals commands make or answer; a person
 * accepting a proposal (`withProposal`) carries its id without it.
 */
export async function record(
  deps: Deps, actor: Actor, command: CommandName, fileId: string, entityIds: string[], change?: string, proposalId?: string,
): Promise<void> {
  if (UNRECORDED_COMMANDS.includes(command)) return;
  const proposal = proposalId ?? (actor.kind === 'owner' ? actor.proposal?.id : undefined);
  await deps.events.record({
    id: deps.ids.event(), at: deps.clock(), command, actorKind: actor.kind, actorUserId: personOf(actor), fileId, entityIds,
    ...(change !== undefined ? { change } : {}), ...(proposal !== undefined ? { proposalId: proposal } : {}),
  });
}

/** Someone who doesn't own a file can't tell it exists: the same answer as for a file that isn't there. */
export const isOwner = (actor: Actor, entry: { ownerUserId: string }): boolean => actor.userId === entry.ownerUserId;

/** The row ids a change touched, for an event: the row the store reports, else the one the change names. */
export function touchedIds(change: { id?: string; partnerId?: string }, entityId: string | null): string[] {
  const own = entityId ?? change.id ?? change.partnerId;
  return own ? [own] : [];
}

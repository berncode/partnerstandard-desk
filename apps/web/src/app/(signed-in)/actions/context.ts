import type { Actor, CommandResult, Deps } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import type { RemoteBatchResult, RemoteFailure, RemoteOutcome, RemoteResult } from '@/editor/remote';
import type { MailSender } from '@/server/map-link-mail';
import { actorFor, companyFor, currentOwner, depsFor } from '@/server/runtime';

/** What every server action answers when nobody is signed in. The editor turns the page read-only on `auth`. */
export const SIGNED_OUT: RemoteFailure = { ok: false, error: 'auth', message: COPY.SIGNED_OUT };

export interface OwnerContext {
  deps: Deps;
  actor: Actor;
  /** The signed-in person's own company id: the only place an action gets one, never from its input. */
  companyId(): Promise<string>;
  /** Who presses Send link or Send summary: the emails go out in their name, and replies come back to them (plan 15). */
  sender: MailSender;
}

const isForbidden = (out: unknown): out is RemoteFailure =>
  typeof out === 'object' && out !== null && (out as { ok?: unknown }).ok === false && (out as { error?: unknown }).error === 'forbidden';

/** Runs `work` for the signed-in person, or answers SIGNED_OUT. */
export async function asOwner<R>(work: (owner: OwnerContext) => Promise<R>): Promise<R | RemoteFailure> {
  const session = await currentOwner();
  if (!session) return SIGNED_OUT;
  const actor = actorFor(session);
  const out = await work({
    deps: depsFor(session), actor, companyId: async () => (await companyFor(session)).companyId,
    sender: { actor, name: session.owner.displayName, email: session.email },
  });
  // A company server's viewer is told why, not just "not allowed" (plan 15).
  return session.member?.role === 'viewer' && isForbidden(out) ? { ...out, message: COPY.VIEWER_READ_ONLY } : out;
}

type Refused = Extract<CommandResult<never>, { ok: false }>;

/** A command's refusal as the editor reads it: its code, message, field errors and, for a batch, how many came first. */
export function refused(r: Refused): RemoteFailure {
  return {
    ok: false, error: r.error, message: r.message,
    ...(r.fieldErrors ? { fieldErrors: r.fieldErrors } : {}), ...(r.valid !== undefined ? { valid: r.valid } : {}),
  };
}

/** A change's result: the file as it is now and the row an add made. */
export const changed = <T>(r: CommandResult<{ snapshot: Snapshot<T>; entityId: string | null }>): RemoteResult<T> =>
  (r.ok ? { ok: true, snapshot: r.value.snapshot, entityId: r.value.entityId } : refused(r));

/** A batch's result: the file as it is now and, per change, the row an add made. */
export const batched = <T>(r: CommandResult<{ snapshot: Snapshot<T>; entityIds: Array<string | null> }>): RemoteBatchResult<T> =>
  (r.ok ? { ok: true, snapshot: r.value.snapshot, entityIds: r.value.entityIds } : refused(r));

/** A read's result: the file, no row. */
export const read = <T>(r: CommandResult<Snapshot<T>>): RemoteResult<T> => (r.ok ? { ok: true, snapshot: r.value, entityId: null } : refused(r));

/** A new market's result: its file, and its id as the entity id. */
export const made = <T>(r: CommandResult<{ marketId: string; snapshot: Snapshot<T> }>): RemoteResult<T> =>
  (r.ok ? { ok: true, snapshot: r.value.snapshot, entityId: r.value.marketId } : refused(r));

/** A result with no file to show: done, with what the command gives back, or refused. */
export const done = <V extends object>(r: CommandResult<V>): RemoteOutcome<V> => (r.ok ? { ok: true, ...r.value } : refused(r));

// The editor's remote, generic over the aggregate, with no `partial` save.
import type { Snapshot, StoreErrorCode } from '@partner-desk/storage';

/** Why a save or a server action was refused, as the commands say it. Ids and codes only; `message` comes from COPY. */
export interface RemoteFailure {
  ok: false;
  error: StoreErrorCode | 'forbidden';
  message: string;
  fieldErrors?: Record<string, string>;
  /** For a refused batch: how many of its changes came before the one refused. Nothing was saved. */
  valid?: number;
}

/** One change saved: the file as it is now, and the id of the row an add made (for a new market, its id). */
export type RemoteResult<T> = { ok: true; snapshot: Snapshot<T>; entityId: string | null } | RemoteFailure;

/** A batch (an import) saved in one write, all or nothing: per change, the id of the row an add made. */
export type RemoteBatchResult<T> = { ok: true; snapshot: Snapshot<T>; entityIds: Array<string | null> } | RemoteFailure;

/** A server action that changes no file the page holds (archive, rename): done, with what it says, or refused. */
export type RemoteOutcome<V extends object = object> = ({ ok: true } & V) | RemoteFailure;

/**
 * Saves changes to one file (server actions) and returns the fresh snapshot. `B` is what a batch needs besides its
 * changes: the market an import of partners goes into. An editor without batches has no `applyMany`.
 */
export interface EditorRemote<T, C, B = undefined> {
  apply(change: C): Promise<RemoteResult<T>>;
  applyMany?(changes: C[], batch: B): Promise<RemoteBatchResult<T>>;
}

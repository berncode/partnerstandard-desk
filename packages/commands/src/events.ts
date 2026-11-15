import type { IsoDateTime } from '@partner-desk/core';
import type { Actor } from './actor';
import type { CommandName } from './access';

/** Ids only. Never a name, a note or any other content. */
export interface CommandEvent {
  id: string;
  at: IsoDateTime;
  command: CommandName;
  actorKind: Actor['kind'];
  actorUserId: string;
  fileId: string;
  entityIds: string[];
  /** The change's kind, a code such as `setStep`. Never content. */
  change?: string;
  /** The agent proposal it made, answered or carried out (`prp_…`): an owner accepting one, or the proposals commands. */
  proposalId?: string;
}

export interface EventSink {
  record(e: CommandEvent): Promise<void>;
  /**
   * The newest event time per entity id, among this file's events with this change code. Best effort: when the read
   * fails it logs `events_read_failed` and gives `{}`.
   */
  latestByEntity(fileId: string, change: string): Promise<Record<string, IsoDateTime>>;
}

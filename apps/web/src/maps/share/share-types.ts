// The share dialog's types, on the commands' `mapSharing`.
import type { MapSharePerson } from '@partner-desk/commands';

/** One person the owner can share with (or revoke), as the dialog shows them. */
export type SharePersonView = MapSharePerson;
/** What the dialog loads: who has or can get access, or why that failed. */
export type ShareView =
  | { ok: true; people: SharePersonView[]; /** The owner's side by name (`ourSideName`). */ ourName: string; partnerName: string; mailConfigured: boolean }
  | { ok: false; message: string };
/** The outcome of sending a link or revoking access, in words for the owner. */
export type ShareResult = { ok: true; message: string } | { ok: false; message: string };
/** The outcome of making a link to copy. */
export type CopyResult = { ok: true; url: string } | { ok: false; message: string };
/** The owner-only server actions the dialog calls. `send` comes with email (task 8): without it there is no Send link. */
export interface ShareActions {
  load(mapId: string): Promise<ShareView>;
  copy(mapId: string, personId: string): Promise<CopyResult>;
  send?: (mapId: string, personId: string) => Promise<ShareResult>;
  revoke(mapId: string, personId: string): Promise<ShareResult>;
}

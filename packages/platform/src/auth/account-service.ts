import type { Workspace } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import type { TursoAgentGrants } from '../db/turso-agent-grants';
import type { TursoApiKeys } from '../db/turso-api-keys';
import type { TursoCompanies } from '../db/turso-companies';
import type { TursoDirectory } from '../db/turso-directory';
import type { TursoEventSink } from '../db/turso-events';
import type { TursoFolderStore } from '../db/turso-folders';
import type { TursoFileLock } from '../db/turso-lock';
import type { TursoMapLinks } from '../db/turso-map-links';
import type { TursoMapEvents, TursoNotificationLog } from '../db/turso-notifications';
import type { TursoProposals } from '../db/turso-proposals';
import type { TursoReviewLinks } from '../db/turso-review-links';
import type { TursoShareLinks } from '../db/turso-share-links';
import type { TursoUserRecords } from '../db/turso-users';
import type { TursoWebhooks } from '../db/turso-webhooks';
import type { TursoWriteMarks } from '../db/turso-write-marks';

/** Everything account deletion touches. Nothing here calls Google (no revoke: the grant is shared with other tools). */
export interface AccountDeps {
  /** The person's API keys, turned off or not. */
  apiKeys: Pick<TursoApiKeys, 'deleteForUser'>;
  /** What the person allowed agent apps (the OAuth provider's consents and refresh tokens), and apps they registered. */
  agentGrants: Pick<TursoAgentGrants, 'deleteForUser'>;
  /** The person's webhooks, the deliveries waiting for them, and the marks of events sent once. */
  webhooks: Pick<TursoWebhooks, 'deleteForUser'>;
  /** The index of agents' proposals for the person (ids, codes and times). The Proposals tab stays in their Drive. */
  proposals: Pick<TursoProposals, 'deleteForUser'>;
  directory: Pick<TursoDirectory, 'fileIdsForOwner' | 'mapIdsForOwner' | 'deleteForOwner'>;
  shareLinks: Pick<TursoShareLinks, 'deleteForOwner'>;
  /** The summary links of the owner's held reviews. */
  reviewLinks: Pick<TursoReviewLinks, 'deleteForOwner'>;
  /** The magic links of the owner's MAPs, with their sessions. */
  mapLinks: Pick<TursoMapLinks, 'deleteForOwner'>;
  /** The email log's rows of the owner's MAPs, and the owner's own digests and reconnect emails. */
  notifications: Pick<TursoNotificationLog, 'deleteForOwner'>;
  /** What link holders changed on the owner's MAPs (ids only). */
  mapEvents: Pick<TursoMapEvents, 'deleteForMaps'>;
  events: Pick<TursoEventSink, 'deleteForFiles' | 'deleteForActor'>;
  locks: Pick<TursoFileLock, 'deleteForFiles'>;
  writeMarks: Pick<TursoWriteMarks, 'deleteForFiles'>;
  companies: Pick<TursoCompanies, 'deleteForUser'>;
  folders: Pick<TursoFolderStore, 'delete'>;
  users: Pick<TursoUserRecords, 'deleteUser'>;
  /** A company server's workspace: a member leaves it first (plan 15). Absent on hosted. */
  workspace?: Pick<Workspace, 'removeMember'>;
  log?: (event: string, fields: Record<string, string>) => void;
}

export type AccountResult = { ok: true } | { ok: false; message: string };

/** The action signs out before deleting, so a retry needs a fresh sign-in. */
export const DELETE_FAILED = COPY.DELETE_ACCOUNT_FAILED;

/**
 * Deletes this tool's records of the owner. The files stay in the owner's Google Drive and the Google grant is not
 * revoked: all PartnerStandard tools share one sign-in, so a revoke would sign the owner out of every tool. Settings
 * links to Google's connections page instead.
 *
 * The directory is read first, to name the files; the owner's API keys and agent grants go next, so no agent acts for
 * the account while it is deleted (the OAuth provider's rows also have to go before the user row: their links to it
 * don't cascade), and its webhooks with their queue, so no event goes out for it, and the index of its agents'
 * proposals (the Proposals tab stays in the owner's Drive); then the owner's share links, review summary links and MAP links (with
 * their sessions) go next, so no link to a case, a review or a MAP outlives the account; the email log's rows and the link holders' changes of the owner's
 * MAPs, and the rows tied to those files, follow; the directory rows go
 * after them, so a failure part-way still leaves the file ids to find on a retry. The user goes last, so the person
 * can sign in and retry. Events go by file (what other actors left on the user's files) and by actor (the user's own,
 * including those on a replaced Partner book file the directory no longer lists; a company server's member keeps theirs). Every step is idempotent. Verification rows hold sign-in state, not users, and are not touched.
 */
export async function deleteAccount(deps: AccountDeps, userId: string, { member = false }: { member?: boolean } = {}): Promise<AccountResult> {
  let step = 'file_ids';
  try {
    const fileIds = await deps.directory.fileIdsForOwner(userId);
    const mapIds = await deps.directory.mapIdsForOwner(userId);
    step = 'api_keys';
    await deps.apiKeys.deleteForUser(userId);
    step = 'agent_grants';
    await deps.agentGrants.deleteForUser(userId);
    step = 'webhooks';
    await deps.webhooks.deleteForUser(userId);
    step = 'proposals';
    await deps.proposals.deleteForUser(userId);
    step = 'share_links';
    await deps.shareLinks.deleteForOwner(userId);
    step = 'review_links';
    await deps.reviewLinks.deleteForOwner(userId);
    step = 'map_links';
    await deps.mapLinks.deleteForOwner(userId);
    step = 'notifications';
    await deps.notifications.deleteForOwner(userId, mapIds);
    step = 'map_events';
    await deps.mapEvents.deleteForMaps(mapIds);
    step = 'events';
    await deps.events.deleteForFiles(fileIds);
    step = 'events_by_actor';
    if (!member) await deps.events.deleteForActor(userId);
    step = 'locks';
    await deps.locks.deleteForFiles(fileIds);
    step = 'write_marks';
    await deps.writeMarks.deleteForFiles(fileIds);
    step = 'directory';
    await deps.directory.deleteForOwner(userId);
    step = 'company';
    await deps.companies.deleteForUser(userId);
    step = 'folders';
    await deps.folders.delete(userId);
    // A company server's member (plan 15) leaves the workspace just before the user row, through the last-admin rule,
    // so a company never loses its last admin, and a failure before it leaves them a member who can sign in and retry.
    // Their events stay: who did what on the company's work is the company's.
    if (member) {
      step = 'membership';
      if (!deps.workspace) throw new Error('workspace_missing');
      if ((await deps.workspace.removeMember(userId)) === 'lastAdmin') return { ok: false, message: COPY.DELETE_ACCOUNT_LAST_ADMIN };
    }
    step = 'user';
    await deps.users.deleteUser(userId);
    return { ok: true };
  } catch {
    deps.log?.('account_delete_failed', { step, userId });
    return { ok: false, message: member ? COPY.DELETE_ACCOUNT_FAILED_COMPANY : DELETE_FAILED };
  }
}

import { COPY, copyFor } from '@partner-desk/copy';
import { ReconnectButton } from '@/problems/reconnect';
import { SettingsConnectionsLine } from './google-connections';
import type { StorageKind } from '@/storage-kind';

/** The connected storage with Reconnect Google, which asks for permission again. No Disconnect: it would need a revoke. */
export function Storage({ session }: { session: { email: string; storage: StorageKind } }) {
  if (session.storage === 'memory') return <p className="text-sm text-ink-2">{COPY.SETTINGS_STORAGE_TEST}</p>;
  // A company server: the work is in its database. No Reconnect Google, no Google connections line (plan 13, task 12).
  if (session.storage === 'database') return <p className="text-sm text-ink-2">{copyFor('database').SETTINGS_STORAGE_TEXT(session.email)}</p>;
  return (
    <div className="space-y-3 text-sm text-ink-2">
      <p>{COPY.SETTINGS_STORAGE_TEXT(session.email)}</p>
      <ReconnectButton next="/settings" storage={session.storage} />
      <p className="text-xs text-ink-3">{COPY.SETTINGS_RECONNECT_NOTE}</p>
      <SettingsConnectionsLine />
    </div>
  );
}

'use client';

// In COPY's words.
import { TYPE_LABEL, type NotificationType } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useState } from 'react';
import { setEmailType } from './actions';
import { useStorageKind } from '@/storage-context';

export interface EmailPrefView { type: NotificationType; on: boolean }

const sentence = (label: string) => label.charAt(0).toUpperCase() + label.slice(1);

/** The person's own unsubscribes, with a way back in. Labels are TYPE_LABEL's. */
export function EmailPreferences({ initial, email, mailConfigured }: { initial: EmailPrefView[]; email: string; mailConfigured: boolean }) {
  // Reconnect emails go out only when Google's access is lost: a company server has none to lose (task 12's review).
  const reconnectEmails = useStorageKind() !== 'database';
  const [prefs, setPrefs] = useState(initial);
  const [busy, setBusy] = useState<NotificationType | null>(null);
  const [error, setError] = useState<string | null>(null);
  const set = (type: NotificationType, on: boolean) => setPrefs((list) => list.map((p) => (p.type === type ? { ...p, on } : p)));
  const toggle = async (type: NotificationType, on: boolean) => {
    setError(null);
    setBusy(type);
    set(type, on);
    let result: { ok: true } | { ok: false; message: string };
    try {
      result = await setEmailType(type, on);
    } catch {
      result = { ok: false, message: COPY.SETTINGS_WRONG };
    }
    if (!result.ok) {
      set(type, !on);
      setError(result.message);
    }
    setBusy(null);
  };
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-2">{COPY.SETTINGS_EMAILS_TEXT(email)}</p>
      <ul className="space-y-2">
        {prefs.map(({ type, on }) => (
          <li key={type}>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-brand" checked={on} disabled={busy === type} onChange={(e) => toggle(type, e.target.checked)} />
              {sentence(TYPE_LABEL[type])}
            </label>
          </li>
        ))}
      </ul>
      {reconnectEmails && <p className="text-xs text-ink-3">{COPY.SETTINGS_EMAILS_RECONNECT}</p>}
      {!mailConfigured && <p className="text-xs text-ink-3">{COPY.SETTINGS_EMAILS_OFF}</p>}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}

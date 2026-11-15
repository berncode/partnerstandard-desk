'use client';

// In COPY's words.
import { COPY } from '@partner-desk/copy';
import { useState, useTransition } from 'react';
import { Button } from '@/ui/button';

/** One POST button. The address is never shown: the link carries only its hash. */
export function UnsubscribeForm({ token, label, initiallyDone, onUnsubscribe }: {
  token: string; label: string; initiallyDone: boolean; onUnsubscribe: (token: string) => Promise<{ ok: boolean }>;
}) {
  const [done, setDone] = useState(initiallyDone);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (done) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{COPY.MAP_UNSUBSCRIBED}</h1>
        <p className="mt-2 text-ink-2">{COPY.MAP_UNSUBSCRIBED_TEXT(label)}</p>
      </div>
    );
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          try {
            const result = await onUnsubscribe(token);
            if (result.ok) setDone(true);
            else setError(COPY.MAP_UNSUBSCRIBE_GONE);
          } catch {
            setError(COPY.MAP_EMAIL_WRONG);
          }
        });
      }}
    >
      <h1 className="text-xl font-semibold tracking-tight">{COPY.MAP_UNSUBSCRIBE_HEADING(label)}</h1>
      <p className="mt-2 text-ink-2">{COPY.MAP_UNSUBSCRIBE_TEXT(label)}</p>
      <Button type="submit" variant="primary" className="mt-6" disabled={pending} aria-busy={pending}>{COPY.MAP_UNSUBSCRIBE_BUTTON}</Button>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </form>
  );
}

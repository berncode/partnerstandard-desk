'use client';

// In COPY's words.
import { COPY } from '@partner-desk/copy';
import { useState, useTransition } from 'react';
import { Button } from '@/ui/button';

type Result = { ok: boolean; message: string };

export function RenewForm({ mapId, onRequest }: { mapId: string; onRequest: (mapId: string, email: string) => Promise<Result> }) {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <form
      className="mt-6 space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        startTransition(async () => {
          try {
            setResult(await onRequest(mapId, email));
          } catch {
            setResult({ ok: false, message: COPY.SOMETHING_WRONG });
          }
        });
      }}
    >
      <label htmlFor="renew-email" className="block text-sm font-medium">{COPY.LINK_EMAIL_ADDRESS}</label>
      <input
        id="renew-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
      />
      <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>{COPY.LINK_SEND_NEW}</Button>
      {result && <p role={result.ok ? 'status' : 'alert'} className={result.ok ? 'text-sm text-ink-2' : 'text-sm text-danger'}>{result.message}</p>}
    </form>
  );
}

'use client';

// Google only.
import { COPY } from '@partner-desk/copy';
import { unstable_rethrow } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Field, fieldControl } from '@/markets/fields';
import { Button } from '@/ui/button';
import { deleteMyAccount } from './actions';
import { useCopy } from '@/storage-context';

/** Delete account: typing DELETE confirms it; the server checks it again, then signs out and goes to the landing page. */
export function DeleteAccount() {
  const words = useCopy();
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  const remove = () => startPending(async () => {
    setError(null);
    try {
      const result = await deleteMyAccount(typed);
      if (result && !result.ok) setError(result.message);
    } catch (thrown) {
      // The action's redirect() rejects the client promise; that is success, not a failure.
      unstable_rethrow(thrown);
      setError(COPY.SETTINGS_WRONG);
    }
  });

  return (
    <form noValidate className="space-y-3" onSubmit={(event) => { event.preventDefault(); remove(); }}>
      <p className="text-sm text-ink-2">{words.SETTINGS_DELETE_TEXT}</p>
      <div className="max-w-xs">
        <Field label={COPY.SETTINGS_DELETE_LABEL}>
          {(describedBy) => (
            <input className={fieldControl} value={typed} autoComplete="off" spellCheck={false} aria-describedby={describedBy}
              onChange={(e) => setTyped(e.target.value)} />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="danger" className="border border-danger/40" disabled={typed !== 'DELETE' || pending} aria-busy={pending}>
          {COPY.SETTINGS_DELETE_BUTTON}
        </Button>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>
    </form>
  );
}

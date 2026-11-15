'use client';

// In COPY's words.
import { ACTIVITY_STATUSES, type ActivityStatus } from '@partner-desk/core';
import { COPY, MAP_ACTIVITY_STATUS_LABELS } from '@partner-desk/copy';
import { useState, useTransition } from 'react';
import type { ActionOutcome, ConfirmView } from '@/server/email-actions';
import { Button } from '@/ui/button';

type Confirm = (token: string, input: { status?: string; note?: string }) => Promise<ActionOutcome>;

/** The single POST behind a reminder's button: nothing happens until it is pressed. */
export function ActionForm({ token, view, onConfirm }: { token: string; view: ConfirmView; onConfirm: Confirm }) {
  const [status, setStatus] = useState<ActivityStatus>(view.status);
  const [note, setNote] = useState(view.note);
  const [outcome, setOutcome] = useState<ActionOutcome | null>(null);
  const [pending, startTransition] = useTransition();
  const submit = () => startTransition(async () => {
    try {
      setOutcome(await onConfirm(token, view.action === 'update' ? { status, note } : {}));
    } catch {
      setOutcome({ ok: false, kind: 'unavailable', message: COPY.MAP_EMAIL_WRONG });
    }
  });
  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{COPY.MAP_ACTION_HEADING[view.action](view.title)}</h1>
      <p className="mt-2 text-sm text-ink-2">{COPY.MAP_ACTION_NOW(view.partnerName, MAP_ACTIVITY_STATUS_LABELS[view.status])}</p>
      {outcome?.ok ? (
        <p role="status" className="mt-6 rounded-lg bg-brand-soft p-3 text-sm text-ink">{outcome.message}</p>
      ) : (
        <form className="mt-6 space-y-4" onSubmit={(event) => { event.preventDefault(); submit(); }}>
          {view.action === 'update' && (
            <>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-medium">{COPY.MAP_ACTION_STATUS}</legend>
                {ACTIVITY_STATUSES.map((value) => (
                  <label key={value} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="status" value={value} checked={status === value} onChange={() => setStatus(value)} className="accent-brand" />
                    {MAP_ACTIVITY_STATUS_LABELS[value]}
                  </label>
                ))}
              </fieldset>
              <div className="space-y-1.5">
                <label htmlFor="action-note" className="block text-sm font-medium">{COPY.MAP_ACTION_NOTE}</label>
                <textarea id="action-note" value={note} maxLength={2000} rows={3} onChange={(e) => setNote(e.target.value)}
                  className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" />
              </div>
            </>
          )}
          <Button type="submit" variant="primary" disabled={pending} aria-busy={pending}>{COPY.MAP_ACTION_BUTTON[view.action]}</Button>
          {outcome && !outcome.ok && <p role="alert" className="text-sm text-danger">{outcome.message}</p>}
          <p className="text-xs text-ink-3">{COPY.MAP_ACTION_MADE_BY(view.personName)}</p>
        </form>
      )}
    </div>
  );
}

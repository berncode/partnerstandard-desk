'use client';

import { CLOSED_AS, type ClosedAs } from '@partner-desk/core';
import { CLOSED_LABELS, COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { usePartner } from './partner-context';

const HELP: Record<ClosedAs, string> = { not_now: COPY.CLOSE_NOT_NOW_HELP, no: COPY.CLOSE_NO_HELP };

/**
 * Closing a partner as *Not now* or *No*, with a reason. The step stays as it is, so it can be reopened there. With
 * `proposal`, an agent's proposal to close it (agent proposals spec 10.3): the dialog opens with its values, the person
 * may change them, and Close partner accepts the proposal with what the dialog holds.
 */
export function CloseDialog({ open, onOpenChange, defaultAs = 'not_now', proposal }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The option checked when it opens, e.g. *No* from the qualification's decision. */
  defaultAs?: ClosedAs;
  proposal?: { proposalId: string; values: { as: ClosedAs; reason: string } };
}) {
  const { account, partner, dispatch, proposals } = usePartner();
  const [as, setAs] = useState<ClosedAs>(proposal?.values.as ?? defaultAs);
  const [reason, setReason] = useState(proposal?.values.reason ?? '');
  const [error, setError] = useState<string | null>(null);
  const reasonId = useId();
  const errorId = useId();

  const change = (next: boolean) => {
    if (!next) setError(null);
    onOpenChange(next);
  };
  const close = () => {
    const view = proposal ? proposals?.views.find((v) => v.head.id === proposal.proposalId) : undefined;
    if (proposal && (!view || !proposals)) return setError(COPY.GONE);
    // An accepted proposal has no undo: the agent's proposal would come back answered.
    const outcome = view && proposals ? proposals.accept(view, { as, reason })
      : dispatch({ kind: 'close', partnerId: partner.id, as, reason }, { label: COPY.CLOSED_TOAST(CLOSED_LABELS[as]) });
    if (!outcome.ok) return setError(outcome.fieldErrors?.reason ?? outcome.fieldErrors?.closedReason ?? outcome.message);
    if (view) toast(COPY.CLOSED_TOAST(CLOSED_LABELS[as]));
    setReason('');
    change(false);
  };

  return (
    <Dialog open={open} onOpenChange={change}>
      <DialogContent title={COPY.CLOSE_TITLE(account.company)} description={COPY.CLOSE_TEXT}>
        <form className="mt-4 grid gap-4" onSubmit={(e) => { e.preventDefault(); close(); }}>
          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-medium">{COPY.CLOSE_AS}</legend>
            {CLOSED_AS.map((value) => (
              <div key={value} className="flex items-start gap-2 text-sm">
                <input id={`${reasonId}-${value}`} type="radio" name="closed-as" value={value} checked={as === value}
                  aria-describedby={`${reasonId}-${value}-help`} onChange={() => setAs(value)} className="mt-0.5 h-4 w-4 accent-brand-strong" />
                <div>
                  <label htmlFor={`${reasonId}-${value}`} className="font-medium">{CLOSED_LABELS[value]}</label>
                  <p id={`${reasonId}-${value}-help`} className="text-xs text-ink-3">{HELP[value]}</p>
                </div>
              </div>
            ))}
          </fieldset>
          <div className="grid gap-1">
            <label htmlFor={reasonId} className="text-sm font-medium">{COPY.FIELD_REASON}</label>
            <textarea id={reasonId} rows={3} value={reason} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}
              placeholder={COPY.CLOSE_REASON_PLACEHOLDER}
              onChange={(e) => { setReason(e.target.value); setError(null); }}
              className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
            {error && <p id={errorId} className="text-xs text-danger">{error}</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => change(false)}>{COPY.CANCEL}</Button>
            <Button type="submit" variant="primary">{COPY.CLOSE_PARTNER}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

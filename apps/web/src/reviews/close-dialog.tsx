'use client';

// Close the review (reviews spec 5.3): a person's action, with a confirmation that lists what happens and the day it was
// held (today unless picked, never after today). The page checks what `closeReview` would refuse first, waits until
// everything typed is saved, keeps the computed targets as the review's snapshot, then closes.
import { type IsoDate, type JoinedPlan } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { Field, fieldControl } from '@/maps/pieces';
import { useReview } from './review-context';
import { closeProblems, reviewPath, type ReviewActions } from './review-model';

/**
 * Closing's errors split by where they show: on a line of the page (a commitment of this review, or the next horizon's
 * length), else in the dialog. The held-on date's and the review's own stay in the dialog, and so does one that names
 * nothing on the page (a store's field, such as a milestone's name), so it is never lost.
 */
function placed(errors: Record<string, string>, plan: JoinedPlan, reviewId: string): { page: Record<string, string>; here: string | null } {
  const pageKeys = new Set(['nextHorizonDays', ...plan.reviewItems.filter((i) => i.reviewId === reviewId && i.kind === 'commitment').map((i) => i.id)]);
  const page = Object.fromEntries(Object.entries(errors).filter(([key]) => pageKeys.has(key)));
  const rest = Object.entries(errors).filter(([key]) => !pageKeys.has(key));
  const here = errors.heldOn ?? errors.reviewId ?? (Object.keys(page).length === 0 ? rest[0]?.[1] ?? null : null);
  return { page, here };
}

export function CloseDialog({ open, onOpenChange, reviewId, actions, saveState, failures, nextHorizon, partnerHref, onErrors }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reviewId: string;
  actions: ReviewActions;
  saveState: 'saved' | 'saving' | 'failed';
  /** How many saves have failed since the page opened (`usePlanEditor`). */
  failures: number;
  /** The horizon closing starts. */
  nextHorizon: number;
  partnerHref: string | null;
  onErrors: (errors: Record<string, string>) => void;
}) {
  const { mapId, plan, review, read, today } = useReview();
  const router = useRouter();
  const [heldOn, setHeldOn] = useState<IsoDate>(today);
  const [error, setError] = useState<string | null>(null);
  /** The held-on date to close with, once everything typed is saved; `busy` from the submit until the answer. */
  const pending = useRef<IsoDate | null>(null);
  /** The failed saves counted when Close was pressed: one more while it waits stops the close. */
  const failedBefore = useRef(0);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    if (pending.current === null || saveState === 'saving') return;
    const date = pending.current;
    pending.current = null;
    // A change the person saw on screen didn't save: closing now would hold the review without it.
    const unsaved = failures > failedBefore.current;
    void (async () => {
      if (unsaved) {
        setBusy(false);
        setError(COPY.REVIEW_UNSAVED);
        return;
      }
      const out = await actions.close({ mapId, reviewId, heldOn: date });
      if (!mounted.current) return;
      setBusy(false);
      if (!out.ok) {
        const { page, here } = placed(out.fieldErrors ?? {}, plan, review.id);
        onErrors(page);
        const shown = here ?? (Object.keys(page).length === 0 ? out.message : null);
        if (shown) setError(shown);
        else onOpenChange(false);
        return;
      }
      onOpenChange(false);
      const suggest = out.suggestion === 'growth' && partnerHref;
      toast.success(COPY.REVIEW_CLOSED(nextHorizon), suggest
        ? { action: { label: COPY.REVIEW_SUGGEST_GROWTH(read.partnerName), onClick: () => router.push(partnerHref) } }
        : undefined);
      router.push(reviewPath(mapId, reviewId));
      router.refresh();
    })();
  }, [busy, saveState, failures, actions, mapId, reviewId, plan, review.id, onErrors, onOpenChange, partnerHref, nextHorizon, read.partnerName, router]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setError(null);
    const problems = closeProblems(plan, review.id, heldOn, today);
    if (problems) {
      const { page, here } = placed(problems, plan, review.id);
      onErrors(page);
      if (here) setError(here);
      else onOpenChange(false);
      return;
    }
    onErrors({});
    failedBefore.current = failures;
    pending.current = heldOn;
    setBusy(true);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      {open && (
        <DialogContent title={COPY.REVIEW_CLOSE} description={COPY.REVIEW_CLOSE_TEXT}>
          <ol className="mt-3 list-decimal space-y-1 pl-5 text-sm text-ink-2">
            {COPY.REVIEW_CLOSE_STEPS(nextHorizon, review.nextHorizonDays).map((step) => <li key={step}>{step}</li>)}
          </ol>
          <p className="mt-2 text-sm text-ink-2">{COPY.REVIEW_CLOSE_STAGE}</p>
          <form className="mt-4 space-y-4" noValidate onSubmit={submit}>
            <Field label={COPY.REVIEW_HELD_ON_LABEL} className="sm:max-w-60">
              <input type="date" required max={today} value={heldOn} aria-invalid={error ? true : undefined}
                onChange={(e) => { setHeldOn(e.target.value); setError(null); }} className={fieldControl} />
            </Field>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{COPY.CANCEL}</Button>
              <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>{busy ? COPY.REVIEW_CLOSING : COPY.REVIEW_CLOSE}</Button>
            </div>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}

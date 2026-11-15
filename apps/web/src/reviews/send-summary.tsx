'use client';

// Send summary (reviews spec 5.6): the owner picks from the MAP's partner-side people with an email, all ticked, and
// whether the scorecard is on the summary (off by default), then each person gets a link to the one-page summary by
// email. A held review only. Sending again makes a new link and turns the earlier one off; "Turn off the link" turns it
// off without a new one. Both are the owner's actions on the server (`shareSummary`, `revokeSummary`).
import { COPY } from '@partner-desk/copy';
import { Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { useReview } from './review-context';
import type { ReviewActions } from './review-model';

export function SendSummary({ actions }: { actions: Pick<ReviewActions, 'sendSummary' | 'revokeSummary'> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Send className="h-4 w-4" aria-hidden />
        {COPY.REVIEW_SUMMARY_SEND}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open && <SendSummaryForm actions={actions} onDone={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function SendSummaryForm({ actions, onDone }: { actions: Pick<ReviewActions, 'sendSummary' | 'revokeSummary'>; onDone: () => void }) {
  const { mapId, plan, review } = useReview();
  const router = useRouter();
  const people = plan.people.filter((p) => p.side === 'partner' && p.email);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(people.map((p) => p.id)));
  const [includeScorecard, setIncludeScorecard] = useState(review.includeScorecard);
  const [busy, setBusy] = useState<'send' | 'revoke' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = (personId: string, on: boolean) => setPicked((all) => {
    const next = new Set(all);
    if (on) next.add(personId);
    else next.delete(personId);
    return next;
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || picked.size === 0) return;
    setBusy('send');
    setError(null);
    // In the order People lists them.
    const personIds = people.filter((p) => picked.has(p.id)).map((p) => p.id);
    const out = await actions.sendSummary({ mapId, reviewId: review.id, personIds, includeScorecard });
    setBusy(null);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    toast.success(out.message);
    onDone();
    router.refresh();
  };

  const turnOff = async () => {
    if (busy) return;
    setBusy('revoke');
    setError(null);
    const out = await actions.revokeSummary({ mapId, reviewId: review.id });
    setBusy(null);
    if (!out.ok) {
      setError(out.message);
      return;
    }
    toast.success(out.message);
    onDone();
  };

  return (
    <DialogContent title={COPY.REVIEW_SUMMARY_SEND} description={COPY.REVIEW_SUMMARY_SEND_TEXT}>
      <form className="mt-4 space-y-4" noValidate onSubmit={(e) => void submit(e)}>
        {people.length === 0 ? (
          <p className="text-sm text-ink-2">{COPY.REVIEW_SUMMARY_NO_PEOPLE}</p>
        ) : (
          <fieldset className="space-y-2">
            <legend className="mb-1 text-sm font-semibold">{COPY.REVIEW_SUMMARY_TO}</legend>
            {people.map((p) => (
              <label key={p.id} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1 accent-brand" checked={picked.has(p.id)} onChange={(e) => toggle(p.id, e.target.checked)} />
                <span className="min-w-0 break-words">
                  <span className="font-medium">{p.name}</span>
                  <span className="block text-ink-3">{p.email}</span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="accent-brand" checked={includeScorecard} onChange={(e) => setIncludeScorecard(e.target.checked)} />
            {COPY.REVIEW_SUMMARY_INCLUDE_SCORECARD}
          </label>
          <p className="text-xs text-ink-3">{COPY.REVIEW_SUMMARY_INCLUDE_SCORECARD_TEXT}</p>
        </div>
        {review.summarySentAt && <p className="text-xs text-ink-3">{COPY.REVIEW_SUMMARY_NEW_LINK}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {review.summarySentAt && (
            <Button variant="ghost" className="mr-auto" disabled={busy !== null} aria-busy={busy === 'revoke' || undefined} onClick={() => void turnOff()}>
              {COPY.REVIEW_SUMMARY_TURN_OFF}
            </Button>
          )}
          <Button variant="ghost" disabled={busy !== null} onClick={onDone}>{COPY.CANCEL}</Button>
          <Button type="submit" variant="primary" disabled={busy !== null || picked.size === 0} aria-busy={busy === 'send' || undefined}>
            {busy === 'send' ? COPY.REVIEW_SUMMARY_SENDING : COPY.REVIEW_SUMMARY_SEND}
          </Button>
        </div>
      </form>
    </DialogContent>
  );
}

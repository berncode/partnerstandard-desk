'use client';

// New for PartnerStandard Desk (spec 5.4), in the place of the Business Case app's "Reset portfolio and partner terms": it
// asks first and names what changes, saves what is on screen, then fills the terms again. When the partner type is in no
// program and its type has several, the person picks one, as New case asks (src/cases/new-case-form.tsx): the first is
// picked already.
import type { BusinessCase } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { useRouter } from 'next/navigation';
import { useId, useState, useTransition } from 'react';
import { toast } from 'sonner';
import type { RemoteOutcome } from '@/editor/remote';
import type { ProgramOption } from '@/programs/title';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { Dialog, DialogContent } from '@/ui/dialog';
import { DisabledReason } from '@/ui/pieces';
import { useViewer } from '@/storage-context';
import { useCaseEditor } from './case-editor';

export type Recalculate = (input: { caseId: string; expectedUpdatedAt: string | null; programId?: string }) =>
  Promise<RemoteOutcome<{ snapshot: Snapshot<BusinessCase>; programId: string | null }>>;

/** Why Update can't be asked for, if it can't. */
type Refusal = { message: string; changed: boolean };

/**
 * "Update from Company facts and program" and its dialog. `programs` are the partner type's type's programs, for the
 * pick. `gone`: the partner type is no longer in Partners, so Update is off and says why (Review Focus 2). After an
 * update the page brings the case as stored, and a toast names the program it used, or says there is none (Review
 * Focus 1).
 */
export function RecalculateDialog(props: RecalculateProps) {
  // A company server's viewer can't update a case: no button for it (owner, 2026-11-14).
  return useViewer() ? null : <Recalculating {...props} />;
}

interface RecalculateProps {
  caseId: string;
  programs: readonly ProgramOption[];
  gone: boolean;
  recalculate: Recalculate;
}

function Recalculating({ caseId, programs, gone, recalculate }: RecalculateProps) {
  const router = useRouter();
  const editor = useCaseEditor();
  const reasonId = useId();
  const programFieldId = useId();
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [picked, setProgramId] = useState('');
  // The first is picked already; the list may arrive after the question (below).
  const programId = picked || (programs[0]?.programId ?? '');
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [pending, startPending] = useTransition();

  const close = () => {
    setOpen(false);
    setAsking(false);
    setRefusal(null);
  };
  const update = () => startPending(async () => {
    setRefusal(null);
    // What is on screen is saved first, so the update goes over the case as it is now.
    const flushed = await editor.saveNow();
    if (!flushed.ok) {
      setRefusal({ message: flushed.message, changed: false });
      return;
    }
    let result: Awaited<ReturnType<Recalculate>>;
    try {
      result = await recalculate({ caseId, expectedUpdatedAt: editor.stored().updatedAt || null, ...(asking && programId ? { programId } : {}) });
    } catch {
      result = { ok: false, error: 'unavailable', message: COPY.ACTION_FAILED };
    }
    if (!result.ok) {
      const pick = result.fieldErrors?.programId;
      if (pick !== undefined) {
        setAsking(true);
        setRefusal({ message: pick, changed: false });
        // A program added since the page was read: the page brings the list again.
        if (programs.length === 0) router.refresh();
        return;
      }
      const changed = result.error === 'conflict';
      setRefusal({ message: changed ? COPY.CHANGED_SOMEWHERE_ELSE : result.message, changed });
      return;
    }
    close();
    const used = result.programId === null ? null : programs.find((p) => p.programId === result.programId)?.title ?? COPY.CASE_UPDATED_PROGRAM;
    toast(used === null ? COPY.CASE_UPDATED_NO_PROGRAM : COPY.CASE_UPDATED_FROM(used));
    // The page brings the case as stored: the editor starts again from it.
    router.refresh();
  });

  return (
    <div className="grid justify-items-start gap-1 sm:justify-items-end">
      <Button disabled={gone} aria-describedby={gone ? reasonId : undefined} onClick={() => setOpen(true)}>{COPY.CASE_UPDATE}</Button>
      {gone && <DisabledReason id={reasonId}>{COPY.CASE_TYPE_GONE}</DisabledReason>}

      <Dialog open={open} onOpenChange={(next) => {
        if (!next && !pending) close();
      }}>
        {open && (
          <DialogContent title={COPY.CASE_UPDATE_TITLE} description={COPY.CASE_UPDATE_TEXT}
            onEscapeKeyDown={(event) => pending && event.preventDefault()} onInteractOutside={(event) => pending && event.preventDefault()}>
            {asking && programs.length > 0 && (
              <div className="mt-4 grid min-w-0 gap-1">
                <label htmlFor={programFieldId} className="text-xs font-medium text-ink-3">{COPY.FIELD_CASE_PROGRAM}</label>
                <select id={programFieldId} className={cn(controlClass, 'px-2')} value={programId} disabled={pending} onChange={(e) => setProgramId(e.target.value)}>
                  {programs.map((p) => <option key={p.programId} value={p.programId}>{p.title}</option>)}
                </select>
              </div>
            )}
            {refusal && (
              <div role="alert" className={cn('mt-3 space-y-2 text-sm', asking ? 'text-ink-2' : 'text-danger')}>
                <p>{refusal.message}</p>
                {refusal.changed && <Button size="sm" variant="primary" onClick={() => router.refresh()}>{COPY.RELOAD}</Button>}
              </div>
            )}
            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <Button variant="ghost" disabled={pending} onClick={close}>{COPY.CANCEL}</Button>
              <Button variant="primary" disabled={pending} aria-busy={pending || undefined} onClick={update}>
                {pending ? COPY.CASE_UPDATING : COPY.CASE_UPDATE_ACTION}
              </Button>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

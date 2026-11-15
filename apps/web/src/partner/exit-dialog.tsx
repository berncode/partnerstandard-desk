'use client';

// In the close dialog's shape: a signed partner ends only through Mark exited, with a date and a reason.
import { COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { controlClass } from '@/ui/control';
import { Dialog, DialogContent } from '@/ui/dialog';
import { usePartner } from './partner-context';

export function ExitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { account } = usePartner();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={COPY.EXIT_TITLE(account.company)} description={COPY.EXIT_TEXT}>
          <ExitForm onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

/** Changes the exit date and reason of a partner that has already exited. */
export function CorrectExitDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { account } = usePartner();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={COPY.CORRECT_EXIT_TITLE(account.company)} description={COPY.CORRECT_EXIT_TEXT}>
          <CorrectExitForm onDone={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function CorrectExitForm({ onDone }: { onDone: () => void }) {
  const { partner, dispatch, today } = usePartner();
  const [date, setDate] = useState(partner.exitedDate ?? today);
  const [reason, setReason] = useState(partner.exitReason);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ids = { date: useId(), reason: useId(), error: useId() };
  const errorId = (field: string) => `${ids.error}-${field}`;
  const correct = () => {
    const outcome = dispatch({ kind: 'correctExit', partnerId: partner.id, exitedDate: date, reason }, { label: COPY.EXIT_CORRECTED });
    if (!outcome.ok) {
      const fields = outcome.fieldErrors ?? {};
      const reasonError = fields.reason ?? fields.exitReason;
      return setErrors(fields.exitedDate || reasonError
        ? { ...(fields.exitedDate ? { exitedDate: fields.exitedDate } : {}), ...(reasonError ? { reason: reasonError } : {}) }
        : { _: outcome.message });
    }
    // The editor's undo toast says "Exit corrected"; a second toast would repeat it.
    onDone();
  };
  const described = (field: string) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
  });
  return (
    <form aria-label={COPY.CORRECT_EXIT} className="mt-4 grid gap-4" onSubmit={(e) => { e.preventDefault(); correct(); }}>
      <div className="grid gap-1">
        <label htmlFor={ids.date} className="text-sm font-medium">{COPY.FIELD_EXIT_DATE}</label>
        <input id={ids.date} type="date" value={date} {...described('exitedDate')} className={`${controlClass} w-auto`}
          onChange={(e) => { setDate(e.target.value); setErrors({}); }} />
        {errors.exitedDate && <p id={errorId('exitedDate')} className="text-xs text-danger">{errors.exitedDate}</p>}
      </div>
      <div className="grid gap-1">
        <label htmlFor={ids.reason} className="text-sm font-medium">{COPY.FIELD_REASON}</label>
        <textarea id={ids.reason} rows={3} value={reason} placeholder={COPY.EXIT_REASON_PLACEHOLDER} {...described('reason')}
          onChange={(e) => { setReason(e.target.value); setErrors({}); }}
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        {errors.reason && <p id={errorId('reason')} className="text-xs text-danger">{errors.reason}</p>}
      </div>
      {errors._ && <p role="alert" className="text-sm text-danger">{errors._}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{COPY.CANCEL}</Button>
        <Button type="submit" variant="primary">{COPY.CORRECT_EXIT}</Button>
      </div>
    </form>
  );
}

function ExitForm({ onDone }: { onDone: () => void }) {
  const { partner, dispatch, today } = usePartner();
  const [date, setDate] = useState(today);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ids = { date: useId(), reason: useId(), error: useId() };
  const errorId = (field: string) => `${ids.error}-${field}`;

  const exit = () => {
    const outcome = dispatch({ kind: 'markExited', partnerId: partner.id, exitedDate: date, reason });
    if (!outcome.ok) {
      // A too long reason comes back on the row's own field.
      const fields = outcome.fieldErrors ?? {};
      const reasonError = fields.reason ?? fields.exitReason;
      return setErrors(fields.exitedDate || reasonError
        ? { ...(fields.exitedDate ? { exitedDate: fields.exitedDate } : {}), ...(reasonError ? { reason: reasonError } : {}) }
        : { _: outcome.message });
    }
    toast(COPY.MARKED_EXITED);
    onDone();
  };
  const described = (field: string) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? errorId(field) : undefined,
  });

  return (
    <form aria-label={COPY.MARK_EXITED} className="mt-4 grid gap-4" onSubmit={(e) => { e.preventDefault(); exit(); }}>
      <div className="grid gap-1">
        <label htmlFor={ids.date} className="text-sm font-medium">{COPY.FIELD_EXIT_DATE}</label>
        <input id={ids.date} type="date" value={date} {...described('exitedDate')} className={`${controlClass} w-auto`}
          onChange={(e) => { setDate(e.target.value); setErrors({}); }} />
        {errors.exitedDate && <p id={errorId('exitedDate')} className="text-xs text-danger">{errors.exitedDate}</p>}
      </div>
      <div className="grid gap-1">
        <label htmlFor={ids.reason} className="text-sm font-medium">{COPY.FIELD_REASON}</label>
        <textarea id={ids.reason} rows={3} value={reason} placeholder={COPY.EXIT_REASON_PLACEHOLDER} {...described('reason')}
          onChange={(e) => { setReason(e.target.value); setErrors({}); }}
          className="w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30" />
        {errors.reason && <p id={errorId('reason')} className="text-xs text-danger">{errors.reason}</p>}
      </div>
      {errors._ && <p role="alert" className="text-sm text-danger">{errors._}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>{COPY.CANCEL}</Button>
        <Button type="submit" variant="primary">{COPY.MARK_EXITED}</Button>
      </div>
    </form>
  );
}

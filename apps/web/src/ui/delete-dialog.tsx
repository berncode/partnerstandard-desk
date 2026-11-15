'use client';

import { COPY } from '@partner-desk/copy';
import { useState, useTransition } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { useViewer } from '@/storage-context';
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';

/**
 * A Delete button that asks first: a dialog naming what goes, then `remove` (the Drive trash). A refusal stays in the
 * dialog with its reason. `onDeleted` runs once it is gone. Used for programs (Basics, the Programs page), cases and MAPs.
 * A company server's viewer can't delete any of them: they see no button (owner, 2026-11-14).
 */
export function DeleteDialog(props: DeleteDialogProps) {
  return useViewer() ? null : <AskThenDelete {...props} />;
}

interface DeleteDialogProps {
  /** The button's text, on the page and in the dialog ("Delete program"). */
  action: string;
  /** The dialog's question ("Delete Reseller · DACH?"). */
  title: string;
  /** What happens, in the dialog. */
  text: string;
  /** The button's name when several show on one page ("Delete Reseller · DACH"). */
  label?: string;
  remove: () => Promise<RemoteOutcome>;
  onDeleted: () => void;
  size?: 'sm';
  disabled?: boolean;
}

function AskThenDelete({ action, title, text, label, remove, onDeleted, size, disabled }: DeleteDialogProps) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startPending] = useTransition();

  const confirm = () => startPending(async () => {
    setError(null);
    let result: RemoteOutcome;
    try {
      result = await remove();
    } catch {
      result = { ok: false, error: 'unavailable', message: COPY.SOMETHING_WRONG };
    }
    if (!result.ok) {
      setError(result.message);
      return;
    }
    // Next may keep this page, hidden: it must not come back with the dialog open.
    setOpen(false);
    onDeleted();
  });

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!pending) { setOpen(next); if (!next) setError(null); } }}>
      <Button variant="danger" size={size} className="border border-danger/40" aria-label={label} disabled={disabled} onClick={() => setOpen(true)}>{action}</Button>
      {open && (
        <DialogContent title={title} description={text}>
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" disabled={pending} onClick={() => setOpen(false)}>{COPY.CANCEL}</Button>
            <Button variant="danger" className="border border-danger/40" disabled={pending} aria-busy={pending || undefined} onClick={confirm}>
              {action}
            </Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

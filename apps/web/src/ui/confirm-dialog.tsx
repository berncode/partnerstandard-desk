'use client';

import { COPY } from '@partner-desk/copy';
import { Button } from './button';
import { Dialog, DialogContent } from './dialog';

/**
 * Asks before a step that takes something away: a title (the question), what goes with it, Cancel and the action.
 * While `busy` the action can't be pressed again.
 */
export function ConfirmDialog({ open, onOpenChange, title, text, action, onConfirm, busy = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  text: string;
  action: string;
  onConfirm: () => void;
  busy?: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      {open && (
        <DialogContent title={title} description={text}>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>{COPY.CANCEL}</Button>
            <Button variant="danger" className="border border-danger/40" disabled={busy} aria-busy={busy} onClick={() => { if (!busy) onConfirm(); }}>{action}</Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

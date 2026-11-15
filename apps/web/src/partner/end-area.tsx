'use client';

// The partner page's close area, with signing and the exit: a partner in recruitment is closed or signed, and a signed one ends only through Mark exited.
import { CLOSED_LABELS, COPY } from '@partner-desk/copy';
import { useState, type ReactNode } from 'react';
import { formatDate } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { Chip } from '@/ui/chip';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { CloseDialog } from './close-dialog';
import { CorrectExitDialog, ExitDialog } from './exit-dialog';
import { useAct, usePartner } from './partner-context';
import { endStateOf } from './partner-model';
import { SignDialog } from './sign-dialog';

function Ended({ children, reason, action }: { children: ReactNode; reason: string; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-xl bg-surface-2/60 p-3 text-sm">
      <div className="min-w-0 flex-1 basis-56">
        <p className="flex flex-wrap items-center gap-2">{children}</p>
        {reason && <p className="mt-1 break-words whitespace-pre-wrap">{reason}</p>}
      </div>
      {action}
    </div>
  );
}

export function EndArea() {
  const { account, partner, readOnly } = usePartner();
  const act = useAct();
  const [open, setOpen] = useState<'close' | 'sign' | 'exit' | 'correct' | 'unsign' | null>(null);
  const opener = (which: 'close' | 'sign' | 'exit' | 'correct' | 'unsign') => (next: boolean) => setOpen(next ? which : null);

  switch (endStateOf(partner)) {
    case 'closed':
      return (
        <Ended reason={partner.closedReason} action={!readOnly && (
          <Button size="sm" onClick={() => act({ kind: 'reopen', partnerId: partner.id }, { label: COPY.REOPENED })}>{COPY.REOPEN}</Button>
        )}>
          <span className="text-ink-3">{COPY.CLOSED_AS}</span>
          <Chip>{CLOSED_LABELS[partner.closed ?? 'no']}</Chip>
        </Ended>
      );
    case 'exited':
      return (
        <Ended reason={partner.exitReason} action={!readOnly && (
          <>
            <Button size="sm" onClick={() => setOpen('correct')}>{COPY.CORRECT_EXIT}</Button>
            <CorrectExitDialog open={open === 'correct'} onOpenChange={opener('correct')} />
          </>
        )}>
          <span className="font-medium">{COPY.EXITED_ON_DATE(formatDate(partner.exitedDate))}</span>
        </Ended>
      );
    case 'signed': {
      const signedOn = formatDate(partner.signedDate);
      return (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium">{signedOn ? COPY.SIGNED_ON(signedOn) : COPY.SIGNED_ON_UNKNOWN}</p>
          {!readOnly && (
            <>
              <Button size="sm" onClick={() => setOpen('exit')}>{COPY.MARK_EXITED}</Button>
              <Button size="sm" variant="ghost" onClick={() => setOpen('unsign')}>{COPY.UNDO_SIGNING}</Button>
              <ExitDialog open={open === 'exit'} onOpenChange={opener('exit')} />
              <ConfirmDialog open={open === 'unsign'} onOpenChange={opener('unsign')}
                title={COPY.UNDO_SIGNING_TITLE(account.company)} text={COPY.UNDO_SIGNING_TEXT} action={COPY.UNDO_SIGNING}
                onConfirm={() => {
                  setOpen(null);
                  act({ kind: 'undoSigned', partnerId: partner.id }, { label: COPY.SIGNING_UNDONE });
                }} />
            </>
          )}
        </div>
      );
    }
    case 'recruiting':
      if (readOnly) return null;
      return (
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" className="-ml-2" onClick={() => setOpen('close')}>{COPY.CLOSE_PARTNER}</Button>
          <Button size="sm" variant={partner.step === 'map' ? 'primary' : 'secondary'} onClick={() => setOpen('sign')}>{COPY.MARK_SIGNED}</Button>
          <CloseDialog open={open === 'close'} onOpenChange={opener('close')} />
          <SignDialog open={open === 'sign'} onOpenChange={opener('sign')} />
        </div>
      );
  }
}

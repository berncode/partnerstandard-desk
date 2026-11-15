'use client';

// The case page holds whether the case is shared (CaseHost), so an action updates it there instead of reloading the page.
import { COPY } from '@partner-desk/copy';
import { useRef, useState, useTransition } from 'react';
import { fieldControl } from '@/programs/field';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { CopyButton } from '@/ui/copy-button';
import { Dialog, DialogContent } from '@/ui/dialog';
import { useViewer } from '@/storage-context';

export type ActionResult = { ok: true } | { ok: false; message: string };
export type ShareResult = { ok: true; url: string } | { ok: false; message: string };

export interface ShareActions {
  share: (id: string) => Promise<ShareResult>;
  stop: (id: string) => Promise<ActionResult>;
}

type Confirm = 'stop' | 'renew';

const sharedOn = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/**
 * The links made in this browser tab, by case id. Only the token's hash is stored, so a link can be shown only to the
 * owner who just made it; this keeps it on screen when the Share tab is shown again.
 */
const madeLinks = new Map<string, string>();

/**
 * Sharing a case by a secret link (BC v1 §6.4, on the Share tab): Share a link with <partner>; once shared, when it
 * was shared, the link just made (with Copy), Make a new link and Stop sharing. Each change asks first, except the
 * first share. The link shows the case as it is now (BC v2 §5), so there is no older offer to update to. `sharedAt`
 * comes from the page, which `actions` update.
 */
export function ShareControls({ caseId, partner, sharedAt, actions, align = 'start' }: {
  caseId: string;
  partner: string;
  sharedAt: string | null;
  actions: ShareActions;
  align?: 'start' | 'end';
}) {
  const [url, setUrl] = useState<string | null>(() => madeLinks.get(caseId) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<Confirm | null>(null);
  const [pending, startPending] = useTransition();
  const linkField = useRef<HTMLInputElement>(null);
  // A company server's viewer shares nothing: they see when the case was shared, with no button (owner, 2026-11-14).
  const viewer = useViewer();

  const remember = (made: string | null) => {
    if (made) madeLinks.set(caseId, made);
    else madeLinks.delete(caseId);
    setUrl(made);
  };

  const run = (action: 'share' | Confirm) => startPending(async () => {
    setError(null);
    try {
      if (action === 'stop') {
        const stopped = await actions.stop(caseId);
        if (!stopped.ok) {
          setError(stopped.message);
          return;
        }
        remember(null);
      } else {
        const shared = await actions.share(caseId);
        if (!shared.ok) {
          setError(shared.message);
          return;
        }
        remember(shared.url);
      }
    } catch {
      setError(COPY.SOMETHING_WRONG);
      return;
    }
    setConfirming(null);
  });

  const shown = sharedAt ? url : null;
  const row = cn('flex flex-wrap items-center gap-2', align === 'end' && 'justify-end');
  if (viewer && sharedAt === null) return null;

  return (
    <div className="grid min-w-0 gap-2 print:hidden">
      {sharedAt === null ? (
        <div className={row}>
          {/* A long partner name wraps instead of pushing the page sideways. */}
          <Button variant="primary" className="h-auto min-h-10 max-w-full py-2 break-words" disabled={pending} aria-busy={pending}
            onClick={() => run('share')}>{`Share a link with ${partner}`}</Button>
        </div>
      ) : (
        <>
          <div className={row}>
            <span className="text-sm text-ink-2">{`Shared on ${sharedOn.format(new Date(sharedAt))}.`}</span>
            {!viewer && (
              <>
                <Button size="sm" disabled={pending} onClick={() => setConfirming('renew')}>Make a new link</Button>
                <Button size="sm" variant="danger" disabled={pending} onClick={() => setConfirming('stop')}>Stop sharing</Button>
              </>
            )}
          </div>
          {shown && (
            <div className="grid gap-1.5 rounded-lg border border-line bg-surface p-3">
              <div className="flex flex-wrap items-center gap-2">
                <input ref={linkField} readOnly value={shown} aria-label={`Link for ${partner}`} onFocus={(e) => e.currentTarget.select()}
                  className={cn(fieldControl, 'h-9 min-w-0 flex-1 basis-64 py-0 font-mono text-[13px]')} />
                <CopyButton text={shown} onCopyFailed={() => linkField.current?.select()}>Copy link</CopyButton>
              </div>
              <p className="text-xs text-ink-3">Anyone with this link can see the case. Copy it now: it can’t be shown again.</p>
            </div>
          )}
        </>
      )}
      {error && !confirming && <p role="alert" className={cn('text-sm text-danger', align === 'end' && 'text-right')}>{error}</p>}
      <ConfirmDialog what={confirming} partner={partner} pending={pending} error={error}
        onConfirm={() => confirming && run(confirming)} onClose={() => {
          setConfirming(null);
          setError(null);
        }} />
    </div>
  );
}

const CONFIRM: Record<Confirm, { title: (partner: string) => string; description: string; action: string }> = {
  stop: { title: (partner) => `Stop sharing with ${partner}?`, description: 'The link stops working. Sharing again makes a new link.', action: 'Stop sharing' },
  renew: { title: () => 'Make a new link?', description: 'The link you sent stops working. Send the new one instead.', action: 'Make a new link' },
};

/** Asks before a change the partner will see. */
function ConfirmDialog({ what, partner, pending, error, onConfirm, onClose }: {
  what: Confirm | null; partner: string; pending: boolean; error: string | null; onConfirm: () => void; onClose: () => void;
}) {
  // Keeps the wording while the dialog closes.
  const [shown, setShown] = useState<Confirm | null>(what);
  if (what && what !== shown) setShown(what);
  const copy = shown ? CONFIRM[shown] : null;
  return (
    <Dialog open={what !== null} onOpenChange={(open) => {
      if (!open) onClose();
    }}>
      {copy && (
        <DialogContent title={copy.title(partner)} description={copy.description} className="break-words">
          {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant={shown === 'stop' ? 'danger' : 'primary'} className={shown === 'stop' ? 'border border-danger/40' : undefined}
              disabled={pending} aria-busy={pending} onClick={onConfirm}>{copy.action}</Button>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}

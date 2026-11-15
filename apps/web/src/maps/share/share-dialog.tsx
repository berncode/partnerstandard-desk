'use client';

// In COPY's words. Send link shows only once email is set up (task 8); until then Copy link is the way to share.
import { COPY } from '@partner-desk/copy';
import { Link2, Mail, Share2, UserX } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { Button } from '@/ui/button';
import { CopyButton } from '@/ui/copy-button';
import { Dialog, DialogContent } from '@/ui/dialog';
import type { ShareActions, SharePersonView, ShareView } from './share-types';

const usedOn = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

function statusOf(person: SharePersonView): string {
  if (person.active) return person.lastUsedAt ? COPY.MAP_SHARE_LAST_USED(usedOn(person.lastUsedAt)) : COPY.MAP_SHARE_NOT_USED;
  return COPY.MAP_SHARE_NO_ACTIVE(person.lastUsedAt ? usedOn(person.lastUsedAt) : null);
}

const nameOf = (person: SharePersonView): string => person.name ?? COPY.MAP_SHARE_SOMEONE_REMOVED;

/** The owner's Share button, next to Present, with its dialog. */
export function ShareButton({ mapId, actions }: { mapId: string; actions: ShareActions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Share2 className="h-4 w-4" aria-hidden />
        {COPY.MAP_SHARE}
      </Button>
      <ShareDialog mapId={mapId} open={open} onOpenChange={setOpen} actions={actions} />
    </>
  );
}

/** Share dialog (spec 4): per person Send link, Copy link and Revoke, with when the link was last used. Owner only. */
export function ShareDialog({ mapId, open, onOpenChange, actions }: {
  mapId: string; open: boolean; onOpenChange: (open: boolean) => void; actions: ShareActions;
}) {
  const [view, setView] = useState<ShareView | null>(null);
  const [loading, startLoading] = useTransition();
  const reload = useCallback(() => startLoading(async () => {
    try {
      setView(await actions.load(mapId));
    } catch {
      setView({ ok: false, message: COPY.MAP_SHARE_LOAD_FAILED });
    }
  }), [actions, mapId]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const mailOn = view?.ok === true && view.mailConfigured && actions.send !== undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={COPY.MAP_SHARE_TITLE} description={COPY.MAP_SHARE_TEXT}>
        <div className="mt-4 max-h-[70vh] space-y-4 overflow-y-auto">
          {loading && !view && <p aria-busy="true" className="text-sm text-ink-3">{COPY.MAP_SHARE_LOADING}</p>}
          {view && !view.ok && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{view.message}</p>}
          {view?.ok && view.people.length === 0 && <p className="text-sm text-ink-2">{COPY.MAP_SHARE_NOBODY}</p>}
          {view?.ok && view.people.length > 0 && (
            <>
              {(['us', 'partner'] as const).map((side) => {
                const people = view.people.filter((p) => p.side === side);
                if (people.length === 0) return null;
                return (
                  <section key={side} aria-labelledby={`share-${side}`}>
                    <h3 id={`share-${side}`} className="text-sm font-semibold">{side === 'us' ? view.ourName : view.partnerName}</h3>
                    <ul className="mt-2 divide-y divide-line">
                      {people.map((person) => (
                        <ShareRow key={person.personId} mapId={mapId} person={person} mailOn={mailOn} actions={actions} onChanged={reload} />
                      ))}
                    </ul>
                  </section>
                );
              })}
              {!mailOn && <p className="text-xs text-ink-3">{COPY.MAP_SHARE_NO_MAIL}</p>}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareRow({ mapId, person, mailOn, actions, onChanged }: {
  mapId: string; person: SharePersonView; mailOn: boolean; actions: ShareActions; onChanged: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const revokeRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(false);
  const canRevoke = person.active || !person.inPlan;
  const name = nameOf(person);

  useEffect(() => {
    if (confirming) removeRef.current?.focus();
    else if (restoreFocus.current) { restoreFocus.current = false; revokeRef.current?.focus(); }
  }, [confirming]);

  // A link that is no longer active must not stay on screen to be copied.
  const shownUrl = person.active ? url : null;

  const run = (work: () => Promise<void>) => startTransition(async () => {
    try {
      await work();
    } catch {
      setNote({ ok: false, message: COPY.SOMETHING_WRONG });
    }
  });
  const send = actions.send;

  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{name}</p>
          {person.email && <p className="truncate text-xs text-ink-3">{person.email}</p>}
          <p className="text-xs text-ink-3">{person.inPlan ? statusOf(person) : COPY.MAP_SHARE_NOT_IN_MAP}</p>
        </div>
        <div className="flex flex-wrap gap-1">
          {person.inPlan && (
            <>
              {mailOn && send && (
                <Button size="sm" aria-label={COPY.MAP_SEND_LINK_TO(name)} disabled={pending}
                  onClick={() => run(async () => { const result = await send(mapId, person.personId); setNote(result); if (result.ok) onChanged(); })}>
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  {COPY.MAP_SEND_LINK}
                </Button>
              )}
              <Button size="sm" aria-label={COPY.MAP_COPY_LINK_FOR(name)} disabled={pending}
                onClick={() => run(async () => {
                  const result = await actions.copy(mapId, person.personId);
                  if (result.ok) { setUrl(result.url); setNote(null); onChanged(); } else setNote(result);
                })}>
                <Link2 className="h-3.5 w-3.5" aria-hidden />
                {COPY.MAP_COPY_LINK}
              </Button>
            </>
          )}
          {canRevoke && !confirming && (
            <Button ref={revokeRef} size="sm" variant="ghost" aria-label={COPY.MAP_REVOKE_FOR(name)} disabled={pending} onClick={() => setConfirming(true)}>
              <UserX className="h-3.5 w-3.5" aria-hidden />
              {COPY.MAP_REVOKE}
            </Button>
          )}
        </div>
      </div>
      {confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-danger-soft p-2 text-sm text-danger">
          <span id={`share-warning-${person.personId}`} className="min-w-0 flex-1">{COPY.MAP_REVOKE_WARNING(name)}</span>
          <Button ref={removeRef} size="sm" variant="danger" disabled={pending} aria-label={COPY.MAP_REMOVE_ACCESS_FOR(name)} aria-describedby={`share-warning-${person.personId}`}
            onClick={() => run(async () => {
              const result = await actions.revoke(mapId, person.personId);
              setConfirming(false);
              if (result.ok) setUrl(null);
              setNote(result);
              onChanged();
            })}>
            {COPY.MAP_REMOVE_ACCESS}
          </Button>
          <Button size="sm" variant="ghost" aria-label={COPY.MAP_CANCEL_REMOVE_FOR(name)} onClick={() => { restoreFocus.current = true; setConfirming(false); }}>{COPY.CANCEL}</Button>
        </div>
      )}
      {shownUrl && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <label htmlFor={`share-url-${person.personId}`} className="sr-only">{COPY.MAP_LINK_FOR(name)}</label>
          <input id={`share-url-${person.personId}`} readOnly value={shownUrl} onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2 py-1.5 font-mono text-xs text-ink-2" />
          <CopyButton text={shownUrl}>{COPY.MAP_COPY}</CopyButton>
        </div>
      )}
      {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'mt-1 text-xs text-ink-2' : 'mt-1 text-xs text-danger'}>{note.message}</p>}
    </li>
  );
}

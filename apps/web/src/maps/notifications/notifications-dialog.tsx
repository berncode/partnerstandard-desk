'use client';

// The notifications dialog, in COPY's words.
import { DUE_SOON_CHOICES, PARTNER_ALERT_MODES, type NotifySettings } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Bell } from 'lucide-react';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { Button } from '@/ui/button';
import { Dialog, DialogContent } from '@/ui/dialog';
import type { NotificationActions, NotificationSettingsView } from './notification-types';

/** The owner's Notifications button, next to Share, with its dialog. */
export function NotificationsButton({ mapId, actions }: { mapId: string; actions: NotificationActions }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Bell className="h-4 w-4" aria-hidden />
        {COPY.MAP_NOTIFY}
      </Button>
      <NotificationsDialog mapId={mapId} open={open} onOpenChange={setOpen} actions={actions} />
    </>
  );
}

/** A MAP's email settings. Owner only; the actions check that on the server. */
export function NotificationsDialog({ mapId, open, onOpenChange, actions }: {
  mapId: string; open: boolean; onOpenChange: (open: boolean) => void; actions: NotificationActions;
}) {
  const [view, setView] = useState<NotificationSettingsView | null>(null);
  const [draft, setDraft] = useState<NotifySettings | null>(null);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();

  const reload = useCallback(() => startLoading(async () => {
    setNote(null);
    try {
      const loaded = await actions.load(mapId);
      setView(loaded);
      if (loaded.ok) {
        const { dueSoonDays, partnerAlerts, partnerDigest } = loaded.settings;
        setDraft({ dueSoonDays, partnerAlerts, partnerDigest });
      }
    } catch {
      setView({ ok: false, message: COPY.MAP_NOTIFY_LOAD_FAILED });
    }
  }), [actions, mapId]);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  const save = (settings: NotifySettings) => startSaving(async () => {
    try {
      setNote(await actions.save(mapId, settings));
    } catch {
      setNote({ ok: false, message: COPY.SOMETHING_WRONG });
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={COPY.MAP_NOTIFY} description={COPY.MAP_NOTIFY_TEXT}>
        <div className="mt-4 max-h-[70vh] space-y-5 overflow-y-auto">
          {loading && !view && <p aria-busy="true" className="text-sm text-ink-3">{COPY.MAP_NOTIFY_LOADING}</p>}
          {view && !view.ok && <p role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">{view.message}</p>}
          {view?.ok && draft && (
            <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); save(draft); }}>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-semibold">{COPY.MAP_NOTIFY_REMIND}</legend>
                <p className="text-xs text-ink-3">{COPY.MAP_NOTIFY_REMIND_HINT}</p>
                {DUE_SOON_CHOICES.map((days) => (
                  <label key={days} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="due-soon" className="accent-brand" checked={draft.dueSoonDays === days}
                      onChange={() => setDraft({ ...draft, dueSoonDays: days })} />
                    {COPY.MAP_NOTIFY_DAYS_BEFORE(days)}
                  </label>
                ))}
              </fieldset>
              <fieldset className="space-y-1.5">
                <legend className="text-sm font-semibold">{COPY.MAP_NOTIFY_ALERTS}</legend>
                <p className="text-xs text-ink-3">{COPY.MAP_NOTIFY_ALERTS_HINT}</p>
                {PARTNER_ALERT_MODES.map((mode) => (
                  <label key={mode} className="flex items-center gap-2 text-sm">
                    <input type="radio" name="partner-alerts" className="accent-brand" checked={draft.partnerAlerts === mode}
                      onChange={() => setDraft({ ...draft, partnerAlerts: mode })} />
                    {COPY.MAP_NOTIFY_ALERT_CHOICES[mode]}
                  </label>
                ))}
              </fieldset>
              <div className="space-y-1">
                <label className="flex items-center gap-2 text-sm font-semibold">
                  <input type="checkbox" className="accent-brand" checked={draft.partnerDigest}
                    onChange={(e) => setDraft({ ...draft, partnerDigest: e.target.checked })} />
                  {COPY.MAP_NOTIFY_PARTNER_DIGEST}
                </label>
                <p className="text-xs text-ink-3">{COPY.MAP_NOTIFY_PARTNER_DIGEST_HINT}</p>
              </div>
              <p className="text-xs text-ink-3">{COPY.MAP_NOTIFY_WHEN(view.settings.timezone)}</p>
              {!view.settings.mailConfigured && <p className="text-xs text-ink-3">{COPY.MAP_NOTIFY_NO_MAIL}</p>}
              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" variant="primary" disabled={saving} aria-busy={saving}>{COPY.SAVE}</Button>
                {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-sm text-ink-2' : 'text-sm text-danger'}>{note.message}</p>}
              </div>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

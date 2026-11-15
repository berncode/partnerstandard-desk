'use client';

// The timezone is picked by hand only, Europe/Berlin until then [builder's call: no browser capture].
import { COPY } from '@partner-desk/copy';
import { useState, useTransition } from 'react';
import { Field, fieldControl } from '@/markets/fields';
import { Button } from '@/ui/button';
import { companyTimeZone } from '../actions/company';

/** The person's timezone: their MAPs count "today" in it, and the emails go out at 08:00 in it. */
export function TimeZoneForm({ initial, choices }: { initial: string; choices: string[] }) {
  const [zone, setZone] = useState(initial);
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();
  const save = () => startSaving(async () => {
    try {
      const result = await companyTimeZone({ timeZone: zone });
      setNote(result.ok ? { ok: true, message: COPY.SETTINGS_SAVED } : { ok: false, message: result.fieldErrors?.timeZone ?? result.message });
    } catch {
      setNote({ ok: false, message: COPY.SETTINGS_WRONG });
    }
  });
  return (
    <form noValidate className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="max-w-sm">
        <Field label={COPY.SETTINGS_TIME_ZONE_FIELD} hint={COPY.SETTINGS_TIME_ZONE_HINT}>
          {(describedBy) => (
            <select className={fieldControl} value={zone} aria-describedby={describedBy} onChange={(e) => setZone(e.target.value)}>
              {choices.map((choice) => <option key={choice} value={choice}>{choice.replaceAll('_', ' ')}</option>)}
            </select>
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving} aria-busy={saving}>{COPY.SETTINGS_TIME_ZONE_SAVE}</Button>
        {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-sm text-ink-2' : 'text-sm text-danger'}>{note.message}</p>}
      </div>
    </form>
  );
}

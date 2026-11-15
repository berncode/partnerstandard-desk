'use client';

// Saves through the `companyRename` action.
import { COPY } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Field, fieldControl } from '@/markets/fields';
import { Button } from '@/ui/button';
import { companyRename } from '../actions/company';

/** The company name the search prompts use. The command trims and checks it again; the sidebar shows the new name. */
export function CompanyForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState(initial);
  const [saved, setSaved] = useState(initial.trim());
  const [note, setNote] = useState<{ ok: boolean; message: string } | null>(null);
  const [saving, startSaving] = useTransition();

  const save = () => startSaving(async () => {
    try {
      const result = await companyRename({ name: companyName });
      if (!result.ok) return void setNote({ ok: false, message: result.fieldErrors?.name ?? result.message });
      setCompanyName(result.name);
      setSaved(result.name);
      setNote({ ok: true, message: COPY.SETTINGS_SAVED });
      // The sidebar reads the name on the server: ask for the page again.
      router.refresh();
    } catch {
      setNote({ ok: false, message: COPY.SETTINGS_WRONG });
    }
  });

  return (
    <form noValidate className="space-y-3" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="max-w-md">
        <Field label={COPY.SETTINGS_COMPANY_FIELD} hint={saved ? COPY.SETTINGS_COMPANY_HINT(saved) : COPY.SETTINGS_COMPANY_HINT_EMPTY}>
          {(describedBy) => (
            <input className={fieldControl} value={companyName} maxLength={80} autoComplete="organization"
              aria-describedby={describedBy} onChange={(e) => setCompanyName(e.target.value)} />
          )}
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" disabled={saving} aria-busy={saving}>{COPY.SAVE}</Button>
        {note && <p role={note.ok ? 'status' : 'alert'} className={note.ok ? 'text-sm text-ink-2' : 'text-sm text-danger'}>{note.message}</p>}
      </div>
    </form>
  );
}

'use client';

import type { PartnerChange } from '@partner-desk/core';
import { PARTNER_CATEGORIES, PARTNER_CATEGORY_INFO, PARTNER_TYPE_LABELS, PARTNER_TYPES, RECRUITMENT_STEPS, STAGE_LABELS, STEP_LABELS, partnerTypesIn, type PartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { useId, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/ui/button';
import { controlClass } from '@/ui/control';
import { Dialog, DialogContent } from '@/ui/dialog';
import type { DispatchOptions, SaveOutcome } from '@/editor/use-editor';
import { isSignedWhere, placementChanges, WHERE_STAGES, type Where } from '@/partners/partners-model';

/** Adds one partner type to a company that is already here, and puts it where the person says it stands. */
export function AddTypeDialog({ open, onOpenChange, accountId, taken, apply, onAdded, today }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  accountId: string;
  taken: readonly PartnerType[];
  apply: (change: PartnerChange, options?: DispatchOptions) => Promise<SaveOutcome>;
  onAdded: (partnerType: PartnerType) => void;
  /** The owner's today, in their Settings time zone: the date "Signed on" starts on. */
  today: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent title={COPY.ADD_PARTNER_TYPE} description={COPY.ADD_PARTNER_TYPE_TEXT}>
          <AddTypeForm accountId={accountId} taken={taken} apply={apply} onAdded={onAdded} today={today} onClose={() => onOpenChange(false)} />
        </DialogContent>
      )}
    </Dialog>
  );
}

function Field({ label, htmlFor, error, children }: { label: string; htmlFor: string; error?: string; children: ReactNode }) {
  return (
    <div className="grid gap-1">
      <label htmlFor={htmlFor} className="text-sm font-medium">{label}</label>
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}

function AddTypeForm({ accountId, taken, apply, onAdded, today, onClose }: {
  accountId: string;
  taken: readonly PartnerType[];
  apply: (change: PartnerChange, options?: DispatchOptions) => Promise<SaveOutcome>;
  onAdded: (partnerType: PartnerType) => void;
  today: string;
  onClose: () => void;
}) {
  const openTypes = PARTNER_TYPES.filter((type) => !taken.includes(type));
  const ids = { type: useId(), where: useId(), signed: useId() };
  const [partnerType, setPartnerType] = useState<PartnerType>(openTypes[0] ?? 'other');
  const [where, setWhere] = useState<Where>('researched');
  const [signedDate, setSignedDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // A save with no clear answer may be in the file: adding again could make the type twice, so adding stays off.
  const [unclear, setUnclear] = useState(false);
  const signed = isSignedWhere(where);

  const add = async () => {
    if (busy || unclear || openTypes.length === 0) return;
    setBusy(true);
    setError(null);
    const added = await apply({ kind: 'add', entity: 'partner', values: { accountId, partnerType } });
    if (!added.ok || !added.entityId) {
      setBusy(false);
      if (!added.ok && added.unknown) setUnclear(true);
      else setError((!added.ok && added.message) || COPY.SAVE_OFFLINE);
      return;
    }
    const moves = placementChanges(added.entityId, where, signedDate);
    let done = 0;
    for (const move of moves) {
      if (!(await apply(move)).ok) break;
      done++;
    }
    // The type is there either way. After a failed move it is where the last good move left it (the editor says why).
    if (done < moves.length) toast(COPY.PARTNER_TYPE_ADDED_NOT_MOVED);
    onAdded(partnerType);
    onClose();
  };

  return (
    <form className="mt-4 grid gap-3" onSubmit={(e) => { e.preventDefault(); void add(); }}>
      <Field label={COPY.FIELD_PARTNER_TYPE} htmlFor={ids.type}>
        <select id={ids.type} value={partnerType} className={controlClass} onChange={(e) => setPartnerType(e.target.value as PartnerType)}>
          {PARTNER_CATEGORIES.map((category) => {
            const types = partnerTypesIn(category).filter((type) => openTypes.includes(type));
            if (types.length === 0) return null;
            return (
              <optgroup key={category} label={PARTNER_CATEGORY_INFO[category].shortName}>
                {types.map((type) => <option key={type} value={type}>{PARTNER_TYPE_LABELS[type]}</option>)}
              </optgroup>
            );
          })}
          {openTypes.includes('other') && <option value="other">{PARTNER_TYPE_LABELS.other}</option>}
        </select>
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={COPY.FIELD_WHERE} htmlFor={ids.where}>
          <select id={ids.where} value={where} className={controlClass} onChange={(e) => setWhere(e.target.value as Where)}>
            <optgroup label={STAGE_LABELS.recruitment}>
              {RECRUITMENT_STEPS.map((step) => <option key={step} value={step}>{STEP_LABELS[step]}</option>)}
            </optgroup>
            <optgroup label={COPY.WHERE_GROUP_WORKING}>
              {WHERE_STAGES.map((stage) => <option key={stage} value={stage}>{STAGE_LABELS[stage]}</option>)}
            </optgroup>
          </select>
        </Field>
        {signed && (
          <Field label={COPY.FIELD_SIGNED_ON} htmlFor={ids.signed} error={error ?? undefined}>
            <input id={ids.signed} type="date" value={signedDate} className={controlClass} onChange={(e) => setSignedDate(e.target.value)} />
          </Field>
        )}
      </div>
      {error && !signed && <p role="alert" className="text-sm text-danger">{error}</p>}
      {unclear && <p role="alert" className="text-sm text-danger">{COPY.SAVE_ADD_UNKNOWN}</p>}
      <div className="mt-1 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>{COPY.CANCEL}</Button>
        <Button type="submit" variant="primary" disabled={busy || unclear || openTypes.length === 0}>{COPY.ADD}</Button>
      </div>
    </form>
  );
}

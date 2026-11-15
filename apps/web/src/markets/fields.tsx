'use client';

import {
  categoryOf,
  PARTNER_TYPE_INFO,
  PARTNER_TYPE_LABELS,
  RECRUITMENT_PARTNER_TYPES,
  type RecruitmentPartnerType,
} from '@partner-desk/method';
import {
  COPY,
} from '@partner-desk/copy';
import { useId, type ReactNode } from 'react';
import { cn } from '@/ui/cn';

export const fieldControl =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-70';

/** A label over a control, with a hint or (instead of it) the error. */
export function Field({ label, error, hint, children }: {
  label: string; error?: string; hint?: string; children: (describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className="grid content-start gap-1">
      <label className="grid content-start gap-1 text-xs font-medium text-ink-3">
        {label}
        {children(note ? id : undefined)}
      </label>
      {note && <p id={id} className={cn('text-xs', error ? 'text-danger' : 'text-ink-3')}>{note}</p>}
    </div>
  );
}

/** The partner types Recruitment offers: Channel types first, then Service. */
export function PartnerTypeSelect({ value, onChange, describedBy }: {
  value: RecruitmentPartnerType; onChange: (value: RecruitmentPartnerType) => void; describedBy?: string;
}) {
  return (
    <select className={cn(fieldControl, 'h-9 py-0')} value={value} aria-describedby={describedBy}
      onChange={(e) => onChange(e.target.value as RecruitmentPartnerType)}>
      {(['channel', 'service'] as const).map((category) => (
        <optgroup key={category} label={category === 'channel' ? COPY.CHANNEL : COPY.SERVICE}>
          {RECRUITMENT_PARTNER_TYPES.filter((t) => categoryOf(t) === category).map((t) => <option key={t} value={t}>{PARTNER_TYPE_LABELS[t]}</option>)}
        </optgroup>
      ))}
    </select>
  );
}

export const partnerTypeHint = (type: RecruitmentPartnerType): string => PARTNER_TYPE_INFO[type].description;

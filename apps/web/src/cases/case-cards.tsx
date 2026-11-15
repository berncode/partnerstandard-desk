'use client';

import { PARTNER_TYPE_LABELS, PARTNER_TYPES, type PartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { caseCopy, caseDelete } from '@/app/(signed-in)/actions/cases';
import { controlClass } from '@/ui/control';
import { cn } from '@/ui/cn';
import { CaseCard, type CaseById } from './case-card';
import type { CaseCardRow } from './case-rows';

/**
 * The Business cases page's cards, newest first, with a filter by partner type [builder's call] that offers the
 * types the cases have. Copy and Delete go through the `caseCopy` and `caseDelete` server actions unless given.
 */
export function CaseCards({ rows, copy = caseCopy, remove = caseDelete }: { rows: CaseCardRow[]; copy?: CaseById; remove?: CaseById }) {
  const filterId = useId();
  const [type, setType] = useState<PartnerType | ''>('');
  const types = PARTNER_TYPES.filter((t) => rows.some((r) => r.partnerType === t));
  const shown = type === '' ? rows : rows.filter((r) => r.partnerType === type);
  return (
    <div className="grid gap-4">
      {types.length > 1 && (
        <div className="grid w-full max-w-xs gap-1">
          <label htmlFor={filterId} className="text-xs font-medium text-ink-3">{COPY.CASES_FILTER}</label>
          <select id={filterId} className={cn(controlClass, 'px-2')} value={type} onChange={(e) => setType(e.target.value as PartnerType | '')}>
            <option value="">{COPY.CASES_FILTER_ALL}</option>
            {types.map((t) => <option key={t} value={t}>{PARTNER_TYPE_LABELS[t]}</option>)}
          </select>
        </div>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {shown.map((row) => (
          <li key={row.caseId} className="min-w-0">
            <CaseCard row={row} copy={copy} remove={remove} />
          </li>
        ))}
      </ul>
    </div>
  );
}

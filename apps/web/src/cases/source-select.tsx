'use client';

import { CASE_SOURCES as SOURCES, type CaseSource as Source } from '@partner-desk/core';
import { cn } from '@/ui/cn';
import { SOURCE_LABEL } from './source-label';

export { SOURCE_LABEL } from './source-label';

/** The options of a source select, in the order of SOURCES. */
export function SourceOptions() {
  return SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>);
}

/**
 * Where a figure comes from: a small select under its field, after the word "Source" (the prototype's `.srcline`).
 * `label` names it for screen readers, such as "Your gross margin source".
 */
export function SourceSelect({ id, label, value, onChange, className }: {
  id: string; label: string; value: Source; onChange: (s: Source) => void; className?: string;
}) {
  return (
    <div className={cn('mt-1 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3', className)}>
      <span aria-hidden>Source</span>
      <select id={id} aria-label={label} value={value} onChange={(e) => onChange(e.target.value as Source)}
        className="h-6 min-w-0 rounded-md border border-transparent bg-surface-2 pr-0.5 pl-1.5 text-xs text-ink-2 outline-none focus:border-brand focus:ring-2 focus:ring-brand/30">
        <SourceOptions />
      </select>
    </div>
  );
}

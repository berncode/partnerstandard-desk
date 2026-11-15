import type { Callout, Tone } from '@partner-desk/core';
import { cn } from '@/ui/cn';

const TONE: Record<Tone, string> = {
  good: 'bg-brand-soft text-brand-strong',
  info: 'bg-surface-2 text-ink-2',
  warn: 'bg-warn-soft text-warn',
};

/** The checks' call-outs: green when good, gray for information, amber for a warning. */
export function Callouts({ items, className }: { items: Callout[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <div className={cn('grid gap-2', className)}>
      {items.map((c) => <p key={c.text} className={cn('rounded-[10px] px-3 py-2.5 text-[13.5px] font-medium', TONE[c.tone])}>{c.text}</p>)}
    </div>
  );
}

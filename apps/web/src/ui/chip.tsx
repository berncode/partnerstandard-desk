// The chip and its tones; the recommendation chip lives with the screens that show recommendations.
import type { ReactNode } from 'react';
import { cn } from './cn';

export type ChipTone = 'neutral' | 'brand' | 'info' | 'warn' | 'danger';

const TONE: Record<ChipTone, string> = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand-soft text-brand-strong',
  info: 'bg-info-soft text-info',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
};

/** A small rounded label: a status, a state or a recommendation. */
export function Chip({ tone = 'neutral', className, children }: { tone?: ChipTone; className?: string; children: ReactNode }) {
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-0.5 text-xs font-semibold', TONE[tone], className)}>
      {children}
    </span>
  );
}

import type { ReactNode } from 'react';
import { cn } from '@/ui/cn';

/** A gray note under a card's fields. */
export function Note({ className, children }: { className?: string; children: ReactNode }) {
  return <p className={cn('mt-3 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-ink-2 first:mt-0', className)}>{children}</p>;
}

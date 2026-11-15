import type { ReactNode } from 'react';
import { cn } from '@/ui/cn';

/**
 * A card of an editor, named by its title. `internal` marks what never reaches a partner (our figures, our case): the
 * hint is in the warning color, as in the prototype's tab 3.
 */
export function Card({ id, title, hint, internal, className, children }: {
  id: string; title: string; hint?: string; internal?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-heading`}
      className={cn('min-w-0 rounded-xl border bg-surface p-4', internal ? 'border-warn/40' : 'border-line', className)}>
      <h2 id={`${id}-heading`} className="text-[15px] font-semibold">{title}</h2>
      {hint ? <p className={cn('mt-0.5 mb-3.5 text-xs', internal ? 'text-warn' : 'text-ink-3')}>{hint}</p> : <div className="mb-2.5" />}
      {children}
    </section>
  );
}

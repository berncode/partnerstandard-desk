// The same Field as the markets', with the label kept on one line, a centered label for a centered number, and the "optional" marker.
import { COPY } from '@partner-desk/copy';
import { useId, type ReactNode } from 'react';
import { cn } from '@/ui/cn';

/** The look of a text input or select inside a Field: the markets' `fieldControl` (src/markets/fields.tsx). */
export const fieldControl =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-70';

/**
 * A labeled control with an optional hint or error below it; `children` gets the id the control is described by. The
 * label stays on one line, so fields side by side line up on their controls.
 */
export function Field({ label, error, hint, center, optional, children }: {
  label: string; error?: string; hint?: string; center?: boolean;
  /** Marks the field "optional" after its label, in a lighter gray. */
  optional?: boolean;
  children: (describedBy?: string) => ReactNode;
}) {
  const id = useId();
  const note = error ?? hint;
  return (
    <div className="grid content-start gap-1">
      <label className="grid content-start gap-1 text-xs font-medium text-ink-3">
        <span className={cn('whitespace-nowrap', center && 'text-center')}>
          {label}
          {optional && <>{' '}<span className="text-[11.5px] font-normal">{COPY.OPTIONAL}</span></>}
        </span>
        {children(note ? id : undefined)}
      </label>
      {note && <p id={id} className={cn('text-xs', error ? 'text-danger' : 'text-ink-3')}>{note}</p>}
    </div>
  );
}

'use client';

// The small pieces the guided steps and the MAP page are made of, in COPY's words. There is no IssueHint: a MAP file's
// row issues name a tab and a row, not a row's id, so the page lists them together (plan-workspace.tsx).
import type { IsoDate, MapApplyOutcome } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { CalendarDays, Check, CircleAlert, LoaderCircle, Plus } from 'lucide-react';
import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import type { SaveState } from './use-plan-editor';
import type { DueTone } from './view-model';

export function Section({ title, description, actions, children, className }: {
  title: string; description?: string; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('min-w-0 rounded-xl border border-line bg-surface p-4', className)}>
      <div className="mb-3 flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-48">
          <h2 id={id} className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {description && <p className="mt-0.5 text-[13px] text-ink-3">{description}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

/** Empty-state suggestions from the method: one click adds one. */
export function Suggestions({ title, items, onPick }: { title: string; items: string[]; onPick: (item: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl border border-dashed border-line p-3">
      <p className="text-sm text-ink-2">{title}</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <li key={item} className="max-w-full">
            <button
              type="button"
              onClick={() => onPick(item)}
              className="inline-flex max-w-full items-start gap-1.5 rounded-xl border border-line bg-surface px-3 py-1.5 text-left text-sm text-ink-2 transition-colors hover:border-brand hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
            >
              <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand-strong" aria-hidden />
              <span className="break-words">{item}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PillSelect({ label, value, options, onChange, disabled, className }: {
  label: string; value: string; options: ReadonlyArray<readonly [string, string]>; onChange: (value: string) => void;
  disabled?: boolean; className?: string;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        'h-8 max-w-full truncate rounded-full border border-line bg-surface px-3 text-xs font-medium text-ink-2 hover:border-ink-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-70',
        className,
      )}
    >
      {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
    </select>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn('grid content-start gap-1 text-xs font-medium text-ink-3', className)}>
      {label}
      {children}
    </label>
  );
}

export const fieldControl =
  'h-9 w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30 disabled:opacity-70';

export function SaveIndicator({ state }: { state: SaveState }) {
  const text = { saved: COPY.SAVED, saving: COPY.SAVING, failed: COPY.NOT_SAVED }[state];
  const Icon = { saved: Check, saving: LoaderCircle, failed: CircleAlert }[state];
  return (
    <span role="status" aria-live="polite" className={cn('inline-flex items-center gap-1.5 text-xs', state === 'failed' ? 'text-danger' : 'text-ink-3')}>
      <Icon className={cn('h-3.5 w-3.5', state === 'saving' && 'animate-spin')} aria-hidden />
      {text}
    </span>
  );
}

/** "+ Add …" that opens a one-line input. Enter adds and keeps the input open for the next one; Esc closes. */
export function AddInline({ label, placeholder, field, onAdd, extra }: {
  label: string; placeholder?: string; field: string; onAdd: (value: string) => MapApplyOutcome; extra?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Set when the field closes, so the Add button takes focus once it is back. */
  const refocus = useRef(false);

  if (!open) {
    return (
      <Button
        ref={(el) => {
          if (el && refocus.current) {
            refocus.current = false;
            el.focus();
          }
        }}
        variant="ghost" size="sm" className="mt-2 -ml-2" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" aria-hidden />
        {label}
      </Button>
    );
  }

  // Only keys close the field (Escape, or Enter when it is empty), so focus always goes back to the Add button.
  const close = () => {
    refocus.current = true;
    setOpen(false);
    setValue('');
    setError(null);
  };
  const submit = () => {
    if (!value.trim()) return close();
    const outcome = onAdd(value.trim());
    if (!outcome.ok) {
      setError(outcome.fieldErrors?.[field] ?? outcome.message);
      return;
    }
    setValue('');
    setError(null);
  };

  return (
    <form className="mt-2" onSubmit={(e) => { e.preventDefault(); submit(); }}>
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Escape') close(); }}
          className={cn(fieldControl, 'flex-1 basis-48')}
        />
        {extra}
      </div>
      {error ? <p className="mt-1 text-xs text-danger">{error}</p> : <p className="mt-1 text-xs text-ink-3">{COPY.MAP_ENTER_TO_ADD}</p>}
    </form>
  );
}

const TONE_STYLE: Record<DueTone, string> = {
  none: 'text-ink-3',
  done: 'text-ink-3',
  overdue: 'font-medium text-danger',
  soon: 'font-medium text-warn',
  later: 'text-ink-2',
};

/** A date shown as text; one click turns it into a date input, which commits on blur or Enter. */
export function DateField({ value, label, display, tone = 'later', disabled, onChange }: {
  value: IsoDate | null; label: string; display: string; tone?: DueTone; disabled?: boolean; onChange: (value: IsoDate | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  if (editing && !disabled) {
    return (
      <input
        type="date"
        autoFocus
        aria-label={label}
        defaultValue={value ?? ''}
        onBlur={(e) => {
          setEditing(false);
          // A partially typed date reads as empty but is not a deliberate clear: keep the existing date.
          // (jsdom does not simulate validity.badInput, so this guard is not unit-testable.)
          if (e.currentTarget.validity.badInput) return;
          const next = e.target.value || null;
          if (next !== value) onChange(next);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setEditing(false);
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
        className="h-7 rounded-md border border-brand bg-surface px-1.5 text-xs text-ink outline-none ring-2 ring-brand/30"
      />
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => setEditing(true)}
      aria-label={`${label}: ${display}`}
      className={cn('inline-flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-surface-2 disabled:hover:bg-transparent', TONE_STYLE[tone])}
    >
      <CalendarDays className="h-3.5 w-3.5" aria-hidden />
      {display}
    </button>
  );
}

'use client';

// The words come from COPY.
import { COPY } from '@partner-desk/copy';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { cn } from './cn';

/** What a commit answers: saved, or why not (a field's own message, else a general one). */
export type CommitOutcome = { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string> };

export interface InlineTextProps {
  value: string;
  /** Accessible name, e.g. "Statement". */
  label: string;
  /** Return the outcome so validation errors show next to the field. */
  onCommit: (value: string) => CommitOutcome;
  /** Key in the outcome's fieldErrors, e.g. "statement". */
  field: string;
  placeholder?: string;
  multiline?: boolean;
  disabled?: boolean;
  className?: string;
  /** Values to suggest while typing (single line only), e.g. verticals already used. */
  suggestions?: string[];
}

/**
 * Text that turns into an input on click. Enter (Ctrl/Cmd+Enter when multiline) saves and shows why a value can't be
 * saved; blur saves, or drops a value that can't be saved; Escape cancels. After a keyboard commit or cancel, focus
 * goes back to the text so keyboard users keep their place.
 */
export function InlineText({ value, label, onCommit, field, placeholder, multiline, disabled, className, suggestions }: InlineTextProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const errorId = useId();
  const listId = useId();
  /** Set when a key closes the editor, so the text button takes focus once it is back. */
  const refocus = useRef(false);

  if (disabled) {
    if (!value) return null;
    return <span className={cn('block whitespace-pre-wrap break-words', className)}>{value}</span>;
  }

  if (draft === null) {
    return (
      <button
        ref={(el) => {
          if (el && refocus.current) {
            refocus.current = false;
            el.focus();
          }
        }}
        type="button"
        aria-label={`${label}: ${value || COPY.EMPTY_VALUE}`}
        onClick={() => { setDraft(value); setError(null); }}
        className={cn(
          '-mx-1 block w-[calc(100%+0.5rem)] cursor-text rounded-md px-1 text-left whitespace-pre-wrap break-words hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
          !value && 'text-ink-3',
          className,
        )}
      >
        {value || placeholder}
      </button>
    );
  }

  const close = (fromKey: boolean) => {
    refocus.current = fromKey;
    setDraft(null);
    setError(null);
  };
  const commit = (fromKey: boolean) => {
    if (draft.trim() === value.trim()) return close(fromKey);
    const outcome = onCommit(draft);
    if (outcome.ok) return close(fromKey);
    // On Enter the person is still here: show why. A blur means they moved on: drop the refused text, leave no stale error.
    if (!fromKey) return close(false);
    setError(outcome.fieldErrors?.[field] ?? outcome.message);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Enter' && (!multiline || e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      commit(true);
    }
  };
  const props = {
    autoFocus: true,
    'aria-label': label,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? errorId : undefined,
    value: draft,
    placeholder,
    onChange: (e: { target: { value: string } }) => { setDraft(e.target.value); setError(null); },
    onBlur: () => commit(false),
    onKeyDown,
    className: 'w-full rounded-md border border-brand bg-surface px-2 py-1 text-ink outline-none ring-2 ring-brand/30',
  };

  return (
    <div className={cn('w-full', className)}>
      {multiline ? <textarea rows={3} {...props} /> : <input type="text" list={suggestions?.length ? listId : undefined} {...props} />}
      {!multiline && suggestions && suggestions.length > 0 && (
        <datalist id={listId}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
      )}
      {error && <p id={errorId} className="mt-1 text-xs font-normal text-danger">{error}</p>}
    </div>
  );
}

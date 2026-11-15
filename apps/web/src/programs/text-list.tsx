'use client';

import { useRef } from 'react';
import { useViewer } from '@/storage-context';
import { Button } from '@/ui/button';
import { control, removeButton } from './form-styles';

/**
 * Editable lines of text, each with a remove button, and an add button below: the reasons to join and what it takes to
 * join. A line just added is focused.
 */
export function TextList({ items, onChange, label, removeLabel, addLabel, placeholder, max }: {
  items: string[];
  onChange: (items: string[]) => void;
  /** The accessible name of line `i` (0-based), such as "Reason 1". */
  label: (i: number) => string;
  removeLabel: (i: number) => string;
  addLabel: string;
  placeholder?: string;
  /** No add button past this many lines. */
  max: number;
}) {
  /** The line to focus once it is on screen: the one just added. */
  const focusLine = useRef<number | null>(null);
  // A company server's viewer reads the lines, with no Add or Remove (owner, 2026-11-14).
  const viewer = useViewer();
  return (
    <div>
      {items.length > 0 && (
        <ul className="grid gap-1.5">
          {items.map((text, i) => (
            <li key={i} className="grid grid-cols-[minmax(0,1fr)_28px] items-center gap-1.5">
              <input className={control} value={text} aria-label={label(i)} placeholder={placeholder}
                ref={(el) => {
                  if (el && focusLine.current === i) {
                    focusLine.current = null;
                    el.focus();
                  }
                }}
                onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))} />
              {!viewer && (
                <button type="button" className={removeButton} aria-label={removeLabel(i)}
                  onClick={() => onChange(items.filter((_, j) => j !== i))}>×</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {items.length < max && !viewer && (
        <Button size="sm" className="mt-1.5" onClick={() => { focusLine.current = items.length; onChange([...items, '']); }}>{addLabel}</Button>
      )}
    </div>
  );
}

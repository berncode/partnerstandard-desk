'use client';

// The words come from COPY.
import type { Score } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { cn } from './cn';

const SCORES: Score[] = [0, 1, 2, 3];

/**
 * A 0 to 3 score: four buttons and Clear. The level text of the score in view (hovered or focused, else the chosen one)
 * shows below as help.
 */
export function ScorePicker({ label, value, onChange, levels, disabled }: {
  /** The group's accessible name, e.g. "Customer base". */
  label: string;
  value: Score | null;
  onChange: (score: Score | null) => void;
  /** What each score means, indexed 0 to 3. */
  levels: readonly [string, string, string, string];
  disabled?: boolean;
}) {
  const [preview, setPreview] = useState<Score | null>(null);
  const helpId = useId();
  const shown = preview ?? value;
  return (
    <div role="group" aria-label={label} aria-describedby={helpId}>
      <div className="flex flex-wrap items-center gap-1.5">
        {SCORES.map((score) => (
          <button
            key={score}
            type="button"
            aria-label={`${score}: ${levels[score]}`}
            aria-pressed={value === score}
            disabled={disabled}
            onClick={() => onChange(score)}
            onMouseEnter={() => setPreview(score)}
            onMouseLeave={() => setPreview(null)}
            onFocus={() => setPreview(score)}
            onBlur={() => setPreview(null)}
            className={cn(
              'h-8 w-8 rounded-lg border text-sm font-semibold tabular-nums transition-colors outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50',
              value === score ? 'border-brand-strong bg-brand-strong text-on-brand' : 'border-line bg-surface text-ink-2 hover:bg-surface-2',
            )}
          >
            {score}
          </button>
        ))}
        <button
          type="button"
          disabled={disabled || value === null}
          onClick={() => onChange(null)}
          className="h-8 rounded-lg px-2 text-xs font-medium text-ink-3 outline-none hover:bg-surface-2 hover:text-ink focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-50"
        >
          {COPY.CLEAR}
        </button>
      </div>
      <p id={helpId} className="mt-1.5 text-xs text-ink-3">
        {shown === null ? COPY.NOT_SCORED : `${shown}: ${levels[shown]}`}
      </p>
    </div>
  );
}

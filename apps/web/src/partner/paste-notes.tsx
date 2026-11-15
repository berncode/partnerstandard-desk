'use client';

// The notes are sorted by core's `sortNotes`.
import { sortNotes } from '@partner-desk/core';
import { type Topic } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { Button } from '@/ui/button';
import { pasteRefusal } from './partner-model';

export interface SortedNotes {
  topics: Record<Topic, string>;
  notes: string;
}

type Result = { refused: string } | { sorted: true; foundHeadings: boolean };

const box =
  'w-full min-w-0 rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30';

/**
 * *Paste notes from Granola*: sorts the text under the six topics by their headings and hands it to the call form,
 * whose boxes show it before anything is saved. A section too long for a sheet cell refuses the whole paste: nothing is
 * filled and nothing is cut.
 */
export function PasteNotes({ onSorted }: { onSorted: (sorted: SortedNotes) => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<Result | null>(null);
  const helpId = useId();
  const refusedId = useId();

  const sort = () => {
    if (!text.trim()) return;
    const sorted = sortNotes(text);
    if (sorted.tooLong) return setResult({ refused: pasteRefusal(sorted.tooLong) });
    onSorted({ topics: sorted.topics, notes: sorted.notes });
    setText('');
    setResult({ sorted: true, foundHeadings: sorted.foundHeadings });
  };
  const refused = result && 'refused' in result ? result.refused : null;

  return (
    <div className="grid gap-2 rounded-xl bg-surface-2/60 p-3">
      <label className="grid gap-1 text-xs font-medium text-ink-3">
        {COPY.PASTE_NOTES}
        <textarea rows={4} value={text} className={box} aria-describedby={refused ? `${helpId} ${refusedId}` : helpId}
          aria-invalid={refused ? true : undefined}
          onChange={(e) => { setText(e.target.value); setResult(null); }} />
      </label>
      <p id={helpId} className="text-xs text-ink-3">{COPY.PASTE_HELP}</p>
      <div>
        <Button size="sm" onClick={sort}>{COPY.SORT_INTO_TOPICS}</Button>
      </div>
      {refused && <p id={refusedId} role="alert" className="text-sm text-danger">{refused}</p>}
      {result && 'sorted' in result && (
        <div role="status" className="text-sm text-ink-2">
          <p>{COPY.SORTED}</p>
          {!result.foundHeadings && <p className="mt-0.5 text-warn">{COPY.NO_HEADINGS_HINT}</p>}
        </div>
      )}
    </div>
  );
}

'use client';

// New for PartnerStandard Desk (spec 5.5, MAP spec 5.6): what happens to the business cases and the MAP of a partner type that
// goes away, or of every partner type when a new Partners file starts. The owner chose the two answers (2026-10-30).
import { COPY } from '@partner-desk/copy';
import { useCopy, useStorageKind } from '@/storage-context';
import { Button } from '@/ui/button';

export type CasesFate = 'trash' | 'keep';

/**
 * The question and its two answers, each one the action itself. Either way the share links and the MAP's links stop
 * working. `count` is how many business cases, `maps` how many MAPs. While `busy` nothing can be pressed again.
 */
export function CasesChoice({ count, maps = 0, busy, onChoose, onCancel }: {
  count: number;
  maps?: number;
  busy: boolean;
  onChoose: (fate: CasesFate) => void;
  onCancel: () => void;
}) {
  const files = count + maps;
  const words = useCopy();
  // A company server offers no "keep": a kept file would be where no one sees it (plan 13, task 9's review).
  const keepable = useStorageKind() !== 'database';
  return (
    <div className="mt-4 grid gap-3">
      <p className="text-sm font-medium">{maps > 0 ? COPY.ITEMS_WHAT_HAPPENS(count, maps) : COPY.CASES_WHAT_HAPPENS(count)}</p>
      <div className={keepable ? 'grid gap-2 sm:grid-cols-2' : 'grid gap-2'}>
        <div className="grid content-start gap-1">
          <Button variant="danger" className="h-auto min-h-10 border border-danger/40 py-2 whitespace-normal" disabled={busy} aria-busy={busy || undefined}
            onClick={() => { if (!busy) onChoose('trash'); }}>
            {words.CASES_TRASH(files)}
          </Button>
          <p className="text-xs text-ink-3">{words.CASES_TRASH_HINT(files)}</p>
        </div>
        {keepable && <div className="grid content-start gap-1">
          <Button className="h-auto min-h-10 py-2 whitespace-normal" disabled={busy} aria-busy={busy || undefined}
            onClick={() => { if (!busy) onChoose('keep'); }}>
            {COPY.CASES_KEEP(files)}
          </Button>
          <p className="text-xs text-ink-3">{COPY.CASES_KEEP_HINT(files)}</p>
        </div>}
      </div>
      <p className="text-xs text-ink-3">{maps > 0 ? words.ITEMS_LINKS_OFF(files) : words.CASES_LINKS_OFF(count)}</p>
      <div className="flex justify-end">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>{COPY.CANCEL}</Button>
      </div>
    </div>
  );
}

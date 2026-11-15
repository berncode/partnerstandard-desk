'use client';

// New for PartnerStandard Desk (spec 5.4): the offer tab says when Company facts or the case's program changed after the case
// was filled. The case keeps its numbers until the person updates it.
import type { CaseSourcesRead } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { History } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { formatDate } from '@/partners/partners-model';

export type LoadSources = (input: { caseId: string }) => Promise<RemoteOutcome<CaseSourcesRead>>;

/** The lines of the note, or none when nothing changed since. */
export function sourcesLines(sources: Pick<CaseSourcesRead, 'factsChangedAt' | 'programChangedAt'>): string[] {
  const lines = [
    ...(sources.factsChangedAt ? [COPY.CASE_FACTS_CHANGED(formatDate(sources.factsChangedAt))] : []),
    ...(sources.programChangedAt ? [COPY.CASE_PROGRAM_CHANGED(formatDate(sources.programChangedAt))] : []),
  ];
  return lines.length > 0 ? [...lines, COPY.CASE_CHANGED_KEEPS] : [];
}

/**
 * What changed since the case was filled, read once the tab is on screen (three reads of Google, usually cached). A
 * read that fails leaves the note out: the case opens all the same [controller's ruling].
 */
export function SourcesNote({ caseId, load }: { caseId: string; load: LoadSources }) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let live = true;
    load({ caseId }).then(
      (read) => {
        if (live && read.ok) setLines(sourcesLines(read));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [caseId, load]);
  if (lines.length === 0) return null;
  return (
    <div role="note" className="flex gap-2 rounded-[10px] border border-warn/30 bg-warn-soft px-3 py-2.5 text-sm text-warn">
      <History aria-hidden className="mt-0.5 size-4 shrink-0" />
      <p className="min-w-0 break-words">{lines.join(' ')}</p>
    </div>
  );
}

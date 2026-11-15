'use client';

import { COPY } from '@partner-desk/copy';
import { PROGRAM_TAB, type ProgramList, type RowIssue } from '@partner-desk/storage';
import { TriangleAlert } from 'lucide-react';
import { cn } from '@/ui/cn';

/** A list tab of a program's file, checked against the store's names (`PROGRAM_LISTS`) by type. */
const list = (name: ProgramList): string => name;

/** The tabs of a program's file, by the part of a step their rows belong to (the store names issues by tab). */
export const ISSUE_TABS = {
  program: [PROGRAM_TAB],
  reasons: [list('Reasons')],
  entry: [list('Entry')],
  benefits: [list('Benefits')],
  preferred: [list('Requirements'), list('Performance bar')],
} as const;

/**
 * Rows of the program's sheet the app can't read, shown with the part of the step they belong to (a Reasons row on
 * Why join, a Benefits row with the benefits). Each message names the tab and the row; the app leaves those rows alone.
 * In the look of the market's NeedsAttention.
 */
export function RowIssues({ issues, tabs, className }: { issues: readonly RowIssue[]; tabs: readonly string[]; className?: string }) {
  const mine = issues.filter((issue) => tabs.includes(issue.tab));
  if (mine.length === 0) return null;
  return (
    <div role="note" className={cn('flex items-start gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn', className)}>
      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="font-medium">{COPY.PROG_ISSUES_TITLE}</p>
        <p className="mt-0.5">{COPY.PROG_ISSUES_TEXT}</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {mine.map((issue, i) => <li key={`${issue.tab}-${issue.row}-${i}`} className="break-words">{issue.message}</li>)}
        </ul>
      </div>
    </div>
  );
}

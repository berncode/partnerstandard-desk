// New for PartnerStandard Desk (walkthrough 2026-11-01): a review's commitments, read only, for the present view and the
// partner's summary. A table on wide screens and in print; on a phone each commitment stacks, its side, owner and due
// date under its title with their names, so the due date is never off the right edge. No hooks: it renders on the server.
import { COPY } from '@partner-desk/copy';
import type { ReactNode } from 'react';
import { cn } from '@/ui/cn';

export interface CommitmentLine {
  key: string;
  title: string;
  side: string;
  /** Null leaves the owner out: an empty cell on wide screens, nothing on a phone. */
  owner: ReactNode | null;
  due: ReactNode;
}

const wide = 'sm:table-cell sm:py-2 sm:pr-4 print:table-cell print:py-2 print:pr-4';

export function CommitmentsTable({ lines, className }: { lines: CommitmentLine[]; className?: string }) {
  return (
    <table className={cn('w-full text-left', className)}>
      <thead className="hidden text-xs tracking-wide text-ink-3 uppercase sm:table-header-group print:table-header-group">
        <tr>
          <th className="py-1.5 pr-4 font-medium">{COPY.REVIEW_COMMITMENT}</th>
          <th className="pr-4 font-medium">{COPY.MAP_SIDE}</th>
          <th className="pr-4 font-medium">{COPY.MAP_OWNER}</th>
          <th className="font-medium">{COPY.MAP_DUE}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {lines.map((line) => (
          <tr key={line.key} className="block py-2 align-top sm:table-row sm:py-0 print:table-row print:py-0">
            <td className={cn('block font-medium break-words sm:font-normal print:font-normal', wide)}>{line.title}</td>
            <Cell label={COPY.MAP_SIDE} nowrap>{line.side}</Cell>
            <Cell label={COPY.MAP_OWNER}>{line.owner}</Cell>
            <Cell label={COPY.MAP_DUE} nowrap last>{line.due}</Cell>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One fact of a commitment: with its name before it on a phone, a plain cell on wide screens. Empty: no line on a phone. */
function Cell({ label, nowrap = false, last = false, children }: { label: string; nowrap?: boolean; last?: boolean; children: ReactNode | null }) {
  const empty = children === null || children === '';
  return (
    <td className={cn(
      empty ? 'hidden' : 'block', 'text-ink-2 sm:text-ink print:text-ink', wide, nowrap && 'sm:whitespace-nowrap print:whitespace-nowrap',
      last && 'sm:pr-0 print:pr-0',
    )}>
      {!empty && <span className="text-ink-3 sm:hidden print:hidden">{label}: </span>}
      {children}
    </td>
  );
}

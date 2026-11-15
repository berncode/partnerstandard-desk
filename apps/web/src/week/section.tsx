'use client';

// New for PartnerStandard Desk (reviews spec 4.1): one of This week's four sections. A card with a heading, its lines (at most
// ten, then "Show all") or its one empty line. The lines are the caller's: it gets the limit and draws up to it.
import { COPY } from '@partner-desk/copy';
import { useId, useState, type ReactNode } from 'react';

/** Each section shows this many lines before "Show all" [builder's call, spec 4.1]. */
export const WEEK_LINE_LIMIT = 10;

export function Section({ title, empty, total, children }: {
  title: string;
  /** The one line an empty section shows. */
  empty: string;
  /** How many lines the section has in all. */
  total: number;
  /** Draws the lines, at most `limit` of them. */
  children: (limit: number) => ReactNode;
}) {
  const [all, setAll] = useState(false);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="rounded-xl border border-line bg-surface p-4">
      <h2 id={headingId} className="mb-2 text-[15px] font-semibold tracking-tight">{title}</h2>
      {total === 0 ? (
        <p className="py-2 text-sm text-ink-3">{empty}</p>
      ) : (
        <>
          {children(all ? Infinity : WEEK_LINE_LIMIT)}
          {total > WEEK_LINE_LIMIT && (
            <button type="button" aria-expanded={all} onClick={() => setAll((v) => !v)}
              className="mt-2 rounded text-sm font-medium text-brand-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
              {all ? COPY.WEEK_SHOW_FEWER : COPY.WEEK_SHOW_ALL}
            </button>
          )}
        </>
      )}
    </section>
  );
}

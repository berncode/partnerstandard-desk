'use client';

// The words come from COPY. PartnerStandard Desk keeps its programs in Google Sheets only.
import { useEffect, useEffectEvent, type ReactNode } from 'react';
import { cn } from '@/ui/cn';
import { useProgramEditor } from './program-editor';
import { programCrumb } from './title';
import { useOutputRefresh } from './use-output-refresh';
import { useCopy } from '@/storage-context';

/** The Program Sheet and the public page are this wide, and their buttons line up with them. */
export const OUTPUT_WIDTH = 'mx-auto w-full max-w-[880px]';

/**
 * The paper the Program Sheet and the public page are set on. In print it is the page itself: no frame or shadow,
 * colors kept.
 */
export const PAPER = cn(
  OUTPUT_WIDTH,
  'min-w-0 rounded-[14px] border border-line bg-surface p-[22px] text-sm leading-[1.45] break-words shadow-[0_8px_30px_rgba(18,22,20,.06)]',
  'min-[701px]:px-10 min-[701px]:py-9',
  '[-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:max-w-none print:rounded-none print:border-0 print:p-0 print:text-[13px] print:shadow-none',
);

/**
 * A screen that shows one of the program's outputs (Program Sheet, Public page): the crumb and title, a row with a
 * hint and the buttons, and the output. Opening it saves what isn't saved yet and rewrites the stored copy at once
 * (PD spec §5); when that rewrite fails the screen says so, and it is tried again with the next one. Only the output
 * prints.
 */
export function OutputScreen({ title, hint, actions, problem, children }: {
  title: string;
  hint?: string;
  actions: ReactNode;
  /** Why the last button press didn't work. */
  problem?: string | null;
  children: ReactNode;
}) {
  const words = useCopy();
  const { program: p, saveNow, others } = useProgramEditor();
  const outputs = useOutputRefresh();
  const crumb = programCrumb(p, others);

  const rewrite = useEffectEvent(async () => {
    await saveNow();
    await outputs.open([p.id]);
  });
  // Again when Next shows a kept page (Activity): every opening of the screen counts.
  useEffect(() => {
    void rewrite();
  }, [p.id]);

  const failed = outputs.failed.includes(p.id);
  return (
    <div className="min-w-0">
      <div className="mb-4 print:hidden">
        <p className="truncate text-sm text-ink-3" title={crumb}>{crumb}</p>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      </div>
      <div className={cn(OUTPUT_WIDTH, 'mb-3.5 flex flex-wrap items-center justify-end gap-2 print:hidden')}>
        {hint && <p className="mr-auto min-w-0 flex-[1_1_280px] text-sm text-ink-3">{hint}</p>}
        {actions}
      </div>
      {(failed || problem) && (
        <div role="alert" className={cn(OUTPUT_WIDTH, 'mb-3.5 grid gap-2 print:hidden')}>
          {problem && <p className="rounded-[10px] bg-danger-soft px-3 py-2.5 text-[13.5px] font-medium text-danger">{problem}</p>}
          {failed && <p className="rounded-[10px] bg-warn-soft px-3 py-2.5 text-[13.5px] font-medium text-warn">{words.PROG_REWRITE_FAILED}</p>}
        </div>
      )}
      {children}
    </div>
  );
}

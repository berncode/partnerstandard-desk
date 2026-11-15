'use client';

// The words come from COPY. Open in Google Sheets links to the program's file (PartnerStandard Desk keeps programs in
// Google Sheets only); a test user's files live in memory, so there is nothing to open.
import { NOT_SET, programSheet, type SheetContent } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useId, type MouseEvent, type ReactNode } from 'react';
import { Button, buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { OutputScreen, PAPER } from './output-screen';
import { useProgramEditor } from './program-editor';
import { useOutputRefresh } from './use-output-refresh';
import { downloadFile, FileLinkIcon, useCopy, useFileLinkProps, useStorageKind } from '@/storage-context';

/**
 * The Program Sheet screen (PD spec §4.9): the sheet of the program on screen, Open in Google Sheets and Download PDF,
 * which opens the browser's print dialog, where the sheet prints alone (A4 or Letter) or saves as a PDF.
 */
export function ProgramSheetScreen() {
  const words = useCopy();
  const fileLink = useFileLinkProps();
  const { program, facts, companyName, fileUrl, saveNow } = useProgramEditor();
  const outputs = useOutputRefresh();
  const downloads = useStorageKind() === 'database';
  // Google: the link opens the sheet at once; what isn't saved yet is saved and the sheet's tabs rewritten as it loads.
  // A database file is downloaded only after both, so the file has the last edit and the new Program Sheet tab
  // (task 12's review).
  const openStored = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!downloads) {
      void saveNow().then(() => outputs.flush([program.id]));
      return;
    }
    event.preventDefault();
    const url = event.currentTarget.href;
    void saveNow().then(() => outputs.flush([program.id])).finally(() => downloadFile(url));
  };
  return (
    <OutputScreen
      title={COPY.PROG_SHEET_TITLE}
      hint={fileUrl ? words.PROG_SHEET_STORED : undefined}
      actions={(
        <>
          {fileUrl && (
            <a href={fileUrl} {...fileLink} onClick={openStored} className={buttonVariants()}>
              {words.OPEN_IN_SHEETS}
              <FileLinkIcon />
            </a>
          )}
          <Button variant="primary" onClick={() => window.print()}>{COPY.PROG_DOWNLOAD_PDF}</Button>
        </>
      )}>
      <ProgramSheet sheet={programSheet(facts, program, companyName.trim() || COPY.COMPANY_UNNAMED)} />
    </OutputScreen>
  );
}

const PART = 'mt-6 mb-2 print:mt-4 print:mb-1.5 text-[13px] font-semibold tracking-[.05em] text-ink-3 uppercase break-after-avoid';
const TEXT = 'mb-1.5 text-ink-2';
/** Two parts side by side; one under the other on a phone. Paper is wide enough for two. */
const TWO = 'grid grid-cols-1 min-[701px]:grid-cols-2 min-[701px]:gap-7 print:grid-cols-2 print:gap-7';
/** The levels table's first column. */
const FIRST = 'w-[34%] pl-0 min-[701px]:w-[26%] print:w-[26%]';

/** One part of the sheet, headed in small capitals. */
function Part({ title, id, avoidBreak = true, children }: { title: string; id?: string; avoidBreak?: boolean; children: ReactNode }) {
  return (
    <section className={cn('min-w-0', avoidBreak && 'break-inside-avoid')}>
      <h3 id={id} className={PART}>{title}</h3>
      {children}
    </section>
  );
}

/** A list of the sheet; an empty one says "Not set yet." in a line of its own, as Program Designer's. */
function List({ items, className }: { items: string[]; className?: string }) {
  if (items.length === 1 && items[0] === NOT_SET) return <p className={TEXT}>{NOT_SET}</p>;
  return (
    <ul className={cn('mt-1 mb-2 list-disc space-y-[3px] pl-[18px] text-ink-2', className)}>
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  );
}

/**
 * The Partner Program Sheet , set out from `programSheet` as it is: the same content goes to
 * the PDF and the Google tab.
 */
export function ProgramSheet({ sheet: s }: { sheet: SheetContent }) {
  const id = useId();
  const levels = `${id}-levels`;
  return (
    <article aria-labelledby={`${id}-name`} className={PAPER}>
      <p className="text-xs font-semibold tracking-[.06em] text-brand-strong uppercase">{s.eyebrow}</p>
      <h2 id={`${id}-name`} className="mt-1 mb-1.5 text-[26px] leading-tight font-semibold tracking-tight">{s.name}</h2>
      {s.description && <p className={TEXT}>{s.description}</p>}
      <dl className="mt-4 print:mt-3 grid grid-cols-1 gap-3 break-inside-avoid min-[701px]:grid-cols-[repeat(auto-fit,minmax(140px,1fr))] print:grid-cols-[repeat(auto-fit,minmax(140px,1fr))]">
        {s.facts.map((f) => (
          <div key={f.label} className="min-w-0 rounded-lg bg-surface-2 px-2.5 py-2">
            <dt className="text-[11.5px] text-ink-3">{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>

      <Part title={COPY.PROG_SHEET_WHY}><List items={s.why} /></Part>
      <Part title={COPY.PROG_SHEET_GOALS}><p className={TEXT}>{s.goals}</p></Part>
      <div className={TWO}>
        <Part title={COPY.PROG_IPP}><p className={TEXT}>{s.ipp}</p></Part>
        <Part title={COPY.PROG_ICP}><p className={TEXT}>{s.icp}</p></Part>
      </div>

      <Part title={COPY.PROG_SHEET_LEVELS} id={levels} avoidBreak={false}>
        <table aria-labelledby={levels} className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="break-inside-avoid">
              {s.levels.columns.map((c, i) => (
                <th key={i} scope="col" className={cn('border-b border-line px-2.5 py-2 print:py-1.5 text-left align-top text-xs font-semibold text-ink-3', i === 0 && FIRST)}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {s.levels.rows.map((row) => (
              <tr key={row.label} className="break-inside-avoid">
                <th scope="row" className={cn('border-b border-line px-2.5 py-2 print:py-1.5 text-left align-top font-normal text-ink-2', FIRST)}>{row.label}</th>
                {row.cells.map((cell, i) => (
                  <td key={i} className="min-w-0 border-b border-line px-2.5 py-2 text-left align-top print:py-1.5">
                    {typeof cell === 'string' ? cell : <List items={cell} className="my-0" />}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Part>

      <Part title={COPY.PROG_STEP_MONEY}>{s.money.map((line) => <p key={line} className={TEXT}>{line}</p>)}</Part>
      <Part title={COPY.PROG_SHEET_RULES}><List items={s.rules} /></Part>
      <div className={TWO}>
        <Part title={COPY.PROG_SHEET_KPIS}><p className={TEXT}>{s.kpis}</p></Part>
        <Part title={COPY.PROG_ENABLEMENT}><p className={TEXT}>{s.enablement}</p></Part>
      </div>
      <Part title={COPY.PROG_TOOLS}><p className={TEXT}>{s.tools}</p></Part>
      {s.rollout !== null && <Part title={COPY.PROG_SHEET_ROLLOUT}><p className={TEXT}>{s.rollout}</p></Part>}

      <footer className="mt-6 print:mt-4 flex flex-wrap justify-between gap-3 border-t border-line pt-3 text-xs text-ink-3 break-inside-avoid">
        <span>{s.footer[0]}</span>
        <span>{s.footer[1]}</span>
      </footer>
    </article>
  );
}

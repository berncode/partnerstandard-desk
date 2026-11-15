'use client';

// The words come from COPY.
import { publicBlocks, publicPlain, type PublicBlock } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { useId, useState } from 'react';
import { CopyButton } from '@/ui/copy-button';
import { OutputScreen, PAPER } from './output-screen';
import { useProgramEditor } from './program-editor';

/**
 * The Public page screen (PD spec §4.10): a first draft of the program's page for partners, from the answers, and
 * Copy text (plain text with `#` headings and `-` lists).
 */
export function PublicPageScreen() {
  const { program, facts } = useProgramEditor();
  const blocks = publicBlocks(facts, program);
  const [blocked, setBlocked] = useState(false);
  return (
    <OutputScreen
      title={COPY.PROG_PUBLIC_TITLE}
      hint={COPY.PROG_PUBLIC_HINT}
      problem={blocked ? COPY.PROG_COPY_BLOCKED : null}
      actions={<CopyButton variant="primary" text={publicPlain(blocks)} onCopyFailed={() => setBlocked(true)}>{COPY.PROG_COPY_TEXT}</CopyButton>}>
      <PublicText blocks={blocks} />
    </OutputScreen>
  );
}

/** The public page's text, set out from `publicBlocks` as it is. */
export function PublicText({ blocks }: { blocks: PublicBlock[] }) {
  const id = useId();
  const title = blocks.find((b): b is { h1: string } => 'h1' in b);
  return (
    <article aria-labelledby={title ? `${id}-title` : undefined} className={PAPER}>
      {blocks.map((b, i) => {
        if ('h1' in b) return <h2 key={i} id={`${id}-title`} className="mb-1.5 text-[28px] leading-tight font-semibold tracking-tight">{b.h1}</h2>;
        if ('h2' in b) return <h3 key={i} className="mt-[22px] mb-1.5 text-[17px] font-semibold tracking-[-.01em] break-after-avoid">{b.h2}</h3>;
        if ('ul' in b) {
          return (
            <ul key={i} className="mt-1 mb-2 list-disc space-y-[3px] pl-[18px] text-ink-2">
              {b.ul.map((item, j) => <li key={j}>{item}</li>)}
            </ul>
          );
        }
        return <p key={i} className="mb-1.5 text-ink-2">{b.p}</p>;
      })}
    </article>
  );
}

'use client';

// New for PartnerStandard Desk (spec 5.1): a case's header names the partner and type ("Acme as reseller"), links back to the
// partner page, and shows the case's title, which can be renamed (Recruitment's inline text, src/ui/inline-text.tsx).
import { parseCase } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { InlineText, type CommitOutcome } from '@/ui/inline-text';
import { useCaseEditor } from './case-editor';
import { FileLinkIcon, useCopy, useFileLinkProps, useViewer } from '@/storage-context';

/**
 * `heading` is "Acme as reseller", as Partners names the partner now; `back` the way back to it (or to the Business
 * cases page when its partner type is gone). `typeGone`: the partner type is no longer in Partners (Review Focus 2).
 * `fileUrl`: the case's spreadsheet, for Open in Google Sheets; null for a test account (its files live in memory).
 */
export function CaseHeader({ heading, back, typeGone, fileUrl }: {
  heading: string; back: { href: string; label: string }; typeGone: boolean; fileUrl: string | null;
}) {
  const words = useCopy();
  const fileLink = useFileLinkProps();
  const { case: c, latest, update } = useCaseEditor();
  // A company server's viewer reads the title as text, with no way to rename it (owner, 2026-11-14).
  const viewer = useViewer();
  /** A new title goes into the case, saved as every change is; one the case can't hold says why. */
  const rename = (title: string): CommitOutcome => {
    const next = { ...latest(), title: title.trim() };
    const issue = (() => {
      const parsed = parseCase(next);
      return parsed.ok ? undefined : parsed.issues.find((i) => i.path === 'title');
    })();
    if (issue) return { ok: false, message: issue.message, fieldErrors: { title: issue.message } };
    update(next);
    return { ok: true };
  };
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <Link href={back.href} className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {back.label}
        </Link>
        {fileUrl && (
          <a href={fileUrl} {...fileLink}
            className="inline-flex items-center gap-1 rounded text-sm font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand">
            {words.OPEN_IN_SHEETS}
            <FileLinkIcon />
          </a>
        )}
      </div>
      <header className="grid min-w-0 gap-1">
        <h1 className="text-xl font-semibold tracking-tight break-words">{heading}</h1>
        <div className="max-w-md text-sm text-ink-2">
          <InlineText value={c.title} label={COPY.CASE_TITLE_LABEL} field="title" onCommit={rename} disabled={viewer} />
        </div>
        {typeGone && <p className="text-sm text-warn">{COPY.CASE_TYPE_GONE}</p>}
      </header>
    </div>
  );
}

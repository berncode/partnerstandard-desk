'use client';

// New for PartnerStandard Desk: around every tab of one case, as ProgramHost is around a program's steps
// (src/programs/program-host.tsx). One editor for the whole case, the header, the tabs and what the autosave does.
import type { BusinessCase } from '@partner-desk/core';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { caseSave } from '@/app/(signed-in)/actions/cases';
import type { ProgramOption } from '@/programs/title';
import { ViewerLine } from '@/viewer-read-only';
import { CaseEditor, CaseSaveStatus, useCaseEditor } from './case-editor';
import { CaseHeader } from './case-header';
import { CaseNav, caseTabOf } from './case-nav';
import { CasePageProvider } from './case-page';

export function CaseHost({ initial, heading, back, programs, typeGone, shared, fileUrl, children }: {
  initial: BusinessCase;
  heading: string;
  back: { href: string; label: string };
  programs: readonly ProgramOption[];
  typeGone: boolean;
  /** The share link that works now, as the page read it. */
  shared: { createdAt: string } | null;
  /** The case's spreadsheet, for Open in Google Sheets; null for a test account (its files live in memory). */
  fileUrl: string | null;
  children: ReactNode;
}) {
  return (
    <CasePageProvider programs={programs} typeGone={typeGone} shared={shared}>
      <CaseEditor initial={initial} save={caseSave}>
        <div className="grid grid-cols-1 gap-4 print:block">
          {/* On paper only a one-pager (the Share tab) prints. */}
          <div className="grid grid-cols-1 gap-4 print:hidden">
            <CaseHeader heading={heading} back={back} typeGone={typeGone} fileUrl={fileUrl} />
            <ViewerLine />
            <CaseTabs />
          </div>
          <div className="min-w-0">{children}</div>
        </div>
      </CaseEditor>
    </CasePageProvider>
  );
}

/** The tabs, named with the case's partner, and the save status beside them. */
function CaseTabs() {
  const pathname = usePathname();
  const { case: c } = useCaseEditor();
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
      <CaseNav id={c.id} partner={c.partner.trim() || 'the partner'} current={caseTabOf(pathname, c.id)} />
      <CaseSaveStatus />
    </div>
  );
}

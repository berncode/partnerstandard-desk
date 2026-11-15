'use client';

import type { CompanyFacts, Program } from '@partner-desk/core';
import type { RowIssue } from '@partner-desk/storage';
import type { ReactNode } from 'react';
import { ViewerLine } from '@/viewer-read-only';
import { programDelete, programSave } from '@/app/(signed-in)/actions/programs';
import { ProgramEditor } from './program-editor';
import { ProgramTabs } from './program-tabs';
import { OutputRefreshProvider } from './use-output-refresh';

/**
 * Around every screen of one program: its output rewrites, its editor (saving through the server actions), its
 * partners and markets, and the tab row of its screens above the screen.
 */
export function ProgramHost({ children, members, ...props }: {
  initial: Program; facts: CompanyFacts; companyName: string; fileUrl: string | null; issues: RowIssue[];
  others: { programId: string; label: string }[];
  /** The program's partners and markets, above the tabs (read on the server, in its own Suspense). */
  members: ReactNode;
  children: ReactNode;
}) {
  return (
    <OutputRefreshProvider>
      <ProgramEditor {...props} save={programSave} remove={programDelete}>
        <div className="grid grid-cols-1 gap-5">
          {members}
          <ViewerLine />
          <ProgramTabs />
          <div className="min-w-0">{children}</div>
        </div>
      </ProgramEditor>
    </OutputRefreshProvider>
  );
}

'use client';

// New for PartnerStandard Desk: what a case's page knows besides the case, for every tab (CaseHost provides it).
import { createContext, useContext, useState, type ReactNode } from 'react';
import type { ProgramOption } from '@/programs/title';

export interface CasePage {
  /** The programs of the partner type's type, for Update's pick. */
  programs: readonly ProgramOption[];
  /** The partner type is no longer in Partners: Update is off (Review Focus 2). */
  typeGone: boolean;
  /** When the share link that works now was made, or null: the case isn't shared. */
  sharedAt: string | null;
  /** After the Share tab made a link (now) or turned it off (null). Kept while the tabs change. */
  setSharedAt: (at: string | null) => void;
}

const PageContext = createContext<CasePage | null>(null);

/** What the case's page knows besides the case. Only inside CaseHost (CasePageProvider). */
export function useCasePage(): CasePage {
  const page = useContext(PageContext);
  if (!page) throw new Error('useCasePage needs CaseHost around the tab');
  return page;
}

/** Holds what the page read besides the case, and whether it is shared, while the tabs change. */
export function CasePageProvider({ programs, typeGone, shared, children }: {
  programs: readonly ProgramOption[];
  typeGone: boolean;
  /** The share link that works now, as the page read it. */
  shared: { createdAt: string } | null;
  children: ReactNode;
}) {
  const [sharedAt, setSharedAt] = useState(shared?.createdAt ?? null);
  return <PageContext value={{ programs, typeGone, sharedAt, setSharedAt }}>{children}</PageContext>;
}

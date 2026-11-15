// Test helpers for the program screens: a program on screen inside its editor and output scheduler, with the
// server actions as mocks. Not part of the app.
import { brightpage, northwind, type ExampleCompany } from '@partner-desk/core/test-builders';
import type { CompanyFacts, Program } from '@partner-desk/core';
import type { RowIssue } from '@partner-desk/storage';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { StorageProvider } from '@/storage-context';
import { ProgramEditor, type RemoveProgram, type SaveProgram } from './program-editor';
import { ProgramTabs } from './program-tabs';
import { OutputRefreshProvider } from './use-output-refresh';

export const STAMP = '2026-10-26T10:00:00.000Z';
export const LATER = '2026-10-26T10:05:00.000Z';

/** Northwind's facts, without the name (it lives in Settings) and the programs. */
export function factsOf(example: ExampleCompany = northwind()): CompanyFacts {
  const facts: Partial<typeof example> = { ...example, updatedAt: STAMP };
  delete facts.name;
  delete facts.programs;
  return facts as CompanyFacts;
}

export const NORTHWIND = factsOf();
export const BRIGHTPAGE = factsOf(brightpage());
/** Northwind's reseller program, with a PartnerStandard Desk id. */
export const RESELLER: Program = { ...northwind().programs[0], id: 'pg_resellerdd', companyId: 'co_aaaaaaaaaa', updatedAt: STAMP };

/** Northwind's consulting program (a solution partner) and Brightpage's referral program. */
export const CONSULTING: Program = { ...northwind().programs[1], updatedAt: STAMP };
export const REFERRAL: Program = { ...brightpage().programs[0], updatedAt: STAMP };

/** The server's answer to a save: the program as sent, stamped. */
export const saved = (updatedAt = LATER) =>
  vi.fn<SaveProgram>(async ({ program }) => ({ ok: true, snapshot: { value: { ...program, updatedAt }, issues: [] }, entityId: null }));

export interface Shown {
  program?: Program;
  facts?: CompanyFacts;
  issues?: RowIssue[];
  fileUrl?: string | null;
  save?: ReturnType<typeof saved>;
  remove?: ReturnType<typeof vi.fn<RemoveProgram>>;
  /** The company's other programs, as the directory lists them. */
  others?: { programId: string; label: string }[];
  /** A company server's viewer is signed in. */
  viewer?: boolean;
}

/** `screen` inside the program's editor and its tab row, as the program's layout puts it. */
export function showProgram(screen: ReactNode, opts: Shown = {}) {
  const save = opts.save ?? saved();
  const remove = opts.remove ?? vi.fn<RemoveProgram>(async ({ programId }) => ({ ok: true, programId }));
  const program = opts.program ?? RESELLER;
  const editor = (node: ReactNode) => (
    <OutputRefreshProvider>
      <ProgramEditor initial={program} facts={opts.facts ?? NORTHWIND} companyName="Northwind Security"
        fileUrl={opts.fileUrl ?? null} issues={opts.issues ?? []} others={opts.others ?? []} save={save} remove={remove}>
        <ProgramTabs />
        {node}
      </ProgramEditor>
    </OutputRefreshProvider>
  );
  const tree = (node: ReactNode) => (opts.viewer ? <StorageProvider storage="database" viewer>{editor(node)}</StorageProvider> : editor(node));
  const view = render(tree(screen));
  return { ...view, save, remove, user: userEvent.setup(), go: (next: ReactNode) => view.rerender(tree(next)) };
}

/** POST /api/programs/outputs, answered: every rewrite done. */
export function stubOutputs() {
  // The arguments are typed for `rewritten`, which reads the body sent.
  const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(async () => Response.json({ failed: [], refused: [] }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/** The program ids each rewrite call sent. */
export const rewritten = (fetchMock: ReturnType<typeof stubOutputs>): string[][] =>
  fetchMock.mock.calls.map(([, init]) => (JSON.parse(String(init.body)) as { programIds: string[] }).programIds);

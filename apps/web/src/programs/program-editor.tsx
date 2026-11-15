'use client';

// PartnerStandard Desk sends the program as read (`base`) with every save, as Company facts does; the company's facts,
// name and the file's link come from the page; the sheet's unreadable rows (`issues`) come along.
import { keepHiddenSaved, parseProgram, type CompanyFacts, type Program } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { RowIssue } from '@partner-desk/storage';
import { useRouter } from 'next/navigation';
import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RemoteOutcome, RemoteResult } from '@/editor/remote';
import { useViewer } from '@/storage-context';
import type { ListedProgram } from './title';
import { useAutosave, type SaveOutcome, type SaveStatus } from './use-autosave';
import { useOutputRefresh } from './use-output-refresh';

/** What is wrong with the program on screen, by field path (`name`, `prefReq.certified.people`, …). */
export type FieldErrors = Record<string, string | undefined>;

/** What a save sends: the program on screen, the program as last read or saved, and its Updated. */
export interface ProgramSave {
  programId: string;
  program: Program;
  base: Program;
  expectedUpdatedAt: string | null;
}

export type SaveProgram = (input: ProgramSave) => Promise<RemoteResult<Program>>;
export type RemoveProgram = (input: { programId: string }) => Promise<RemoteOutcome<{ programId: string }>>;

export interface ProgramEditorState {
  /** The program as it is on screen. */
  program: Program;
  /** The company's facts as read (Company facts), for the checks, the money lines and the outputs. */
  facts: CompanyFacts;
  /** The company's name, from Settings: the Program Sheet's footer. */
  companyName: string;
  /** The program's spreadsheet, for Open in Google Sheets; null for a test user (files in memory). */
  fileUrl: string | null;
  /** Rows of the program's sheet that couldn't be read: the app leaves them alone. */
  issues: RowIssue[];
  /** The company's other programs as the directory lists them: a twin label adds the name (`programTitle`). */
  others: readonly Pick<ListedProgram, 'programId' | 'label'>[];
  errors: FieldErrors;
  status: SaveStatus;
  /** Puts `next` on screen and saves it 800 ms after the last change. */
  change: (next: Program) => void;
  /** The program as it is now, also inside a handler that runs before the next render. */
  latest: () => Program;
  /** Try again after a failed save. */
  retry: () => void;
  /** Saves what isn't saved yet now; resolves once it is, or with why it isn't. */
  saveNow: () => Promise<SaveOutcome>;
  /** Reload after saving stopped: the file's latest version replaces the screen. */
  reload: () => void;
  /** Deletes the program. After it succeeds nothing more is saved or rewritten for it. */
  remove: () => Promise<RemoteOutcome<{ programId: string }>>;
}

const EditorContext = createContext<ProgramEditorState | null>(null);

/** The program on screen and how to change it. Only inside ProgramEditor. */
export function useProgramEditor(): ProgramEditorState {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('useProgramEditor needs ProgramEditor around the step');
  return editor;
}

/**
 * Refusals saving again can't get past: the file changed since it was read (in the app or by hand in the sheet), the
 * sign-in or the file is gone, or no access. Saving stops and Reload brings the latest (or the page's problem screen).
 */
const STOPS = new Set(['conflict', 'auth', 'file_not_found', 'forbidden']);

/**
 * One program being edited, around all its steps (the program's layout keeps it while the steps change, so there
 * is one save at a time for the whole program). Every change is checked here first (a mistake in an answer the
 * screen no longer shows, such as a removed level's rate, is sent as last saved instead) and saved 800 ms after the
 * last one, with the program as last read or saved (`base`) and its Updated, so a program changed somewhere else
 * (another screen, or a hand edit in the sheet) is never overwritten: saving stops and Reload shows the latest. Each
 * saved change queues the rewrite of its Program Sheet and Public page tabs (30 seconds later); opening the program
 * rewrites them at once, so a Company facts change shows there too [builder's call].
 */
export function ProgramEditor({ initial, facts, companyName, fileUrl, issues: initialIssues, others = [], save, remove, children }: {
  initial: Program;
  facts: CompanyFacts;
  companyName: string;
  fileUrl: string | null;
  issues: RowIssue[];
  others?: readonly Pick<ListedProgram, 'programId' | 'label'>[];
  save: SaveProgram;
  remove: RemoveProgram;
  children: ReactNode;
}) {
  const router = useRouter();
  const outputs = useOutputRefresh();
  const programId = initial.id;
  /** The program as the file holds it: what the next save goes over. */
  const base = useRef(initial);
  /** The program as last saved: a mistake in an answer the screen no longer shows is sent as this instead. */
  const saved = useRef<Program>(initial);
  /** Set once the program is deleted: a save still returning then queues nothing. */
  const deleted = useRef(false);
  const [issues, setIssues] = useState(initialIssues);
  // A company server's viewer reads the program and changes nothing (owner, 2026-11-14): nothing they do is saved.
  const viewer = useViewer();

  const autosave = useAutosave<Program, RemoteResult<Program>>({
    initial,
    readOnly: viewer,
    prepare: (sent) => {
      const parsed = parseProgram(keepHiddenSaved(sent, saved.current, facts));
      return parsed.ok ? { ok: true, value: parsed.program } : { ok: false, message: parsed.issues[0]!.message };
    },
    save: async (program) => {
      const result = await save({ programId, program, base: base.current, expectedUpdatedAt: base.current.updatedAt || null });
      if (result.ok) {
        base.current = result.snapshot.value;
        saved.current = result.snapshot.value;
        return result;
      }
      return result.error === 'conflict' ? { ...result, message: COPY.CHANGED_SOMEWHERE_ELSE } : result;
    },
    onSaved: (result) => {
      if (!result.ok || deleted.current) return;
      setIssues(result.snapshot.issues);
      outputs.queue([programId]);
    },
    stops: (result) => !result.ok && STOPS.has(result.error),
  });
  const { value, status, update, latest, flush } = autosave;

  // Opening the program rewrites its outputs, so facts changed since show in the sheet. Again when Next shows a kept
  // page (Activity): every opening counts.
  const rewriteOnOpen = useEffectEvent(() => void outputs.open([programId]));
  useEffect(() => {
    rewriteOnOpen();
  }, [programId]);

  const errors = useMemo(() => {
    const parsed = parseProgram(value);
    return parsed.ok ? {} : Object.fromEntries(parsed.issues.map((i) => [i.path, i.message]));
  }, [value]) as FieldErrors;

  const removeProgram = async () => {
    const result = await remove({ programId });
    if (result.ok) {
      deleted.current = true;
      outputs.forget([programId]);
    }
    return result;
  };

  // A new value on every render: the editor renders on every change anyway, and so do the steps.
  const state: ProgramEditorState = {
    program: value,
    facts,
    companyName,
    fileUrl,
    issues,
    others,
    errors,
    status,
    change: update,
    latest,
    retry: () => void flush(),
    saveNow: flush,
    reload: () => router.refresh(),
    remove: removeProgram,
  };

  return <EditorContext value={state}>{children}</EditorContext>;
}

// Whole-record saves, as Program Designer saves a company or a program: the same rules in every adapter.
import {
  parseCase, parseCompanyFacts, parseProgram, type BusinessCase, type ChangeStamp, type CompanyFacts, type Program,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { stampAfter } from './sheet-codec/program-records';
import type { CaseChange, CompanyFactsChange, ProgramChange } from './types';

/** A problem with a record: where (`path`) and what, for people. */
type Issue = { path: string; message: string };

export type Refusal = { ok: false; error: 'invalid' | 'conflict'; message: string; fieldErrors?: Record<string, string> };

/** A refused save: the first problem as the message, every problem by its path. */
export function invalid(issues: Issue[]): Refusal {
  return {
    ok: false, error: 'invalid', message: issues[0]?.message ?? COPY.FIX_FIELDS,
    fieldErrors: Object.fromEntries(issues.map((issue) => [issue.path, issue.message])),
  };
}

/** What a whole-record save needs to know about its record. */
export interface SaveSpec<T extends { id: string; updatedAt: string }, C> {
  valueOf(change: C): T;
  /** The record as the screen read it. */
  baseOf(change: C): T;
  expectedOf(change: C): string | null;
  /** What the file decides, whatever the change says (a program's company). */
  keep?(value: T, stored: T): T;
  parse(value: unknown): { ok: true; value: T } | { ok: false; issues: Issue[] };
}

/**
 * The same plain value: arrays in order, objects by their keys (a key holding undefined counts as left out), anything
 * else by ===. Screens send values as JSON, so this is all a value can hold.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => sameValue(item, b[i]));
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const keys = (o: object) => Object.keys(o).filter((key) => (o as Record<string, unknown>)[key] !== undefined).sort();
  const [ka, kb] = [keys(a), keys(b)];
  return ka.length === kb.length && ka.every((key, i) => key === kb[i] && sameValue((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]));
}

/**
 * The record a save makes, or why it is refused: a stale `expectedUpdatedAt` (null expects Updated empty), a file that
 * no longer holds the record the screen read (`base`: a hand edit in the sheet, which leaves Updated alone), another
 * record's id, or a record that isn't valid. Its Updated is the change's time, strictly after the stored one. `stored`
 * is the record as just read from the file, its unreadable rows left out, as the screen got it.
 */
export function planSave<T extends { id: string; updatedAt: string }, C>(spec: SaveSpec<T, C>, stored: T, change: C, stamp: ChangeStamp): { ok: true; value: T } | Refusal {
  if ((spec.expectedOf(change) ?? '') !== stored.updatedAt) return { ok: false, error: 'conflict', message: COPY.CONFLICT };
  if (!sameValue(stored, spec.baseOf(change))) return { ok: false, error: 'conflict', message: COPY.SHEET_CHANGED_MESSAGE };
  const sent = spec.valueOf(change);
  if (sent.id !== stored.id) return { ok: false, error: 'invalid', message: COPY.OTHER_FILE };
  const value = spec.keep ? spec.keep(sent, stored) : sent;
  const parsed = spec.parse({ ...value, updatedAt: stampAfter(stamp.now, [stored.updatedAt]) });
  return parsed.ok ? parsed : invalid(parsed.issues);
}

/** A batch of whole-record saves: none reads the file back, one is a save, more is refused. */
export function oneSave<C>(changes: C[]): { ok: true; change: C | null } | Refusal {
  if (changes.length > 1) return { ok: false, error: 'invalid', message: COPY.ONE_SAVE_AT_A_TIME };
  return { ok: true, change: changes[0] ?? null };
}

export const PROGRAM_SAVE: SaveSpec<Program, ProgramChange> = {
  valueOf: (change) => change.program,
  baseOf: (change) => change.base,
  // A program stays with the company its file belongs to (`_meta`).
  keep: (value, stored) => ({ ...value, companyId: stored.companyId }),
  expectedOf: (change) => change.expectedUpdatedAt,
  parse: (value) => {
    const parsed = parseProgram(value);
    return parsed.ok ? { ok: true, value: parsed.program } : parsed;
  },
};

export const COMPANY_FACTS_SAVE: SaveSpec<CompanyFacts, CompanyFactsChange> = {
  valueOf: (change) => change.facts,
  baseOf: (change) => change.base,
  expectedOf: (change) => change.expectedUpdatedAt,
  parse: (value) => {
    const parsed = parseCompanyFacts(value);
    return parsed.ok ? { ok: true, value: parsed.company } : parsed;
  },
};


export const CASE_SAVE: SaveSpec<BusinessCase, CaseChange> = {
  valueOf: (change) => change.case,
  baseOf: (change) => change.base,
  // A case stays with the company its file belongs to (`_meta`).
  keep: (value, stored) => ({ ...value, companyId: stored.companyId }),
  expectedOf: (change) => change.expectedUpdatedAt,
  parse: (value) => {
    const parsed = parseCase(value);
    return parsed.ok ? { ok: true, value: parsed.case } : parsed;
  },
};

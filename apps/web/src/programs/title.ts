// Program Designer's rule for telling programs apart: a program is named by its label ("Reseller · DACH"), plus its
// name when another program of the company has the same label. Pure: no React, no I/O.
import { programLabel, type Program, type ProgramType } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';

/** A program as the directory lists it: its id, its label and its partner type. */
export interface ListedProgram {
  programId: string;
  /** "Reseller · DACH". */
  label: string;
  partnerType: ProgramType;
}

/** A listed program with the name it is shown by: its label, or "label · name" when another has the same label. */
export interface ProgramOption extends ListedProgram {
  title: string;
}

/** Whether another program of the list has `label`. */
export const hasTwin = (programId: string, label: string, listed: readonly Pick<ListedProgram, 'programId' | 'label'>[]): boolean =>
  listed.some((other) => other.programId !== programId && other.label === label);

/** The programs whose label another program has too: only their names are needed (one read each). */
export const twinIds = (listed: readonly Pick<ListedProgram, 'programId' | 'label'>[]): string[] =>
  listed.filter((p) => hasTwin(p.programId, p.label, listed)).map((p) => p.programId);

const named = (label: string, name: string | undefined) => `${label} · ${name?.trim() || COPY.PROG_UNTITLED}`;

/**
 * Each listed program with its title. `names` holds the names read for the twins; a twin whose name couldn't be
 * read is shown by its label alone.
 */
export function withTitles(listed: readonly ListedProgram[], names: ReadonlyMap<string, string>): ProgramOption[] {
  return listed.map((p) => {
    const name = names.get(p.programId);
    return { ...p, title: hasTwin(p.programId, p.label, listed) && name !== undefined ? named(p.label, name) : p.label };
  });
}

/** How the Programs page and the crumb name the program on screen: its live label, plus its name when another has that label. */
export function programTitle(p: Pick<Program, 'id' | 'type' | 'focus' | 'name'>, others: readonly Pick<ListedProgram, 'programId' | 'label'>[]): string {
  const label = programLabel({ type: p.type, focus: p.focus.trim() });
  return hasTwin(p.id, label, others) ? named(label, p.name) : label;
}

/**
 * The crumb's name of a program: "Reseller · DACH program", or with a twin "Reseller · Northwind Security Reseller
 * Program (copy)" (a title with the name in it ends in "Program" already).
 */
export function programCrumb(p: Pick<Program, 'id' | 'type' | 'focus' | 'name'>, others: readonly Pick<ListedProgram, 'programId' | 'label'>[]): string {
  const title = programTitle(p, others);
  return title === programLabel({ type: p.type, focus: p.focus.trim() }) ? COPY.PROG_CRUMB(title) : title;
}

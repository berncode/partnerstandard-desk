// The steps, their addresses and names. A program's pages live under /programs/{id}.
import { levelNames } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';

/** The five steps of a program, in order. */
export type Step = 'why' | 'basics' | 'registered' | 'preferred' | 'money';
/** A screen of a program: a step, the Program Sheet or the Public page. */
export type Screen = Step | 'sheet' | 'public';

export const STEPS: readonly Step[] = ['why', 'basics', 'registered', 'preferred', 'money'];
/** Every screen of a program, in the order of its tab row. */
export const SCREENS: readonly Screen[] = [...STEPS, 'sheet', 'public'];

export const isStep = (value: unknown): value is Step => typeof value === 'string' && (STEPS as readonly string[]).includes(value);

/** A screen of a program. */
export const programPath = (programId: string, screen: Screen): string => `/programs/${encodeURIComponent(programId)}/${screen}`;

/** A step's name, with the program's level names ("Registered" and "Preferred" until it names them). */
export const stepName = (p: { regName?: string; prefName?: string }, step: Step): string =>
  ({ why: COPY.PROG_STEP_WHY, basics: COPY.PROG_STEP_BASICS, registered: levelNames(p).reg, preferred: levelNames(p).pref, money: COPY.PROG_STEP_MONEY })[step];

/** A screen's name: a step's, or Program Sheet, or Public page. */
export const screenName = (p: { regName?: string; prefName?: string }, screen: Screen): string =>
  screen === 'sheet' ? COPY.PROG_SHEET_TITLE : screen === 'public' ? COPY.PROG_PUBLIC_TITLE : stepName(p, screen);

// A partner type's program and level, as the partner page shows them (spec 4.2). Pure: no React, no I/O.
import { PROGRAM_TYPES, type Partner, type PartnerBook } from '@partner-desk/core';
import type { PartnerType } from '@partner-desk/method';
import type { MarketOption } from '@/partners/partners-model';
import type { ProgramLevels } from '@/programs/links';
import type { ProgramOption } from '@/programs/title';
import { marketName, type MarketState } from './partner-model';

/** Whether a program can exist for the partner type (Program Designer covers it). */
export const coversType = (type: PartnerType): boolean => (PROGRAM_TYPES as readonly string[]).includes(type);

/** The company's programs a partner type may join: those of its own type. */
export const programsFor = (programs: readonly ProgramOption[], type: PartnerType): ProgramOption[] =>
  programs.filter((p) => p.partnerType === type);

/** Those of `programsFor` the page doesn't know to be gone (a file trashed by hand, seen when its levels were read). */
export const joinableFor = (programs: readonly ProgramOption[], type: PartnerType, levelsOf: (id: string) => ProgramLevels): ProgramOption[] =>
  programsFor(programs, type).filter((p) => levelsOf(p.programId).status !== 'gone');

/**
 * Where a partner type stands: in no program, in one the page can't find any more, in one the page can't tell about
 * (the list of programs couldn't be read), or in one it lists.
 */
export type Membership =
  | { status: 'none' }
  | { status: 'gone'; programId: string }
  | { status: 'unknown'; programId: string }
  | { status: 'in'; program: ProgramOption; levels: ProgramLevels };

/**
 * The partner type's program. One the list doesn't hold for its type (deleted, someone else's, a hand edit), or
 * whose file is gone, is `gone`.
 */
export function membershipOf(
  partner: Partner, programs: readonly ProgramOption[], levelsOf: (id: string) => ProgramLevels, listed = true,
): Membership {
  if (partner.programId === null) return { status: 'none' };
  const program = programsFor(programs, partner.partnerType).find((p) => p.programId === partner.programId);
  if (!program && !listed) return { status: 'unknown', programId: partner.programId };
  const levels = program ? levelsOf(program.programId) : null;
  if (!program || !levels || levels.status === 'gone') return { status: 'gone', programId: partner.programId };
  return { status: 'in', program, levels };
}

/**
 * The program the sign dialog proposes (spec 4.2): the one fed by the market the partner came from. With several
 * market links, the first (in the order they were made) whose market feeds one of the company's programs of the
 * partner's type. Markets the page hasn't read (yet) are skipped.
 */
export function proposedProgram(
  book: PartnerBook, partner: Partner, marketStates: Readonly<Record<string, MarketState>>,
  programs: readonly ProgramOption[], markets: readonly MarketOption[],
): { programId: string; market: string } | null {
  const offered = programsFor(programs, partner.partnerType);
  for (const link of book.marketLinks) {
    if (link.partnerId !== partner.id) continue;
    const state = marketStates[link.marketId];
    if (state?.status !== 'ready') continue;
    const feeds = state.market.info.feedsProgramId;
    if (feeds !== null && offered.some((p) => p.programId === feeds)) return { programId: feeds, market: marketName(markets, link.marketId) };
  }
  return null;
}

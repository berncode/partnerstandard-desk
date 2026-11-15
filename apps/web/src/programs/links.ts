// What the screens know about the links between markets, partners and programs (plan 6, task 7). Types only, for the
// server loaders and the client screens alike.
import type { Level, ProgramType } from '@partner-desk/core';
import type { PartnerType } from '@partner-desk/method';

/** A program's levels as the partner page shows them: by the program's own names, or why they can't be. */
export type ProgramLevels =
  | { status: 'ready'; reg: string; pref: string; prefOn: boolean }
  | { status: 'loading' }
  /** The program isn't there any more (deleted, its file gone, or not the person's). */
  | { status: 'gone' }
  | { status: 'failed'; message: string };

/** A partner type in a program, for the program's page: enough to name it and open its tab. */
export interface ProgramPartner {
  partnerId: string;
  accountId: string;
  company: string;
  partnerType: PartnerType;
  level: Level;
}

/** A program's partners and the markets that feed it. */
export interface ProgramMembers {
  partners: ProgramPartner[];
  markets: { marketId: string; displayName: string }[];
}

/** A market a program can start from: its id and the name it is listed under. */
export interface StartMarket {
  marketId: string;
  displayName: string;
}

/** One program on the Programs page: how it is named, its partners per level and the markets that feed it. */
export interface ProgramRow {
  programId: string;
  title: string;
  partnerType: ProgramType;
  /** Its file is gone from Drive (trashed by hand), though the directory still lists it. */
  gone: boolean;
  /** Partners per level, by the program's level names; null when the program or the Partners file can't be read now. */
  levels: { name: string; count: number }[] | null;
  /** The open markets that feed it; null when one of them can't be read now (so "none" would not be sure). */
  markets: { marketId: string; displayName: string }[] | null;
}

/** The Programs page: its cards, and the first read that failed for a reason the person can act on (Reconnect Google). */
export interface ProgramsOverview {
  rows: ProgramRow[];
  problem: { failure: { error: string; message: string }; partnersFile: boolean } | null;
}

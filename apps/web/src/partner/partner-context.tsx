'use client';

// The partner page's editor.
import type { ApplyOutcome, Partner, PartnerAccount, PartnerBook, PartnerChange, ProposalView } from '@partner-desk/core';
import { createContext, useContext } from 'react';
import { toast } from 'sonner';
import type { DispatchOptions, SaveOutcome } from '@/editor/use-editor';
import type { MarketOption } from '@/partners/partners-model';
import type { ProgramLevels } from '@/programs/links';
import type { ProgramOption } from '@/programs/title';
import type { ProposalPick } from '@/proposals/proposal-model';
import type { MarketState } from './partner-model';

/** Adding a partner hypothesis to a market: its id once saved, or why not. */
export type AddHypothesis = (marketId: string, values: Record<string, unknown>) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;

/** An answer to a proposal as the screen has it at once: done on screen (the save goes on), or why not. */
export type LocalAnswer = { ok: true } | { ok: false; message: string; fieldErrors?: Record<string, string> };

/**
 * Agents' proposals for this company (agent proposals spec 10.2): the cards as the page builds them from the Partner book,
 * and the person's answers. An answer shows at once and saves in the background, like any change on the page; a refusal
 * from the server says why and reads the page again, and Google needing a new sign-in shows Reconnect Google.
 */
export interface PartnerProposals {
  views: readonly ProposalView[];
  /** The owner's timezone (Settings) and the time the page was read: every date on a card. */
  timeZone: string;
  now: string;
  accept: (view: ProposalView, pick?: ProposalPick) => LocalAnswer;
  reject: (view: ProposalView, note: string) => LocalAnswer;
}

export interface PartnerContextValue {
  /** The company this page is about. */
  account: PartnerAccount;
  /** The partner type open on this page. */
  partner: Partner;
  book: PartnerBook;
  readOnly: boolean;
  /** Applies a change to the Partner book at once and saves it in the background; answers the local outcome. */
  dispatch: (change: PartnerChange, options?: DispatchOptions) => ApplyOutcome<PartnerBook>;
  /** Saves a change and resolves when the save finishes. Deletes go through at once when `deferDelete` is false. */
  apply: (change: PartnerChange, options?: DispatchOptions) => Promise<SaveOutcome>;
  /** The company's markets, as the directory lists them. */
  markets: readonly MarketOption[];
  /** Each linked market's file, as far as the page has it, by market id. */
  marketStates: Readonly<Record<string, MarketState>>;
  addHypothesis: AddHypothesis;
  /** The id a row has now: a new row's local id maps to the server's once its add is saved. */
  idFor: (id: string) => string;
  /** Scrolls to "Add to a market" for the open partner type. */
  showMarkets: () => void;
  /** The company's programs, as the directory lists them. */
  programs: readonly ProgramOption[];
  /** False when that list couldn't be read: a program a partner is in is then unknown, not deleted. */
  programsListed: boolean;
  /** A program's level names and whether it has Preferred, read once the page needs them. */
  levelsOf: (programId: string) => ProgramLevels;
  /**
   * The owner's today, in their Settings time zone, as read with the page: the date Mark signed, an exit and a call
   * start on. Never the browser's date, which can be a day off and then offers a MAP date move nobody needs.
   */
  today: string;
  /** Agents' proposals; none in a page (or a test) that doesn't show them. */
  proposals?: PartnerProposals;
}

export const PartnerContext = createContext<PartnerContextValue | null>(null);

/** Shows why a change was refused, where nothing else on screen would: a button, a select, a checkbox. */
export function sayIfRefused<O extends { ok: true } | { ok: false; message: string }>(outcome: O): O {
  if (!outcome.ok) toast.error(outcome.message);
  return outcome;
}

/** `dispatch` for controls that show no error of their own: a refusal shows as a toast. */
export function useAct(): PartnerContextValue['dispatch'] {
  const { dispatch } = usePartner();
  return (change, options) => sayIfRefused(dispatch(change, options));
}

/** The partner page's editor, for any card on the page. */
export function usePartner(): PartnerContextValue {
  const value = useContext(PartnerContext);
  if (!value) throw new Error('usePartner must be used inside a PartnerContext provider');
  return value;
}

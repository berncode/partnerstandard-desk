'use client';

// The market page works on two files, the market's and the company's Partner book (its partners, their market links and calls).
import type { ApplyOutcome, Market, MarketChange, PartnerBook, PartnerChange, ProposalView } from '@partner-desk/core';
import type { RowIssue } from '@partner-desk/storage';
import { createContext, useContext } from 'react';
import type { PartnerBatch } from '@/editor/remotes';
import type { BatchSaveOutcome, DispatchOptions, Editor, SaveState } from '@/editor/use-editor';
import { sayIfRefused, type LocalAnswer } from '@/partner/partner-context';
import type { MarketOption } from '@/partners/partners-model';
import type { ProgramOption } from '@/programs/title';
import type { ChangeAbout } from './change-log-offer';
import type { MarketTab } from './market-model';

export type PartnerEditor = Pick<Editor<PartnerBook, PartnerChange, PartnerBatch>, 'apply' | 'applyMany' | 'dispatchMany' | 'savedIdFor'>;

/**
 * Agents' proposals about this market (agent proposals spec 10.2): the cards, built from the Partner book's Proposals
 * tab and the market as the page holds them, and the person's answers. A status shows at once and saves in the
 * background; new partners are accepted through the import preview (`partners.applyMany` with `accept`).
 */
export interface MarketProposals {
  views: ProposalView[];
  /** The owner's timezone (Settings): the dates on a card. */
  timeZone: string;
  /** The server's time when the page was read. */
  now: string;
  /** A hypothesis's or the market's status, as the status picker sets it; `onSaved` hears what changed, for the change log. */
  accept: (view: ProposalView, onSaved?: (about: Required<ChangeAbout>) => void) => LocalAnswer;
  reject: (view: ProposalView, note: string) => LocalAnswer;
  /** An import from a proposal was refused: say nothing more (the preview says why) and read the page again. */
  refused: (failure: { error: string; message: string }) => void;
}

export interface MarketContextValue {
  marketId: string;
  market: Market;
  /** The company's Partner book: this market's partners are the ones with a link to it. */
  book: PartnerBook;
  /** The company's markets, as the directory lists them. */
  markets: readonly MarketOption[];
  /** The company's programs, as the directory lists them: Feeds program offers those of the market's type. */
  programs: readonly ProgramOption[];
  /** False when that list couldn't be read: the program the market feeds is then unknown, not deleted. */
  programsListed: boolean;
  /** The person's company, as the search prompt names it. */
  companyName: string;
  /** Google needs reconnecting: nothing can be changed until the person signs in again. */
  readOnly: boolean;
  /** Both files' saves at once, for the header. */
  saving: SaveState;
  /** Rows of the market's sheet that couldn't be read. */
  issues: RowIssue[];
  /** Applies a change to the market at once and saves it in the background; answers the local outcome. */
  dispatch: (change: MarketChange, options?: DispatchOptions) => ApplyOutcome<Market>;
  /** Saves a batch of market changes (Exclusions from another market) in one write. */
  applyMany: (changes: MarketChange[]) => Promise<BatchSaveOutcome>;
  /** The id a market row has now: a new row's local id maps to the server's once its add is saved. */
  idFor: (id: string) => string;
  /** The Partner book's editor, for adding partners and market links (an import goes into this market). */
  partners: PartnerEditor;
  /**
   * An import got no clear answer (Google not answering, or the call failed): it may be in the book, so no import is
   * offered again until the page reloads.
   */
  importUnknown: boolean;
  markImportUnknown: () => void;
  /** "Needs attention" messages for one row the page shows (a deleted value point or call it names). */
  attentionFor: (entity: 'hypothesis' | 'change', id: string) => string[];
  openTab: (tab: MarketTab, hash?: string) => void;
  /** The agents' proposals about this market; none in a page that reads none. */
  proposals?: MarketProposals;
}

export const MarketContext = createContext<MarketContextValue | null>(null);

/** The market page's editors, for any part of the page. */
export function useMarket(): MarketContextValue {
  const value = useContext(MarketContext);
  if (!value) throw new Error('useMarket must be used inside a MarketContext provider');
  return value;
}

/** `dispatch` for controls that show no error of their own (a select, a toggle, a delete): a refusal shows as a toast. */
export function useMarketAct(): MarketContextValue['dispatch'] {
  const { dispatch } = useMarket();
  return (change, options) => sayIfRefused(dispatch(change, options));
}

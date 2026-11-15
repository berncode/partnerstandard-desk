'use client';

// The market page has two editors, the market's file and the Partner book, and keeps the tab in the address. A partner
// opens on its own page, not in place of the tabs.
import {
  applyMarketChange, proposalViews,
  type Market, type MarketChange, type PartnerBook, type PartnerChange, type ProposalHead, type ProposalView,
} from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { useRouter, useSearchParams } from 'next/navigation';
import { Tabs } from 'radix-ui';
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { toast } from 'sonner';
import { marketAdapter, partnersAdapter } from '@/editor/adapters';
import { ReconnectBanner } from '@/editor/reconnect-banner';
import type { RemoteFailure } from '@/editor/remote';
import { marketRemote, partnersRemote, type MarketBatch, type PartnerBatch } from '@/editor/remotes';
import { useEditor, type BatchSaveOutcome } from '@/editor/use-editor';
import { sayIfRefused, type LocalAnswer } from '@/partner/partner-context';
import { GoneProposals } from '@/proposals/gone-proposals';
import { acceptRows, cardsWithoutHypothesis, marketAcceptChange, refusalText, rejectChanges } from '@/proposals/proposal-model';
import { noteAnswered } from '@/proposals/waiting-store';
import type { MarketOption } from '@/partners/partners-model';
import type { ProgramOption } from '@/programs/title';
import { ChangeLogOfferProvider } from './change-log-offer';
import { ChangesTab } from './changes';
import { ExclusionsPanel } from './exclusions-panel';
import { scrollToHashWhenShown } from './scroll-to-hash';
import { MarketContext, type MarketContextValue, type MarketProposals } from './market-context';
import { MarketHeader } from './market-header';
import { MarketHypothesisTab } from './market-hypothesis';
import { attentionOf, combinedSaveState, MARKET_TABS, parseFirstPartners, parseTab, rowKey, TAB_LABELS, type MarketTab } from './market-model';
import { FirstPartnersNotice, NeedsAttention } from './needs-attention';
import { PartnerHypothesesTab } from './partner-hypotheses';
import { Pipeline } from './pipeline';
import { ValuePropositionTab } from './value-proposition';
import { DEFAULT_TIME_ZONE } from '@/ui/dates';
import type { StorageKind } from '@/storage-kind';
import { useCopy } from '@/storage-context';

const NO_PROPOSALS: ProposalHead[] = [];

const CONTENT: Record<MarketTab, ComponentType> = {
  pipeline: Pipeline,
  hypothesis: MarketHypothesisTab,
  value: ValuePropositionTab,
  hypotheses: PartnerHypothesesTab,
  changes: ChangesTab,
};

/** The address with `name` set (or dropped, for null), keeping the rest. */
function withParam(name: string, value: string | null, hash = ''): string {
  const params = new URLSearchParams(window.location.search);
  if (value === null) params.delete(name);
  else params.set(name, value);
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${hash}`;
}

/**
 * One market: what needs attention, the header, the five tabs (in the address as `?tab=`), the change-log offer and
 * the Exclusions panel. `initialMarket` and `initialBook` must be referentially stable (a fresh server render replaces them).
 * `proposals`: the person's agents' proposals about this market, from our index (ids, codes and times); their content
 * is the Partner book's Proposals tab, so the cards follow the book and the market on screen.
 */
export function MarketPage({
  initialMarket, initialBook, markets, programs, programsListed = true, companyName, fileUrl, actor, storage,
  proposals = NO_PROPOSALS, timeZone = DEFAULT_TIME_ZONE, now: readAt,
}: {
  initialMarket: Snapshot<Market>;
  initialBook: Snapshot<PartnerBook>;
  markets: readonly MarketOption[];
  /** The company's programs, for Feeds program. */
  programs: readonly ProgramOption[];
  /** False when that list couldn't be read. */
  programsListed?: boolean;
  /** The person's company, for the search prompt. */
  companyName: string;
  /** The spreadsheet's link, or null when there is none to open. */
  fileUrl: string | null;
  actor: string;
  storage: StorageKind;
  proposals?: ProposalHead[];
  /** The owner's timezone (Settings): the dates on a proposal's card. */
  timeZone?: string;
  /** The server's time when the page was read: what a proposal's age and expiry count from. */
  now?: string;
}) {
  // The read-only line in the words of where the work lives (plan 14).
  const words = useCopy();
  const marketId = initialMarket.value.info.marketId;
  const remote = useMemo(() => marketRemote(marketId), [marketId]);
  const marketEditor = useEditor<Market, MarketChange, MarketBatch>(initialMarket, { adapter: marketAdapter, remote, actor });
  const bookEditor = useEditor<PartnerBook, PartnerChange, PartnerBatch>(initialBook, { adapter: partnersAdapter, remote: partnersRemote, actor });
  const params = useSearchParams();
  const tab = parseTab(params.get('tab'));
  const firstPartners = parseFirstPartners(params.get('firstPartners') ?? undefined);
  const [exclusions, setExclusions] = useState(false);
  const [importUnknown, setImportUnknown] = useState(false);
  const market = marketEditor.value;
  const book = bookEditor.value;
  const attention = useMemo(() => attentionOf(market, marketEditor.issues, book), [market, marketEditor.issues, book]);
  const readOnly = marketEditor.readOnly || bookEditor.readOnly;
  const router = useRouter();
  const [now] = useState(() => readAt ?? new Date().toISOString());
  const archived = markets.find((m) => m.marketId === marketId)?.archived ?? false;
  // A status accept being saved: its card waits off the page until the answer brings the rows back.
  const [answering, setAnswering] = useState<ReadonlySet<string>>(new Set());
  const views = useMemo(
    () => proposalViews(proposals, { book, markets: { [marketId]: { market, archived } } }, readAt ?? now).filter((v) => !answering.has(v.head.id)),
    [proposals, book, market, marketId, archived, readAt, now, answering],
  );

  // A tab opened from the address scrolls nowhere; one opened with a hash (the search prompt) goes there once shown.
  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    return scrollToHashWhenShown(id);
  }, [tab]);

  const stopScroll = useRef<() => void>(() => {});
  useEffect(() => () => stopScroll.current(), []);

  const answeringOf = (id: string, on: boolean) => setAnswering((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
  /**
   * After an answer is saved or refused (agent proposals spec 10.3): saved, the sidebar's count goes down. Refused, it
   * says why and reads the page again, so the market shows the status as it is now (a market written before its rows
   * failed: the card says "Already as proposed.", spec 7.3). Google needing a new sign-in only shows Reconnect Google.
   */
  const settle = (view: ProposalView, heard: { failure: RemoteFailure | null }, onSaved?: () => void) => (saved: BatchSaveOutcome) => {
    answeringOf(view.head.id, false);
    if (saved.ok) {
      noteAnswered(view.head.id);
      onSaved?.();
      return;
    }
    if (heard.failure?.error === 'auth') return;
    toast.error(heard.failure ? refusalText(view, heard.failure) : saved.message ?? COPY.SAVE_OFFLINE);
    router.refresh();
  };
  const answers: MarketProposals = {
    views, timeZone, now: readAt ?? now,
    accept: (view, onSaved): LocalAnswer => {
      if (readOnly) return { ok: false, message: words.SAVE_READ_ONLY };
      const heard: { failure: RemoteFailure | null } = { failure: null };
      const onRefused = (failure: RemoteFailure) => { heard.failure = failure; };
      const input = { proposalId: view.head.id, ...(view.targetUpdatedAt !== null ? { expectedUpdatedAt: view.targetUpdatedAt } : {}) };
      const built = marketAcceptChange(view, book);
      if (!built) {
        if (view.state !== 'already') return { ok: false, message: view.cannot ?? COPY.GONE };
        // The market holds it already (its rows' write failed after the market's): the rows alone close it.
        const rows = acceptRows(view, book, new Date().toISOString());
        void bookEditor.applyMany(rows, { accept: { ...input, onRefused } }, { quiet: true }).then(settle(view, heard));
        return { ok: true };
      }
      // The same check as the status picker's, at once; the server checks it again on the file as it is now.
      const local = applyMarketChange(market, built.change, { now: new Date().toISOString(), actor });
      if (!local.ok) return { ok: false, message: local.message, ...(local.fieldErrors ? { fieldErrors: local.fieldErrors } : {}) };
      answeringOf(view.head.id, true);
      void marketEditor.applyMany([built.change], { accept: { ...input, onRefused, onBook: bookEditor.refresh } }, { quiet: true })
        .then(settle(view, heard, () => onSaved?.(built.about)));
      return { ok: true };
    },
    reject: (view, note): LocalAnswer => {
      if (readOnly) return { ok: false, message: words.SAVE_READ_ONLY };
      const heard: { failure: RemoteFailure | null } = { failure: null };
      const trimmed = note.trim();
      void bookEditor.applyMany(rejectChanges(view, book, note, new Date().toISOString()), {
        reject: { proposalId: view.head.id, ...(trimmed ? { note: trimmed } : {}), onRefused: (failure) => { heard.failure = failure; } },
      }, { quiet: true }).then(settle(view, heard));
      return { ok: true };
    },
    refused: () => router.refresh(),
  };

  const value: MarketContextValue = {
    marketId,
    market,
    book,
    markets,
    programs,
    programsListed,
    companyName,
    readOnly,
    saving: combinedSaveState(marketEditor.saving, bookEditor.saving),
    issues: marketEditor.issues,
    dispatch: marketEditor.dispatch,
    applyMany: (changes) => marketEditor.applyMany(changes, undefined),
    idFor: marketEditor.idFor,
    partners: { apply: bookEditor.apply, applyMany: bookEditor.applyMany, dispatchMany: bookEditor.dispatchMany, savedIdFor: bookEditor.savedIdFor },
    importUnknown,
    markImportUnknown: () => setImportUnknown(true),
    attentionFor: (entity, id) => attention.byRow.get(rowKey(entity, id)) ?? [],
    openTab: (next, hash) => {
      window.history.pushState(null, '', withParam('tab', next, hash ? `#${hash}` : ''));
      stopScroll.current();
      // The tab may be open already (nothing re-renders to scroll), or opens a moment later; either way look until it shows.
      stopScroll.current = hash ? scrollToHashWhenShown(hash) : () => {};
    },
    proposals: answers,
  };

  return (
    <MarketContext value={value}>
      <div className="grid grid-cols-1 gap-4">
        {readOnly && <ReconnectBanner next={`/markets/${marketId}`} storage={storage} />}
        {firstPartners !== null && (
          <FirstPartnersNotice count={firstPartners}
            // Drop the count from the address, so a reload doesn't show it again.
            onDismiss={() => window.history.replaceState(null, '', withParam('firstPartners', null, window.location.hash))} />
        )}
        <NeedsAttention items={attention.general} />
        {/* A hypothesis status proposal whose hypothesis is gone has no card to sit on: it waits here, to be rejected. */}
        <GoneProposals views={cardsWithoutHypothesis(views, market.hypotheses.map((h) => h.id))} timeZone={timeZone} now={answers.now}
          readOnly={readOnly} onReject={(view, note) => sayIfRefused(answers.reject(view, note))} />
        <ChangeLogOfferProvider>
          <MarketHeader fileUrl={fileUrl} onExclusions={() => setExclusions(true)} />
          <Tabs.Root value={tab} onValueChange={(next) => value.openTab(next as MarketTab)}>
            <Tabs.List aria-label={COPY.MARKET_SECTIONS} className="flex gap-1 overflow-x-auto border-b border-line">
              {MARKET_TABS.map((key) => (
                <Tabs.Trigger key={key} value={key}
                  className="-mb-px shrink-0 border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap text-ink-3 outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-brand data-[state=active]:border-brand data-[state=active]:text-ink">
                  {TAB_LABELS[key]}
                </Tabs.Trigger>
              ))}
            </Tabs.List>
            {MARKET_TABS.map((key) => {
              const Content = CONTENT[key];
              return <Tabs.Content key={key} value={key} className="pt-4 outline-none"><Content /></Tabs.Content>;
            })}
          </Tabs.Root>
        </ChangeLogOfferProvider>
      </div>
      <ExclusionsPanel open={exclusions} onOpenChange={setExclusions} />
    </MarketContext>
  );
}

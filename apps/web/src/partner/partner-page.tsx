'use client';

// One company, with a tab for each partner type. The company facts and the people sit above the tabs.
// The open type holds the stepper, the end of the partnership, its program and level, its business cases, its MAP, its
// markets and the recruitment work.
import {
  applyPartnerChanges, deleteSectionChanges, proposalViews, sectionsOf,
  type PartnerBook, type PartnerChange, type ProposalHead, type ProposalView,
} from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, type PartnerType } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import type { Snapshot } from '@partner-desk/storage';
import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { caseCreate, caseList, caseRows } from '@/app/(signed-in)/actions/cases';
import { mapArea, mapDelete, mapList, mapStart } from '@/app/(signed-in)/actions/maps';
import { reviewArea } from '@/app/(signed-in)/actions/reviews';
import { marketRead } from '@/app/(signed-in)/actions/markets';
import { programLevelsRead } from '@/app/(signed-in)/actions/programs';
import { CasesChoice, type CasesFate } from '@/cases/cases-choice';
import { partnersAdapter } from '@/editor/adapters';
import { ReconnectBanner } from '@/editor/reconnect-banner';
import type { RemoteFailure } from '@/editor/remote';
import { marketRemote, partnersRemote, type PartnerBatch } from '@/editor/remotes';
import { useEditor, type BatchSaveOutcome } from '@/editor/use-editor';
import type { MarketOption } from '@/partners/partners-model';
import type { ProgramLevels } from '@/programs/links';
import type { ProgramOption } from '@/programs/title';
import { GoneProposals } from '@/proposals/gone-proposals';
import { acceptChanges, acceptInput, cardsWithoutTab, rejectChanges, type ProposalPick } from '@/proposals/proposal-model';
import { noteAnswered } from '@/proposals/waiting-store';
import { Button, buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { ConfirmDialog } from '@/ui/confirm-dialog';
import { Dialog, DialogContent } from '@/ui/dialog';
import { AccountHeader } from './account-header';
import { AddTypeDialog } from './add-type-dialog';
import { Calls } from './calls';
import { CaseArea, type LoadCaseRows } from './case-area';
import { DeskCheck } from './desk-check';
import { AccountDetails, SectionFacts } from './details';
import { Header } from './header';
import { MapArea, MapAreaProvider, type LoadMapArea, type SignMovingDates, type StartMap } from './map-area';
import type { DeleteMapAction } from '@/maps/delete-map';
import { MarketLinks } from './market-links';
import { PartnerContext, sayIfRefused, type LocalAnswer, type PartnerContextValue, type PartnerProposals } from './partner-context';
import { ReviewArea, ReviewAreaProvider, ReviewToDate, type LoadReviewArea } from './review-area';
import { PartnerHypothesis } from './partner-hypothesis';
import { partnerHref, sectionForType, type MarketState } from './partner-model';
import { People } from './people';
import { ProgramCard } from './program-card';
import { Qualification } from './qualification';
import { TypeTabs } from './type-tabs';
import { useLinkedMarkets, type MarketAccess } from './use-linked-markets';
import { useProgramLevels } from './use-program-levels';
import { DEFAULT_TIME_ZONE } from '@/ui/dates';
import type { StorageKind } from '@/storage-kind';
import { useCopy } from '@/storage-context';

const MARKETS: MarketAccess = { read: (marketId) => marketRead(marketId), remoteFor: marketRemote };
const LOAD_CASE_ROWS: LoadCaseRows = (input) => caseRows(input);
const LOAD_MAP_AREA: LoadMapArea = (input) => mapArea(input);
const LOAD_REVIEW_AREA: LoadReviewArea = (input) => reviewArea(input);
const START_MAP: StartMap = (input) => mapStart(input);
const DELETE_MAP: DeleteMapAction = (input) => mapDelete(input);
const NO_PROPOSALS: ProposalHead[] = [];

/** How many business cases and MAPs a partner type has, or why that can't be said now. */
async function countItems(partnerId: string): Promise<{ ok: true; cases: number; maps: number } | { ok: false; message: string }> {
  try {
    const [cases, maps] = await Promise.all([caseList({ partnerId }), mapList({ partnerId })]);
    if (!cases.ok) return { ok: false, message: cases.message };
    if (!maps.ok) return { ok: false, message: maps.message };
    return { ok: true, cases: cases.cases.length, maps: maps.maps.length };
  } catch {
    return { ok: false, message: COPY.ACTION_FAILED };
  }
}

/** Reads the level names of programs picked on the page; a failed answer reads as failed for each. */
async function readLevels(programIds: string[]): Promise<Record<string, ProgramLevels>> {
  const answer = await programLevelsRead({ programIds });
  if (answer.ok) return answer.levels;
  return Object.fromEntries(programIds.map((id) => [id, { status: 'failed', message: answer.message }]));
}

/** The recruitment work for the open partner type. */
function RecruitmentTab() {
  return (
    <div className="grid gap-4">
      <DeskCheck />
      <Calls />
      <PartnerHypothesis />
      <Qualification />
    </div>
  );
}

function BackToPartners() {
  return (
    <div>
      <Link href="/partners" className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), '-ml-2')}>
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {COPY.BACK_TO_PARTNERS}
      </Link>
    </div>
  );
}

/**
 * One company. The address is the company's id, and `?type=` opens one partner type. With none, the first type opens.
 * `proposals`: the person's agents' proposals for this company, from our index (ids, codes and times); their content
 * is the Partner book's Proposals tab, so the cards follow the book on screen.
 */
export function PartnerPage({
  initial, accountId, markets, linkedMarkets, programs, programsListed = true, levels, actor, today, storage,
  proposals = NO_PROPOSALS, timeZone = DEFAULT_TIME_ZONE, now: readAt,
}: {
  initial: Snapshot<PartnerBook>;
  accountId: string;
  markets: MarketOption[];
  linkedMarkets: Record<string, MarketState>;
  /** The company's programs, as the directory lists them. */
  programs: ProgramOption[];
  /** False when that list couldn't be read: a partner's program is then unknown, not deleted. */
  programsListed?: boolean;
  /** The level names of the programs this company's partner types are in, as read with the page. */
  levels: Record<string, ProgramLevels>;
  actor: string;
  /** The owner's today, in their Settings time zone: the date the page's dialogs start on. */
  today: string;
  storage: StorageKind;
  proposals?: ProposalHead[];
  /** The owner's timezone (Settings): the dates on a proposal's card. */
  timeZone?: string;
  /** The server's time when the page was read: what a proposal's age and expiry count from. */
  now?: string;
}) {
  // The read-only line in the words of where the work lives (plan 14).
  const words = useCopy();
  const editor = useEditor<PartnerBook, PartnerChange, PartnerBatch>(initial, { adapter: partnersAdapter, remote: partnersRemote, actor });
  const book = editor.value;
  const router = useRouter();
  const [now] = useState(() => readAt ?? new Date().toISOString());
  const views = useMemo(() => proposalViews(proposals, { book, markets: {} }, readAt ?? now), [proposals, book, readAt, now]);
  const account = book.accounts.find((item) => item.id === accountId);
  const sections = account ? sectionsOf(book, account.id) : [];
  // Proposals for a partner type removed since: no tab to sit in.
  const withoutTab = cardsWithoutTab(views, sections.map((item) => item.id));
  // The open type is the address's: a tab click puts it there with pushState, which useSearchParams follows.
  const section = sectionForType(sections, useSearchParams().get('type'));
  const [adding, setAdding] = useState(false);
  /** The partner type the confirm dialog asks about, as it was when Remove was pressed, and how many cases and MAPs it has. */
  const [removing, setRemoving] = useState<{
    partnerId: string; partnerType: PartnerType; company: string; last: boolean; cases: number; maps: number;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const marketIds = useMemo(
    () => [...new Set(book.marketLinks.filter((link) => link.partnerId === section?.id).map((link) => link.marketId))],
    [book.marketLinks, section?.id],
  );
  const { states, addHypothesis } = useLinkedMarkets(linkedMarkets, marketIds, MARKETS);
  // The open type's program: its level names are read once the page needs them.
  const levelsOf = useProgramLevels(levels, section?.programId ? [section.programId] : [], readLevels);

  const choose = (partnerType: string) => {
    window.history.pushState(null, '', partnerHref(accountId, partnerType));
  };

  /**
   * Remove: first how many business cases and MAPs the partner type has (the dialog asks what happens to them, spec
   * 5.5, MAP spec 5.6), then the dialog. Pressed twice, it asks once.
   */
  const askRemove = async (target: Omit<NonNullable<typeof removing>, 'cases' | 'maps'>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const counted = await countItems(target.partnerId);
    busyRef.current = false;
    setBusy(false);
    if (!counted.ok) {
      toast.error(counted.message);
      return;
    }
    setRemoving({ ...target, cases: counted.cases, maps: counted.maps });
  };

  /** Mark signed with the MAP's open dates moved (spec 5.3): the signing alone, sent with `shiftMapDates`. */
  const signMovingDates: SignMovingDates = (change) => editor.dispatchMany([change], {
    sign: { onMapDates: (moved) => { if (!moved?.moved) toast.error(COPY.MAP_DATES_NOT_MOVED); } },
  });

  /**
   * The partner type, and with the company's last one the company and its contacts, in one save. Undo brings all of
   * them back, but only without cases or a MAP: they would not come back with it [builder's call]. `fate`: what happens
   * to its cases and its MAP. Pressed twice, it still sends one.
   */
  const remove = async (fate?: CasesFate) => {
    if (!removing || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const left = sections.filter((item) => item.id !== removing.partnerId);
    const saved = await editor.applyMany(
      deleteSectionChanges(book, removing.partnerId),
      { remove: true, ...(fate ? { items: fate } : {}) },
      fate ? {} : { label: COPY.PARTNER_TYPE_REMOVED },
    );
    busyRef.current = false;
    setBusy(false);
    setRemoving(null);
    if (saved.ok && fate) toast(COPY.PARTNER_TYPE_REMOVED);
    const next = left[0];
    if (saved.ok && next) choose(next.partnerType);
  };

  /**
   * An answer to a proposal: on screen at once, saved in the background in one request (agent proposals spec 10.3).
   * Refused by the server, it says why and reads the page again, so the card shows the proposal as it is now; Google
   * needing a new sign-in turns the page read-only with Reconnect Google, and the proposal still waits.
   */
  const answer = (proposalId: string, changes: PartnerChange[], batch: (onRefused: (failure: RemoteFailure) => void) => PartnerBatch): LocalAnswer => {
    if (editor.readOnly) return { ok: false, message: words.SAVE_READ_ONLY };
    const local = applyPartnerChanges(book, changes, { now: new Date().toISOString(), actor });
    if (!local.ok) return { ok: false, message: local.message, ...(local.fieldErrors ? { fieldErrors: local.fieldErrors } : {}) };
    let refused: RemoteFailure | null = null;
    const settle = (saved: BatchSaveOutcome) => {
      // Saved: the sidebar's count of waiting proposals goes down at once.
      if (saved.ok) noteAnswered(proposalId);
      if (saved.ok || refused?.error === 'auth') return;
      const changedSince = refused?.error === 'conflict' && refused.message === COPY.CONFLICT;
      toast.error(changedSince ? COPY.PROPOSAL_PARTNER_CHANGED : refused?.message ?? saved.message ?? COPY.SAVE_OFFLINE);
      router.refresh();
    };
    void editor.applyMany(changes, batch((failure) => { refused = failure; }), { quiet: true }).then(settle);
    return { ok: true };
  };
  const answers: PartnerProposals = {
    views, timeZone, now: readAt ?? now,
    accept: (view: ProposalView, pick: ProposalPick = {}) => {
      const built = acceptChanges(view, book, pick, new Date().toISOString());
      if (!built.ok) return built;
      const sign = pick.shiftMapDates ? { sign: { onMapDates: (moved: { moved: boolean } | null) => { if (!moved?.moved) toast.error(COPY.MAP_DATES_NOT_MOVED); } } } : {};
      return answer(view.head.id, built.changes, (onRefused) => ({ accept: { ...acceptInput(view, pick), ...sign, onRefused } }));
    },
    reject: (view: ProposalView, note: string) => {
      const trimmed = note.trim();
      return answer(view.head.id, rejectChanges(view, book, note, new Date().toISOString()), (onRefused) => ({
        reject: { proposalId: view.head.id, ...(trimmed ? { note: trimmed } : {}), onRefused },
      }));
    },
  };

  let content: ReactNode;
  if (!account || !section) {
    content = <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">{COPY.PARTNER_GONE}</p>;
  } else {
    const value: PartnerContextValue = {
      account, partner: section, book, readOnly: editor.readOnly, dispatch: editor.dispatch, apply: editor.apply,
      markets, marketStates: states, addHypothesis, idFor: editor.idFor,
      showMarkets: () => document.getElementById('market-links')?.scrollIntoView({ block: 'nearest' }),
      programs, programsListed, levelsOf, today, proposals: answers,
    };
    content = (
      <PartnerContext.Provider value={value}>
        {/* A proposal for a partner type removed since has no tab to sit in: it waits here, to be rejected. */}
        <GoneProposals views={withoutTab} timeZone={timeZone} now={answers.now}
          readOnly={editor.readOnly} onReject={(view, note) => sayIfRefused(answers.reject(view, note))} />
        <AccountHeader />
        <AccountDetails />
        <People />
        <MapAreaProvider load={LOAD_MAP_AREA} start={START_MAP} remove={DELETE_MAP} signMovingDates={signMovingDates} settled={editor.saving !== 'saving'}>
          <ReviewAreaProvider load={LOAD_REVIEW_AREA}>
            <TypeTabs sections={sections} value={section.partnerType} onValueChange={choose} onAdd={() => setAdding(true)} readOnly={editor.readOnly}>
              <Header />
              <ReviewToDate />
              {!editor.readOnly && (
                <div>
                  <Button variant="ghost" size="sm" className="-ml-2" disabled={busy}
                    aria-busy={busy || undefined}
                    onClick={() => void askRemove({ partnerId: section.id, partnerType: section.partnerType, company: account.company, last: sections.length === 1 })}>
                    {COPY.REMOVE_PARTNER_TYPE(PARTNER_TYPE_LABELS[section.partnerType])}
                  </Button>
                </div>
              )}
              <ProgramCard />
              <CaseArea load={LOAD_CASE_ROWS} create={caseCreate} />
              <MapArea />
              <ReviewArea />
              <div id="market-links"><MarketLinks /></div>
              <SectionFacts />
              <RecruitmentTab />
            </TypeTabs>
          </ReviewAreaProvider>
        </MapAreaProvider>
        <AddTypeDialog open={adding} onOpenChange={setAdding} accountId={account.id} today={today}
          taken={sections.map((item) => item.partnerType)} apply={editor.apply} onAdded={choose} />
      </PartnerContext.Provider>
    );
  }

  return (
    <div className="grid gap-4">
      {editor.readOnly && <ReconnectBanner next={partnerHref(accountId, section?.partnerType)} storage={storage} />}
      <BackToPartners />
      {content}
      {/* Outside the content: removing the last type takes the company off the page while the save runs. */}
      {removing && removing.cases + removing.maps === 0 && (
        <ConfirmDialog open onOpenChange={(open) => { if (!open) setRemoving(null); }} busy={busy}
          title={COPY.REMOVE_TYPE_TITLE(removing.company, PARTNER_TYPE_LABELS[removing.partnerType])}
          text={removing.last ? COPY.REMOVE_LAST_TYPE_TEXT(removing.company) : COPY.REMOVE_TYPE_TEXT(removing.company)}
          action={COPY.REMOVE} onConfirm={() => void remove()} />
      )}
      {/* With cases or a MAP (spec 5.5, 5.6): how many, that closing or exiting keeps everything, then what happens to them. */}
      {removing && removing.cases + removing.maps > 0 && (
        <Dialog open onOpenChange={(open) => { if (!open && !busy) setRemoving(null); }}>
          <DialogContent title={COPY.REMOVE_TYPE_TITLE(removing.company, PARTNER_TYPE_LABELS[removing.partnerType])}
            description={removing.last ? COPY.REMOVE_LAST_TYPE_CASES_TEXT(removing.company) : COPY.REMOVE_TYPE_TEXT(removing.company)}>
            <p className="mt-3 text-sm font-medium">
              {removing.maps > 0
                ? COPY.REMOVE_TYPE_ITEMS(removing.company, PARTNER_TYPE_LABELS[removing.partnerType], removing.cases, removing.maps)
                : COPY.REMOVE_TYPE_CASES(removing.company, PARTNER_TYPE_LABELS[removing.partnerType], removing.cases)}
            </p>
            <p className="mt-1 text-sm text-ink-2">{COPY.CLOSE_KEEPS_EVERYTHING}</p>
            <CasesChoice count={removing.cases} maps={removing.maps} busy={busy} onChoose={(fate) => void remove(fate)} onCancel={() => setRemoving(null)} />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

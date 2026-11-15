'use client';

// Words from packages/copy and examples from packages/method. "Find partners with AI" holds the search prompt.
import { HOW_MARKET_BUYS, MARKET_STATUSES, type ApplyOutcome, type InfoPatch, type Market, type MarketField } from '@partner-desk/core';
import {
  EXAMPLE_MARKET,
  LINKS,
  PARTNER_TYPE_LABELS,
  TIPS,
} from '@partner-desk/method';
import {
  COPY,
  HOW_MARKET_BUYS_LABELS,
  MARKET_STATUS_LABELS,
} from '@partner-desk/copy';
import Link from 'next/link';
import { useId, type ReactNode } from 'react';
import { sayIfRefused } from '@/partner/partner-context';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { InlineText } from '@/ui/inline-text';
import { CheckAgain, ExampleLine, LearnMore, Section, Tip } from '@/ui/pieces';
import { coversType } from '@/partner/program-model';
import { useViewer } from '@/storage-context';
import { useThinkingEdit } from './change-log-offer';
import { useMarket, useMarketAct } from './market-context';
import { fieldLabel, marketIssues } from './market-model';
import { NeedsAttentionHint } from './needs-attention';
import { SearchPrompt } from './search-prompt';

const selectClass = cn(controlClass, 'max-w-sm px-2 disabled:opacity-70');

const lines = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean);

/** The sample market's value for a field, written as people read it. */
const EXAMPLES: Record<MarketField, string> = {
  marketName: EXAMPLE_MARKET.marketName,
  partnerType: PARTNER_TYPE_LABELS[EXAMPLE_MARKET.partnerType],
  ourProduct: EXAMPLE_MARKET.ourProduct,
  ourTargetCustomers: EXAMPLE_MARKET.ourTargetCustomers,
  whyPartnerRoute: EXAMPLE_MARKET.whyPartnerRoute,
  mustHaves: EXAMPLE_MARKET.mustHaves.join('\n'),
  howMarketBuys: EXAMPLE_MARKET.howMarketBuys,
  howMarketBuysNote: EXAMPLE_MARKET.howMarketBuysNote,
  statement: EXAMPLE_MARKET.statement,
  expectedCandidates: EXAMPLE_MARKET.expectedPartners,
  status: EXAMPLE_MARKET.status,
  statusNote: EXAMPLE_MARKET.statusNote,
};

/** Saves a Market field and offers the change log. */
function useSetInfo() {
  const edit = useThinkingEdit();
  return (field: MarketField, patch: InfoPatch, label: string = COPY.MARKET_HYPOTHESIS_UPDATED): ApplyOutcome<Market> =>
    edit({ kind: 'updateInfo', patch }, { entity: 'market', id: field }, { label });
}

/** One Market field: its name, its "check again" marker, the control, and the sample's value while it is empty. */
function FieldRow({ field, empty, hint, children }: { field: MarketField; empty: boolean; hint?: ReactNode; children: ReactNode }) {
  const { market, readOnly } = useMarket();
  const act = useMarketAct();
  const flagged = market.info.checkAgain.includes(field);
  const label = fieldLabel(field);
  return (
    <div className={cn('min-w-0 rounded-xl p-3', flagged ? 'bg-warn-soft/40 ring-1 ring-warn/30' : 'bg-surface-2/40')}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <p className="text-xs font-medium text-ink-3">{label}</p>
        {flagged && (
          <CheckAgain what={label} readOnly={readOnly}
            onChecked={() => act({ kind: 'clearCheckAgain', target: { entity: 'market', field } }, { label: COPY.MARKED_CHECKED })} />
        )}
      </div>
      <div className="mt-1 text-sm">{children}</div>
      {hint && <div className="mt-1 text-xs text-ink-3">{hint}</div>}
      {empty && !readOnly && <ExampleLine text={EXAMPLES[field]} />}
    </div>
  );
}

type TextKey = 'marketName' | 'ourProduct' | 'ourTargetCustomers' | 'whyPartnerRoute' | 'howMarketBuysNote' | 'statement' | 'statusNote';

/** A Market field edited as text. */
function TextField({ field, multiline, placeholder, hint }: { field: TextKey; multiline?: boolean; placeholder?: string; hint?: ReactNode }) {
  const { market, readOnly } = useMarket();
  const set = useSetInfo();
  const value = market.info[field];
  return (
    <FieldRow field={field} empty={!value.trim()} hint={hint}>
      <InlineText value={value} label={fieldLabel(field)} field={field} multiline={multiline} disabled={readOnly}
        placeholder={placeholder ?? COPY.CLICK_TO_WRITE} onCommit={(text) => set(field, { [field]: text })} />
    </FieldRow>
  );
}

function MustHaves() {
  const { market, readOnly } = useMarket();
  const set = useSetInfo();
  const { mustHaves } = market.info;
  return (
    <FieldRow field="mustHaves" empty={mustHaves.length === 0} hint={COPY.HINT_MUST_HAVES}>
      <InlineText value={mustHaves.join('\n')} label={fieldLabel('mustHaves')} field="mustHaves" multiline disabled={readOnly}
        placeholder={COPY.CLICK_TO_WRITE} onCommit={(text) => set('mustHaves', { mustHaves: lines(text) })} />
    </FieldRow>
  );
}

function ExpectedPartners() {
  const { market, readOnly } = useMarket();
  const set = useSetInfo();
  const { expectedCandidates } = market.info;
  const commit = (text: string): ApplyOutcome<Market> => {
    const trimmed = text.trim();
    if (trimmed && !/^\d+$/.test(trimmed)) {
      return { ok: false, error: 'invalid', message: COPY.WHOLE_NUMBER, fieldErrors: { expectedCandidates: COPY.WHOLE_NUMBER } };
    }
    return set('expectedCandidates', { expectedCandidates: trimmed ? Number(trimmed) : null });
  };
  return (
    <FieldRow field="expectedCandidates" empty={expectedCandidates === null} hint={<Tip>{TIPS['marketHypothesis.candidates']}</Tip>}>
      <InlineText value={expectedCandidates === null ? '' : String(expectedCandidates)} label={fieldLabel('expectedCandidates')}
        field="expectedCandidates" disabled={readOnly} placeholder={COPY.EXPECTED_PARTNERS_PLACEHOLDER} onCommit={commit} />
    </FieldRow>
  );
}

function PartnerType() {
  const { market } = useMarket();
  const { partnerType } = market.info;
  // The type is fixed once the market is created. It is shown, not chosen again.
  return (
    <FieldRow field="partnerType" empty={false}>
      <p>{PARTNER_TYPE_LABELS[partnerType]}</p>
    </FieldRow>
  );
}

const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

/**
 * Feeds program (spec 4.1), next to the partner type: one of the company's programs of the market's type, or none.
 * A program that is gone (deleted, or its file trashed) shows as such until another is picked.
 */
function FeedsProgram() {
  const { market, programs, programsListed, readOnly } = useMarket();
  const act = useMarketAct();
  const hintId = useId();
  // A company server's viewer can't make a program: no link to add one (owner, 2026-11-14).
  const viewer = useViewer();
  const { partnerType, feedsProgramId } = market.info;
  const offered = programs.filter((p) => p.partnerType === partnerType);
  const missing = feedsProgramId !== null && !offered.some((p) => p.programId === feedsProgramId);
  // Not listed: gone, unless the list itself couldn't be read (then the stored id, as the sheet holds it).
  const gone = missing && programsListed;
  // A type no program covers has nothing to feed, unless one is set by hand.
  if (!coversType(partnerType) && feedsProgramId === null) return null;
  return (
    <div className="min-w-0 rounded-xl bg-surface-2/40 p-3">
      <p className="text-xs font-medium text-ink-3">{COPY.FEEDS_PROGRAM}</p>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <select aria-label={COPY.FEEDS_PROGRAM} aria-describedby={hintId} className={selectClass} value={feedsProgramId ?? ''} disabled={readOnly}
          onChange={(e) => act({ kind: 'updateInfo', patch: { feedsProgramId: e.target.value || null } }, { label: COPY.FEEDS_CHANGED })}>
          <option value="">{COPY.NO_PROGRAM}</option>
          {offered.map((p) => <option key={p.programId} value={p.programId}>{p.title}</option>)}
          {missing && <option value={feedsProgramId}>{gone ? COPY.PROGRAM_GONE : feedsProgramId}</option>}
        </select>
        {feedsProgramId && !missing && (
          <Link href={`/programs/${encodeURIComponent(feedsProgramId)}/why`} className={linkClass}>{COPY.OPEN_PROGRAM}</Link>
        )}
      </div>
      <div id={hintId} className="mt-1 text-xs text-ink-3">
        {gone ? <p className="text-warn">{COPY.PROGRAM_GONE_NOTE}</p> : missing || !programsListed ? null : offered.length === 0 ? (
          <p>
            {COPY.NO_PROGRAM_OF_TYPE(PARTNER_TYPE_LABELS[partnerType])}
            {!viewer && <>{' '}<Link href="/programs/new" className={linkClass}>{COPY.NAV_ADD_PROGRAM}</Link></>}
          </p>
        ) : <p>{COPY.FEEDS_PROGRAM_HINT}</p>}
      </div>
    </div>
  );
}

function HowMarketBuys() {
  const { market, readOnly } = useMarket();
  const set = useSetInfo();
  const { howMarketBuys } = market.info;
  return (
    <FieldRow field="howMarketBuys" empty={false} hint={COPY.HOW_MARKET_BUYS_QUESTION}>
      <select aria-label={fieldLabel('howMarketBuys')} className={selectClass} value={howMarketBuys} disabled={readOnly}
        onChange={(e) => sayIfRefused(set('howMarketBuys', { howMarketBuys: e.target.value as typeof howMarketBuys }))}>
        {HOW_MARKET_BUYS.map((value) => <option key={value} value={value}>{HOW_MARKET_BUYS_LABELS[value]}</option>)}
      </select>
    </FieldRow>
  );
}

function Status() {
  const { market, readOnly } = useMarket();
  const set = useSetInfo();
  const { status } = market.info;
  return (
    <FieldRow field="status" empty={false} hint={COPY.STATUS_HINT}>
      <select aria-label={fieldLabel('status')} className={selectClass} value={status} disabled={readOnly}
        onChange={(e) => sayIfRefused(set('status', { status: e.target.value as typeof status }, COPY.STATUS_CHANGED))}>
        {MARKET_STATUSES.map((value) => <option key={value} value={value}>{MARKET_STATUS_LABELS[value]}</option>)}
      </select>
    </FieldRow>
  );
}

/** The anchor *Find partners with AI* on the Pipeline jumps to (the page scrolls to the address's hash). */
export const SEARCH_PROMPT_ID = 'search-prompt';

/** The Market hypothesis tab: the Market fields, the status and the search prompt. */
export function MarketHypothesisTab() {
  const { issues } = useMarket();
  return (
    <div className="grid gap-4">
      <NeedsAttentionHint messages={marketIssues(issues)} />
      <Section title={COPY.TAB_MARKET_HYPOTHESIS} description={COPY.MARKET_HYPOTHESIS_TEXT}
        actions={<LearnMore href={LINKS.marketHypothesisVsPartnerHypothesis!}>{COPY.MARKET_OR_PARTNER_HYPOTHESIS}</LearnMore>}>
        <div className="grid gap-3 md:grid-cols-2">
          <TextField field="marketName" placeholder={COPY.HINT_MARKET_NAME} />
          <PartnerType />
          <FeedsProgram />
          <TextField field="ourProduct" multiline hint={COPY.HINT_OUR_PRODUCT} />
          <TextField field="ourTargetCustomers" multiline hint={COPY.HINT_TARGET_CUSTOMERS} />
          <TextField field="whyPartnerRoute" multiline />
          <MustHaves />
          <HowMarketBuys />
          <TextField field="howMarketBuysNote" multiline />
          <TextField field="statement" multiline hint={COPY.STATEMENT_HINT} />
          <ExpectedPartners />
        </div>
      </Section>
      <Section title={COPY.STATUS_TITLE} description={COPY.STATUS_TEXT}>
        <div className="grid gap-3 md:grid-cols-2">
          <Status />
          <TextField field="statusNote" />
        </div>
      </Section>
      <div id={SEARCH_PROMPT_ID} className="scroll-mt-4">
        <Section title={COPY.FIND_WITH_AI} description={COPY.FIND_WITH_AI_TEXT}>
          <SearchPrompt hypothesisId={null} />
        </Section>
      </div>
    </div>
  );
}

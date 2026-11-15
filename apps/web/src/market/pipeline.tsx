'use client';

// The market's partners come from the Partner book through their market links, by Recruitment step plus a Signed lane, and
// adding one by hand runs the import's duplicate check (task 3's `duplicateOf`).
import { marketDisplayName, newId, type PartnerChange } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { Plus, Sparkles, Upload } from 'lucide-react';
import Link from 'next/link';
import { useId, useRef, useState, type ReactNode } from 'react';
import { partnerHref } from '@/partner/partner-model';
import { duplicateOf, newPartnerChanges, otherTypeMessage, sameTypeMessage } from '@/partners/partners-model';
import { Button, buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { Section } from '@/ui/pieces';
import { ImportDialog } from './import-dialog';
import { useMarket } from './market-context';
import { SEARCH_PROMPT_ID } from './market-hypothesis';
import { marketPartners, pipelineOf, type HypothesisFilter } from './market-model';
import { CompaniesProposals, type CompaniesProposal } from './market-proposals';
import { PartnerCard } from './partner-card';

/**
 * *Add a partner*: company and website, for this market's partner type. Enter adds and keeps the form open for the next
 * one; Escape closes. A company the book has as the same type gets this market. Another type is added to that
 * company. A company on this market's Exclusions is added only after the person confirms.
 */
function AddPartner({ onClose }: { onClose: () => void }) {
  const { market, book, marketId, partners } = useMarket();
  const [company, setCompany] = useState('');
  const [website, setWebsite] = useState('');
  // Each field's error shows under that field; a refusal that names no field shows under Company.
  const [errors, setErrors] = useState<{ company?: string; website?: string }>({});
  const companyRef = useRef<HTMLInputElement>(null);
  const companyErrorId = useId();
  const websiteErrorId = useId();
  const { partnerType } = market.info;
  const name = marketDisplayName(market.info);
  const duplicate = duplicateOf(book, { company, website, partnerType, marketId }, market.exclusions);

  const reset = () => {
    setCompany('');
    setWebsite('');
    setErrors({});
    companyRef.current?.focus();
  };
  /** `anyway`: the person pressed Add anyway for a company on the Exclusions. Enter alone never adds one. */
  const add = (anyway = false) => {
    if (company.trim() === '') return setErrors({ company: COPY.REQUIRED(COPY.FIELD_COMPANY) });
    if (duplicate?.kind === 'same_type') return;
    if (duplicate?.kind === 'exclusion' && !anyway) return;
    const partnerId = newId('partner');
    // The company (or the one already here, its empty facts filled), the type and the link.
    const changes: PartnerChange[] = newPartnerChanges(book, { company, website }, partnerType, partnerId);
    changes.push({ kind: 'add', entity: 'marketLink', values: { partnerId, marketId, hypothesisId: null } });
    // A refused add keeps the form and says why. One batch, so the company, the type and the link save together.
    const outcome = partners.dispatchMany(changes, { marketId }, { label: COPY.PARTNER_ADDED });
    if (!outcome.ok) {
      const { company: onCompany, website: onWebsite } = outcome.fieldErrors ?? {};
      return setErrors(onCompany || onWebsite ? { company: onCompany, website: onWebsite } : { company: outcome.message });
    }
    reset();
  };
  const addToIt = () => {
    if (duplicate?.kind !== 'same_type') return;
    void partners.apply(
      { kind: 'add', entity: 'marketLink', values: { partnerId: duplicate.partner.id, marketId, hypothesisId: null } },
      { label: COPY.MARKET_ADDED_TO_PARTNER(name) },
    );
    reset();
  };

  return (
    <form aria-label={COPY.NEW_PARTNER} className="mb-4 grid gap-2 rounded-xl bg-surface-2/60 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start"
      onSubmit={(e) => { e.preventDefault(); add(); }}
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}>
      <label className="grid gap-1 text-xs font-medium text-ink-3">
        {COPY.FIELD_COMPANY}
        <input ref={companyRef} autoFocus value={company} className={controlClass} aria-invalid={errors.company ? true : undefined}
          aria-describedby={errors.company ? companyErrorId : undefined} onChange={(e) => { setCompany(e.target.value); setErrors(({ website: onWebsite }) => ({ website: onWebsite })); }} />
        {errors.company && <span id={companyErrorId} className="font-normal text-danger">{errors.company}</span>}
      </label>
      <label className="grid gap-1 text-xs font-medium text-ink-3">
        {COPY.FIELD_WEBSITE}
        <input value={website} placeholder="https://" className={controlClass} aria-invalid={errors.website ? true : undefined}
          aria-describedby={errors.website ? websiteErrorId : undefined} onChange={(e) => { setWebsite(e.target.value); setErrors(({ company: onCompany }) => ({ company: onCompany })); }} />
        {errors.website && <span id={websiteErrorId} className="font-normal text-danger">{errors.website}</span>}
      </label>
      <div className="flex gap-2 sm:mt-5">
        {duplicate?.kind === 'exclusion' && (
          <Button variant="primary" size="sm" className="h-9" onClick={() => add(true)}>{COPY.ADD_ANYWAY}</Button>
        )}
        {duplicate?.kind !== 'same_type' && duplicate?.kind !== 'exclusion' && (
          <Button type="submit" variant="primary" size="sm" className="h-9">{COPY.ADD}</Button>
        )}
        <Button variant="ghost" size="sm" className="h-9" onClick={onClose}>{COPY.CANCEL}</Button>
      </div>
      {duplicate && (
        <div role="status" className="grid gap-2 rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn sm:col-span-3">
          {duplicate.kind === 'same_type' ? (
            <>
              <p>{sameTypeMessage(duplicate)}</p>
              {duplicate.linked && <p>{COPY.ALREADY_IN_THIS_MARKET(name)}</p>}
              <div className="flex flex-wrap gap-2">
                {!duplicate.linked && <Button size="sm" variant="primary" onClick={addToIt}>{COPY.ADD_MARKET_TO_IT(name)}</Button>}
                <OpenIt id={partners.savedIdFor(duplicate.partner.accountId)} type={duplicate.partner.partnerType} />
              </div>
            </>
          ) : (
            <p>{duplicate.kind === 'other_type' ? otherTypeMessage(duplicate, partnerType) : COPY.ON_EXCLUSIONS(duplicate.company)}</p>
          )}
        </div>
      )}
    </form>
  );
}

/** *Open it* for a company found by the duplicate check; while its add is still being saved, "Saving…" in its place. */
function OpenIt({ id, type }: { id: string | null; type: string }) {
  if (id === null) return <span className="inline-flex h-8 items-center text-xs text-ink-3">{COPY.SAVING}</span>;
  return <Link href={partnerHref(id, type)} className={buttonVariants({ size: 'sm' })}>{COPY.OPEN_IT}</Link>;
}

/**
 * The Pipeline tab: this market's partners, by step in columns on a desktop and as one list on a phone, and the
 * signed ones in their own lane. Closed and exited partners are hidden unless *Show closed* is on.
 */
export function Pipeline() {
  const { market, book, marketId, readOnly, openTab } = useMarket();
  const [showClosed, setShowClosed] = useState(false);
  const [hypothesis, setHypothesis] = useState<HypothesisFilter>('all');
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  // An agent's new partners proposal under review in the import preview.
  const [reviewing, setReviewing] = useState<CompaniesProposal | null>(null);
  const { lanes, hiddenClosed } = pipelineOf(book, marketId, { showClosed, hypothesis });
  const empty = marketPartners(book, marketId).length === 0;

  return (
    <Section title={COPY.TAB_PIPELINE} description={COPY.PIPELINE_TEXT}
      actions={(
        <div className="flex flex-wrap gap-2">
          {!readOnly && (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {COPY.ADD_PARTNER}
            </Button>
          )}
          {/* The search prompt is one click away, and its answer comes back in through *Import AI results*. */}
          <a href={`?tab=hypothesis#${SEARCH_PROMPT_ID}`} className={buttonVariants({ size: 'sm' })}
            onClick={(e) => { e.preventDefault(); openTab('hypothesis', SEARCH_PROMPT_ID); }}>
            <Sparkles className="h-4 w-4" aria-hidden />
            {COPY.FIND_WITH_AI}
          </a>
          {!readOnly && (
            <Button size="sm" onClick={() => setImporting(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              {COPY.IMPORT_AI_RESULTS}
            </Button>
          )}
        </div>
      )}>
      <ImportDialog open={importing && !readOnly} onOpenChange={setImporting} />
      {reviewing && !readOnly && (
        <ImportDialog key={reviewing.proposalId} open proposal={reviewing} onOpenChange={(open) => { if (!open) setReviewing(null); }} />
      )}
      <CompaniesProposals onReview={setReviewing} reviewing={reviewing?.proposalId ?? null} />
      {adding && !readOnly && <AddPartner onClose={() => setAdding(false)} />}

      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={showClosed} onChange={(e) => setShowClosed(e.target.checked)} className="h-4 w-4 accent-brand-strong" />
          {COPY.SHOW_CLOSED}
        </label>
        {hiddenClosed > 0 && <span className="text-xs text-ink-3">{COPY.CLOSED_HIDDEN(hiddenClosed)}</span>}
        <select aria-label={COPY.FILTER_HYPOTHESIS} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)}
          className={cn(controlClass, 'w-auto max-w-full')}>
          <option value="all">{COPY.ALL_HYPOTHESES}</option>
          <option value="none">{COPY.NO_HYPOTHESIS_FILTER}</option>
          {market.hypotheses.map((h) => <option key={h.id} value={h.id}>{h.name || COPY.UNTITLED_HYPOTHESIS}</option>)}
        </select>
      </div>

      {empty ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-ink-3">{COPY.PIPELINE_EMPTY}</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-[repeat(5,minmax(10.5rem,1fr))] md:overflow-x-auto md:pb-1">
          {lanes.map(({ lane, title, cards }) => (
            <LaneColumn key={lane} title={title} count={cards.length}>
              {cards.map((card) => <PartnerCard key={card.partner.id} card={card} />)}
            </LaneColumn>
          ))}
        </div>
      )}
    </Section>
  );
}

/** One lane: a column on a desktop; on a phone a group of the list, left out when empty. */
function LaneColumn({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cn('min-w-0 rounded-xl bg-surface-2/60 p-2', count === 0 && 'hidden md:block')}>
      <div className="mb-2 flex items-baseline justify-between gap-2 px-1">
        <h3 id={id} className="text-xs font-semibold text-ink-2">{title}</h3>
        <span className="text-xs text-ink-3">{count}</span>
      </div>
      {count > 0 ? <ul className="grid gap-2">{children}</ul> : <p className="px-1 pb-1 text-xs text-ink-3">{COPY.BOARD_EMPTY_COLUMN}</p>}
    </section>
  );
}

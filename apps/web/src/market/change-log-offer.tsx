'use client';

// The calls are those with this market's partners, from the Partner book, and the words come from COPY.
import type { ApplyOutcome, ChangeEntity, Market, MarketChange } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { createContext, useContext, useId, useState, type ReactNode } from 'react';
import type { DispatchOptions } from '@/editor/use-editor';
import { today } from '@/partners/partners-model';
import { Button } from '@/ui/button';
import { cn } from '@/ui/cn';
import { controlClass } from '@/ui/control';
import { useMarket } from './market-context';
import { callLabel, changeLogCall, changeSubject, marketCalls } from './market-model';

/** What an edit was about: a Market field (by its key), a value point or a partner hypothesis (by id). */
export interface ChangeAbout {
  entity: ChangeEntity;
  /** Left out for an add: the new row's id is used. */
  id?: string;
}

interface Offer {
  entity: ChangeEntity;
  entityId: string;
  callId: string;
  what: string;
  error: string | null;
}

const OfferContext = createContext<((about: Required<ChangeAbout>) => void) | null>(null);

/**
 * Applies an edit to the market hypothesis, a value point or a partner hypothesis and then, if a call with one of
 * this market's partners was logged in the last 7 days, offers the change log. The offer never blocks: it waits in a
 * corner until saved or skipped. A refused edit is answered as it is, for the field to show.
 */
export function useThinkingEdit(): (change: MarketChange, about: ChangeAbout, options?: DispatchOptions) => ApplyOutcome<Market> {
  const { dispatch } = useMarket();
  const offer = useContext(OfferContext);
  if (!offer) throw new Error('useThinkingEdit must be used inside a ChangeLogOfferProvider');
  return (change, about, options) => {
    const outcome = dispatch(change, options);
    if (outcome.ok) offer({ entity: about.entity, id: about.id ?? outcome.entityId ?? '' });
    return outcome;
  };
}

/**
 * Offers the change log for an edit saved another way (an accepted proposal of a status, agent proposals spec 10.3),
 * as `useThinkingEdit` does after its own: only when a call with one of this market's partners is recent.
 */
export function useChangeLogOffer(): (about: Required<ChangeAbout>) => void {
  const offer = useContext(OfferContext);
  if (!offer) throw new Error('useChangeLogOffer must be used inside a ChangeLogOfferProvider');
  return offer;
}

/** Holds the change log offer for the market page and shows it over the page. */
export function ChangeLogOfferProvider({ children }: { children: ReactNode }) {
  const { book, marketId, readOnly } = useMarket();
  const [offer, setOffer] = useState<Offer | null>(null);

  const offerFor = (about: Required<ChangeAbout>) => {
    const callId = changeLogCall(book, marketId, today());
    if (!callId) return;
    // A note being written stays; otherwise the latest edit is the one asked about.
    setOffer((current) => (current?.what.trim() ? current
      : { entity: about.entity, entityId: about.id, callId, what: '', error: null }));
  };

  return (
    <OfferContext value={offerFor}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-24 z-40 flex justify-end lg:bottom-4 lg:left-auto">
        {offer && !readOnly && <ChangeLogPrompt offer={offer} onChange={setOffer} />}
      </div>
    </OfferContext>
  );
}

function ChangeLogPrompt({ offer, onChange }: { offer: Offer; onChange: (offer: Offer | null) => void }) {
  const { market, book, marketId, dispatch, idFor } = useMarket();
  // A row added a moment ago keeps its local id in the offer; once its add is saved, idFor gives the saved id.
  const entityId = idFor(offer.entityId);
  const headingId = useId();
  const errorId = useId();
  const subject = changeSubject(market, { entity: offer.entity, entityId });
  const skip = () => onChange(null);
  const save = () => {
    const outcome = dispatch({
      kind: 'add',
      entity: 'change',
      values: { date: today(), entity: offer.entity, entityId, what: offer.what.trim(), callId: offer.callId || null },
    }, { label: COPY.CHANGE_LOGGED });
    if (outcome.ok) onChange(null);
    else onChange({ ...offer, error: outcome.fieldErrors?.what ?? outcome.message });
  };

  return (
    <section aria-labelledby={headingId}
      className="pointer-events-auto w-full max-w-sm rounded-xl border border-line bg-surface p-4 shadow-lg"
      onKeyDown={(e) => { if (e.key === 'Escape') skip(); }}>
      <p id={headingId} className="font-semibold">{COPY.CHANGE_LOG_TITLE}</p>
      <p className="mt-0.5 text-xs text-ink-3">
        {subject ? <>{COPY.CHANGE_LOG_ABOUT} <span className="font-medium text-ink-2">{subject}</span>. </> : null}
        {COPY.CHANGE_LOG_TEXT}
      </p>
      <form className="mt-3 grid gap-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <textarea rows={3} aria-label={COPY.CHANGE_LOG_TITLE} value={offer.what}
          aria-invalid={offer.error ? true : undefined} aria-describedby={offer.error ? errorId : undefined}
          placeholder={COPY.CHANGE_LOG_PLACEHOLDER}
          onChange={(e) => onChange({ ...offer, what: e.target.value, error: null })}
          className={cn('w-full min-w-0 rounded-lg border bg-surface px-2.5 py-2 text-sm text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/30',
            offer.error ? 'border-danger' : 'border-line')} />
        {offer.error && <p id={errorId} className="text-xs text-danger">{offer.error}</p>}
        <label className="grid gap-1 text-xs font-medium text-ink-3">
          {COPY.FIELD_CALL}
          <select value={offer.callId} onChange={(e) => onChange({ ...offer, callId: e.target.value })} className={cn(controlClass, 'truncate px-2')}>
            <option value="">{COPY.NO_CALL}</option>
            {marketCalls(book, marketId).map((call) => <option key={call.id} value={call.id}>{callLabel(book, call)}</option>)}
          </select>
        </label>
        <div className="mt-1 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={skip}>{COPY.SKIP}</Button>
          <Button type="submit" variant="primary" size="sm">{COPY.SAVE}</Button>
        </div>
      </form>
    </section>
  );
}

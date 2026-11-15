'use client';

// New for PartnerStandard Desk (reviews spec 5.5, 6): the Reviews area of a partner type's tab, under the MAP area: the next
// review and its date, the held reviews, and the business case against what was actually done, with a chart once two
// reviews are held. Read only; the review itself is a page (/plans/{mapId}/review). Shown to the owner's page only.
import type { CaseAgainstActual, Currency } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { RemoteOutcome } from '@/editor/remote';
import { formatMapDate } from '@/maps/format';
import { formatScore, reviewPath } from '@/reviews/review-model';
import { buttonVariants } from '@/ui/button';
import { cn } from '@/ui/cn';
import { Section } from '@/ui/pieces';
import { useMapArea } from './map-area';
import { usePartner } from './partner-context';
import type { ReviewAreaState } from './review-area-model';
import { ReviewsChart } from './reviews-chart';

export type LoadReviewArea = (input: { partnerId: string }) => Promise<RemoteOutcome<{ state: ReviewAreaState }>>;

type Read = { status: 'loading' } | { status: 'failed'; message: string } | { status: 'ready'; state: ReviewAreaState };

const ReviewAreaContext = createContext<Read | null>(null);

const linkClass = 'rounded font-medium text-brand-strong underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-brand';

/**
 * Reads the open partner type's reviews when the tab opens and when its signing, stage, closing or exit changes (the
 * review's status follows them), or its MAP is started or deleted. The area and the year-to-date line share the one
 * read. Under the MAP area's provider it waits for the MAP's own read: the MAP is then in the read cache, and Google
 * is asked for it once (about 60 reads a minute).
 */
export function ReviewAreaProvider({ load, children }: { load: LoadReviewArea; children: ReactNode }) {
  const { partner } = usePartner();
  const { id: partnerId, signedDate, stage, closed, exitedDate } = partner;
  const map = useMapArea()?.map ?? null;
  const mapLoading = map?.status === 'loading';
  const mapKey = map?.status === 'ready' ? (map.state.kind === 'none' ? 'none' : map.state.mapId) : 'unknown';
  const key = [partnerId, signedDate, stage, closed, exitedDate, mapKey].join('|');
  const [read, setRead] = useState<{ key: string; value: Read } | null>(null);
  const value: Read = read?.key === key ? read.value : { status: 'loading' };

  useEffect(() => {
    if (mapLoading) return;
    let live = true;
    const show = (next: Read) => { if (live) setRead({ key, value: next }); };
    load({ partnerId })
      .then((answer) => show(answer.ok ? { status: 'ready', state: answer.state } : { status: 'failed', message: answer.message }))
      .catch(() => show({ status: 'failed', message: COPY.ACTION_FAILED }));
    return () => { live = false; };
  }, [load, partnerId, key, mapLoading]);

  return <ReviewAreaContext.Provider value={value}>{children}</ReviewAreaContext.Provider>;
}

/** Money whole, with the case's sign, or without one when its currency isn't known (as the review page). */
const moneyOf = (n: number, currency: Currency | null): string => formatScore('weBill', n, currency);

/** The deals, rounded: a forecast counts parts of deals. */
const deals = (n: number): string => String(Math.round(n));

const date = (iso: Parameters<typeof formatMapDate>[0], today: Parameters<typeof formatMapDate>[1]) => formatMapDate(iso, today);

/** The Reviews area. */
export function ReviewArea() {
  const read = useContext(ReviewAreaContext);
  if (!read) return null;
  const state = read.status === 'ready' ? read.state : null;
  return (
    <Section title={COPY.REVIEW_AREA_TITLE} description={COPY.REVIEW_AREA_TEXT}>
      <div className="grid gap-4">
        {read.status === 'loading' && <p aria-busy="true" className="text-sm text-ink-3">{COPY.REVIEW_AREA_LOADING}</p>}
        {read.status === 'failed' && <p role="alert" className="text-sm text-danger">{read.message}</p>}
        {state?.kind === 'none' && <p className="text-sm text-ink-3">{COPY.REVIEW_AREA_NEEDS_MAP}</p>}
        {state?.kind === 'unread' && <p role="alert" className="text-sm text-warn">{state.message}</p>}
        {state?.kind === 'ready' && <Ready state={state} />}
      </div>
    </Section>
  );
}

function Ready({ state }: { state: Extract<ReviewAreaState, { kind: 'ready' }> }) {
  const { mapId, today, next, held, caseAgainstActual, currency } = state;
  return (
    <>
      <div className="grid gap-1.5">
        <h3 className="text-sm font-semibold">{COPY.REVIEW_NEXT_REVIEW}</h3>
        {next.kind === 'none' && <p className="text-sm text-ink-3">{COPY.REVIEW_NOT_NOW}</p>}
        {next.kind !== 'none' && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-sm text-ink-2">{COPY.REVIEW_ON(date(next.date, today))}</p>
            {next.kind === 'overdue' && <p className="text-sm font-medium text-danger">{COPY.MAP_DAYS_OVERDUE(next.daysLate)}</p>}
            {(next.kind !== 'later' || next.prepStarted) && (
              <Link href={reviewPath(mapId)} className={cn(buttonVariants({ size: 'sm' }), 'w-fit')}>
                {next.prepStarted ? COPY.REVIEW_GO_TO : COPY.MAP_PREPARE_REVIEW}
              </Link>
            )}
          </div>
        )}
      </div>
      <div className="grid gap-1.5">
        <h3 className="text-sm font-semibold">{COPY.REVIEW_AREA_HELD_TITLE}</h3>
        {held.length === 0 && <p className="text-sm text-ink-3">{COPY.REVIEW_AREA_NO_HELD}</p>}
        {held.length > 0 && (
          <ul className="divide-y divide-line">
            {held.map((r) => (
              <li key={r.reviewId} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2 text-sm">
                <span className="min-w-0">
                  {COPY.REVIEW_AREA_HELD_LINE(r.horizon, r.heldOn ? date(r.heldOn, today) : '')}
                  {r.answers && r.answers.length > 0 && (
                    <span className="text-ink-3">{` · ${COPY.REVIEW_AREA_HYPOTHESIS_ANSWERS}: ${r.answers.map((a) => COPY.REVIEW_ANSWER_LABELS[a]).join(', ')}`}</span>
                  )}
                </span>
                <Link href={reviewPath(mapId, r.reviewId)} className={linkClass}>{COPY.REVIEW_AREA_OPEN}</Link>
              </li>
            ))}
          </ul>
        )}
      </div>
      {caseAgainstActual && <CaseAgainstActualTable data={caseAgainstActual} currency={currency} today={today} />}
    </>
  );
}

function CaseAgainstActualTable({ data, currency, today }: { data: CaseAgainstActual; currency: Currency | null; today: Parameters<typeof formatMapDate>[1] }) {
  const money = (n: number) => moneyOf(n, currency);
  const pair = (actual: number, target: number, show: (n: number) => string) => `${show(actual)} / ${show(target)}`;
  const { rows } = data;
  return (
    <div className="grid gap-3">
      <h3 className="text-sm font-semibold">{COPY.REVIEW_CASE_AGAINST_ACTUAL}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <thead className="text-xs tracking-wide text-ink-3 uppercase">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">{COPY.REVIEW_HELD_REVIEW}</th>
              <th scope="col" className="pr-3 font-medium">{COPY.REVIEW_NUMBER_LABELS.dealsWon}</th>
              <th scope="col" className="pr-3 font-medium">{COPY.REVIEW_NUMBER_LABELS.weBill}</th>
              <th scope="col" className="font-medium">{COPY.REVIEW_NUMBER_LABELS.partnerEarns}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            <tr>
              <th scope="row" className="py-2 pr-3 font-medium">{COPY.REVIEW_SINCE_SIGNING}</th>
              <td className="py-2 pr-3">{pair(data.toDate.actual.deals, data.toDate.forecast.deals, deals)}</td>
              <td className="py-2 pr-3">{pair(data.toDate.actual.weBill, data.toDate.forecast.weBill, money)}</td>
              <td className="py-2">{pair(data.toDate.actual.partnerEarns, data.toDate.forecast.partnerEarns, money)}</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.reviewId}>
                <th scope="row" className="py-2 pr-3 font-normal">{COPY.REVIEW_HELD_ON(date(r.heldOn, today))}</th>
                <td className="py-2 pr-3">{pair(r.actual.deals, r.target.deals, deals)}</td>
                <td className="py-2 pr-3">{pair(r.actual.weBill, r.target.weBill, money)}</td>
                <td className="py-2">{pair(r.actual.partnerEarns, r.target.partnerEarns, money)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">{COPY.REVIEW_ACTUAL} / {COPY.REVIEW_FORECAST}</p>
      {rows.length >= 2 && (
        <ReviewsChart currency={currency} today={today}
          reviews={rows.map((r) => ({ reviewId: r.reviewId, heldOn: r.heldOn, billed: r.actual.weBill, target: r.target.weBill }))} />
      )}
    </div>
  );
}

/** The case against actual in one line: since signing, deals and what we billed, against the business case. Nothing without a case. */
export function ReviewToDate() {
  const read = useContext(ReviewAreaContext);
  if (read?.status !== 'ready' || read.state.kind !== 'ready' || !read.state.caseAgainstActual) return null;
  const { caseAgainstActual: { toDate }, currency } = read.state;
  return (
    <p className="text-sm text-ink-2">
      {COPY.REVIEW_TO_DATE(
        deals(toDate.actual.deals), deals(toDate.forecast.deals), moneyOf(toDate.actual.weBill, currency), moneyOf(toDate.forecast.weBill, currency),
      )}
    </p>
  );
}

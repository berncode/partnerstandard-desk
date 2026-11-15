'use client';

// The MAP page is named "Acme as reseller" (spec 5.1) and follows the partner record (spec 5.3): the MAP app's stage
// select, "Agreement signed" and "End recruitment" are not here; the partner page does them. Before signing, the
// onboarding length the MAP app asked at signing is chosen here [builder's call].
import { DEFAULT_HORIZON_DAYS, endedWithoutSigning, HORIZON_LENGTHS, reviewDateOf, summarizeMap } from '@partner-desk/core';
import { MOMENTUM_NEXT_STEPS, PARTNER_TYPE_LABELS, STAGE_LABELS } from '@partner-desk/method';
import { CLOSED_LABELS, COPY } from '@partner-desk/copy';
import { FileSpreadsheet, Presentation } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { buttonVariants } from '@/ui/button';
import { HealthBadge, NotSignedBadge } from '../badges';
import { formatMapDate } from '../format';
import { PillSelect, SaveIndicator } from '../pieces';
import { describeReason, horizonProgress } from '../view-model';
import { usePlan } from './plan-context';
import { StartHorizonButton } from './start-horizon';
import { useCopy, useFileLinkProps } from '@/storage-context';

/** The MAP's header. `actions` are extra controls next to Present (the owner's Share, task 7). */
export function PlanHeader({ fileUrl, presentHref, actions }: { fileUrl: string | null; presentHref: string | null; actions?: ReactNode }) {
  const { plan, today, lastEventAt, dispatch, allowed, saveState, reviewHref } = usePlan();
  const words = useCopy();
  const fileLink = useFileLinkProps();
  const { info } = plan;
  // Core's summary: the one health a MAP has on every screen (ruling R6).
  const { health, reasons } = summarizeMap(plan, today, lastEventAt);
  const progress = horizonProgress(info, today);
  const canEdit = allowed({ kind: 'updateInfo', patch: {} });
  const stalled = reasons.some((r) => r.kind === 'stalled');
  const ended = endedWithoutSigning(info);
  const label = PARTNER_TYPE_LABELS[info.partnerType];
  const heading = info.partnerName ? COPY.PARTNER_AS_TYPE(info.partnerName, label) : label;
  // The review date (reviews spec 5.1): the owner's only, as a link to the review; none before signing or after the exit.
  const reviewDate = reviewHref ? reviewDateOf(info) : null;
  const lengths = (HORIZON_LENGTHS as readonly number[]).includes(info.horizonDays) ? HORIZON_LENGTHS : [...HORIZON_LENGTHS, info.horizonDays];

  return (
    <header className="rounded-xl border border-line bg-surface p-4">
      {/* The toolbar has a row of its own, so the title keeps the full width whichever buttons the plan's phase shows. */}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="text-xs font-medium tracking-wider text-ink-3 uppercase">{COPY.MAP_TITLE}</p>
        <div className="flex flex-wrap items-center gap-2">
          <SaveIndicator state={saveState} />
          {fileUrl && (
            <a href={fileUrl} {...fileLink} className={buttonVariants({ size: 'sm' })}>
              <FileSpreadsheet className="h-4 w-4" aria-hidden />
              {words.MAP_OPEN_SHEET}
            </a>
          )}
          {actions}
          <StartHorizonButton phase={progress.phase} />
          {presentHref && (
            <Link href={presentHref} className={buttonVariants({ size: 'sm' })}>
              <Presentation className="h-4 w-4" aria-hidden />
              {COPY.MAP_PRESENT}
            </Link>
          )}
        </div>
      </div>
      <h1 className="mt-2 text-xl font-semibold tracking-tight break-words sm:text-2xl">{heading}</h1>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        {health === null ? <NotSignedBadge /> : <HealthBadge health={health} />}
        <span className="text-ink-3">{STAGE_LABELS[info.stage]}</span>
        {reviewDate && reviewHref && (
          <Link href={reviewHref} className="font-medium text-brand-strong underline-offset-2 hover:underline">
            {COPY.REVIEW_ON(formatMapDate(reviewDate, today))}
          </Link>
        )}
      </div>

      {progress.phase === 'recruitment' ? (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          {ended ? (
            <p className="min-w-0 text-sm text-ink-2">
              <span className="font-medium text-ink">{COPY.MAP_ENDED_AS(CLOSED_LABELS[info.closed!])}</span>
              {info.closedReason && <span className="break-words"> · {info.closedReason}</span>}
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-ink-3">
              <span className="font-medium text-ink-2">{COPY.MAP_BEFORE_SIGNING_LINE}</span>
              {canEdit ? (
                <PillSelect
                  label={COPY.MAP_ONBOARDING_LENGTH}
                  value={String(info.horizonDays)}
                  options={lengths.map((d) => [String(d), COPY.GUIDED_HORIZON_DAYS(d, d === DEFAULT_HORIZON_DAYS)] as const)}
                  onChange={(days) => dispatch({ kind: 'updateInfo', patch: { horizonDays: Number(days) } }, { label: COPY.MAP_CHANGED.onboardingLengthChanged })}
                />
              ) : (
                <span>{COPY.MAP_ONBOARDING_PLANNED(info.horizonDays)}</span>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="mt-5">
          <div className="flex flex-wrap justify-between gap-x-2 text-xs text-ink-3">
            <span className="font-medium text-ink-2">{progress.label}</span>
            <span>{formatMapDate(info.startDate, today)} – {formatMapDate(progress.endDate, today)}</span>
          </div>
          <div
            role="progressbar"
            aria-label={COPY.MAP_PLAN_HORIZON}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={Math.min(progress.day, progress.total)}
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2"
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
          </div>
        </div>
      )}

      {reasons.length > 0 && (
        <ul className="mt-4 space-y-1 text-sm text-ink-2">
          {reasons.map((reason) => (
            <li key={JSON.stringify(reason)} className="flex items-start gap-2">
              <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-warn" />
              <span className="break-words">{describeReason(plan, reason)}</span>
            </li>
          ))}
          {stalled && <li className="pl-3 text-ink-3">{COPY.MAP_TRY_THIS(MOMENTUM_NEXT_STEPS[0]!)}</li>}
        </ul>
      )}
    </header>
  );
}

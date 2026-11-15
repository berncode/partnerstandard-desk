'use client';

// The review page (reviews spec 5.2): one partnership's review at the end of a horizon, in the five areas of the
// Operating Model, then Decisions and the next horizon's length. Saved as you type through the MAP page's editor
// (`usePlanEditor`), with its undo and its conflict prompt. Before prep it shows the date, to change, and Start the prep.
import type { ReviewRead } from '@partner-desk/commands';
import {
  currentHorizon, HORIZON_LENGTHS, localTime, reviewDateOf, stageSuggestion, type IsoDate, type MapActor, type MapChange,
  type ReviewItemKind, type ReviewNumber, type ScoreKey,
} from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY } from '@partner-desk/copy';
import { Presentation } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ReconnectBanner } from '@/editor/reconnect-banner';
import { Button, buttonVariants } from '@/ui/button';
import { formatMapDate, ourSideName } from '@/maps/format';
import { InlineText } from '@/maps/components/inline-text';
import type { Notify } from '@/maps/notify';
import { DateField, fieldControl, Section, SaveIndicator } from '@/maps/pieces';
import type { MapSnapshot, PlanRemote, RemoteResult } from '@/maps/remote';
import { usePlanEditor } from '@/maps/use-plan-editor';
import { BlockersArea } from './blockers-area';
import { CloseDialog } from './close-dialog';
import { HypothesisArea } from './hypothesis-area';
import { NextArea } from './next-area';
import { RelationshipArea } from './relationship-area';
import { ResultsArea } from './results-area';
import { ReviewContext, useReview, type ReviewContextValue } from './review-context';
import { SendSummary } from './send-summary';
import { reviewPath, reviewPresentPath, type ReviewActions } from './review-model';
import type { StorageKind } from '@/storage-kind';
import { useViewer } from '@/storage-context';

const OWNER: MapActor = { kind: 'owner' };

export interface ReviewPageProps {
  mapId: string;
  /** The review as `readReview` gave it: the current horizon's prep, a held review, or none before prep. */
  read: ReviewRead;
  /** The MAP as `readMap` gave it: what the page's editor saves to. Referentially stable. */
  initial: MapSnapshot;
  today: IsoDate;
  /** The owner's timezone (Settings): the day a summary was sent is their day. Europe/Berlin when not given. */
  timeZone?: string;
  actorName: string;
  ourName: string;
  ownerName: string;
  /** The partner's page, for the stage suggestion after the first review; null when its partner type is gone. */
  partnerHref: string | null;
  /** The link back to the partnership. */
  back: ReactNode;
  actions: ReviewActions;
  notify?: Notify;
  /** Where the owner's files are: a Google account gets the Reconnect Google button, a test account none. */
  storage: StorageKind;
}

export function ReviewPage(props: ReviewPageProps) {
  const { read } = props;
  return (
    <div data-testid="review-page" className="grid w-full gap-4">
      {props.back}
      {read.review ? <PrepPage {...props} reviewId={read.review.id} /> : <BeforePrep {...props} />}
    </div>
  );
}

/** "Review · Acme as reseller · horizon 2". */
function headingOf(read: ReviewRead, horizon: number): string {
  const label = PARTNER_TYPE_LABELS[read.partnerType];
  return COPY.REVIEW_HEADER(read.partnerName ? COPY.PARTNER_AS_TYPE(read.partnerName, label) : label, horizon);
}

/**
 * Before prep: the review's date, which can be changed already (it is the MAP's "Next review", no prep needed), and one
 * button, Start the prep (nothing else is written until then, spec 5.1).
 */
function BeforePrep({ mapId, read, today, actions }: ReviewPageProps) {
  const router = useRouter();
  const [state, setState] = useState<{ kind: 'idle' | 'busy' } | { kind: 'failed'; message: string }>({ kind: 'idle' });
  // The date just saved, shown until the page reads the review again (a new read).
  const [saved, setSaved] = useState<{ value: IsoDate | null; on: ReviewRead } | null>(null);
  const [dateError, setDateError] = useState<string | null>(null);
  // A company server's viewer reads the date, with no way to change it or start the prep (owner, 2026-11-14).
  const viewer = useViewer();
  const pending = saved?.on === read ? saved : null;
  const stored = pending ? pending.value : read.info.nextReviewDate;
  const date = read.status.kind === 'none' ? null : pending ? reviewDateOf({ ...read.info, nextReviewDate: pending.value }) : read.status.date;
  const start = async () => {
    setState({ kind: 'busy' });
    const out = await actions.open({ mapId });
    if (!out.ok) {
      setState({ kind: 'failed', message: out.message });
      return;
    }
    router.refresh();
  };
  const changeDate = async (nextReviewDate: IsoDate | null) => {
    setDateError(null);
    try {
      const out = await actions.change({ mapId, change: { kind: 'updateInfo', patch: { nextReviewDate } } });
      if (!out.ok) {
        setDateError(Object.values(out.fieldErrors ?? {})[0] ?? out.message);
        return;
      }
    } catch {
      setDateError(COPY.ACTION_FAILED);
      return;
    }
    setSaved({ value: nextReviewDate, on: read });
    router.refresh();
  };
  return (
    <header className="rounded-xl border border-line bg-surface p-4">
      <p className="text-xs font-medium tracking-wider text-ink-3 uppercase">{COPY.REVIEW_TITLE}</p>
      <h1 className="mt-2 text-xl font-semibold tracking-tight break-words sm:text-2xl">{headingOf(read, currentHorizon(read.info))}</h1>
      {date === null ? (
        <p className="mt-3 text-sm text-ink-2">{COPY.REVIEW_NOT_NOW}</p>
      ) : (
        <>
          <div className="mt-3 text-sm font-medium text-ink-2">
            {viewer
              ? <span>{COPY.REVIEW_DATE}: {formatMapDate(date, today)}</span>
              : <ReviewDateField value={stored} display={formatMapDate(date, today)} onChange={(next) => void changeDate(next)} />}
            {dateError && <p role="alert" className="mt-1 text-xs font-normal text-danger">{dateError}</p>}
          </div>
          <p className="mt-1 max-w-prose text-sm text-ink-3">{COPY.REVIEW_PREP_TEXT}</p>
          {!viewer && (
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <Button variant="primary" disabled={state.kind === 'busy'} aria-busy={state.kind === 'busy'} onClick={() => void start()}>
                {COPY.REVIEW_START_PREP}
              </Button>
              {state.kind === 'failed' && <p role="alert" className="text-sm text-danger">{state.message}</p>}
            </div>
          )}
        </>
      )}
    </header>
  );
}

function PrepPage({
  mapId, read, initial, today, timeZone = 'Europe/Berlin', actorName, ourName, ownerName, partnerHref, actions, notify, storage, reviewId,
}: ReviewPageProps & { reviewId: string }) {
  const router = useRouter();
  const remote = useCallback<PlanRemote>(
    (change) => new Promise<RemoteResult>((resolve, reject) => {
      startTransition(async () => {
        try {
          resolve(await actions.change({ mapId, change }));
        } catch (error) {
          reject(error);
        }
      });
    }),
    [actions, mapId],
  );
  const editor = usePlanEditor({ initial, remote, actor: OWNER, actorName, showsReconnect: true, ...(notify ? { notify } : {}) });
  const { plan, dispatch, saveState, failures, needsGoogle } = editor;
  // A company server's viewer reads the review and changes nothing, as on the MAP page: no Close or Send summary
  // (owner, 2026-11-14).
  const viewer = useViewer();
  const [errors, setErrors] = useState<Record<string, string>>({});
  // A business case picked: the targets come from it once it is saved, so the page reads the review again.
  const refreshWhenSaved = useRef(false);
  useEffect(() => {
    if (!refreshWhenSaved.current || saveState === 'saving') return;
    refreshWhenSaved.current = false;
    router.refresh();
  }, [saveState, router]);

  const review = plan.reviews.find((r) => r.id === reviewId) ?? null;
  const value = useMemo((): ReviewContextValue | null => {
    if (!review) return null;
    const numberOf = (key: ScoreKey): ReviewNumber | null =>
      plan.reviewNumbers.find((n) => n.reviewId === review.id && n.key === key) ?? null;
    const targetOf = (key: ScoreKey) => numberOf(key)?.target ?? read.targets[key] ?? null;
    const clear = (id: string) => setErrors((all) => {
      if (!(id in all)) return all;
      const rest = { ...all };
      delete rest[id];
      return rest;
    });
    return {
      mapId, read, plan, review, held: review.state === 'held', today, errors,
      names: { ours: ourSideName(ourName, ownerName), partner: plan.info.partnerName },
      dispatch,
      items: (kind: ReviewItemKind) => plan.reviewItems.filter((i) => i.reviewId === review.id && i.kind === kind),
      number: numberOf,
      targetOf,
      setNumber: (key, patch) => {
        const row = numberOf(key);
        if (row) return dispatch({ kind: 'update', entity: 'reviewNumber', id: row.id, patch });
        // A new number keeps the target it was checked against (spec 5.3, point 5: a snapshot).
        return dispatch({ kind: 'add', entity: 'reviewNumber', values: { reviewId: review.id, key, target: targetOf(key), ...patch } });
      },
      setItem: (id, patch) => {
        clear(id);
        return dispatch({ kind: 'update', entity: 'reviewItem', id, patch });
      },
      addItem: (kind, values) => dispatch({ kind: 'add', entity: 'reviewItem', values: { reviewId: review.id, kind, ...values } }),
    };
  }, [review, plan, read, mapId, today, errors, ourName, ownerName, dispatch]);

  if (!value || !review) {
    return <p role="alert" className="rounded-xl border border-warn/30 bg-warn-soft p-3 text-sm text-warn">{COPY.GONE}</p>;
  }
  const isCurrent = review.state === 'prep' && review.horizon === currentHorizon(plan.info) && read.status.kind !== 'none';
  const suggestion = review.state === 'held' ? stageSuggestion(plan.info.stage, review.horizon) : null;

  const changeReview = (patch: Record<string, unknown>, label?: string) =>
    dispatch({ kind: 'update', entity: 'review', id: review.id, patch } satisfies MapChange, label ? { label } : {});

  return (
    <ReviewContext value={value}>
      {(needsGoogle || viewer) && <ReconnectBanner next={reviewPath(mapId, review.state === 'held' ? review.id : null)} storage={storage} />}
      {/* After a save needed Google again nothing on the review can be changed, as on the MAP page (question 16). */}
      <fieldset disabled={needsGoogle || viewer} className="grid min-w-0 gap-4">
        <header className="rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <p className="text-xs font-medium tracking-wider text-ink-3 uppercase">{COPY.REVIEW_TITLE}</p>
            <div className="flex flex-wrap items-center gap-2">
              <SaveIndicator state={saveState} />
              {review.state === 'held' && !viewer && <SendSummary actions={actions} />}
              <Link href={reviewPresentPath(mapId, review.state === 'held' ? review.id : null)} className={buttonVariants({ size: 'sm' })}>
                <Presentation className="h-4 w-4" aria-hidden />
                {COPY.MAP_PRESENT}
              </Link>
            </div>
          </div>
          <h1 className="mt-2 text-xl font-semibold tracking-tight break-words sm:text-2xl">{headingOf(read, review.horizon)}</h1>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-ink-2">
            {review.state === 'held' && review.heldOn ? (
              <>
                <span className="font-medium">{COPY.REVIEW_HELD_ON(formatMapDate(review.heldOn, today))}</span>
                {review.summarySentAt && (
                  <span className="rounded-full bg-brand-soft px-2.5 py-1 text-xs font-semibold text-brand-strong">
                    {COPY.REVIEW_SUMMARY_SENT_ON(formatMapDate(localTime(new Date(review.summarySentAt), timeZone).date, today))}
                  </span>
                )}
                {review.summarySentAt && review.summarySentTo.trim() && (
                  <span className="min-w-0 break-words text-xs">{COPY.REVIEW_SUMMARY_SENT_TO(review.summarySentTo.trim())}</span>
                )}
              </>
            ) : (
              <>
                <span className="rounded-full bg-surface-2 px-2.5 py-1 text-xs font-semibold">{COPY.REVIEW_PREP_STARTED}</span>
                <ReviewDate />
              </>
            )}
          </div>
          {read.caseOptions.length > 0 && (
            <label className="mt-4 grid max-w-md gap-1 text-xs font-medium text-ink-3">
              {COPY.REVIEW_CASE}
              <select className={fieldControl} value={read.case?.caseId ?? ''} disabled={review.state === 'held'}
                onChange={(e) => {
                  const outcome = changeReview({ caseId: e.target.value || null });
                  if (outcome.ok) refreshWhenSaved.current = true;
                }}>
                {read.caseOptions.map((c) => <option key={c.caseId} value={c.caseId}>{c.title}</option>)}
              </select>
            </label>
          )}
          {review.state === 'held' && (
            <div role="note" className="mt-4 space-y-1 rounded-xl bg-surface-2/60 p-3 text-sm text-ink-2">
              <p>{COPY.REVIEW_HELD_NOTE}</p>
              {suggestion === 'growth' && partnerHref && (
                <p><Link href={partnerHref} className="font-medium text-brand-strong underline-offset-2 hover:underline">{COPY.REVIEW_SUGGEST_GROWTH(read.partnerName)}</Link></p>
              )}
            </div>
          )}
        </header>

        <ResultsArea />
        <HypothesisArea />
        <NextArea />
        <BlockersArea />
        <RelationshipArea />

        <Section title={COPY.REVIEW_DECISIONS}>
          <InlineText value={review.decisions} label={COPY.REVIEW_DECISIONS} field="decisions" multiline placeholder={COPY.REVIEW_DECISIONS_PLACEHOLDER}
            className="text-sm" onCommit={(decisions) => changeReview({ decisions }, COPY.MAP_CHANGED.noteSaved)} />
          <NextHorizon disabled={review.state === 'held'} onChange={(days) => changeReview({ nextHorizonDays: days })} />
        </Section>

        {isCurrent && !viewer && (
          <CloseBar reviewId={review.id} actions={actions} saveState={saveState} failures={failures} onErrors={setErrors} partnerHref={partnerHref} />
        )}
      </fieldset>
    </ReviewContext>
  );
}

/** The review's date: the MAP's "Next review", or the horizon's last day while it is empty (spec 5.1). */
function ReviewDate() {
  const { plan, today, dispatch } = useReview();
  const date = reviewDateOf(plan.info);
  if (date === null) return null;
  return (
    <ReviewDateField value={plan.info.nextReviewDate} display={formatMapDate(date, today)}
      onChange={(nextReviewDate) => dispatch({ kind: 'updateInfo', patch: { nextReviewDate } }, { label: COPY.REVIEW_DATE_CHANGED })} />
  );
}

/** "Review date: 7 Jan", the MAP's "Next review" to change, before the prep and during it. */
function ReviewDateField({ value, display, onChange }: { value: IsoDate | null; display: string; onChange: (value: IsoDate | null) => void }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{COPY.REVIEW_DATE}:</span>
      <DateField value={value} label={COPY.REVIEW_DATE} display={display} onChange={onChange} />
    </span>
  );
}

/** "Next horizon: 90 days", and the lengths "Start next horizon" offers while the review is open. */
function NextHorizon({ disabled, onChange }: { disabled: boolean; onChange: (days: number) => void }) {
  const { review, errors } = useReview();
  const lengths: readonly number[] = (HORIZON_LENGTHS as readonly number[]).includes(review.nextHorizonDays)
    ? HORIZON_LENGTHS : [...HORIZON_LENGTHS, review.nextHorizonDays];
  const error = errors.nextHorizonDays;
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4 text-sm">
      <p className="font-medium">{COPY.REVIEW_NEXT_HORIZON(review.nextHorizonDays)}</p>
      {!disabled && (
        <select aria-label={COPY.REVIEW_NEXT_HORIZON_LENGTH} aria-invalid={error ? true : undefined} value={String(review.nextHorizonDays)}
          onChange={(e) => onChange(Number(e.target.value))} className={`${fieldControl} w-auto`}>
          {lengths.map((d) => <option key={d} value={d}>{COPY.GUIDED_HORIZON_DAYS(d, false)}</option>)}
        </select>
      )}
      {error && <p role="alert" className="basis-full text-xs text-danger">{error}</p>}
    </div>
  );
}

/**
 * Close the review: its confirmation, then `closeReview` once every change typed so far is saved. Field errors go to
 * their lines on the page; a held-on date's stays in the dialog. After it, the page shows the held review.
 */
function CloseBar({ reviewId, actions, saveState, failures, onErrors, partnerHref }: {
  reviewId: string; actions: ReviewActions; saveState: 'saved' | 'saving' | 'failed'; failures: number;
  onErrors: (errors: Record<string, string>) => void; partnerHref: string | null;
}) {
  const { plan, errors } = useReview();
  const [open, setOpen] = useState(false);
  const hasErrors = Object.keys(errors).some((key) => key !== 'heldOn' && key !== 'reviewId');
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <Button variant="primary" onClick={() => setOpen(true)}>{COPY.REVIEW_CLOSE}</Button>
      {hasErrors && <p role="alert" className="text-sm text-danger">{COPY.FIX_FIELDS}</p>}
      <CloseDialog open={open} onOpenChange={setOpen} reviewId={reviewId} actions={actions} saveState={saveState} failures={failures}
        nextHorizon={currentHorizon(plan.info) + 1} partnerHref={partnerHref} onErrors={onErrors} />
    </div>
  );
}

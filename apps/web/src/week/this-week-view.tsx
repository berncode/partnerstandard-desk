'use client';

// New for PartnerStandard Desk (reviews spec 4.1), laid out as shadcn's dashboard blocks in Recruitment's look: four cards, top
// to bottom. This page only reads; the one write is "Mark done" on a Due line, which goes through the MAP's own change
// (`mapChange`, so `changeMap`), with the MAP's Undo toast and its "Updated elsewhere" message.
import type { WeekProposal } from '@partner-desk/commands';
import type { Activity, IsoDate, ThisWeek } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { COPY, MAP_ACTIVITY_STATUS_LABELS } from '@partner-desk/copy';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { mapChange } from '@/app/(signed-in)/actions/maps';
import { proposalAccept, proposalReject } from '@/app/(signed-in)/actions/proposals';
import { ReconnectBanner } from '@/editor/reconnect-banner';
import { useViewer } from '@/storage-context';
import { formatMapDate } from '@/maps/format';
import { sonnerNotify } from '@/maps/notify';
import { mapPath } from '@/maps/plan-card';
import type { RemoteResult } from '@/maps/remote';
import { isMarketKind, refusalText } from '@/proposals/proposal-model';
import { noteAnswered } from '@/proposals/waiting-store';
import { reviewPath } from '@/reviews/review-model';
import { Button } from '@/ui/button';
import { AppLink, usePreviewPathname } from '@/ui/preview';
import { ProposalLines, type WeekAnswer } from './proposal-lines';
import { describeNeed } from './reasons';
import { Section } from './section';
import { DEFAULT_TIME_ZONE } from '@/ui/dates';
import type { StorageKind } from '@/storage-kind';

type ChangeMap = (input: { mapId: string; change: unknown }) => Promise<RemoteResult>;
type Answered = { ok: true } | { ok: false; error: string; message: string };
/** How This week answers a proposal: the server actions in the app, stand-ins in a preview. */
export interface ProposalAnswers {
  accept: (input: Parameters<typeof proposalAccept>[0]) => Promise<Answered>;
  reject: (input: Parameters<typeof proposalReject>[0]) => Promise<Answered>;
}
const SERVER_ANSWERS: ProposalAnswers = { accept: proposalAccept, reject: proposalReject };

const PATH = '/this-week';

const LINE = 'flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded py-2.5 outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand';

function ReviewLines({ lines, today, limit }: { lines: ThisWeek['reviews']; today: IsoDate; limit: number }) {
  return (
    <ul className="divide-y divide-line">
      {lines.slice(0, limit).map((line) => {
        const summaryOnly = line.daysLeft === null && line.daysLate === null;
        const when = summaryOnly
          ? COPY.REVIEW_HELD_ON(formatMapDate(line.date, today))
          : line.daysLate !== null ? COPY.WEEK_OVERDUE_DAYS(line.daysLate) : COPY.REVIEW_ON(formatMapDate(line.date, today));
        const parts = [when, summaryOnly ? null : line.prep ? COPY.REVIEW_PREP_STARTED : COPY.WEEK_PREP_NOT_STARTED, summaryOnly ? COPY.WEEK_SUMMARY_UNSENT : null];
        return (
          <li key={line.mapId}>
            <AppLink href={summaryOnly && line.heldReviewId ? reviewPath(line.mapId, line.heldReviewId) : reviewPath(line.mapId)} className={LINE}>
              <span className="min-w-0 font-medium break-words">{line.displayName}</span>
              <span className="text-sm text-ink-3">{parts.filter(Boolean).join(' · ')}</span>
            </AppLink>
            {!summaryOnly && line.summaryUnsent && line.heldReviewId && (
              <AppLink href={reviewPath(line.mapId, line.heldReviewId)} className="mb-2 inline-block rounded text-sm text-warn underline outline-none focus-visible:ring-2 focus-visible:ring-brand">
                {COPY.WEEK_SUMMARY_UNSENT}
              </AppLink>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function NeedLines({ lines, titles, limit }: { lines: ThisWeek['needYou']; titles: ReadonlyMap<string, string>; limit: number }) {
  return (
    <ul className="divide-y divide-line">
      {lines.slice(0, limit).map((line) => (
        <li key={line.mapId}>
          <AppLink href={mapPath(line.mapId)} className="block rounded py-2.5 outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand">
            <span className="block font-medium break-words">{line.displayName}</span>
            {line.reasons.length === 0 ? (
              <span className="block text-sm text-warn">{COPY.REVIEWS_CANT_OPEN}</span>
            ) : line.reasons.map((reason, i) => (
              <span key={i} className="block text-sm break-words text-ink-3">{describeNeed(reason, titles)}</span>
            ))}
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

function DueLines({ groups, today, limit, onDone }: {
  groups: ThisWeek['due']; today: IsoDate; limit: number; onDone: ((mapId: string, activity: Activity) => void) | null;
}) {
  // The limit counts activities, not groups: a group is cut where the ten run out.
  const before = groups.map((_, i) => groups.slice(0, i).reduce((n, g) => n + g.activities.length, 0));
  return (
    <div className="grid gap-3">
      {groups.map((group, i) => {
        const shown = group.activities.slice(0, Math.max(0, limit - before[i]!));
        if (shown.length === 0) return null;
        return (
          <div key={group.mapId}>
            <h3 className="text-sm font-semibold break-words"><AppLink href={mapPath(group.mapId)} className="rounded outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand">{group.displayName}</AppLink></h3>
            <ul className="divide-y divide-line">
              {shown.map(({ activity, overdueDays }) => (
                <li key={activity.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
                  <div className="min-w-0 flex-1">
                    <AppLink href={`${mapPath(group.mapId)}#activity-${activity.id}`} className="rounded font-medium break-words outline-none hover:text-brand-strong focus-visible:ring-2 focus-visible:ring-brand">{activity.title}</AppLink>
                    <p className={overdueDays > 0 ? 'text-sm text-warn' : 'text-sm text-ink-3'}>
                      {overdueDays > 0 ? COPY.WEEK_OVERDUE_DAYS(overdueDays) : COPY.WEEK_DUE_ON(formatMapDate(activity.dueDate!, today))}
                    </p>
                  </div>
                  {onDone && <Button size="sm" aria-label={COPY.WEEK_MARK_DONE_FOR(activity.title)} onClick={() => onDone(group.mapId, activity)}>{COPY.WEEK_MARK_DONE}</Button>}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function WaitingLines({ lines, limit }: { lines: ThisWeek['waiting']; limit: number }) {
  return (
    <ul className="divide-y divide-line">
      {lines.slice(0, limit).map((line) => (
        <li key={line.partnerId}>
          <AppLink href={`/partners/${line.accountId}`} className={LINE}>
            <span className="min-w-0 font-medium break-words">{line.name}</span>
            <span className="text-sm text-ink-3">
              {PARTNER_TYPE_LABELS[line.partnerType]} · {line.reason === 'mapNotAgreed' ? COPY.WEEK_WAITING_MAP_NOT_AGREED : COPY.WEEK_WAITING_STALLED(line.days)}
            </span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

/**
 * This week's sections: the waiting proposals first, when any wait, then the four. `change` is the MAP's change action;
 * tests and previews give their own, and `answers` the same for proposals. `timeZone` and `now` (the time of the read) date the proposals; `storage` is for Reconnect Google.
 */
export function ThisWeekView({ week, today, change = mapChange, answers = SERVER_ANSWERS, timeZone = DEFAULT_TIME_ZONE, now, storage = 'google' }: {
  week: ThisWeek & { proposals?: WeekProposal[] };
  today: IsoDate;
  change?: ChangeMap;
  answers?: ProposalAnswers;
  timeZone?: string;
  now?: string;
  storage?: StorageKind;
}) {
  const router = useRouter();
  // A preview (the landing page's sample) reads nothing from the server, so it never reads again.
  const preview = usePreviewPathname() !== null;
  const refresh = () => { if (!preview) router.refresh(); };
  const proposals = week.proposals ?? [];
  const [readAt] = useState(() => now ?? new Date().toISOString());
  // Proposals answered here: one line at once, until the next read leaves them out.
  const [answered, setAnswered] = useState<Readonly<Record<string, WeekAnswer>>>({});
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  // Market proposals whose accept was refused as changed since: This week reads no market, so the week read again
  // would offer the same Accept, refused the same way. Show (and Reject) only, until the person leaves the page.
  const [showOnly, setShowOnly] = useState<ReadonlySet<string>>(new Set());
  const [reconnect, setReconnect] = useState(false);
  // A company server's viewer answers no proposal and marks nothing done: no button for it (owner, 2026-11-14).
  const viewer = useViewer();
  const setBusyOf = (id: string, on: boolean) => setBusy((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });

  /**
   * An answer from This week, by the proposal's id: the server works it out from the file as it is now. Refused, it
   * says why and reads the week again; Google needing a new sign-in shows Reconnect Google, and the proposal still waits.
   */
  const answer = async (view: WeekProposal, to: WeekAnswer, send: () => Promise<Answered>) => {
    if (busy.has(view.head.id)) return;
    setBusyOf(view.head.id, true);
    let result: Answered;
    try {
      result = await send();
    } catch {
      setBusyOf(view.head.id, false);
      sonnerNotify.error(COPY.SAVE_OFFLINE);
      return;
    }
    setBusyOf(view.head.id, false);
    if (result.ok) {
      noteAnswered(view.head.id);
      setAnswered((prev) => ({ ...prev, [view.head.id]: to }));
      return;
    }
    if (result.error === 'auth') return setReconnect(true);
    const changedSince = result.error === 'conflict' && result.message === COPY.CONFLICT;
    if (to === 'accepted' && changedSince && isMarketKind(view)) setShowOnly((prev) => new Set(prev).add(view.head.id));
    sonnerNotify.error(refusalText(view, result));
    refresh();
  };
  // No market is read here: the server checks the target against the `updatedAt` the proposal kept.
  const accept = (view: WeekProposal) => void answer(view, 'accepted', () => answers.accept({
    proposalId: view.head.id, ...(view.targetUpdatedAt !== null ? { expectedUpdatedAt: view.targetUpdatedAt } : {}),
  }));
  const reject = (view: WeekProposal, note: string) =>
    void answer(view, 'rejected', () => answers.reject({ proposalId: view.head.id, ...(note ? { note } : {}) }));
  // Activities marked done here: gone from the list at once, back if the change fails or is undone.
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const setGoneOf = (id: string, isGone: boolean) => setGone((prev) => {
    const next = new Set(prev);
    if (isGone) next.add(id);
    else next.delete(id);
    return next;
  });

  const due = week.due
    .map((g) => ({ ...g, activities: g.activities.filter((a) => !gone.has(a.activity.id)) }))
    .filter((g) => g.activities.length > 0);
  const dueTotal = due.reduce((n, g) => n + g.activities.length, 0);
  const titles = new Map(week.due.flatMap((g) => g.activities.map((a): [string, string] => [a.activity.id, a.activity.title])));

  const refused = (result: Extract<RemoteResult, { ok: false }>) => {
    // The conflict message is the MAP's own; the page reads again so the line shows what is there now.
    if (result.error === 'conflict') {
      sonnerNotify.info(result.message);
      refresh();
    } else sonnerNotify.error(result.message);
  };

  const markDone = async (mapId: string, activity: Activity) => {
    setGoneOf(activity.id, true);
    let result: RemoteResult;
    try {
      result = await change({
        mapId,
        change: { kind: 'update', entity: 'activity', id: activity.id, patch: { status: 'done' }, expectedUpdatedAt: activity.updatedAt },
      });
    } catch {
      setGoneOf(activity.id, false);
      sonnerNotify.error(COPY.SAVE_OFFLINE);
      return;
    }
    if (!result.ok) {
      setGoneOf(activity.id, false);
      refused(result);
      return;
    }
    const producedAt = result.snapshot.value?.activities?.find((a) => a.id === activity.id)?.updatedAt ?? null;
    sonnerNotify.undo(COPY.MAP_MARKED(MAP_ACTIVITY_STATUS_LABELS.done), async () => {
      const back = await change({
        mapId,
        change: {
          kind: 'update', entity: 'activity', id: activity.id, patch: { status: activity.status, completedDate: activity.completedDate },
          expectedUpdatedAt: producedAt,
        },
      }).catch(() => null);
      if (back?.ok) {
        setGoneOf(activity.id, false);
        refresh();
      } else if (back) refused(back);
      else sonnerNotify.error(COPY.SAVE_OFFLINE);
    });
  };

  return (
    <div className="grid gap-4">
      {reconnect && <ReconnectBanner next={PATH} storage={storage} />}
      {proposals.length > 0 && (
        <Section title={COPY.WEEK_PROPOSALS} empty="" total={proposals.length}>
          {(limit) => (
            <ProposalLines proposals={proposals} limit={limit} answered={answered} busy={busy} showOnly={showOnly} readOnly={reconnect || viewer}
              timeZone={timeZone} now={readAt} onAccept={accept} onReject={reject} />
          )}
        </Section>
      )}
      <Section title={COPY.WEEK_REVIEWS} empty={COPY.WEEK_REVIEWS_EMPTY} total={week.reviews.length}>
        {(limit) => <ReviewLines lines={week.reviews} today={today} limit={limit} />}
      </Section>
      <Section title={COPY.WEEK_NEED} empty={COPY.WEEK_NEED_EMPTY} total={week.needYou.length}>
        {(limit) => <NeedLines lines={week.needYou} titles={titles} limit={limit} />}
      </Section>
      <Section title={COPY.WEEK_DUE} empty={COPY.WEEK_DUE_EMPTY} total={dueTotal}>
        {(limit) => <DueLines groups={due} today={today} limit={limit} onDone={viewer ? null : markDone} />}
      </Section>
      <Section title={COPY.WEEK_WAITING} empty={COPY.WEEK_WAITING_EMPTY} total={week.waiting.length}>
        {(limit) => <WaitingLines lines={week.waiting} limit={limit} />}
      </Section>
    </div>
  );
}

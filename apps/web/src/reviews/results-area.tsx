'use client';

// Area 1, last quarter's results (reviews spec 5.2, 5.4, 5.5): the horizon's work on both sides, done or not done with a
// reason, the objectives, milestones, exit triggers and health, the scorecard, and the case against actual.
import type { CaseAgainstActual, Currency, ScoreKey } from '@partner-desk/core';
import { milestoneStatus, type Activity } from '@partner-desk/core';
import { COPY, MAP_EXIT_STATUS_LABELS } from '@partner-desk/copy';
import { HealthBadge, MilestoneStatusTag, SideBadge, StatusTag } from '@/maps/badges';
import { InlineText } from '@/maps/components/inline-text';
import { formatMapDate, objectivesTitle } from '@/maps/format';
import { Section } from '@/maps/pieces';
import { sortActivities, sortMilestones } from '@/maps/view-model';
import { useReview } from './review-context';
import { CASE_KEYS, formatDeals, formatScore, numberLabel, scoreKeysFor } from './review-model';
import { ScorecardTable, type ScoreRow } from './scorecard-table';

export function ResultsArea() {
  const { review, read } = useReview();
  return (
    <Section title={COPY.REVIEW_AREA_RESULTS}>
      {review.horizon === 1 && <p className="mb-4 rounded-xl bg-brand-soft/60 p-3 text-sm text-ink">{COPY.REVIEW_FIRST_ACTIVATION}</p>}
      <div className="space-y-4">
        <Work />
        <Objectives />
        <MilestonesAndTriggers />
        <div>
          <h3 className="mb-2 text-sm font-semibold">{COPY.REVIEW_SCORECARD}</h3>
          <Scorecard />
        </div>
        {read.caseAgainstActual && <CaseAgainstActualTable data={read.caseAgainstActual} currency={read.caseCurrency} />}
      </div>
    </Section>
  );
}

/** The horizon's activities, as the MAP has them now, each with its reason when it isn't done. */
function Work() {
  const { read, plan, names, items, addItem, setItem } = useReview();
  const live = new Map(plan.activities.map((a) => [a.id, a]));
  const work: Activity[] = sortActivities(read.work.map((a) => live.get(a.id) ?? a));
  const reasons = items('notDone');
  // A "not done" line whose activity is gone from the MAP keeps its title and reason.
  const orphans = reasons.filter((r) => r.refId === null || !work.some((a) => a.id === r.refId));
  return (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{COPY.REVIEW_WORK}</h3>
      {work.length === 0 && orphans.length === 0 && <p className="text-sm text-ink-3">{COPY.REVIEW_NO_WORK}</p>}
      <ul className="divide-y divide-line">
        {work.map((a) => {
          const reason = reasons.find((r) => r.refId === a.id) ?? null;
          const done = a.status === 'done';
          return (
            <li key={a.id} className="py-2.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <span className="min-w-0 flex-1 basis-48 text-sm font-medium break-words">{a.title}</span>
                <SideBadge side={a.side} names={names} />
                <StatusTag status={a.status} />
              </div>
              {!done && (
                <div className="mt-1 text-sm">
                  <InlineText value={reason?.note ?? ''} label={COPY.REVIEW_WHY_NOT_DONE(a.title)} field="note" placeholder={COPY.REVIEW_ADD_REASON}
                    className="text-ink-2"
                    onCommit={(note) => (reason
                      ? setItem(reason.id, { note })
                      : addItem('notDone', { refId: a.id, title: a.title, side: a.side, note }))} />
                </div>
              )}
            </li>
          );
        })}
        {orphans.map((r) => (
          <li key={r.id} className="py-2.5">
            <p className="text-sm font-medium break-words">{r.title}</p>
            <div className="mt-1 text-sm">
              <InlineText value={r.note} label={COPY.REVIEW_WHY_NOT_DONE(r.title)} field="note" placeholder={COPY.REVIEW_ADD_REASON}
                className="text-ink-2" onCommit={(note) => setItem(r.id, { note })} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Objectives() {
  const { plan, names } = useReview();
  if (plan.objectives.length === 0) return null;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(['us', 'partner'] as const).map((side) => (
        <div key={side} className="min-w-0">
          <h3 className="text-sm font-semibold break-words">{objectivesTitle(side, names)}</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
            {plan.objectives.filter((o) => o.side === side).map((o) => (
              <li key={o.id} className="break-words">
                {o.statement}
                {o.successMeasure && <span className="text-ink-3"> · {o.successMeasure}</span>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function MilestonesAndTriggers() {
  const { plan, read, today } = useReview();
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{COPY.REVIEW_MILESTONES}</h3>
        {plan.milestones.length === 0 ? <p className="mt-1 text-sm text-ink-3">{COPY.REVIEW_NO_MILESTONES}</p> : (
          <ul className="mt-1 space-y-1 text-sm">
            {sortMilestones(plan.milestones).map((m) => (
              <li key={m.id} className="flex flex-wrap items-baseline gap-x-2">
                <span className="min-w-0 break-words">{m.name}</span>
                {m.targetDate && <span className="text-xs text-ink-3">{formatMapDate(m.targetDate, today)}</span>}
                <MilestoneStatusTag status={milestoneStatus(m, today, plan.info.stage)} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold">{COPY.GUIDED_EXIT_TRIGGERS}</h3>
        {plan.exitTriggers.length === 0 ? <p className="mt-1 text-sm text-ink-3">{COPY.MAP_NONE_AGREED}</p> : (
          <ul className="mt-1 space-y-1 text-sm">
            {plan.exitTriggers.map((x) => (
              <li key={x.id} className="break-words">{x.condition} <span className="text-ink-3">· {MAP_EXIT_STATUS_LABELS[x.status]}</span></li>
            ))}
          </ul>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{COPY.REVIEW_MAP_HEALTH}</span>
          {read.health.health && <HealthBadge health={read.health.health} />}
        </p>
      </div>
    </div>
  );
}

/** The numbers with their targets; we bill and the partner earns are offered from the deals won, at the case's value. */
function Scorecard() {
  const { read, plan, number, targetOf, setNumber } = useReview();
  const dealsWon = number('dealsWon')?.actual ?? null;
  const suggestion = (key: ScoreKey): number | null => {
    if (key === 'categoryNumber') return read.prefill.categoryNumber ?? null;
    if ((key === 'weBill' || key === 'partnerEarns') && read.perDeal && dealsWon !== null) return dealsWon * read.perDeal[key];
    return null;
  };
  const rows: ScoreRow[] = scoreKeysFor(read.categoryNumber).map((key) => {
    const row = number(key);
    return {
      key, label: numberLabel(key, read.categoryNumber), actual: row?.actual ?? null, target: targetOf(key), source: row?.source ?? null,
      note: row?.note ?? '', suggestion: suggestion(key),
    };
  });
  const live = new Map(plan.activities.map((a) => [a.id, a]));
  const work = read.work.map((a) => live.get(a.id) ?? a);
  return (
    <ScorecardTable rows={rows} noCase={CASE_KEYS.every((key) => targetOf(key) === null)} currency={read.caseCurrency}
      map={{ done: work.filter((a) => a.status === 'done').length, total: work.length, health: read.health.health }}
      onChange={(key, patch) => setNumber(key, patch)} />
  );
}

/** Held reviews against the business case: since signing, and review by review (spec 5.5). */
function CaseAgainstActualTable({ data, currency }: { data: CaseAgainstActual; currency: Currency | null }) {
  const { today } = useReview();
  // Deals whole, as a forecast counts parts of deals; money whole, in the case's currency, without a sign when unknown.
  const deals = (actual: number, target: number) => `${formatDeals(actual)} / ${formatDeals(target)}`;
  const money = (n: number) => formatScore('weBill', n, currency);
  const pair = (actual: number, target: number) => `${money(actual)} / ${money(target)}`;
  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold">{COPY.REVIEW_CASE_AGAINST_ACTUAL}</h3>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[30rem] text-left text-sm print:min-w-0">
          <thead className="text-xs tracking-wide text-ink-3 uppercase">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">{COPY.REVIEW_HELD_REVIEW}</th>
              {CASE_KEYS.map((key) => <th key={key} scope="col" className="pr-3 font-medium">{COPY.REVIEW_NUMBER_LABELS[key]}</th>)}
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            <tr>
              <th scope="row" className="py-2 pr-3 font-medium">{COPY.REVIEW_SINCE_SIGNING}</th>
              <td className="py-2 pr-3">{deals(data.toDate.actual.deals, data.toDate.forecast.deals)}</td>
              <td className="py-2 pr-3">{pair(data.toDate.actual.weBill, data.toDate.forecast.weBill)}</td>
              <td className="py-2">{pair(data.toDate.actual.partnerEarns, data.toDate.forecast.partnerEarns)}</td>
            </tr>
            {data.rows.map((r) => (
              <tr key={r.reviewId}>
                <th scope="row" className="py-2 pr-3 font-normal">{COPY.REVIEW_HELD_ON(formatMapDate(r.heldOn, today))}</th>
                <td className="py-2 pr-3">{deals(r.actual.deals, r.target.deals)}</td>
                <td className="py-2 pr-3">{pair(r.actual.weBill, r.target.weBill)}</td>
                <td className="py-2">{pair(r.actual.partnerEarns, r.target.partnerEarns)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-xs text-ink-3">{COPY.REVIEW_ACTUAL} / {COPY.REVIEW_FORECAST}</p>
    </div>
  );
}

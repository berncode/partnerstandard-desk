// The review's present view (reviews spec 5.2): the review read-only and large, to share a screen in the meeting or print
// to PDF on A4 or Letter, in the MAP's present layout (maps/present/present-view.tsx).
import type { ReviewRead } from '@partner-desk/commands';
import { currentHorizon, milestoneStatus, type IsoDate, type ReviewItemKind, type ScoreKey } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, STAGE_LABELS } from '@partner-desk/method';
import { COPY, MAP_EXIT_STATUS_LABELS } from '@partner-desk/copy';
import { HealthBadge, MilestoneStatusTag, SideDot, StatusTag } from '@/maps/badges';
import { formatMapDate, objectivesTitle, ourSideName, sideName, type SideNames } from '@/maps/format';
import { sortActivities, sortMilestones } from '@/maps/view-model';
import { CommitmentsTable } from './commitments-table';
import { CASE_KEYS, formatScore, numberLabel, scoreKeysFor } from './review-model';
import { ScorecardTable, type ScoreRow } from './scorecard-table';

export function ReviewPresent({ read, today, ourName, ownerName }: { read: ReviewRead; today: IsoDate; ourName: string; ownerName: string }) {
  const { review, info } = read;
  const names: SideNames = { ours: ourSideName(ourName, ownerName), partner: read.partnerName };
  const label = PARTNER_TYPE_LABELS[read.partnerType];
  const partnership = read.partnerName ? COPY.PARTNER_AS_TYPE(read.partnerName, label) : label;
  const date = review?.state === 'held' && review.heldOn
    ? COPY.REVIEW_HELD_ON(formatMapDate(review.heldOn, today))
    : read.status.kind === 'none' ? COPY.REVIEW_NOT_NOW : COPY.REVIEW_ON(formatMapDate(read.status.date, today));
  const items = (kind: ReviewItemKind) => read.items.filter((i) => i.kind === kind);
  const number = (key: ScoreKey) => read.numbers.find((n) => n.key === key) ?? null;
  const targetOf = (key: ScoreKey) => number(key)?.target ?? read.targets[key] ?? null;

  return (
    <article className="mx-auto w-full max-w-5xl text-[17px] leading-relaxed print:max-w-none">
      <header className="border-b border-line pb-6">
        <p className="text-sm tracking-widest text-ink-3 uppercase">{COPY.REVIEW_TITLE}</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-balance break-words sm:text-4xl">
          {COPY.REVIEW_HEADER(partnership, review?.horizon ?? currentHorizon(info))}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-base text-ink-2">
          {read.health.health && <HealthBadge health={read.health.health} className="text-sm" />}
          <span>{STAGE_LABELS[info.stage]}</span>
          <span aria-hidden>·</span>
          <span>{date}</span>
        </div>
      </header>

      {review && (
        <>
          <section className="mt-10">
            <h2 className="text-2xl font-semibold tracking-tight">{COPY.REVIEW_AREA_RESULTS}</h2>
            {review.horizon === 1 && <p className="mt-2 text-base text-ink-2">{COPY.REVIEW_FIRST_ACTIVATION}</p>}
            <h3 className="mt-6 text-lg font-semibold">{COPY.REVIEW_WORK}</h3>
            {read.work.length === 0 ? <p className="mt-2 text-base text-ink-3">{COPY.REVIEW_NO_WORK}</p> : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[32rem] text-left text-base print:min-w-0">
                  <thead className="text-xs tracking-wide text-ink-3 uppercase">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">{COPY.MAP_ACTIVITY}</th>
                      <th className="pr-4 font-medium">{COPY.MAP_SIDE}</th>
                      <th className="pr-4 font-medium">{COPY.MAP_STATUS}</th>
                      <th className="font-medium">{COPY.REVIEW_NOT_DONE}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {sortActivities(read.work).map((a) => (
                      <tr key={a.id} className="align-top">
                        <td className="py-2 pr-4 break-words">{a.title}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{sideName(a.side, names)}</td>
                        <td className="py-2 pr-4"><StatusTag status={a.status} /></td>
                        <td className="py-2 break-words text-ink-2">{a.status === 'done' ? '' : items('notDone').find((r) => r.refId === a.id)?.note ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {read.objectives.length > 0 && (
              <div className="mt-6 grid gap-8 sm:grid-cols-2 print:grid-cols-2">
                {(['us', 'partner'] as const).map((side) => (
                  <div key={side} className="min-w-0 break-inside-avoid">
                    <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase"><SideDot side={side} />{objectivesTitle(side, names)}</h3>
                    <ul className="mt-2 space-y-1 text-base">
                      {read.objectives.filter((o) => o.side === side).map((o) => <li key={o.id} className="break-words">{o.statement}</li>)}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-6 grid gap-8 sm:grid-cols-2 print:grid-cols-2">
              <div className="min-w-0 break-inside-avoid">
                <h3 className="text-lg font-semibold">{COPY.REVIEW_MILESTONES}</h3>
                {read.milestones.length === 0 ? <p className="mt-1 text-base text-ink-3">{COPY.REVIEW_NO_MILESTONES}</p> : (
                  <ul className="mt-2 space-y-1 text-base">
                    {sortMilestones(read.milestones).map((m) => (
                      <li key={m.id} className="flex flex-wrap items-baseline gap-x-2 break-words">
                        {m.name} <MilestoneStatusTag status={milestoneStatus(m, today, info.stage)} />
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="min-w-0 break-inside-avoid">
                <h3 className="text-lg font-semibold">{COPY.GUIDED_EXIT_TRIGGERS}</h3>
                {read.exitTriggers.length === 0 ? <p className="mt-1 text-base text-ink-3">{COPY.MAP_NONE_AGREED}</p> : (
                  <ul className="mt-2 space-y-1 text-base">
                    {read.exitTriggers.map((x) => <li key={x.id} className="break-words">{x.condition} <span className="text-ink-3">· {MAP_EXIT_STATUS_LABELS[x.status]}</span></li>)}
                  </ul>
                )}
              </div>
            </div>
            <h3 className="mt-6 mb-2 text-lg font-semibold">{COPY.REVIEW_SCORECARD}</h3>
            <ScorecardTable readOnly noCase={CASE_KEYS.every((key) => targetOf(key) === null)} currency={read.caseCurrency}
              rows={scoreKeysFor(read.categoryNumber).map((key): ScoreRow => ({
                key, label: numberLabel(key, read.categoryNumber), actual: number(key)?.actual ?? null, target: targetOf(key),
                source: number(key)?.source ?? null, note: number(key)?.note ?? '', suggestion: null,
              }))}
              map={{ done: read.work.filter((a) => a.status === 'done').length, total: read.work.length, health: read.health.health }} />
          </section>

          <section className="mt-12 break-inside-avoid">
            <h2 className="text-2xl font-semibold tracking-tight">{COPY.REVIEW_AREA_HYPOTHESIS}</h2>
            <ul className="mt-3 space-y-3">
              {items('hypothesis').map((q) => (
                <li key={q.id} className="break-words">
                  <p className="font-medium">{q.title || COPY.REVIEW_WHY_IT_FITS}</p>
                  <p className="text-base text-ink-2">
                    {q.answer ? COPY.REVIEW_ANSWER_LABELS[q.answer] : ''}{q.answer && q.note ? ' · ' : ''}{q.note}
                  </p>
                </li>
              ))}
            </ul>
          </section>

          <section className="mt-12">
            <h2 className="text-2xl font-semibold tracking-tight">{COPY.REVIEW_AREA_NEXT}</h2>
            <h3 className="mt-4 text-lg font-semibold">{COPY.REVIEW_TARGETS_NEXT}</h3>
            <ul className="mt-2 grid gap-x-8 gap-y-1 text-base sm:grid-cols-2 print:grid-cols-2">
              {scoreKeysFor(read.categoryNumber).map((key) => (
                <li key={key} className="flex justify-between gap-4">
                  <span>{numberLabel(key, read.categoryNumber)}</span>
                  <span className="tabular-nums">{number(key)?.nextTarget == null ? '' : formatScore(key, number(key)!.nextTarget!, read.caseCurrency)}</span>
                </li>
              ))}
            </ul>
            <h3 className="mt-6 text-lg font-semibold">{COPY.REVIEW_COMMITMENTS}</h3>
            {items('commitment').length === 0 ? <p className="mt-2 text-base text-ink-3">{COPY.REVIEW_NO_COMMITMENTS}</p> : (
              <CommitmentsTable className="mt-3 text-base" lines={items('commitment').map((c) => ({
                key: c.id, title: c.title, side: c.side ? sideName(c.side, names) : '',
                owner: c.ownerId ? read.people.find((p) => p.id === c.ownerId)?.name ?? COPY.MAP_UNKNOWN_PERSON : <span className="text-ink-3">{COPY.MAP_NO_OWNER}</span>,
                due: c.dueDate ? formatMapDate(c.dueDate, today) : <span className="text-ink-3">{COPY.MAP_NO_DATE}</span>,
              }))} />
            )}
          </section>

          <section className="mt-12 break-inside-avoid">
            <h2 className="text-2xl font-semibold tracking-tight">{COPY.REVIEW_AREA_BLOCKERS}</h2>
            {items('blocker').length === 0 ? <p className="mt-2 text-base text-ink-3">{COPY.REVIEW_NO_BLOCKERS}</p> : (
              <ul className="mt-3 space-y-2 text-base">
                {items('blocker').map((b) => (
                  <li key={b.id} className="break-words">
                    <span className="font-medium">{b.title}</span>
                    {b.side && <span className="text-ink-3"> · {sideName(b.side, names)}</span>}
                    {b.note && <span className="block text-ink-2">{b.note}</span>}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="mt-12 break-inside-avoid">
            <h2 className="text-2xl font-semibold tracking-tight">{COPY.REVIEW_AREA_RELATIONSHIP}</h2>
            <p className="mt-2 text-base">
              {COPY.REVIEW_RECOMMEND}: <span className="font-semibold tabular-nums">{number('recommend')?.actual ?? ''}</span>
            </p>
            {review.relationshipNote && <p className="mt-1 text-base whitespace-pre-wrap break-words text-ink-2">{review.relationshipNote}</p>}
          </section>

          <section className="mt-12 break-inside-avoid">
            <h2 className="text-2xl font-semibold tracking-tight">{COPY.REVIEW_DECISIONS}</h2>
            {review.decisions && <p className="mt-2 text-base whitespace-pre-wrap break-words">{review.decisions}</p>}
            <p className="mt-4 text-base font-medium">{COPY.REVIEW_NEXT_HORIZON(review.nextHorizonDays)}</p>
          </section>
        </>
      )}
    </article>
  );
}

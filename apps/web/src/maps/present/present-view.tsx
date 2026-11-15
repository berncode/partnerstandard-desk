// The present view, in COPY's words, on the joined plan. The health is core's summary, as on every screen (ruling R6).
// There is no company logo: PartnerStandard Desk keeps no logo.
import { summarizeMap, type IsoDate, type IsoDateTime, type JoinedPlan } from '@partner-desk/core';
import { STAGE_LABELS } from '@partner-desk/method';
import { COPY, MAP_EXIT_STATUS_LABELS, MAP_ROLE_LABELS } from '@partner-desk/copy';
import { HealthBadge, MilestoneStatusTag, NotSignedBadge, SideDot, StatusTag } from '../badges';
import { formatMapDate, objectivesTitle, ourSideName, sideName, type SideNames } from '../format';
import { describeReason, groupActivities, horizonProgress, peopleOnSide, personName } from '../view-model';

/** `ownerName` names our side until the company has a name (`ourName`), for every viewer alike. */
export function PresentView({ plan, today, lastEventAt, ourName = null, ownerName }: {
  plan: JoinedPlan; today: IsoDate; lastEventAt: IsoDateTime | null; ourName?: string | null; ownerName: string;
}) {
  const { info } = plan;
  const { health, reasons } = summarizeMap(plan, today, lastEventAt);
  const progress = horizonProgress(info, today);
  const groups = groupActivities(plan, plan.activities, today).filter((g) => g.milestone || g.activities.length > 0);
  const names: SideNames = { ours: ourSideName(ourName, ownerName), partner: info.partnerName };

  return (
    <article className="mx-auto w-full max-w-5xl text-[17px] leading-relaxed print:max-w-none">
      <header className="border-b border-line pb-6">
        <p className="text-sm tracking-widest text-ink-3 uppercase">{COPY.MAP_TITLE}</p>
        <h1 className="mt-2 text-4xl font-semibold tracking-tight text-balance break-words sm:text-5xl">
          {names.ours} <span aria-hidden>×</span><span className="sr-only">{COPY.MAP_AND}</span> {sideName('partner', names)}
        </h1>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-base text-ink-2">
          {health === null ? <NotSignedBadge className="text-sm" /> : <HealthBadge health={health} className="text-sm" />}
          <span>{STAGE_LABELS[info.stage]}</span>
          <span aria-hidden>·</span>
          {progress.phase === 'recruitment' ? <span>{progress.label}</span> : (
            <>
              <span>{COPY.MAP_HORIZON_N(progress.horizon)}</span>
              <span aria-hidden>·</span>
              <span>{formatMapDate(info.startDate, today)} – {formatMapDate(progress.endDate, today)}</span>
            </>
          )}
        </div>
        {reasons.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-base text-ink-2">
            {reasons.map((r) => <li key={JSON.stringify(r)} className="break-words">{describeReason(plan, r)}</li>)}
          </ul>
        )}
      </header>

      <section className="mt-10 break-inside-avoid">
        <h2 className="text-2xl font-semibold tracking-tight">{COPY.MAP_OBJECTIVES}</h2>
        {plan.objectives.length === 0 ? (
          <p className="mt-3 text-ink-3">{COPY.MAP_NO_OBJECTIVES_AGREED}</p>
        ) : (
          <div className="mt-4 grid gap-8 sm:grid-cols-2 print:grid-cols-2">
            {(['us', 'partner'] as const).map((side) => (
              <div key={side} className="min-w-0">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase"><SideDot side={side} />{objectivesTitle(side, names)}</h3>
                <ol className="mt-3 space-y-4">
                  {plan.objectives.filter((o) => o.side === side).map((o) => (
                    <li key={o.id} className="break-words">
                      <p className="font-medium">{o.statement}</p>
                      {o.successMeasure && <p className="text-base text-ink-2">{COPY.MAP_MEASURED_BY(o.successMeasure)}</p>}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-semibold tracking-tight">{COPY.MAP_MILESTONES_AND_ACTIVITIES}</h2>
        {plan.activities.length === 0 && plan.milestones.length === 0 && <p className="mt-3 text-ink-3">{COPY.MAP_NO_ACTIVITIES}</p>}
        {groups.map((g) => (
          <div key={g.key} className="mt-8 break-inside-avoid">
            <h3 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-lg font-semibold break-words">
              {g.milestone?.name ?? COPY.MAP_UNSCHEDULED}
              {g.milestone?.targetDate && <span className="text-base font-normal text-ink-3">{formatMapDate(g.milestone.targetDate, today)}</span>}
              {g.status && <MilestoneStatusTag status={g.status} />}
            </h3>
            {g.milestone?.criteria && <p className="text-base break-words text-ink-2">{g.milestone.criteria}</p>}
            {g.activities.length === 0 ? (
              <p className="mt-2 text-base text-ink-3">{COPY.MAP_NO_ACTIVITIES}</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-base print:min-w-0">
                  <thead className="text-xs tracking-wide text-ink-3 uppercase">
                    <tr>
                      <th className="py-1.5 pr-4 font-medium">{COPY.MAP_ACTIVITY}</th>
                      <th className="pr-4 font-medium">{COPY.MAP_SIDE}</th>
                      <th className="pr-4 font-medium">{COPY.MAP_OWNER}</th>
                      <th className="pr-4 font-medium">{COPY.MAP_DUE}</th>
                      <th className="font-medium">{COPY.MAP_STATUS}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {g.activities.map((a) => (
                      <tr key={a.id} className="align-top">
                        <td className="py-2 pr-4 break-words">{a.title}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{sideName(a.side, names)}</td>
                        <td className="py-2 pr-4">{personName(plan, a.ownerId) ?? <span className="text-ink-3">{COPY.MAP_NO_OWNER}</span>}</td>
                        <td className="py-2 pr-4 whitespace-nowrap">{a.dueDate ? formatMapDate(a.dueDate, today) : <span className="text-ink-3">{COPY.MAP_NO_DATE}</span>}</td>
                        <td className="py-2"><StatusTag status={a.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="mt-12 grid gap-10 sm:grid-cols-2 print:grid-cols-2">
        <div className="min-w-0 break-inside-avoid">
          <h2 className="text-2xl font-semibold tracking-tight">{COPY.MAP_PEOPLE}</h2>
          {(['us', 'partner'] as const).map((side) => (
            <div key={side} className="mt-4">
              <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wide uppercase"><SideDot side={side} />{sideName(side, names)}</h3>
              {peopleOnSide(plan, side).length === 0 ? <p className="mt-1 text-base text-ink-3">{COPY.MAP_NOBODY_YET}</p> : (
                <ul className="mt-1 space-y-1 text-base">
                  {peopleOnSide(plan, side).map((p) => (
                    <li key={p.id} className="break-words">
                      <span className="font-medium">{p.name}</span>{p.title && <span className="text-ink-2">, {p.title}</span>} <span className="text-ink-3">· {MAP_ROLE_LABELS[p.role]}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
        <div className="min-w-0 break-inside-avoid">
          <h2 className="text-2xl font-semibold tracking-tight">{COPY.GUIDED_EXIT_TRIGGERS}</h2>
          {plan.exitTriggers.length === 0 ? <p className="mt-3 text-base text-ink-3">{COPY.MAP_NONE_AGREED}</p> : (
            <ul className="mt-3 space-y-2 text-base">
              {plan.exitTriggers.map((x) => <li key={x.id} className="break-words">{x.condition} <span className="text-ink-3">· {MAP_EXIT_STATUS_LABELS[x.status]}</span></li>)}
            </ul>
          )}
        </div>
      </section>
    </article>
  );
}

// Our one-pager. It names the higher level as the case's program does (`offer.levels.preferred`) where the Business Case
// app wrote Preferred. It imports no client code and isn't one; the Share tab draws it from the case on screen. It never
// reaches the partner: it has no link.
import type { OurCostLine } from '@partner-desk/core';
import type { ReactNode } from 'react';
import { formatMoney } from './format';
import {
  HowSure, numbersSay, OptionsChart, OptionsTable, OurStats, partnerName, SourceTag, vendorName, verdictOf, type OurView,
} from './our-case';
import { partnerKind, roleLines } from './role-lines';

const H2 = 'text-[15px] font-semibold print:text-[13px]';
const LIST = 'mt-1.5 list-disc space-y-[3px] pl-[18px] text-sm break-words text-ink-2 print:mt-0.5 print:space-y-0 print:text-[11px] print:leading-[1.25]';

/** A part of the page. Never split: on paper it moves whole to the next column or page. */
function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 break-inside-avoid print:mb-2">
      <h2 id={id} className={H2}>{title}</h2>
      <ul className={LIST}>{children}</ul>
    </section>
  );
}

/** A box with a small heading: what the numbers say, and the recommendation. */
function Box({ id, title, children }: { id: string; title: string; children: string }) {
  return (
    <section aria-labelledby={id} className="mt-3 break-inside-avoid rounded-[10px] bg-surface-2 px-3.5 py-3 break-words text-ink print:mt-0 print:px-3 print:py-1">
      <h2 id={id} className="mb-0.5 text-[11.5px] font-semibold tracking-[.05em] text-ink-3 uppercase print:text-[10px]">{title}</h2>
      <p className="text-sm whitespace-pre-line print:text-[11.5px]">{children}</p>
    </section>
  );
}

const REASONS = [['efficiency', 'More efficient'], ['churn', 'Less churn']] as const;

/**
 * Our case on one page, for the partner manager's manager (spec §9, the prototype's `#mgrSheet`): marked internal, what
 * the numbers say, the recommendation, the three numbers, the options, both sides, what we ask for, beyond revenue,
 * strategic reasons and how sure we are. It has no link: it leaves the app only as the PDF the partner manager
 * downloads (Download PDF). Printed, it fits one A4 or Letter page with realistic texts; longer texts flow onto a
 * second page, each part kept whole.
 */
export function OurOnePager({ view }: { view: OurView }) {
  const c = view.case;
  const o = c.ours;
  const type = c.offer.types.find((t) => t.id === c.typeId);
  if (!type) throw new Error('The case’s partner type is not in its offer');
  const money = (n: number) => formatMoney(n, c.offer.currency);
  const partner = partnerName(c);
  const vendor = vendorName(c);
  const pref = c.offer.levels.preferred;
  const n = view.ours.years.length;
  const P = view.ours.withPartner;
  const theirs = view.partner;
  const preferredOn = c.offer.preferred.on;
  const total = (when: OurCostLine['when']) => o.costs.filter((x) => x.when === when).reduce((s, x) => s + x.amount, 0);
  const preferredCost = preferredOn ? total('preferred') : 0;
  const costs = o.costs.filter((x) => x.when !== 'preferred' || preferredOn);
  const counted = REASONS.filter(([key]) => o[key].on);
  const strategic = o.strategic.filter((s) => s.text.trim());
  const by = o.preparedBy.trim();
  const roles = roleLines(type.roles, c.partner.trim() || 'The partner', c.offer.company.trim() || 'You');
  const asked: Record<OurCostLine['when'], string> = { start: ' once', yearly: ' a year', preferred: ` a year as ${pref}` };
  const id = (part: string) => `our-page-${part}`;

  return (
    <article className="mx-auto max-w-[840px] rounded-xl border border-line bg-surface p-[22px] shadow-[0_8px_30px_rgba(18,22,20,.06)] [-webkit-print-color-adjust:exact] [print-color-adjust:exact] min-[700px]:px-10 min-[700px]:py-9 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <p className="text-xs font-semibold tracking-[.06em] text-warn uppercase print:text-[10px]">{`Internal · not for ${partner}`}</p>
      <h1 className="mt-1 mb-1.5 text-[26px] leading-tight font-semibold tracking-tight break-words print:mb-1 print:text-lg">
        {`Partnership with ${partner}: is it worth it for ${vendor}?`}
      </h1>
      <p className="text-sm break-words text-ink-3 print:text-[11px]">
        {`${partnerKind(type.name)}, ${n} years, ${c.scenario} scenario.${by ? ` Prepared by ${by}.` : ''}`}
        <br />
        {`${roles.join('; ')}.`}
      </p>

      {/* On paper, side by side: the page has room across, not down. */}
      <div className={`grid print:mt-2 print:gap-3${o.recommendation.trim() ? ' print:grid-cols-2' : ''}`}>
        <Box id={id('say')} title="What the numbers say">{numbersSay(view)}</Box>
        {o.recommendation.trim() && <Box id={id('recommendation')} title="Recommendation">{o.recommendation.trim()}</Box>}
      </div>

      <div className="mt-4 break-inside-avoid print:mt-2"><OurStats view={view} /></div>

      <section aria-labelledby={id('options')} className="mt-5 break-inside-avoid print:mt-2">
        <OptionsChart view={view} height={200} printHeight={88} legendOnPaper={false} heading={<h2 id={id('options')} className={H2}>The options</h2>} />
        <div className="mt-2.5 print:mt-1.5"><OptionsTable view={view} /></div>
      </section>

      {/*
        On screen two by two, with How sure across. On paper two columns that balance the parts' heights, each part
        kept whole: the page has room across, not down.
      */}
      <div className="mt-5 grid grid-cols-1 gap-7 min-[700px]:grid-cols-2 print:mt-2.5 print:block print:columns-2 print:gap-6">
        <Part id={id('sides')} title="Good for both sides?">
          <li>{`${partner}: ${money(theirs.profit)} profit after costs, ${theirs.breakEven ? `pays back in year ${theirs.breakEven.year}` : 'doesn’t pay back in 5 years'}.`}</li>
          <li>{`${vendor}: ${money(P.total)} net value after our costs, ${P.payback ? `pays back in year ${P.payback.year}` : 'doesn’t pay back in 5 years'}.`}</li>
          <li>{verdictOf(view).text}</li>
        </Part>
        <Part id={id('ask')} title="What we ask for">
          <li>{`${money(total('start'))} to start, then ${money(total('yearly'))} a year${preferredCost > 0 ? `, plus ${money(preferredCost)} a year once ${partner} is ${pref}` : ''}:`}</li>
          {/* Keyed by place: a cost line's id stays in the app. */}
          {costs.map((x, i) => <li key={i}>{`${x.name}: ${money(x.amount)}${asked[x.when]}`}<SourceTag source={x.source} /></li>)}
          {o.ask.trim() && <li className="whitespace-pre-line">{o.ask.trim()}</li>}
        </Part>
        <Part id={id('beyond')} title="Beyond revenue">
          {counted.length > 0 ? counted.map(([key, name]) => (
            <li key={key}>
              {`${name}: ${money(view.ours.years.reduce((s, y) => s + y[key], 0))} over ${n} years`}<SourceTag source={o[key].source} />
              {o[key].note.trim() && <span className="block text-ink-3">{o[key].note.trim()}</span>}
            </li>
          )) : <li>None counted</li>}
        </Part>
        <Part id={id('strategic')} title="Strategic reasons">
          {strategic.length > 0 ? strategic.map((s, i) => (
            <li key={i}>
              {`${s.text.trim()} `}
              <span className="inline-block rounded-[5px] bg-surface-2 px-1.5 py-px text-[11px] font-semibold text-ink-2 print:text-[10px]">{s.weight}</span>
              {s.alone && <span className="text-ink-3"> (also alone)</span>}
            </li>
          )) : <li>None given</li>}
        </Part>
        <section aria-labelledby={id('sure')} className="min-w-0 break-inside-avoid min-[700px]:col-span-2 print:mb-2">
          <h2 id={id('sure')} className={H2}>How sure we are</h2>
          <HowSure view={view} list={false} />
        </section>
      </div>

      <footer className="mt-6 flex flex-wrap justify-between gap-3 border-t border-line pt-3 text-xs text-ink-3 print:mt-0 print:pt-1.5">
        <span>{`Internal. Prepared for ${vendor} leadership.`}</span>
        <span>Estimates, with the source of every number</span>
      </footer>
    </article>
  );
}

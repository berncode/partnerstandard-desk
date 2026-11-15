// The one-page case. It gets the partner's side of the case (`PartnerCaseView`, built by `partnerSide` from an allow-list)
// in the place of the Business Case app's `PartnerSheet`, and names the levels as the case's program does (`levels`) where
// that app wrote Registered and Preferred. It imports no client code and isn't one: on the partner's page it renders on the
// server, so the page sends only what it shows; the Share tab draws it from the case on screen.
import type { CaseRates as Rates, PartnerCaseView } from '@partner-desk/core';
import type { ReactNode } from 'react';
import { formatMoney, formatNumber } from './format';
import { describeTypicalCustomer, preferredRule, Stat } from './result-summary';
import { roleLines } from './role-lines';
import { chartData, StaticRevenueChart, YOUR_CHART_LABEL } from './static-revenue-chart';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Reseller partnership", and "Service partnership" for a type named "Service partner". */
const partnership = (typeName: string) => {
  const name = typeName.trim();
  return /\bpartner$/i.test(name) ? `${name}ship` : `${name} partnership`;
};

/** "year 4", "years 3, 4 and 5". */
const yearList = (years: number[]) =>
  years.length === 1 ? `year ${years[0]}` : `years ${years.slice(0, -1).join(', ')} and ${years[years.length - 1]}`;

type When = PartnerCaseView['costs'][number]['when'];

/**
 * What the vendor takes of the partner's services, `of` after the first percent: "10%", or per level while Preferred
 * is on and they differ ("10%<of> as Registered, 5% as Preferred", a level at 0% left out); null when it takes none,
 * or the type delivers no services.
 */
function servicesShare(v: PartnerCaseView, of = ''): string | null {
  if (!v.type.roles.services) return null;
  const { registered: { servicesShare: r }, preferred: { servicesShare: p } } = v.type;
  const tiers = !v.preferred.on || r === p
    ? [{ pct: r, as: '' }]
    : [{ pct: r, as: ` as ${v.levels.registered}` }, { pct: p, as: ` as ${v.levels.preferred}` }];
  const shown = tiers.filter((t) => t.pct > 0).map((t, i) => `${formatNumber(t.pct)}%${i === 0 ? of : ''}${t.as}`);
  return shown.length > 0 ? shown.join(', ') : null;
}

/** Two sections side by side where they fit (and always on paper), one under the other on a phone. */
const TWO = 'mt-5 grid grid-cols-1 gap-7 min-[700px]:grid-cols-2 print:mt-3 print:grid-cols-2';

function Part({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 break-inside-avoid">
      <h2 id={id} className="text-[15px] font-semibold">{title}</h2>
      <ul className="mt-1.5 list-disc space-y-[3px] pl-[18px] text-sm break-words text-ink-2 print:mt-1 print:space-y-0.5 print:text-[13px]">{children}</ul>
    </section>
  );
}

/**
 * The one-page business case the partner sees (the prototype's `renderSheet`): what the partnership is worth to the
 * partner, the chart, who does what, and every assumption written out, in "you" form. Given only the partner's side
 * of the case: the Share tab, the share link and the PDF all show it. Printed, it fits one A4 or Letter page. With
 * Preferred off it never names the levels (spec §6).
 */
export function OnePageCase({ view: v }: { view: PartnerCaseView }) {
  const result = v.result;
  const money = (n: number) => formatMoney(n, v.currency);
  const vendor = v.company;
  const partner = v.partner.trim() || 'the partner';
  const roles = v.type.roles;
  const { registered: reg, preferred: pref } = v.levels;
  const years = result.years.length;
  const preferredOn = v.preferred.on;
  const rate = (r: Rates) =>
    `${formatNumber(r.first)}% on the first year, ${formatNumber(r.renewal)}% on renewals${result.typical.once ? `, ${formatNumber(r.once)}% on one-off products` : ''}`;
  const registeredYears = result.years.filter((y) => y.tier === 'registered').map((y) => y.year);
  const preferredCost = preferredOn ? v.costs.filter((x) => x.when === 'preferred').reduce((sum, x) => sum + x.amount, 0) : 0;
  const rule = preferredRule(v.preferred, v.currency);
  const costs = v.costs.filter((x) => x.when !== 'preferred' || preferredOn);
  const dealsWord = roles.closes ? 'New deals' : roles.services ? 'New customers you serve' : 'Deals from your introductions';
  const share = servicesShare(v);
  const when: Record<When, string> = { start: ', once at the start', yearly: ' every year', preferred: ` every year as ${pref}` };
  const id = (part: string) => `one-page-${part}`;

  return (
    <article className="mx-auto max-w-[840px] rounded-xl border border-line bg-surface p-[22px] shadow-[0_8px_30px_rgba(18,22,20,.06)] [-webkit-print-color-adjust:exact] [print-color-adjust:exact] min-[700px]:px-10 min-[700px]:py-9 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <p className="text-xs font-semibold tracking-[.06em] text-brand-strong uppercase">{`Business case · ${partnership(v.type.name)}`}</p>
      <h1 className="mt-1 mb-1.5 text-[26px] leading-tight font-semibold tracking-tight break-words print:text-2xl">
        {`What partnering with ${vendor} is worth to ${partner}`}
      </h1>
      <p className="text-sm text-ink-3">{`Over ${years} years, on the plan we agreed together (${v.scenario} scenario).`}</p>

      <div className="mt-4 mb-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3 print:mt-3 print:mb-2 print:grid-cols-3">
        <Stat label={`${capitalize(result.word)} from ${vendor}`} value={money(result.earnings)} />
        {roles.services
          ? <Stat label="Your own services" value={money(result.services)} />
          : <Stat label={`Your customers by year ${years}`} value={formatNumber(Math.round(result.years[years - 1]?.customers ?? 0))} />}
        <Stat label="Your profit after costs" value={money(result.profit)} negative={result.profit < 0}
          note={result.breakEven ? `pays for itself in year ${result.breakEven.year}, month ${result.breakEven.month}` : undefined} />
      </div>

      <StaticRevenueChart data={chartData(result)} currency={v.currency} height={240} printHeight={180} label={YOUR_CHART_LABEL} />

      <div className={TWO}>
        <Part id={id('benefits')} title="Beyond the money">
          {v.benefits.length > 0 ? v.benefits.map((b) => <li key={b}>{b}</li>) : <li>None picked yet</li>}
        </Part>
        {preferredOn ? (
          <Part id={id('tiers')} title="How you grow with us">
            {v.startsAs === 'preferred' ? (
              <>
                <li>{`You start as a ${pref} partner: ${rate(v.type.preferred)}.`}</li>
                {v.preferred.rule !== 'year' && (
                  <li>{`You stay ${pref} ${rule.charAt(0).toLowerCase()}${rule.slice(1)}. Below that you are ${reg}: ${rate(v.type.registered)}.`}</li>
                )}
                {preferredCost > 0 && <li>{`As ${pref}, extra costs of ${money(preferredCost)} a year.`}</li>}
                {registeredYears.length > 0 && <li>{`On this plan, you are ${reg} in ${yearList(registeredYears)}.`}</li>}
              </>
            ) : (
              <>
                <li>{`You start as a ${reg} partner: ${rate(v.type.registered)}.`}</li>
                <li>{`${rule} you become ${pref}: ${rate(v.type.preferred)}.`}</li>
                {preferredCost > 0 && <li>{`As ${pref}, extra costs of ${money(preferredCost)} a year.`}</li>}
                {result.preferredFrom !== null && <li>{`On this plan, that happens in year ${result.preferredFrom}.`}</li>}
              </>
            )}
          </Part>
        ) : (
          <Part id={id('earn')} title="What you earn">
            <li>{`${capitalize(result.word)}: ${rate(v.type.registered)}.`}</li>
          </Part>
        )}
      </div>
      <div className={TWO}>
        <Part id={id('plan')} title="The plan">
          <li>{`${dealsWord} per year: ${result.years.map((y) => formatNumber(y.deals)).join(', ')}.`}</li>
          <li>{describeTypicalCustomer(result.typical, v.currency)}</li>
          <li>{`${formatNumber(v.renewal)}% of customers renew each year.`}</li>
        </Part>
        <Part id={id('who')} title="Who does what">
          {roleLines(roles, 'You', vendor).map((line) => <li key={line}>{`${line}.`}</li>)}
          {roles.services && (
            <>
              <li>{`Implementation: ${money(v.services.implementation)} per new customer.`}</li>
              {v.services.managed > 0 && <li>{`Managed service: ${money(v.services.managed)} per customer and month.`}</li>}
              {v.services.other > 0 && <li>{`Other sales: ${money(v.services.other)} per new customer.`}</li>}
              <li>{`Your profit on services: ${formatNumber(v.services.serviceProfit)}%.`}</li>
              {share && <li>{`${vendor} takes ${servicesShare(v, ' of your services')}.`}</li>}
            </>
          )}
          {roles.support !== 'none' && <li>{`Your support cost: ${money(v.services.supportCost)} per customer a year.`}</li>}
        </Part>
      </div>
      <div className={TWO}>
        {/* Keyed by place: a cost line has no id here. */}
        <Part id={id('costs')} title="What it costs you">
          {costs.map((x, i) => <li key={i}>{`${x.name}: ${money(x.amount)}${when[x.when]}.`}</li>)}
          {v.type.fee > 0 && <li>{`Partner fee: ${money(v.type.fee)} every year.`}</li>}
          {share && <li>{`Share of your services to ${vendor}: ${share}.`}</li>}
          {costs.length === 0 && !share && !(v.type.fee > 0) && <li>No costs on this plan.</li>}
        </Part>
        <Part id={id('payback')} title="When it pays back">
          <li>{result.breakEven ? `In year ${result.breakEven.year}, month ${result.breakEven.month}.` : 'Not within five years on this plan.'}</li>
          <li>{`Total costs over five years: ${money(result.years.reduce((sum, y) => sum + y.costs, 0))}.`}</li>
        </Part>
      </div>

      <footer className="mt-6 flex flex-wrap justify-between gap-3 border-t border-line pt-3 text-xs text-ink-3 print:mt-4">
        <span>{`Prepared by ${vendor} with ${partner}`}</span>
        <span>Estimates, not a promise of revenue</span>
      </footer>
    </article>
  );
}

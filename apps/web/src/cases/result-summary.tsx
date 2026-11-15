// The level names come from the case's program (`offer.levels`) where the Business Case app wrote Registered and Preferred.
import type { BusinessCase as Case, CaseResult, Currency, PreferredConditions } from '@partner-desk/core';
import { cn } from '@/ui/cn';
import { formatMoney, formatNumber } from './format';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "A typical customer is worth €24,000 a year plus €4,000 once." */
export function describeTypicalCustomer(typical: { yearly: number; once: number }, currency: Currency): string {
  const once = typical.once ? ` plus ${formatMoney(typical.once, currency)} once` : '';
  return `A typical customer is worth ${formatMoney(typical.yearly, currency)} a year${once}.`;
}

/** A headline number in its card, named by its label. `small`: a value in words ("Year 2, month 2"), a size smaller. */
export function Stat({ label, value, note, negative, small }: { label: string; value: string; note?: string; negative?: boolean; small?: boolean }) {
  return (
    <div role="group" aria-label={label} className="min-w-0 rounded-xl border border-line bg-surface px-4 py-3.5 print:px-3 print:py-1">
      <p className="text-[12.5px] break-words text-ink-3 print:text-xs">{label}</p>
      <p className={cn('mt-0.5 leading-tight font-semibold tracking-tight tabular-nums', small ? 'text-[22px] print:text-base' : 'text-[26px] print:text-xl', negative && 'text-danger')}>{value}</p>
      {note && <p className="text-[12.5px] text-ink-2 print:text-xs">{note}</p>}
    </div>
  );
}

/** The look of a call-out under the headline numbers. */
export const CALLOUT = {
  good: 'bg-brand-soft text-brand-strong',
  info: 'bg-surface-2 text-ink-2',
  warn: 'bg-warn-soft text-warn',
} as const;

/** How a partner becomes Preferred, in words: "With 8 deals in a year", "From year 3". */
export function preferredRule(preferred: PreferredConditions, currency: Currency): string {
  if (preferred.rule === 'year') return `From year ${preferred.year}`;
  return preferred.rule === 'deals'
    ? `With ${formatNumber(preferred.deals)} deals in a year`
    : `With ${formatMoney(preferred.revenue, currency)} in revenue in a year`;
}

type Callout = { kind: keyof typeof CALLOUT; text: string };

/**
 * What being Preferred does to the case (spec §6), or nothing while the offer has no Preferred conditions: when the
 * partner becomes Preferred and what it adds after its extra costs, a warning when it costs more than it brings, or
 * the rule the partner doesn't meet on this plan.
 */
function preferredCallout(result: CaseResult, c: Case, money: (n: number) => string): Callout | null {
  const preferred = c.offer.preferred;
  const { registered: reg, preferred: pref } = c.offer.levels;
  if (!preferred.on) return null;
  const years = result.years.length;
  const adds = result.preferredAdds;
  const extraCosts = c.costs.some((x) => x.when === 'preferred' && x.amount > 0) ? ', after its extra costs' : '';
  const kind = adds >= 0 ? 'good' : 'warn';
  if (c.startsAs === 'preferred') {
    const worth = adds >= 0 ? `Keeping the tier is worth ${money(adds)}` : `Keeping the tier costs ${money(-adds)} more than it brings`;
    return { kind, text: `★ Starts as ${pref}. ${worth} over ${years} years${extraCosts}.` };
  }
  if (result.preferredFrom !== null) {
    const worth = adds >= 0 ? `Being ${pref} adds ${money(adds)}` : `Being ${pref} costs ${money(-adds)} more than it brings`;
    return { kind, text: `★ ${pref} from year ${result.preferredFrom}. ${worth} over ${years} years${extraCosts}.` };
  }
  return { kind: 'info', text: `Stays ${reg} on this plan. ${preferredRule(preferred, c.offer.currency)} the partner becomes ${pref}.` };
}

/**
 * The partner case's three headline numbers, and the call-outs under them. The second number is the partner's own
 * services for a type that delivers them, else the customers by the last year (spec §4).
 */
export function ResultSummary({ result, case: c }: { result: CaseResult; case: Case }) {
  const offer = c.offer;
  const money = (n: number) => formatMoney(n, offer.currency);
  const years = result.years.length;
  const vendor = offer.company;
  const partner = c.partner.trim() || 'the partner';
  const services = offer.types.find((t) => t.id === c.typeId)?.roles.services ?? false;
  const callouts: Callout[] = [];
  const preferred = preferredCallout(result, c, money);
  if (preferred) callouts.push(preferred);
  if (!result.breakEven) {
    callouts.push({ kind: 'warn', text: 'On these numbers the partner doesn’t earn back the investment. Look at the terms or the start costs.' });
  }
  callouts.push({ kind: 'info', text: `${vendor} gets ${money(result.vendorRevenue)} in revenue through this partner, before what it pays the partner.` });

  return (
    <>
      <div className="mb-3.5 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label={`${capitalize(result.word)} from ${vendor}`} value={money(result.earnings)} note={`over ${years} years`} />
        {services ? (
          <Stat label="Partner services" value={money(result.services)}
            note={result.earnings > 0 ? `${(result.services / result.earnings).toFixed(1)}× the ${result.word}` : 'revenue'} />
        ) : (
          <Stat label={`Customers by year ${years}`} value={formatNumber(Math.round(result.years[years - 1]?.customers ?? 0))} note={`from ${partner}`} />
        )}
        <Stat label="Partner profit after costs" value={money(result.profit)} negative={result.profit < 0}
          note={result.breakEven ? `pays for itself in year ${result.breakEven.year}, month ${result.breakEven.month}` : 'not paid back yet'} />
      </div>
      <div className="mb-3.5 grid gap-2">
        {callouts.map((callout) => (
          <p key={callout.text} role="note" className={cn('rounded-[10px] px-3 py-2.5 text-sm font-medium break-words', CALLOUT[callout.kind])}>{callout.text}</p>
        ))}
      </div>
    </>
  );
}

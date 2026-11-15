import { cn } from '@/ui/cn';
import { CALLOUT, Stat } from '../result-summary';
import { moneyOf, numbersSay, paysBack, roiText, vendorName, verdictOf, yearsOf, type OurView } from './view';

/** Our case's three numbers (spec §7.2): net value after our costs, the return on what we invest, when it pays back. */
export function OurStats({ view }: { view: OurView }) {
  const money = moneyOf(view);
  const n = yearsOf(view);
  const vendor = vendorName(view.case);
  const P = view.ours.withPartner;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Stat label={`Net value to ${vendor}`} value={money(P.total)} note={`over ${n} years, after our costs`} negative={P.total < 0} />
      <Stat label="Return on what we invest" value={roiText(view.ours)} note={`on ${money(P.invest)} over ${n} years`} />
      <Stat label="Pays back" value={paysBack(P.payback)} note={`for ${vendor}`} small />
    </div>
  );
}

/** The both-sides verdict (spec §8.4) and what the numbers say (spec §8.5). */
export function OurCallouts({ view }: { view: OurView }) {
  const verdict = verdictOf(view);
  return (
    <div className="grid gap-2">
      <p role="note" className={cn('rounded-[10px] px-3 py-2.5 text-sm font-medium break-words', CALLOUT[verdict.kind])}>{verdict.text}</p>
      <p role="note" className={cn('rounded-[10px] px-3 py-2.5 text-sm font-medium break-words', CALLOUT.info)}>{numbersSay(view)}</p>
    </div>
  );
}

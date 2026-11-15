import { cn } from '@/ui/cn';
import { moneyOf, partnerName, paysBackIn, percent, vendorName, type OurView } from './view';

function Side({ label, value, note, negative }: { label: string; value: string; note: string; negative: boolean }) {
  return (
    <div role="group" aria-label={label} className="min-w-0">
      <p className="text-[12.5px] break-words text-ink-3">{label}</p>
      <p className={cn('text-[22px] leading-tight font-semibold tracking-tight tabular-nums', negative && 'text-danger')}>{value}</p>
      <p className="text-[12.5px] break-words text-ink-2">{note}</p>
    </div>
  );
}

/**
 * Good for both sides? (spec §7.2): the partner's profit from the partner case next to our net value, each with its
 * payback, and a bar with the split when it works for both.
 */
export function BothSides({ view }: { view: OurView }) {
  const money = moneyOf(view);
  const partner = partnerName(view.case);
  const vendor = vendorName(view.case);
  const theirs = view.partner.profit;
  const P = view.ours.withPartner;
  const v = view.ours.verdict;
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-4 @min-[420px]:grid-cols-2">
        <Side label={`${partner}, from the partner case`} value={money(theirs)} negative={theirs < 0}
          note={`profit after costs · ${paysBackIn(view.partner.breakEven)}`} />
        <Side label={`${vendor}, from our case`} value={money(P.total)} negative={P.total < 0}
          note={`net value after our costs · ${paysBackIn(P.payback)}`} />
      </div>
      {v.kind === 'both' && (
        <>
          <div data-bar aria-hidden className="mt-2.5 mb-1.5 flex h-3.5 overflow-hidden rounded-[7px] bg-surface-2">
            <span className="block h-full" style={{ width: `${v.partnerShare}%`, background: 'var(--s4)' }} />
            <span className="block h-full" style={{ width: `${100 - v.partnerShare}%`, background: 'var(--s1)' }} />
          </div>
          <ul aria-label="Split of the profit" className="flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
            <li className="flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: 'var(--s4)' }} />{`${partner} ${percent(v.partnerShare)}`}</li>
            <li className="flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: 'var(--s1)' }} />{`${vendor} ${percent(100 - v.partnerShare)}`}</li>
          </ul>
        </>
      )}
    </div>
  );
}

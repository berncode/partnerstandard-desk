import { CASE_SOURCES as SOURCES, type CaseSource as Source } from '@partner-desk/core';
import { cn } from '@/ui/cn';
import { formatNumber } from '../format';
import { SOURCE_LABEL } from '../source-label';
import { moneyOf, partnerName, percent, SOURCE_COLOR, sureLabel, type OurView } from './view';

const TAG: Record<Source, string> = {
  assumption: 'bg-warn-soft text-warn',
  finance: 'bg-brand-soft text-brand-strong',
  sales: 'bg-info-soft text-info',
  partner: 'bg-joint-soft text-joint',
  other: 'bg-surface-2 text-ink-2',
};

/** Where a number comes from, as a small tag after it. */
export function SourceTag({ source, className }: { source: Source; className?: string }) {
  return (
    <span className={cn('ml-1.5 inline-block rounded-[5px] px-1.5 py-px align-[1px] text-[11px] font-semibold whitespace-nowrap print:ml-1 print:px-1 print:py-0 print:text-[9.5px]', TAG[source], className)}>
      {SOURCE_LABEL[source]}
    </span>
  );
}

/**
 * How sure are these numbers? (spec §7.2, §8.6): the result by source as a bar with percentages, what rests on
 * assumptions and the biggest of them, our gross margin and deals won anyway with their sources, then every line of the
 * result with its source, biggest first (`list`; the one-pager leaves it out). With nothing in the result yet, no bar.
 */
export function HowSure({ view, list = true }: { view: OurView; list?: boolean }) {
  const money = moneyOf(view);
  const partner = partnerName(view.case);
  const o = view.case.ours;
  const { lines, shares } = view.ours.sure;
  const shown = SOURCES.filter((s) => shares[s] > 0);
  const biggest = lines.find((l) => l.source === 'assumption');
  const rests = lines.length === 0
    ? 'Nothing in the result yet.'
    : `${percent(shares.assumption)} of the result rests on assumptions.${biggest ? ` The biggest: ${sureLabel(biggest, partner)} (${money(biggest.amount)}).` : ''}`;
  return (
    <div>
      {shown.length > 0 && (
        <>
          <div data-bar aria-hidden className="mt-2.5 mb-1.5 print:mt-1.5 flex h-3.5 overflow-hidden rounded-[7px] bg-surface-2">
            {shown.map((s) => <span key={s} className="block h-full" style={{ width: `${shares[s]}%`, background: SOURCE_COLOR[s] }} />)}
          </div>
          <ul aria-label="By source" className="mb-1 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
            {shown.map((s) => (
              <li key={s} className="flex items-center gap-1.5">
                <i aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: SOURCE_COLOR[s] }} />
                {`${SOURCE_LABEL[s]} ${percent(shares[s])}`}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="mt-2 text-[13px] break-words text-ink-2 print:mt-1 print:text-[11px]">
        {`${rests} Gross margin ${formatNumber(o.figures.margin)}% `}<SourceTag source={o.figures.marginSource} className="ml-0" />
        {`, deals we’d win anyway ${formatNumber(o.anyway)}% `}<span className="whitespace-nowrap"><SourceTag source={o.anywaySource} className="ml-0" />.</span>
      </p>
      {list && lines.length > 0 && (
        <ul aria-label="What the result rests on" className="mt-3 text-[13px]">
          {lines.map((line) => (
            <li key={line.key} className="flex justify-between gap-3 border-t border-line py-1.5">
              <span className="min-w-0 break-words">{sureLabel(line, partner)}<SourceTag source={line.source} /></span>
              <span className={cn('whitespace-nowrap tabular-nums', line.amount < 0 && 'text-danger')}>{money(line.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

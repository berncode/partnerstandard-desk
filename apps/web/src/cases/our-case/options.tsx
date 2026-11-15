import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/ui/cn';
import { AXIS_GAP, axisRange, axisWidth, shortMoney } from '../static-revenue-chart';
import { moneyOf, optionsOf, paysBack, yearsOf, type OurView } from './view';

/** Room above the plot, so the top axis label and a dot at the top aren't cut off. */
const TOP = 10;
/** The row of year labels under the plot. */
const YEARS = 30;
/** The row of year labels on paper, where every line counts. */
const PRINT_YEARS = 18;

export const OPTIONS_CHART_LABEL = 'Net value so far for each option';

/**
 * The options as three lines (spec §7.2): net value so far for With <partner>, Alone and Don't do it, with its legend.
 * The axis follows the rule of every chart (axisRange, spec §10a). Not a client component: drawn on the server without
 * measuring, like the partner's static chart (an SVG stretched to the plot, with the labels and dots in HTML).
 */
export function OptionsChart({ view, height = 260, printHeight = height, heading, legendOnPaper = true }: {
  view: OurView; height?: number; printHeight?: number;
  /** A heading the legend sits beside, where there is room for both on one line. */
  heading?: ReactNode;
  /** False where the options table, with the same colours and names, sits right under the chart on paper. */
  legendOnPaper?: boolean;
}) {
  const options = optionsOf(view);
  const n = yearsOf(view);
  const currency = view.case.offer.currency;
  const all = options.flatMap((o) => o.result.years.map((y) => y.netSoFar));
  const { ticks, top, bottom } = axisRange(Math.min(0, ...all), Math.max(1, ...all));
  const labels = ticks.map((v) => shortMoney(v, currency));
  const at = (v: number) => ((top - v) / (top - bottom)) * 100;
  const band = 100 / n;
  const cx = (i: number) => (i + 0.5) * band;
  const plot = (h: number, years: number) => `${Math.max(0, h - TOP - years)}px`;
  const heights = { '--plot': plot(height, YEARS), '--plot-print': plot(printHeight, PRINT_YEARS) } as CSSProperties;
  const plotHeight = 'h-(--plot) print:h-(--plot-print)';

  const legend = (
    <ul aria-label="Legend" className={cn('mt-1.5 mb-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2 print:mt-1 print:mb-1', !legendOnPaper && 'print:hidden')}>
      {options.map((o) => (
        <li key={o.key} className="flex items-center gap-1.5">
          <i aria-hidden className="inline-block h-[3px] w-3.5 rounded-sm" style={{ background: o.color }} />
          {o.name}
        </li>
      ))}
    </ul>
  );

  return (
    <div>
      {heading ? <div className="flex flex-wrap items-center justify-between gap-x-4">{heading}{legend}</div> : legend}
      <div role="img" aria-label={OPTIONS_CHART_LABEL} className="flex" style={{ paddingTop: TOP, ...heights }}>
        <div aria-hidden className={`relative shrink-0 ${plotHeight}`} style={{ width: axisWidth(labels) }}>
          {ticks.map((v, i) => (
            <span key={v} data-tick className="absolute -translate-y-1/2 text-xs whitespace-nowrap text-ink-3 tabular-nums" style={{ top: `${at(v)}%`, right: AXIS_GAP }}>
              {labels[i]}
            </span>
          ))}
        </div>
        <div className="mr-3 min-w-0 flex-1">
          <div className={`relative ${plotHeight}`}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="absolute inset-0 block size-full overflow-visible">
              {ticks.map((v) => (
                <line key={v} x1={0} x2={100} y1={at(v)} y2={at(v)} stroke={v === 0 ? 'var(--ink-3)' : 'var(--line)'} vectorEffect="non-scaling-stroke" />
              ))}
              {options.map((o) => (
                <polyline key={o.key} points={o.result.years.map((y, i) => `${cx(i)},${at(y.netSoFar)}`).join(' ')} fill="none" stroke={o.color}
                  strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            {options.flatMap((o) => o.result.years.map((y, i) => (
              <span key={`${o.key}-${y.year}`} aria-hidden className="absolute size-2 -translate-1/2 rounded-full border-[1.5px] border-surface box-content"
                style={{ left: `${cx(i)}%`, top: `${at(y.netSoFar)}%`, background: o.color }} />
            )))}
          </div>
          <div aria-hidden className="grid min-h-(--years) text-center text-xs text-ink-3 print:min-h-(--years-print)"
            style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, '--years': `${YEARS}px`, '--years-print': `${PRINT_YEARS}px` } as CSSProperties}>
            {options[0]?.result.years.map((y) => <span key={y.year} className="pt-2 whitespace-nowrap print:pt-0.5">{`Year ${y.year}`}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * The options as a table (spec §7.2): net value, what we invest, pays back and the strategic reasons each covers, the
 * best net value highlighted. Where five columns don't fit (a phone), each option is listed on its own.
 */
export function OptionsTable({ view }: { view: OurView }) {
  const money = moneyOf(view);
  const n = yearsOf(view);
  const options = optionsOf(view);
  const best = view.ours.best;
  const total = view.case.ours.strategic.length;
  const rows = options.map((o) => ({
    ...o,
    net: money(o.result.total),
    invest: money(o.result.invest),
    pays: o.key === 'nothing' ? 'Nothing to pay back' : paysBack(o.result.payback),
    covered: `${o.reasons} of ${total}`,
  }));
  const head = ['Option', `Net value, ${n} years`, 'We invest', 'Pays back', 'Strategic reasons'];
  const cell = 'whitespace-nowrap border-b border-line px-2 py-2 text-right print:py-0.5';
  return (
    <div className="@container">
      <table aria-label="The options" className="hidden w-full border-collapse text-[13px] tabular-nums @min-[520px]:table print:text-[11px]">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={h} scope="col" className={cn(cell, 'align-bottom text-xs font-medium whitespace-normal text-ink-3 print:text-[10px]', i === 0 && 'pl-0 text-left', i === head.length - 1 && 'pr-0')}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.key}>
              <th scope="row" className={cn(cell, 'pl-0 text-left font-normal break-words whitespace-normal text-ink')}>
                <i aria-hidden className="mr-2 inline-block h-[3px] w-3.5 rounded-sm align-middle" style={{ background: o.color }} />
                {o.name}
              </th>
              <td data-best={o.key === best ? '' : undefined}
                className={cn(cell, o.key === best && 'font-semibold text-brand-strong', o.result.total < 0 && 'text-danger')}>{o.net}</td>
              <td className={cell}>{o.invest}</td>
              <td className={cell}>{o.pays}</td>
              <td className={cn(cell, 'pr-0')}>{o.covered}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-3 @min-[520px]:hidden">
        {rows.map((o) => (
          <div key={o.key} role="group" aria-label={o.name} className="min-w-0 rounded-xl bg-surface-2 p-3">
            <h3 className="mb-1.5 flex items-center text-[13px] font-semibold">
              <i aria-hidden className="mr-2 inline-block h-[3px] w-3.5 shrink-0 rounded-sm" style={{ background: o.color }} />
              <span className="min-w-0 break-words">{o.name}</span>
            </h3>
            <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 text-[13px] tabular-nums">
              <dt className="py-0.5">{head[1]}</dt>
              <dd className={cn('py-0.5 text-right', o.key === best && 'font-semibold text-brand-strong', o.result.total < 0 && 'text-danger')}>{o.net}</dd>
              <dt className="py-0.5">{head[2]}</dt><dd className="py-0.5 text-right">{o.invest}</dd>
              <dt className="py-0.5">{head[3]}</dt><dd className="py-0.5 text-right">{o.pays}</dd>
              <dt className="py-0.5">{head[4]}</dt><dd className="py-0.5 text-right">{o.covered}</dd>
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

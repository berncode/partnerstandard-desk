import type { CSSProperties } from 'react';
import type { CaseResult, Currency, EarningsWord, YearResult } from '@partner-desk/core';
import { CURRENCY_SIGN } from './format';

export type SourceKey = 'newEarnings' | 'renewalEarnings' | 'implementation' | 'managed' | 'other';
export interface Source {
  key: SourceKey;
  label: string;
  /** A chart series token from globals.css. */
  color: string;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Where the partner's revenue comes from, in the order the bars stack. */
export function sources(word: EarningsWord): Source[] {
  return [
    { key: 'newEarnings', label: `${capitalize(word)}, new customers`, color: 'var(--s1)' },
    { key: 'renewalEarnings', label: `${capitalize(word)}, renewals`, color: 'var(--s2)' },
    { key: 'implementation', label: 'Implementation', color: 'var(--s3)' },
    { key: 'managed', label: 'Managed service', color: 'var(--s4)' },
    { key: 'other', label: 'Other sales', color: 'var(--s5)' },
  ];
}

/** What the chart draws for a year, and nothing more. */
export type ChartYear = Pick<YearResult, 'year' | 'tier' | SourceKey | 'revenue' | 'profitSoFar'>;
/** What the chart draws: a CaseResult is one, and `chartData` cuts a CaseResult down to it. */
export interface ChartData { word: EarningsWord; years: ChartYear[] }

/** Only what the chart draws, so a chart sent to the browser carries nothing else of the case. */
export function chartData(result: CaseResult): ChartData {
  return {
    word: result.word,
    years: result.years.map(({ year, tier, newEarnings, renewalEarnings, implementation, managed, other, revenue, profitSoFar }) =>
      ({ year, tier, newEarnings, renewalEarnings, implementation, managed, other, revenue, profitSoFar })),
  };
}

/** The sources that bring in something in at least one year. */
export const shownSources = (data: ChartData): Source[] =>
  sources(data.word).filter((s) => data.years.some((y) => y[s.key] > 0));

/** Round axis steps: 1, 2, 2.5 or 5 times a power of ten, and never less than 1 (amounts are whole). */
export function niceTicks(lo: number, hi: number, target = 5): number[] {
  const raw = (hi - lo) / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw || 1));
  const steps = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).filter((s) => magnitude < 1 || Number.isInteger(s));
  const step = Math.max(1, steps.find((s) => s >= raw) ?? steps[steps.length - 1] ?? 1);
  const first = Math.floor(lo / step);
  const last = Math.ceil(hi / step);
  return Array.from({ length: last - first + 1 }, (_, k) => Math.round((first + k) * step));
}

/** An axis amount: €250k, €1.25m, -$25k, CHF 500; 250k without a currency (a review whose case's currency isn't known). */
export function shortMoney(n: number, currency: Currency | null): string {
  const a = Math.abs(n);
  const sign = currency ? CURRENCY_SIGN[currency] : '';
  const prefix = `${n < 0 ? '-' : ''}${sign}${sign.length > 1 ? ' ' : ''}`;
  if (a >= 1e6) return `${prefix}${Number((a / 1e6).toFixed(2))}m`;
  if (a >= 1e3) return `${prefix}${Number((a / 1e3).toFixed(2))}k`;
  return `${prefix}${Math.round(a)}`;
}

/** Room between an axis label and the plot. */
export const AXIS_GAP = 10;
/** A safe width per character of a 12 px axis label: wider than any digit, sign or letter it uses ("CHF", "k", "m"). */
const AXIS_CHAR = 7.5;

/**
 * The room the axis labels need on the left: the longest label at a safe width per character, the gap, and a little
 * margin, so "-CHF 250k" is never cut off by the chart's edge.
 */
export function axisWidth(labels: string[]): number {
  const longest = Math.max(0, ...labels.map((l) => l.length));
  return Math.ceil(longest * AXIS_CHAR) + AXIS_GAP + 4;
}

/** The chart's name for screen readers on the vendor's screens. */
export const CHART_LABEL = 'Partner revenue per year by source, with profit so far';
/** The same on a page the partner sees (spec §10). */
export const YOUR_CHART_LABEL = 'Your revenue per year by source, with your profit so far';

/**
 * The axis range (spec §10a): round steps from `lo` to `hi`, but a loss under half a step gets a small margin under the
 * zero line (an eighth of a step) instead of a whole empty step, so a loss of a few thousand doesn't stretch the axis to
 * a round number far below it. Ticks are then drawn only from zero up. `bottom` and `top` are the plot's edges.
 */
export function axisRange(lo: number, hi: number): { ticks: number[]; top: number; bottom: number } {
  const ticks = niceTicks(lo, hi);
  // niceTicks always gives at least one tick (PartnerStandard Desk's stricter compiler can't see it).
  const first = ticks[0] ?? 0;
  const top = ticks[ticks.length - 1] ?? 0;
  const step = ticks.length > 1 ? (ticks[1] ?? 0) - first : 1;
  if (lo < 0 && first < 0 && -lo < step / 2) return { ticks: ticks.filter((v) => v >= 0), top, bottom: lo - step / 8 };
  return { ticks, top, bottom: first };
}

/** The axis: from the lowest profit so far (or 0) to the highest revenue or profit, by axisRange, and its labels. */
export function axisFor(data: ChartData, currency: Currency) {
  const rows = data.years;
  const { ticks, top, bottom } = axisRange(Math.min(0, ...rows.map((r) => r.profitSoFar)), Math.max(1, ...rows.map((r) => Math.max(r.revenue, r.profitSoFar))));
  return { ticks, labels: ticks.map((v) => shortMoney(v, currency)), top, bottom };
}

/** The partner's profit line, named for the vendor's screens. */
export const PARTNER_PROFIT = 'Partner profit so far, after costs';
/** The same line on a page the partner sees (spec §10). */
export const YOUR_PROFIT = 'Your profit so far, after costs';

/** The chart's legend: every source that brings money in, and the profit line, named `profit`. */
export function ChartLegend({ data, profit }: { data: ChartData; profit: string }) {
  return (
    <ul aria-label="Legend" className="mt-1.5 mb-2.5 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
      {shownSources(data).map((s) => (
        <li key={s.key} className="flex items-center gap-1.5">
          <i aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: s.color }} />
          {s.label}
        </li>
      ))}
      <li className="flex items-center gap-1.5">
        <i aria-hidden className="inline-block h-[3px] w-3.5 rounded-sm bg-ink" />
        {profit}
      </li>
    </ul>
  );
}

/** Room above the plot, so the top axis label and a dot at the top aren't cut off. */
const FLUID_TOP = 10;
/** The row of year labels under the plot. */
const FLUID_YEARS = 30;

/**
 * The revenue chart without hover (the one-page case, which the partner sees: the profit line is "Your profit"), with its
 * legend. Not a client component: it renders on the
 * server and sends the browser no data, only the drawing. Drawn without measuring, so it is the right width from the
 * first paint. The bars, grid and profit line are an SVG whose viewBox (0 to 100 both ways) stretches to the plot; the
 * axis labels, year labels and dots are HTML laid out in percentages of it, so text stays at its size on a phone and on
 * paper, and a narrow year wraps its star.
 */
export function StaticRevenueChart({ data, currency, height = 320, printHeight = height, profit = YOUR_PROFIT, label = CHART_LABEL }: {
  data: ChartData; currency: Currency; height?: number;
  /** The profit line's name in the legend. */
  profit?: string;
  /** The chart's name for screen readers: YOUR_CHART_LABEL on a page the partner sees. */
  label?: string;
  /** On paper. */
  printHeight?: number;
}) {
  const rows = data.years;
  const shown = shownSources(data);
  const { ticks, labels, top, bottom } = axisFor(data, currency);
  const at = (v: number) => ((top - v) / (top - bottom)) * 100; // % down from the top of the plot
  const band = 100 / rows.length;
  const barWidth = band * 0.55;
  const cx = (i: number) => (i + 0.5) * band;
  const plot = (h: number) => `${Math.max(0, h - FLUID_TOP - FLUID_YEARS)}px`;
  // The plot's height on screen and on paper; the class picks one.
  const heights = { '--plot': plot(height), '--plot-print': plot(printHeight) } as CSSProperties;
  const plotHeight = 'h-(--plot) print:h-(--plot-print)';

  return (
    <div>
      <ChartLegend data={data} profit={profit} />
      <div role="img" aria-label={label} className="flex" style={{ paddingTop: FLUID_TOP, ...heights }}>
        <div data-axis aria-hidden className={`relative shrink-0 ${plotHeight}`} style={{ width: axisWidth(labels) }}>
          {ticks.map((v, i) => (
            <span key={v} data-tick className="absolute -translate-y-1/2 text-xs whitespace-nowrap text-ink-3 tabular-nums"
              style={{ top: `${at(v)}%`, right: AXIS_GAP }}>
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
              {rows.map((r, i) => {
                let stacked = 0;
                return shown.map((s) => {
                  const value = r[s.key];
                  if (value <= 0) return null;
                  const bar = (
                    <rect key={`${r.year}-${s.key}`} x={cx(i) - barWidth / 2} y={at(stacked + value)} width={barWidth}
                      height={Math.max(0, at(stacked) - at(stacked + value))} fill={s.color} />
                  );
                  stacked += value;
                  return bar;
                });
              })}
              <polyline points={rows.map((r, i) => `${cx(i)},${at(r.profitSoFar)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={2.5}
                strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            </svg>
            {rows.map((r, i) => (
              <span key={r.year} aria-hidden
                className={`absolute size-[10.5px] -translate-1/2 rounded-full border-[1.5px] border-surface ${r.profitSoFar < 0 ? 'bg-danger' : 'bg-ink'}`}
                style={{ left: `${cx(i)}%`, top: `${at(r.profitSoFar)}%` }} />
            ))}
          </div>
          <div aria-hidden className="grid text-center text-xs text-ink-3" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))`, minHeight: FLUID_YEARS }}>
            {rows.map((r) => (
              <span key={r.year} className="pt-2">
                <span className="whitespace-nowrap">{`Year ${r.year}`}</span>
                {r.tier === 'preferred' ? ' ★' : ''}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

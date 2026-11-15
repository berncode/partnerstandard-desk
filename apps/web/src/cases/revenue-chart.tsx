'use client';

// The level names come from the case's program (`levels`) where the Business Case app wrote Registered and Preferred.
import { useEffect, useId, useRef, useState, type FocusEvent, type PointerEvent, type RefObject } from 'react';
import type { CaseOffer, CaseResult, Currency, YearResult } from '@partner-desk/core';
import { formatMoney } from './format';
import {
  AXIS_GAP, axisFor, axisWidth, CHART_LABEL, ChartLegend, chartData, PARTNER_PROFIT, shownSources, StaticRevenueChart, type Source,
} from './static-revenue-chart';

export { axisRange, axisWidth, niceTicks, shortMoney, shownSources, sources, type Source, type SourceKey } from './static-revenue-chart';

type Levels = CaseOffer['levels'];
const LEVELS: Levels = { registered: 'Registered', preferred: 'Preferred' };
const tierName = (y: YearResult, levels: Levels) => (y.tier === 'preferred' ? levels.preferred : levels.registered);
const TIP_WIDTH = 248;
const TIP_HEIGHT = 210;
const DEFAULT_WIDTH = 760;

/** The width of `ref`'s element, followed as it changes. */
function useWidth(ref: RefObject<HTMLElement | null>) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      if (el.clientWidth > 0) setWidth(el.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

/**
 * The partner's revenue per year, stacked by source, with a line for the profit so far. Interactive, each year shows
 * its breakdown on hover and on keyboard focus, with the year's tier when `tiers` (Preferred is on in the offer). The
 * one-page case shows it without (`interactive: false`), drawn to fit any width from the first paint: in
 * server-rendered HTML, on a phone and in print. A server-rendered page uses StaticRevenueChart directly, so no case
 * data goes to the browser.
 */
export function RevenueChart({ result, currency, interactive, tiers = false, levels = LEVELS, height = 320, printHeight = height }: {
  result: CaseResult; currency: Currency; interactive: boolean;
  /** The case's names for its two levels. */
  levels?: Levels;
  /** The offer has Preferred conditions on: the hover names each year's tier. */
  tiers?: boolean;
  height?: number;
  /** On paper, when not interactive. */
  printHeight?: number;
}) {
  if (!interactive) return <StaticRevenueChart data={chartData(result)} currency={currency} height={height} printHeight={printHeight} />;
  return (
    <div>
      <ChartLegend data={result} profit={PARTNER_PROFIT} />
      <MeasuredChart result={result} currency={currency} height={height} shown={shownSources(result)} tiers={tiers} levels={levels} />
    </div>
  );
}

interface DrawingProps { result: CaseResult; currency: Currency; height: number; shown: Source[]; tiers: boolean; levels: Levels }

/** Drawn in pixels at the measured width, with a hover target per year. */
function MeasuredChart({ result, currency, height, shown, tiers, levels }: DrawingProps) {
  const wrapper = useRef<HTMLDivElement>(null);
  const width = useWidth(wrapper);
  const tipId = useId();
  const [tip, setTip] = useState<{ index: number; x: number; y: number } | null>(null);

  const rows = result.years;
  const W = width;
  const H = height;
  const { ticks, labels, top, bottom } = axisFor(result, currency);
  const left = axisWidth(labels);
  const band = (W - left - 12) / rows.length;
  const narrow = band < 64; // "Year 1 ★" doesn't fit: the star goes on a second line
  const pad = { l: left, r: 12, t: 10, b: narrow ? 44 : 30 };
  const barWidth = Math.min(80, band * 0.55);
  const cx = (i: number) => pad.l + (i + 0.5) * band;
  const y = (v: number) => pad.t + ((top - v) / (top - bottom)) * (H - pad.t - pad.b);

  const place = (x: number, top: number) => ({
    x: Math.max(8, Math.min(x, window.innerWidth - TIP_WIDTH - 8)),
    y: Math.max(8, Math.min(top, window.innerHeight - TIP_HEIGHT - 8)),
  });
  const onPointer = (index: number) => (event: PointerEvent<SVGRectElement>) =>
    setTip({ index, ...place(event.clientX + 14, event.clientY + 14) });
  const onFocus = (index: number) => (event: FocusEvent<SVGRectElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    setTip({ index, ...place(box.left + box.width / 2, box.top + 24) });
  };
  const hide = () => setTip(null);

  const shownYear = tip ? rows[tip.index] : null;

  return (
    <>
      <div ref={wrapper} className="w-full">
        <svg width="100%" height={H} className="block overflow-hidden" role="group" aria-label={CHART_LABEL}>
          {ticks.map((v, i) => (
            <g key={v}>
              <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={v === 0 ? 'var(--ink-3)' : 'var(--line)'} />
              <text data-tick x={pad.l - AXIS_GAP} y={y(v) + 4} textAnchor="end" className="fill-ink-3 text-xs tabular-nums">{labels[i]}</text>
            </g>
          ))}
          {rows.map((r, i) => {
            let stacked = 0;
            return (
              <g key={r.year}>
                {shown.map((s) => {
                  const value = r[s.key];
                  if (value <= 0) return null;
                  const bar = (
                    <rect key={s.key} x={cx(i) - barWidth / 2} y={y(stacked + value)} width={barWidth}
                      height={Math.max(0, y(stacked) - y(stacked + value))} fill={s.color} />
                  );
                  stacked += value;
                  return bar;
                })}
                <text x={cx(i)} y={H - (narrow ? 22 : 8)} textAnchor="middle" className="fill-ink-3 text-xs">
                  {`Year ${r.year}${r.tier === 'preferred' && !narrow ? ' ★' : ''}`}
                </text>
                {narrow && r.tier === 'preferred' && <text x={cx(i)} y={H - 6} textAnchor="middle" className="fill-ink-3 text-xs">★</text>}
              </g>
            );
          })}
          <polyline points={rows.map((r, i) => `${cx(i)},${y(r.profitSoFar)}`).join(' ')} fill="none" stroke="var(--ink)" strokeWidth={2.5} strokeLinejoin="round" />
          {rows.map((r, i) => (
            <circle key={r.year} cx={cx(i)} cy={y(r.profitSoFar)} r={4.5} fill={r.profitSoFar < 0 ? 'var(--danger)' : 'var(--ink)'} stroke="var(--surface)" strokeWidth={1.5} />
          ))}
          {rows.map((r, i) => (
            <rect
              key={r.year}
              role="button"
              tabIndex={0}
              aria-label={`Year ${r.year}${r.tier === 'preferred' ? `, ${levels.preferred}` : ''}`}
              aria-describedby={tip?.index === i ? tipId : undefined}
              x={cx(i) - band / 2} y={pad.t} width={band} height={H - pad.t - pad.b}
              fill="transparent"
              className="cursor-default outline-none focus-visible:stroke-brand focus-visible:stroke-2"
              onPointerMove={onPointer(i)}
              onPointerLeave={hide}
              onFocus={onFocus(i)}
              onBlur={hide}
              onKeyDown={(event) => {
                if (event.key === 'Escape') hide();
              }}
            />
          ))}
        </svg>
      </div>
      {tip && shownYear && (
        <div
          id={tipId}
          role="tooltip"
          className="pointer-events-none fixed z-50 grid min-w-[230px] gap-0.5 rounded-lg bg-ink px-2.5 py-2 text-xs text-canvas tabular-nums shadow-lg"
          style={{ left: tip.x, top: tip.y, maxWidth: TIP_WIDTH }}
        >
          <b className="font-semibold">{`Year ${shownYear.year}${tiers ? ` · ${tierName(shownYear, levels)}` : ''} · ${shownYear.deals} new ${shownYear.deals === 1 ? 'deal' : 'deals'}`}</b>
          {shown.filter((s) => shownYear[s.key] > 0).map((s) => (
            <TipRow key={s.key} label={s.label} value={formatMoney(shownYear[s.key], currency)} />
          ))}
          <TipRow label="Partner costs" value={formatMoney(-shownYear.costs, currency)} />
          <TipRow label="Profit this year" value={formatMoney(shownYear.profit, currency)} strong />
          <TipRow label="Profit so far" value={formatMoney(shownYear.profitSoFar, currency)} />
        </div>
      )}
    </>
  );
}

function TipRow({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${strong ? 'font-semibold' : ''}`}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

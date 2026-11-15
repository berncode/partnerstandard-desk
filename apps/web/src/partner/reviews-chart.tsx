// New for PartnerStandard Desk (reviews spec 5.5): what we billed against the target at each held review, as pairs of bars. Drawn
// by hand like the business case's revenue chart (its axis helpers and its way of drawing: a stretched SVG for the bars,
// HTML for the text, so the words keep their size on a phone). No chart library.
import type { Currency, IsoDate } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { axisRange, axisWidth, AXIS_GAP, shortMoney } from '@/cases/static-revenue-chart';
import { formatMapDate } from '@/maps/format';

export interface ChartReview { reviewId: string; heldOn: IsoDate; billed: number; target: number }

const PLOT = 160;
const TOP = 10;
const LABELS = 34;

export function ReviewsChart({ reviews, currency, today }: { reviews: ChartReview[]; currency: Currency | null; today: IsoDate }) {
  const { ticks, top, bottom } = axisRange(0, Math.max(1, ...reviews.flatMap((r) => [r.billed, r.target])));
  const labels = ticks.map((v) => shortMoney(v, currency));
  const at = (v: number) => ((top - v) / (top - bottom)) * 100;
  const band = 100 / reviews.length;
  const bar = band * 0.22;
  const plot = { height: PLOT };
  return (
    <div>
      <ul aria-label="Legend" className="mb-2 flex flex-wrap gap-x-4 gap-y-1.5 text-[12.5px] text-ink-2">
        <li className="flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: 'var(--s1)' }} />{COPY.REVIEW_CHART_BILLED}</li>
        <li className="flex items-center gap-1.5"><i aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: 'var(--ink-3)' }} />{COPY.REVIEW_CHART_TARGET}</li>
      </ul>
      <div role="img" aria-label={COPY.REVIEW_CHART_LABEL} className="flex" style={{ paddingTop: TOP }}>
        <div aria-hidden className="relative shrink-0" style={{ ...plot, width: axisWidth(labels) }}>
          {ticks.map((v, i) => (
            <span key={v} className="absolute -translate-y-1/2 text-xs whitespace-nowrap text-ink-3 tabular-nums" style={{ top: `${at(v)}%`, right: AXIS_GAP }}>
              {labels[i]}
            </span>
          ))}
        </div>
        <div className="mr-3 min-w-0 flex-1">
          <div className="relative" style={plot}>
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden className="absolute inset-0 block size-full overflow-visible">
              {ticks.map((v) => (
                <line key={v} x1={0} x2={100} y1={at(v)} y2={at(v)} stroke={v === 0 ? 'var(--ink-3)' : 'var(--line)'} vectorEffect="non-scaling-stroke" />
              ))}
              {reviews.map((r, i) => {
                const mid = (i + 0.5) * band;
                return [
                  <rect key={`${r.reviewId}-b`} x={mid - bar} y={at(r.billed)} width={bar} height={Math.max(0, at(0) - at(r.billed))} fill="var(--s1)" />,
                  <rect key={`${r.reviewId}-t`} x={mid} y={at(r.target)} width={bar} height={Math.max(0, at(0) - at(r.target))} fill="var(--ink-3)" />,
                ];
              })}
            </svg>
          </div>
          <div aria-hidden className="grid text-center text-xs text-ink-3" style={{ gridTemplateColumns: `repeat(${reviews.length}, minmax(0, 1fr))`, minHeight: LABELS }}>
            {reviews.map((r) => <span key={r.reviewId} className="pt-2">{formatMapDate(r.heldOn, today)}</span>)}
          </div>
        </div>
      </div>
    </div>
  );
}

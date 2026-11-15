'use client';

// The levels are named as the case's program names them (`levels`), where the Business Case app always wrote Registered and Preferred.
import type { CaseOffer, CaseResult, Currency, YearResult } from '@partner-desk/core';
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { cn } from '@/ui/cn';
import { formatMoney } from './format';
import { shownSources } from './revenue-chart';

/** A row of a year-by-year table: a label, a cell per year and the total. */
export type YearLine = {
  label: string;
  cells: ReactNode[];
  total?: ReactNode;
  /** `sub`: smaller and lighter; `strong`: bold; `group`: a rule above it. */
  look?: Array<'sub' | 'strong' | 'group'>;
  /** Per year: shown in the danger color. */
  negative?: boolean[];
  totalNegative?: boolean;
  /** Left out of the per-year list on narrow screens (the table shows it). */
  tableOnly?: boolean;
};

/** A year: its column heading in the table, and its name and title when it is listed on its own. */
export type YearColumn = { key: number; head: string; name: string; title: string; tier?: ReactNode };

const noSubscription = () => () => {};

const sum = (rows: YearResult[], pick: (y: YearResult) => number) => rows.reduce((s, y) => s + pick(y), 0);

/** The level names a year's tier is shown with. */
type Levels = CaseOffer['levels'];
const LEVELS: Levels = { registered: 'Registered', preferred: 'Preferred' };

function Tier({ year, levels, onTint }: { year: YearResult; levels: Levels; onTint?: boolean }) {
  const preferred = year.tier === 'preferred';
  return (
    <span className={cn('inline-block rounded-[5px] px-1.5 py-px text-[11px] font-semibold', preferred ? 'bg-brand-soft text-brand-strong' : onTint ? 'bg-surface text-ink-2' : 'bg-surface-2 text-ink-2')}>
      {preferred ? levels.preferred : levels.registered}
    </span>
  );
}

/**
 * The table's rows. The Tier row only while Preferred is on (`tiers`): otherwise every year is the entry tier. The share
 * of the partner's services and the partner fee to `vendor` are part of the partner costs, under them when there are any.
 */
function lines(result: CaseResult, currency: Currency, tiers: boolean, vendor: string, levels: Levels): YearLine[] {
  const rows = result.years;
  const money = (n: number) => formatMoney(n, currency);
  const each = <T,>(cell: (y: YearResult) => T): T[] => rows.map(cell);
  const tier: YearLine = { label: 'Tier', cells: each((y) => <Tier year={y} levels={levels} />), look: ['sub'], tableOnly: true };
  /** A part of the partner costs, or nothing when it is zero over five years. */
  const part = (label: string, pick: (y: YearResult) => number): YearLine[] => {
    const total = sum(rows, pick);
    if (rows.every((y) => Math.round(pick(y)) === 0)) return [];
    return [{ label, cells: each((y) => money(-pick(y))), total: money(-total), look: ['sub'], negative: each((y) => Math.round(pick(y)) > 0), totalNegative: Math.round(total) > 0 }];
  };
  return [
    ...(tiers ? [tier] : []),
    { label: 'New deals', cells: each((y) => y.deals), total: sum(rows, (y) => y.deals), look: ['sub'] },
    { label: 'Customers at year end', cells: each((y) => Math.round(y.customers)), look: ['sub'] },
    ...shownSources(result).map((s): YearLine => ({ label: s.label, cells: each((y) => money(y[s.key])), total: money(sum(rows, (y) => y[s.key])) })),
    { label: 'Revenue', cells: each((y) => money(y.revenue)), total: money(sum(rows, (y) => y.revenue)), look: ['strong', 'group'] },
    { label: 'Partner costs', cells: each((y) => money(-y.costs)), total: money(-sum(rows, (y) => y.costs)), negative: each((y) => y.costs > 0), totalNegative: sum(rows, (y) => y.costs) > 0 },
    ...part(`Share of services to ${vendor}`, (y) => y.servicesToVendor),
    ...part(`Partner fee to ${vendor}`, (y) => y.fee),
    { label: 'Profit', cells: each((y) => money(y.profit)), total: money(result.profit), look: ['strong'], negative: each((y) => y.profit < 0), totalNegative: result.profit < 0 },
    { label: 'Profit so far', cells: each((y) => money(y.profitSoFar)), look: ['sub'], negative: each((y) => y.profitSoFar < 0) },
  ];
}

/**
 * The year-by-year numbers: a table where it fits, and otherwise each year on its own (a table that wide would scroll
 * sideways or stick out of its card). Whether it fits is measured, because the labels depend on the earnings word
 * ("Referral fee, new customers") and the amounts on the case. Until the page runs, a width that usually fits decides.
 */
export function YearTable({ result, currency, vendor, tiers = false, levels = LEVELS }: {
  result: CaseResult; currency: Currency;
  /** The case's names for its two levels. */
  levels?: Levels;
  /** The vendor's name, for the share of services and the partner fee it gets. */
  vendor: string;
  /** The offer has Preferred conditions on: a Tier row, and each year's tier when listed on its own. */
  tiers?: boolean;
}) {
  const columns = result.years.map((y): YearColumn => ({
    key: y.year,
    head: `Year ${y.year}${y.tier === 'preferred' ? ' ★' : ''}`,
    name: `Year ${y.year}${y.tier === 'preferred' ? `, ${levels.preferred}` : ''}`,
    title: `Year ${y.year}`,
    tier: tiers ? <Tier year={y} levels={levels} onTint /> : undefined,
  }));
  return (
    <FittedYears label="Year by year" columns={columns} lines={lines(result, currency, tiers, vendor, levels)}
      fit={[result, currency, vendor, levels.registered, levels.preferred]} />
  );
}

/**
 * Rows by year: a table where it fits, and otherwise each year on its own, then the totals (a table that wide would
 * scroll sideways or stick out of its card). Whether it fits is measured; until the page runs, a width that usually
 * fits decides. `fit` is what the lines are made from: when any of it changes, the table is tried again. `compact`
 * gives the table smaller cells and lets the row labels wrap, for a table with many rows and long labels.
 */
export function FittedYears({ label, columns, lines: all, fit, compact = false }: {
  label: string; columns: YearColumn[]; lines: YearLine[]; fit: readonly unknown[]; compact?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const table = useRef<HTMLTableElement>(null);
  const measuring = useSyncExternalStore(noSubscription, () => true, () => false); // false on the server's page
  /** The table didn't fit these lines at this width: shown by year until the box is that wide. */
  const [tooWide, setTooWide] = useState<{ fit: readonly unknown[]; needs: number } | null>(null);
  const known = tooWide !== null && tooWide.fit.length === fit.length && tooWide.fit.every((v, i) => v === fit[i]);
  /** `guess`: not measured yet (the server's page), so the container width decides. New numbers try the table again. */
  const mode = !measuring ? 'guess' : known ? 'years' : 'table';

  const check = () => {
    const el = table.current;
    const width = box.current?.clientWidth ?? 0;
    if (el && el.scrollWidth > width + 1) setTooWide({ fit, needs: el.scrollWidth });
    else if (!el && tooWide && width >= tooWide.needs) setTooWide(null);
  };
  // Measured before the screen shows it, so a table that doesn't fit never flashes.
  useLayoutEffect(() => {
    if (mode === 'table') check();
  });
  const onResize = useEffectEvent(check);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => onResize());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const showTable = mode !== 'years';
  const showYears = mode !== 'table';
  const pad = compact ? 'px-[5px] py-[7px]' : 'px-2 py-2';
  return (
    <div ref={box} className="@container">
      {showTable && (
      <table ref={table} aria-label={label}
        className={cn('w-full border-collapse tabular-nums', compact ? 'text-[12.5px]' : 'text-[13px]', mode === 'guess' && 'hidden @min-[600px]:table')}>
        <thead>
          <tr>
            <th className="border-b border-line py-2 pr-2.5 text-left" />
            {columns.map((y) => (
              <th key={y.key} scope="col" className={cn('whitespace-nowrap border-b border-line text-right text-xs font-medium text-ink-3', pad)}>
                {y.head}
              </th>
            ))}
            <th scope="col" className={cn('whitespace-nowrap border-b border-line pr-0 text-right text-xs font-medium text-ink-3', pad)}>Total</th>
          </tr>
        </thead>
        <tbody>
          {all.map((line) => {
            const sub = line.look?.includes('sub');
            const strong = line.look?.includes('strong');
            const group = line.look?.includes('group');
            const cell = cn('whitespace-nowrap border-b border-line text-right', pad, group && 'border-t border-t-ink-3', sub && 'text-[12.5px] text-ink-3', strong && 'font-semibold');
            return (
              <tr key={line.label}>
                <th scope="row" className={cn(cell, 'pl-0 pr-2.5 text-left font-normal', compact && 'min-w-[120px] whitespace-normal', strong && 'font-semibold', !sub && 'text-ink')}>{line.label}</th>
                {columns.map((y, i) => (
                  <td key={y.key} className={cn(cell, line.negative?.[i] && 'text-danger')}>{line.cells[i]}</td>
                ))}
                <td className={cn(cell, 'pr-0', line.totalNegative && 'text-danger')}>
                  {line.total ?? ''}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      )}

      {showYears && (
      <div className={cn('grid gap-3 @min-[420px]:grid-cols-2', mode === 'guess' && '@min-[600px]:hidden')}>
        {columns.map((y, i) => (
          <YearList key={y.key} name={y.name} title={y.title} tier={y.tier}
            items={all.filter((l) => !l.tableOnly).map((l) => ({ label: l.label, value: l.cells[i], negative: l.negative?.[i], look: l.look }))} />
        ))}
        <YearList name={`Total, ${columns.length} years`} title={`Total, ${columns.length} years`}
          items={all.filter((l) => l.total !== undefined).map((l) => ({
            label: l.label, value: l.total, look: l.look, negative: l.totalNegative,
          }))} />
      </div>
      )}
    </div>
  );
}

function YearList({ name, title, tier, items }: {
  name: string; title: string; tier?: ReactNode;
  items: Array<{ label: string; value: ReactNode; negative?: boolean; look?: YearLine['look'] }>;
}) {
  return (
    <div role="group" aria-label={name} className="min-w-0 rounded-xl bg-surface-2 p-3">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {tier}
      </div>
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] text-[13px] tabular-nums">
        {items.map((item) => (
          <div key={item.label} className={cn('contents', item.look?.includes('sub') && 'text-ink-3', item.look?.includes('strong') && 'font-semibold')}>
            <dt className={cn('min-w-0 py-0.5 pr-3', item.look?.includes('group') && 'mt-1 border-t border-line pt-1.5')}>{item.label}</dt>
            <dd className={cn('py-0.5 text-right', item.look?.includes('group') && 'mt-1 border-t border-line pt-1.5', item.negative && 'text-danger')}>{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

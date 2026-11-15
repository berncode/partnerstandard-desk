'use client';

import type { OurYear } from '@partner-desk/core';
import { FittedYears, type YearColumn, type YearLine } from '../year-table';
import { moneyOf, partnerName, type OurView } from './view';

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const sum = (years: OurYear[], pick: (y: OurYear) => number) => years.reduce((s, y) => s + pick(y), 0);

/**
 * Year by year, with <partner> (spec §7.2): from the revenue through the partner to our net value. Lines that are zero
 * over five years are left out, except the subtotal and net value. A table where it fits, else each year on its own.
 */
export function OurYearTable({ view }: { view: OurView }) {
  const money = moneyOf(view);
  const partner = partnerName(view.case);
  const years = view.ours.years;
  const o = view.case.ours;
  /** A line by year with its total, or null when it is zero over five years (unless it is `always` shown). */
  const line = (label: string, pick: (y: OurYear) => number, sign: 1 | -1, more: Partial<YearLine> = {}, always = false): YearLine | null => {
    const total = sum(years, pick);
    if (!always && years.every((y) => Math.round(pick(y)) === 0)) return null;
    return {
      label,
      cells: years.map((y) => money(sign * pick(y))),
      total: money(sign * total),
      negative: years.map((y) => Math.round(sign * pick(y)) < 0),
      totalNegative: Math.round(sign * total) < 0,
      ...more,
    };
  };
  const lines = [
    line('Revenue from these customers', (y) => y.revenue, 1),
    line('Revenue we’d have without the partner', (y) => y.anyway, -1),
    line(`${capitalize(view.partner.word)} to ${partner}`, (y) => y.share, -1),
    line('Cost to deliver', (y) => y.deliver, -1),
    line('From new revenue', (y) => y.fromNewRevenue, 1, { look: ['strong', 'group'] }, true),
    line(`Share of ${partner}’s services`, (y) => y.shareOfServices, 1),
    line(`Partner fee from ${partner}`, (y) => y.partnerFee, 1),
    line(`Our sales on ${partner}’s deals`, (y) => y.sales, -1),
    line('Support we provide', (y) => y.support, -1),
    line(`Support ${partner} takes over`, (y) => y.supportTaken, 1),
    line('Services', (y) => y.services, 1),
    o.efficiency.on ? line('More efficient', (y) => y.efficiency, 1) : null,
    o.churn.on ? line('Less churn', (y) => y.churn, 1) : null,
    line('Our costs', (y) => y.costs, -1),
    line('Net value', (y) => y.net, 1, { look: ['strong', 'group'] }, true),
    line('Net value so far', (y) => y.netSoFar, 1, { look: ['sub'], total: undefined }, true),
  ].filter((l): l is YearLine => l !== null);
  const columns = years.map((y): YearColumn => ({ key: y.year, head: `Year ${y.year}`, name: `Year ${y.year}`, title: `Year ${y.year}` }));
  return <FittedYears label={`Year by year, with ${partner}`} columns={columns} lines={lines} fit={[view]} compact />;
}

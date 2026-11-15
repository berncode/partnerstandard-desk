// @vitest-environment jsdom
import {
  type BusinessCase as Case, EXAMPLES, type PreferredConditions, simulateCase,
} from '@partner-desk/core';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { axisWidth, niceTicks, RevenueChart, shortMoney } from './revenue-chart';
import { axisFor, axisRange, chartData } from './static-revenue-chart';

const build = (patch: Partial<Case> = {}): Case => ({ ...structuredClone(EXAMPLES.saas.case), ...patch });
const saas = (patch: Partial<Case> = {}) => simulateCase(build(patch));
const preferredOn = (c: Case, p: Partial<PreferredConditions> = {}): Case => ({ ...c, offer: { ...c.offer, preferred: { ...c.offer.preferred, on: true, ...p } } });
const axis = (container: HTMLElement) => [...container.querySelectorAll('[data-tick]')].map((t) => t.textContent);
/** A reseller with more deals and a large start cost: a loss in year 1 of more than half a step, and a profit near 1m. */
const bigLoss = (currency: Case['offer']['currency'] = 'EUR') => {
  const c = build({ deals: [10, 14, 20, 27, 38], costs: [{ id: 'cost_1', name: 'Training', when: 'start', amount: 200_000 }] });
  c.offer.currency = currency;
  return simulateCase(c);
};
const nothing = () => simulateCase(build({
  deals: [0, 0, 0, 0, 0], implementation: 0, managed: 0, other: 0, serviceProfit: 0, supportCost: 0, costs: [],
  offer: { ...structuredClone(EXAMPLES.saas.case.offer), products: [], renewal: 0 },
}));

describe('niceTicks', () => {
  it('steps by 1, 2, 2.5 or 5 times a power of ten', () => {
    expect(niceTicks(0, 1_175_843)).toEqual([0, 250_000, 500_000, 750_000, 1_000_000, 1_250_000]);
    expect(niceTicks(-33_000, 410_000)).toEqual([-100_000, 0, 100_000, 200_000, 300_000, 400_000, 500_000]);
    expect(niceTicks(0, 1)).toEqual([0, 1]);
    expect(niceTicks(0, 9_000)).toEqual([0, 2_000, 4_000, 6_000, 8_000, 10_000]);
  });
});

describe('the axis (spec §10a): a small loss gets a small margin under zero, not a whole step', () => {
  it('starts at 0 for saas / expected, its bottom edge an eighth of a step under the loss in year 1', () => {
    const result = saas();
    const lo = result.years[0]!.profitSoFar;
    expect(Math.round(lo)).toBe(-17_700);
    const { ticks, top, bottom } = axisFor(chartData(result), 'EUR');
    const step = ticks[1]! - ticks[0]!;
    expect(ticks[0]).toBe(0);
    expect(top).toBe(500_000);
    expect(bottom).toBeLessThan(lo);
    expect(bottom).toBeGreaterThan(-step / 2);
    expect(bottom).toBe(lo - step / 8);
  });

  it('keeps a step below zero for a loss of half a step or more', () => {
    // A step of 100k: a loss of 50k is half a step.
    expect(axisRange(-50_000, 400_000)).toEqual({ ticks: [-100_000, 0, 100_000, 200_000, 300_000, 400_000], top: 400_000, bottom: -100_000 });
    expect(axisRange(-49_999, 400_000)).toEqual({ ticks: [0, 100_000, 200_000, 300_000, 400_000], top: 400_000, bottom: -49_999 - 12_500 });
  });

  it('has no margin under zero without a loss', () => {
    expect(axisRange(0, 9_000)).toEqual({ ticks: [0, 2_000, 4_000, 6_000, 8_000, 10_000], top: 10_000, bottom: 0 });
  });
});

describe('shortMoney', () => {
  it('shortens amounts for the axis, the sign before the number', () => {
    expect(shortMoney(0, 'EUR')).toBe('€0');
    expect(shortMoney(250_000, 'EUR')).toBe('€250k');
    expect(shortMoney(1_000_000, 'EUR')).toBe('€1m');
    expect(shortMoney(1_250_000, 'GBP')).toBe('£1.25m');
    expect(shortMoney(-25_000, 'USD')).toBe('-$25k');
    expect(shortMoney(500, 'CHF')).toBe('CHF 500');
    expect(shortMoney(250_000, 'CHF')).toBe('CHF 250k');
  });
});

describe('RevenueChart', () => {
  it('labels the axis in round steps for the SaaS example, from 0 for its small loss in year 1', () => {
    const { container } = render(<RevenueChart result={saas()} currency="EUR" interactive />);
    expect(axis(container)).toEqual(['€0', '€100k', '€200k', '€300k', '€400k', '€500k']);
  });

  it('draws the year 1 loss under the zero line and inside the plot', () => {
    const { container } = render(<RevenueChart result={saas()} currency="EUR" interactive />);
    const year1 = Number(container.querySelector('circle')!.getAttribute('cy'));
    const zero = Number(container.querySelector('line')!.getAttribute('y1'));
    expect(year1).toBeGreaterThan(zero);
    expect(year1).toBeLessThan(320 - 30); // above the row of year labels
  });

  it('names every source that brings money in, and the partner’s profit line, in the legend', () => {
    render(<RevenueChart result={simulateCase(structuredClone(EXAMPLES.onprem.case))} currency="EUR" interactive />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect([...legend.querySelectorAll('li')].map((li) => li.textContent)).toEqual([
      'Margin, new customers', 'Margin, renewals', 'Implementation', 'Other sales', 'Partner profit so far, after costs',
    ]);
  });

  it('leaves out a source that is 0 every year: a reseller has no services', () => {
    render(<RevenueChart result={saas()} currency="EUR" interactive />);
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(legend).not.toHaveTextContent('Implementation');
    expect(legend).not.toHaveTextContent('Managed service');
  });

  it('shows the breakdown of a year on hover and on keyboard focus, without a tier while Preferred is off', () => {
    render(<RevenueChart result={saas()} currency="EUR" interactive />);
    const year1 = screen.getByRole('button', { name: 'Year 1' });
    fireEvent.focus(year1);
    const tip = screen.getByRole('tooltip');
    expect(tip).toHaveTextContent('Year 1 · 3 new deals');
    expect(tip).not.toHaveTextContent(/Registered|Preferred/);
    expect(tip).toHaveTextContent('Partner costs-€33,900');
    expect(tip).toHaveTextContent('Profit so far');
    expect(year1).toHaveAttribute('aria-describedby', tip.id);
    fireEvent.blur(year1);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(screen.queryByText(/★/)).toBeNull();
  });

  it('names the tier and stars the Preferred years while Preferred is on', () => {
    const { container } = render(<RevenueChart result={simulateCase(preferredOn(build()))} currency="EUR" interactive tiers />);
    const year1 = screen.getByRole('button', { name: 'Year 1' });
    fireEvent.focus(year1);
    expect(screen.getByRole('tooltip')).toHaveTextContent('Year 1 · Registered · 3 new deals');
    fireEvent.blur(year1);
    const year4 = screen.getByRole('button', { name: 'Year 4, Preferred' });
    fireEvent.pointerMove(year4, { clientX: 100, clientY: 100 });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Year 4 · Preferred · 15 new deals');
    fireEvent.pointerLeave(year4);
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(container).toHaveTextContent('Year 4 ★');
  });

  it('has no hover targets when it is not interactive', () => {
    render(<RevenueChart result={saas()} currency="EUR" interactive={false} />);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });

  it('draws nothing as NaN when every input is 0', () => {
    const { container } = render(<RevenueChart result={nothing()} currency="EUR" interactive />);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
    expect(axis(container)).toEqual(['€0', '€1']);
  });
});

describe('the axis labels always fit', () => {
  const plotStart = (container: HTMLElement) => Number(container.querySelector('line')!.getAttribute('x1'));

  it('makes room for the longest label', () => {
    expect(axisWidth(['€0', '€1.25m'])).toBeGreaterThanOrEqual(59);
    expect(axisWidth(['-CHF 250k', 'CHF 1.25m'])).toBeGreaterThan(axisWidth(['-€250k', '€1.25m']));
  });

  it('starts the plot further right for CHF with a negative tick and a value of 1m', () => {
    const a = render(<RevenueChart result={bigLoss('EUR')} currency="EUR" interactive />);
    const b = render(<RevenueChart result={bigLoss('CHF')} currency="CHF" interactive />);
    expect(axis(b.container)).toContain('-CHF 250k');
    expect(axis(b.container)).toContain('CHF 1m');
    const longest = Math.max(...axis(b.container).map((t) => t!.length));
    expect(plotStart(b.container)).toBeGreaterThanOrEqual(longest * 7.5 + 10);
    expect(plotStart(b.container)).toBeGreaterThan(plotStart(a.container));
  });
});

describe('the chart on the one-page case (not interactive)', () => {
  const axisColumn = (container: HTMLElement) => Number.parseFloat(container.querySelector<HTMLElement>('[data-axis]')!.style.width);

  it('is drawn to fit any width without measuring: a viewBox scaled to its container, the labels as text beside it', () => {
    const result = simulateCase(preferredOn(build()));
    const { container } = render(<RevenueChart result={result} currency="EUR" interactive={false} />);
    const chart = screen.getByRole('img', { name: 'Partner revenue per year by source, with profit so far' });
    const svg = chart.querySelector('svg')!;
    expect(svg).toHaveAttribute('viewBox', '0 0 100 100');
    expect(svg).toHaveAttribute('preserveAspectRatio', 'none');
    expect(svg).not.toHaveAttribute('width');
    expect(axis(container)[0]).toBe('€0');
    expect(chart).toHaveTextContent('Year 1Year 2Year 3Year 4 ★Year 5 ★');
    const bars = result.years.flatMap((y) => [y.newEarnings, y.renewalEarnings, y.implementation, y.managed, y.other]).filter((v) => v > 0);
    expect(svg.querySelectorAll('rect')).toHaveLength(bars.length);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  it('calls the profit line the partner’s own, in “you” form', () => {
    render(<RevenueChart result={saas()} currency="EUR" interactive={false} />);
    expect(screen.getByRole('list', { name: 'Legend' })).toHaveTextContent('Your profit so far, after costs');
  });

  it('makes room for the longest axis label', () => {
    const chf = render(<RevenueChart result={bigLoss('CHF')} currency="CHF" interactive={false} />);
    const labels = axis(chf.container) as string[];
    expect(labels).toContain('-CHF 250k');
    expect(axisColumn(chf.container)).toBe(axisWidth(labels));
  });

  it('draws nothing as NaN when every input is 0', () => {
    const { container } = render(<RevenueChart result={nothing()} currency="EUR" interactive={false} />);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});

describe('chartData', () => {
  it('keeps only what the chart draws: no vendor revenue, deals, costs or customers', () => {
    const data = chartData(saas());
    expect(Object.keys(data)).toEqual(['word', 'years']);
    expect(Object.keys(data.years[0]!).sort()).toEqual(
      ['implementation', 'managed', 'newEarnings', 'other', 'profitSoFar', 'renewalEarnings', 'revenue', 'tier', 'year'],
    );
  });
});

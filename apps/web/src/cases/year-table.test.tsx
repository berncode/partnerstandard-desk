// @vitest-environment jsdom
import {
  type BusinessCase as Case, EXAMPLES, simulateCase,
} from '@partner-desk/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { YearTable } from './year-table';

const saas = () => simulateCase(structuredClone(EXAMPLES.saas.case));
const withPreferred = (): Case => {
  const c = structuredClone(EXAMPLES.saas.case);
  c.offer.preferred.on = true;
  return c;
};

const row = (table: HTMLElement, name: string) =>
  within(table).getByRole('rowheader', { name }).closest('tr')!;
const cells = (tr: HTMLElement) => [...tr.querySelectorAll('td')].map((td) => td.textContent);

describe('YearTable', () => {
  it('shows each year and the totals, with no tier while Preferred is off', () => {
    render(<YearTable result={saas()} currency="EUR" vendor="Acme" />);
    const table = screen.getByRole('table', { name: 'Year by year' });
    const headings = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headings).toEqual(['', 'Year 1', 'Year 2', 'Year 3', 'Year 4', 'Year 5', 'Total']);
    expect(within(table).queryByRole('rowheader', { name: 'Tier' })).toBeNull();
    expect(table).not.toHaveTextContent(/Registered|Preferred/);
    expect(cells(row(table, 'New deals'))).toEqual(['3', '7', '11', '15', '19', '55']);
    expect(cells(row(table, 'Partner costs'))[0]).toBe('-€33,900');
    expect(cells(row(table, 'Profit')).at(-1)).toBe('€479,507');
    expect(cells(row(table, 'Margin, new customers'))[0]).toBe('€16,200');
  });

  it('shows the share of services and the partner fee to the vendor as part of the partner costs, only when there are any', () => {
    const { unmount } = render(<YearTable result={saas()} currency="EUR" vendor="Acme" />);
    const plain = screen.getByRole('table', { name: 'Year by year' });
    expect(within(plain).queryByRole('rowheader', { name: /^Share of services to/ })).toBeNull();
    expect(within(plain).queryByRole('rowheader', { name: /^Partner fee to/ })).toBeNull();
    unmount();

    const services = simulateCase(structuredClone(EXAMPLES.services.case));
    const view = render(<YearTable result={services} currency="EUR" vendor="Cloudline" />);
    let table = screen.getByRole('table', { name: 'Year by year' });
    expect(cells(row(table, 'Partner fee to Cloudline'))).toEqual(['-€2,500', '-€2,500', '-€2,500', '-€2,500', '-€2,500', '-€12,500']);
    expect(within(table).queryByRole('rowheader', { name: 'Share of services to Cloudline' })).toBeNull();
    // Part of the partner costs: €10,000 start + €5,000 yearly + 5 × €250 support + €2,500 fee.
    expect(cells(row(table, 'Partner costs'))[0]).toBe('-€18,750');
    view.unmount();

    render(<YearTable result={simulateCase(structuredClone(EXAMPLES.onprem.case))} currency="EUR" vendor="Secura" />);
    table = screen.getByRole('table', { name: 'Year by year' });
    // 10% of 2 × (€25,000 + €5,000) of services in year 1, €900,000 over five years.
    expect(cells(row(table, 'Share of services to Secura'))).toEqual(['-€6,000', '-€12,000', '-€18,000', '-€24,000', '-€30,000', '-€90,000']);
    expect(within(table).queryByRole('rowheader', { name: 'Partner fee to Secura' })).toBeNull();
  });

  it('shows the tier and stars the Preferred years while Preferred is on', () => {
    render(<YearTable result={simulateCase(withPreferred())} currency="EUR" vendor="Acme" tiers />);
    const table = screen.getByRole('table', { name: 'Year by year' });
    const headings = within(table).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headings).toEqual(['', 'Year 1', 'Year 2', 'Year 3', 'Year 4 ★', 'Year 5 ★', 'Total']);
    expect(cells(row(table, 'Tier'))).toEqual(['Registered', 'Registered', 'Registered', 'Preferred', 'Preferred', '']);
  });

  it('lists each year on its own when the table doesn’t fit', () => {
    // jsdom has no layout: the table needs 700 px, the card gives it 300.
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'TABLE' ? 700 : 300;
    });
    const client = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    const { unmount } = render(<YearTable result={simulateCase(withPreferred())} currency="EUR" vendor="Acme" tiers />);
    expect(screen.queryByRole('table')).toBeNull();
    const total = screen.getByRole('group', { name: 'Total, 5 years' });
    expect(total).toHaveTextContent('Profit€669,279');
    expect(screen.getByRole('group', { name: 'Year 4, Preferred' })).toHaveTextContent('Preferred');
    expect(screen.getByRole('group', { name: 'Year 4, Preferred' })).toHaveTextContent('New deals15');
    unmount();

    render(<YearTable result={saas()} currency="EUR" vendor="Acme" />);
    expect(screen.getByRole('group', { name: 'Year 1' })).not.toHaveTextContent(/Registered|Preferred/);
    scroll.mockRestore();
    client.mockRestore();
  });

  it('shows only the table where it fits', () => {
    render(<YearTable result={saas()} currency="EUR" vendor="Acme" />);
    expect(screen.getByRole('table', { name: 'Year by year' })).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Total, 5 years' })).toBeNull();
  });
});

// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { EXAMPLES, emptyOurCase, type BusinessCase as Case } from '@partner-desk/core';
import { axisRange, shortMoney } from '../static-revenue-chart';
import { BothSides, HowSure, OptionsChart, OptionsTable, OurCallouts, OurStats, OurYearTable, ourView } from '.';

const saas = (): Case => structuredClone(EXAMPLES.saas.case);
/** Review Focus 3: our side with nothing in it (no costs, gross margin 0, everything off). */
const empty = (): Case => {
  const c = saas();
  c.deals = [0, 0, 0, 0, 0];
  c.costs = [];
  c.ours = emptyOurCase({ ...c.ours.figures, margin: 0, serve: { ...c.ours.figures.serve, find: 0, close: 0, support1: 0, support2: 0 } }, []);
  return c;
};
const group = (name: string) => screen.getByRole('group', { name });
const row = (table: HTMLElement, name: string) => within(table).getByRole('rowheader', { name }).closest('tr')!;
const cells = (tr: HTMLElement) => [...tr.querySelectorAll('td')].map((td) => td.textContent);

describe('OurStats', () => {
  it('shows the net value, the return on what we invest and when it pays back', () => {
    render(<OurStats view={ourView(saas())} />);
    expect(group('Net value to Acme')).toHaveTextContent('€1,433,415');
    expect(group('Net value to Acme')).toHaveTextContent('over 5 years, after our costs');
    expect(group('Return on what we invest')).toHaveTextContent('592%');
    expect(group('Return on what we invest')).toHaveTextContent('on €242,000 over 5 years');
    expect(group('Pays back')).toHaveTextContent('Year 2, month 2');
    expect(group('Pays back')).toHaveTextContent('for Acme');
  });

  it('shows n/a and Not within 5 years for a case with nothing in it, never NaN or Infinity (Review Focus 3)', () => {
    const { container } = render(
      <>
        <OurStats view={ourView(empty())} />
        <OurCallouts view={ourView(empty())} />
        <BothSides view={ourView(empty())} />
        <OptionsChart view={ourView(empty())} />
        <OptionsTable view={ourView(empty())} />
        <HowSure view={ourView(empty())} />
        <OurYearTable view={ourView(empty())} />
      </>,
    );
    expect(group('Return on what we invest')).toHaveTextContent('n/a');
    expect(group('Pays back')).toHaveTextContent('Not within 5 years');
    expect(container).not.toHaveTextContent(/NaN|Infinity/);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});

describe('OurCallouts', () => {
  it('says whether it works for both sides, and what the numbers say', () => {
    render(<OurCallouts view={ourView(saas())} />);
    const notes = screen.getAllByRole('note').map((n) => n.textContent);
    expect(notes).toEqual([
      'Works for both sides. Of the profit over five years, Northwind keeps 25% and Acme 75%.',
      'Partnering with Northwind gives the most value: €1,433,415 over 5 years, €1,200,156 more than doing it alone.',
    ]);
  });

  it('warns when the partner loses money', () => {
    const c = saas();
    c.costs = [...c.costs, { id: 'cost_big', name: 'Big', when: 'start', amount: 2_000_000 }];
    render(<OurCallouts view={ourView(c)} />);
    expect(screen.getAllByRole('note')[0]).toHaveTextContent(
      'Works for Acme, not for Northwind. A partner who loses money won’t stay: look at the terms or the partner’s costs.',
    );
  });

  it('says doing nothing costs the least when neither option earns back what it needs', () => {
    const c = empty();
    c.ours.costs = [{ id: 'ourcost_1', name: 'Partner manager time', when: 'yearly', amount: 50_000, source: 'finance' }];
    c.ours.alone.fixed = 10_000;
    render(<OurCallouts view={ourView(c)} />);
    expect(screen.getAllByRole('note')[1]).toHaveTextContent('On these numbers, doing nothing costs the least. Neither option earns back what it needs.');
  });
});

describe('BothSides', () => {
  it('puts the partner’s profit next to our net value, each with its payback, and the split', () => {
    render(<BothSides view={ourView(saas())} />);
    expect(group('Northwind, from the partner case')).toHaveTextContent('€479,507');
    expect(group('Northwind, from the partner case')).toHaveTextContent('profit after costs · pays back in year 2, month 6');
    expect(group('Acme, from our case')).toHaveTextContent('€1,433,415');
    expect(group('Acme, from our case')).toHaveTextContent('net value after our costs · pays back in year 2, month 2');
    const split = screen.getByRole('list', { name: 'Split of the profit' });
    expect(within(split).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Northwind 25%', 'Acme 75%']);
  });

  it('has no split when it doesn’t work for both sides', () => {
    render(<BothSides view={ourView(empty())} />);
    expect(screen.queryByRole('list', { name: 'Split of the profit' })).toBeNull();
    expect(group('Acme, from our case')).toHaveTextContent('doesn’t pay back in 5 years');
  });
});

describe('The options', () => {
  it('lists each option with its net value, what we invest, its payback and the strategic reasons it covers', () => {
    render(<OptionsTable view={ourView(saas())} />);
    const table = screen.getByRole('table', { name: 'The options' });
    expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Option', 'Net value, 5 years', 'We invest', 'Pays back', 'Strategic reasons']);
    expect(cells(row(table, 'With Northwind'))).toEqual(['€1,433,415', '€242,000', 'Year 2, month 2', '2 of 2']);
    expect(cells(row(table, 'Alone'))).toEqual(['€233,259', '€490,000', 'Year 5, month 2', '1 of 2']);
    expect(cells(row(table, 'Don’t do it'))).toEqual(['-€60,000', '€0', 'Nothing to pay back', '0 of 2']);
    // The best net value is highlighted.
    expect(row(table, 'With Northwind').querySelector('td')).toHaveAttribute('data-best');
    expect(row(table, 'Alone').querySelector('td')).not.toHaveAttribute('data-best');
    // On a phone each option is listed on its own.
    expect(screen.getByRole('group', { name: 'Don’t do it' })).toHaveTextContent('Nothing to pay back');
  });

  it('draws net value so far for the three options, on Task 9’s axis rule', () => {
    const view = ourView(saas());
    const { container } = render(<OptionsChart view={view} />);
    expect(screen.getByRole('img', { name: 'Net value so far for each option' })).toBeInTheDocument();
    const legend = screen.getByRole('list', { name: 'Legend' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['With Northwind', 'Alone', 'Don’t do it']);
    const all = [view.ours.withPartner, view.ours.alone, view.ours.nothing].flatMap((o) => o.years.map((y) => y.netSoFar));
    const { ticks } = axisRange(Math.min(0, ...all), Math.max(1, ...all));
    expect([...container.querySelectorAll('[data-tick]')].map((t) => t.textContent)).toEqual(ticks.map((v) => shortMoney(v, 'EUR')));
    expect(container.querySelectorAll('polyline')).toHaveLength(3);
  });

  it('gives a small loss a small margin under zero, not a whole step', () => {
    // A small loss in year 1 only, and the partnership earns well after; alone and doing nothing are 0.
    const c = saas();
    c.ours.costs = [{ id: 'ourcost_1', name: 'Onboarding', when: 'start', amount: 46_000, source: 'finance' }];
    c.ours.churn.on = false;
    c.ours.alone = { ...c.ours.alone, share: 0, setup: 0, fixed: 0 };
    c.ours.risk.amount = 0;
    const view = ourView(c);
    const all = [view.ours.withPartner, view.ours.alone, view.ours.nothing].flatMap((o) => o.years.map((y) => y.netSoFar));
    expect(Math.min(...all)).toBeLessThan(0);
    expect(Math.min(...all)).toBeGreaterThan(-5_000);
    const { container } = render(<OptionsChart view={view} />);
    const labels = [...container.querySelectorAll('[data-tick]')].map((t) => t.textContent);
    expect(labels[0]).toBe('€0');
  });
});

describe('HowSure', () => {
  it('shows the result by source, what rests on assumptions, and every line biggest first', () => {
    render(<HowSure view={ourView(saas())} />);
    const legend = screen.getByRole('list', { name: 'By source' });
    expect(within(legend).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Assumption 1%', 'Finance 21%', 'Partner 78%']);
    expect(screen.getByText(/rests on assumptions/)).toHaveTextContent(
      '1% of the result rests on assumptions. The biggest: Onboarding and enablement (-€15,000). Gross margin 80% Finance, deals we’d win anyway 10% Assumption.',
    );
    const lines = within(screen.getByRole('list', { name: 'What the result rests on' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines[0]).toBe('New revenue, after Northwind’s sharePartner€1,543,980');
    expect(lines).toContain('Support Northwind takes overFinance€3,410');
    expect(lines).toContain('Less churnFinance€153,600');
  });

  it('lists the share of the partner’s services and the partner fee, named with the partner, with their sources', () => {
    const c = structuredClone(EXAMPLES.services.case);
    c.offer.types.find((t) => t.id === c.typeId)!.registered.servicesShare = 10;
    render(<HowSure view={ourView(c)} />);
    const lines = within(screen.getByRole('list', { name: 'What the result rests on' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(lines).toContain('Partner fee from Clearpath ConsultingFinance€12,500');
    expect(lines).toContain('Share of Clearpath Consulting’s servicesPartner€230,109');
  });

  it('shows no bar and says there is nothing in the result yet (Review Focus 3)', () => {
    const { container } = render(<HowSure view={ourView(empty())} />);
    expect(container.querySelector('[data-bar]')).toBeNull();
    expect(screen.getByText(/Nothing in the result yet\./)).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'What the result rests on' })).toBeNull();
  });
});

describe('OurYearTable', () => {
  it('shows our year by year, and leaves out lines that are zero over five years', () => {
    render(<OurYearTable view={ourView(saas())} />);
    const table = screen.getByRole('table', { name: 'Year by year, with Northwind' });
    const labels = within(table).getAllByRole('rowheader').map((th) => th.textContent);
    expect(labels).toEqual([
      'Revenue from these customers', 'Revenue we’d have without the partner', 'Margin to Northwind', 'Cost to deliver',
      'From new revenue', 'Support we provide', 'Support Northwind takes over', 'Less churn', 'Our costs', 'Net value', 'Net value so far',
    ]);
    expect(cells(row(table, 'Net value')).at(-1)).toBe('€1,433,415');
    expect(cells(row(table, 'Our costs'))[0]).toBe('-€62,800');
    expect(cells(row(table, 'Less churn'))[0]).toBe('€0');
  });

  it('shows the share of the partner’s services and the partner fee after From new revenue, only when there are any', () => {
    const c = structuredClone(EXAMPLES.services.case);
    const { unmount } = render(<OurYearTable view={ourView(c)} />);
    let table = screen.getByRole('table', { name: 'Year by year, with Clearpath Consulting' });
    let labels = within(table).getAllByRole('rowheader').map((th) => th.textContent);
    expect(labels.slice(labels.indexOf('From new revenue'), labels.indexOf('From new revenue') + 2)).toEqual(['From new revenue', 'Partner fee from Clearpath Consulting']);
    expect(labels).not.toContain('Share of Clearpath Consulting’s services');
    expect(cells(row(table, 'Partner fee from Clearpath Consulting'))).toEqual(['€2,500', '€2,500', '€2,500', '€2,500', '€2,500', '€12,500']);
    unmount();

    c.offer.types.find((t) => t.id === c.typeId)!.registered.servicesShare = 10;
    render(<OurYearTable view={ourView(c)} />);
    table = screen.getByRole('table', { name: 'Year by year, with Clearpath Consulting' });
    labels = within(table).getAllByRole('rowheader').map((th) => th.textContent);
    expect(labels.slice(labels.indexOf('From new revenue'), labels.indexOf('From new revenue') + 3))
      .toEqual(['From new revenue', 'Share of Clearpath Consulting’s services', 'Partner fee from Clearpath Consulting']);
    // 10% of Clearpath's €120,000 of services in year 1.
    expect(cells(row(table, 'Share of Clearpath Consulting’s services'))[0]).toBe('€12,000');
  });

  it('shows our sales on the partner’s deals and support we provide for a referral partner', () => {
    render(<OurYearTable view={ourView(structuredClone(EXAMPLES.referral.case))} />);
    const table = screen.getByRole('table', { name: 'Year by year, with Lumen Consulting' });
    expect(within(table).getByRole('rowheader', { name: 'Our sales on Lumen Consulting’s deals' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Support we provide' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'More efficient' })).toBeInTheDocument();
    expect(within(table).getByRole('rowheader', { name: 'Commission to Lumen Consulting' })).toBeInTheDocument();
  });
});

describe('server-rendered', () => {
  it('renders every result on the server, for the internal one-pager', () => {
    const view = ourView(saas());
    const html = renderToStaticMarkup(
      <>
        <OurStats view={view} />
        <OurCallouts view={view} />
        <BothSides view={view} />
        <OptionsChart view={view} />
        <OptionsTable view={view} />
        <HowSure view={view} />
        <OurYearTable view={view} />
      </>,
    );
    expect(html).toContain('€1,433,415');
    expect(html).toContain('Nothing to pay back');
    expect(html).toContain('rests on assumptions');
    expect(html).not.toContain('—');
  });
});

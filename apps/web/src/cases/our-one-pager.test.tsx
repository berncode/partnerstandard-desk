// @vitest-environment jsdom
import { type BusinessCase as Case, EXAMPLES } from '@partner-desk/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ourView } from './our-case';
import { OurOnePager } from './our-one-pager';

const saas = (): Case => {
  const c = structuredClone(EXAMPLES.saas.case);
  c.ours.recommendation = 'Go ahead, and review it after the first year.';
  c.ours.preparedBy = 'Ada Lovelace';
  return c;
};
const show = (c: Case = saas()) => render(<OurOnePager view={ourView(c)} />);
const section = (name: string) => screen.getByRole('region', { name });
const items = (name: string) => within(section(name)).getAllByRole('listitem').map((li) => li.textContent);
const before = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('our one-pager, for your manager', () => {
  it('has every section of spec §9, in order', () => {
    show();
    const sheet = screen.getByRole('article');
    expect(within(sheet).getByText('Internal · not for Northwind')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Partnership with Northwind: is it worth it for Acme?');
    expect(screen.getByText(/^Reseller partner, 5 years, expected scenario\./)).toHaveTextContent(
      'Reseller partner, 5 years, expected scenario. Prepared by Ada Lovelace.'
      + 'Northwind finds the customer, closes the deal and sends the invoice; Northwind provides level 1 support.',
    );
    expect(within(sheet).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'What the numbers say', 'Recommendation', 'The options', 'Good for both sides?', 'What we ask for', 'Beyond revenue',
      'Strategic reasons', 'How sure we are',
    ]);
    // The three numbers sit between the recommendation and the options.
    const stats = screen.getByRole('group', { name: 'Net value to Acme' });
    expect(before(section('Recommendation'), stats)).toBe(true);
    expect(before(stats, section('The options'))).toBe(true);
    const footer = screen.getByText('Internal. Prepared for Acme leadership.').parentElement!;
    expect(footer.tagName).toBe('FOOTER');
    expect(footer).toHaveTextContent('Estimates, with the source of every number');
  });

  it('shows the SaaS example’s numbers, word for word', () => {
    show();
    expect(section('What the numbers say')).toHaveTextContent(
      'Partnering with Northwind gives the most value: €1,433,415 over 5 years, €1,200,156 more than doing it alone.',
    );
    expect(section('Recommendation')).toHaveTextContent('Go ahead, and review it after the first year.');
    expect(screen.getByRole('group', { name: 'Net value to Acme' })).toHaveTextContent('€1,433,415');
    expect(screen.getByRole('group', { name: 'Return on what we invest' })).toHaveTextContent('592%');
    expect(screen.getByRole('group', { name: 'Pays back' })).toHaveTextContent('Year 2, month 2');

    const options = section('The options');
    expect(within(options).getByRole('img', { name: 'Net value so far for each option' })).toBeInTheDocument();
    expect(within(options).getByRole('table', { name: 'The options' })).toBeInTheDocument();

    expect(items('Good for both sides?')).toEqual([
      'Northwind: €479,507 profit after costs, pays back in year 2.',
      'Acme: €1,433,415 net value after our costs, pays back in year 2.',
      'Works for both sides. Of the profit over five years, Northwind keeps 25% and Acme 75%.',
    ]);
    expect(items('What we ask for')).toEqual([
      '€18,000 to start, then €44,800 a year:',
      'Partner manager time: €30,000 a yearFinance',
      'Onboarding and enablement: €15,000 onceAssumption',
      'Certification vouchers: €3,000 onceFinance',
      'Co-marketing budget (MDF): €10,000 a yearFinance',
      'Free licenses for the partner’s own use: €4,800 a yearFinance',
      'About 30% of a partner manager’s time for Northwind.',
    ]);
    expect(items('Beyond revenue')).toEqual(['Less churn: €153,600 over 5 yearsFinanceFinance, 2025: customers with a local partner renew more often']);
    expect(items('Strategic reasons')).toEqual([
      'Present in the Nordics before competitors arrive high (also alone)',
      'Northwind’s references with retail customers medium',
    ]);
    const sure = section('How sure we are');
    expect(sure).toHaveTextContent('1% of the result rests on assumptions. The biggest: Onboarding and enablement (-€15,000). Gross margin 80% Finance, deals we’d win anyway 10% Assumption.');
    expect(within(sure).getByRole('list', { name: 'By source' })).toBeInTheDocument();
    // The list of every line is for the tab, not the page.
    expect(within(sure).queryByRole('list', { name: 'What the result rests on' })).toBeNull();
  });

  it('with Preferred on: what being Preferred costs us, and its cost line', () => {
    const c = saas();
    c.offer.preferred.on = true;
    show(c);
    expect(items('What we ask for')[0]).toBe('€18,000 to start, then €44,800 a year, plus €8,000 a year once Northwind is Preferred:');
    expect(items('What we ask for')).toContain('Dedicated partner support: €8,000 a year as PreferredAssumption');
  });

  it('leaves out what isn’t written, and says when nothing is counted or given', () => {
    const c = saas();
    c.ours.recommendation = '  ';
    c.ours.preparedBy = '';
    c.ours.ask = '';
    c.ours.churn.on = false;
    c.ours.strategic = [{ id: 'reason_1', text: ' ', weight: 'low', alone: false }];
    show(c);
    expect(screen.queryByRole('region', { name: 'Recommendation' })).toBeNull();
    expect(screen.getByText(/^Reseller partner, 5 years, expected scenario\./).textContent).not.toContain('Prepared by');
    expect(items('What we ask for')).not.toContain('');
    expect(items('What we ask for')).toHaveLength(6);
    expect(items('Beyond revenue')).toEqual(['None counted']);
    expect(items('Strategic reasons')).toEqual(['None given']);
  });

  it('shows both reasons beyond revenue when both count, without a note line when there is none', () => {
    const c = saas();
    c.ours.efficiency = { ...c.ours.efficiency, on: true, mode: 'simple', simple: 10000, source: 'sales', note: '' };
    show(c);
    expect(items('Beyond revenue')).toEqual([
      'More efficient: €50,000 over 5 yearsSales',
      'Less churn: €153,600 over 5 yearsFinanceFinance, 2025: customers with a local partner renew more often',
    ]);
  });

  it('names the higher level as the case’s program does', () => {
    const c = saas();
    c.offer.preferred.on = true;
    c.offer.levels = { registered: 'Member', preferred: 'Gold' };
    show(c);
    expect(items('What we ask for')[0]).toBe('€18,000 to start, then €44,800 a year, plus €8,000 a year once Northwind is Gold:');
    expect(items('What we ask for')).toContain('Dedicated partner support: €8,000 a year as GoldAssumption');
  });

  it('says a type that delivers services: "Service partner", not "Service partner partner"', () => {
    show(structuredClone(EXAMPLES.services.case));
    expect(screen.getByText(/^Service partner, 5 years/)).toBeInTheDocument();
  });

  it('shows nothing as NaN when nothing is invested (Review Focus 3)', () => {
    const c = saas();
    c.deals = [0, 0, 0, 0, 0];
    c.ours.costs = [];
    const { container } = show(c);
    expect(screen.getByRole('group', { name: 'Return on what we invest' })).toHaveTextContent('n/a');
    expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  });
});

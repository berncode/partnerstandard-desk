// @vitest-environment jsdom
import {
  type BusinessCase as Case, EXAMPLES, type ExampleKey, partnerSide, type PartnerCaseView, type PreferredConditions, simulateCase,
} from '@partner-desk/core';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { OnePageCase } from './one-page-case';

function example(key: ExampleKey = 'saas', patch: Partial<Case> = {}, preferred: Partial<PreferredConditions> = {}): Case {
  const c = { ...structuredClone(EXAMPLES[key].case), ...patch };
  c.offer.preferred = { ...c.offer.preferred, ...preferred };
  return c;
}
function show(c: Case = example()) {
  return render(<OnePageCase view={partnerSide(c, c.offer.company)} />);
}
const section = (name: string) => screen.getByRole('region', { name });
const items = (name: string) => within(section(name)).getAllByRole('listitem').map((li) => li.textContent);

/** Every text and amount of our case, each written to be found nowhere else. */
function withOurMarkers(c: Case): Case {
  const o = c.ours;
  o.recommendation = 'OURS-RECOMMENDATION';
  o.ask = 'OURS-ASK';
  o.preparedBy = 'OURS-PREPARED-BY';
  o.risk = { ...o.risk, why: 'OURS-RISK-WHY', amount: 9_191_919 };
  o.efficiency = { ...o.efficiency, note: 'OURS-EFFICIENCY-NOTE' };
  o.churn = { ...o.churn, note: 'OURS-CHURN-NOTE' };
  o.strategic = [{ id: 'reason_marker', text: 'OURS-STRATEGIC', weight: 'high', alone: true }];
  o.costs = [...o.costs, { id: 'cost_marker', name: 'OURS-COST', when: 'yearly', amount: 8_181_818, source: 'finance' }];
  o.alone = { ...o.alone, costs: [{ id: 'cost_alone', name: 'OURS-ALONE-COST', when: 'start', amount: 7_171_717, source: 'sales' }] };
  return c;
}
const OUR_MARKERS = [
  'OURS-', '9,191,919', '9191919', '8,181,818', '8181818', '7,171,717', '7171717', 'Present in the Nordics', 'Partner manager time',
  'Finance, 2025', 'Net value', 'Internal', 'Gross margin', 'Assumption',
];

describe('the partner’s one-pager', () => {
  it('shows the SaaS example as the prototype does, word for word, with Preferred off', () => {
    const { container } = show();
    expect(screen.getByText('Business case · Reseller partnership')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What partnering with Acme is worth to Northwind');
    expect(screen.getByText('Over 5 years, on the plan we agreed together (expected scenario).')).toBeInTheDocument();

    expect(screen.getByRole('group', { name: 'Margin from Acme' })).toHaveTextContent('€578,608');
    expect(screen.getByRole('group', { name: 'Your customers by year 5' })).toHaveTextContent('48');
    expect(screen.queryByRole('group', { name: 'Your own services' })).toBeNull();
    expect(screen.getByRole('group', { name: 'Your profit after costs' })).toHaveTextContent('€479,507pays for itself in year 2, month 6');
    // The partner reads this page, so the chart says "you" (spec §10).
    expect(screen.getByRole('img', { name: 'Your revenue per year by source, with your profit so far' })).toBeInTheDocument();
    expect(container.innerHTML).not.toContain('Partner revenue');

    expect(items('Beyond the money')).toEqual(['New customers', 'Stronger offering', 'Recurring revenue']);
    expect(screen.queryByRole('region', { name: 'How you grow with us' })).toBeNull();
    expect(items('What you earn')).toEqual(['Margin: 20% on the first year, 20% on renewals, 15% on one-off products.']);
    expect(items('The plan')).toEqual([
      'New deals per year: 3, 7, 11, 15, 19.',
      'A typical customer is worth €24,000 a year plus €4,000 once.',
      '90% of customers renew each year.',
    ]);
    expect(items('Who does what')).toEqual([
      'You find the customer, close the deal and send the invoice.',
      'You provide level 1 support.',
      'Your support cost: €300 per customer a year.',
    ]);
    // The cost of being Preferred is kept, and left out while the offer has no Preferred level.
    expect(items('What it costs you')).toEqual([
      'Sales and technical training: €8,000, once at the start.',
      'Certification: €4,000, once at the start.',
      'Sales time for the first deals: €13,000, once at the start.',
      'Enablement and refreshers: €3,000 every year.',
      'Events and marketing: €5,000 every year.',
    ]);
    expect(items('When it pays back')).toEqual(['In year 2, month 6.', 'Total costs over five years: €99,100.']);
    expect(container.textContent).not.toMatch(/Registered|Preferred/);

    const footer = screen.getByText('Prepared by Acme with Northwind').parentElement!;
    expect(footer.tagName).toBe('FOOTER');
    expect(footer).toHaveTextContent('Estimates, not a promise of revenue');
  });

  it('with Preferred on: how the partner grows, what being Preferred costs, and its cost line', () => {
    show(example('saas', {}, { on: true }));
    expect(screen.queryByRole('region', { name: 'What you earn' })).toBeNull();
    expect(items('How you grow with us')).toEqual([
      'You start as a Registered partner: 20% on the first year, 20% on renewals, 15% on one-off products.',
      'With 8 deals in a year you become Preferred: 30% on the first year, 30% on renewals, 20% on one-off products.',
      'As Preferred, extra costs of €6,000 a year.',
      'On this plan, that happens in year 4.',
    ]);
    expect(items('What it costs you')).toContain('Extra certified consultants: €6,000 every year as Preferred.');
  });

  it('names the levels as the case’s program does', () => {
    const c = example('saas', {}, { on: true });
    c.offer.levels = { registered: 'Member', preferred: 'Gold' };
    const { container } = show(c);
    expect(items('How you grow with us')[0]).toBe('You start as a Member partner: 20% on the first year, 20% on renewals, 15% on one-off products.');
    expect(items('How you grow with us')[1]).toMatch(/ you become Gold: /);
    expect(items('What it costs you')).toContain('Extra certified consultants: €6,000 every year as Gold.');
    expect(container.textContent).not.toMatch(/Registered|Preferred/);
  });

  it('says each rule of becoming Preferred in words', () => {
    show(example('saas', {}, { on: true, rule: 'revenue', revenue: 250000 }));
    expect(items('How you grow with us')[1]).toBe('With €250,000 in revenue in a year you become Preferred: 30% on the first year, 30% on renewals, 20% on one-off products.');
  });

  it('from a set year', () => {
    show(example('saas', {}, { on: true, rule: 'year', year: 4 }));
    expect(items('How you grow with us')[1]).toBe('From year 4 you become Preferred: 30% on the first year, 30% on renewals, 20% on one-off products.');
    expect(items('How you grow with us')[3]).toBe('On this plan, that happens in year 4.');
  });

  it('starts a partner who already has the tier as Preferred, and names the years it drops to Registered', () => {
    show(example('saas', { startsAs: 'preferred', deals: [9, 9, 2, 9, 9] }, { on: true }));
    expect(items('How you grow with us')).toEqual([
      'You start as a Preferred partner: 30% on the first year, 30% on renewals, 20% on one-off products.',
      'You stay Preferred with 8 deals in a year. Below that you are Registered: 20% on the first year, 20% on renewals, 15% on one-off products.',
      'As Preferred, extra costs of €6,000 a year.',
      'On this plan, you are Registered in year 4.',
    ]);
  });

  it('names every year a Preferred partner drops to Registered', () => {
    show(example('saas', { startsAs: 'preferred', deals: [9, 2, 2, 2, 9] }, { on: true }));
    expect(items('How you grow with us')[3]).toBe('On this plan, you are Registered in years 3, 4 and 5.');
  });

  it('a referral partner: what it earns, its introductions, and what the vendor does', () => {
    show(example('referral'));
    expect(screen.getByText('Business case · Referral partnership')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Commission from Brightdesk' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your customers by year 5' })).toHaveTextContent('57');
    expect(items('What you earn')).toEqual(['Commission: 15% on the first year, 0% on renewals.']);
    expect(items('The plan')[0]).toBe('Deals from your introductions per year: 4, 9, 14, 18, 22.');
    expect(items('The plan')[1]).toBe('A typical customer is worth $9,000 a year.');
    expect(items('Who does what')).toEqual([
      'You introduce the customer.',
      'Brightdesk closes the deal and invoices the customer.',
      'Brightdesk provides customer support.',
    ]);
  });

  it('a service partner: "Service partnership", its services, the customers it serves and its support cost', () => {
    show(example('services'));
    expect(screen.getByText('Business case · Service partnership')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Referral fee from Cloudline' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your own services' })).toHaveTextContent('€2,301,093');
    expect(screen.queryByRole('group', { name: /Your customers by year/ })).toBeNull();
    expect(items('The plan')[0]).toBe('New customers you serve per year: 5, 10, 15, 20, 25.');
    expect(items('Who does what')).toEqual([
      'You find 30% of the customers you serve yourself.',
      'Cloudline closes the deal and invoices the customer.',
      'You provide level 1 support.',
      'You deliver implementation and services.',
      'Implementation: €15,000 per new customer.',
      'Managed service: €500 per customer and month.',
      'Other sales: €3,000 per new customer.',
      'Your profit on services: 35%.',
      'Your support cost: €250 per customer a year.',
    ]);
  });

  it('leaves out managed service and other sales when they are 0', () => {
    show(example('services', { managed: 0, other: 0 }));
    expect(items('Who does what').some((l) => l?.startsWith('Managed service') || l?.startsWith('Other sales'))).toBe(false);
  });

  it('follows the scenario and the deals it scales', () => {
    show(example('saas', { scenario: 'careful' }));
    expect(screen.getByText('Over 5 years, on the plan we agreed together (careful scenario).')).toBeInTheDocument();
    expect(items('The plan')[0]).toBe('New deals per year: 2, 4, 7, 9, 11.');
  });

  it('says what the vendor takes of the partner’s services and the partner fee, in you form', () => {
    const { unmount } = show(example('onprem'));
    expect(items('Who does what')).toContain('Secura takes 10% of your services.');
    expect(items('What it costs you')).toContain('Share of your services to Secura: 10%.');
    expect(items('What it costs you')).not.toContainEqual(expect.stringMatching(/^Partner fee/));
    unmount();

    const differ = example('onprem', {}, { on: true, rule: 'year', year: 3 });
    differ.offer.types.find((t) => t.id === differ.typeId)!.preferred.servicesShare = 5;
    const second = show(differ);
    expect(items('Who does what')).toContain('Secura takes 10% of your services as Registered, 5% as Preferred.');
    expect(items('What it costs you')).toContain('Share of your services to Secura: 10% as Registered, 5% as Preferred.');
    second.unmount();

    const services = example('services');
    show(services);
    expect(items('What it costs you').at(-1)).toBe('Partner fee: €2,500 every year.');
    expect(items('Who does what').join(' ')).not.toMatch(/takes \d+% of your services/);
    expect(items('What it costs you').join(' ')).not.toMatch(/Share of your services/);
    // The fee is part of the costs over five years: €10,000 start, 5 × €5,000 yearly, the support and 5 × €2,500.
    const total = simulateCase(services).years.reduce((sum, y) => sum + y.costs, 0);
    expect(items('When it pays back')[1]).toBe(`Total costs over five years: €${Math.round(total).toLocaleString('en-US')}.`);
  });

  it('leaves out a tier the vendor takes nothing in, and puts the fee before the share', () => {
    const c = example('onprem', {}, { on: true, rule: 'year', year: 3 });
    const type = c.offer.types.find((t) => t.id === c.typeId)!;
    type.registered.servicesShare = 0;
    type.preferred.servicesShare = 5;
    type.fee = 1500;
    const { unmount } = show(c);
    expect(items('Who does what')).toContain('Secura takes 5% of your services as Preferred.');
    expect(items('What it costs you').slice(-2)).toEqual(['Partner fee: €1,500 every year.', 'Share of your services to Secura: 5% as Preferred.']);
    unmount();

    type.registered.servicesShare = 10;
    type.preferred.servicesShare = 0;
    show(c);
    expect(items('Who does what')).toContain('Secura takes 10% of your services as Registered.');
    expect(items('What it costs you')).toContain('Share of your services to Secura: 10% as Registered.');
  });

  it('says there are costs when the only one is the partner fee', () => {
    const c = example('referral', { costs: [] });
    c.offer.types.find((t) => t.id === c.typeId)!.fee = 1200;
    show(c);
    expect(items('What it costs you')).toEqual(['Partner fee: $1,200 every year.']);
  });

  it('says so when the partner never earns back what it invests', () => {
    show(example('saas', { costs: [{ id: 'cost_1', name: 'Training', when: 'start', amount: 5_000_000 }] }));
    expect(items('When it pays back')[0]).toBe('Not within five years on this plan.');
    const profit = screen.getByRole('group', { name: 'Your profit after costs' });
    expect(profit).not.toHaveTextContent('pays for itself');
    expect(profit.querySelector('.text-danger')).not.toBeNull();
  });

  it('says when there are no benefits or costs', () => {
    show(example('referral', { benefits: [], costs: [] }));
    expect(items('Beyond the money')).toEqual(['None picked yet']);
    expect(items('What it costs you')).toEqual(['No costs on this plan.']);
    expect(items('When it pays back')[1]).toBe('Total costs over five years: $0.');
  });

  it('shows nothing as NaN when every input is 0 (Review Focus 5)', () => {
    const c = example('saas', { deals: [0, 0, 0, 0, 0], implementation: 0, managed: 0, other: 0, serviceProfit: 0, supportCost: 0, costs: [] });
    c.offer.products = [];
    c.offer.renewal = 0;
    const { container } = show(c);
    expect(container.innerHTML).not.toMatch(/NaN|Infinity|-€0(?![\d,])/);
    expect(screen.getByRole('group', { name: 'Your profit after costs' })).toHaveTextContent('€0');
    expect(items('When it pays back')[0]).toBe('Not within five years on this plan.');
  });

  it('is given a PartnerCaseView, which by its type holds nothing of our case (the hard rule)', () => {
    expectTypeOf<PartnerCaseView>().not.toHaveProperty('ours');
    expectTypeOf<PartnerCaseView>().not.toHaveProperty('id');
    expectTypeOf<PartnerCaseView>().not.toHaveProperty('notes');
    expectTypeOf<Parameters<typeof OnePageCase>[0]>().toEqualTypeOf<{ view: PartnerCaseView }>();
    const view = partnerSide(withOurMarkers(example()), 'Acme');
    expect(Object.keys(view).sort()).toEqual([
      'benefits', 'company', 'costs', 'currency', 'deals', 'levels', 'partner', 'preferred', 'products', 'renewal', 'result', 'scenario',
      'services', 'startsAs', 'type',
    ]);
  });

  it('shows nothing of our case, also when every part of it is marked (the hard rule)', () => {
    const { container } = show(withOurMarkers(example('saas', {}, { on: true })));
    for (const marker of OUR_MARKERS) expect(container.innerHTML, marker).not.toContain(marker);
  });

  it('speaks to the partner as "you", never by name or as "the partner" inside the page', () => {
    const { container } = show();
    const text = container.textContent ?? '';
    // Northwind is named only where the page is addressed: the heading and the footer.
    expect(text.match(/Northwind/g)).toHaveLength(2);
    expect(text).not.toMatch(/\bthe partner\b|\btheir\b|\bthem\b|Partner profit|Partner services/i);
    expect(screen.getByText('Your profit so far, after costs')).toBeInTheDocument();
  });
});

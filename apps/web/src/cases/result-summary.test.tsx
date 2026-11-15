// @vitest-environment jsdom
import {
  type BusinessCase as Case, type ExampleKey, EXAMPLES, type PreferredConditions, simulateCase,
} from '@partner-desk/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { describeTypicalCustomer, ResultSummary } from './result-summary';

const build = (key: ExampleKey = 'saas', patch: Partial<Case> = {}): Case => ({ ...structuredClone(EXAMPLES[key].case), ...patch });
const preferredOn = (c: Case, p: Partial<PreferredConditions> = {}): Case => ({ ...c, offer: { ...c.offer, preferred: { ...c.offer.preferred, on: true, ...p } } });
function show(c: Case = build()) {
  render(<ResultSummary result={simulateCase(c)} case={c} />);
}
const stat = (name: string) => screen.getByRole('group', { name });
const callouts = () => screen.getAllByRole('note').map((n) => n.textContent);

describe('ResultSummary', () => {
  it('shows the three numbers for the SaaS example: a reseller has no services, so the customers by year 5', () => {
    show();
    expect(stat('Margin from Acme')).toHaveTextContent('€578,608over 5 years');
    expect(stat('Customers by year 5')).toHaveTextContent('48from Northwind');
    expect(screen.queryByRole('group', { name: 'Partner services' })).toBeNull();
    expect(stat('Partner profit after costs')).toHaveTextContent('€479,507pays for itself in year 2, month 6');
  });

  it('shows the partner services for a type that delivers them', () => {
    show(build('onprem'));
    expect(stat('Partner services')).toHaveTextContent('€900,0002.2× the margin');
    expect(screen.queryByRole('group', { name: 'Customers by year 5' })).toBeNull();
    show(build('services'));
    expect(stat('Referral fee from Cloudline')).toBeInTheDocument();
  });

  it('says nothing of Preferred while it is off, even for a partner who starts as Preferred', () => {
    show(build('saas', { startsAs: 'preferred' }));
    expect(callouts()).toEqual(['Acme gets €2,948,039 in revenue through this partner, before what it pays the partner.']);
  });

  it('says when the partner becomes Preferred and what that adds after its extra costs', () => {
    show(preferredOn(build(), { rule: 'deals', deals: 8 }));
    expect(callouts()).toEqual([
      '★ Preferred from year 4. Being Preferred adds €189,772 over 5 years, after its extra costs.',
      'Acme gets €2,948,039 in revenue through this partner, before what it pays the partner.',
    ]);
  });

  it('leaves out “after its extra costs” when being Preferred has none', () => {
    const c = preferredOn(build(), { rule: 'year', year: 2 });
    c.costs = c.costs.filter((x) => x.when !== 'preferred');
    show(c);
    expect(callouts()[0]).toMatch(/^★ Preferred from year 2\. Being Preferred adds €[\d,]+ over 5 years\.$/);
  });

  it('warns when being Preferred costs more than it brings', () => {
    const c = preferredOn(build(), { rule: 'deals', deals: 8 });
    c.costs = c.costs.map((x) => (x.when === 'preferred' ? { ...x, amount: 200_000 } : x));
    show(c);
    const note = screen.getAllByRole('note')[0]!;
    expect(note).toHaveTextContent('★ Preferred from year 4. Being Preferred costs €198,228 more than it brings over 5 years, after its extra costs.');
    expect(note.className).toMatch(/text-warn/);
  });

  it('says what keeping the tier is worth for a partner who starts as Preferred', () => {
    show(preferredOn(build('saas', { startsAs: 'preferred' }), { rule: 'deals', deals: 8 }));
    expect(callouts()[0]).toMatch(/^★ Starts as Preferred\. Keeping the tier is worth €[\d,]+ over 5 years, after its extra costs\.$/);
  });

  it('says how the partner becomes Preferred when it stays Registered, with the rule in words', () => {
    show(preferredOn(build(), { rule: 'deals', deals: 50 }));
    expect(callouts()[0]).toBe('Stays Registered on this plan. With 50 deals in a year the partner becomes Preferred.');
  });

  it('names the revenue rule in money', () => {
    show(preferredOn(build(), { rule: 'revenue', revenue: 5_000_000 }));
    expect(callouts()[0]).toBe('Stays Registered on this plan. With €5,000,000 in revenue in a year the partner becomes Preferred.');
  });

  it('warns when the costs are never earned back', () => {
    show(build('saas', { deals: [1, 1, 1, 1, 1], costs: [{ id: 'cost_1', name: 'Training', when: 'start', amount: 900_000 }] }));
    expect(stat('Partner profit after costs')).toHaveTextContent('not paid back yet');
    expect(callouts()).toContain('On these numbers the partner doesn’t earn back the investment. Look at the terms or the start costs.');
  });

  it('shows the services as revenue when the partner earns nothing from the vendor', () => {
    const c = build('onprem');
    const type = c.offer.types.find((t) => t.id === c.typeId)!;
    type.registered = { first: 0, renewal: 0, once: 0, servicesShare: 0 };
    show(c);
    expect(stat('Margin from Secura')).toHaveTextContent('€0');
    expect(stat('Partner services')).toHaveTextContent('€900,000revenue');
  });
});

describe('describeTypicalCustomer', () => {
  it('sums up a typical customer, with what is paid once only when there is some', () => {
    expect(describeTypicalCustomer({ yearly: 24_000, once: 4_000 }, 'EUR')).toBe('A typical customer is worth €24,000 a year plus €4,000 once.');
    expect(describeTypicalCustomer({ yearly: 9_000, once: 0 }, 'USD')).toBe('A typical customer is worth $9,000 a year.');
  });
});

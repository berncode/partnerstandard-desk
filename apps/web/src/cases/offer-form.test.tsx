// @vitest-environment jsdom
// The case's own offer only (PartnerStandard Desk has no standard offer), with the case's level names.
import { EXAMPLES, parseOffer, type BusinessCase, type CaseOffer as Offer } from '@partner-desk/core';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { StorageProvider } from '@/storage-context';
import { OfferForm } from './offer-form';

/** The form as the offer tab holds it: the offer in state, its issues worked out on every change. */
function Harness({ initial, typeId, onChange = () => {} }: { initial: Offer; typeId: string; onChange?: (o: Offer) => void }) {
  const [offer, setOffer] = useState(initial);
  const parsed = parseOffer(offer);
  return (
    <OfferForm offer={offer} issues={parsed.ok ? [] : parsed.issues} typeId={typeId}
      onChange={(next) => {
        setOffer(next);
        onChange(next);
      }} />
  );
}

const example = (key: keyof typeof EXAMPLES): BusinessCase => structuredClone(EXAMPLES[key].case);
function show(key: keyof typeof EXAMPLES, change?: (o: Offer) => void) {
  const c = example(key);
  if (change) change(c.offer);
  const changed = vi.fn();
  render(<Harness initial={c.offer} typeId={c.typeId} onChange={changed} />);
  return { changed, last: () => changed.mock.lastCall?.[0] as Offer };
}
const lead = () => screen.queryByRole('textbox', { name: 'Customers it finds itself' });
const tick = (name: string) => screen.getByRole('checkbox', { name });

describe('OfferForm: the roles of the case’s partner type', () => {
  it('shows the type by its name, which is fixed, and no tabs or adding and removing types', () => {
    show('saas');
    expect(screen.getByRole('heading', { name: 'Partner type' })).toBeInTheDocument();
    expect(screen.getByText('What this partner type does and what it earns.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Type name' })).toHaveValue('Reseller');
    expect(screen.getByRole('textbox', { name: 'Type name' })).toHaveAttribute('readonly');
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add a partner type' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove this type/ })).toBeNull();
  });

  it('asks for the lead share only for a type that delivers services and does not close the deal', async () => {
    const user = userEvent.setup();
    const { last } = show('services');
    expect(screen.getByText('What this partner type does. It decides how the partner earns and what you still do yourself.')).toBeInTheDocument();
    expect(lead()).toHaveValue('30');
    expect(screen.getByText('Of the customers this partner serves, the share it found itself. It earns its referral fee on these.')).toBeInTheDocument();

    // A type that closes owns the sale: the field goes, and its value is kept for when it no longer closes.
    await user.click(tick('Closes the deal and invoices the customer'));
    expect(lead()).toBeNull();
    await user.click(tick('Closes the deal and invoices the customer'));
    expect(lead()).toHaveValue('30');
    await user.click(tick('Delivers implementation and services'));
    expect(lead()).toBeNull();
    expect(last().types[0]!.roles).toEqual({ lead: 30, closes: false, support: 'level1', services: false });
  });

  it('picks the support the partner gives', async () => {
    const user = userEvent.setup();
    const { last } = show('saas');
    const support = screen.getByRole('combobox', { name: 'Customer support' });
    expect([...support.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['You provide it', 'Partner: level 1', 'Partner: level 1 and 2']);
    expect(support).toHaveDisplayValue('Partner: level 1');
    await user.selectOptions(support, 'Partner: level 1 and 2');
    expect(last().types[0]!.roles.support).toBe('level12');
  });

  it('says what the type earns, and follows a change to the roles', async () => {
    const user = userEvent.setup();
    show('referral');
    expect(screen.getByText('Earns a commission on the customers it introduces.')).toBeInTheDocument();
    expect(screen.getByText('Commission on')).toBeInTheDocument();
    await user.click(tick('Delivers implementation and services'));
    expect(screen.getByText('Earns a referral fee on the customers it finds itself, plus fees from the customer for its own services.')).toBeInTheDocument();
    expect(screen.getByText('Referral fee on')).toBeInTheDocument();
    await user.click(tick('Closes the deal and invoices the customer'));
    expect(screen.getByText('Earns a margin on everything it sells, plus fees from the customer for its own services.')).toBeInTheDocument();
    expect(screen.getByText('Margin on')).toBeInTheDocument();
  });
});

describe('OfferForm: the share of partner services and the partner fee', () => {
  const share = (name = 'Your share of partner services') => screen.queryByRole('textbox', { name });

  it('asks for the share only for a type that delivers services, per level while Preferred is on', async () => {
    const user = userEvent.setup();
    const { last } = show('services');
    expect(share()).toHaveValue('0');
    const sub = screen.getByText('Of the partner’s services, you take');
    expect(screen.getByText('One-off products').compareDocumentPosition(sub) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(sub).toHaveClass('col-span-full');
    await user.clear(share()!);
    await user.type(share()!, '15');
    expect(last().types[0]!.registered.servicesShare).toBe(15);

    await user.click(tick('Include Preferred partner conditions'));
    expect(share('Your share of partner services, Registered')).toHaveValue('15');
    const preferred = share('Your share of partner services, Preferred')!;
    await user.clear(preferred);
    await user.type(preferred, '10');
    expect(last().types[0]!.preferred.servicesShare).toBe(10);
  });

  it('keeps the share while services are off, and a wrong one goes back to its last right value', async () => {
    const user = userEvent.setup();
    const { last } = show('onprem');
    expect(share()).toHaveValue('10');
    await user.clear(share()!);
    await user.type(share()!, '12');
    await user.click(tick('Delivers implementation and services'));
    expect(share()).toBeNull();
    expect(last().types[0]!.registered.servicesShare).toBe(12);
    await user.click(tick('Delivers implementation and services'));
    expect(share()).toHaveValue('12');

    await user.clear(share()!);
    await user.type(share()!, '120');
    expect(screen.getByText(/must be 100 or less\.$/)).toBeInTheDocument();
    await user.click(tick('Delivers implementation and services'));
    expect(last().types[0]!.registered.servicesShare).toBe(12);
    expect(parseOffer(last()).ok).toBe(true);
  });

  it('asks for the partner fee, in US words', async () => {
    const user = userEvent.setup();
    const { last } = show('saas');
    const fee = screen.getByRole('textbox', { name: 'Partner fee a year' });
    expect(fee).toHaveValue('0');
    expect(screen.getByText('What the partner pays you every year, for example a program or partner license fee')).toBeInTheDocument();
    await user.clear(fee);
    await user.type(fee, '2500');
    expect(last().types[0]!.fee).toBe(2500);
    await user.clear(fee);
    await user.type(fee, '-1');
    expect(screen.getByText(/must be 0 or more\.$/)).toBeInTheDocument();
  });
});

describe('OfferForm: Preferred, optional, with the program’s level names', () => {
  it('shows one Rate column and no rule while Preferred is off, and keeps the Preferred values while it is off', async () => {
    const user = userEvent.setup();
    const { last } = show('saas');

    const preferred = tick('Include Preferred partner conditions');
    expect(preferred).not.toBeChecked();
    expect(screen.getByText('Leave this off if you don’t have a Preferred level, or don’t want it in the case yet.')).toBeInTheDocument();
    expect(screen.getByText('Rate')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'First year of yearly products' })).toHaveValue('20');
    expect(screen.queryByRole('combobox', { name: 'A partner becomes Preferred' })).toBeNull();

    await user.click(preferred);
    expect(screen.queryByText('Rate')).toBeNull();
    expect(screen.getByRole('textbox', { name: 'First year of yearly products, Registered' })).toHaveValue('20');
    const first = screen.getByRole('textbox', { name: 'First year of yearly products, Preferred' });
    expect(first).toHaveValue('30');
    const rule = screen.getByRole('combobox', { name: 'A partner becomes Preferred' });
    expect([...rule.querySelectorAll('option')].map((o) => o.textContent))
      .toEqual(['After a number of deals a year', 'After an amount of revenue a year', 'From a set year']);
    expect(screen.getByRole('textbox', { name: 'Deals in a year' })).toHaveValue('8');
    expect(screen.getByText(/^Deals and revenue are counted in the year before\. .* Extra costs of being Preferred go in the costs on the Partner case tab\.$/)).toBeInTheDocument();

    await user.clear(first);
    await user.type(first, '25');
    await user.selectOptions(rule, 'After an amount of revenue a year');
    expect(screen.getByRole('textbox', { name: 'Revenue in a year' })).toHaveValue('250,000');
    await user.selectOptions(rule, 'From a set year');
    await user.selectOptions(screen.getByRole('combobox', { name: 'From' }), 'Year 3');
    await user.selectOptions(rule, 'After an amount of revenue a year');

    await user.click(preferred);
    expect(screen.queryByRole('textbox', { name: /Preferred$/ })).toBeNull();
    expect(last().preferred).toEqual({ on: false, rule: 'revenue', deals: 8, revenue: 250000, year: 3 });
    expect(last().types[0]!.preferred.first).toBe(25);
  });

  it('names the levels and the Preferred part as the program does', async () => {
    const user = userEvent.setup();
    show('saas', (o) => { o.levels = { registered: 'Member', preferred: 'Gold' }; });
    expect(screen.getByRole('heading', { name: 'Gold level' })).toBeInTheDocument();
    expect(screen.getByText('Leave this off if you don’t have a Gold level, or don’t want it in the case yet.')).toBeInTheDocument();
    await user.click(tick('Include Gold partner conditions'));
    expect(screen.getByText('Member')).toBeInTheDocument();
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'First year of yearly products, Member' })).toHaveValue('20');
    expect(screen.getByRole('textbox', { name: 'First year of yearly products, Gold' })).toHaveValue('30');
    expect(screen.getByRole('combobox', { name: 'A partner becomes Gold' })).toBeInTheDocument();
    expect(screen.queryByText(/Preferred|Registered/)).toBeNull();
  });
});

describe('OfferForm: this offer and the portfolio', () => {
  it('names the company from Settings, and has the currency and customers who renew', () => {
    show('saas');
    const offer = screen.getByRole('region', { name: 'This offer' });
    expect(within(offer).getByText('Offered by Acme. Change the company name in Settings.')).toBeInTheDocument();
    expect(within(offer).getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR');
    expect(within(offer).getByRole('textbox', { name: 'Customers who renew' })).toHaveValue('90');
    expect(screen.queryByRole('textbox', { name: 'Name' })).toBeNull();
    const order = screen.getAllByRole('region').map((r) => r.querySelector('h2')?.textContent);
    expect(order).toEqual(['This offer', 'Your portfolio', 'Partner type']);
  });

  it('adds and removes products, and sums up a typical customer', async () => {
    const user = userEvent.setup();
    const { last } = show('saas');
    expect(screen.getByText('A typical customer is worth €24,000 a year plus €4,000 once.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove Onboarding package' }));
    expect(screen.getByText('A typical customer is worth €24,000 a year.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add a product' }));
    expect(screen.getByRole('textbox', { name: 'Product 2 name' })).toHaveValue('New product');
    expect(screen.getByText('A typical customer is worth €25,000 a year.')).toBeInTheDocument();
    expect(last().products[1]!.id).toMatch(/^prod_[0-9a-z]+$/);
  });

  it('says what is wrong under the row, and a price being typed counts as 0', async () => {
    const user = userEvent.setup();
    show('saas');
    const price = screen.getByRole('textbox', { name: 'Product 1 price' });
    await user.clear(price);
    await user.type(price, 'abc');
    expect(price).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('A typical customer is worth €0 a year plus €4,000 once.')).toBeInTheDocument();
  });
});

describe('OfferForm: a company server’s viewer (owner, 2026-11-14)', () => {
  it('reads every field of the offer, closed, with no Add a product or Remove', () => {
    const c = example('saas');
    render(<StorageProvider storage="database" viewer><Harness initial={c.offer} typeId={c.typeId} /></StorageProvider>);
    const fields = [...screen.getByTestId('closed-for-viewer').querySelectorAll('input, select, textarea, button')];
    expect(fields.length).toBeGreaterThan(5);
    for (const field of fields) expect(field).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Add a product' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Remove / })).toBeNull();
    expect(screen.getByText(/^Offered by .+\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/Change the company name in Settings/)).toBeNull();
  });

  it('keeps the offer open for everyone else', () => {
    show('saas');
    expect(screen.queryByTestId('closed-for-viewer')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add a product' })).toBeEnabled();
  });
});

// @vitest-environment jsdom
// The example's system integrator fixture is a solution partner (same pay kind), and saves send `{ program, base, … }`.
import { newProgram, WHO_INVOICES, type CompanyFacts, type Program } from '@partner-desk/core';
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BRIGHTPAGE, CONSULTING, NORTHWIND, REFERRAL, RESELLER, showProgram, STAMP, stubOutputs } from './test-harness';

const nav = vi.hoisted(() => ({ pathname: '/', push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: nav.push, refresh: nav.refresh }),
}));

const { ProgramStep } = await import('./program-step');

/** The Money step of `program`, with `facts`. */
function show(program: Program = RESELLER, facts: CompanyFacts = NORTHWIND) {
  nav.pathname = `/programs/${program.id}/money`;
  return showProgram(<ProgramStep step="money" />, { program, facts });
}

const card = (name: string) => screen.getByRole('region', { name });
const paidAs = () => screen.getByRole('combobox', { name: 'Paid as' });
const options = (select: HTMLElement) => within(select).getAllByRole('option').map((o) => o.textContent);
const rates = () => screen.getByRole('table', { name: 'Rates per level' });
const rateRows = () => within(rates()).getAllByRole('rowheader').map((r) => r.textContent);
const glance = () => card('At a glance');
/** A row of the At a glance table: its cells after the row heading. */
const glanceRow = (name: string) => {
  const row = within(glance()).getByRole('rowheader', { name }).closest('tr') as HTMLElement;
  return within(row).getAllByRole('cell').map((c) => c.textContent);
};
const withMoney = (p: Program, money: Partial<Program['money']>): Program => ({ ...p, money: { ...p.money, ...money } });
const fresh = (type: Program['type']): Program => ({ ...newProgram(type, NORTHWIND, { id: 'pg_moneykinds', companyName: 'Northwind Security' }), updatedAt: STAMP });

describe('Money', () => {
  beforeEach(() => {
    nav.push.mockClear();
    stubOutputs();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('heads How partners are paid with who invoices, and Paid as offers only the kind’s models', () => {
    show();
    expect(within(card('How partners are paid')).getByText(WHO_INVOICES.resale)).toBeInTheDocument();
    expect(options(paidAs())).toEqual(['Margin off your suggested price']);
  });

  it.each([
    ['referral', ['Commission', 'Flat fee per new customer']],
    ['solution', ['Referral fee', 'Margin, when they resell', 'No payment, services only']],
    ['content', ['No cash, rewards only', 'Flat fee per new customer']],
  ] as const)('%s pays as the kind allows', (type, models) => {
    show(fresh(type));
    expect(options(paidAs())).toEqual(models);
  });

  it('Commission has two patterns; one-off adds Paid on, and a contract how many years it runs', async () => {
    const { user } = show(withMoney(REFERRAL, { pattern: 'lifetime' }), BRIGHTPAGE);
    const pattern = screen.getByRole('combobox', { name: 'Commission' });
    expect(options(pattern)).toEqual(['One-off, nothing on renewals', 'When the customer signs, plus every renewal']);
    expect(screen.queryByRole('combobox', { name: 'Paid on' })).not.toBeInTheDocument();
    await user.selectOptions(pattern, 'One-off, nothing on renewals');
    const on = screen.getByRole('combobox', { name: 'Paid on' });
    expect(options(on)).toEqual(['The first year', 'The whole first contract']);
    expect(screen.queryByRole('textbox', { name: 'First contract runs' })).not.toBeInTheDocument();
    await user.selectOptions(on, 'The whole first contract');
    const years = screen.getByRole('textbox', { name: 'First contract runs' });
    expect(years).toHaveValue('3');
    expect(years.parentElement).toHaveTextContent('years');
    expect(rateRows()).toEqual(['Of the whole first contract']);
  });

  describe('the rates table', () => {
    it('Margin: one row, a column per level headed with the level names, and the wholesale note', () => {
      show({ ...RESELLER, regName: 'Member', prefName: 'Gold' });
      expect(rateRows()).toEqual(['Margin, every year the customer stays']);
      expect(within(rates()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Member', 'Gold']);
      expect(screen.getByRole('textbox', { name: 'Member: Margin, every year the customer stays' })).toHaveValue('25');
      expect(screen.getByRole('textbox', { name: 'Gold: Margin, every year the customer stays' })).toHaveValue('30');
      expect(screen.getByText('Many resellers buy at a wholesale price and set their own resale price. The gap to your suggested price shows roughly what they keep.')).toBeInTheDocument();
    });

    it('has no Preferred column when the program has one level', () => {
      show({ ...RESELLER, prefOn: false });
      expect(within(rates()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Registered']);
      expect(screen.queryByRole('textbox', { name: /^Preferred:/ })).not.toBeInTheDocument();
    });

    it('Commission when the customer signs plus renewals: three rows when the customer pays something once', () => {
      show(CONSULTING);
      expect(rateRows()).toEqual(['When the customer signs, on the first year', 'Every year the customer renews', 'Of what the customer pays once']);
      expect(screen.queryByText(/^Many resellers buy/)).not.toBeInTheDocument();
    });

    it('leaves out the once row when a typical customer pays nothing once', () => {
      show(withMoney(REFERRAL, { pattern: 'lifetime' }), BRIGHTPAGE);
      expect(rateRows()).toEqual(['When the customer signs, on the first year', 'Every year the customer renews']);
    });

    it('Commission one-off: of the first year, and the once row when the customer pays once', () => {
      show(withMoney({ ...CONSULTING }, { pattern: 'oneoff', base: 'year' }));
      expect(rateRows()).toEqual(['Of the first year', 'Of what the customer pays once']);
    });

    it('Flat fee: per new customer, in money', () => {
      show(withMoney(REFERRAL, { model: 'fee' }), BRIGHTPAGE);
      expect(rateRows()).toEqual(['Per new customer']);
      const fee = screen.getByRole('textbox', { name: 'Preferred: Per new customer' });
      expect(fee).toHaveValue('750');
      expect(fee.parentElement).toHaveTextContent('$');
    });

    it('No payment: rewards instead of cash, no table and no When partners are paid', () => {
      show(withMoney(CONSULTING, { model: 'none', rewards: 'Free license' }));
      expect(screen.getByRole('textbox', { name: 'Rewards instead of cash' })).toHaveValue('Free license');
      expect(screen.queryByRole('table', { name: 'Rates per level' })).not.toBeInTheDocument();
      expect(screen.queryByRole('region', { name: 'When partners are paid' })).not.toBeInTheDocument();
    });
  });

  it('changing Paid as keeps the other money answers', async () => {
    const { user, save } = show(REFERRAL, BRIGHTPAGE);
    await user.selectOptions(paidAs(), 'Flat fee per new customer');
    expect(rateRows()).toEqual(['Per new customer']);
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
    expect(save.mock.lastCall![0].program.money).toEqual({ ...REFERRAL.money, model: 'fee' });
    await user.selectOptions(paidAs(), 'Commission');
    expect(screen.getByRole('combobox', { name: 'Commission' })).toHaveValue('oneoff');
    expect(screen.getByRole('combobox', { name: 'Paid on' })).toHaveValue('year');
    expect(screen.getByRole('textbox', { name: 'Registered: Of the first year' })).toHaveValue('10');
    expect(screen.getByRole('textbox', { name: 'Preferred: Of the first year' })).toHaveValue('10');
  });

  it('asks when and how partners are paid, and what the program costs to run', async () => {
    const { user, save } = show();
    const when = card('When partners are paid');
    expect(within(when).getByText('Partners stay motivated when payment is quick and predictable.')).toBeInTheDocument();
    expect(options(within(when).getByRole('combobox', { name: 'Paid' }))).toEqual([
      'After the customer pays you', 'Monthly, for the month before', 'Quarterly, for the quarter before',
    ]);
    expect(within(when).getByRole('textbox', { name: 'Within' })).toHaveValue('30');
    const run = card('What the program costs to run');
    expect(within(run).getByText('Spread across the customers you expect from it, so the cost check counts it.')).toBeInTheDocument();
    for (const [name, value] of [['Partner manager time', '60,000'], ['Funds for partner marketing', '15,000'], ['Training, material and tools', '10,000'], ['New customers you expect from it', '20']] as const) {
      const input = within(run).getByRole('textbox', { name });
      expect(input).toHaveValue(value);
      expect(input.parentElement).toHaveTextContent('a year');
    }
    await user.clear(within(run).getByRole('textbox', { name: 'New customers you expect from it' }));
    await user.type(within(run).getByRole('textbox', { name: 'New customers you expect from it' }), '40');
    expect(glanceRow('Running costs per customer')).toEqual(['€2,125', '€2,125']);
    await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
    expect(save.mock.lastCall![0].program.run.deals).toBe(40);
  });

  describe('At a glance', () => {
    it('Northwind’s Reseller: the cost per typical customer, the ratios, selling direct and the good call-out', () => {
      show();
      expect(within(glance()).getByText('What partners cost you for every €1 a customer brings in, compared with selling direct. Over five years, renewals included.')).toBeInTheDocument();
      expect(within(glance()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Per typical customer', 'Registered', 'Preferred']);
      expect(glanceRow('What partners earn over five years')).toEqual(['€19,928', '€23,914']);
      expect(glanceRow('Running costs per customer')).toEqual(['€4,250', '€4,250']);
      expect(glanceRow('A customer through partners costs you')).toEqual(['€24,178', '€28,164']);
      expect(glanceRow('What a customer brings you over five years')).toEqual(['€79,712', '€79,712']);
      expect(glanceRow('Partners cost you, per €1 brought in')).toEqual(['€0.30', '€0.35']);
      expect(glanceRow('Selling direct costs you')).toEqual(['€0.40', '']);
      const ratio = within(glance()).getByRole('rowheader', { name: 'Partners cost you, per €1 brought in' }).closest('tr') as HTMLElement;
      expect(ratio).toHaveClass('font-semibold');
      expect(within(glance()).getByText('Partners cost you €0.30 to €0.35 of every €1 a customer brings in. Selling direct costs you €0.40.')).toBeInTheDocument();
    });

    it('Brightpage: selling direct not known, and the info call-out', () => {
      show(REFERRAL, BRIGHTPAGE);
      expect(glanceRow('Selling direct costs you')).toEqual(['not known', '']);
      expect(within(glance()).getByText("Partners cost you $0.18 of every $1 a customer brings in. Add last year's sales and marketing spend and revenue under Company facts to compare with selling direct.")).toBeInTheDocument();
    });

    it('one level: one column', () => {
      show({ ...RESELLER, prefOn: false });
      expect(within(glance()).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Per typical customer', 'Registered']);
      expect(glanceRow('Partners cost you, per €1 brought in')).toEqual(['€0.30']);
    });

    it('a customer worth nothing: the ratios are not known, and so is what partners on a margin earn', () => {
      show(RESELLER, { ...NORTHWIND, yearly: 0, once: 0 });
      expect(glanceRow('Partners cost you, per €1 brought in')).toEqual(['not known', 'not known']);
      expect(glanceRow('What partners earn over five years')).toEqual(['not known', 'not known']);
      expect(within(glance()).getByText('Fill in what a typical customer pays under Company facts to see what partners cost you.')).toBeInTheDocument();
    });

    it('a customer worth nothing on a flat fee: what partners earn is still the fee', () => {
      show(withMoney(REFERRAL, { model: 'fee' }), { ...BRIGHTPAGE, yearly: 0, once: 0 });
      expect(glanceRow('What partners earn over five years')).toEqual(['$500', '$750']);
      expect(glanceRow('What a customer brings you over five years')).toEqual(['not known', 'not known']);
    });

    it('follows the rates: a Preferred margin of 50 warns', async () => {
      const { user } = show();
      const pref = screen.getByRole('textbox', { name: 'Preferred: Margin, every year the customer stays' });
      await user.clear(pref);
      await user.type(pref, '50');
      expect(within(glance()).getByText('Through Preferred partners a customer costs you €0.55 of every €1 it brings in. Selling direct costs you €0.40.')).toBeInTheDocument();
    });

    it('comes after the inputs and before Back / Next, so on a phone it follows the inputs', () => {
      show();
      const inputs = card('What the program costs to run');
      const steps = screen.getByRole('navigation', { name: 'Steps' });
      expect(inputs.compareDocumentPosition(glance()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(glance().compareDocumentPosition(steps) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(screen.getByRole('link', { name: 'Next: Program Sheet' })).toHaveAttribute('href', `/programs/${RESELLER.id}/sheet`);
    });
  });

  describe('a mistake in an answer the screen no longer shows', () => {
    /** The Money and Preferred steps of `program`, in one editor. */
    function showBoth(program: Program) {
      nav.pathname = `/programs/${program.id}/money`;
      return showProgram(<><ProgramStep step="money" /><ProgramStep step="preferred" /></>, { program });
    }
    const status = () => screen.getAllByRole('status')[0]!;

    it('is named by its row on the screen while it shows, and doesn’t stop a save once the level is removed', async () => {
      const { save, user } = showBoth(RESELLER);
      const pref = screen.getByRole('textbox', { name: 'Preferred: Margin, every year the customer stays' });
      await user.clear(pref);
      await user.type(pref, '150');
      await waitFor(() => expect(status()).toHaveTextContent('Not saved: Preferred: Margin, every year the customer stays must be between 0 and 100.'), { timeout: 2000 });
      expect(save).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: 'Remove this level' }));
      const within = screen.getByRole('textbox', { name: 'Within' });
      await user.clear(within);
      await user.type(within, '45');
      await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
      const sent = save.mock.lastCall![0].program;
      expect(sent.prefOn).toBe(false);
      expect(sent.money.payDays).toBe(45);
      // The hidden rate keeps what was saved last.
      expect(sent.money.rates.pref).toEqual(RESELLER.money.rates.pref);
      await waitFor(() => expect(status()).toHaveTextContent('Saved'));
    });

    it('a contract length the screen no longer asks for keeps what was saved', async () => {
      const { save, user } = showBoth(withMoney(CONSULTING, { model: 'commission', pattern: 'oneoff', base: 'contract' }));
      const years = screen.getByRole('textbox', { name: 'First contract runs' });
      await user.clear(years);
      await user.type(years, '40');
      await waitFor(() => expect(status()).toHaveTextContent('Not saved: First contract runs: enter a number from 1 to 10 years.'), { timeout: 2000 });
      await user.selectOptions(screen.getByRole('combobox', { name: 'Paid on' }), 'The first year');
      await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
      expect(save.mock.lastCall![0].program.money).toMatchObject({ base: 'year', years: CONSULTING.money.years });
    });
  });
});

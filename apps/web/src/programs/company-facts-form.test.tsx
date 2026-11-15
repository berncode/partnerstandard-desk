// @vitest-environment jsdom
// The name lives in Settings, a save sends the facts as read (`base`), and there is no Delete company.
import type { CompanyFacts } from '@partner-desk/core';
import { brightpage, northwind } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RemoteResult } from '@/editor/remote';
import { StorageProvider } from '@/storage-context';

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: nav.refresh, push: vi.fn() }) }));

const { CompanyFactsForm } = await import('./company-facts-form');

const STAMP = '2026-10-26T10:00:00.000Z';
const LATER = '2026-10-26T10:05:00.000Z';

/** A test fixture's facts, without the name (it lives in Settings) and the programs. */
function factsOf(example: CompanyFacts & { name: string; programs: unknown }): CompanyFacts {
  const facts: Partial<typeof example> = { ...example, updatedAt: STAMP };
  delete facts.name;
  delete facts.programs;
  return facts as CompanyFacts;
}
const NORTHWIND = factsOf(northwind());

type SaveInput = { facts: CompanyFacts; base: CompanyFacts; expectedUpdatedAt: string | null };
type Save = (input: SaveInput) => Promise<RemoteResult<CompanyFacts>>;
/** The server's answer: the facts as sent, stamped. */
const saved = (updatedAt = LATER) => vi.fn<Save>(async ({ facts }) => ({ ok: true, snapshot: { value: { ...facts, updatedAt }, issues: [] }, entityId: null }));

function show(facts: CompanyFacts = NORTHWIND, { save = saved(), name = 'Northwind Security', fileUrl = null as string | null } = {}) {
  render(<CompanyFactsForm initial={facts} companyName={name} fileUrl={fileUrl} save={save} />);
  return { save };
}

const card = (name: string) => screen.getByRole('region', { name });
const field = (name: string) => screen.getByRole('textbox', { name });

describe('CompanyFactsForm', () => {
  beforeEach(() => nav.refresh.mockClear());

  it('has the six cards of Company facts', () => {
    show();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Company facts');
    expect(screen.getByText('Shared by all programs of this company')).toBeInTheDocument();
    expect(screen.getAllByRole('region').map((r) => within(r).getByRole('heading', { level: 2 }).textContent)).toEqual([
      'The company', 'A typical customer', 'What selling direct costs you', 'Deal registration', 'The customer and the handover',
      'Our figures',
    ]);
    expect(screen.getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR');
    expect(field('Pays every year')).toHaveValue('18,000');
    expect(field('Pays once')).toHaveValue('6,000');
    expect(screen.getByText('Setup, onboarding, license')).toBeInTheDocument();
    expect(field('Customers who renew')).toHaveValue('90');
    expect(within(card('A typical customer')).getByText('% a year')).toBeInTheDocument();
    expect(field('A registered deal is protected')).toHaveValue('90');
    expect(field('Extension while working on it')).toHaveValue('30');
    expect(screen.getByText('Once, with proof of activity')).toBeInTheDocument();
    expect(field('You answer within')).toHaveValue('48');
    expect(within(card('Deal registration')).getByText('hours')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'When two register the same customer' })).toHaveDisplayValue('First to register wins, with proof of work');
    expect(screen.getByRole('checkbox', { name: 'Partner paid in full if your own team closes the deal' })).toBeChecked();
    expect(within(card('Deal registration')).getByText(/^Published reasons to turn a registration down:/)).toBeInTheDocument();
    expect(field('Who keeps the customer')).toHaveValue(NORTHWIND.rules.ownerNote);
    expect(screen.getByText('Who invoices follows from each program’s partner type; this is what you add to it.')).toBeInTheDocument();
    expect(field('Handover to your sales team')).toHaveValue(NORTHWIND.rules.handover);
  });

  it('shows the company name from Settings, with a link there, and no field for it', () => {
    show();
    const company = card('The company');
    expect(within(company).getByText('Northwind Security')).toBeInTheDocument();
    expect(within(company).getByRole('link', { name: 'Change it in Settings' })).toHaveAttribute('href', '/settings');
    expect(within(company).queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('names a company without a name as Settings does', () => {
    show(NORTHWIND, { name: '' });
    expect(within(card('The company')).getByText(COPY.COMPANY_UNNAMED)).toBeInTheDocument();
  });

  it('says what a typical customer brings over five years', () => {
    show();
    expect(within(card('A typical customer')).getByText(/^A typical customer brings you/)).toHaveTextContent(
      'A typical customer brings you €79,712 over five years: €6,000 once, then €18,000 a year while they stay.',
    );
  });

  it('says what selling direct costs, or asks for both numbers', async () => {
    const user = userEvent.setup();
    show();
    const direct = card('What selling direct costs you');
    expect(within(direct).getByText(/^Selling direct costs you/)).toHaveTextContent('Selling direct costs you €0.40 of every €1 you bring in.');
    await user.clear(field('Sales and marketing, last year'));
    expect(within(direct).getByText('Fill in both to compare partners with selling direct.')).toBeInTheDocument();
    expect(field('Sales and marketing, last year')).toHaveAttribute('placeholder', 'not known');
  });

  it('asks for both numbers for a company that left them empty', () => {
    show(factsOf(brightpage()));
    expect(screen.getByText('Fill in both to compare partners with selling direct.')).toBeInTheDocument();
    expect(field('Revenue, last year')).toHaveValue('');
  });

  it('saves 800 ms after the last change, with the facts as read and their time, an emptied amount as not known', async () => {
    const user = userEvent.setup();
    const { save } = show();
    await user.clear(field('Pays every year'));
    await user.type(field('Pays every year'), '20000');
    await user.clear(field('Sales and marketing, last year'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(save).toHaveBeenCalledWith({ facts: { ...NORTHWIND, yearly: 20000, spend: null }, base: NORTHWIND, expectedUpdatedAt: STAMP });
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));

    // The next save goes over what the first one stored.
    await user.selectOptions(screen.getByRole('combobox', { name: 'When two register the same customer' }), 'You decide, case by case');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2), { timeout: 2000 });
    const second = save.mock.calls[1]![0];
    expect(second.facts.rules.conflict).toBe('case');
    expect(second.base).toEqual({ ...NORTHWIND, yearly: 20000, spend: null, updatedAt: LATER });
    expect(second.expectedUpdatedAt).toBe(LATER);
  });

  it('has Our figures, marked internal, with the figures and our default cost lines, and saves a change in them', async () => {
    const user = userEvent.setup();
    const { save } = show();
    const ours = card('Our figures');
    expect(within(ours).getByText('Internal. A new case copies these. They never reach a partner.')).toBeInTheDocument();
    expect(within(ours).getByRole('textbox', { name: 'Your gross margin' })).toHaveValue(String(NORTHWIND.ours.figures.margin));
    expect(within(ours).getByText('Your costs')).toBeInTheDocument();
    await user.clear(within(ours).getByRole('textbox', { name: 'Your gross margin' }));
    await user.type(within(ours).getByRole('textbox', { name: 'Your gross margin' }), '70');
    await user.click(within(ours).getByRole('button', { name: 'Add a cost every year' }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    const sent = save.mock.lastCall![0].facts.ours;
    expect(sent.figures.margin).toBe(70);
    expect(sent.costs).toHaveLength(NORTHWIND.ours.costs.length + 1);
    expect(sent.costs.at(-1)).toMatchObject({ name: 'New cost', when: 'yearly', source: 'assumption' });
  });

  it('sends no time for facts never saved', async () => {
    const user = userEvent.setup();
    const fresh = { ...NORTHWIND, updatedAt: '' };
    const { save } = show(fresh);
    await user.type(field('Pays once'), '0');
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(save.mock.calls[0]![0]).toMatchObject({ base: fresh, expectedUpdatedAt: null });
  });

  it('never sends facts with a mistake, and says what it is', async () => {
    const user = userEvent.setup();
    const { save } = show();
    await user.clear(field('Customers who renew'));
    await user.type(field('Customers who renew'), '150');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Not saved: Customers who renew must be between 0 and 100.'), { timeout: 2000 });
    expect(field('Customers who renew')).toHaveAccessibleDescription('Customers who renew must be between 0 and 100.');
    expect(save).not.toHaveBeenCalled();
  });

  it('stops saving and offers Reload when the sheet was changed by hand, never sending over it', async () => {
    const user = userEvent.setup();
    const save = vi.fn<Save>(async () => ({ ok: false, error: 'conflict', message: COPY.SHEET_CHANGED_MESSAGE }));
    show(NORTHWIND, { save });
    await user.type(field('Handover to your sales team'), '!');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Reload' })).toBeInTheDocument(), { timeout: 2000 });
    expect(screen.getByRole('status')).toHaveTextContent('This was changed somewhere else. Reload to see the latest.');
    await user.type(field('Handover to your sales team'), '!');
    await new Promise((r) => setTimeout(r, 1000));
    expect(save).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Reload' }));
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('offers Try again after a save Google didn’t take', async () => {
    const user = userEvent.setup();
    const save = vi.fn<Save>()
      .mockResolvedValueOnce({ ok: false, error: 'unavailable', message: COPY.UNAVAILABLE_MESSAGE })
      .mockImplementation(async ({ facts }) => ({ ok: true, snapshot: { value: { ...facts, updatedAt: LATER }, issues: [] }, entityId: null }));
    show(NORTHWIND, { save });
    await user.type(field('Pays once'), '0');
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(COPY.UNAVAILABLE_MESSAGE), { timeout: 2000 });
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/^Saved$/));
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('links to the spreadsheet when there is one', () => {
    show(NORTHWIND, { fileUrl: 'https://docs.google.com/spreadsheets/d/abc' });
    expect(screen.getByRole('link', { name: /Open in Google Sheets/ })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/abc');
  });
});

describe('CompanyFactsForm: a company server’s viewer (owner, 2026-11-14)', () => {
  it('says the page is read only, closes every field, and saves nothing', async () => {
    const save = saved();
    render(<StorageProvider storage="database" viewer><CompanyFactsForm initial={NORTHWIND} companyName="Northwind Security" fileUrl={null} save={save} /></StorageProvider>);
    expect(screen.getByText(COPY.VIEWER_LINE)).toBeInTheDocument();
    const fields = [...screen.getByTestId('closed-for-viewer').querySelectorAll('input, select, textarea, button')];
    expect(fields.length).toBeGreaterThan(10);
    for (const f of fields) expect(f).toBeDisabled();
    expect(field('Pays every year')).toHaveValue('18,000');
    expect(screen.getByRole('link', { name: COPY.FACTS_NAME_IN_SETTINGS })).toHaveAttribute('href', '/settings');
    await new Promise((r) => setTimeout(r, 900));
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the facts open for everyone else, with no viewer line', () => {
    show();
    expect(screen.queryByText(COPY.VIEWER_LINE)).toBeNull();
    expect(field('Pays every year')).toBeEnabled();
  });
});

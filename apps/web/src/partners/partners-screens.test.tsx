// @vitest-environment jsdom
import { anAccount, marketLink, partner, sampleBook } from '@partner-desk/core/test-builders';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

import { EmptyFilter, EmptyView, FindPartnersLink, NoPartnersYet } from './empty-states';
import { FilterBar, ViewTabs } from './filters';
import { PartnersBoard } from './partners-board';
import { partnersFor, type MarketOption, type PartnerQuery } from './partners-model';
import { PartnersTable } from './partners-table';

const book = sampleBook({
  accounts: [
    anAccount({ id: 'a_1', company: 'Acme GmbH', website: 'acme.example' }),
    anAccount({ id: 'a_2', company: 'Globex', website: '' }),
  ],
  partners: [
    partner({ id: 'p_1', accountId: 'a_1', updatedAt: '2026-10-05T09:00:00.000Z' }),
    partner({ id: 'p_2', accountId: 'a_2', step: 'map', partnerType: 'managed' }),
  ],
  people: [], calls: [], qualifications: [],
  marketLinks: [marketLink({ id: 'l_1', partnerId: 'p_1', marketId: 'm_a' }), marketLink({ id: 'l_2', partnerId: 'p_1', marketId: 'm_b' })],
});
const markets: MarketOption[] = [
  { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
  { marketId: 'm_b', displayName: 'Germany · Reseller', archived: false },
];
const query: PartnerQuery = { view: 'potential', type: null, market: null, program: null, stage: null, health: null, sort: 'recent', layout: 'list' };
const savedIdFor = (id: string) => id;
/** p_2 was just added: its add isn't saved yet. */
const p2Unsaved = (id: string) => (id === 'a_2' ? null : id);
/** Globex is saved; its new partner type p_2 is not yet. */
const typeUnsaved = (id: string) => (id === 'p_2' ? null : id);

describe('PartnersTable', () => {
  it('shows company, website, type, stage, markets and the date, and "No market" when there is none', () => {
    render(<PartnersTable partners={partnersFor(book, query)} book={book} markets={markets} savedIdFor={savedIdFor} />);
    const rows = screen.getAllByTestId('partner-row');
    expect(rows).toHaveLength(2);
    const acme = rows.find((r) => r.textContent?.includes('Acme GmbH'))!;
    expect(acme).toHaveTextContent('acme.example');
    expect(acme).toHaveTextContent('Reseller');
    expect(acme).toHaveTextContent('Recruitment · Researched');
    expect(acme).toHaveTextContent('Austria · Reseller and Germany · Reseller');
    expect(acme).toHaveTextContent('5 Oct 2026');
    expect(within(acme).getByRole('link', { name: 'Acme GmbH' })).toHaveAttribute('href', '/partners/a_1?type=reseller');
    const globex = rows.find((r) => r.textContent?.includes('Globex'))!;
    expect(globex).toHaveTextContent('No market');
    expect(globex).toHaveTextContent('Recruitment · MAP');
  });

  it('shows each partner type’s MAP health and next milestone in its own column, when asked', () => {
    const withMap = { ...book, partners: [{ ...book.partners[0]!, mapHealth: 'at_risk' as const, mapNextMilestone: '2026-11-20' }, book.partners[1]!] };
    const { unmount } = render(<PartnersTable partners={partnersFor(withMap, query)} book={withMap} markets={markets} savedIdFor={savedIdFor} />);
    expect(screen.queryByRole('columnheader', { name: 'MAP health' })).toBeNull();
    unmount();
    render(<PartnersTable partners={partnersFor(withMap, query)} book={withMap} markets={markets} mapHealth savedIdFor={savedIdFor} />);
    expect(screen.getByRole('columnheader', { name: 'MAP health' })).toBeInTheDocument();
    const rows = screen.getAllByTestId('partner-row');
    expect(rows.find((r) => r.textContent?.includes('Acme GmbH'))).toHaveTextContent('At riskNext milestone 20 Nov 2026');
    expect(rows.find((r) => r.textContent?.includes('Globex'))).toHaveTextContent('No MAP');
  });

  it('says "Nothing planned yet" for a MAP the directory lists whose row keeps no health (owner, 2026-10-31)', () => {
    const maps = new Set([book.partners[1]!.id]);
    render(<PartnersTable partners={partnersFor(book, query, maps)} book={book} markets={markets} mapHealth maps={maps} savedIdFor={savedIdFor} />);
    const rows = screen.getAllByTestId('partner-row');
    const globex = rows.find((r) => r.textContent?.includes('Globex'))!;
    expect(globex).toHaveTextContent('Nothing planned yet');
    expect(globex).not.toHaveTextContent('On track');
    expect(within(globex).getByText('Nothing planned yet').closest('span')).not.toHaveClass('bg-brand-soft');
    expect(rows.find((r) => r.textContent?.includes('Acme GmbH'))).toHaveTextContent('No MAP');
  });

  it('opens the partner on a click anywhere in the row', async () => {
    render(<PartnersTable partners={partnersFor(book, query)} book={book} markets={markets} savedIdFor={savedIdFor} />);
    await userEvent.click(screen.getAllByRole('cell', { name: /Managed Service Provider/ })[0]!);
    expect(push).toHaveBeenCalledWith('/partners/a_2?type=managed');
  });

  it('opens nothing for a partner whose add isn’t saved yet, and says it is saving', async () => {
    push.mockClear();
    render(<PartnersTable partners={partnersFor(book, query)} book={book} markets={markets} savedIdFor={p2Unsaved} />);
    const row = screen.getAllByTestId('partner-row').find((r) => r.textContent?.includes('Globex'))!;
    expect(within(row).queryByRole('link')).toBeNull();
    expect(row).toHaveTextContent('Saving…');
    await userEvent.click(within(row).getAllByRole('cell')[1]!);
    expect(push).not.toHaveBeenCalled();
  });
});

describe('a new partner type of a saved company', () => {
  it('has no link in the list or on the board until the type itself is saved', () => {
    const { unmount } = render(<PartnersTable partners={partnersFor(book, query)} book={book} markets={markets} savedIdFor={typeUnsaved} />);
    const row = screen.getAllByTestId('partner-row').find((r) => r.textContent?.includes('Globex'))!;
    expect(within(row).queryByRole('link')).toBeNull();
    expect(row).toHaveTextContent('Saving…');
    unmount();
    render(<PartnersBoard view="potential" partners={partnersFor(book, query)} book={book} markets={markets} savedIdFor={typeUnsaved} />);
    expect(within(screen.getByRole('region', { name: 'MAP' })).queryByRole('link', { name: 'Globex' })).toBeNull();
  });
});

describe('PartnersBoard', () => {
  it('has a column per step with its count, and each partner once', () => {
    render(<PartnersBoard view="potential" partners={partnersFor(book, query)} book={book} markets={markets} savedIdFor={savedIdFor} />);
    const headings = screen.getAllByRole('heading').map((h) => h.textContent);
    expect(headings).toEqual(['Researched', 'Discovery call', 'Qualification', 'MAP']);
    const researched = screen.getByRole('region', { name: 'Researched' });
    expect(within(researched).getByRole('link', { name: 'Acme GmbH' })).toBeVisible();
    expect(screen.getAllByRole('link', { name: 'Acme GmbH' })).toHaveLength(1);
    expect(within(screen.getByRole('region', { name: 'MAP' })).getByRole('link', { name: 'Globex' })).toBeVisible();
  });

  it('shows a partner whose add isn’t saved yet without a link, as saving', () => {
    render(<PartnersBoard view="potential" partners={partnersFor(book, query)} book={book} markets={markets} savedIdFor={p2Unsaved} />);
    const map = screen.getByRole('region', { name: 'MAP' });
    expect(within(map).queryByRole('link', { name: 'Globex' })).toBeNull();
    expect(map).toHaveTextContent('Globex');
    expect(map).toHaveTextContent('Saving…');
  });
});

describe('the tabs and filters', () => {
  it('names each view with its count and reports a change', async () => {
    const onChange = vi.fn();
    render(<ViewTabs view="active" counts={{ potential: 5, active: 3, closed: 2 }} onChange={onChange}>panel</ViewTabs>);
    expect(screen.getByRole('tab', { name: 'Active 3' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Potential 5' })).toBeVisible();
    await userEvent.click(screen.getByRole('tab', { name: 'Closed 2' }));
    expect(onChange).toHaveBeenCalledWith('closed');
  });

  it('filters and sorts by MAP health once a partner type has a MAP', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar query={query} markets={markets} onChange={onChange} />);
    expect(screen.queryByLabelText('MAP health')).toBeNull();
    rerender(<FilterBar query={query} markets={markets} mapHealth onChange={onChange} />);
    expect(within(screen.getByLabelText('MAP health')).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['Any MAP health', 'Off track', 'At risk', 'On track', 'Nothing planned yet', 'No MAP']);
    await userEvent.selectOptions(screen.getByLabelText('MAP health'), 'No MAP');
    expect(onChange).toHaveBeenLastCalledWith({ health: 'none' });
    await userEvent.click(screen.getByRole('button', { name: 'Sort by MAP health' }));
    expect(onChange).toHaveBeenLastCalledWith({ sort: 'health' });
    rerender(<FilterBar query={{ ...query, sort: 'health' }} markets={markets} mapHealth onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Sort by MAP health' })).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(screen.getByRole('button', { name: 'Sort by MAP health' }));
    expect(onChange).toHaveBeenLastCalledWith({ sort: 'recent' });
  });

  it('offers the view’s own stage choices, and a board switch only where there is a board', () => {
    const { rerender } = render(<FilterBar query={{ ...query, view: 'active' }} markets={markets} onChange={vi.fn()} />);
    const stage = screen.getByLabelText('Stage');
    expect(Array.from(stage.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['All stages', 'Onboarding', 'Growth', 'Expansion', 'Exit']);
    expect(screen.getByRole('button', { name: 'Board' })).toBeVisible();
    rerender(<FilterBar query={{ ...query, view: 'closed' }} markets={markets} onChange={vi.fn()} />);
    expect(Array.from(screen.getByLabelText('Stage').querySelectorAll('option')).map((o) => o.textContent)).toEqual(['All stages', 'Not now', 'No', 'Exited']);
    expect(screen.queryByRole('button', { name: 'Board' })).toBeNull();
    expect(screen.getByLabelText('Partner type')).toHaveDisplayValue('All partner types');
    expect(screen.getByLabelText('Market')).toHaveDisplayValue('All markets');
  });

  it('reports the layout and a changed filter', async () => {
    const onChange = vi.fn();
    render(<FilterBar query={query} markets={markets} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'Board' }));
    expect(onChange).toHaveBeenCalledWith({ layout: 'board' });
    await userEvent.selectOptions(screen.getByLabelText('Market'), 'm_b');
    expect(onChange).toHaveBeenCalledWith({ market: 'm_b' });
    await userEvent.selectOptions(screen.getByLabelText('Partner type'), 'managed');
    expect(onChange).toHaveBeenCalledWith({ type: 'managed' });
  });
});

describe('the Program column and filter', () => {
  const programs = [
    { programId: 'pg_a', label: 'Reseller', partnerType: 'reseller' as const, title: 'Reseller' },
    { programId: 'pg_b', label: 'Referral', partnerType: 'referral' as const, title: 'Referral' },
  ];
  const joined = { ...book, partners: book.partners.map((p) => (p.id === 'p_1' ? { ...p, programId: 'pg_a' } : { ...p, programId: 'pg_gone' })) };

  it('shows each partner’s program, a program that is gone as gone, and none as "No program"', () => {
    const { rerender } = render(<PartnersTable partners={partnersFor(joined, query)} book={joined} markets={markets} programs={programs} savedIdFor={savedIdFor} />);
    expect(screen.getByRole('columnheader', { name: 'Program' })).toBeInTheDocument();
    const row = (name: string) => screen.getAllByTestId('partner-row').find((r) => r.textContent?.includes(name))!;
    // The fifth cell, after company, type, stage and markets.
    const programCell = (name: string) => within(row(name)).getAllByRole('cell')[4]!;
    expect(programCell('Acme GmbH')).toHaveTextContent(/^Reseller$/);
    expect(programCell('Acme GmbH')).toHaveAttribute('data-label', 'Program');
    expect(programCell('Globex')).toHaveTextContent('A deleted program');
    rerender(<PartnersTable partners={partnersFor(book, query)} book={book} markets={markets} programs={programs} savedIdFor={savedIdFor} />);
    expect(programCell('Globex')).toHaveTextContent('No program');
  });

  it('filters by a program or by none, and shows one in the address that is gone', async () => {
    const onChange = vi.fn();
    const { rerender } = render(<FilterBar query={query} markets={markets} programs={programs} onChange={onChange} />);
    const filter = screen.getByRole('combobox', { name: 'Program' });
    expect(within(filter).getAllByRole('option').map((o) => o.textContent)).toEqual(['All programs', 'Reseller', 'Referral', 'No program']);
    await userEvent.selectOptions(filter, 'Reseller');
    expect(onChange).toHaveBeenCalledWith({ program: 'pg_a' });
    await userEvent.selectOptions(filter, 'All programs');
    expect(onChange).toHaveBeenCalledWith({ program: null });
    rerender(<FilterBar query={{ ...query, program: 'pg_gone' }} markets={markets} programs={programs} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Program' })).toHaveDisplayValue('A deleted program');
  });

  it('has no Program column while the company has no program and no partner is in one', () => {
    render(<PartnersTable partners={partnersFor(book, query)} book={book} markets={markets} programs={[]} savedIdFor={savedIdFor} />);
    expect(screen.queryByRole('columnheader', { name: 'Program' })).toBeNull();
    expect(screen.getAllByTestId('partner-row')[0]!.querySelector('td[data-label="Program"]')).toBeNull();
  });

  it('shows a stored program as plain unknown when the list couldn’t be read', () => {
    render(<FilterBar query={{ ...query, program: 'pg_a' }} markets={markets} programs={[]} programsListed={false} onChange={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Program' })).toHaveDisplayValue('pg_a');
  });

  it('has no Program filter while the company has no program', () => {
    render(<FilterBar query={query} markets={markets} programs={[]} onChange={vi.fn()} />);
    expect(screen.queryByRole('combobox', { name: 'Program' })).toBeNull();
  });
});

describe('the empty states', () => {
  it('a new account can add a partner or find some', async () => {
    const onAdd = vi.fn();
    render(<NoPartnersYet onAdd={onAdd} canAdd />);
    expect(screen.getByRole('heading', { name: 'No partners yet' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'Add a partner' }));
    expect(onAdd).toHaveBeenCalled();
    expect(screen.getByRole('link', { name: 'Find partners' })).toHaveAttribute('href', '/markets?find=partners');
  });

  it('an empty view says what belongs there, and an empty filter offers Clear filters', async () => {
    const { rerender } = render(<EmptyView view="active" onAdd={vi.fn()} canAdd />);
    expect(screen.getByText('No active partners yet. A partner shows here once you mark it signed.')).toBeVisible();
    rerender(<EmptyView view="potential" onAdd={vi.fn()} canAdd />);
    expect(screen.getByRole('button', { name: 'Add a partner' })).toBeVisible();
    const onClear = vi.fn();
    rerender(<EmptyFilter onClear={onClear} />);
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('the Find partners link goes to Markets', () => {
    render(<FindPartnersLink />);
    expect(screen.getByRole('link', { name: 'Find partners' })).toHaveAttribute('href', '/markets?find=partners');
  });
});

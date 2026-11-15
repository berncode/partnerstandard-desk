// @vitest-environment jsdom
import type { Partner, PartnerBook } from '@partner-desk/core';
import { aPartner as partner, anAccount, marketLink, person, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { Overview } from './overview';
import { renderPartner } from './test-harness';

const markets = [
  { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
  { marketId: 'm_b', displayName: 'Germany · Reseller', archived: false },
  { marketId: 'm_c', displayName: 'Italy · Reseller', archived: true },
  { marketId: 'm_d', displayName: 'Spain · Distributor', archived: false },
];
const book = (over: Partial<Partner> = {}, rest: Partial<PartnerBook> = {}) =>
  sampleBook({ partners: [partner(over)], people: [], calls: [], qualifications: [], marketLinks: [], ...rest });

describe('Overview', () => {
  it('shows the details, the markets with their partner hypothesis, and the people', () => {
    renderPartner(<Overview />, book({}, {
      people: [person({ name: 'Eva Roth' })],
      marketLinks: [marketLink({ id: 'l_a', marketId: 'm_a', hypothesisId: 'h_1' }), marketLink({ id: 'l_b', marketId: 'm_b' })],
    }), { markets, marketStates: { m_a: { status: 'ready', market: sampleMarket() }, m_b: { status: 'loading' } } });
    expect(screen.getByRole('heading', { name: 'Details' })).toBeInTheDocument();
    const links = screen.getAllByTestId('market-link');
    expect(links).toHaveLength(2);
    expect(within(links[0]!).getByRole('link', { name: 'Austria · Reseller' })).toHaveAttribute('href', '/markets/m_a');
    expect(links[0]).toHaveTextContent('Mid-size IT firms');
    expect(links[0]).toHaveTextContent('Holds');
    expect(links[1]).toHaveTextContent('Loading the market…');
    expect(screen.getByRole('button', { name: 'Name: Eva Roth' })).toBeInTheDocument();
    expect(screen.getByText('1 active seller')).toBeInTheDocument();
  });

  it('edits a company fact with an undo label, and the partner type is not a control', async () => {
    const user = userEvent.setup();
    const { dispatched } = renderPartner(<Overview />, book({}, { accounts: [anAccount({ vertical: '' })] }), { markets });
    await user.click(screen.getByRole('button', { name: 'Vertical: empty' }));
    await user.keyboard('Security{Enter}');
    expect(dispatched.at(-1)).toEqual({
      change: { kind: 'update', entity: 'account', id: 'a_abc123', patch: { vertical: 'Security' } }, options: { label: 'Partner updated' },
    });
    expect(screen.queryByRole('combobox', { name: 'Partner type' })).toBeNull();
    expect(screen.getByText('Reseller')).toBeInTheDocument();
  });

  it('adds it to an open market of its type that it is not in yet', async () => {
    const user = userEvent.setup();
    const { dispatched } = renderPartner(<Overview />, book({}, { marketLinks: [marketLink({ marketId: 'm_a' })] }), { markets });
    const select = screen.getByLabelText('Add to a market');
    expect(within(select).getAllByRole('option').map((o) => o.textContent)).toEqual(['Pick a market', 'Germany · Reseller']);
    await user.selectOptions(select, 'Germany · Reseller');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(dispatched.at(-1)).toEqual({
      change: { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_abc123', marketId: 'm_b', hypothesisId: null } },
      options: { label: 'Market added' },
    });
    expect(screen.getAllByTestId('market-link')).toHaveLength(2);
    expect(screen.getByText('No other market for Reseller yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Markets' })).toHaveAttribute('href', '/markets');
  });

  it('says plainly when the partner is in no market', () => {
    renderPartner(<Overview />, book(), { markets: [] });
    expect(screen.getByText('Not in a market yet. A market holds the partner hypotheses a partner can match.')).toBeInTheDocument();
  });

  it('adds a person, and only a seller can be an active seller', async () => {
    const user = userEvent.setup();
    const { dispatched } = renderPartner(<Overview />, book(), { markets });
    await user.click(screen.getByRole('button', { name: 'Add person' }));
    const form = screen.getByRole('form', { name: 'New person' });
    await user.type(within(form).getByLabelText('Name'), 'Jonas Weber');
    await user.selectOptions(within(form).getByLabelText('Role'), 'Seller');
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(dispatched.at(-1)?.change).toMatchObject({ kind: 'add', entity: 'person', values: { accountId: 'a_abc123', name: 'Jonas Weber', role: 'seller' } });
    await user.click(screen.getByRole('checkbox', { name: 'Active seller' }));
    expect(screen.getByText('1 active seller')).toBeInTheDocument();
  });

  it('shows the details as text when read-only, with no adding', () => {
    renderPartner(<Overview />, book({}, { accounts: [anAccount({ vertical: 'Security' })] }), { markets, readOnly: true });
    expect(screen.getByText('Security')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Vertical/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add person' })).toBeNull();
    expect(screen.queryByLabelText('Add to a market')).toBeNull();
  });
});

// @vitest-environment jsdom
import { TEXT_MAX, type PartnerBook } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { anAccount, marketInfo, marketLink, partner, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ marketRead: vi.fn() }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/app/(signed-in)/actions/markets', () => ({ marketRead: actions.marketRead }));

import { toast } from 'sonner';
import { ExclusionsPanel } from './exclusions-panel';
import { MarketHeader } from './market-header';
import { FirstPartnersNotice, NeedsAttention } from './needs-attention';
import { Pipeline } from './pipeline';
import { renderMarket } from './test-harness';

const M = 'm_abcdefghij';
const market = () => sampleMarket({ info: marketInfo({ checkAgain: [] }), valuePoints: [], hypotheses: [{ ...sampleMarket().hypotheses[0]!, checkAgain: false, valuePointIds: [] }] });

/** Alpha (researched, here), Delta (closed, here), Gamma (signed, here, with the hypothesis), Fabrikam (a reseller elsewhere), Contoso (another type). */
function book(): PartnerBook {
  const rows = [
    { company: 'Alpha', partner: partner({ id: 'p_1', accountId: 'a_p_1' }) },
    { company: 'Delta', partner: partner({ id: 'p_2', accountId: 'a_p_2', closed: 'no' }) },
    { company: 'Gamma', partner: partner({ id: 'p_3', accountId: 'a_p_3', stage: 'onboarding', step: null, signedDate: '2026-09-15' }) },
    { company: 'Fabrikam Systems', website: 'fabrikam.example', partner: partner({ id: 'p_4', accountId: 'a_p_4' }) },
    { company: 'Contoso', partner: partner({ id: 'p_5', accountId: 'a_p_5', partnerType: 'managed' }) },
  ];
  return sampleBook({
    accounts: rows.map((row) => anAccount({ id: row.partner.accountId, company: row.company, website: row.website ?? '' })),
    partners: rows.map((row) => row.partner),
    marketLinks: [
      marketLink({ id: 'l_1', partnerId: 'p_1' }),
      marketLink({ id: 'l_2', partnerId: 'p_2' }),
      marketLink({ id: 'l_3', partnerId: 'p_3', hypothesisId: 'h_1' }),
      marketLink({ id: 'l_4', partnerId: 'p_4', marketId: 'm_other00000' }),
    ],
    calls: [], people: [], qualifications: [],
  });
}

const lane = (name: string) => screen.getByRole('region', { name });

beforeEach(() => vi.clearAllMocks());

describe('the header', () => {
  it('names the market, its status and what to check again, with the spreadsheet and the Exclusions', async () => {
    const onExclusions = vi.fn();
    renderMarket(<MarketHeader fileUrl="https://docs.google.com/spreadsheets/d/f_1/edit" onExclusions={onExclusions} />, { market: sampleMarket(), book: book() });
    expect(screen.getByRole('heading', { level: 1, name: 'Austria · Reseller' })).toBeInTheDocument();
    expect(screen.getByText('Partly validated')).toBeInTheDocument();
    expect(screen.getByText('4 items to check again')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open in Google Sheets' })).toHaveAttribute('href', 'https://docs.google.com/spreadsheets/d/f_1/edit');
    await userEvent.click(screen.getByRole('button', { name: 'Exclusions' }));
    expect(onExclusions).toHaveBeenCalled();
  });

  it('has no spreadsheet link when there is no spreadsheet', () => {
    renderMarket(<MarketHeader fileUrl={null} onExclusions={() => {}} />, { market: market(), book: book() });
    expect(screen.queryByRole('link', { name: 'Open in Google Sheets' })).not.toBeInTheDocument();
    expect(screen.queryByText(/to check again/)).not.toBeInTheDocument();
  });
});

describe('notices', () => {
  it('lists the rows the sheet couldn’t read, and says nothing when there are none', () => {
    const { rerender } = render(<NeedsAttention items={[{ where: 'Exclusions tab, row 3', message: 'Website is empty' }]} />);
    expect(screen.getByRole('note')).toHaveTextContent('Some of this market’s sheet needs attention');
    expect(screen.getByRole('note')).toHaveTextContent('The app leaves these rows alone. Fix them in the sheet, then reload this page.');
    expect(screen.getByRole('note')).toHaveTextContent('Exclusions tab, row 3: Website is empty');
    rerender(<NeedsAttention items={[]} />);
    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });

  it('says how many first partners weren’t added, and can be dismissed', async () => {
    const onDismiss = vi.fn();
    render(<FirstPartnersNotice count={1} onDismiss={onDismiss} />);
    expect(screen.getByRole('status')).toHaveTextContent('1 first partner wasn’t added. Add it on the Pipeline tab.');
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalled();
  });
});

describe('the Pipeline', () => {
  it('shows a partner whose add isn’t saved yet without a link, as saving', () => {
    renderMarket(<Pipeline />, { market: market(), book: book() }, { unsaved: ['a_p_1'] });
    const researched = lane('Researched');
    expect(within(researched).queryByRole('link', { name: 'Alpha' })).toBeNull();
    expect(researched).toHaveTextContent('Alpha');
    expect(researched).toHaveTextContent('Saving…');
  });

  it('shows this market’s partners by step and Signed, hides closed ones, and filters by the link’s hypothesis', async () => {
    const user = userEvent.setup();
    renderMarket(<Pipeline />, { market: market(), book: book() });
    expect(within(lane('Researched')).getByRole('link', { name: 'Alpha' })).toHaveAttribute('href', '/partners/a_p_1?type=reseller');
    expect(within(lane('Signed')).getByText('Gamma')).toBeInTheDocument();
    expect(within(lane('Signed')).getByText('Onboarding')).toBeInTheDocument();
    expect(within(lane('Signed')).getByText('Mid-size IT firms')).toBeInTheDocument();
    expect(screen.queryByText('Fabrikam Systems')).not.toBeInTheDocument();
    expect(screen.queryByText('Delta')).not.toBeInTheDocument();
    expect(screen.getByText('1 closed hidden')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Show closed'));
    expect(within(lane('Researched')).getByText('Delta')).toBeInTheDocument();
    expect(within(lane('Researched')).getByText('No')).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Partner hypothesis' }), 'Mid-size IT firms');
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(screen.getByText('Gamma')).toBeInTheDocument();
  });

  it('adds a new company with its link to this market in one batch, and keeps the form open', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<Pipeline />, { market: market(), book: book() });
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    const form = screen.getByRole('form', { name: 'New partner' });
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getByText('Company is required')).toBeInTheDocument();

    // The error is part of the label until the company is typed.
    await user.type(within(form).getByLabelText(/^Company/), 'Datum Labs');
    await user.type(within(form).getByLabelText('Website'), 'datum.example{Enter}');
    expect(log.partnerBatches).toHaveLength(1);
    const [batch] = log.partnerBatches;
    expect(batch!.marketId).toBe(M);
    // The editor shows the one "Partner added" toast, with Undo; the form shows none of its own.
    expect(batch!.label).toBe(COPY.PARTNER_ADDED);
    expect(toast).not.toHaveBeenCalled();
    expect(batch!.changes[0]).toMatchObject({ kind: 'add', entity: 'account', values: { company: 'Datum Labs', website: 'datum.example' } });
    expect(batch!.changes[1]).toMatchObject({ kind: 'add', entity: 'partner', values: { partnerType: 'reseller' } });
    expect(batch!.changes[2]).toMatchObject({ kind: 'add', entity: 'marketLink', values: { marketId: M, hypothesisId: null } });
    await waitFor(() => expect(within(lane('Researched')).getByText('Datum Labs')).toBeInTheDocument());
    expect(within(form).getByLabelText('Company')).toHaveValue('');
  });

  it('keeps the form and says why under Company when the add is refused, with no "Partner added"', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<Pipeline />, { market: market(), book: book() });
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    const form = screen.getByRole('form', { name: 'New partner' });
    const tooLong = 'x'.repeat(TEXT_MAX + 1);
    fireEvent.change(within(form).getByLabelText('Company'), { target: { value: tooLong } });
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(log.partnerBatches).toHaveLength(1);
    expect(within(form).getByText(COPY.TOO_LONG)).toBeInTheDocument();
    expect(within(form).getByLabelText(/^Company/)).toHaveValue(tooLong);
    expect(within(form).getByLabelText(/^Company/)).toHaveAttribute('aria-invalid', 'true');
    expect(toast).not.toHaveBeenCalled();
    expect(screen.queryByText(tooLong)).not.toBeInTheDocument();
  });

  it('shows a refused website under Website, not under Company', async () => {
    const user = userEvent.setup();
    renderMarket(<Pipeline />, { market: market(), book: book() });
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    const form = screen.getByRole('form', { name: 'New partner' });
    await user.type(within(form).getByLabelText('Company'), 'Datum Labs');
    fireEvent.change(within(form).getByLabelText('Website'), { target: { value: 'x'.repeat(TEXT_MAX + 1) } });
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    const website = within(form).getByLabelText(/^Website/);
    expect(website).toHaveAttribute('aria-invalid', 'true');
    expect(website).toHaveAccessibleDescription(COPY.TOO_LONG);
    const company = within(form).getByLabelText(/^Company/);
    expect(company).not.toHaveAttribute('aria-invalid');
    expect(company).toHaveAccessibleDescription('');
    expect(company).toHaveValue('Datum Labs');
    expect(toast).not.toHaveBeenCalled();
  });

  it('clears only the error of the field being typed in', async () => {
    const user = userEvent.setup();
    renderMarket(<Pipeline />, { market: market(), book: book() });
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    const form = screen.getByRole('form', { name: 'New partner' });
    fireEvent.change(within(form).getByLabelText('Company'), { target: { value: 'x'.repeat(TEXT_MAX + 1) } });
    fireEvent.change(within(form).getByLabelText('Website'), { target: { value: 'y'.repeat(TEXT_MAX + 1) } });
    await user.click(within(form).getByRole('button', { name: 'Add' }));
    expect(within(form).getAllByText(COPY.TOO_LONG)).toHaveLength(2);

    await user.type(within(form).getByLabelText(/^Company/), 'z');
    expect(within(form).getByLabelText(/^Company/)).not.toHaveAttribute('aria-invalid');
    expect(within(form).getByLabelText(/^Website/)).toHaveAttribute('aria-invalid', 'true');
    expect(within(form).getAllByText(COPY.TOO_LONG)).toHaveLength(1);

    await user.type(within(form).getByLabelText(/^Website/), 'z');
    expect(within(form).queryByText(COPY.TOO_LONG)).not.toBeInTheDocument();
  });

  it('gives a company of the same type this market, says when it is here already, and warns about another type', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<Pipeline />, { market: market(), book: book() });
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    const form = screen.getByRole('form', { name: 'New partner' });
    const company = within(form).getByLabelText('Company');

    await user.type(company, 'Fabrikam Systems');
    expect(within(form).getByRole('status')).toHaveTextContent('Fabrikam Systems is already a partner as Reseller.');
    expect(within(form).queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Add Austria · Reseller to it' }));
    expect(log.partners[0]?.change).toEqual({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_4', marketId: M, hypothesisId: null } });
    expect(log.partners[0]?.options).toEqual({ label: 'Added to Austria · Reseller' });

    await user.type(company, 'Alpha');
    expect(within(form).getByRole('status')).toHaveTextContent('It is already in Austria · Reseller.');
    expect(within(form).queryByRole('button', { name: /to it$/ })).not.toBeInTheDocument();
    expect(within(form).getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/partners/a_p_1?type=reseller');

    await user.clear(company);
    await user.type(company, 'Contoso');
    expect(within(form).getByRole('status')).toHaveTextContent('Contoso is already your managed service provider. This adds Contoso as a reseller.');
    await user.click(within(form).getByRole('button', { name: /^Add$/ }));
    expect(log.partnerBatches[0]?.changes[0]).toMatchObject({ kind: 'add', entity: 'partner', values: { accountId: 'a_p_5', partnerType: 'reseller' } });
    expect(log.partnerBatches[0]?.changes[1]).toMatchObject({ kind: 'add', entity: 'marketLink' });
  });

  it('names a closed partner, and asks before adding a company on the Exclusions', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<Pipeline />, { market: market(), book: book() });
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    const form = screen.getByRole('form', { name: 'New partner' });
    const company = within(form).getByLabelText('Company');

    await user.type(company, 'Delta');
    expect(within(form).getByRole('status')).toHaveTextContent('You closed Delta as a reseller (No).');
    expect(within(form).getByRole('status')).toHaveTextContent('It is already in Austria · Reseller.');
    expect(within(form).queryByRole('button', { name: /^Add$/ })).not.toBeInTheDocument();

    await user.clear(company);
    await user.type(company, 'Omega');
    expect(within(form).getByRole('status')).toHaveTextContent(COPY.ON_EXCLUSIONS('Omega GmbH'));
    // Enter keeps the question open: only the deliberate Add anyway adds an excluded company.
    await user.type(company, '{Enter}');
    expect(log.partnerBatches).toHaveLength(0);
    expect(within(form).getByRole('status')).toHaveTextContent(COPY.ON_EXCLUSIONS('Omega GmbH'));
    await user.click(within(form).getByRole('button', { name: 'Add anyway' }));
    const changes = log.partnerBatches[0]?.changes;
    expect(changes?.[0]).toMatchObject({ kind: 'add', entity: 'account', values: { company: 'Omega', website: '' } });
    expect(changes?.[1]).toMatchObject({ kind: 'add', entity: 'partner', values: { partnerType: 'reseller' } });
    expect(changes?.[2]).toMatchObject({ kind: 'add', entity: 'marketLink', values: { marketId: M } });
    const accountAdd = changes?.[0];
    const partnerAdd = changes?.[1];
    if (accountAdd?.kind !== 'add' || partnerAdd?.kind !== 'add') throw new Error('expected adds');
    expect(partnerAdd.values.accountId).toBe(accountAdd.values.id);
  });

  it('puts this market’s type on a company that is here with no partner type, in one batch', async () => {
    const user = userEvent.setup();
    const start = book();
    start.accounts.push(anAccount({ id: 'a_hidden', company: 'Hidden Co', website: '', country: '' }));
    const { log } = renderMarket(<Pipeline />, { market: market(), book: start });
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    const form = screen.getByRole('form', { name: 'New partner' });
    await user.type(within(form).getByLabelText('Company'), 'Hidden Co{Enter}');
    const changes = log.partnerBatches[0]?.changes;
    expect(changes).toHaveLength(2);
    expect(changes?.[0]).toMatchObject({ kind: 'add', entity: 'partner', values: { accountId: 'a_hidden', partnerType: 'reseller' } });
    expect(changes?.[1]).toMatchObject({ kind: 'add', entity: 'marketLink', values: { marketId: M } });
  });

  it('opens the search prompt with Find partners with AI, and offers no changes when read-only', async () => {
    const openTab = vi.fn();
    renderMarket(<Pipeline />, { market: market(), book: book() }, { openTab, readOnly: true });
    await userEvent.click(screen.getByRole('link', { name: 'Find partners with AI' }));
    expect(openTab).toHaveBeenCalledWith('hypothesis', 'search-prompt');
    expect(screen.queryByRole('button', { name: 'Add a partner' })).not.toBeInTheDocument();
  });

  it('says when the market has no partners yet', () => {
    renderMarket(<Pipeline />, { market: market(), book: sampleBook({ marketLinks: [] }) });
    expect(screen.getByText(/^No partners yet\. Add the companies you know/)).toBeInTheDocument();
  });
});

describe('the Exclusions panel', () => {
  const markets = [
    { marketId: M, displayName: 'Austria · Reseller', archived: false },
    { marketId: 'm_germany000', displayName: 'Germany · Reseller', archived: false },
    { marketId: 'm_old0000000', displayName: 'Italy · Reseller', archived: true },
  ];

  it('says what searches leave out, lists the exclusions and adds one', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<ExclusionsPanel open onOpenChange={() => {}} />, { market: sampleMarket(), book: book() }, { markets });
    const panel = screen.getByRole('dialog', { name: 'Exclusions' });
    expect(panel).toHaveTextContent('Companies to leave out of this market’s searches and imports. Partners already in this market are left out anyway.');
    expect(within(panel).getByText('Omega GmbH')).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Add company' }));
    const form = within(panel).getByRole('form', { name: 'New exclusion' });
    await user.type(within(form).getByLabelText('Company'), 'Tauern Systems');
    await user.type(within(form).getByLabelText('Reason'), 'Existing partner{Enter}');
    expect(log.market[0]?.change).toEqual({ kind: 'add', entity: 'exclusion', values: { company: 'Tauern Systems', website: '', reason: 'Existing partner' } });
    expect(within(panel).getByText('Tauern Systems')).toBeInTheDocument();
  });

  it('imports the Exclusions another open market has and this one lacks', async () => {
    const user = userEvent.setup();
    const other = sampleMarket({ exclusions: [
      { ...sampleMarket().exclusions[0]! },
      { id: 'x_2', company: 'Tauern Systems', website: 'tauern.example', reason: 'Existing partner', updatedAt: null, updatedBy: 'Someone' },
    ] });
    actions.marketRead.mockResolvedValue({ ok: true, snapshot: { value: other, issues: [] }, entityId: null });
    const { log } = renderMarket(<ExclusionsPanel open onOpenChange={() => {}} />, { market: sampleMarket(), book: book() }, { markets });
    const panel = screen.getByRole('dialog', { name: 'Exclusions' });
    await user.click(within(panel).getByRole('button', { name: 'Import from another market' }));
    const choice = within(panel).getByRole('combobox', { name: 'Market' });
    expect(within(choice).getAllByRole('option').map((o) => o.textContent)).toEqual(['Germany · Reseller']);
    await user.click(within(panel).getByRole('button', { name: 'Import' }));
    expect(actions.marketRead).toHaveBeenCalledWith('m_germany000');
    expect(await within(panel).findByText('1 company added, 1 already there')).toBeInTheDocument();
    expect(log.marketBatches).toEqual([[{ kind: 'add', entity: 'exclusion', values: { company: 'Tauern Systems', website: 'tauern.example', reason: 'Existing partner' } }]]);
    expect(within(panel).getByText('Tauern Systems')).toBeInTheDocument();
  });

  it('says why the other market couldn’t be read, and offers no import without another open market', async () => {
    const user = userEvent.setup();
    actions.marketRead.mockResolvedValue({ ok: false, error: 'auth', message: 'Google needs your permission again.' });
    const { unmount } = renderMarket(<ExclusionsPanel open onOpenChange={() => {}} />, { market: sampleMarket(), book: book() }, { markets });
    await user.click(screen.getByRole('button', { name: 'Import from another market' }));
    await user.click(screen.getByRole('button', { name: 'Import' }));
    expect(await screen.findByText('Google needs your permission again.')).toBeInTheDocument();
    unmount();
    renderMarket(<ExclusionsPanel open onOpenChange={() => {}} />, { market: sampleMarket(), book: book() }, { markets: [markets[0]!, markets[2]!] });
    expect(screen.queryByRole('button', { name: 'Import from another market' })).not.toBeInTheDocument();
  });
});

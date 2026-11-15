// @vitest-environment jsdom
import { partner, sampleBook } from '@partner-desk/core/test-builders';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
const actions = vi.hoisted(() => ({
  marketArchive: vi.fn(), marketCreate: vi.fn(), marketCopy: vi.fn(), partnerImport: vi.fn(),
}));
const toast = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => nav }));
vi.mock('sonner', () => ({ toast }));
vi.mock('@/app/(signed-in)/actions/markets', () => ({
  marketArchive: actions.marketArchive, marketCreate: actions.marketCreate, marketCopy: actions.marketCopy,
}));
vi.mock('@/app/(signed-in)/actions/partners', () => ({ partnerImport: actions.partnerImport }));
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

import { newMarket } from '@partner-desk/core';
import { CopyForm } from './copy-form';
import { GuidedFlow } from './guided-flow';
import { MarketCard, UnarchiveButton } from './market-card';
import { LoadProblem } from './load-problem';
import { StorageProvider } from '@/storage-context';

beforeEach(() => {
  vi.clearAllMocks();
  window.sessionStorage.clear();
});

const counts = { steps: { researched: 3, discovery_call: 2, qualification: 1, map: 0 }, signed: 4, closed: 5 };

describe('MarketCard', () => {
  it('shows the name as a link, a count per step plus Signed, and the closed ones', () => {
    render(<MarketCard marketId="mk_1" displayName="Austria · Reseller" counts={counts} />);
    expect(screen.getByRole('link', { name: 'Austria · Reseller' })).toHaveAttribute('href', '/markets/mk_1');
    expect(screen.getByLabelText('Partners per step')).toHaveTextContent(/Researched3Discovery call2Qualification1MAP0Signed4/);
    expect(screen.getByText('5 closed')).toBeInTheDocument();
  });

  it('says so when the counts can’t be shown, instead of showing zeros', () => {
    render(<MarketCard marketId="mk_1" displayName="Austria · Reseller" counts={null} />);
    expect(screen.queryByLabelText('Partners per step')).toBeNull();
    expect(screen.getByText('The partner counts can’t be shown right now.')).toBeInTheDocument();
  });

  it('asks before archiving, then archives and refreshes the list', async () => {
    actions.marketArchive.mockResolvedValue({ ok: true });
    render(<MarketCard marketId="mk_1" displayName="Austria · Reseller" counts={counts} />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Austria · Reseller' }));
    const dialog = screen.getByRole('dialog', { name: 'Archive Austria · Reseller?' });
    expect(dialog).toHaveTextContent('It leaves your markets. Its spreadsheet stays in your Google Drive.');
    expect(actions.marketArchive).not.toHaveBeenCalled();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(actions.marketArchive).toHaveBeenCalledWith('mk_1', true);
  });

  it('shows a refusal as a toast and keeps the dialog open', async () => {
    actions.marketArchive.mockResolvedValue({ ok: false, error: 'forbidden', message: 'Only a person can archive a market.' });
    render(<MarketCard marketId="mk_1" displayName="Austria · Reseller" counts={counts} />);
    await userEvent.click(screen.getByRole('button', { name: 'Archive Austria · Reseller' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Only a person can archive a market.'));
    expect(nav.refresh).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });
});

describe('UnarchiveButton', () => {
  it('brings the market back and refreshes; a thrown action is a toast', async () => {
    actions.marketArchive.mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('offline'));
    render(<UnarchiveButton marketId="mk_1" displayName="Austria · Reseller" />);
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive Austria · Reseller' }));
    await waitFor(() => expect(nav.refresh).toHaveBeenCalledTimes(1));
    expect(actions.marketArchive).toHaveBeenCalledWith('mk_1', false);
    await userEvent.click(screen.getByRole('button', { name: 'Unarchive Austria · Reseller' }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Couldn’t reach the server. Check your connection and try again.'));
  });
});

describe('CopyForm', () => {
  const sources = [{ marketId: 'mk_1', displayName: 'Austria · Reseller' }, { marketId: 'mk_2', displayName: 'Germany · Reseller' }];

  it('copies the chosen market under the new name and type, then opens the copy', async () => {
    actions.marketCopy.mockResolvedValue({ ok: true, entityId: 'mk_9', snapshot: {} });
    render(<CopyForm sources={sources} storage="memory" />);
    await userEvent.selectOptions(screen.getByLabelText('Copy from'), 'mk_2');
    await userEvent.type(screen.getByLabelText(/^New market/), 'Switzerland');
    await userEvent.selectOptions(screen.getByLabelText(/^Partner type/), 'Managed Service Provider');
    await userEvent.click(screen.getByRole('button', { name: 'Copy market' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/markets/mk_9'));
    expect(actions.marketCopy).toHaveBeenCalledWith({ marketId: 'mk_2', info: { marketName: 'Switzerland', partnerType: 'managed' } });
  });

  it('shows the refusal under the field and stays', async () => {
    actions.marketCopy.mockResolvedValue({ ok: false, error: 'invalid', message: 'Check the form.', fieldErrors: { marketName: 'Market is required' } });
    render(<CopyForm sources={sources} storage="memory" />);
    await userEvent.click(screen.getByRole('button', { name: 'Copy market' }));
    expect(await screen.findByText('Market is required')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Check the form.');
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('offers only channel and service partner types, and shows the tip', () => {
    render(<CopyForm sources={sources} storage="memory" />);
    const select = screen.getByLabelText(/^Partner type/);
    expect([...select.querySelectorAll('optgroup')].map((g) => g.label)).toEqual(['Channel', 'Service']);
    expect(select.querySelectorAll('option')).toHaveLength(12);
    expect(screen.getByText(/Hypotheses do not transfer across markets/)).toBeInTheDocument();
  });
});

describe('GuidedFlow', () => {
  const book = sampleBook({
    partners: [partner({ id: 'p_1', company: 'Known Co', website: 'known.example' })],
    people: [], calls: [], qualifications: [], marketLinks: [],
  });
  const flow = (initialStep: string | null = null) => (
    <GuidedFlow defaults={{ ourProduct: 'Our product', ourTargetCustomers: 'Our customers' }} companyName="Acme" book={book}
      ownerId="u_1" storage="memory" initialStep={initialStep} />
  );
  const created = (info: object) => ({
    ok: true, entityId: 'mk_7', snapshot: { value: newMarket({ ...info, companyId: 'co_aaaaaaaaaa', updatedBy: 'Anna' }, 'mk_7'), issues: [] },
  });

  async function toLastStep() {
    await userEvent.type(await screen.findByLabelText(/^Market/), 'Austria');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
  }

  it('walks the four steps, each with its tip and its example, and starts must-haves from the baseline', async () => {
    render(flow());
    expect(await screen.findByRole('heading', { level: 1, name: 'Which market, and what will partners sell there?' })).toBeInTheDocument();
    expect(screen.getByText('New market · Step 1 of 4')).toBeInTheDocument();
    expect(screen.getByRole('complementary', { name: 'Example' })).toHaveTextContent('Halden Security Endpoint');
    expect(screen.getByLabelText(/^Our product/)).toHaveValue('Our product');
    await userEvent.type(screen.getByLabelText(/^Market/), 'Austria');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Why does the partner route work here?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByLabelText(/^Must-haves/)).toHaveValue('Sells into our target customers\nHas solutions engineers\nReaches the right buyers');
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Which companies come to mind first?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create market' })).toBeInTheDocument();
    expect(window.location.search).toBe('?step=4');
  });

  it('opens on the step in the address', async () => {
    render(flow('3'));
    expect(await screen.findByText('New market · Step 3 of 4')).toBeInTheDocument();
  });

  it('can’t leave step 1 without a market name', async () => {
    render(flow());
    await userEvent.click(await screen.findByRole('button', { name: 'Next' }));
    expect(screen.getAllByText(/Market is required|required/i).length).toBeGreaterThan(0);
    expect(screen.getByText('New market · Step 1 of 4')).toBeInTheDocument();
  });

  it('makes the market, then imports the first partners, and opens the market', async () => {
    actions.marketCreate.mockImplementation(async ({ info }) => created(info));
    actions.partnerImport.mockResolvedValue({ ok: true, snapshot: {}, entityIds: [] });
    render(flow());
    await toLastStep();
    await userEvent.type(screen.getByLabelText('Company'), 'Brand New AG');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.type(screen.getByLabelText('Company'), 'brand new ag');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('This company is already in the list')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Create market' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/markets/mk_7'));
    expect(actions.marketCreate).toHaveBeenCalledWith({ info: expect.objectContaining({ marketName: 'Austria', partnerType: 'reseller' }) });
    const sent = actions.partnerImport.mock.calls[0]![0] as { marketId: string; changes: Array<{ entity: string }> };
    expect(sent.marketId).toBe('mk_7');
    expect(sent.changes.map((c) => c.entity)).toEqual(['account', 'partner', 'marketLink']);
  });

  it('lands on the market with a count when the import is refused, and never makes a second market', async () => {
    actions.marketCreate.mockImplementation(async ({ info }) => created(info));
    actions.partnerImport.mockResolvedValue({ ok: false, error: 'invalid', message: 'No.' });
    render(flow());
    await toLastStep();
    await userEvent.type(screen.getByLabelText('Company'), 'Brand New AG');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create market' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/markets/mk_7?firstPartners=1'));
    expect(actions.marketCreate).toHaveBeenCalledTimes(1);
  });

  it('keeps the answers and shows the message when the market can’t be made, with Reconnect only for Google', async () => {
    actions.marketCreate.mockResolvedValue({ ok: false, error: 'auth', message: 'Google needs you to sign in again.' });
    render(flow());
    await toLastStep();
    await userEvent.click(screen.getByRole('button', { name: 'Create market' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google needs you to sign in again.');
    expect(screen.queryByRole('button', { name: 'Reconnect Google' })).toBeNull();
    expect(nav.push).not.toHaveBeenCalled();
    expect(JSON.parse(window.sessionStorage.getItem('partner-desk:new-market:u_1')!).draft.marketName).toBe('Austria');
  });

  it('says what went wrong when the call itself fails', async () => {
    actions.marketCreate.mockRejectedValue(new Error('offline'));
    render(flow());
    await toLastStep();
    await userEvent.click(screen.getByRole('button', { name: 'Create market' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong creating your market. Your answers are still here. Try again.');
  });

  it('still opens the market when the import call itself fails, with all first partners counted as not added', async () => {
    actions.marketCreate.mockImplementation(async ({ info }) => created(info));
    actions.partnerImport.mockRejectedValue(new Error('offline'));
    render(flow());
    await toLastStep();
    await userEvent.type(screen.getByLabelText('Company'), 'Brand New AG');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    await userEvent.click(screen.getByRole('button', { name: 'Create market' }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/markets/mk_7?firstPartners=1'));
    expect(screen.queryByText(/Something went wrong creating your market/)).toBeNull();
  });
});

describe('LoadProblem', () => {
  it('shows the message, and Reconnect Google only for an auth refusal on a Google account', () => {
    const { rerender } = render(<LoadProblem failure={{ error: 'auth', message: 'Sign in again.' }} next="/markets" storage="google" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in again.');
    expect(screen.getByRole('button', { name: 'Reconnect Google' })).toBeInTheDocument();
    expect(document.querySelector('input[name="next"]')).toHaveValue('/markets');
    rerender(<LoadProblem failure={{ error: 'unavailable', message: 'Busy.' }} next="/markets" storage="google" />);
    expect(screen.queryByRole('button', { name: 'Reconnect Google' })).toBeNull();
    rerender(<LoadProblem failure={{ error: 'auth', message: 'x' }} next="/markets" storage="memory" />);
    expect(screen.queryByRole('button', { name: 'Reconnect Google' })).toBeNull();
  });
});

describe('a market’s card for a company server’s viewer (owner, 2026-11-14)', () => {
  it('shows a viewer no Archive and no Unarchive', () => {
    render(
      <StorageProvider storage="database" viewer>
        <MarketCard marketId="mk_1" displayName="Austria · Reseller" counts={counts} />
        <UnarchiveButton marketId="mk_2" displayName="Spain · Reseller" />
      </StorageProvider>,
    );
    expect(screen.getByRole('link', { name: 'Austria · Reseller' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Unarchive/ })).toBeNull();
  });

  it('shows an admin or a partner manager both', () => {
    render(
      <StorageProvider storage="database">
        <MarketCard marketId="mk_1" displayName="Austria · Reseller" counts={counts} />
        <UnarchiveButton marketId="mk_2" displayName="Spain · Reseller" />
      </StorageProvider>,
    );
    expect(screen.getByRole('button', { name: /^Archive/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Unarchive/ })).toBeInTheDocument();
  });
});

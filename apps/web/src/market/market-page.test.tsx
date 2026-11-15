// @vitest-environment jsdom
// The whole market page with its two real editors: only the server actions are mocked.
import type { Market, PartnerBook, ProposalHead } from '@partner-desk/core';
import { anAccount, call, marketInfo, marketLink, partner, proposalItem, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  partnerChange: vi.fn(), partnerImport: vi.fn(), marketRead: vi.fn(), marketChange: vi.fn(), marketExclusionsImport: vi.fn(),
  proposalAccept: vi.fn(), proposalReject: vi.fn(), search: { value: '' }, router: { refresh: vi.fn(), push: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useRouter: () => actions.router,
  useSearchParams: () => new URLSearchParams(actions.search.value),
}));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('@/app/(signed-in)/actions/partners', () => ({ partnerChange: actions.partnerChange, partnerImport: actions.partnerImport }));
vi.mock('@/app/(signed-in)/actions/markets', () => ({
  marketRead: actions.marketRead, marketChange: actions.marketChange, marketExclusionsImport: actions.marketExclusionsImport,
  marketArchive: vi.fn(),
}));
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));
vi.mock('@/app/(signed-in)/actions/proposals', () => ({ proposalAccept: actions.proposalAccept, proposalReject: actions.proposalReject }));

import { today } from '@/partners/partners-model';
import { toast } from 'sonner';
import { MarketPage } from './market-page';

const AUTH = { ok: false, error: 'auth', message: COPY.AUTH_MESSAGE };
const initialMarket = { value: sampleMarket({ info: marketInfo({ checkAgain: [] }) }), issues: [] };
const initialBook = { value: sampleBook({ partners: [], people: [], calls: [], qualifications: [], marketLinks: [] }), issues: [] };

function show() {
  render(<MarketPage initialMarket={initialMarket} initialBook={initialBook} markets={[]} programs={[]} companyName="Halden" fileUrl={null}
    actor="Anna" storage="google" />);
  return userEvent.setup();
}

async function expectReconnect() {
  const banner = await screen.findByRole('alert');
  expect(banner).toHaveTextContent('Reconnect Google to keep working.');
  expect(banner).toHaveTextContent('Your last change wasn’t saved.');
  expect(within(banner).getByRole('button', { name: 'Reconnect Google' })).toBeInTheDocument();
}

beforeEach(() => {
  vi.clearAllMocks();
  actions.search.value = '';
});

describe('the market page when Google needs reconnecting', () => {
  it('after a market change: shows the banner, rolls the change back and turns the page read-only', async () => {
    actions.search.value = 'tab=hypothesis';
    actions.marketChange.mockResolvedValue(AUTH);
    const user = show();
    const buys = () => screen.getByRole('combobox', { name: 'How the market buys' });
    expect(buys()).toHaveValue('customer_first');
    await user.selectOptions(buys(), 'capability_first');
    expect(actions.marketChange).toHaveBeenCalledTimes(1);

    await expectReconnect();
    await waitFor(() => expect(buys()).toHaveValue('customer_first'));
    expect(buys()).toBeDisabled();
  });

  it('after a partner add: shows the banner, takes the new partner away and offers no more adds', async () => {
    actions.partnerImport.mockResolvedValue(AUTH);
    const user = show();
    await user.click(screen.getByRole('button', { name: 'Add a partner' }));
    await user.type(screen.getByLabelText('Company'), 'Initech{Enter}');
    expect(actions.partnerImport).toHaveBeenCalledTimes(1);

    await expectReconnect();
    await waitFor(() => expect(screen.queryByText('Initech')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Add a partner' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Import AI results' })).toBeNull();
  });
});

describe('the market page opened at a hash', () => {
  const realMatchMedia = window.matchMedia;
  afterEach(() => { Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true, value: realMatchMedia }); });
  const setMotion = (reduce: boolean) => Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (query: string) => ({ matches: reduce && query.includes('reduced-motion'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });

  it('scrolls the search prompt card into view once the tab has rendered', async () => {
    actions.search.value = 'tab=hypothesis';
    window.history.replaceState(null, '', '/markets/m1?tab=hypothesis#search-prompt');
    setMotion(false);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    show();
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect((scrolled.mock.contexts[0] as Element).id).toBe('search-prompt');
    expect(scrolled).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' });
    scrolled.mockRestore();
  });

  it('does not animate when the person prefers less motion', async () => {
    actions.search.value = 'tab=hypothesis';
    window.history.replaceState(null, '', '/markets/m1?tab=hypothesis#search-prompt');
    setMotion(true);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    show();
    await waitFor(() => expect(scrolled).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' }));
    scrolled.mockRestore();
  });

  it('scrolls when Find partners with AI switches to the Hypothesis tab', async () => {
    actions.search.value = 'tab=pipeline';
    window.history.replaceState(null, '', '/markets/m1?tab=pipeline');
    setMotion(false);
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { rerender } = render(<MarketPage initialMarket={initialMarket} initialBook={initialBook} markets={[]} programs={[]} companyName="Halden"
      fileUrl={null} actor="Anna" storage="google" />);
    await userEvent.click(screen.getByRole('link', { name: 'Find partners with AI' }));
    expect(window.location.hash).toBe('#search-prompt');
    actions.search.value = 'tab=hypothesis';
    rerender(<MarketPage initialMarket={initialMarket} initialBook={initialBook} markets={[]} programs={[]} companyName="Halden"
      fileUrl={null} actor="Anna" storage="google" />);
    await waitFor(() => expect(scrolled).toHaveBeenCalled());
    expect((scrolled.mock.contexts[0] as Element).id).toBe('search-prompt');
    scrolled.mockRestore();
  });
});

describe('proposals on the market page', () => {
  const NOW = '2026-10-28T10:00:00.000Z';
  const MARKET_AT = '2026-10-20T09:00:00.000Z';
  const head = (id: string, kind: ProposalHead['kind']): ProposalHead => ({
    id, kind, status: 'waiting', createdAt: '2026-10-26T10:00:00.000Z', answeredAt: null, expiresAt: '2026-11-25T10:00:00.000Z',
    agentName: 'Claude', makerOn: true,
  });
  const market: Market = sampleMarket({ info: marketInfo({ checkAgain: [], status: 'open', statusNote: '', updatedAt: MARKET_AT }) });
  /** Gamma is in this market, with a call today: a change to the market's thinking offers the change log. */
  const bookWith = (items: PartnerBook['proposalItems']): PartnerBook => sampleBook({
    accounts: [anAccount({ id: 'a_3', company: 'Gamma', website: '' })], partners: [partner({ id: 'p_3', accountId: 'a_3' })],
    marketLinks: [marketLink({ id: 'l_3', partnerId: 'p_3' })], calls: [call({ id: 'k_1', partnerId: 'p_3', date: today() })],
    people: [], qualifications: [], proposalItems: items,
  });
  const statusItem = proposalItem({
    id: 'r_ms', proposalId: 'prp_market', kind: 'marketStatus', accountId: null, partnerId: null, marketId: market.info.marketId,
    about: 'Austria', what: 'marketStatus', proposed: 'Validated', details: 'Status note: Three resellers signed', evidence: 'Three signed in a month',
    targetUpdated: MARKET_AT, expiresOn: '2026-11-25T10:00:00.000Z',
  });
  const hypothesisItem = proposalItem({
    id: 'r_hs', proposalId: 'prp_hyp', kind: 'hypothesisStatus', accountId: null, partnerId: null, marketId: market.info.marketId,
    hypothesisId: 'h_1', about: 'Mid-size IT firms', what: 'hypothesisStatus', proposed: 'Dropped', evidence: 'Nobody bought',
    targetUpdated: '2026-10-16T08:30:00.000Z', expiresOn: '2026-11-25T10:00:00.000Z',
  });
  const page = (book: PartnerBook, heads: ProposalHead[]) => {
    render(<MarketPage initialMarket={{ value: market, issues: [] }} initialBook={{ value: book, issues: [] }} markets={[]} programs={[]}
      companyName="Halden" fileUrl={null} actor="Anna" storage="google" proposals={heads} timeZone="Europe/Berlin" now={NOW} />);
    return userEvent.setup();
  };
  /** The server's answer: the market as written, and the book with the proposal's rows accepted. */
  const accepted = (book: PartnerBook, written: Market) => ({
    ok: true, entityIds: [], status: 'accepted', market: { value: written, issues: [] },
    snapshot: { value: { ...book, proposalItems: book.proposalItems.map((i) => ({ ...i, status: 'accepted', answeredOn: NOW })) }, issues: [] },
  });
  const header = () => screen.getByRole('banner');

  it('a market status proposal accepted from the market page offers to log the change with a call', async () => {
    const book = bookWith([statusItem]);
    actions.proposalAccept.mockResolvedValue(accepted(book, { ...market, info: { ...market.info, status: 'validated', statusNote: 'Three resellers signed' } }));
    const user = page(book, [head('prp_market', 'marketStatus')]);
    // Beside the status it would change: the status now and the proposed one, with the agent's note.
    const card = within(header()).getByRole('region', { name: 'Desk Agent proposes' });
    expect(card).toHaveTextContent('Market status');
    expect(card).toHaveTextContent('Open');
    expect(card).toHaveTextContent('Validated');
    expect(card).toHaveTextContent('Three resellers signed');

    await user.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(actions.proposalAccept).toHaveBeenCalledWith({ proposalId: 'prp_market', expectedUpdatedAt: MARKET_AT });
    await waitFor(() => expect(within(header()).getByRole('region', { name: 'Desk Agent proposes' })).toHaveTextContent('Accepted'));
    expect(within(header()).getByText('Validated', { selector: 'span' })).toBeInTheDocument();
    // As after the status picker: the offer to log the change, with today's call chosen.
    const offer = await screen.findByRole('region', { name: 'What changed and why?' });
    expect(within(offer).getByRole('combobox', { name: 'Call' })).toHaveValue('k_1');
    expect(actions.router.refresh).not.toHaveBeenCalled();
  });

  it('a hypothesis status proposal sits on its hypothesis and accepts as the status picker does', async () => {
    actions.search.value = 'tab=hypotheses';
    const book = bookWith([hypothesisItem]);
    const written = { ...market, hypotheses: market.hypotheses.map((h) => ({ ...h, status: 'dropped' as const })) };
    actions.proposalAccept.mockResolvedValue(accepted(book, written));
    const user = page(book, [head('prp_hyp', 'hypothesisStatus')]);
    const hypothesis = screen.getByRole('article', { name: 'Mid-size IT firms' });
    const card = within(hypothesis).getByRole('region', { name: 'Desk Agent proposes' });
    await user.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(actions.proposalAccept).toHaveBeenCalledWith({ proposalId: 'prp_hyp', expectedUpdatedAt: '2026-10-16T08:30:00.000Z' });
    await waitFor(() => expect(within(hypothesis).getByRole('region', { name: 'Desk Agent proposes' })).toHaveTextContent('Accepted'));
    expect(within(hypothesis).getByText('Dropped', { selector: 'span' })).toBeInTheDocument();
    expect(await screen.findByRole('region', { name: 'What changed and why?' })).toHaveTextContent('About Mid-size IT firms.');
  });

  it('a refused accept says why and reads the page again; Google gone shows Reconnect Google and the proposal waits', async () => {
    const book = bookWith([statusItem]);
    actions.proposalAccept.mockResolvedValueOnce({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    const user = page(book, [head('prp_market', 'marketStatus')]);
    await user.click(within(header()).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(actions.router.refresh).toHaveBeenCalled());
    expect(toast.error).toHaveBeenCalledWith(COPY.PROPOSAL_MARKET_CHANGED);
    // The status goes back to what the page read; the card waits.
    expect(within(header()).getByText('Open', { selector: 'span' })).toBeInTheDocument();
    expect(within(header()).getByRole('button', { name: 'Accept' })).toBeInTheDocument();

    actions.router.refresh.mockClear();
    actions.proposalAccept.mockResolvedValueOnce(AUTH);
    await user.click(within(header()).getByRole('button', { name: 'Accept' }));
    await expectReconnect();
    expect(within(header()).getByRole('region', { name: 'Desk Agent proposes' })).not.toHaveTextContent('Accepted');
    expect(actions.router.refresh).not.toHaveBeenCalled();
  });

  it('a hypothesis status proposal whose hypothesis is gone sits at the top of the page, Reject only, with why', async () => {
    const book = bookWith([{ ...hypothesisItem, hypothesisId: 'h_gone' }]);
    actions.proposalReject.mockResolvedValue({
      ok: true, entityId: null,
      snapshot: { value: { ...book, proposalItems: book.proposalItems.map((i) => ({ ...i, status: 'rejected', answeredOn: NOW })) }, issues: [] },
    });
    const user = page(book, [head('prp_hyp', 'hypothesisStatus')]);
    const card = screen.getByRole('region', { name: 'Desk Agent proposes' });
    // Above the market's header, whatever tab is open.
    expect(card.compareDocumentPosition(header()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card).toHaveTextContent(COPY.GONE);
    expect(within(card).queryByRole('button', { name: 'Accept' })).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'Desk Agent proposes' })).toHaveTextContent('Rejected'));
    expect(actions.proposalReject).toHaveBeenCalledWith({ proposalId: 'prp_hyp' });
  });
});

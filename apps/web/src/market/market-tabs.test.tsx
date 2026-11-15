// @vitest-environment jsdom
import type { PartnerBook } from '@partner-desk/core';
import { anAccount, call, marketInfo, marketLink, partner, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { today } from '@/partners/partners-model';
import { ChangesTab } from './changes';
import { MarketHypothesisTab } from './market-hypothesis';
import { PartnerHypothesesTab } from './partner-hypotheses';
import { renderMarket } from './test-harness';
import { StorageProvider } from '@/storage-context';
import { ValuePropositionTab } from './value-proposition';

const NOTE = 'Customers ask for security they can run themselves.';

/** Gamma is in this market, linked to the hypothesis, with a discovery call on `date`; Zeta is elsewhere, with a newer call. */
function book(date = today()): PartnerBook {
  return sampleBook({
    accounts: [anAccount({ id: 'a_p_3', company: 'Gamma', website: '' }), anAccount({ id: 'a_p_9', company: 'Zeta', website: '' })],
    partners: [partner({ id: 'p_3', accountId: 'a_p_3' }), partner({ id: 'p_9', accountId: 'a_p_9' })],
    marketLinks: [marketLink({ id: 'l_3', partnerId: 'p_3', hypothesisId: 'h_1' }), marketLink({ id: 'l_9', partnerId: 'p_9', marketId: 'm_other00000' })],
    calls: [
      call({ id: 'k_1', partnerId: 'p_3', date, topics: { ...call().topics, customerPains: NOTE } }),
      call({ id: 'k_9', partnerId: 'p_9', date: today() }),
    ],
    people: [], qualifications: [],
  });
}

const offer = () => screen.queryByRole('region', { name: 'What changed and why?' });

beforeEach(() => vi.clearAllMocks());

describe('the Market hypothesis tab and the change-log offer', () => {
  it('saves a field and, within 7 days of a call with one of the market’s partners, asks what changed', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<MarketHypothesisTab />, { market: sampleMarket(), book: book() });
    expect(screen.getByRole('region', { name: 'Find partners with AI' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /^Statement:/ }));
    await user.clear(screen.getByRole('textbox', { name: 'Statement' }));
    await user.type(screen.getByRole('textbox', { name: 'Statement' }), 'Resellers will sell it.{Control>}{Enter}{/Control}');
    expect(log.market[0]).toEqual({ change: { kind: 'updateInfo', patch: { statement: 'Resellers will sell it.' } }, options: { label: 'Market hypothesis updated' } });

    const prompt = offer()!;
    expect(prompt).toHaveTextContent('About Statement.');
    const callChoice = within(prompt).getByRole('combobox', { name: 'Call' });
    expect(within(callChoice).getAllByRole('option').map((o) => o.textContent)).toEqual(['No call', expect.stringMatching(/ · Gamma · Discovery$/)]);
    expect(callChoice).toHaveValue('k_1');
    await user.type(within(prompt).getByRole('textbox', { name: 'What changed and why?' }), 'Resellers, after the Gamma call');
    await user.click(within(prompt).getByRole('button', { name: 'Save' }));
    expect(log.market[1]?.change).toEqual({
      kind: 'add', entity: 'change',
      values: { date: today(), entity: 'market', entityId: 'statement', what: 'Resellers, after the Gamma call', callId: 'k_1' },
    });
    expect(offer()).not.toBeInTheDocument();
  });

  it('asks nothing when the latest call is 7 days old or more', async () => {
    const user = userEvent.setup();
    renderMarket(<MarketHypothesisTab />, { market: sampleMarket(), book: book('2026-01-01') });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Status' }), 'Validated');
    expect(offer()).not.toBeInTheDocument();
  });

  it('shows the examples on empty fields, the check-again markers, and a refused change as a toast', async () => {
    const user = userEvent.setup();
    const market = sampleMarket({ info: marketInfo({ statusNote: '' }) });
    const { log } = renderMarket(<MarketHypothesisTab />, { market, book: book() }, { refuse: 'Updated elsewhere since you opened it' });
    expect(screen.getByText('Two of three calls back the “customer first” view.')).toBeInTheDocument();
    expect(screen.getByLabelText('Expected partners: 12')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Checked: Statement' }));
    expect(log.market[0]?.change).toEqual({ kind: 'clearCheckAgain', target: { entity: 'market', field: 'statement' } });
    expect(toast.error).toHaveBeenCalledWith('Updated elsewhere since you opened it');
  });

  it('flags the Market tab’s unreadable rows on the tab', () => {
    renderMarket(<MarketHypothesisTab />, { market: sampleMarket(), book: book() }, { issues: [{ tab: 'Market', row: 5, message: 'Status must be one of Open' }] });
    expect(screen.getByRole('note')).toHaveTextContent('Needs attention: Market tab, row 5: Status must be one of Open');
  });
});

describe('Feeds program', () => {
  const programs = [
    { programId: 'pg_reseller1', label: 'Reseller', partnerType: 'reseller' as const, title: 'Reseller' },
    { programId: 'pg_dach00001', label: 'Reseller · DACH', partnerType: 'reseller' as const, title: 'Reseller · DACH' },
    { programId: 'pg_referral1', label: 'Referral', partnerType: 'referral' as const, title: 'Referral' },
  ];
  const feeds = () => screen.getByRole('combobox', { name: 'Feeds program' });

  it('offers only the programs of the market’s type, saves the choice, and links to the program', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<MarketHypothesisTab />, { market: sampleMarket(), book: book() }, { programs });
    expect(within(feeds()).getAllByRole('option').map((o) => o.textContent)).toEqual(['No program', 'Reseller', 'Reseller · DACH']);
    expect(feeds()).toHaveValue('');
    await user.selectOptions(feeds(), 'Reseller · DACH');
    expect(log.market[0]).toEqual({ change: { kind: 'updateInfo', patch: { feedsProgramId: 'pg_dach00001' } }, options: { label: 'Feeds program changed' } });
    expect(screen.getByRole('link', { name: 'Open program' })).toHaveAttribute('href', '/programs/pg_dach00001/why');
    await user.selectOptions(feeds(), 'No program');
    expect(log.market[1]?.change).toEqual({ kind: 'updateInfo', patch: { feedsProgramId: null } });
  });

  it('shows a program that is gone as gone, and says when there is none of the type yet', async () => {
    const market = sampleMarket({ info: marketInfo({ feedsProgramId: 'pg_deleted001' }) });
    const view = renderMarket(<MarketHypothesisTab />, { market, book: book() }, { programs });
    expect(feeds()).toHaveDisplayValue('A deleted program');
    expect(screen.getByText('That program is gone. Pick another one, or No program.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open program' })).not.toBeInTheDocument();
    view.unmount();
    renderMarket(<MarketHypothesisTab />, { market: sampleMarket(), book: book() }, { programs: programs.slice(2) });
    expect(screen.getByText('You have no Reseller program yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add a program' })).toHaveAttribute('href', '/programs/new');
  });

  it('says to a company server’s viewer that there is no program of the type yet, with no link to add one (owner, 2026-11-14)', () => {
    renderMarket(<StorageProvider storage="database" viewer><MarketHypothesisTab /></StorageProvider>, { market: sampleMarket(), book: book() }, { programs: programs.slice(2) });
    expect(screen.getByText('You have no Reseller program yet.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a program' })).toBeNull();
  });

  it('shows the stored program as plain unknown, not as deleted, when the list couldn’t be read', () => {
    const market = sampleMarket({ info: marketInfo({ feedsProgramId: 'pg_reseller1' }) });
    renderMarket(<MarketHypothesisTab />, { market, book: book() }, { programs: [], programsListed: false });
    expect(feeds()).toHaveDisplayValue('pg_reseller1');
    expect(screen.queryByText('That program is gone. Pick another one, or No program.')).not.toBeInTheDocument();
    expect(screen.queryByText('You have no Reseller program yet.')).not.toBeInTheDocument();
  });

  it('is left out for a market of a type no program covers', () => {
    const market = sampleMarket({ info: marketInfo({ partnerType: 'oem' }) });
    renderMarket(<MarketHypothesisTab />, { market, book: book() }, { programs });
    expect(screen.queryByRole('combobox', { name: 'Feeds program' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Add a program' })).not.toBeInTheDocument();
  });

  it('can’t be changed while read-only', () => {
    renderMarket(<MarketHypothesisTab />, { market: sampleMarket(), book: book() }, { programs, readOnly: true });
    expect(feeds()).toBeDisabled();
  });
});

describe('the Value proposition tab', () => {
  it('adds a value point to its kind, changes its state, and offers the change log', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<ValuePropositionTab />, { market: sampleMarket(), book: book() });
    const portfolio = screen.getByRole('region', { name: 'Portfolio' });
    expect(portfolio).toHaveTextContent('Example: Fills the security gap next to their Microsoft 365 offer');
    await user.click(within(portfolio).getByRole('button', { name: 'Add value point' }));
    await user.type(within(portfolio).getByRole('textbox', { name: 'New value point' }), 'Completes their offer{Enter}');
    expect(log.market[0]?.change).toEqual({ kind: 'add', entity: 'valuePoint', values: { kind: 'portfolio', text: 'Completes their offer' } });
    expect(within(portfolio).getByText('Completes their offer')).toBeInTheDocument();
    expect(offer()).toHaveTextContent('About Completes their offer.');

    const margin = screen.getByRole('region', { name: 'Margin or fees' });
    await user.click(within(margin).getByRole('button', { name: 'Dropped' }));
    expect(log.market[1]?.change).toMatchObject({ kind: 'update', entity: 'valuePoint', id: 'v_1', patch: { state: 'dropped' } });
  });
});

describe('the Partner hypotheses tab', () => {
  it('shows each hypothesis with its linked partners, and the editor takes their call notes as evidence', async () => {
    const user = userEvent.setup();
    const { log } = renderMarket(<PartnerHypothesesTab />, { market: sampleMarket(), book: book() });
    const card = screen.getByRole('article', { name: 'Mid-size IT firms' });
    expect(within(card).getByRole('link', { name: 'Gamma' })).toHaveAttribute('href', '/partners/a_p_3?type=reseller');
    expect(card).toHaveTextContent('Evidence: Acme call');
    expect(card).toHaveTextContent('No evidence yet: an assumption to test with the partner.');

    await user.click(within(card).getByRole('button', { name: 'Edit Mid-size IT firms' }));
    const editor = within(card).getByRole('region', { name: 'Partner hypothesis editor' });
    expect(editor).toHaveTextContent(NOTE);
    expect(editor).not.toHaveTextContent('Zeta');
    await user.click(within(editor).getByRole('radio', { name: 'Our side' }));
    await user.click(within(editor).getByRole('button', { name: 'Use as evidence: Customer Pains' }));
    expect(log.market[0]?.change).toMatchObject({ kind: 'update', entity: 'hypothesis', id: 'h_1', patch: { ourEvidence: `Customer Pains: ${NOTE}` } });
    expect(offer()).toHaveTextContent('About Mid-size IT firms.');
    await user.click(within(editor).getByRole('button', { name: 'Done' }));
    expect(card).toHaveTextContent(`Evidence: Customer Pains: ${NOTE}`);
  });

  it('adds a hypothesis and opens it in the editor; a deleted value point it names needs attention', async () => {
    const user = userEvent.setup();
    const market = sampleMarket({ valuePoints: [sampleMarket().valuePoints[0]!] });
    renderMarket(<PartnerHypothesesTab />, { market, book: book() });
    expect(screen.getByRole('note')).toHaveTextContent('Needs attention: A value point it uses was deleted');
    await user.click(screen.getByRole('button', { name: 'Add hypothesis' }));
    await user.type(screen.getByRole('textbox', { name: 'New partner hypothesis' }), 'Microsoft 365 specialists{Enter}');
    const card = screen.getByRole('article', { name: 'Microsoft 365 specialists' });
    expect(within(card).getByRole('region', { name: 'Partner hypothesis editor' })).toHaveTextContent('No call notes yet. Log a call on the partner’s page.');
  });
});

describe('the Changes tab', () => {
  it('lists changes newest first with their call, filters them, and deletes one', async () => {
    const user = userEvent.setup();
    const market = sampleMarket({
      changes: [
        { ...sampleMarket().changes[0]!, callId: 'k_1' },
        { id: 'g_2', date: '2026-10-20', entity: 'market', entityId: 'statement', what: 'Narrowed it', callId: null, updatedAt: null, updatedBy: 'Anna' },
      ],
    });
    const { log } = renderMarket(<ChangesTab />, { market, book: book('2026-10-16') });
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('20 Oct 2026Market hypothesisStatement');
    expect(items[1]).toHaveTextContent('After the call: 16 Oct 2026 · Gamma · Discovery');
    await user.click(screen.getByRole('button', { name: 'Value points' }));
    expect(screen.getByText('No changes about value points yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'All' }));
    await user.click(screen.getAllByRole('button', { name: 'Delete change' })[0]!);
    expect(log.market[0]).toEqual({ change: { kind: 'delete', entity: 'change', id: 'g_2' }, options: { label: 'Change deleted' } });
  });

  it('shows an example while empty, and flags a change whose call was deleted', () => {
    const { unmount } = renderMarket(<ChangesTab />, { market: sampleMarket({ changes: [] }), book: book() });
    expect(screen.getByText('No changes logged yet.')).toBeInTheDocument();
    expect(screen.getByText(/8 Oct 2026 · Partner hypothesis · Narrowed to managed IT providers/)).toBeInTheDocument();
    unmount();
    renderMarket(<ChangesTab />, { market: sampleMarket(), book: sampleBook({ calls: [] }) });
    expect(screen.getByRole('note')).toHaveTextContent('Needs attention: The call it names was deleted');
  });
});

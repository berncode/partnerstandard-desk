// @vitest-environment jsdom
import type { Market, Partner, PartnerBook } from '@partner-desk/core';
import { aPartner as partner, call, marketLink, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { Calls } from './calls';
import { DeskCheck } from './desk-check';
import { PartnerHypothesis } from './partner-hypothesis';
import type { MarketState } from './partner-model';
import { Qualification } from './qualification';
import { renderPartner, type HarnessOptions } from './test-harness';

const book = (over: Partial<Partner> = {}, rest: Partial<PartnerBook> = {}) =>
  sampleBook({ partners: [partner(over)], people: [], calls: [], qualifications: [], marketLinks: [], ...rest });
const ready = (market: Market): MarketState => ({ status: 'ready', market });
const markets = [
  { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
  { marketId: 'm_b', displayName: 'Germany · Reseller', archived: false },
];

beforeEach(() => vi.clearAllMocks());

describe('Desk check', () => {
  it('scores a C, makes the qualification row on the first note, and shows the advice', async () => {
    const user = userEvent.setup();
    const none = { customerBase: null, credibility: null, capability: null, commitment: null };
    const { dispatched } = renderPartner(<DeskCheck />, book({ desk: none }));
    expect(screen.getByText('Score at least one C for a recommendation.')).toBeInTheDocument();
    await user.click(within(screen.getByRole('group', { name: 'Credibility' })).getByRole('button', { name: /^0:/ }));
    expect(screen.getByText('Skip: Credibility fails')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Evidence for Credibility: empty' }));
    await user.keyboard('No security products at all{Enter}');
    expect(dispatched.map((d) => d.change.kind)).toEqual(['update', 'add', 'update']);
    expect(dispatched[1]?.change).toMatchObject({ kind: 'add', entity: 'qualification', values: { partnerId: 'p_abc123' } });
    expect(screen.getByRole('button', { name: 'Evidence for Credibility: No security products at all' })).toBeInTheDocument();
  });
});

describe('Calls', () => {
  it('logs a discovery call from pasted notes, then offers the move to Discovery call', async () => {
    const user = userEvent.setup();
    const { dispatched } = renderPartner(<Calls />, book());
    expect(screen.getByText('No calls yet. Log the discovery call here, or paste the notes from Granola.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Log a call' }));
    const form = screen.getByRole('form', { name: 'New call' });
    await user.type(within(form).getByLabelText('Paste notes from Granola'), 'Customer Pains: Manual invoices');
    await user.click(within(form).getByRole('button', { name: 'Sort into topics' }));
    expect(within(form).getByText('Sorted into the boxes below. Check them, then save the call.')).toBeInTheDocument();
    expect(within(form).getByLabelText('Customer Pains')).toHaveValue('Manual invoices');
    await user.click(within(form).getByRole('button', { name: 'Save call' }));

    expect(dispatched[0]?.change).toMatchObject({ kind: 'add', entity: 'call', values: { partnerId: 'p_abc123', kind: 'discovery' } });
    expect(screen.getAllByTestId('call')).toHaveLength(1);
    const offer = screen.getByRole('status');
    expect(offer).toHaveTextContent('Call logged. Move Acme GmbH to Discovery call?');
    await user.click(within(offer).getByRole('button', { name: 'Move to Discovery call' }));
    expect(dispatched.at(-1)?.change).toEqual({ kind: 'setStep', partnerId: 'p_abc123', to: 'discovery_call' });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a follow-up call has one notes box and no offer', async () => {
    const user = userEvent.setup();
    renderPartner(<Calls />, book());
    await user.click(screen.getByRole('button', { name: 'Log a call' }));
    const form = screen.getByRole('form', { name: 'New call' });
    await user.selectOptions(within(form).getByLabelText('Kind'), 'Follow-up');
    expect(within(form).queryByLabelText('Customer Pains')).toBeNull();
    await user.type(within(form).getByLabelText('Notes'), 'They want a price list');
    await user.click(within(form).getByRole('button', { name: 'Save call' }));
    expect(screen.getByText('They want a price list')).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Calls: who logged them', () => {
  it('shows who last changed each call, as the sheet records it: an agent for its person, or a person', () => {
    renderPartner(<Calls />, book({}, { calls: [
      call({ id: 'k_agent', date: '2026-10-12', notes: 'From Claude', updatedBy: 'Claude for Ruth' }),
      call({ id: 'k_person', date: '2026-10-10', kind: 'follow_up', notes: 'By hand', updatedBy: 'Ruth' }),
    ] }));
    const [agent, person] = screen.getAllByTestId('call');
    expect(within(agent!).getByText('Last updated by Claude for Ruth.')).toHaveClass('text-ink-3');
    expect(within(person!).getByText('Last updated by Ruth.')).toBeInTheDocument();
  });

  it('shows no empty label for a call without a name (an older row, or one added by hand in the sheet)', () => {
    renderPartner(<Calls />, book({}, { calls: [
      call({ id: 'k_none', date: '2026-10-12', notes: 'Typed in the sheet', updatedBy: '' }),
      call({ id: 'k_blank', date: '2026-10-10', notes: 'Spaces only', updatedBy: '   ' }),
    ] }));
    expect(screen.getAllByTestId('call')).toHaveLength(2);
    expect(screen.queryByText(/Last updated by/)).toBeNull();
  });

  it('names the person once they change a call an agent logged', async () => {
    const user = userEvent.setup();
    renderPartner(<Calls />, book({}, { calls: [call({ kind: 'follow_up', notes: 'From Claude', updatedBy: 'Claude for Ruth' })] }));
    await user.click(screen.getByRole('button', { name: /^Notes: From Claude/ }));
    await user.keyboard(' and me{Control>}{Enter}{/Control}');
    expect(await screen.findByText('Last updated by Anna.')).toBeInTheDocument();
  });
});

describe('Partner hypothesis', () => {
  const linked = (options: HarnessOptions = {}, calls = [call()]) => renderPartner(<PartnerHypothesis />, book({}, {
    calls,
    marketLinks: [marketLink({ id: 'l_a', marketId: 'm_a', hypothesisId: 'h_1' }), marketLink({ id: 'l_b', marketId: 'm_b' })],
  }), { markets, ...options });

  it('has a row per market, each with the hypothesis it matches there and a way to edit it in the market', () => {
    linked({ marketStates: { m_a: ready(sampleMarket()), m_b: ready(sampleMarket({ hypotheses: [] })) } });
    expect(screen.getByRole('heading', { name: 'Austria · Reseller' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Germany · Reseller' })).toBeInTheDocument();
    expect(screen.getByLabelText('Linked partner hypothesis · Austria · Reseller')).toHaveValue('h_1');
    expect(screen.getByText('Mid-size IT firms', { selector: 'span' })).toBeInTheDocument();
    expect(screen.getByText('They lose deals without it.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Edit partner hypothesis' })).toHaveAttribute('href', '/markets/m_a?tab=hypotheses');
    expect(screen.getByLabelText('Linked partner hypothesis · Germany · Reseller')).toHaveValue('');
  });

  it('read only (a company server’s viewer, owner 2026-11-14), shows the hypothesis with no Edit partner hypothesis', () => {
    linked({ readOnly: true, marketStates: { m_a: ready(sampleMarket()), m_b: ready(sampleMarket({ hypotheses: [] })) } });
    expect(screen.getByText('They lose deals without it.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Edit partner hypothesis' })).toBeNull();
  });

  it('links and unlinks a hypothesis of that market', async () => {
    const user = userEvent.setup();
    const { dispatched } = linked({ marketStates: { m_a: ready(sampleMarket()), m_b: ready(sampleMarket()) } });
    await user.selectOptions(screen.getByLabelText('Linked partner hypothesis · Germany · Reseller'), 'Mid-size IT firms');
    expect(dispatched.at(-1)).toEqual({
      change: { kind: 'update', entity: 'marketLink', id: 'l_b', patch: { hypothesisId: 'h_1' } }, options: { label: 'Partner hypothesis linked' },
    });
    await user.selectOptions(screen.getByLabelText('Linked partner hypothesis · Austria · Reseller'), 'No partner hypothesis');
    expect(dispatched.at(-1)?.options).toEqual({ label: 'Partner hypothesis unlinked' });
  });

  it('writes one from this call into that market and links it', async () => {
    const user = userEvent.setup();
    const addHypothesis = vi.fn().mockResolvedValue({ ok: true, id: 'h_new' });
    const { dispatched } = linked({ addHypothesis, marketStates: { m_a: ready(sampleMarket()), m_b: ready(sampleMarket({ hypotheses: [] })) } });
    const germany = screen.getByRole('heading', { name: 'Germany · Reseller' }).closest('li')!;
    await user.click(within(germany).getByRole('button', { name: 'Write one from this call' }));
    expect(addHypothesis).toHaveBeenCalledWith('m_b', { name: 'Acme GmbH', status: 'draft' });
    await waitFor(() => expect(dispatched.at(-1)?.change).toEqual({ kind: 'update', entity: 'marketLink', id: 'l_b', patch: { hypothesisId: 'h_new' } }));
    expect(dispatched.at(-1)?.options).toEqual({ label: 'Partner hypothesis written' });
  });

  it('says why a hypothesis was not written', async () => {
    const user = userEvent.setup();
    const addHypothesis = vi.fn().mockResolvedValue({ ok: false, message: 'The partner hypothesis wasn’t added. Try again.' });
    linked({ addHypothesis, marketStates: { m_a: ready(sampleMarket()), m_b: ready(sampleMarket()) } });
    await user.click(screen.getAllByRole('button', { name: 'Write one from this call' })[1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent('The partner hypothesis wasn’t added. Try again.');
  });

  it('says so when the new hypothesis was added to the market but couldn’t be linked', async () => {
    const user = userEvent.setup();
    const addHypothesis = vi.fn().mockResolvedValue({ ok: true, id: 'h_new' });
    linked({ addHypothesis, refuse: 'This item no longer exists', marketStates: { m_a: ready(sampleMarket()), m_b: ready(sampleMarket()) } });
    await user.click(screen.getAllByRole('button', { name: 'Write one from this call' })[1]!);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The partner hypothesis was added to the market, but not linked here: This item no longer exists Pick it in the list.',
    );
  });

  it('says where to write one before a call, and shows a market it can’t read', () => {
    linked({ marketStates: { m_a: { status: 'failed', message: 'We can’t reach this file.' }, m_b: ready(sampleMarket({ hypotheses: [] })) } }, []);
    expect(screen.getByText('We can’t reach this file.')).toBeInTheDocument();
    expect(screen.getByText('For each market above, link one of its partner hypotheses, or write one on that market’s Partner hypotheses tab. Once you log a call, you can also write one from it here.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Write one from this call' })).toBeNull();
  });

  it('a partner in no market is pointed to Add to a market on the Overview tab', async () => {
    const user = userEvent.setup();
    const showMarkets = vi.fn();
    renderPartner(<PartnerHypothesis />, book(), { showMarkets });
    expect(screen.getByText(/Partner hypotheses live in a market, and this partner is in none yet./)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add it to a market' }));
    expect(showMarkets).toHaveBeenCalled();
  });

  it('read only (a company server’s viewer, owner 2026-11-14), says so with no Add it to a market', () => {
    renderPartner(<PartnerHypothesis />, book(), { readOnly: true });
    expect(screen.getByText('Partner hypotheses live in a market, and this partner is in none yet.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add it to a market' })).toBeNull();
  });
});

describe('Qualification', () => {
  it('says in words why Proceed to MAP can’t be used, and Not now and No open the close dialog', async () => {
    const user = userEvent.setup();
    renderPartner(<Qualification />, book({ step: 'discovery_call' }));
    expect(screen.getByRole('button', { name: 'Proceed to MAP' })).toBeDisabled();
    expect(screen.getByText('Proceed to MAP works from Qualification. Acme GmbH is at Discovery call.')).toBeInTheDocument();
    expect(screen.getByText('How many named sellers will be active?')).toBeInTheDocument();
    expect(screen.getByText('0 active sellers')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'No' }));
    expect(screen.getByRole('dialog', { name: 'Close Acme GmbH' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'No' })).toBeChecked();
  });

  it('gives the advice before MAP, and Go ahead anyway moves on', async () => {
    const user = userEvent.setup();
    const { dispatched } = renderPartner(<Qualification />, book({ step: 'qualification' }));
    await user.click(screen.getByRole('button', { name: 'Proceed to MAP' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Score all four Cs in the confirmed check first.');
    await user.click(screen.getByRole('button', { name: 'Go ahead anyway' }));
    expect(dispatched.at(-1)?.change).toEqual({ kind: 'setStep', partnerId: 'p_abc123', to: 'map' });
  });

  it('says a closed partner is closed already, and has no decision after signing', () => {
    const { unmount } = renderPartner(<Qualification />, book({ step: 'qualification', closed: 'not_now', closedReason: 'Later' }));
    expect(screen.getByText('Closed already as Not now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not now' })).toBeDisabled();
    unmount();
    renderPartner(<Qualification />, book({ stage: 'onboarding', step: null, signedDate: '2026-09-15' }));
    expect(screen.queryByRole('button', { name: 'Proceed to MAP' })).toBeNull();
  });

  it('keeps CASO folded away until asked for', async () => {
    const user = userEvent.setup();
    const { dispatched } = renderPartner(<Qualification />, book());
    expect(screen.queryByText('Culture')).toBeNull();
    await user.click(screen.getByRole('button', { name: /CASO/ }));
    await user.click(within(screen.getByRole('radiogroup', { name: 'Culture' })).getByRole('radio', { name: 'Partly' }));
    expect(dispatched.at(-1)?.change).toMatchObject({ kind: 'update', entity: 'qualification', patch: { caso: { culture: { answer: 'partly' } } } });
  });
});

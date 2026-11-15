// @vitest-environment jsdom
import { proposalViews, type PartnerBook, type ProposalHead, type ProposalItem } from '@partner-desk/core';
import { aPartner, EARLIER, NOW, proposalItem, sampleBook } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ProposalCard } from './proposal-card';

const head = (over: Partial<ProposalHead> = {}): ProposalHead => ({
  id: 'prp_abc123', kind: 'fourC', status: 'waiting', createdAt: '2026-10-26T09:00:00.000Z', answeredAt: null,
  expiresAt: '2026-11-25T09:00:00.000Z', agentName: 'Claude', makerOn: true, ...over,
});
const letter = (what: ProposalItem['what'], proposed: string, id: string, over: Partial<ProposalItem> = {}) =>
  proposalItem({ id, what, proposed, evidence: `Evidence ${id}`, expiresOn: '2026-11-25T09:00:00.000Z', ...over });
const FOUR = [letter('desk.customerBase', '3', 'r_1'), letter('desk.credibility', '2', 'r_2'), letter('desk.capability', '1', 'r_3'), letter('desk.commitment', '0', 'r_4')];
const none = { customerBase: null, credibility: null, capability: null, commitment: null };
const viewOf = (book: PartnerBook, h: ProposalHead = head(), now = NOW) => proposalViews([h], { book, markets: {} }, now)[0];

function show(book: PartnerBook, h: ProposalHead = head()) {
  const handlers = { onAccept: vi.fn(), onAcceptSome: vi.fn(), onReject: vi.fn() };
  render(<ProposalCard view={viewOf(book, h)!} {...handlers} timeZone="Europe/Berlin" now={NOW} />);
  return { ...handlers, card: screen.getByRole('region', { name: /proposes$/ }) };
}

describe('ProposalCard', () => {
  it('shows "Desk Agent (turned off) proposes" for an agent turned off', () => {
    const { card } = show(sampleBook({ partners: [aPartner({ desk: none })], proposalItems: FOUR }), head({ makerOn: false }));
    expect(card).toHaveAccessibleName('Desk Agent (turned off) proposes');
    expect(card).toHaveTextContent('Desk Agent (turned off) proposes');
    expect(card).toHaveTextContent('2 days ago');
    expect(card).toHaveTextContent('Expires on 25 Nov 2026');
    // The person may still answer it.
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'Accept some' })).toBeEnabled();
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeEnabled();
  });

  it('a card whose target is as proposed already says "Already as proposed." and Accept closes it', () => {
    // Ruth set Credibility to 3 by hand, as Claude proposed.
    const book = sampleBook({ partners: [aPartner({ desk: { ...none, credibility: 3 } })], proposalItems: [letter('desk.credibility', '3', 'r_2')] });
    const { card } = show(book);
    expect(card).toHaveTextContent('Already as proposed.');
    expect(card).not.toHaveTextContent('It is like this already.');
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeEnabled();
  });

  it('a changed card shows the current and the proposed value side by side', async () => {
    // Claude proposed Credibility 3; Ruth set it to 1 by hand since.
    const book = sampleBook({
      partners: [aPartner({ desk: { ...none, credibility: 1 }, updatedAt: '2026-10-20T09:00:00.000Z' })],
      proposalItems: [letter('desk.credibility', '3', 'r_2', { evidence: 'Known brand in Austria' })],
    });
    const { card, onAccept } = show(book);
    expect(card).toHaveTextContent(COPY.PROPOSAL_CHANGED_SINCE('Desk Agent'));
    const row = within(card).getByRole('listitem');
    expect(row).toHaveTextContent('Credibility (desk check)');
    expect(within(row).getByText('Now').nextElementSibling).toHaveTextContent('1');
    expect(within(row).getByText('Proposed').nextElementSibling).toHaveTextContent('3');
    expect(row).toHaveTextContent('Known brand in Austria');
    await userEvent.setup().click(within(card).getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('a cannot card shows only Reject, with the rule’s message', async () => {
    const book = sampleBook({
      partners: [aPartner({ step: 'discovery_call', closed: 'no', closedReason: 'No fit' })],
      proposalItems: [proposalItem({ kind: 'stage', what: 'step', proposed: 'Qualification', evidence: 'The call went well' })],
    });
    const { card, onReject } = show(book, head({ kind: 'stage' }));
    expect(card).toHaveTextContent('Reopen this partner before you move it.');
    expect(within(card).getByText('Why').nextElementSibling).toHaveTextContent('The call went well');
    expect(within(card).getAllByRole('button').map((b) => b.textContent)).toEqual(['Reject']);
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith('');
  });

  it('Reject asks "Why not? (optional)" and sends the note', async () => {
    const { card, onReject, onAccept } = show(sampleBook({ partners: [aPartner({ desk: none })], proposalItems: FOUR }));
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    const why = within(card).getByLabelText('Why not? (optional)');
    // Cancel keeps the proposal as it is.
    await user.click(within(card).getByRole('button', { name: 'Cancel' }));
    expect(within(card).queryByLabelText('Why not? (optional)')).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    await user.type(within(card).getByLabelText('Why not? (optional)'), '  Their site is old  ');
    expect(why).not.toBeInTheDocument();
    await user.click(within(card).getByRole('button', { name: 'Reject' }));
    expect(onReject).toHaveBeenCalledWith('Their site is old');
    expect(onAccept).not.toHaveBeenCalled();
  });

  it('Accept some ticks letters, and the note goes with the ones left out', async () => {
    const { card, onAcceptSome } = show(sampleBook({ partners: [aPartner({ desk: none })], proposalItems: FOUR }));
    const user = userEvent.setup();
    await user.click(within(card).getByRole('button', { name: 'Accept some' }));
    expect(card).toHaveTextContent(COPY.PROPOSAL_TICK_HINT);
    await user.click(within(card).getByRole('checkbox', { name: 'Credibility (desk check)' }));
    await user.click(within(card).getByRole('checkbox', { name: 'Commitment (desk check)' }));
    await user.type(within(card).getByLabelText('Why not? (optional)'), 'Too early');
    await user.click(within(card).getByRole('button', { name: 'Accept' }));
    expect(onAcceptSome).toHaveBeenCalledWith({ itemIds: ['r_1', 'r_3'], note: 'Too early' });
  });

  it('an answered card is one line for 30 days', () => {
    const answered = FOUR.map((item, i) => ({ ...item, status: i < 2 ? 'accepted' as const : 'rejected' as const, answeredOn: '2026-10-28T10:00:00.000Z' }));
    const book = sampleBook({ proposalItems: answered });
    const h = head({ status: 'partly_accepted', answeredAt: '2026-10-28T10:00:00.000Z' });
    render(<ProposalCard view={viewOf(book, h, '2026-11-26T10:00:00.000Z')!} onAccept={vi.fn()} onReject={vi.fn()} timeZone="Europe/Berlin" now={NOW} />);
    const card = screen.getByRole('region', { name: 'Desk Agent proposes' });
    expect(card).toHaveTextContent('Accepted 2 of 4');
    expect(within(card).queryAllByRole('button')).toEqual([]);
    expect(within(card).queryAllByRole('listitem')).toEqual([]);
    expect(card.querySelectorAll('p')).toHaveLength(1);
    // After 30 days it is gone.
    expect(viewOf(book, h, '2026-11-28T10:00:00.000Z')).toBeUndefined();
    // Expired the same way.
    const expired = viewOf(sampleBook({ proposalItems: FOUR }), head({ status: 'expired', expiresAt: EARLIER }), '2026-10-20T10:00:00.000Z');
    expect(expired).toMatchObject({ state: 'expired', answeredLine: COPY.PROPOSAL_EXPIRED });
  });

  describe('keyboard focus stays where the person is', () => {
    const waiting = () => sampleBook({ partners: [aPartner({ desk: none })], proposalItems: FOUR });
    const answeredBook = () => sampleBook({ partners: [aPartner({ desk: none })], proposalItems: FOUR.map((i) => ({ ...i, status: 'rejected' as const, answeredOn: NOW })) });
    const answeredHead = head({ status: 'rejected', answeredAt: NOW });
    const props = { onAccept: vi.fn(), onAcceptSome: vi.fn(), onReject: vi.fn(), timeZone: 'Europe/Berlin', now: NOW };

    it('Reject puts focus in the note, and Cancel back on Reject', async () => {
      render(<ProposalCard view={viewOf(waiting())!} {...props} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Reject' }));
      expect(document.activeElement).toBe(screen.getByLabelText('Why not? (optional)'));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reject' }));
    });

    it('Accept some puts focus on the first letter, and Cancel back on Accept some', async () => {
      render(<ProposalCard view={viewOf(waiting())!} {...props} />);
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Accept some' }));
      expect(document.activeElement).toBe(screen.getByRole('checkbox', { name: 'Customer base (desk check)' }));
      await user.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Accept some' }));
    });

    it('answered from this card, its one line takes the focus; answered elsewhere, it takes none', async () => {
      const user = userEvent.setup();
      const { rerender, unmount } = render(<ProposalCard view={viewOf(waiting())!} {...props} />);
      await user.click(screen.getByRole('button', { name: 'Reject' }));
      await user.click(screen.getByRole('button', { name: 'Reject' }));
      rerender(<ProposalCard view={viewOf(answeredBook(), answeredHead)!} {...props} />);
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Desk Agent proposes' }));
      unmount();

      const accepted = render(<ProposalCard view={viewOf(waiting())!} {...props} />);
      await user.click(screen.getByRole('button', { name: 'Accept' }));
      accepted.rerender(<ProposalCard view={viewOf(answeredBook(), answeredHead)!} {...props} />);
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Desk Agent proposes' }));
      accepted.unmount();

      const elsewhere = render(<ProposalCard view={viewOf(waiting())!} {...props} />);
      elsewhere.rerender(<ProposalCard view={viewOf(answeredBook(), answeredHead)!} {...props} />);
      expect(document.activeElement).toBe(document.body);
    });

    /** Answered elsewhere later (another tab, the page read again): the line takes no focus from where the person is. */
    const answeredLater = (card: ReturnType<typeof render>) => {
      (document.activeElement as HTMLElement | null)?.blur();
      card.rerender(<ProposalCard view={viewOf(answeredBook(), answeredHead)!} {...props} />);
      expect(document.activeElement).toBe(document.body);
    };

    it('an answer refused at once leaves no claim: answered later elsewhere, the line takes no focus', async () => {
      const user = userEvent.setup();
      const card = render(<ProposalCard view={viewOf(waiting())!} {...props} onAccept={() => ({ ok: false })} />);
      await user.click(screen.getByRole('button', { name: 'Accept' }));
      answeredLater(card);
    });

    it('a dialog or advice cancelled leaves no claim; one confirmed still moves the focus to the line', async () => {
      const user = userEvent.setup();
      // The page asks first (a dialog, the stepper's advice) while `asking`; Cancel ends it with nothing answered.
      const cancelled = render(<ProposalCard view={viewOf(waiting())!} {...props} />);
      await user.click(screen.getByRole('button', { name: 'Accept' }));
      cancelled.rerender(<ProposalCard view={viewOf(waiting())!} {...props} asking />);
      cancelled.rerender(<ProposalCard view={viewOf(waiting())!} {...props} />);
      answeredLater(cancelled);
      cancelled.unmount();

      const confirmed = render(<ProposalCard view={viewOf(waiting())!} {...props} />);
      await user.click(screen.getByRole('button', { name: 'Accept' }));
      confirmed.rerender(<ProposalCard view={viewOf(waiting())!} {...props} asking />);
      confirmed.rerender(<ProposalCard view={viewOf(answeredBook(), answeredHead)!} {...props} />);
      expect(document.activeElement).toBe(screen.getByRole('region', { name: 'Desk Agent proposes' }));
    });
  });
});

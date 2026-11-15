// @vitest-environment jsdom
import type { WeekProposal } from '@partner-desk/commands';
import type { ThisWeek } from '@partner-desk/core';
import { makeActivity } from '@partner-desk/core/test-builders';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({ mapChange: vi.fn() }));
const answers = vi.hoisted(() => ({ proposalAccept: vi.fn(), proposalReject: vi.fn() }));
const router = vi.hoisted(() => ({ refresh: vi.fn() }));
const toasts = vi.hoisted(() => ({ undo: vi.fn(), info: vi.fn(), error: vi.fn(), dismissUndo: vi.fn() }));
vi.mock('@/app/(signed-in)/actions/maps', () => actions);
vi.mock('@/app/(signed-in)/actions/proposals', () => answers);
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/maps/notify', () => ({ sonnerNotify: toasts }));

const { ThisWeekView } = await import('./this-week-view');
const { PreviewProvider } = await import('@/ui/preview');
const { StorageProvider } = await import('@/storage-context');

const TODAY = '2026-10-31';
const empty: ThisWeek = { reviews: [], needYou: [], due: [], waiting: [] };
const waiting = (n: number): ThisWeek['waiting'] =>
  Array.from({ length: n }, (_, i) => ({
    partnerId: `p_${i}`, accountId: `acc_${i}`, name: `Company ${i}`, partnerType: 'reseller', reason: 'stalled', days: 20,
  }));
const dueWith = (activity = makeActivity({ id: 'a_one001', title: 'Send the price list', side: 'us', dueDate: '2026-10-28', updatedAt: '2026-10-20T09:00:00.000Z' })): ThisWeek =>
  ({ ...empty, due: [{ mapId: 'map_1', displayName: 'Acme as reseller', activities: [{ activity, overdueDays: 3 }] }] });

beforeEach(() => {
  actions.mapChange.mockReset();
  answers.proposalAccept.mockReset();
  answers.proposalReject.mockReset();
  router.refresh.mockReset();
  for (const fn of Object.values(toasts)) fn.mockReset();
});

describe('ThisWeekView', () => {
  it('the four headings in order', () => {
    render(<ThisWeekView week={empty} today={TODAY} />);
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Business reviews coming up', 'Partnerships that need you', 'Activities due', 'Recruitment waiting',
    ]);
  });

  it('an empty section shows its line', () => {
    render(<ThisWeekView week={empty} today={TODAY} />);
    expect(screen.getByText('No reviews in the next three weeks.')).toBeInTheDocument();
    expect(screen.getByText('Nothing is due this week.')).toBeInTheDocument();
    expect(screen.getByText('No partnership needs you right now.')).toBeInTheDocument();
    expect(screen.getByText('No partner in Recruitment is waiting for you.')).toBeInTheDocument();
  });

  it('11 lines show 10 and Show all', async () => {
    const user = userEvent.setup();
    render(<ThisWeekView week={{ ...empty, waiting: waiting(11) }} today={TODAY} />);
    const region = screen.getByRole('region', { name: 'Recruitment waiting' });
    expect(within(region).getAllByRole('listitem')).toHaveLength(10);
    await user.click(within(region).getByRole('button', { name: 'Show all' }));
    expect(within(region).getAllByRole('listitem')).toHaveLength(11);
    expect(within(region).getByRole('link', { name: /Company 10/ })).toHaveAttribute('href', '/partners/acc_10');
  });

  it('a section with 10 lines or fewer has no Show all', () => {
    render(<ThisWeekView week={{ ...empty, waiting: waiting(10) }} today={TODAY} />);
    expect(screen.queryByRole('button', { name: 'Show all' })).not.toBeInTheDocument();
  });

  it('Mark done calls changeMap with the activity’s expectedUpdatedAt, drops the line and offers Undo', async () => {
    actions.mapChange.mockResolvedValue({ ok: true, snapshot: {}, entityId: null });
    const user = userEvent.setup();
    render(<ThisWeekView week={dueWith()} today={TODAY} />);
    const link = screen.getByRole('link', { name: 'Send the price list' });
    expect(link).toHaveAttribute('href', '/plans/map_1#activity-a_one001');
    await user.click(screen.getByRole('button', { name: /^Mark done/ }));
    expect(actions.mapChange).toHaveBeenCalledWith({
      mapId: 'map_1',
      change: { kind: 'update', entity: 'activity', id: 'a_one001', patch: { status: 'done' }, expectedUpdatedAt: '2026-10-20T09:00:00.000Z' },
    });
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Send the price list' })).not.toBeInTheDocument());
    expect(screen.getByText('Nothing is due this week.')).toBeInTheDocument();
    expect(toasts.undo).toHaveBeenCalledWith('Marked done', expect.any(Function));
  });

  it('Undo puts the status back and the line returns', async () => {
    actions.mapChange.mockResolvedValue({ ok: true, snapshot: { value: { activities: [{ id: 'a_one001', updatedAt: '2026-10-31T10:00:00.000Z' }] } }, entityId: null });
    const user = userEvent.setup();
    render(<ThisWeekView week={dueWith()} today={TODAY} />);
    await user.click(screen.getByRole('button', { name: /^Mark done/ }));
    await waitFor(() => expect(toasts.undo).toHaveBeenCalled());
    toasts.undo.mock.calls[0]![1]();
    await waitFor(() => expect(actions.mapChange).toHaveBeenCalledTimes(2));
    expect(actions.mapChange).toHaveBeenLastCalledWith({
      mapId: 'map_1',
      change: {
        kind: 'update', entity: 'activity', id: 'a_one001', patch: { status: 'not_started', completedDate: null },
        expectedUpdatedAt: '2026-10-31T10:00:00.000Z',
      },
    });
    expect(await screen.findByRole('link', { name: 'Send the price list' })).toBeInTheDocument();
  });

  it('a conflict keeps the line and says it was updated elsewhere', async () => {
    actions.mapChange.mockResolvedValue({ ok: false, error: 'conflict', message: 'Updated elsewhere since you opened it' });
    const user = userEvent.setup();
    render(<ThisWeekView week={dueWith()} today={TODAY} />);
    await user.click(screen.getByRole('button', { name: /^Mark done/ }));
    await waitFor(() => expect(toasts.info).toHaveBeenCalledWith('Updated elsewhere since you opened it'));
    expect(screen.getByRole('link', { name: 'Send the price list' })).toBeInTheDocument();
    expect(router.refresh).toHaveBeenCalled();
    expect(toasts.undo).not.toHaveBeenCalled();
  });

  it('an unreadable MAP shows Couldn’t open this MAP', () => {
    render(<ThisWeekView week={{ ...empty, needYou: [{ mapId: 'map_9', displayName: 'Broken as reseller', reasons: [] }] }} today={TODAY} />);
    const line = screen.getByRole('link', { name: /Broken as reseller/ });
    expect(line).toHaveAttribute('href', '/plans/map_9');
    expect(line).toHaveTextContent('Couldn’t open this MAP');
  });

  it('review lines: date or days overdue, prep state, and the unsent summary opens the held review', () => {
    render(<ThisWeekView today={TODAY} week={{ ...empty, reviews: [
      { mapId: 'map_a', displayName: 'Late', date: '2026-10-28', daysLeft: null, daysLate: 3, prep: true, summaryUnsent: false, heldReviewId: null },
      { mapId: 'map_b', displayName: 'Soon', date: '2026-11-10', daysLeft: 10, daysLate: null, prep: false, summaryUnsent: false, heldReviewId: null },
      { mapId: 'map_c', displayName: 'Sent late', date: '2026-10-25', daysLeft: null, daysLate: null, prep: false, summaryUnsent: true, heldReviewId: 'rv_9' },
    ] }} />);
    const [late, soon, unsent] = screen.getAllByRole('link');
    expect(late).toHaveAttribute('href', '/plans/map_a/review');
    expect(late).toHaveTextContent('3 days overdue');
    expect(late).toHaveTextContent('Prep started');
    expect(soon).toHaveTextContent('Review on 10 Nov');
    expect(soon).toHaveTextContent('Not started');
    expect(unsent).toHaveAttribute('href', '/plans/map_c/review/rv_9');
    expect(unsent).toHaveTextContent('The summary isn’t sent yet');
    expect(unsent).not.toHaveTextContent('Not started');
  });

  it('names each reason in plain words', () => {
    render(<ThisWeekView today={TODAY} week={{ ...empty, needYou: [{
      mapId: 'map_1', displayName: 'Acme as reseller', reasons: [
        { kind: 'health', health: 'at_risk', reason: { kind: 'stalled', days: 20 } },
        { kind: 'exitTrigger', status: 'watch', condition: 'No first deal by day 90' },
        { kind: 'healthChanged', from: 'on_track', to: 'at_risk' },
      ],
    }] }} />);
    const line = screen.getByRole('link', { name: /Acme as reseller/ });
    expect(line).toHaveTextContent('No progress for 20 days');
    expect(line).toHaveTextContent('Exit trigger on watch: No first deal by day 90');
    expect(line).toHaveTextContent('Health went from On track to At risk since last Monday');
  });

  describe('the Proposals block', () => {
    const NOW = '2026-10-31T10:00:00.000Z';
    const head = (id: string, kind: WeekProposal['head']['kind'], createdAt = '2026-10-29T10:00:00.000Z') =>
      ({ id, kind, status: 'waiting' as const, createdAt, answeredAt: null, expiresAt: '2026-11-28T10:00:00.000Z', agentName: 'Claude', makerOn: true });
    const row = (over: Partial<WeekProposal['rows'][number]>) => ({ itemId: 'r_1', what: 'Step', now: '', proposed: 'Discovery call', evidence: '', status: 'waiting' as const, ...over });
    const hypothesis: WeekProposal = {
      head: head('prp_hyp', 'hypothesisStatus'), target: { accountId: null, partnerId: null, marketId: 'm_abcdefghij', hypothesisId: 'h_1' },
      about: 'Mid-size IT resellers', reason: 'Two calls say so', rows: [row({ itemId: 'r_h', what: 'Hypothesis status', proposed: 'Holds' })],
      state: 'waiting', cannot: null, answeredLine: null, targetUpdatedAt: null, partnerType: null, oneClick: true,
    };
    const close: WeekProposal = {
      head: head('prp_close', 'close', '2026-10-31T08:00:00.000Z'), target: { accountId: 'a_acme', partnerId: 'p_acme', marketId: null, hypothesisId: null },
      about: 'Acme GmbH', reason: 'They sell a rival', rows: [row({ itemId: 'r_c', what: 'Close as', proposed: 'No' })],
      state: 'waiting', cannot: null, answeredLine: null, targetUpdatedAt: '2026-10-20T09:00:00.000Z', partnerType: 'reseller', oneClick: false,
    };
    const show = (proposals: WeekProposal[]) => render(
      <ThisWeekView week={{ ...empty, proposals }} today={TODAY} timeZone="Europe/Berlin" now={NOW} storage="google" />,
    );
    const line = (text: RegExp) => screen.getAllByRole('listitem').find((li) => text.test(li.textContent ?? ''))!;

    it('This week’s block accepts a hypothesis status in one click and offers Reject and Show for a close', async () => {
      answers.proposalAccept.mockResolvedValue({ ok: true, snapshot: { value: {}, issues: [] }, entityIds: [], status: 'accepted' });
      const user = userEvent.setup();
      show([close, hypothesis]);
      // First, above the four sections: one line per proposal, with what, which partner or market, which agent and when.
      expect(screen.getAllByRole('heading', { level: 2 })[0]).toHaveTextContent('Proposals');
      const closing = line(/Acme GmbH/);
      expect(closing).toHaveTextContent('Close as: No');
      expect(closing).toHaveTextContent('Desk Agent proposes');
      expect(closing).toHaveTextContent('today');
      expect(within(closing).getByRole('link', { name: 'Show' })).toHaveAttribute('href', '/partners/a_acme?type=reseller');
      // A close needs its dialog to accept, so Accept is on the page; Reject needs nothing else, so it is here too.
      expect(within(closing).queryByRole('button', { name: 'Accept' })).toBeNull();
      expect(within(closing).getByRole('button', { name: 'Reject' })).toBeInTheDocument();

      const status = line(/Mid-size IT resellers/);
      expect(status).toHaveTextContent('Hypothesis status: Holds');
      expect(status).toHaveTextContent('2 days ago');
      expect(within(status).getByRole('link', { name: 'Show' })).toHaveAttribute('href', '/markets/m_abcdefghij?tab=hypotheses');
      await user.click(within(status).getByRole('button', { name: 'Accept' }));
      // This week read no market: the server checks against the value the proposal kept.
      expect(answers.proposalAccept).toHaveBeenCalledWith({ proposalId: 'prp_hyp' });
      await waitFor(() => expect(line(/Mid-size IT resellers/)).toHaveTextContent('Accepted'));
      expect(within(line(/Mid-size IT resellers/)).queryByRole('button')).toBeNull();
      expect(router.refresh).not.toHaveBeenCalled();
    });

    it('a company server’s viewer sees the proposals and Show, with no Accept or Reject, and no Mark done (owner, 2026-11-14)', () => {
      const week = { ...dueWith(), proposals: [close, hypothesis] };
      const view = render(
        <StorageProvider storage="database" viewer><ThisWeekView week={week} today={TODAY} timeZone="Europe/Berlin" now={NOW} storage="database" /></StorageProvider>,
      );
      expect(within(line(/Mid-size IT resellers/)).getByRole('link', { name: 'Show' })).toBeInTheDocument();
      for (const name of ['Accept', 'Reject', /^Mark done/]) expect(screen.queryByRole('button', { name })).toBeNull();
      expect(screen.getByRole('link', { name: 'Send the price list' })).toBeInTheDocument();
      view.unmount();
      // An admin or a partner manager has them all.
      render(<StorageProvider storage="database"><ThisWeekView week={week} today={TODAY} timeZone="Europe/Berlin" now={NOW} storage="database" /></StorageProvider>);
      for (const name of ['Accept', /^Mark done/]) expect(screen.getByRole('button', { name })).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: 'Reject' })).toHaveLength(2);
    });

    it('Reject asks why not and sends the note', async () => {
      answers.proposalReject.mockResolvedValue({ ok: true, snapshot: { value: {}, issues: [] }, entityId: null });
      const user = userEvent.setup();
      show([hypothesis]);
      await user.click(within(line(/Mid-size/)).getByRole('button', { name: 'Reject' }));
      await user.type(screen.getByLabelText('Why not? (optional)'), 'Too early');
      await user.click(within(line(/Mid-size/)).getByRole('button', { name: 'Reject' }));
      expect(answers.proposalReject).toHaveBeenCalledWith({ proposalId: 'prp_hyp', note: 'Too early' });
      await waitFor(() => expect(line(/Mid-size/)).toHaveTextContent('Rejected'));
    });

    it('a refused accept says why and reads the week again; Google gone shows Reconnect Google', async () => {
      answers.proposalAccept.mockResolvedValueOnce({ ok: false, error: 'unavailable', message: 'Google Sheets isn’t responding right now. Try again in a moment.' });
      const user = userEvent.setup();
      show([hypothesis]);
      await user.click(within(line(/Mid-size/)).getByRole('button', { name: 'Accept' }));
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('Google Sheets isn’t responding right now. Try again in a moment.'));
      expect(router.refresh).toHaveBeenCalled();
      expect(within(line(/Mid-size/)).getByRole('button', { name: 'Accept' })).toBeInTheDocument();

      answers.proposalAccept.mockResolvedValueOnce({ ok: false, error: 'auth', message: 'Reconnect Google' });
      await user.click(within(line(/Mid-size/)).getByRole('button', { name: 'Accept' }));
      expect(await screen.findByRole('alert')).toHaveTextContent('Reconnect Google to keep working.');
      expect(within(line(/Mid-size/)).queryByRole('button', { name: 'Accept' })).toBeNull();
    });

    it('a proposal whose target is gone can still be rejected here, never accepted', async () => {
      answers.proposalReject.mockResolvedValue({ ok: true, snapshot: { value: {}, issues: [] }, entityId: null });
      const user = userEvent.setup();
      const gone: WeekProposal = {
        ...close, head: head('prp_gone', 'stage'), rows: [row({ itemId: 'r_g', what: 'Step', proposed: 'Discovery call' })],
        state: 'cannot', cannot: 'This item no longer exists', partnerType: null, oneClick: false,
      };
      show([gone]);
      const goneLine = line(/Acme GmbH/);
      expect(goneLine).toHaveTextContent('This item no longer exists');
      expect(within(goneLine).queryByRole('button', { name: 'Accept' })).toBeNull();
      await user.click(within(goneLine).getByRole('button', { name: 'Reject' }));
      await user.click(within(line(/Acme GmbH/)).getByRole('button', { name: 'Reject' }));
      expect(answers.proposalReject).toHaveBeenCalledWith({ proposalId: 'prp_gone' });
      await waitFor(() => expect(line(/Acme GmbH/)).toHaveTextContent('Rejected'));
      expect(within(line(/Acme GmbH/)).queryByRole('button')).toBeNull();
    });

    it('a market proposal refused as changed since keeps only Show and Reject for the rest of the visit', async () => {
      answers.proposalAccept.mockResolvedValue({ ok: false, error: 'conflict', message: 'Updated elsewhere since you opened it' });
      const user = userEvent.setup();
      const view = show([hypothesis]);
      await user.click(within(line(/Mid-size/)).getByRole('button', { name: 'Accept' }));
      await waitFor(() => expect(toasts.error).toHaveBeenCalledWith('This market changed since you opened the page. Look at the proposal again.'));
      expect(router.refresh).toHaveBeenCalled();
      // The week read again brings the same line back (This week reads no market): Accept stays away, so no loop.
      view.rerender(<ThisWeekView week={{ ...empty, proposals: [{ ...hypothesis }] }} today={TODAY} timeZone="Europe/Berlin" now={NOW} storage="google" />);
      const status = line(/Mid-size/);
      expect(within(status).queryByRole('button', { name: 'Accept' })).toBeNull();
      expect(status).toHaveTextContent('This market changed since you opened the page. Look at the proposal again.');
      expect(within(status).getByRole('link', { name: 'Show' })).toBeInTheDocument();
      expect(within(status).getByRole('button', { name: 'Reject' })).toBeInTheDocument();
      expect(answers.proposalAccept).toHaveBeenCalledTimes(1);
    });

    it('no block when nothing waits', () => {
      show([]);
      expect(screen.queryByRole('heading', { name: 'Proposals' })).toBeNull();
    });

    it('answers through the given answers, not the server actions (a preview)', async () => {
      const given = { accept: vi.fn().mockResolvedValue({ ok: true }), reject: vi.fn().mockResolvedValue({ ok: true }) };
      const user = userEvent.setup();
      render(<ThisWeekView week={{ ...empty, proposals: [hypothesis] }} today={TODAY} timeZone="Europe/Berlin" now={NOW} answers={given} />);
      await user.click(screen.getByRole('button', { name: 'Accept' }));
      expect(given.accept).toHaveBeenCalledWith({ proposalId: 'prp_hyp' });
      expect(answers.proposalAccept).not.toHaveBeenCalled();
      await waitFor(() => expect(line(/Mid-size IT resellers/)).toHaveTextContent('Accepted'));
    });

    it('in a preview, nothing is a link', () => {
      const { container } = render(
        <PreviewProvider pathname="/this-week">
          <ThisWeekView week={{ ...dueWith(), proposals: [hypothesis], waiting: waiting(1) }} today={TODAY} timeZone="Europe/Berlin" now={NOW} />
        </PreviewProvider>,
      );
      expect(screen.getByText('Send the price list')).toBeInTheDocument();
      expect(container.querySelector('[href]')).toBeNull();
    });
  });
});

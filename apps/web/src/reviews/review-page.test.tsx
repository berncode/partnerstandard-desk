// @vitest-environment jsdom
import { changePartner, readPartners, startMap, type Actor } from '@partner-desk/commands';
import { makeTestDeps } from '@partner-desk/commands/testing';
import { makeMapPlan, makePerson, makeRecord, makeReview, makeReviewItem } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { localRemote } from '@/test/map-workspace';
import { REVIEW_TODAY, reviewRead, reviewSnapshot } from '@/test/review-fixtures';
import type { ReviewActions } from './review-model';

const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

const { ReviewPage } = await import('./review-page');
const { loadReview } = await import('./review-loader');
const { StorageProvider } = await import('@/storage-context');

const AREAS = [
  'Last quarter’s results', 'Is the partner hypothesis still valid?', 'Next quarter', 'Enablement and blockers', 'The relationship',
];

const PREP = makeReview({ id: 'rv_1', horizon: 1, state: 'prep', updatedAt: '2026-10-16T09:00:00.000Z' });

function renderPage(
  plan = makeMapPlan(), over: Parameters<typeof reviewRead>[2] = {}, change?: ReviewActions['change'], storage: 'google' | 'memory' | 'database' = 'google',
  viewer = false,
) {
  const record = makeRecord();
  const initial = reviewSnapshot(plan, record);
  const read = reviewRead(plan, record, over);
  const remote = localRemote(initial, 'Anna Keller');
  const actions: ReviewActions = {
    change: vi.fn(change ?? (async ({ change: c }) => remote(c))),
    open: vi.fn(async () => ({ ok: true as const })),
    close: vi.fn(async () => ({ ok: true as const, suggestion: null })),
    sendSummary: vi.fn(async () => ({ ok: true as const, message: 'Summary sent to 1 person.' })),
    revokeSummary: vi.fn(async () => ({ ok: true as const, message: COPY.REVIEW_SUMMARY_TURNED_OFF })),
  };
  const notify = { undo: vi.fn(), dismissUndo: vi.fn(), error: vi.fn(), info: vi.fn() };
  const user = userEvent.setup();
  render(
    <StorageProvider storage={storage} viewer={viewer}>
      <ReviewPage mapId="map_test" read={read} initial={initial} today={REVIEW_TODAY} actorName="Anna Keller" ourName="Halden"
        ownerName="Anna Keller" partnerHref="/partners/acc_1?type=reseller" back={null} actions={actions} notify={notify} storage={storage} />
    </StorageProvider>,
  );
  return { actions, user, notify };
}

beforeEach(() => {
  router.refresh.mockReset();
  router.push.mockReset();
});

describe('the review page', () => {
  it('before prep it shows the review date and Start the prep only', async () => {
    const { actions, user } = renderPage();
    const main = screen.getByTestId('review-page');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Review · Acme as reseller · horizon 1');
    expect(within(main).getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent))
      .toEqual(['Review date: 7 Jan 2027', COPY.REVIEW_START_PREP]);
    for (const area of AREAS) expect(screen.queryByRole('heading', { name: area })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Start the prep' }));
    expect(actions.open).toHaveBeenCalledWith({ mapId: 'map_test' });
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('a company server’s viewer sees the date before prep, with no way to change it and no Start the prep (owner, 2026-11-14)', () => {
    renderPage(makeMapPlan(), {}, undefined, 'database', true);
    const main = screen.getByTestId('review-page');
    expect(main).toHaveTextContent('Review date: 7 Jan 2027');
    expect(within(main).queryAllByRole('button')).toEqual([]);
  });

  it('a company server’s viewer reads a review with every field off, the viewer line, and no Close or Send summary (owner, 2026-11-14)', () => {
    renderPage(makeMapPlan({ reviews: [PREP] }), {}, undefined, 'database', true);
    expect(screen.getByText(COPY.VIEWER_LINE)).toHaveAttribute('role', 'status');
    expect(screen.queryByRole('button', { name: 'Close the review' })).toBeNull();
    expect(screen.getByRole('button', { name: /^Decisions:/ })).toBeDisabled();
    cleanup();
    renderPage(makeMapPlan({ reviews: [makeReview({ id: 'rv_1', horizon: 1, state: 'held', heldOn: '2026-10-14' })] }), {}, undefined, 'database', true);
    expect(screen.queryByRole('button', { name: COPY.REVIEW_SUMMARY_SEND })).toBeNull();
    expect(screen.getByRole('link', { name: COPY.MAP_PRESENT })).toBeInTheDocument();
  });

  it('the five area headings in order', () => {
    renderPage(makeMapPlan({ reviews: [PREP] }));
    const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
    expect(headings.filter((h) => AREAS.includes(h ?? ''))).toEqual(AREAS);
    // Decisions and the next horizon's length come after the five areas.
    expect(headings.indexOf('Decisions')).toBeGreaterThan(headings.indexOf('The relationship'));
    expect(screen.getByText('Next horizon: 90 days')).toBeInTheDocument();
    // The first review leads with activation (spec 5.1).
    expect(screen.getByText(COPY.REVIEW_FIRST_ACTIVATION)).toBeInTheDocument();
  });

  it('the date field writes the MAP’s next review date', async () => {
    const { actions, user } = renderPage(makeMapPlan({ reviews: [PREP] }));
    await user.click(screen.getByRole('button', { name: 'Review date: 7 Jan 2027' }));
    const field = screen.getByLabelText('Review date');
    fireEvent.change(field, { target: { value: '2026-12-15' } });
    fireEvent.blur(field);
    await waitFor(() => expect(actions.change).toHaveBeenCalledWith({ mapId: 'map_test', change: { kind: 'updateInfo', patch: { nextReviewDate: '2026-12-15' } } }));
    expect(screen.getByRole('button', { name: 'Review date: 15 Dec' })).toBeInTheDocument();
  });

  it('before prep, the date field writes the MAP’s next review date without starting the prep, and the page reads again', async () => {
    const { actions, user } = renderPage();
    await user.click(screen.getByRole('button', { name: 'Review date: 7 Jan 2027' }));
    const field = screen.getByLabelText('Review date');
    fireEvent.change(field, { target: { value: '2026-12-15' } });
    fireEvent.blur(field);
    await waitFor(() => expect(actions.change).toHaveBeenCalledWith({ mapId: 'map_test', change: { kind: 'updateInfo', patch: { nextReviewDate: '2026-12-15' } } }));
    expect(actions.open).not.toHaveBeenCalled();
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Review date: 15 Dec' })).toBeInTheDocument();
  });

  it('before prep, a date that can’t be saved says why and keeps the date shown', async () => {
    const { user } = renderPage(makeMapPlan(), {}, async () => ({ ok: false, error: 'unavailable', message: 'Google isn’t answering' }));
    await user.click(screen.getByRole('button', { name: 'Review date: 7 Jan 2027' }));
    const field = screen.getByLabelText('Review date');
    fireEvent.change(field, { target: { value: '2026-12-15' } });
    fireEvent.blur(field);
    expect(await screen.findByRole('alert')).toHaveTextContent('Google isn’t answering');
    expect(screen.getByRole('button', { name: 'Review date: 7 Jan 2027' })).toBeInTheDocument();
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it('the case against actual shows whole deals and money in the case’s currency', () => {
    const held = makeReview({ id: 'rv_1', state: 'held', heldOn: '2026-10-10' });
    renderPage(makeMapPlan({ reviews: [held] }), {
      caseCurrency: 'EUR',
      caseAgainstActual: {
        toDate: { actual: { deals: 1, weBill: 3550.7, partnerEarns: 120 }, forecast: { deals: 0.74, weBill: 11835.6, partnerEarns: 3550.7 } },
        rows: [{ reviewId: 'rv_1', heldOn: '2026-10-10', actual: { deals: 1, weBill: 3550.7, partnerEarns: 120 }, target: { deals: 0.74, weBill: 11835.6, partnerEarns: 3550.7 } }],
      },
    });
    const since = screen.getByRole('row', { name: /^Since signing/ });
    expect(since).toHaveTextContent('1 / 1');
    expect(since).toHaveTextContent('€3,551 / €11,836');
    expect(since).toHaveTextContent('€120 / €3,551');
    expect(screen.getByRole('row', { name: /^Held on/ })).toHaveTextContent('1 / 1');
  });

  it('the case against actual shows money whole without a sign when the case’s currency is unknown', () => {
    const held = makeReview({ id: 'rv_1', state: 'held', heldOn: '2026-10-10' });
    const totals = { deals: 1, weBill: 3550.7, partnerEarns: 120 };
    renderPage(makeMapPlan({ reviews: [held] }), {
      caseCurrency: null, caseAgainstActual: { toDate: { actual: totals, forecast: { ...totals, weBill: 11835.6 } }, rows: [] },
    });
    const since = screen.getByRole('row', { name: /^Since signing/ });
    expect(since).toHaveTextContent('3,551 / 11,836');
    expect(since).not.toHaveTextContent('€');
  });

  it('a commitment without a due date blocks Close with the field message', async () => {
    const commitment = makeReviewItem({ id: 'ri_c1', reviewId: 'rv_1', kind: 'commitment', title: 'Train five sellers', side: 'partner' });
    const plan = makeMapPlan({ reviews: [PREP], reviewItems: [commitment], people: [makePerson({ id: 'p_1', side: 'partner', name: 'Lena Ortiz' })] });
    const { actions, user } = renderPage(plan);
    await user.click(screen.getByRole('button', { name: 'Close the review' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the review' });
    expect(dialog).toHaveTextContent('Each commitment becomes an activity in the MAP, not started.');
    expect(within(dialog).getByLabelText('Held on')).toHaveValue(REVIEW_TODAY);
    await user.click(within(dialog).getByRole('button', { name: 'Close the review' }));
    const row = screen.getByTestId('commitment-ri_c1');
    expect(within(row).getByRole('alert')).toHaveTextContent('Add a due date.');
    expect(actions.close).not.toHaveBeenCalled();
  });

  it('closes once everything typed is saved, then shows the held review; the targets are kept by closeReview itself', async () => {
    const commitment = makeReviewItem({ id: 'ri_c1', reviewId: 'rv_1', kind: 'commitment', title: 'Train five sellers', side: 'partner', dueDate: '2026-12-01' });
    const { actions, user } = renderPage(makeMapPlan({ reviews: [PREP], reviewItems: [commitment] }), {
      targets: { dealsWon: 2.4, weBill: 24000, partnerEarns: 4800, openDeals: null, openValue: null, categoryNumber: null, recommend: 8 },
    });
    // Typed just before closing: the close waits for this save.
    await user.click(screen.getByRole('button', { name: /^Decisions:/ }));
    await user.type(screen.getByRole('textbox', { name: 'Decisions' }), 'Joint webinar in March');
    await user.click(screen.getByRole('button', { name: 'Close the review' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the review' });
    expect(dialog).toHaveTextContent('Horizon 2 starts that day and runs 90 days.');
    expect(dialog).toHaveTextContent('The partnership’s stage doesn’t change.');
    await user.click(within(dialog).getByRole('button', { name: 'Close the review' }));
    await waitFor(() => expect(actions.close).toHaveBeenCalledWith({ mapId: 'map_test', reviewId: 'rv_1', heldOn: REVIEW_TODAY }));
    const saved = vi.mocked(actions.change).mock.calls.map(([input]) => input.change);
    expect(saved).toEqual([{ kind: 'update', entity: 'review', id: 'rv_1', patch: { decisions: 'Joint webinar in March' }, expectedUpdatedAt: PREP.updatedAt }]);
    expect(vi.mocked(actions.change).mock.invocationCallOrder.at(-1)!).toBeLessThan(vi.mocked(actions.close).mock.invocationCallOrder[0]!);
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/plans/map_test/review/rv_1'));
  });

  it('a save that fails while Close waits stops the close: nothing is closed, and the dialog says so', async () => {
    let fail: (value: Awaited<ReturnType<ReviewActions['change']>>) => void = () => {};
    const { actions, user } = renderPage(makeMapPlan({ reviews: [PREP] }), {}, () => new Promise((resolve) => { fail = resolve; }));
    await user.click(screen.getByRole('button', { name: /^Decisions:/ }));
    await user.type(screen.getByRole('textbox', { name: 'Decisions' }), 'Joint webinar in March');
    await user.click(screen.getByRole('button', { name: 'Close the review' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the review' });
    await user.click(within(dialog).getByRole('button', { name: 'Close the review' }));
    expect(within(dialog).getByRole('button', { name: 'Closing…' })).toBeDisabled();
    await act(async () => fail({ ok: false, error: 'unavailable', message: 'Google isn’t answering' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(COPY.REVIEW_UNSAVED);
    expect(within(dialog).getByRole('button', { name: 'Close the review' })).toBeEnabled();
    expect(actions.close).not.toHaveBeenCalled();
  });

  it('a held-on date after today stays in the dialog, and nothing is closed', async () => {
    const { actions, user } = renderPage(makeMapPlan({ reviews: [PREP] }));
    await user.click(screen.getByRole('button', { name: 'Close the review' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the review' });
    const field = within(dialog).getByLabelText('Held on');
    await user.clear(field);
    await user.type(field, '2026-12-24');
    await user.click(within(dialog).getByRole('button', { name: 'Close the review' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent(COPY.REVIEW_ERR_HELD_FUTURE);
    expect(actions.close).not.toHaveBeenCalled();
  });

  it('a refusal of a commitment from closeReview goes to its line, and the dialog closes', async () => {
    const commitment = makeReviewItem({ id: 'ri_c1', reviewId: 'rv_1', kind: 'commitment', title: 'Train five sellers', side: 'partner', dueDate: '2026-12-01' });
    const { actions, user } = renderPage(makeMapPlan({ reviews: [PREP], reviewItems: [commitment] }));
    vi.mocked(actions.close).mockResolvedValueOnce({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { ri_c1: 'Too long' } });
    await user.click(screen.getByRole('button', { name: 'Close the review' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the review' });
    await user.click(within(dialog).getByRole('button', { name: 'Close the review' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(within(screen.getByTestId('commitment-ri_c1')).getByRole('alert')).toHaveTextContent('Too long');
  });

  it('a refusal from closeReview that names nothing on the page stays in the dialog with its message', async () => {
    const { actions, user } = renderPage(makeMapPlan({ reviews: [PREP] }));
    vi.mocked(actions.close)
      .mockResolvedValueOnce({ ok: false, error: 'invalid', message: COPY.FIX_FIELDS, fieldErrors: { name: 'Another milestone is already called “Day 30”.' } })
      .mockResolvedValueOnce({ ok: false, error: 'conflict', message: 'Changed since you opened it' });
    await user.click(screen.getByRole('button', { name: 'Close the review' }));
    const dialog = screen.getByRole('dialog', { name: 'Close the review' });
    await user.click(within(dialog).getByRole('button', { name: 'Close the review' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Another milestone is already called “Day 30”.');
    // Nothing on the page is marked, so the page doesn't ask to fix fields.
    expect(screen.queryByText(COPY.FIX_FIELDS)).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Close the review' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('Changed since you opened it'));
  });

  it('turns a blocker into a commitment with its title and side', async () => {
    const blocker = makeReviewItem({ id: 'ri_b1', reviewId: 'rv_1', kind: 'blocker', title: 'No demo account', side: 'partner' });
    const { actions, user } = renderPage(makeMapPlan({ reviews: [PREP], reviewItems: [blocker] }));
    await user.click(within(screen.getByTestId('blocker-ri_b1')).getByRole('button', { name: 'Make it a commitment' }));
    await waitFor(() => expect(actions.change).toHaveBeenCalledWith({
      mapId: 'map_test', change: { kind: 'add', entity: 'reviewItem', values: { reviewId: 'rv_1', kind: 'commitment', title: 'No demo account', side: 'partner' } },
    }));
    expect(screen.getAllByTestId(/^commitment-/)).toHaveLength(1);
  });

  it('answers a hypothesis; Changed links to it on its market, and the review never edits it', async () => {
    const question = makeReviewItem({ id: 'ri_h1', reviewId: 'rv_1', kind: 'hypothesis', refId: 'h_1', title: 'Agencies that build shops' });
    const { user } = renderPage(makeMapPlan({ reviews: [PREP], reviewItems: [question] }), {
      hypotheses: [{ id: 'h_1', marketId: 'mk_1', marketName: 'Austria', text: 'Agencies that build shops' }], hypothesesIncomplete: true,
    });
    expect(screen.getByText(COPY.REVIEW_HYPOTHESES_INCOMPLETE)).toBeInTheDocument();
    const answers = screen.getByRole('group', { name: 'Answer for Agencies that build shops' });
    expect(screen.queryByRole('link', { name: 'Change it on its market' })).not.toBeInTheDocument();
    await user.click(within(answers).getByRole('button', { name: 'Changed' }));
    expect(within(answers).getByRole('button', { name: 'Changed' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('link', { name: 'Change it on its market' })).toHaveAttribute('href', '/markets/mk_1?tab=hypotheses');
  });

  it('a held review: commitments show Now in the MAP, no Close, notes still editable, and the stage suggestion', () => {
    const held = makeReview({ id: 'rv_1', horizon: 1, state: 'held', heldOn: '2026-10-14' });
    const moved = makeReviewItem({ id: 'ri_c1', reviewId: 'rv_1', kind: 'commitment', title: 'Train five sellers', side: 'partner', dueDate: '2026-12-01', moved: true });
    const plan = makeMapPlan({ reviews: [held], reviewItems: [moved], info: { ...makeMapPlan().info, laterHorizons: [{ startDate: '2026-10-14', horizonDays: 90 }] } });
    renderPage(plan);
    expect(screen.getByText('Held on 14 Oct')).toBeInTheDocument();
    expect(within(screen.getByTestId('commitment-ri_c1')).getByText('Now in the MAP')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close the review' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add commitment' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Decisions:/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Onboarding is done. Move Acme to Growth?' })).toHaveAttribute('href', '/partners/acc_1?type=reseller');
  });

  it('shows the Reconnect Google banner after a save needs Google, with the button for a Google account and none for a test account, and refuses edits (question 16)', async () => {
    for (const storage of ['google', 'memory'] as const) {
      const { actions, user, notify } = renderPage(
        makeMapPlan({ reviews: [PREP] }), {}, async () => ({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE }), storage,
      );
      expect(screen.queryByRole('alert')).toBeNull();
      await user.click(screen.getByRole('button', { name: /^Decisions:/ }));
      await user.type(screen.getByRole('textbox', { name: 'Decisions' }), 'Joint webinar in March');
      await user.tab();
      await waitFor(() => expect(actions.change).toHaveBeenCalledTimes(1));

      const banner = await screen.findByRole('alert');
      expect(banner).toHaveTextContent(COPY.RECONNECT_TITLE);
      expect(banner).toHaveTextContent(COPY.RECONNECT_TEXT);
      const button = within(banner).queryByRole('button', { name: COPY.RECONNECT_BUTTON });
      if (storage === 'google') {
        expect(button).toBeInTheDocument();
        expect(button).toHaveFocus();
        expect(banner.querySelector('input[type="hidden"][name="next"]')).toHaveValue('/plans/map_test/review');
      } else {
        expect(button).toBeNull();
      }
      expect(notify.error).not.toHaveBeenCalled();
      // The change went back, and nothing on the review can be changed now.
      const decisions = screen.getByRole('button', { name: /^Decisions:/ });
      expect(decisions).not.toHaveTextContent('Joint webinar in March');
      expect(decisions).toBeDisabled();
      expect(screen.getByRole('combobox', { name: COPY.REVIEW_NEXT_HORIZON_LENGTH })).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Close the review' })).toBeDisabled();
      expect(actions.change).toHaveBeenCalledTimes(1);
      cleanup();
    }
  });

  it('a link holder session never reaches this route', async () => {
    const deps = makeTestDeps({ companies: { u1: 'co_aaaaaaaaaa' } });
    const owner: Actor = { kind: 'owner', userId: 'u1', displayName: 'Ruth' };
    const companyId = 'co_aaaaaaaaaa';
    await readPartners(deps, owner, { companyId });
    const send = async (change: unknown) => {
      const out = await changePartner(deps, owner, { companyId, change });
      if (!out.ok) throw new Error(out.message);
      return out.value.entityId!;
    };
    const accountId = await send({ kind: 'add', entity: 'account', values: { company: 'Acme' } });
    const partnerId = await send({ kind: 'add', entity: 'partner', values: { accountId, partnerType: 'reseller' } });
    const started = await startMap(deps, owner, { companyId, partnerId });
    if (!started.ok) throw new Error(started.message);
    const { mapId } = started.value;
    const link: Actor = { kind: 'link', userId: 'u1', linkId: 'ml_1', mapId, personId: 'p_1', side: 'partner', name: 'Lena' };
    const reads = vi.spyOn(deps.maps, 'read');
    expect(await loadReview(deps, link, { mapId, companyId })).toEqual({ kind: 'not_found' });
    expect(reads).not.toHaveBeenCalled();
    // The owner reaches it.
    expect(await loadReview(deps, owner, { mapId, companyId })).toMatchObject({ kind: 'ok' });
  });

  it('a held review offers Send summary: the partner-side people with an email, all ticked, and the scorecard off by default', async () => {
    const held = makeReview({ id: 'rv_1', horizon: 1, state: 'held', heldOn: '2026-10-20', includeScorecard: false, summarySentAt: null });
    const people = [
      makePerson({ id: 'pe_us', side: 'us', name: 'Ben Ito', email: 'ben@example.com' }),
      makePerson({ id: 'pe_lena', side: 'partner', name: 'Lena Ortiz', email: 'lena@example.com' }),
      makePerson({ id: 'pe_kim', side: 'partner', name: 'Kim Park', email: null }),
      makePerson({ id: 'pe_omar', side: 'partner', name: 'Omar Haddad', email: 'omar@example.com' }),
    ];
    const { actions, user } = renderPage(makeMapPlan({ reviews: [held], people }));
    expect(screen.queryByText(/Summary sent on/)).toBeNull();
    await user.click(screen.getByRole('button', { name: COPY.REVIEW_SUMMARY_SEND }));
    const dialog = screen.getByRole('dialog', { name: COPY.REVIEW_SUMMARY_SEND });
    const boxes = within(dialog).getAllByRole('checkbox');
    expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual([
      'Lena Ortizlena@example.com', 'Omar Haddadomar@example.com', COPY.REVIEW_SUMMARY_INCLUDE_SCORECARD,
    ]);
    expect(boxes.map((b) => (b as HTMLInputElement).checked)).toEqual([true, true, false]);
    expect(within(dialog).queryByRole('button', { name: COPY.REVIEW_SUMMARY_TURN_OFF })).toBeNull();
    await user.click(boxes[1]!);
    await user.click(boxes[2]!);
    await user.click(within(dialog).getByRole('button', { name: COPY.REVIEW_SUMMARY_SEND }));
    await waitFor(() => expect(actions.sendSummary).toHaveBeenCalledWith({ mapId: 'map_test', reviewId: 'rv_1', personIds: ['pe_lena'], includeScorecard: true }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
  });

  it('a sent summary says when and to whom, and its link can be turned off', async () => {
    const held = makeReview({
      id: 'rv_1', horizon: 1, state: 'held', heldOn: '2026-10-20', summarySentAt: '2026-10-21T09:00:00.000Z', summarySentTo: 'Anna Keller, Tom Berger',
    });
    const { actions, user } = renderPage(makeMapPlan({ reviews: [held] }));
    expect(screen.getByText('Summary sent on 21 Oct')).toBeInTheDocument();
    // Next to it: the names the MAP sheet keeps on the review's row (owner, 2026-11-01).
    expect(screen.getByText('Sent to Anna Keller, Tom Berger')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: COPY.REVIEW_SUMMARY_SEND }));
    await user.click(screen.getByRole('button', { name: COPY.REVIEW_SUMMARY_TURN_OFF }));
    await waitFor(() => expect(actions.revokeSummary).toHaveBeenCalledWith({ mapId: 'map_test', reviewId: 'rv_1' }));
  });

  it('says the day the summary was sent in the owner’s timezone, not in UTC', () => {
    const held = makeReview({ id: 'rv_1', horizon: 1, state: 'held', heldOn: '2026-10-20', summarySentAt: '2026-10-21T23:30:00.000Z' });
    renderPage(makeMapPlan({ reviews: [held] }));
    // 23:30 UTC is already the next day in Berlin, the owner's default timezone.
    expect(screen.getByText('Summary sent on 22 Oct')).toBeInTheDocument();
    // A review whose row has no names (sent before they were kept, or typed out of the sheet) says only when.
    expect(screen.queryByText(/^Sent to/)).toBeNull();
  });

  it('a review in prep offers no Send summary', () => {
    renderPage(makeMapPlan({ reviews: [PREP] }));
    expect(screen.queryByRole('button', { name: COPY.REVIEW_SUMMARY_SEND })).toBeNull();
  });
});

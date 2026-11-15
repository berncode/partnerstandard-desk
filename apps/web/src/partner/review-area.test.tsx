// @vitest-environment jsdom
import { aPartner, sampleBook } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ReviewAreaState } from './review-area-model';

const { ReviewArea, ReviewAreaProvider, ReviewToDate } = await import('./review-area');
const { renderPartner } = await import('./test-harness');

const book = sampleBook({ partners: [aPartner()] });
const area = () => screen.getByRole('region', { name: 'Business reviews' });
const totals = (deals: number, weBill: number, partnerEarns: number) => ({ deals, weBill, partnerEarns });

const ready = (over: Partial<Extract<ReviewAreaState, { kind: 'ready' }>> = {}): ReviewAreaState => ({
  kind: 'ready', mapId: 'map_1', today: '2026-10-31', next: { kind: 'coming', date: '2026-11-10', prepStarted: false },
  held: [], caseAgainstActual: null, currency: 'EUR', ...over,
});
const show = (state: ReviewAreaState) => {
  const load = vi.fn().mockResolvedValue({ ok: true, state });
  renderPartner(<ReviewAreaProvider load={load}><ReviewArea /><ReviewToDate /></ReviewAreaProvider>, book);
  return load;
};

describe('ReviewArea', () => {
  it('without a MAP it says a review needs a MAP', async () => {
    const load = show({ kind: 'none' });
    expect(await within(area()).findByText(COPY.REVIEW_AREA_NEEDS_MAP)).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith({ partnerId: 'p_abc123' });
  });

  it('shows the next review with its date and a link to it', async () => {
    show(ready());
    expect(await within(area()).findByText('Review on 10 Nov')).toBeInTheDocument();
    expect(within(area()).getByRole('link', { name: COPY.MAP_PREPARE_REVIEW })).toHaveAttribute('href', '/plans/map_1/review');
  });

  it('says so when the review is overdue', async () => {
    show(ready({ next: { kind: 'overdue', date: '2026-10-28', daysLate: 3, prepStarted: true } }));
    expect(await within(area()).findByText('3 days overdue')).toBeInTheDocument();
    expect(within(area()).getByRole('link', { name: COPY.REVIEW_GO_TO })).toBeInTheDocument();
  });

  it('shows held reviews newest first, each opening its review', async () => {
    show(ready({
      held: [
        { reviewId: 'rv_2', horizon: 2, heldOn: '2026-10-20' },
        { reviewId: 'rv_1', horizon: 1, heldOn: '2026-07-20' },
      ],
    }));
    const items = await within(area()).findAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('Horizon 2, held on 20 Oct');
    expect(within(items[0]!).getByRole('link', { name: COPY.REVIEW_AREA_OPEN })).toHaveAttribute('href', '/plans/map_1/review/rv_2');
    expect(items[1]).toHaveTextContent('Horizon 1, held on 20 Jul');
  });

  it('shows each held review’s hypothesis answers in plain words, and nothing extra without them', async () => {
    show(ready({
      held: [
        { reviewId: 'rv_2', horizon: 2, heldOn: '2026-10-20', answers: ['holds', 'changed'] },
        { reviewId: 'rv_1', horizon: 1, heldOn: '2026-07-20', answers: [] },
      ],
    }));
    const items = await within(area()).findAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Horizon 2, held on 20 Oct · Partner hypothesis: Holds, Changed');
    expect(items[1]).not.toHaveTextContent('Partner hypothesis');
  });

  it('says when no review is held yet', async () => {
    show(ready());
    expect(await within(area()).findByText(COPY.REVIEW_AREA_NO_HELD)).toBeInTheDocument();
  });

  it('hides case against actual without a business case', async () => {
    show(ready({ held: [{ reviewId: 'rv_1', horizon: 1, heldOn: '2026-07-20' }] }));
    await within(area()).findByText('Horizon 1, held on 20 Jul');
    expect(screen.queryByText(COPY.REVIEW_CASE_AGAINST_ACTUAL)).not.toBeInTheDocument();
    expect(screen.queryByText(/Since signing/)).not.toBeInTheDocument();
  });

  it('shows case against actual with the forecast rounded, and the year-to-date line', async () => {
    show(ready({
      held: [{ reviewId: 'rv_1', horizon: 1, heldOn: '2026-07-20' }],
      caseAgainstActual: {
        toDate: { actual: totals(3, 12000, 2400), forecast: totals(4.4, 15000.4, 3000) },
        rows: [{ reviewId: 'rv_1', heldOn: '2026-07-20', actual: totals(3, 12000, 2400), target: totals(4, 15000, 3000) }],
      },
    }));
    const table = await within(area()).findByRole('table');
    expect(within(table).getByRole('row', { name: /Since signing/ })).toHaveTextContent('3 / 4€12,000 / €15,000€2,400 / €3,000');
    expect(screen.getByText('Since signing: 3 of 4 deals won, €12,000 billed of €15,000 in the business case.')).toBeInTheDocument();
    // One held review: no chart.
    expect(screen.queryByRole('img', { name: COPY.REVIEW_CHART_LABEL })).not.toBeInTheDocument();
  });

  it('shows money whole with no sign when the business case’s currency is unknown, in the table, the line and the chart', async () => {
    const row = (reviewId: string, heldOn: string) => ({ reviewId, heldOn, actual: totals(1, 5000.4, 1000), target: totals(2, 6000, 1200) });
    show(ready({
      currency: null,
      held: [{ reviewId: 'rv_2', horizon: 2, heldOn: '2026-10-20' }, { reviewId: 'rv_1', horizon: 1, heldOn: '2026-07-20' }],
      caseAgainstActual: {
        toDate: { actual: totals(2, 10000.4, 2000), forecast: totals(4, 12000, 2400) },
        rows: [row('rv_1', '2026-07-20'), row('rv_2', '2026-10-20')],
      },
    }));
    const table = await within(area()).findByRole('table');
    expect(within(table).getByRole('row', { name: /Since signing/ })).toHaveTextContent('2 / 410,000 / 12,0002,000 / 2,400');
    expect(screen.getByText('Since signing: 2 of 4 deals won, 10,000 billed of 12,000 in the business case.')).toBeInTheDocument();
    expect(within(area()).getByRole('img', { name: COPY.REVIEW_CHART_LABEL })).toBeInTheDocument();
    expect(area()).not.toHaveTextContent('€');
    expect(screen.getByText(/^Since signing: 2 of 4/)).not.toHaveTextContent('€');
  });

  it('draws the chart from two held reviews on', async () => {
    const row = (reviewId: string, heldOn: string) => ({ reviewId, heldOn, actual: totals(1, 5000, 1000), target: totals(2, 6000, 1200) });
    show(ready({
      held: [{ reviewId: 'rv_2', horizon: 2, heldOn: '2026-10-20' }, { reviewId: 'rv_1', horizon: 1, heldOn: '2026-07-20' }],
      caseAgainstActual: {
        toDate: { actual: totals(2, 10000, 2000), forecast: totals(4, 12000, 2400) },
        rows: [row('rv_1', '2026-07-20'), row('rv_2', '2026-10-20')],
      },
    }));
    expect(await within(area()).findByRole('img', { name: COPY.REVIEW_CHART_LABEL })).toBeInTheDocument();
  });

  it('says why when the MAP can’t be read', async () => {
    show({ kind: 'unread', mapId: 'map_1', message: 'Couldn’t open this MAP.' });
    expect(await within(area()).findByRole('alert')).toHaveTextContent('Couldn’t open this MAP.');
  });
});

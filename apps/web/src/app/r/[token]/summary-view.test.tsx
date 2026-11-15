// @vitest-environment jsdom
// The partner's summary page (reviews spec 5.6), rendered as the server renders it, from a held review made through the
// commands: what it shows, and what it never shows.
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '@partner-desk/storage';
import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { heldReviewWithLink, NUMBERS, OURS_ONLY } from '@/test/review-summary';

const NOT_FOUND = vi.hoisted(() => new Error('NEXT_NOT_FOUND'));
const state = vi.hoisted(() => ({ deps: null as unknown }));
// jsdom renders no async server component: the footer's served legal links are hosted's, as the server sends them.
vi.mock('@/ui/served-legal-links', async () => {
  const { LegalLinks } = await import('@/ui/legal-links');
  const { legalLinksFor } = await import('@/server/legal');
  return { ServedLegalLinks: () => <LegalLinks links={legalLinksFor('ours')} /> };
});
vi.mock('next/navigation', () => ({ notFound: () => { throw NOT_FOUND; }, usePathname: () => '/r/abc', useRouter: () => ({ push: () => {} }) }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/server/runtime', () => ({ shareDeps: () => state.deps }));

const { SharedSummary, SummaryPage } = await import('./summary-view');
const { default: SummaryNotFound } = await import('./not-found');

const element = (token: string) => SharedSummary({ params: Promise.resolve({ token }) });

/** The page as a browser gets it (the server's HTML) and as it ends up in the document. */
async function bodies(token: string): Promise<string[]> {
  const { container } = render(await element(token));
  return [container.innerHTML, renderToString(await element(token))];
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the summary page', () => {
  it('shows the review’s date, both companies, done and not done with the reason, the commitments, the blockers and the next review', async () => {
    const { share, token } = await heldReviewWithLink({ includeScorecard: false });
    state.deps = share;
    render(await element(token));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme and Halden');
    expect(screen.getByText(/Held on 28 Oct 2026/)).toBeInTheDocument();
    const done = screen.getByRole('region', { name: COPY.SUMMARY_DONE });
    expect(done).toHaveTextContent('Sign the reseller terms');
    const notDone = screen.getByRole('region', { name: COPY.SUMMARY_NOT_DONE });
    expect(notDone).toHaveTextContent('Run the webinar');
    expect(notDone).toHaveTextContent('Waiting on their legal team');
    const commitments = screen.getByRole('region', { name: COPY.REVIEW_COMMITMENTS });
    expect(commitments).toHaveTextContent('Train five sellers');
    expect(commitments).toHaveTextContent('Lena Ortiz');
    expect(commitments).toHaveTextContent('15 Dec 2026');
    expect(screen.getByRole('region', { name: COPY.REVIEW_BLOCKERS })).toHaveTextContent('No demo account');
    expect(screen.getByRole('region', { name: COPY.REVIEW_NEXT_REVIEW })).toHaveTextContent('25 Jan 2027');
    expect(screen.getByRole('button', { name: COPY.MAP_PRINT })).toBeInTheDocument();
  });

  it('shows money in the case’s currency, whole, with the percent of what it shows; an owner left out stays empty', () => {
    render(<SummaryPage view={{
      heldOn: '2026-11-01', horizon: 2, partnerName: 'Acme', partnerType: 'reseller', ourName: 'Halden', done: [], notDone: [],
      commitments: [{ title: 'Train five sellers', side: 'partner', owner: null, dueDate: '2026-12-15' }], blockers: [], nextReview: null,
      scorecard: [
        { key: 'dealsWon', actual: 1, target: 1 },
        { key: 'weBill', actual: 3550.7, target: 11835.6 },
        { key: 'openValue', actual: 25000, target: null },
      ],
      categoryNumber: 'activeSellers', currency: 'EUR',
    }} />);
    const rowOf = (name: string) => screen.getByRole('row', { name: new RegExp(`^${name}`) });
    expect(rowOf('Deals won')).toHaveTextContent(/^Deals won11100%$/);
    expect(rowOf('We bill')).toHaveTextContent(/^We bill€3,551€11,83630%$/);
    expect(rowOf('Open deals value')).toHaveTextContent('€25,000');
    const commitments = screen.getByRole('region', { name: COPY.REVIEW_COMMITMENTS });
    expect(commitments).toHaveTextContent('Train five sellers');
    expect(commitments).toHaveTextContent('15 Dec 2026');
    expect(commitments).not.toHaveTextContent(COPY.MAP_NO_OWNER);
  });

  it('no hypothesis answer, decisions or relationship note in the HTML', async () => {
    for (const includeScorecard of [false, true]) {
      const { share, token } = await heldReviewWithLink({ includeScorecard });
      state.deps = share;
      for (const body of await bodies(token)) {
        for (const hidden of [...Object.values(OURS_ONLY), COPY.REVIEW_ANSWER_LABELS.doesnt_hold, COPY.REVIEW_AREA_HYPOTHESIS, COPY.REVIEW_DECISIONS,
          COPY.REVIEW_AREA_RELATIONSHIP, COPY.REVIEW_SOURCE_LABELS.finance]) {
          expect(body, hidden).not.toContain(hidden);
        }
      }
    }
  });

  it('no numbers unless includeScorecard', async () => {
    const off = await heldReviewWithLink({ includeScorecard: false });
    state.deps = off.share;
    for (const body of await bodies(off.token)) {
      for (const hidden of [String(NUMBERS.dealsWon), String(NUMBERS.dealsTarget), COPY.REVIEW_SCORECARD, COPY.REVIEW_RECOMMEND]) {
        expect(body, hidden).not.toContain(hidden);
      }
    }
    document.body.innerHTML = '';
    const on = await heldReviewWithLink({ includeScorecard: true });
    state.deps = on.share;
    render(await element(on.token));
    const scorecard = screen.getByRole('region', { name: COPY.REVIEW_SCORECARD });
    expect(scorecard).toHaveTextContent(String(NUMBERS.dealsWon));
    expect(scorecard).toHaveTextContent(String(NUMBERS.dealsTarget));
    expect(scorecard).toHaveTextContent(COPY.REVIEW_RECOMMEND);
  });

  it('gives the page nothing but what it shows: no ids, no review, no MAP', async () => {
    const { share, token, mapId, reviewId, lena } = await heldReviewWithLink({ includeScorecard: true });
    state.deps = share;
    const props = JSON.stringify((await element(token)).props, (_key, v: unknown) => (typeof v === 'function' ? undefined : v));
    for (const hidden of [mapId, reviewId, lena, 'u1', 'lena@example.com', ...Object.values(OURS_ONLY)]) expect(props, hidden).not.toContain(hidden);
  });

  it('is not found for a link that doesn’t work, and says it can’t be shown when the owner’s storage fails', async () => {
    const { share, token } = await heldReviewWithLink({ includeScorecard: false });
    state.deps = share;
    await expect(element('not-a-token')).rejects.toBe(NOT_FOUND);
    state.deps = { ...share, mapsFor: async () => ({ read: async () => { throw new StoreFailure('unavailable', 'down'); } }) };
    render(await element(token));
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.SUMMARY_UNAVAILABLE);
    expect(screen.queryByText('Train five sellers')).toBeNull();
  });

  it('the logo has no link: only the legal pages and the Knowledge Hub are linked (decided 2026-10-30)', () => {
    render(<SummaryNotFound />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getAllByRole('img', { name: 'PartnerStandard' }).length).toBeGreaterThan(0);
    expect(within(banner).queryAllByRole('link')).toEqual([]);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/privacy', '/terms', '/imprint', 'https://pro.partnerstandard.com']);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(COPY.SHARE_GONE);
  });

  it('has no link into PartnerStandard Desk in the summary either', async () => {
    const { share, token } = await heldReviewWithLink({ includeScorecard: true });
    state.deps = share;
    render(await element(token));
    expect(screen.queryAllByRole('link')).toEqual([]);
  });
});

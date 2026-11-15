// @vitest-environment jsdom
import type { ReviewLine } from '@partner-desk/commands';
import { COPY } from '@partner-desk/copy';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ReviewList } from './review-list';

const line = (over: Partial<ReviewLine>): ReviewLine => ({
  mapId: 'map_a', partnerId: 'p_a', displayName: 'Acme as reseller', horizon: 1, date: '2026-11-10', state: 'coming', reviewId: null, heldOn: null, ...over,
});
const TODAY = '2026-10-31';

describe('ReviewList', () => {
  it('says what a review is when there is none', () => {
    render(<ReviewList lines={[]} today={TODAY} />);
    expect(screen.getByText('No reviews yet. A review comes up 21 days before a MAP’s horizon ends.')).toBeInTheDocument();
  });

  it('lists coming and overdue first, then prep, then held newest first, each opening its review', () => {
    render(<ReviewList today={TODAY} lines={[
      line({ mapId: 'map_h', displayName: 'Old', state: 'held', date: '2026-07-20', heldOn: '2026-07-20', reviewId: 'rv_1', horizon: 1 }),
      line({ mapId: 'map_h', displayName: 'Old', state: 'held', date: '2026-10-20', heldOn: '2026-10-20', reviewId: 'rv_2', horizon: 2 }),
      line({ mapId: 'map_p', displayName: 'Prepped', state: 'prep', date: '2026-12-01', reviewId: 'rv_p' }),
      line({ mapId: 'map_o', displayName: 'Late', state: 'overdue', date: '2026-10-28' }),
      line({ mapId: 'map_c', displayName: 'Soon', state: 'coming', date: '2026-11-10' }),
    ]} />);
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.textContent)).toEqual([
      expect.stringContaining('Late'), expect.stringContaining('Soon'), expect.stringContaining('Prepped'),
      expect.stringContaining('Horizon 2'), expect.stringContaining('Horizon 1'),
    ]);
    expect(links[0]).toHaveAttribute('href', '/plans/map_o/review');
    expect(links[0]).toHaveTextContent('Was due 28 Oct');
    expect(links[3]).toHaveAttribute('href', '/plans/map_h/review/rv_2');
    expect(links[3]).toHaveTextContent('Held on 20 Oct');
  });

  it('names a MAP that couldn’t be read', () => {
    render(<ReviewList today={TODAY} lines={[line({ displayName: 'Broken', horizon: 0, date: null, state: 'later', unreadable: true })]} />);
    const problems = screen.getByRole('region', { name: COPY.REVIEWS_PROBLEMS });
    expect(within(problems).getByRole('link', { name: 'Broken' })).toHaveAttribute('href', '/plans/map_a');
    expect(problems).toHaveTextContent('Couldn’t open this MAP');
  });
});

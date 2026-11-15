import { describe, expect, it } from 'vitest';
import { comingFrom, happenedSince, overdueFrom } from './since';

describe('webhook events since the webhook was turned on', () => {
  it('an activity is late from the day after its due date', () => {
    expect(overdueFrom('2026-11-01')).toBe('2026-11-02');
    expect(overdueFrom('2026-12-31')).toBe('2027-01-01');
  });

  it('a review is coming from 21 days before it', () => {
    expect(comingFrom('2026-11-25')).toBe('2026-11-04');
  });

  it('counts from the day the webhook was turned on, in the owner’s date', () => {
    // 14:00 in Berlin on 3 November: the whole of that day counts as after.
    expect(happenedSince('2026-11-03', '2026-11-03T13:00:00.000Z', 'Europe/Berlin')).toBe(true);
    expect(happenedSince('2026-11-02', '2026-11-03T13:00:00.000Z', 'Europe/Berlin')).toBe(false);
    expect(happenedSince('2026-11-04', '2026-11-03T13:00:00.000Z', 'Europe/Berlin')).toBe(true);
  });

  it('counts "after it was added" in the owner’s own date', () => {
    // 01:00 on 4 November in Auckland, still 3 November in UTC: what happened on the 3rd there was before.
    expect(happenedSince('2026-11-03', '2026-11-03T12:00:00.000Z', 'Pacific/Auckland')).toBe(false);
    expect(happenedSince('2026-11-04', '2026-11-03T12:00:00.000Z', 'Pacific/Auckland')).toBe(true);
    expect(happenedSince('2026-11-03', '2026-11-03T12:00:00.000Z', 'UTC')).toBe(true);
  });
});

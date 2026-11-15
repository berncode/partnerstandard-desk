import { describe, expect, it } from 'vitest';
import { nextTryAt, RETRY_AFTER_MS, shouldTurnOff, WEBHOOK_EVENTS } from './schedule';

const NOW = Date.parse('2026-11-01T09:00:00.000Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe('webhook schedule', () => {
  it('the five events of spec 7.2 and the two of agent proposals (spec 9)', () => {
    expect(WEBHOOK_EVENTS).toEqual([
      'partner.stage_changed', 'partner.signed', 'activity.overdue', 'health.changed', 'review.due', 'proposal.created', 'proposal.answered',
    ]);
  });

  it('retries come after 1, 5, 30 minutes, 2, 6 and 12 hours, then stop', () => {
    expect(RETRY_AFTER_MS).toEqual([MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR, 12 * HOUR]);
    // `attempts`: the tries made so far, all failed.
    expect([1, 2, 3, 4, 5, 6].map((attempts) => nextTryAt(attempts, NOW)! - NOW))
      .toEqual([MINUTE, 5 * MINUTE, 30 * MINUTE, 2 * HOUR, 6 * HOUR, 12 * HOUR]);
    expect(nextTryAt(7, NOW)).toBeNull();
    expect(nextTryAt(8, NOW)).toBeNull();
  });

  it('a delivery not tried yet is due now', () => {
    expect(nextTryAt(0, NOW)).toBe(NOW);
  });

  it('a webhook failing for 3 days turns off, 2 days 23 hours doesn\'t', () => {
    const DAY = 24 * HOUR;
    expect(shouldTurnOff(NOW - 3 * DAY, NOW)).toBe(true);
    expect(shouldTurnOff(NOW - 4 * DAY, NOW)).toBe(true);
    expect(shouldTurnOff(NOW - (2 * DAY + 23 * HOUR), NOW)).toBe(false);
    // Never failed, or a success since: nothing to turn off.
    expect(shouldTurnOff(null, NOW)).toBe(false);
  });
});

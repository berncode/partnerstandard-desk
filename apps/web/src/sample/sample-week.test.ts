import { addDays, daysBetween } from '@partner-desk/core';
import { describe, expect, it } from 'vitest';
import { SAMPLE_COMPANY, sampleWeek } from './sample-week';

const TODAY = '2026-11-13';

describe('sampleWeek', () => {
  it('has a line in every card and one waiting proposal', () => {
    const week = sampleWeek(TODAY);
    expect(week.proposals).toHaveLength(1);
    expect(week.proposals[0]).toMatchObject({ state: 'waiting', oneClick: true });
    for (const card of [week.reviews, week.needYou, week.due, week.waiting]) expect(card.length).toBeGreaterThan(0);
  });

  it('dates every line near today, and its overdue days match its date', () => {
    const week = sampleWeek(TODAY);
    for (const r of week.reviews) {
      expect(Math.abs(daysBetween(TODAY, r.date))).toBeLessThanOrEqual(21);
      if (r.daysLate !== null) expect(daysBetween(r.date, TODAY)).toBe(r.daysLate);
      if (r.daysLeft !== null) expect(daysBetween(TODAY, r.date)).toBe(r.daysLeft);
    }
    for (const { activity, overdueDays } of week.due.flatMap((g) => g.activities)) {
      expect(Math.max(0, daysBetween(activity.dueDate!, TODAY))).toBe(overdueDays);
    }
  });

  it('moves with today: every date shifts by the same days', () => {
    const later = sampleWeek(addDays(TODAY, 40));
    const now = sampleWeek(TODAY);
    expect(daysBetween(now.reviews[0]!.date, later.reviews[0]!.date)).toBe(40);
    expect(daysBetween(now.due[0]!.activities[0]!.activity.dueDate!, later.due[0]!.activities[0]!.activity.dueDate!)).toBe(40);
    expect(later.reviews.map((r) => r.daysLeft)).toEqual(now.reviews.map((r) => r.daysLeft));
  });

  it('is a made-up company, not Recruitment’s sample', () => {
    expect(SAMPLE_COMPANY).toBe('Brookvale Software');
    expect(JSON.stringify(sampleWeek(TODAY))).not.toContain('Halden');
  });

  it('names no real agent: the proposal is by Desk Agent (owner, 2026-11-13)', () => {
    expect(sampleWeek(TODAY).proposals[0]!.head.agentName).toBe('Desk Agent');
    expect(JSON.stringify(sampleWeek(TODAY))).not.toContain('Claude');
  });
});

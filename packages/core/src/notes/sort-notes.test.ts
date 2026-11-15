import { describe, expect, it } from 'vitest';
import { TEXT_MAX } from '../shared/schemas';
import { sortNotes } from './sort-notes';

describe('sortNotes', () => {
  it('sorts the four heading styles in any order', () => {
    const r = sortNotes(
      ['STRATEGIC BETS', 'Bet one', '## Revenue Model', 'Subscriptions', '**Cost drivers**', 'Hiring', 'Differentiators:', 'Speed'].join('\n'),
    );
    expect(r.foundHeadings).toBe(true);
    expect(r.topics.strategicBets).toBe('Bet one');
    expect(r.topics.revenueModel).toBe('Subscriptions');
    expect(r.topics.costDrivers).toBe('Hiring');
    expect(r.topics.differentiators).toBe('Speed');
    expect(r.topics.customerPains).toBe('');
    expect(r.notes).toBe('');
    expect(r.tooLong).toBeNull();
  });

  it('puts text before the first heading and under unknown headings in notes', () => {
    const r = sortNotes('Intro line\n## Revenue Model\nSubs\n## Random Stuff\nodd\n**Action items**\ncall back\n');
    expect(r.topics.revenueModel).toBe('Subs');
    expect(r.notes).toBe('Intro line\n\n## Random Stuff\nodd\n\n**Action items**\ncall back');
  });

  it('puts everything in notes when there are no headings', () => {
    const r = sortNotes('just some words\nmore');
    expect(r.foundHeadings).toBe(false);
    expect(r.notes).toBe('just some words\nmore');
  });

  it('accepts bullets, numbering, ampersand and same-line text', () => {
    const r = sortNotes('1. Revenue Model: subscriptions and services\n- **Cost Drivers:** people\n2) Differentiators\nfast');
    expect(r.topics.revenueModel).toBe('subscriptions and services');
    expect(r.topics.costDrivers).toBe('people');
    expect(r.topics.differentiators).toBe('fast');
  });

  it('appends a repeated topic after a blank line and handles CRLF', () => {
    const r = sortNotes('## Revenue Model\r\nA\r\n\r\n## Cost Drivers\r\nB\r\n## Revenue Model\r\nC\r\n');
    expect(r.topics.revenueModel).toBe('A\n\nC');
    expect(r.topics.costDrivers).toBe('B');
  });

  it('keeps inner line breaks and trims outer blank lines', () => {
    const r = sortNotes('## Revenue Model\n\n\nA\n\nB\n\n');
    expect(r.topics.revenueModel).toBe('A\n\nB');
  });

  it('names the first topic over TEXT_MAX, nothing cut', () => {
    const big = 'x'.repeat(TEXT_MAX + 1);
    const r = sortNotes(`## Cost Drivers\n${big}`);
    expect(r.tooLong).toBe('costDrivers');
    expect(r.topics.costDrivers).toHaveLength(TEXT_MAX + 1);
    expect(sortNotes(big).tooLong).toBe('notes');
  });
});

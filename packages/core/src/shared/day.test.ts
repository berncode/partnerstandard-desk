import { describe, expect, it } from 'vitest';
import { dayLabel } from './day';

describe('dayLabel', () => {
  it('writes a day as a person reads it', () => {
    expect(dayLabel('2026-11-03')).toBe('3 Nov 2026');
    expect(dayLabel('2026-01-30')).toBe('30 Jan 2026');
    expect(dayLabel('2026-01-05')).toBe('5 Jan 2026');
  });

  it('leaves anything that is not a day as it is', () => {
    expect(dayLabel('3 Nov')).toBe('3 Nov');
    expect(dayLabel('2026-13-01')).toBe('2026-13-01');
    expect(dayLabel('')).toBe('');
  });
});

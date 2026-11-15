import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, horizonDayDate, isValidIsoDate, serialToIsoDate, serialToIsoDateTime, toIsoDate } from './dates';

describe('dates', () => {
  it('accepts only real calendar dates in YYYY-MM-DD form', () => {
    expect(isValidIsoDate('2026-02-28')).toBe(true);
    expect(isValidIsoDate('2026-02-30')).toBe(false);
    expect(isValidIsoDate('2026-2-1')).toBe(false);
    expect(isValidIsoDate('16/10/2026')).toBe(false);
  });

  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('counts whole days between two dates', () => {
    expect(daysBetween('2026-10-01', '2026-10-16')).toBe(15);
    expect(daysBetween('2026-10-16', '2026-10-01')).toBe(-15);
  });

  it('converts spreadsheet serial numbers', () => {
    expect(serialToIsoDate(45000)).toBe('2023-03-15');
    expect(serialToIsoDate(46311.75)).toBe('2026-10-16');
    expect(serialToIsoDateTime(46311.75)).toBe('2026-10-16T18:00:00.000Z');
  });

  it('takes the date part of a timestamp', () => {
    expect(toIsoDate('2026-10-16T23:59:00.000Z')).toBe('2026-10-16');
  });

  it('reads a serial date-time as wall-clock time in the sheet’s timezone', () => {
    // 46311.75 is 2026-10-16 18:00 on the sheet's clock.
    expect(serialToIsoDateTime(46311.75, 'UTC')).toBe('2026-10-16T18:00:00.000Z');
    expect(serialToIsoDateTime(46311.75, 'Europe/Berlin')).toBe('2026-10-16T16:00:00.000Z'); // CEST, UTC+2
    expect(serialToIsoDateTime(46311.75, 'America/New_York')).toBe('2026-10-16T22:00:00.000Z'); // EDT, UTC−4
    // 2026-12-01 09:00 in Berlin is CET, UTC+1.
    expect(serialToIsoDateTime(46357.375, 'Europe/Berlin')).toBe('2026-12-01T08:00:00.000Z');
  });

  it('falls back to UTC for an unknown timezone', () => {
    expect(serialToIsoDateTime(46311.75, 'Not/AZone')).toBe('2026-10-16T18:00:00.000Z');
  });
});

describe('horizonDayDate', () => {
  it('counts the start date as day 1', () => {
    expect(horizonDayDate('2026-10-16', 1)).toBe('2026-10-16');
    expect(horizonDayDate('2026-10-16', 30)).toBe('2026-11-14');
    expect(horizonDayDate('2026-10-16', 90)).toBe('2027-01-13');
  });
});

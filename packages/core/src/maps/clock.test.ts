import { describe, expect, it } from 'vitest';
import { isDailyHour, isDigestTime, isValidTimeZone, localTime } from './clock';

const at = (iso: string) => new Date(iso);

describe('localTime', () => {
  it('reads an instant in UTC', () => {
    expect(localTime(at('2026-10-20T08:05:00.000Z'), 'UTC')).toEqual({ date: '2026-10-20', hour: 8, minute: 5, weekday: 2 });
  });

  it('crosses into the owner’s date on both sides of UTC', () => {
    expect(localTime(at('2026-10-20T03:00:00.000Z'), 'America/Los_Angeles')).toMatchObject({ date: '2026-10-19', hour: 20, weekday: 1 });
    expect(localTime(at('2026-10-19T20:00:00.000Z'), 'Pacific/Auckland')).toMatchObject({ date: '2026-10-20', hour: 9, weekday: 2 });
  });

  it('follows Berlin’s 08:00 across the October DST change', () => {
    // CEST (UTC+2) until Sunday 25 October 2026, 01:00 UTC; CET (UTC+1) after.
    expect(localTime(at('2026-10-24T06:00:00.000Z'), 'Europe/Berlin')).toEqual({ date: '2026-10-24', hour: 8, minute: 0, weekday: 6 });
    expect(localTime(at('2026-10-25T06:30:00.000Z'), 'Europe/Berlin')).toMatchObject({ date: '2026-10-25', hour: 7 });
    expect(localTime(at('2026-10-25T07:00:00.000Z'), 'Europe/Berlin')).toMatchObject({ date: '2026-10-25', hour: 8, weekday: 7 });
    expect(localTime(at('2026-10-26T06:00:00.000Z'), 'Europe/Berlin')).toMatchObject({ hour: 7 });
    expect(localTime(at('2026-10-26T07:45:00.000Z'), 'Europe/Berlin')).toEqual({ date: '2026-10-26', hour: 8, minute: 45, weekday: 1 });
  });

  it('follows Berlin’s 08:00 across the March DST change', () => {
    // CET until Sunday 28 March 2027, 01:00 UTC; CEST after.
    expect(localTime(at('2027-03-27T07:00:00.000Z'), 'Europe/Berlin')).toMatchObject({ date: '2027-03-27', hour: 8 });
    expect(localTime(at('2027-03-28T06:00:00.000Z'), 'Europe/Berlin')).toMatchObject({ date: '2027-03-28', hour: 8 });
    expect(localTime(at('2027-03-28T07:00:00.000Z'), 'Europe/Berlin')).toMatchObject({ hour: 9 });
  });

  it('reads an unknown or empty zone as UTC (Review Focus 1)', () => {
    expect(localTime(at('2026-10-20T08:05:00.000Z'), 'Mars/Phobos')).toEqual(localTime(at('2026-10-20T08:05:00.000Z'), 'UTC'));
    expect(localTime(at('2026-10-20T08:05:00.000Z'), '')).toMatchObject({ hour: 8 });
  });

  it('formats midnight as hour 0, never 24', () => {
    expect(localTime(at('2026-10-20T00:10:00.000Z'), 'UTC')).toMatchObject({ date: '2026-10-20', hour: 0, minute: 10 });
  });
});

describe('the daily hour and the digest', () => {
  it('fires for every tick from 08:00 to 08:59, and the digest only on Mondays', () => {
    const berlin = (iso: string) => localTime(at(iso), 'Europe/Berlin');
    expect(isDailyHour(berlin('2026-10-26T06:59:00.000Z'))).toBe(false); // 07:59
    expect(isDailyHour(berlin('2026-10-26T07:00:00.000Z'))).toBe(true);  // 08:00
    expect(isDailyHour(berlin('2026-10-26T07:45:00.000Z'))).toBe(true);  // 08:45
    expect(isDailyHour(berlin('2026-10-26T08:00:00.000Z'))).toBe(false); // 09:00
    expect(isDigestTime(berlin('2026-10-26T07:15:00.000Z'))).toBe(true); // Monday 08:15
    expect(isDigestTime(berlin('2026-10-27T07:15:00.000Z'))).toBe(false); // Tuesday
  });
});

describe('isValidTimeZone', () => {
  it('knows IANA zones and refuses anything else', () => {
    for (const zone of ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata']) expect(isValidTimeZone(zone)).toBe(true);
    for (const bad of ['Mars/Phobos', '', 'x'.repeat(65), 42, null, undefined]) expect(isValidTimeZone(bad)).toBe(false);
  });
});

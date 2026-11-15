import type { IsoDate, IsoDateTime } from '../partners/types';

const DAY_MS = 86_400_000;
// Day 0 of Google Sheets and Excel (1900 date system) serial numbers.
const SERIAL_EPOCH_MS = Date.UTC(1899, 11, 30);

const toUtcMs = (date: IsoDate) => Date.parse(`${date}T00:00:00Z`);

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = toUtcMs(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return new Date(toUtcMs(date) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The date of day `day` of a horizon starting on `startDate`: day 1 is the start date itself. */
export function horizonDayDate(startDate: IsoDate, day: number): IsoDate {
  return addDays(startDate, day - 1);
}

export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

export function toIsoDate(dateTime: IsoDateTime): IsoDate {
  return dateTime.slice(0, 10);
}

export function serialToIsoDate(serial: number): IsoDate {
  return new Date(SERIAL_EPOCH_MS + Math.floor(serial) * DAY_MS).toISOString().slice(0, 10);
}

/** Milliseconds `timeZone` is ahead of UTC at instant `ms`. Unknown zones count as UTC. */
function zoneOffsetMs(ms: number, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(new Date(ms));
  } catch {
    return 0;
  }
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return wall - Math.floor(ms / 1000) * 1000;
}

/**
 * A spreadsheet date-time serial is wall-clock time on the sheet's clock. `timeZone` is the sheet's IANA zone
 * (Google: `properties.timeZone`); without one the serial is read as UTC.
 */
export function serialToIsoDateTime(serial: number, timeZone = 'UTC'): IsoDateTime {
  const wall = SERIAL_EPOCH_MS + Math.round(serial * DAY_MS);
  if (timeZone === 'UTC') return new Date(wall).toISOString();
  // Two passes settle the offset across a DST change.
  const first = wall - zoneOffsetMs(wall, timeZone);
  return new Date(wall - zoneOffsetMs(first, timeZone)).toISOString();
}

import type { IsoDate } from '../partners/types';

/** Daily notifications go out in this local hour (spec §5.2–5.4: 08:00). */
export const DAILY_HOUR = 8;

/** ISO weekday: Monday is 1. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;
export interface LocalTime { date: IsoDate; hour: number; minute: number; weekday: Weekday }

const WEEKDAYS: Record<string, Weekday> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Throws for a zone this runtime doesn't know (Intl's own check). */
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** Whether `value` names an IANA timezone this runtime knows. */
export function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

/** The wall-clock date, hour and weekday of `instant` in `timeZone`. An unknown zone reads as UTC (Review Focus 1). */
export function localTime(instant: Date, timeZone: string): LocalTime {
  const parts = formatterFor(isValidTimeZone(timeZone) ? timeZone : 'UTC').formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 1,
  };
}

/** Any tick in the 08:00 hour may do the day's work; dedupe keys make it happen once (Decision 15). */
export const isDailyHour = (t: LocalTime): boolean => t.hour === DAILY_HOUR;
/** The weekly digest goes out in Monday's 08:00 hour (spec §5.3). */
export const isDigestTime = (t: LocalTime): boolean => t.weekday === 1 && t.hour === DAILY_HOUR;

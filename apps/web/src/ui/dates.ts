// Dates in the owner's timezone (Settings), so the server's render and the browser's agree.

/** The owner's timezone until they pick one in Settings (the commands' DEFAULT_TIME_ZONE). */
export const DEFAULT_TIME_ZONE = 'Europe/Berlin';

/** A day in the owner's timezone: "1 Nov 2026". */
export const dayIn = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone }).format(new Date(iso));

/** A day and a time in the owner's timezone, for a delivery: "1 Nov, 10:00". */
export const timeIn = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));

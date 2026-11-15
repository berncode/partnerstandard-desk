// The two date sums the MAP content needs. The method package imports nothing from core; core's maps/dates.ts has the same rules.
const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` plus `days`. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** The date of day `day` of a horizon starting on `startDate`: day 1 is the start date itself. */
export function horizonDayDate(startDate: string, day: number): string {
  return addDays(startDate, day - 1);
}

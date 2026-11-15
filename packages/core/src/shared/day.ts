// A calendar day in the words a person reads: "3 Nov 2026". No timezone: an IsoDate is already a day.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11-03" as "3 Nov 2026". Anything that isn't a YYYY-MM-DD day comes back as it is. */
export function dayLabel(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const month = match ? MONTHS[Number(match[2]) - 1] : undefined;
  return match && month ? `${Number(match[3])} ${month} ${match[1]}` : date;
}

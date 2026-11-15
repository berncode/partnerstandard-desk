// The dates, counts and side names the plan screens show, in COPY's words. Pure: no React, no I/O.
import { daysBetween, isValidIsoDate, type IsoDate } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "21 Nov", with the year when it is not this year's: "3 Jan 2027". */
export function formatMapDate(date: IsoDate, today: IsoDate): string {
  // Dates decoded from a sheet are validated, but this is display code: never throw on one that slipped through.
  if (!isValidIsoDate(date)) return date;
  const [year, month, day] = date.split('-').map(Number);
  const base = `${day} ${MONTHS[month! - 1]}`;
  return date.slice(0, 4) === today.slice(0, 4) ? base : `${base} ${year}`;
}

export function relativeDay(date: IsoDate, today: IsoDate): string {
  const n = daysBetween(today, date);
  if (n === 0) return COPY.MAP_TODAY;
  if (n === 1) return COPY.MAP_TOMORROW;
  if (n === -1) return COPY.MAP_YESTERDAY;
  return n > 0 ? COPY.MAP_IN_DAYS(n) : COPY.MAP_DAYS_AGO(-n);
}

/** "Brightwave’s", and "Brightwave Systems’" for a name ending in s. */
export function possessive(name: string): string {
  const base = name.trimEnd();
  return /s$/i.test(base) ? `${base}’` : `${base}’s`;
}

/** The two companies in a plan: our side and the partner's, as every viewer sees them. */
export interface SideNames { ours: string; partner: string }

/**
 * Our side, named for everyone: the company's name in Settings, else the signed-in person's own name, so the screens
 * never say "Us".
 */
export function ourSideName(companyName: string | null | undefined, ownerName: string): string {
  return companyName?.trim() || ownerName.trim();
}

/** A side by its company's name: ours, the partner's ("Partner" until it has one), or "Joint". */
export function sideName(side: 'us' | 'partner' | 'joint', names: SideNames): string {
  if (side === 'us') return names.ours;
  if (side === 'partner') return names.partner.trim() || COPY.GUIDED_PARTNER;
  return COPY.GUIDED_JOINT;
}

/** A side's objectives heading: "Acme Partners’ objectives", "Brightwave’s objectives". */
export function objectivesTitle(side: 'us' | 'partner', names: SideNames): string {
  return COPY.GUIDED_OBJECTIVES_OF(possessive(sideName(side, names)));
}

// Which of the scheduled job's webhook events a webhook hears of (question 27, 2026-11-03): only what became late or
// due on or after the day it was added or turned on again, counted in its owner's date. Pure.
import { localTime } from '../maps/clock';
import { addDays } from '../maps/dates';
import type { IsoDate, IsoDateTime } from '../partners/types';
import { REVIEW_COMING_DAYS } from '../reviews/rules';

/** The first day an activity is late: the day after its due date. */
export const overdueFrom = (dueDate: IsoDate): IsoDate => addDays(dueDate, 1);

/** The first day a review is coming up (This week's rule): 21 days before its date. */
export const comingFrom = (reviewDate: IsoDate): IsoDate => addDays(reviewDate, -REVIEW_COMING_DAYS);

/**
 * Whether something that happened on `happenedOn` (the owner's date) happened since `activeSince`, the moment a webhook
 * was added or turned on. The whole of that day counts as after [builder's call]: a webhook added at 14:00 hears of an
 * activity that turned late at midnight.
 */
export function happenedSince(happenedOn: IsoDate, activeSince: IsoDateTime, timeZone: string): boolean {
  return happenedOn >= localTime(new Date(activeSince), timeZone).date;
}

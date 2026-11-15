// The review scorecard (spec 5.4, 5.5): targets from the business case, prefill from deals won, and the case against
// actual. Pure: no I/O. A missing or broken case (no case, a type the offer no longer has) reads like no case; nothing
// here divides, so nothing is NaN.
import { categoryOf, type PartnerType } from '@partner-desk/method';
import { leadShare, type BusinessCase } from '../cases';
import { simulateCase, type CaseResult } from '../cases/simulate';
import { daysBetween } from '../maps/dates';
import type { IsoDate } from '../partners/types';
import { SCORE_KEYS, type MapReview, type ReviewNumber, type ScoreKey } from './types';

export type CategoryNumber = 'activeSellers' | 'certifiedPeople' | 'integrationCustomers' | 'referredCustomers';

/** The one number each partner category adds to the scorecard (spec 5.4). Other has none. */
export function categoryNumberOf(type: PartnerType): CategoryNumber | null {
  switch (categoryOf(type)) {
    case 'channel': return 'activeSellers';
    case 'service': return 'certifiedPeople';
    case 'product': return 'integrationCustomers';
    case 'marketing': return 'referredCustomers';
    default: return null;
  }
}

const YEAR_DAYS = 365;

/** The case simulated, or null when it can't be (the offer no longer has the case's partner type). */
function simulated(c: BusinessCase | null): { c: BusinessCase; sim: CaseResult } | null {
  if (!c || !c.offer.types.some((t) => t.id === c.typeId)) return null;
  return { c, sim: simulateCase(c) };
}

function perDealOf({ c, sim }: { c: BusinessCase; sim: CaseResult }, year: number) {
  const y = sim.years[Math.min(Math.max(Math.round(year), 1), sim.years.length) - 1];
  const type = c.offer.types.find((t) => t.id === c.typeId)!;
  const { yearly, once } = sim.typical;
  const weBill = yearly + once;
  if (!y) return { weBill, partnerEarns: 0 };
  const r = type[y.tier];
  return { weBill, partnerEarns: leadShare(type.roles) * ((yearly * r.first) / 100 + (once * r.once) / 100) };
}

/** What one new deal in a case year is worth: what we bill and what the partner earns. Zeros for a broken case. */
export function perDeal(c: BusinessCase, year: number): { weBill: number; partnerEarns: number } {
  const s = simulated(c);
  return s ? perDealOf(s, year) : { weBill: 0, partnerEarns: 0 };
}

export interface Totals { deals: number; weBill: number; partnerEarns: number }
const ZERO: Totals = { deals: 0, weBill: 0, partnerEarns: 0 };

function forecastOf(s: { c: BusinessCase; sim: CaseResult }, signedDate: IsoDate, from: IsoDate, to: IsoDate): Totals {
  const first = daysBetween(signedDate, from);
  const last = daysBetween(signedDate, to);
  const total = { ...ZERO };
  if (last < first) return total;
  const count = s.sim.years.length;
  s.sim.years.forEach((y, i) => {
    const start = i * YEAR_DAYS;
    const end = i === count - 1 ? Infinity : start + YEAR_DAYS - 1;
    const days = Math.min(last, end) - Math.max(first, start) + 1;
    if (days <= 0) return;
    const deals = (y.deals * days) / YEAR_DAYS;
    const per = perDealOf(s, y.year);
    total.deals += deals;
    total.weBill += deals * per.weBill;
    total.partnerEarns += deals * per.partnerEarns;
  });
  return total;
}

/**
 * The new deals the case plans between two dates, both days included (spec 5.5). Each case year's deals are spread
 * evenly over its 365 days from signing; days after the last year count as the last year. Zeros when `to` is before
 * `from`, or for a broken case.
 */
export function forecastBetween(c: BusinessCase, signedDate: IsoDate, from: IsoDate, to: IsoDate): Totals {
  const s = simulated(c);
  return s ? forecastOf(s, signedDate, from, to) : { ...ZERO };
}

export type ScoreTargets = Partial<Record<ScoreKey, number | null>>;

export const RECOMMEND_TARGET = 8;

/**
 * What a review's scorecard checks: the previous review's next targets, else the business case's forecast for the
 * horizon (deals and money rounded to whole numbers) and 8 for how likely the partner would recommend us.
 */
export function targetsFor(input: {
  previous: ReviewNumber[] | null;
  c: BusinessCase | null;
  signedDate: IsoDate;
  horizonStart: IsoDate;
  reviewDate: IsoDate;
}): ScoreTargets {
  const out: ScoreTargets = Object.fromEntries(SCORE_KEYS.map((k) => [k, null]));
  if (input.previous) {
    for (const n of input.previous) out[n.key] = n.nextTarget;
    return out;
  }
  out.recommend = RECOMMEND_TARGET;
  const s = simulated(input.c);
  if (s) {
    // Whole deals and whole money (walkthrough 2026-11-01): the target stored on close, the one shown and the percent
    // counted from it then agree. A forecast counts parts of deals; a target doesn't.
    const f = forecastOf(s, input.signedDate, input.horizonStart, input.reviewDate);
    out.dealsWon = whole(f.deals);
    out.weBill = whole(f.weBill);
    out.partnerEarns = whole(f.partnerEarns);
  }
  return out;
}

/** Rounded half up to a whole number, never below 0; a sum's float noise (2.4999999999 for 2.5) doesn't count. */
const whole = (n: number): number => Math.max(0, Math.round(Math.round(n * 1e6) / 1e6));

/** The numbers to prefill from what the person typed: the category number and the money of the deals won. */
export function prefill(input: {
  activeSellers: number;
  type: PartnerType;
  dealsWon: number | null;
  c: BusinessCase | null;
  year: number;
}): ScoreTargets {
  const out: ScoreTargets = { weBill: null, partnerEarns: null, categoryNumber: null };
  if (categoryOf(input.type) === 'channel') out.categoryNumber = input.activeSellers;
  const s = simulated(input.c);
  if (s && input.dealsWon !== null) {
    const per = perDealOf(s, input.year);
    out.weBill = input.dealsWon * per.weBill;
    out.partnerEarns = input.dealsWon * per.partnerEarns;
  }
  return out;
}

export interface CaseAgainstActual {
  toDate: { actual: Totals; forecast: Totals };
  rows: Array<{ reviewId: string; heldOn: IsoDate; actual: Totals; target: Totals }>;
}

const KEY_OF: Record<keyof Totals, ScoreKey> = { deals: 'dealsWon', weBill: 'weBill', partnerEarns: 'partnerEarns' };

function totalsOf(numbers: ReviewNumber[], field: 'actual' | 'target'): Totals {
  const get = (k: keyof Totals) => numbers.find((n) => n.key === KEY_OF[k])?.[field] ?? 0;
  return { deals: get('deals'), weBill: get('weBill'), partnerEarns: get('partnerEarns') };
}

/**
 * Held reviews summed against the case's forecast for the same period (spec 5.5): from signing to the newest held
 * review's day, since the actuals stop there. `asOf` (the owner's today) stands in for a held review without its day.
 * Null with no usable case or no held review.
 */
export function caseAgainstActual(input: {
  held: Array<{ review: MapReview; numbers: ReviewNumber[] }>;
  c: BusinessCase | null;
  signedDate: IsoDate;
  asOf: IsoDate;
}): CaseAgainstActual | null {
  const s = simulated(input.c);
  const held = input.held.filter((h) => h.review.state === 'held');
  if (!s || held.length === 0) return null;
  const rows = held.map((h) => ({
    reviewId: h.review.id,
    heldOn: h.review.heldOn ?? input.asOf,
    actual: totalsOf(h.numbers, 'actual'),
    target: totalsOf(h.numbers, 'target'),
  }));
  const actual = rows.reduce(
    (t, r) => ({ deals: t.deals + r.actual.deals, weBill: t.weBill + r.actual.weBill, partnerEarns: t.partnerEarns + r.actual.partnerEarns }),
    { ...ZERO },
  );
  const until = rows.reduce((last, r) => (r.heldOn > last ? r.heldOn : last), rows[0]!.heldOn);
  return { toDate: { actual, forecast: forecastOf(s, input.signedDate, input.signedDate, until) }, rows };
}

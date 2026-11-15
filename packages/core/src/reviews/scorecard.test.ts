import { describe, expect, it } from 'vitest';
import { EXAMPLES } from '../cases/examples';
import { simulateCase } from '../cases/simulate';
import type { BusinessCase } from '../cases/types';
import type { MapReview, ReviewNumber, ScoreKey } from './types';
import { caseAgainstActual, categoryNumberOf, forecastBetween, perDeal, prefill, targetsFor } from './scorecard';

const reseller = (): BusinessCase => structuredClone(EXAMPLES.saas.case);
const SIGNED = '2026-01-01';
const day = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

const review = (id: string, heldOn: string): MapReview => ({
  id, horizon: 1, state: 'held', heldOn, caseId: null, decisions: '', relationshipNote: '', nextHorizonDays: 90,
  includeScorecard: true, summarySentAt: null, summarySentTo: '', updatedAt: null, updatedBy: null,
});
const num = (reviewId: string, key: ScoreKey, actual: number | null, target: number | null, nextTarget: number | null = null): ReviewNumber => ({
  id: `${reviewId}_${key}`, reviewId, key, actual, target, source: null, note: '', nextTarget,
});

const noNaN = (o: Record<string, unknown>) => Object.values(o).forEach((v) => expect(Number.isNaN(v)).toBe(false));

describe('categoryNumberOf', () => {
  it('maps each category to its number', () => {
    expect(categoryNumberOf('reseller')).toBe('activeSellers');
    expect(categoryNumberOf('system-integrator')).toBe('certifiedPeople');
    expect(categoryNumberOf('technology')).toBe('integrationCustomers');
    expect(categoryNumberOf('affiliate')).toBe('referredCustomers');
    expect(categoryNumberOf('other')).toBeNull();
  });
});

describe('perDeal', () => {
  it('matches the simulation for each year', () => {
    const c = reseller();
    const sim = simulateCase(c);
    for (const y of sim.years) {
      const p = perDeal(c, y.year);
      expect(p.partnerEarns).toBeCloseTo(y.newEarnings / y.deals, 6);
      expect(p.weBill).toBe(sim.typical.yearly + sim.typical.once);
    }
  });
  it('clamps the year to 1 to 5', () => {
    const c = reseller();
    expect(perDeal(c, 0)).toEqual(perDeal(c, 1));
    expect(perDeal(c, 9)).toEqual(perDeal(c, 5));
  });
  it('is zero for a case with no products', () => {
    const c = reseller();
    c.offer.products = [];
    expect(perDeal(c, 1)).toEqual({ weBill: 0, partnerEarns: 0 });
  });
});

describe('forecastBetween', () => {
  it('over exactly year 1 gives year 1', () => {
    const c = reseller();
    const y1 = simulateCase(c).years[0]!;
    const f = forecastBetween(c, SIGNED, SIGNED, day(364));
    expect(f.deals).toBeCloseTo(y1.deals, 6);
    expect(f.partnerEarns).toBeCloseTo(y1.newEarnings, 4);
    expect(f.weBill).toBeCloseTo(y1.deals * (simulateCase(c).typical.yearly + simulateCase(c).typical.once), 4);
  });
  it('over 90 days is year 1 times 90/365', () => {
    const c = reseller();
    const y1 = simulateCase(c).years[0]!;
    expect(forecastBetween(c, SIGNED, SIGNED, day(89)).deals).toBeCloseTo((y1.deals * 90) / 365, 6);
  });
  it('crosses into year 2 and counts days after year 5 as year 5', () => {
    const c = reseller();
    const ys = simulateCase(c).years;
    expect(forecastBetween(c, SIGNED, day(364), day(365)).deals).toBeCloseTo(ys[0]!.deals / 365 + ys[1]!.deals / 365, 6);
    expect(forecastBetween(c, SIGNED, day(5 * 365), day(5 * 365 + 364)).deals).toBeCloseTo(ys[4]!.deals, 6);
  });
  it('is zero when to is before from, and counts nothing before signing', () => {
    const c = reseller();
    expect(forecastBetween(c, SIGNED, day(10), day(5))).toEqual({ deals: 0, weBill: 0, partnerEarns: 0 });
    expect(forecastBetween(c, SIGNED, day(-10), day(-1)).deals).toBe(0);
  });
  it('is zero for a case whose type is missing', () => {
    const c = reseller();
    c.typeId = 'gone';
    expect(forecastBetween(c, SIGNED, SIGNED, day(89))).toEqual({ deals: 0, weBill: 0, partnerEarns: 0 });
  });
});

describe('targetsFor', () => {
  const base = { signedDate: SIGNED, horizonStart: SIGNED, reviewDate: day(89) };
  it('uses the case forecast and 8 for recommend without a previous review', () => {
    const c = reseller();
    const t = targetsFor({ ...base, previous: null, c });
    const f = forecastBetween(c, SIGNED, SIGNED, day(89));
    expect(t.dealsWon).toBe(Math.round(f.deals));
    expect(t.recommend).toBe(8);
    expect(t.openDeals).toBeNull();
  });
  it('gives whole deals, rounded half up, and whole money: what is stored, shown and counted agree', () => {
    const c = reseller();
    c.deals = [3, 3, 3, 3, 3];
    // 0.74 deals in about 90 days: one deal, as the walkthrough's partner read "target 0.7".
    const t = targetsFor({ ...base, previous: null, c });
    const f = forecastBetween(c, SIGNED, SIGNED, day(89));
    expect(f.deals).toBeCloseTo(0.74, 2);
    expect(t.dealsWon).toBe(1);
    expect(t.weBill).toBe(Math.round(f.weBill));
    expect(t.partnerEarns).toBe(Math.round(f.partnerEarns));
    expect(Number.isInteger(t.weBill) && Number.isInteger(t.partnerEarns)).toBe(true);
    // Half a deal rounds up; less than half rounds down, to 0 at the least.
    const half = targetsFor({ ...base, previous: null, c: { ...c, deals: [182.5, 1, 1, 1, 1] }, reviewDate: day(0) });
    expect(half.dealsWon).toBe(1);
    const less = targetsFor({ ...base, previous: null, c: { ...c, deals: [1, 1, 1, 1, 1] }, reviewDate: day(29) });
    expect(less.dealsWon).toBe(0);
  });
  it("a previous review's nextTarget wins over the case", () => {
    const t = targetsFor({ ...base, previous: [num('r1', 'dealsWon', 3, 2, 12), num('r1', 'recommend', 7, 8, 9)], c: reseller() });
    expect(t.dealsWon).toBe(12);
    expect(t.recommend).toBe(9);
    expect(t.weBill).toBeNull();
  });
  it('has only recommend without a case', () => {
    const t = targetsFor({ ...base, previous: null, c: null });
    expect(t.recommend).toBe(8);
    expect(t.dealsWon).toBeNull();
    expect(t.weBill).toBeNull();
    expect(t.partnerEarns).toBeNull();
  });
  it('gives 0 for a case with no products or 0 deals, never NaN', () => {
    const noProducts = reseller();
    noProducts.offer.products = [];
    const a = targetsFor({ ...base, previous: null, c: noProducts });
    expect(a.weBill).toBe(0);
    noNaN(a);
    const noDeals = reseller();
    noDeals.deals = [0, 0, 0, 0, 0];
    const b = targetsFor({ ...base, previous: null, c: noDeals });
    expect([b.dealsWon, b.weBill, b.partnerEarns]).toEqual([0, 0, 0]);
    noNaN(b);
  });
  it('treats a case with a missing type like no case', () => {
    const c = reseller();
    c.typeId = 'gone';
    const t = targetsFor({ ...base, previous: null, c });
    expect(t.dealsWon).toBeNull();
    expect(t.recommend).toBe(8);
  });
});

describe('prefill', () => {
  it('gives active sellers for channel types and deals times per deal', () => {
    const c = reseller();
    const p = prefill({ activeSellers: 4, type: 'reseller', dealsWon: 2, c, year: 1 });
    expect(p.categoryNumber).toBe(4);
    expect(p.weBill).toBeCloseTo(2 * perDeal(c, 1).weBill, 6);
    expect(p.partnerEarns).toBeCloseTo(2 * perDeal(c, 1).partnerEarns, 6);
  });
  it('is null for the category number of other types, and for money with no case or no deals typed', () => {
    expect(prefill({ activeSellers: 4, type: 'technology', dealsWon: 2, c: reseller(), year: 1 }).categoryNumber).toBeNull();
    const none = prefill({ activeSellers: 4, type: 'reseller', dealsWon: 2, c: null, year: 1 });
    expect([none.weBill, none.partnerEarns]).toEqual([null, null]);
    const untyped = prefill({ activeSellers: 4, type: 'reseller', dealsWon: null, c: reseller(), year: 1 });
    expect([untyped.weBill, untyped.partnerEarns]).toEqual([null, null]);
  });
  it('gives 0 money for 0 deals won', () => {
    const p = prefill({ activeSellers: 1, type: 'reseller', dealsWon: 0, c: reseller(), year: 1 });
    expect([p.weBill, p.partnerEarns]).toEqual([0, 0]);
  });
});

describe('caseAgainstActual', () => {
  const held = [
    { review: review('r1', day(89)), numbers: [num('r1', 'dealsWon', 2, 3), num('r1', 'weBill', 1000, 1500), num('r1', 'partnerEarns', 100, 150)] },
    { review: review('r2', day(179)), numbers: [num('r2', 'dealsWon', 4, 3), num('r2', 'weBill', null, 1500)] },
  ];
  it('sums both held reviews against the forecast to date', () => {
    const c = reseller();
    const r = caseAgainstActual({ held, c, signedDate: SIGNED, asOf: day(179) })!;
    expect(r.toDate.actual).toEqual({ deals: 6, weBill: 1000, partnerEarns: 100 });
    expect(r.toDate.forecast.deals).toBeCloseTo(forecastBetween(c, SIGNED, SIGNED, day(179)).deals, 6);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[1]!.target).toEqual({ deals: 3, weBill: 1500, partnerEarns: 0 });
    expect(r.rows[0]!.heldOn).toBe(day(89));
  });
  it('compares the same period: the forecast ends on the newest held review, not today (spec 5.5)', () => {
    const c = reseller();
    // Held out of order on purpose: the newest held review is r2 (day 179), whatever the list's order.
    const r = caseAgainstActual({ held: [held[1]!, held[0]!], c, signedDate: SIGNED, asOf: day(300) })!;
    const sameDay = forecastBetween(c, SIGNED, SIGNED, day(179));
    expect(r.toDate.forecast.deals).toBeCloseTo(sameDay.deals, 6);
    expect(r.toDate.forecast.weBill).toBeCloseTo(sameDay.weBill, 6);
    expect(r.toDate.forecast.partnerEarns).toBeCloseTo(sameDay.partnerEarns, 6);
    expect(r.toDate.forecast.deals).toBeLessThan(forecastBetween(c, SIGNED, SIGNED, day(300)).deals);
  });
  it('is null with no case, a broken case or no held review', () => {
    expect(caseAgainstActual({ held, c: null, signedDate: SIGNED, asOf: day(179) })).toBeNull();
    const broken = reseller();
    broken.typeId = 'gone';
    expect(caseAgainstActual({ held, c: broken, signedDate: SIGNED, asOf: day(179) })).toBeNull();
    expect(caseAgainstActual({ held: [], c: reseller(), signedDate: SIGNED, asOf: day(179) })).toBeNull();
  });
});

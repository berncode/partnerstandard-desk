import { SCENARIO_FACTOR, earningsWord, leadShare } from './types';
import type { BusinessCase, EarningsWord, CaseOffer, Tier } from './types';

export interface YearResult {
  year: number;
  deals: number;
  tier: Tier;
  customers: number;
  newEarnings: number;
  renewalEarnings: number;
  implementation: number;
  managed: number;
  other: number;
  earnings: number;
  services: number;
  revenue: number;
  /** Part of `costs`. */
  supportCost: number;
  /** The vendor's share of the partner's services this year, at the year's tier. Part of `costs`. */
  servicesToVendor: number;
  /** The partner fee to the vendor. Part of `costs`. */
  fee: number;
  costs: number;
  profit: number;
  profitSoFar: number;
  vendorRevenue: number;
}

export interface CaseResult {
  years: YearResult[];
  earnings: number;
  services: number;
  /** The vendor's share of the partner's services, over all years. */
  servicesToVendor: number;
  /** The partner fee to the vendor, a year. */
  fee: number;
  profit: number;
  vendorRevenue: number;
  preferredFrom: number | null;
  preferredAdds: number;
  breakEven: { year: number; month: number } | null;
  typical: { yearly: number; once: number };
  costStart: number;
  costYearly: number;
  word: EarningsWord;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

function dealValue(offer: CaseOffer) {
  const value = (paid: 'yearly' | 'once') =>
    sum(offer.products.filter((p) => p.paid === paid).map((p) => p.price * p.amount));
  return { yearly: value('yearly'), once: value('once') };
}

const costTotal = (c: BusinessCase, when: 'start' | 'yearly' | 'preferred') =>
  sum(c.costs.filter((x) => x.when === when).map((x) => x.amount));

/** Spec 8.1: Preferred is checked against the year before, except for a set year. */
function tierFor(c: BusinessCase, year: number, prev: { deals: number; vendorRevenue: number }): Tier {
  const p = c.offer.preferred;
  if (!p.on) return 'registered';
  if (p.rule === 'year') return c.startsAs === 'preferred' || year >= p.year ? 'preferred' : 'registered';
  if (year === 1) return c.startsAs;
  const met = p.rule === 'deals' ? prev.deals >= p.deals : prev.vendorRevenue >= p.revenue;
  return met ? 'preferred' : 'registered';
}

function years(c: BusinessCase, forceRegistered: boolean): YearResult[] {
  const offer = c.offer;
  const type = offer.types.find((t) => t.id === c.typeId);
  if (!type) throw new Error(`Partner type ${c.typeId} is not in the offer`);
  const { yearly, once } = dealValue(offer);
  const renew = offer.renewal / 100;
  const svc = c.serviceProfit / 100;
  const start = costTotal(c, 'start');
  const everyYear = costTotal(c, 'yearly');
  const preferredCost = costTotal(c, 'preferred');
  const f = leadShare(type.roles);
  const own = type.roles.services ? 1 : 0;
  const perCustomerSupport = type.roles.support === 'none' ? 0 : c.supportCost;
  const rows: YearResult[] = [];
  let customers = 0;
  let prev = { deals: 0, vendorRevenue: 0 };
  let profitSoFar = 0;
  c.deals.forEach((base, i) => {
    const year = i + 1;
    const deals = Math.round(base * SCENARIO_FACTOR[c.scenario]);
    const tier: Tier = forceRegistered ? 'registered' : tierFor(c, year, prev);
    const r = type[tier];
    const renewing = customers * renew;
    customers = renewing + deals;
    const newEarnings = deals * f * (yearly * (r.first / 100) + once * (r.once / 100));
    const renewalEarnings = renewing * f * yearly * (r.renewal / 100);
    const implementation = own * deals * c.implementation;
    const managed = own * customers * c.managed * 12;
    const other = own * deals * c.other;
    const earnings = newEarnings + renewalEarnings;
    const services = implementation + managed + other;
    const supportCost = customers * perCustomerSupport;
    // The share comes off the partner's service revenue, not off its profit on services.
    const servicesToVendor = services * (r.servicesShare / 100);
    const fee = type.fee;
    const costs = (year === 1 ? start : 0) + everyYear + (tier === 'preferred' ? preferredCost : 0) + supportCost + servicesToVendor + fee;
    const profit = earnings + services * svc - costs;
    profitSoFar += profit;
    const vendorRevenue = deals * (yearly + once) + renewing * yearly;
    rows.push({
      year, deals, tier, customers, newEarnings, renewalEarnings, implementation, managed, other,
      earnings, services, revenue: earnings + services, supportCost, servicesToVendor, fee, costs, profit, profitSoFar, vendorRevenue,
    });
    prev = { deals, vendorRevenue };
  });
  return rows;
}

/** The start costs are paid on day one; everything else comes in evenly over the year. */
function breakEven(rows: YearResult[], start: number): CaseResult['breakEven'] {
  let running = -start;
  for (const r of rows) {
    const gain = r.year === 1 ? r.profit + start : r.profit;
    const end = running + gain;
    if (end >= 0 && gain > 0) {
      return { year: r.year, month: Math.min(12, Math.max(1, Math.ceil((12 * -running) / gain))) };
    }
    running = end;
  }
  return null;
}

export function simulateCase(c: BusinessCase): CaseResult {
  const offer = c.offer;
  const rows = years(c, false);
  const registeredOnly = years(c, true);
  const type = offer.types.find((t) => t.id === c.typeId)!;
  const start = costTotal(c, 'start');
  const last = rows[rows.length - 1]!;
  return {
    years: rows,
    earnings: sum(rows.map((r) => r.earnings)),
    services: sum(rows.map((r) => r.services)),
    servicesToVendor: sum(rows.map((r) => r.servicesToVendor)),
    fee: type.fee,
    profit: last.profitSoFar,
    vendorRevenue: sum(rows.map((r) => r.vendorRevenue)),
    preferredFrom: rows.find((r) => r.tier === 'preferred')?.year ?? null,
    preferredAdds: last.profitSoFar - registeredOnly[registeredOnly.length - 1]!.profitSoFar,
    breakEven: breakEven(rows, start),
    typical: dealValue(offer),
    costStart: start,
    costYearly: costTotal(c, 'yearly'),
    word: earningsWord(type.roles),
  };
}

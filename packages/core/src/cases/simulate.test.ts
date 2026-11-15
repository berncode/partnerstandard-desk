import { describe, expect, it } from 'vitest';
import { EXAMPLES, type ExampleKey } from './examples';
import { simulateCase } from './simulate';
import type { BusinessCase, CaseType, PreferredConditions, Scenario } from './types';

const R = 'registered';
const P = 'preferred';

type Row = [ExampleKey, Scenario, number[], number, number, number, number, { year: number; month: number }];
const rows: Row[] = [
  ['saas', 'expected', [3, 7, 11, 15, 19], 578608, 0, 479507, 2948039, { year: 2, month: 6 }],
  ['saas', 'careful', [2, 4, 7, 9, 11], 351078, 0, 265373, 1788389, { year: 3, month: 1 }],
  ['referral', 'expected', [4, 9, 14, 18, 22], 90450, 0, 74450, 1248900, { year: 2, month: 4 }],
  ['referral', 'careful', [2, 5, 8, 11, 13], 52650, 0, 36650, 715191, { year: 3, month: 1 }],
  // Year 1: 5 customers × 30% lead × €24,000 × 10% = €3,600 referral fee; services 5 × (€15,000 + €3,000) + 5 × €500 × 12
  // = €120,000, 35% of it profit = €42,000; costs €10,000 start + €5,000 yearly + 5 × €250 support + €2,500 fee = €18,750;
  // profit €26,850. Break-even: €10,000 back out of €36,850 in month 4.
  ['services', 'expected', [5, 10, 15, 20, 25], 54000, 2301093, 772254, 3804372, { year: 1, month: 4 }],
  ['services', 'careful', [3, 6, 9, 12, 15], 32400, 1380656, 444352, 2282623, { year: 1, month: 7 }],
  // The Value Added Reseller gives 10% of its services to Secura: €900,000 of services, €90,000 less profit than before.
  ['onprem', 'expected', [2, 4, 6, 8, 10], 403386, 900000, 463424, 1949429, { year: 2, month: 2 }],
  ['onprem', 'careful', [1, 2, 4, 5, 6], 240487, 540000, 245025, 1161937, { year: 2, month: 12 }],
  // Now a Value Added Reseller (it closes, so a margin on every deal) instead of a Service partner. Year 1: 4 deals ×
  // (€2,400 × 25% + €18,000 × 20%) = €16,800 margin; services €42,000, 35% = €14,700; costs €15,000 + €5,000 + 4 × €200
  // = €20,800; profit €10,700. Break-even: €15,000 back out of €25,700 in month 8.
  ['hardware', 'expected', [4, 8, 12, 16, 20], 281183, 812393, 501361, 1369914, { year: 1, month: 8 }],
  ['hardware', 'careful', [2, 5, 7, 10, 12], 168412, 485574, 283991, 820459, { year: 2, month: 2 }],
];

const build = (key: ExampleKey, scenario: Scenario = 'expected'): BusinessCase => ({ ...structuredClone(EXAMPLES[key].case), scenario });
const withPreferred = (c: BusinessCase, p: Partial<PreferredConditions>): BusinessCase => ({
  ...c,
  offer: { ...c.offer, preferred: { ...c.offer.preferred, on: true, ...p } },
});

describe('simulateCase, Preferred off', () => {
  it.each(rows)('%s / %s', (key, scenario, deals, earnings, services, profit, vendor, be) => {
    const r = simulateCase(build(key, scenario));
    expect(r.years.map((y) => y.deals)).toEqual(deals);
    expect(r.years.map((y) => y.tier)).toEqual([R, R, R, R, R]);
    expect(Math.round(r.earnings)).toBe(earnings);
    expect(Math.round(r.services)).toBe(services);
    expect(Math.round(r.profit)).toBe(profit);
    expect(Math.round(r.vendorRevenue)).toBe(vendor);
    expect(r.preferredAdds).toBe(0);
    expect(r.preferredFrom).toBeNull();
    expect(r.breakEven).toEqual(be);
  });
});

describe('simulateCase, Preferred on (saas / expected)', () => {
  const table: [string, Partial<PreferredConditions>, string[], number, number, number, { year: number; month: number }][] = [
    ['deals, 8', { rule: 'deals', deals: 8 }, [R, R, R, P, P], 780380, 669279, 189772, { year: 2, month: 6 }],
    ['revenue, 250000', { rule: 'revenue', revenue: 250000 }, [R, R, P, P, P], 829932, 712831, 233324, { year: 2, month: 6 }],
    ['set year 2', { rule: 'year', year: 2 }, [R, P, P, P, P], 854612, 731511, 252004, { year: 2, month: 4 }],
  ];
  it.each(table)('%s', (_name, rule, tiers, earnings, profit, adds, be) => {
    const r = simulateCase(withPreferred(build('saas'), rule));
    expect(r.years.map((y) => y.tier)).toEqual(tiers);
    expect(Math.round(r.earnings)).toBe(earnings);
    expect(Math.round(r.profit)).toBe(profit);
    expect(Math.round(r.preferredAdds)).toBe(adds);
    expect(r.breakEven).toEqual(be);
  });

  it('charges the Preferred cost line only in Preferred years', () => {
    const r = simulateCase(withPreferred(build('saas'), { rule: 'deals', deals: 8 }));
    expect(r.years.map((y) => Math.round(y.costs - y.supportCost))).toEqual([33000, 8000, 8000, 14000, 14000]);
  });
});

/** `c` with its own partner type changed by `patch`. */
const withType = (c: BusinessCase, patch: (t: CaseType) => void): BusinessCase => {
  const next = structuredClone(c);
  patch(next.offer.types.find((t) => t.id === next.typeId)!);
  return next;
};

describe('simulateCase, the share of the partner’s services and the partner fee', () => {
  it('takes the share off the partner’s service revenue, not off its profit on services', () => {
    const c = withType(build('services'), (t) => { t.registered.servicesShare = 20; });
    const none = simulateCase(withType(c, (t) => { t.registered.servicesShare = 0; }));
    const r = simulateCase(c);
    r.years.forEach((y, i) => {
      expect(y.servicesToVendor).toBeCloseTo(y.services * 0.2);
      expect(y.profit).toBeCloseTo(none.years[i]!.profit - y.services * 0.2);
      expect(y.costs).toBeCloseTo(none.years[i]!.costs + y.services * 0.2);
    });
    // Year 1: 5 customers × (€15,000 implementation + €3,000 other) + 5 × €500 × 12 managed = €120,000; 20% = €24,000.
    expect(r.years[0]!.services).toBe(120000);
    expect(r.years[0]!.servicesToVendor).toBe(24000);
    expect(r.servicesToVendor).toBeCloseTo(r.services * 0.2);
  });

  it('takes the share at each year’s tier, and a lower Preferred share counts in what Preferred adds', () => {
    const base = withPreferred(build('onprem'), { rule: 'year', year: 3 });
    const lower = withType(base, (t) => { t.preferred.servicesShare = 4; });
    const r = simulateCase(lower);
    expect(r.years.map((y) => y.tier)).toEqual([R, R, P, P, P]);
    r.years.forEach((y) => expect(y.servicesToVendor).toBeCloseTo(y.services * (y.tier === P ? 0.04 : 0.1)));
    const same = simulateCase(base);
    const saved = r.years.filter((y) => y.tier === P).reduce((s, y) => s + y.services * 0.06, 0);
    expect(r.preferredAdds).toBeCloseTo(same.preferredAdds + saved);
  });

  it('has no share for a type without services', () => {
    const r = simulateCase(withType(build('saas'), (t) => { t.registered.servicesShare = 50; }));
    expect(r.years.every((y) => y.servicesToVendor === 0)).toBe(true);
  });

  it('charges the partner fee every year from year 1, as a partner cost', () => {
    const c = build('services');
    const none = simulateCase(withType(c, (t) => { t.fee = 0; }));
    const r = simulateCase(c);
    expect(r.years.map((y) => y.fee)).toEqual([2500, 2500, 2500, 2500, 2500]);
    r.years.forEach((y, i) => {
      expect(y.costs).toBe(none.years[i]!.costs + 2500);
      expect(y.profit).toBeCloseTo(none.years[i]!.profit - 2500);
    });
    expect(r.fee).toBe(2500);
    expect(r.profit).toBeCloseTo(none.profit - 12500);
  });

  it('charges the fee for a type of any role, and counts it in the break-even', () => {
    const c = build('referral');
    expect(simulateCase(c).breakEven).toEqual({ year: 2, month: 4 });
    const r = simulateCase(withType(c, (t) => { t.fee = 10000; }));
    expect(r.years.every((y) => y.fee === 10000)).toBe(true);
    // Profits −€12,600, €150, €6,900, €12,300: the €6,000 start costs and the losses are back in year 4, month 6.
    expect(r.breakEven).toEqual({ year: 4, month: 6 });
  });

  it('counts the fee in both tiers, so it adds nothing to what Preferred adds', () => {
    const c = withPreferred(build('saas'), { rule: 'deals', deals: 8 });
    const r = simulateCase(withType(c, (t) => { t.fee = 5000; }));
    expect(r.preferredAdds).toBeCloseTo(simulateCase(c).preferredAdds);
  });
});

describe('simulateCase, details', () => {
  it('computes year 1 and the typical customer for saas / expected', () => {
    const r = simulateCase(build('saas'));
    const y1 = r.years[0]!;
    expect({
      newEarnings: Math.round(y1.newEarnings),
      renewalEarnings: Math.round(y1.renewalEarnings),
      implementation: Math.round(y1.implementation),
      managed: Math.round(y1.managed),
      other: Math.round(y1.other),
      supportCost: Math.round(y1.supportCost),
      costs: Math.round(y1.costs),
    }).toEqual({ newEarnings: 16200, renewalEarnings: 0, implementation: 0, managed: 0, other: 0, supportCost: 900, costs: 33900 });
    expect(r.typical).toEqual({ yearly: 24000, once: 4000 });
    expect(r.costStart).toBe(25000);
    expect(r.costYearly).toBe(8000);
    expect(r.word).toBe('margin');
  });

  it('takes the earnings word from the roles', () => {
    expect(simulateCase(build('referral')).word).toBe('commission');
    expect(simulateCase(build('services')).word).toBe('referral fee');
    expect(simulateCase(build('hardware')).word).toBe('margin');
    expect(simulateCase(build('onprem')).word).toBe('margin');
  });

  it('keeps only the lead share of earnings for a type that does not close', () => {
    const base = build('saas');
    const withLead = (lead: number): BusinessCase => ({
      ...base,
      offer: {
        ...base.offer,
        types: base.offer.types.map((t) =>
          t.id === base.typeId ? { ...t, roles: { ...t.roles, closes: false, services: true, lead } } : t),
      },
    });
    const full = simulateCase(withLead(100));
    const part = simulateCase(withLead(30));
    expect(part.years[0]!.implementation).toBeGreaterThan(0);
    expect(part.earnings).toBeCloseTo(full.earnings * 0.3, 6);
  });

  it('counts no services for a type that delivers none', () => {
    const r = simulateCase(build('referral'));
    expect(r.services).toBe(0);
    expect(r.years.every((y) => y.implementation === 0 && y.managed === 0 && y.other === 0)).toBe(true);
  });

  it('counts no support cost for a type without partner support', () => {
    const c = build('referral');
    const r = simulateCase({ ...c, supportCost: 500 });
    expect(r.years.every((y) => y.supportCost === 0)).toBe(true);
  });

  it('charges support per customer for a type that gives it', () => {
    const r = simulateCase(build('saas'));
    r.years.forEach((y) => expect(y.supportCost).toBe(y.customers * 300));
  });

  it('with Preferred off, a Preferred start and its cost line change nothing', () => {
    const base = build('saas');
    const plain: BusinessCase = { ...base, costs: base.costs.filter((x) => x.when !== 'preferred') };
    const odd: BusinessCase = { ...base, startsAs: 'preferred' };
    const a = simulateCase(plain);
    const b = simulateCase(odd);
    expect(b.years.map((y) => y.tier)).toEqual([R, R, R, R, R]);
    expect(b.years).toEqual(a.years);
    expect(b.profit).toBe(a.profit);
    expect(b.preferredFrom).toBeNull();
    expect(b.preferredAdds).toBe(0);
  });

  it('keeps a Preferred start for all five years under the set-year rule', () => {
    const r = simulateCase({ ...withPreferred(build('saas'), { rule: 'year', year: 3 }), startsAs: 'preferred' });
    expect(r.years.map((y) => y.tier)).toEqual([P, P, P, P, P]);
    expect(r.preferredFrom).toBe(1);
  });

  it('re-checks a Preferred start every year under the deals rule', () => {
    const r = simulateCase({ ...withPreferred(build('saas'), { rule: 'deals', deals: 8 }), startsAs: 'preferred' });
    expect(r.years.slice(0, 2).map((y) => y.tier)).toEqual([P, R]);
  });

  it('throws when the partner type is missing from the offer', () => {
    expect(() => simulateCase({ ...build('saas'), typeId: 'nope' })).toThrow();
  });

  it('gives only finite numbers for an empty offer', () => {
    const c = build('saas');
    const zero = { registered: { first: 0, renewal: 0, once: 0, servicesShare: 0 }, preferred: { first: 0, renewal: 0, once: 0, servicesShare: 0 }, fee: 0 };
    const empty: BusinessCase = {
      ...c, deals: [0, 0, 0, 0, 0], implementation: 0, managed: 0, other: 0, costs: [],
      offer: { ...c.offer, renewal: 0, products: [], types: c.offer.types.map((t) => ({ ...t, ...zero })) },
    };
    const r = simulateCase(empty);
    const values = [r.earnings, r.services, r.profit, r.vendorRevenue, r.preferredAdds, ...r.years.flatMap((y) => [y.customers, y.profit, y.profitSoFar])];
    expect(values.every(Number.isFinite)).toBe(true);
    expect(r.breakEven).toBeNull();
    expect(r.preferredFrom).toBeNull();
  });
});

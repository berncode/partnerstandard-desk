import { describe, expect, it } from 'vitest';
import { EXAMPLES, type ExampleKey } from './examples';
import { simulateOurCase, shiftDeals } from './our-case';
import { simulateCase } from './simulate';
import type { BusinessCase, PreferredConditions, Scenario } from './types';
import { CASE_SOURCES } from './types';

type PB = { year: number; month: number } | null;
const pb = (s: string): PB => (s === 'none' ? null : { year: Number(s.split('/')[0]), month: Number(s.split('/')[1]) });

// net, invest, payback, newRev, sales, support, taken, services, efficiency, churn, aloneNet, aloneInvest, alonePayback, nothing, share, assumption
type Row = [ExampleKey, Scenario, number, number, string, number, number, number, number, number, number, number, number, number, string, number, number | 'theirsOnly', number];
const rows: Row[] = [
  ['saas', 'expected', 1433415, 242000, '2/2', 1543980, 0, 25575, 3410, 0, 0, 153600, 233259, 490000, '5/2', -60000, 25, 1],
  ['saas', 'careful', 834704, 242000, '2/6', 936562, 0, 15529, 2070, 0, 0, 153600, -47206, 490000, 'none', -60000, 24, 1],
  ['referral', 'expected', 638018, 77000, '1/6', 811881, 142375, 29488, 0, 0, 75000, 0, 185592, 110000, '4/1', 0, 10, 0],
  ['referral', 'careful', 362314, 77000, '1/10', 464076, 82875, 16886, 0, 0, 75000, 0, 57081, 110000, '5/1', 0, 9, 1],
  // Year 1: €120,000 revenue, new to us 30% × 90% = 27%: €87,600 we'd have anyway, €4,860 to deliver, €3,600 referral
  // fee, so €23,940 from new revenue; plus the €2,500 partner fee, less €6,750 sales (1.35 deals × €5,000), €270 level 2
  // support, plus €1,095 level 1 support taken over, less €3,650 services Clearpath delivers instead of us and €23,000
  // our costs: −€6,135.
  ['services', 'expected', 698758, 83000, '2/2', 819103, 101250, 8560, 34715, -54750, 80000, 0, 598040, 320000, '3/11', 0, 52, 1],
  ['services', 'careful', 423055, 83000, '2/4', 491462, 60750, 5136, 20829, -32850, 80000, 0, 230824, 320000, '4/9', 0, 51, 1],
  // 10% of Kessler IT's services comes to Secura: €90,000 over five years (€6,000 in year 1).
  ['onprem', 'expected', 715260, 215000, '2/2', 766272, 0, 0, 11989, -18000, 0, 80000, -87840, 360000, 'none', -120000, 39, 8],
  ['onprem', 'careful', 371914, 215000, '3/1', 456675, 0, 0, 7039, -10800, 0, 80000, -198817, 360000, 'none', -120000, 40, 12],
  // Now a Value Added Reseller, which brings every lead and closes: more of the revenue is new to us, and the margin
  // goes to the partner on every deal.
  ['hardware', 'expected', 175386, 120000, '3/2', 304455, 0, 11476, 906, 1500, 0, 0, -128317, 230000, 'none', 0, 74, 0],
  ['hardware', 'careful', 56947, 120000, '4/6', 182334, 0, 6826, 539, 900, 0, 0, -169293, 230000, 'none', 0, 83, 0],
];

const build = (key: ExampleKey, scenario: Scenario = 'expected'): BusinessCase => ({ ...structuredClone(EXAMPLES[key].case), scenario });
const run = (c: BusinessCase) => simulateOurCase(c, simulateCase(c));
const r0 = Math.round;
const sumOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

describe('simulateOurCase, Preferred off', () => {
  it.each(rows)('%s / %s', (key, sc, net, invest, payback, newRev, sales, support, taken, services, eff, churn, aNet, aInvest, aPay, nothing, share, assumption) => {
    const r = run(build(key, sc));
    expect(r0(r.withPartner.total)).toBe(net);
    expect(r0(r.withPartner.invest)).toBe(invest);
    expect(r.withPartner.payback).toEqual(pb(payback));
    expect(r0(sumOf(r.years.map((y) => y.fromNewRevenue)))).toBe(newRev);
    expect(r0(sumOf(r.years.map((y) => y.sales)))).toBe(sales);
    expect(r0(sumOf(r.years.map((y) => y.support)))).toBe(support);
    expect(r0(sumOf(r.years.map((y) => y.supportTaken)))).toBe(taken);
    expect(r0(sumOf(r.years.map((y) => y.services)))).toBe(services);
    expect(r0(sumOf(r.years.map((y) => y.efficiency)))).toBe(eff);
    expect(r0(sumOf(r.years.map((y) => y.churn)))).toBe(churn);
    expect(r0(r.alone.total)).toBe(aNet);
    expect(r0(r.alone.invest)).toBe(aInvest);
    expect(r.alone.payback).toEqual(pb(aPay));
    expect(r0(r.nothing.total)).toBe(nothing);
    if (share === 'theirsOnly') expect(r.verdict).toEqual({ kind: 'theirsOnly' });
    else {
      expect(r.verdict.kind).toBe('both');
      if (r.verdict.kind === 'both') expect(r0(r.verdict.partnerShare)).toBe(share);
    }
    expect(r0(r.sure.shares.assumption)).toBe(assumption);
    expect(r.best).toBe('partner');
    expect(r.years[4]!.netSoFar).toBeCloseTo(r.withPartner.total);
  });

  it('warns thin and generous, none for saas', () => {
    const v = (k: ExampleKey) => run(build(k)).verdict;
    expect(v('referral')).toMatchObject({ kind: 'both', warn: 'thin' });
    expect(v('hardware')).toMatchObject({ kind: 'both', warn: 'generous' });
    expect(v('saas')).toMatchObject({ kind: 'both', warn: null });
  });

  it('warns only below 15% and above 70%: exactly 15% and exactly 70% are fine', () => {
    const c = build('saas');
    const partner = simulateCase(c);
    const ours = (profit: number) => simulateOurCase(c, { ...partner, profit });
    const V = ours(partner.profit).withPartner.total;
    const share = (P: number) => (P / (P + V)) * 100;
    /** The smallest partner profit whose share is at least `target`, and the one just under it, found by halving. */
    const around = (target: number) => {
      let [under, at] = [0, V * 100];
      for (;;) {
        const mid = (under + at) / 2;
        if (mid === under || mid === at) return { under, at };
        if (share(mid) < target) under = mid;
        else at = mid;
      }
    };
    const fifteen = around(15);
    expect(ours(fifteen.at).verdict).toEqual({ kind: 'both', partnerShare: 15, warn: null });
    expect(ours(fifteen.under).verdict).toMatchObject({ kind: 'both', warn: 'thin' });
    const seventy = around(70);
    expect(ours(seventy.at).verdict).toEqual({ kind: 'both', partnerShare: 70, warn: null });
    const over = seventy.at * (1 + 1e-9);
    expect(share(over)).toBeGreaterThan(70);
    expect(ours(over).verdict).toMatchObject({ kind: 'both', warn: 'generous' });
  });
});

describe('simulateOurCase, Preferred on (saas / expected)', () => {
  const table: [string, Partial<PreferredConditions>, number, number, string, number, number, number][] = [
    ['deals', { rule: 'deals', deals: 8 }, 1215643, 258000, '2/2', 1342208, 36, 2],
    ['revenue', { rule: 'revenue', revenue: 250000 }, 1158091, 266000, '2/2', 1292656, 38, 2],
    ['set year 2', { rule: 'year', year: 2 }, 1125411, 274000, '2/3', 1267976, 39, 3],
  ];
  it.each(table)('%s', (_n, rule, net, invest, payback, newRev, share, assumption) => {
    const c = build('saas');
    c.offer.preferred = { ...c.offer.preferred, on: true, ...rule };
    const r = run(c);
    expect(r0(r.withPartner.total)).toBe(net);
    expect(r0(r.withPartner.invest)).toBe(invest);
    expect(r.withPartner.payback).toEqual(pb(payback));
    expect(r0(sumOf(r.years.map((y) => y.fromNewRevenue)))).toBe(newRev);
    if (r.verdict.kind === 'both') expect(r0(r.verdict.partnerShare)).toBe(share);
    expect(r0(r.sure.shares.assumption)).toBe(assumption);
    expect(r0(r.alone.total)).toBe(233259);
    expect(r0(r.nothing.total)).toBe(-60000);
  });
});

describe('simulateOurCase, the share of the partner’s services and the partner fee', () => {
  const withType = (c: BusinessCase, patch: (t: BusinessCase['offer']['types'][number]) => void): BusinessCase => {
    const next = structuredClone(c);
    patch(next.offer.types.find((t) => t.id === next.typeId)!);
    return next;
  };

  it('counts both as income with the partner, year by year, and adds them to the net value', () => {
    const c = withType(build('services'), (t) => { t.registered.servicesShare = 20; });
    const none = run(withType(c, (t) => { t.registered.servicesShare = 0; t.fee = 0; }));
    const partner = simulateCase(c);
    const r = run(c);
    r.years.forEach((y, i) => {
      expect(y.shareOfServices).toBeCloseTo(partner.years[i]!.servicesToVendor);
      expect(y.partnerFee).toBe(2500);
      expect(y.net).toBeCloseTo(none.years[i]!.net + y.shareOfServices + 2500);
    });
    // Year 1: 20% of Clearpath's €120,000 of services.
    expect(r.years[0]!.shareOfServices).toBe(24000);
    expect(r.withPartner.total).toBeCloseTo(none.withPartner.total + partner.servicesToVendor + 12500);
  });

  it('leaves them out of going alone', () => {
    const c = withType(build('services'), (t) => { t.registered.servicesShare = 20; });
    const none = run(withType(c, (t) => { t.registered.servicesShare = 0; t.fee = 0; }));
    expect(run(c).alone).toEqual(none.alone);
  });

  it('lists them in How sure: the share with the deal plan’s source, the fee with Finance', () => {
    const c = withType(build('services'), (t) => { t.registered.servicesShare = 20; });
    c.ours.dealsSource = 'sales';
    const r = run(c);
    const line = (key: string) => r.sure.lines.find((l) => l.key === key);
    expect(line('servicesShare')).toEqual({ key: 'servicesShare', label: 'Share of the partner’s services', amount: simulateCase(c).servicesToVendor, source: 'sales' });
    expect(line('fee')).toEqual({ key: 'fee', label: 'Partner fee from the partner', amount: 12500, source: 'finance' });
  });

  it('leaves both lines out when they are zero', () => {
    const r = run(build('saas'));
    expect(r.sure.lines.map((l) => l.key)).not.toContain('servicesShare');
    expect(r.sure.lines.map((l) => l.key)).not.toContain('fee');
    expect(r.years.every((y) => y.shareOfServices === 0 && y.partnerFee === 0)).toBe(true);
  });
});

describe('shiftDeals', () => {
  it('moves a plan later by months', () => {
    expect(shiftDeals([4, 8, 12, 16, 20], 9)).toEqual([1, 5, 9, 13, 17]);
    expect(shiftDeals([4, 8, 12, 16, 20], 0)).toEqual([4, 8, 12, 16, 20]);
  });
});

describe('sure lines', () => {
  it('are sorted by absolute amount, with no zero lines, and shares sum to 100', () => {
    const r = run(build('saas'));
    const abs = r.sure.lines.map((l) => Math.abs(l.amount));
    expect(abs).toEqual([...abs].sort((a, b) => b - a));
    expect(r.sure.lines.every((l) => r0(l.amount) !== 0)).toBe(true);
    expect(r.sure.lines[0]!.key).toBe('newRevenue');
    expect(sumOf(Object.values(r.sure.shares))).toBeCloseTo(100);
  });
});

describe('an empty case', () => {
  it('stays finite with no investment', () => {
    const c = build('saas');
    c.deals = [0, 0, 0, 0, 0];
    c.costs = [];
    const o = c.ours;
    o.figures.margin = 0;
    o.costs = [];
    o.anyway = 0;
    o.figures.serve = { ...o.figures.serve, find: 0, close: 0, support1: 0, support2: 0, servicesCost: 0, servicesCharge: 0 };
    o.efficiency.on = false;
    o.churn.on = false;
    o.risk.amount = 0;
    o.alone = { ...o.alone, setup: 0, fixed: 0, costs: [], deals: [0, 0, 0, 0, 0] };
    const r = run(c);
    expect(r.roi).toBeNull();
    expect(r.withPartner.payback).toBeNull();
    expect(r.sure.lines).toEqual([]);
    for (const s of CASE_SOURCES) expect(r.sure.shares[s]).toBe(0);
    const nums = [r.withPartner.total, r.alone.total, r.nothing.total, ...r.years.flatMap((y) => [y.net, y.netSoFar])];
    expect(nums.every(Number.isFinite)).toBe(true);
  });
});

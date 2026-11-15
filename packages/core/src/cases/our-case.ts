import type { CaseResult } from './simulate';
import { SCENARIO_FACTOR, CASE_SOURCES, leadShare } from './types';
import type { BusinessCase, OurCostLine, Reason, CaseSource } from './types';

export interface OurYear {
  year: number;
  revenue: number;
  anyway: number;
  deliver: number;
  share: number;
  fromNewRevenue: number;
  /** Our share of the partner's services (the partner case's `servicesToVendor`). */
  shareOfServices: number;
  /** The partner fee the partner pays us. */
  partnerFee: number;
  sales: number;
  support: number;
  supportTaken: number;
  services: number;
  efficiency: number;
  churn: number;
  costs: number;
  net: number;
  netSoFar: number;
}

export interface OptionYear {
  year: number;
  costs: number;
  net: number;
  netSoFar: number;
}

export interface OptionResult {
  years: OptionYear[];
  total: number;
  invest: number;
  payback: { year: number; month: number } | null;
}

export type Verdict =
  | { kind: 'both'; partnerShare: number; warn: 'thin' | 'generous' | null }
  | { kind: 'oursOnly' | 'theirsOnly' | 'neither' };

export interface SureLine {
  key: string;
  label: string;
  amount: number;
  source: CaseSource;
}

export interface Sure {
  lines: SureLine[];
  shares: Record<CaseSource, number>;
}

export interface OurResult {
  years: OurYear[];
  withPartner: OptionResult;
  alone: OptionResult & { deals: number[] };
  nothing: OptionResult;
  roi: number | null;
  verdict: Verdict;
  best: 'partner' | 'alone' | 'nothing';
  sure: Sure;
}

const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

/** Moves a deal plan later by some months; a year that starts late gets only part of its deals. */
export function shiftDeals(deals: number[], months: number): number[] {
  const at = (j: number) => (j >= 0 && j < deals.length ? deals[j]! : 0);
  return deals.map((_, i) => {
    const t = i - months / 12;
    const k = Math.floor(t);
    const f = t - k;
    return at(k) * (1 - f) + at(k + 1) * f;
  });
}

/** Start costs are paid on day one; everything else comes in evenly over the year. */
function paybackOf(nets: number[], start: number): OptionResult['payback'] {
  let pos = -start;
  for (let i = 0; i < nets.length; i++) {
    const gain = i === 0 ? nets[0]! + start : nets[i]!;
    const end = pos + gain;
    if (end >= 0 && gain > 0) return { year: i + 1, month: Math.min(12, Math.max(1, Math.ceil((12 * -pos) / gain))) };
    pos = end;
  }
  return null;
}

function finish(rows: { costs: number; net: number }[], start: number): OptionResult {
  let so = 0;
  const years = rows.map((r, i) => {
    so += r.net;
    return { year: i + 1, costs: r.costs, net: r.net, netSoFar: so };
  });
  return { years, total: so, invest: sum(rows.map((r) => r.costs)), payback: paybackOf(rows.map((r) => r.net), start) };
}

const lines = (list: OurCostLine[], when: OurCostLine['when']) => sum(list.filter((l) => l.when === when).map((l) => l.amount));

function reasonValue(r: Reason, year: number, alone: boolean, detail: () => number): number {
  if (!r.on || year < r.from || (alone && !r.alone)) return 0;
  return r.mode === 'simple' ? r.simple : detail();
}

export function simulateOurCase(c: BusinessCase, partner: CaseResult): OurResult {
  const o = c.ours;
  const n = partner.years.length;
  const type = c.offer.types.find((t) => t.id === c.typeId);
  if (!type) throw new Error(`Partner type ${c.typeId} is not in the offer`);
  const roles = type.roles;
  const g = o.figures.margin / 100;
  const a = o.anyway / 100;
  const S = o.figures.serve;
  const isNew = leadShare(roles) * (1 - a);
  const start = lines(o.costs, 'start');
  const yearly = lines(o.costs, 'yearly');
  const prefCost = c.offer.preferred.on ? lines(o.costs, 'preferred') : 0;
  const l1 = roles.support !== 'none';
  const l2 = roles.support === 'level12';
  const ourSupport = (l1 ? 0 : S.support1) + (l2 ? 0 : S.support2);
  const theirSupport = (l1 ? S.support1 : 0) + (l2 ? S.support2 : 0);
  const svcNet = S.servicesCharge - S.servicesCost;

  const efficiencyAt = (year: number, alone: boolean) =>
    reasonValue(o.efficiency, year, alone, () => o.efficiency.hours * o.efficiency.rate);
  const churnAt = (year: number, alone: boolean) =>
    reasonValue(o.churn, year, alone, () => (o.churn.customers * Math.max(0, o.churn.now - o.churn.withPartner) / 100) * o.churn.revenue);

  let soFar = 0;
  const years: OurYear[] = partner.years.map((p) => {
    const revenue = p.vendorRevenue;
    const share = p.earnings;
    const anyway = revenue * (1 - isNew);
    const deliver = (revenue - anyway) * (1 - g);
    const fromNewRevenue = revenue - anyway - deliver - share;
    const newDeals = p.deals * isNew;
    const newCustomers = p.customers * isNew;
    const sales = roles.closes ? 0 : newDeals * S.close;
    const support = newCustomers * ourSupport;
    const supportTaken = (p.customers - newCustomers) * theirSupport;
    const services = roles.services ? -(p.deals - newDeals) * svcNet : newDeals * svcNet;
    const efficiency = efficiencyAt(p.year, false);
    const churn = churnAt(p.year, false);
    const shareOfServices = p.servicesToVendor;
    const partnerFee = p.fee;
    const costs = (p.year === 1 ? start : 0) + yearly + (p.tier === 'preferred' ? prefCost : 0);
    const net = fromNewRevenue + shareOfServices + partnerFee - sales - support + supportTaken + services + efficiency + churn - costs;
    soFar += net;
    return {
      year: p.year, revenue, anyway, deliver, share, fromNewRevenue, shareOfServices, partnerFee, sales, support, supportTaken, services,
      efficiency, churn, costs, net, netSoFar: soFar,
    };
  });
  const withPartner = finish(years, start);

  // Alone
  const A = o.alone;
  const plan =
    A.mode === 'simple'
      ? partner.years.map((p) => (p.deals * A.share) / 100)
      : A.deals.map((d) => d * SCENARIO_FACTOR[c.scenario]);
  const deals = shiftDeals(plan, A.delay);
  const aStart = A.mode === 'simple' ? A.setup : lines(A.costs, 'start');
  const aYearly = A.mode === 'simple' ? A.fixed : lines(A.costs, 'yearly');
  const yearlyValue = sum(c.offer.products.filter((p) => p.paid === 'yearly').map((p) => p.price * p.amount));
  const onceValue = sum(c.offer.products.filter((p) => p.paid === 'once').map((p) => p.price * p.amount));
  const renew = c.offer.renewal / 100;
  let customers = 0;
  const aloneRows = deals.map((d, i) => {
    const year = i + 1;
    const renewing = customers * renew;
    customers = renewing + d;
    const rev = d * (yearlyValue + onceValue) + renewing * yearlyValue;
    const costs = (year === 1 ? aStart : 0) + aYearly;
    const net =
      rev * g - d * (S.find + S.close) - customers * (S.support1 + S.support2) + d * svcNet +
      efficiencyAt(year, true) + churnAt(year, true) - costs;
    return { costs, net };
  });
  const alone = { ...finish(aloneRows, aStart), deals };

  // Nothing
  const R = o.risk;
  const nothing = { ...finish(Array.from({ length: n }, (_, i) => ({ costs: 0, net: i + 1 >= R.from ? 0 - R.amount : 0 })), 0), payback: null };

  // Both sides
  const P = partner.profit;
  const V = withPartner.total;
  let verdict: Verdict;
  if (V > 0 && P > 0) {
    const partnerShare = (P / (P + V)) * 100;
    verdict = { kind: 'both', partnerShare, warn: partnerShare < 15 ? 'thin' : partnerShare > 70 ? 'generous' : null };
  } else if (V > 0) verdict = { kind: 'oursOnly' };
  else if (P > 0) verdict = { kind: 'theirsOnly' };
  else verdict = { kind: 'neither' };

  const best: OurResult['best'] =
    withPartner.total >= alone.total && withPartner.total >= nothing.total ? 'partner' : alone.total >= nothing.total ? 'alone' : 'nothing';

  // How sure
  const preferredYears = partner.years.filter((p) => p.tier === 'preferred').length;
  const items: SureLine[] = [{ key: 'newRevenue', label: 'New revenue', amount: sum(years.map((y) => y.fromNewRevenue)), source: o.dealsSource }];
  items.push({ key: 'servicesShare', label: 'Share of the partner’s services', amount: sum(years.map((y) => y.shareOfServices)), source: o.dealsSource });
  items.push({ key: 'fee', label: 'Partner fee from the partner', amount: sum(years.map((y) => y.partnerFee)), source: 'finance' });
  items.push({ key: 'sales', label: "Our sales on the partner's deals", amount: -sum(years.map((y) => y.sales)), source: S.salesSource });
  items.push({ key: 'support', label: 'Support we provide', amount: -sum(years.map((y) => y.support)), source: S.supportSource });
  items.push({ key: 'supportTaken', label: 'Support the partner takes over', amount: sum(years.map((y) => y.supportTaken)), source: S.supportSource });
  items.push({ key: 'services', label: 'Services', amount: sum(years.map((y) => y.services)), source: S.servicesSource });
  for (const l of o.costs) {
    const times = l.when === 'start' ? 1 : l.when === 'preferred' ? (c.offer.preferred.on ? preferredYears : 0) : n;
    items.push({ key: l.id, label: l.name, amount: -l.amount * times, source: l.source });
  }
  if (o.efficiency.on) items.push({ key: 'efficiency', label: 'More efficient', amount: sum(years.map((y) => y.efficiency)), source: o.efficiency.source });
  if (o.churn.on) items.push({ key: 'churn', label: 'Less churn', amount: sum(years.map((y) => y.churn)), source: o.churn.source });
  const list = items.filter((i) => Math.round(i.amount) !== 0).sort((x, y) => Math.abs(y.amount) - Math.abs(x.amount));
  const all = sum(list.map((i) => Math.abs(i.amount)));
  const shares = Object.fromEntries(
    CASE_SOURCES.map((s) => [s, all === 0 ? 0 : (sum(list.filter((i) => i.source === s).map((i) => Math.abs(i.amount))) / all) * 100]),
  ) as Record<CaseSource, number>;

  return {
    years,
    withPartner,
    alone,
    nothing,
    roi: withPartner.invest === 0 ? null : withPartner.total / withPartner.invest,
    verdict,
    best,
    sure: { lines: list, shares },
  };
}


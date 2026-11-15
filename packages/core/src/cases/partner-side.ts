import { simulateCase, type CaseResult } from './simulate';
import type { BusinessCase, CaseRates, Roles, Scenario, Tier } from './types';
import type { Currency } from '../programs/types';

/**
 * What the partner may see of a case (BC v2 section 9). Built field by field from an allow-list, never by spreading
 * the case, so a field added to a case later is not shown until it is added here on purpose. It holds nothing of ours,
 * no ids and no notes.
 */
export interface PartnerCaseView {
  company: string;
  partner: string;
  currency: Currency;
  /** The share of customers who renew each year, in percent. */
  renewal: number;
  levels: { registered: string; preferred: string };
  products: Array<{ name: string; paid: 'yearly' | 'once'; price: number; per: 'user' | 'site' | 'account'; amount: number }>;
  preferred: { on: boolean; rule: 'deals' | 'revenue' | 'year'; deals: number; revenue: number; year: 2 | 3 | 4 | 5 };
  type: { name: string; roles: Roles; registered: CaseRates; preferred: CaseRates; fee: number };
  startsAs: Tier;
  deals: [number, number, number, number, number];
  scenario: Scenario;
  services: { implementation: number; managed: number; other: number; serviceProfit: number; supportCost: number };
  costs: Array<{ name: string; when: 'start' | 'yearly' | 'preferred'; amount: number }>;
  benefits: string[];
  result: CaseResult;
}

const rates = (r: CaseRates): CaseRates => ({ first: r.first, renewal: r.renewal, once: r.once, servicesShare: r.servicesShare });

export function partnerSide(c: BusinessCase, company: string): PartnerCaseView {
  const t = c.offer.types.find((x) => x.id === c.typeId)!;
  const o = c.offer;
  return {
    company,
    partner: c.partner,
    currency: o.currency,
    renewal: o.renewal,
    levels: { registered: o.levels.registered, preferred: o.levels.preferred },
    products: o.products.map((p) => ({ name: p.name, paid: p.paid, price: p.price, per: p.per, amount: p.amount })),
    preferred: { on: o.preferred.on, rule: o.preferred.rule, deals: o.preferred.deals, revenue: o.preferred.revenue, year: o.preferred.year },
    type: {
      name: t.name,
      roles: { lead: t.roles.lead, closes: t.roles.closes, support: t.roles.support, services: t.roles.services },
      registered: rates(t.registered),
      preferred: rates(t.preferred),
      fee: t.fee,
    },
    startsAs: c.startsAs,
    deals: [c.deals[0], c.deals[1], c.deals[2], c.deals[3], c.deals[4]],
    scenario: c.scenario,
    services: { implementation: c.implementation, managed: c.managed, other: c.other, serviceProfit: c.serviceProfit, supportCost: c.supportCost },
    costs: c.costs.map((x) => ({ name: x.name, when: x.when, amount: x.amount })),
    benefits: [...c.benefits],
    result: simulateCase(c),
  };
}

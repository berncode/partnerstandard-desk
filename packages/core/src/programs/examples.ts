/* Test fixtures only: prototype 2's example(), without its Affiliate program. */
import { newCompanyFacts, newProgram } from './new-program';
import type { CompanyFacts, Program } from './types';

/** The facts, the company's name (kept in Settings) and its programs. */
export type ExampleCompany<P extends Program[] = Program[]> = CompanyFacts & { name: string; programs: P };

export function northwind(): ExampleCompany<[Program, Program]> {
  const c: CompanyFacts = {
    ...newCompanyFacts('co_northwind000001'),
    currency: 'EUR', yearly: 18000, once: 6000, renew: 90, spend: 2600000, revenue: 6500000,
    rules: {
      protect: 90, extend: 30, answer: 48, conflict: 'first', paidInFull: true,
      ownerNote: 'Partner-sourced customers stay with the partner for renewals and new products.',
      handover: 'Your sales team joins after the partner registers the deal, for pricing and the contract. The partner stays in every meeting.',
    },
  };
  const r = newProgram('reseller', c, { id: 'pr_northwindres001', companyName: 'Northwind Security' });
  Object.assign(r, {
    lead: 'Anna Berger, Head of Partnerships',
    goals: 'Reach mid-sized companies in Germany and Austria that we cannot reach with our own sales team.',
    description: 'For IT resellers who sell security software to mid-sized companies and want a product their customers renew every year.',
    ipp: 'IT reseller, 20 to 200 people, at least two sales people selling security, existing customers in manufacturing.',
    icp: 'Mid-sized manufacturer, 200 to 2,000 employees, regulated or handling sensitive data.',
    kpis: 'New customers per partner, revenue through partners, share of active partners.',
    enablement: 'Sales training, technical certification, playbook, demo account.',
    tools: 'HubSpot for deal registration, partner portal.',
    pilots: 'Two current resellers: Alpen IT and Nordlicht Systems', publish: '2027-01-15',
    why: ['A security product your customers ask for, which opens doors to new accounts.', 'Leads from us in your region.', 'Certification that makes your team the security experts your customers trust.', 'Installation and support work around every customer.'],
  });
  const s = newProgram('solution', c, { id: 'pr_northwindsi0001', companyName: 'Northwind Security' });
  Object.assign(s, {
    name: 'Northwind Security Consulting Partner Program', lead: 'Anna Berger, Head of Partnerships',
    goals: 'Get more customers live faster and keep them happy, so they renew.',
    description: 'For consultancies and integrators who implement and run security projects for their clients.',
    ipp: 'Consultancy with a security practice and at least two consultants who can be certified.',
    icp: 'Same as our customers: mid-sized manufacturers.',
    kpis: 'Implementations completed, customer satisfaction, customers who renew.',
    enablement: 'Implementation training and certification, technical documentation.', tools: 'Partner portal.',
    why: ['An implementation project with every new customer.', 'Certified consultants your clients can rely on.', 'Early access to new features, so you can plan projects ahead.'],
  });
  return { ...c, name: 'Northwind Security', programs: [r, s] };
}

export function brightpage(): ExampleCompany<[Program]> {
  const c: CompanyFacts = {
    ...newCompanyFacts('co_brightpage00001'),
    currency: 'USD', yearly: 4800, once: 0, renew: 85, spend: null, revenue: null,
    rules: {
      protect: 60, extend: 30, answer: 48, conflict: 'first', paidInFull: true, ownerNote: '',
      handover: 'Our sales team takes over after the introduction call. The partner is kept informed until the contract is signed.',
    },
  };
  const ref = newProgram('referral', c, { id: 'pr_brightpageref01', companyName: 'Brightpage' });
  Object.assign(ref, {
    lead: 'Sam Ortiz, Partnerships', goals: 'Win customers through agencies that already advise marketing teams.',
    description: 'For marketing agencies whose clients publish brochures and catalogs.',
    ipp: 'Marketing agency with publishing clients.', icp: 'Marketing team at a company with 50 to 500 employees.',
    pref: ['toplisting'], why: ['A tool your clients thank you for recommending.', 'Your agency listed in our partner directory.'],
    run: { manager: 30000, funds: 0, training: 3000, deals: 12 },
  });
  ref.money.rates = { reg: [10, 0, 0], pref: [10, 0, 0] };
  ref.money.pattern = 'oneoff';
  return { ...c, name: 'Brightpage', programs: [ref] };
}

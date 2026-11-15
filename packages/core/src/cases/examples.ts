import type { PartnerType } from '@partner-desk/method';
import type {
  Alone, BusinessCase, Churn, CostLine, Efficiency, Figures, CaseOffer, OurCase, OurCostLine, CaseType, ProductLine,
  CaseRates, Reason, Roles, CaseSource, StrategicReason, TermNote,
} from './types';

const rates = ([first, renewal, once]: [number, number, number]): CaseRates => ({ first, renewal, once, servicesShare: 0 });

/** The four starting types: no share of the partner's services, no partner fee. */
export const DEFAULT_TYPES: CaseType[] = [
  {
    id: 'type_referral', name: 'Referral',
    roles: { lead: 100, closes: false, support: 'none', services: false },
    registered: rates([15, 0, 10]), preferred: rates([20, 5, 10]), fee: 0,
  },
  {
    id: 'type_reseller', name: 'Reseller',
    roles: { lead: 100, closes: true, support: 'level1', services: false },
    registered: rates([20, 20, 15]), preferred: rates([30, 30, 20]), fee: 0,
  },
  {
    id: 'type_service', name: 'Service partner',
    roles: { lead: 30, closes: false, support: 'none', services: true },
    registered: rates([10, 0, 0]), preferred: rates([15, 5, 0]), fee: 0,
  },
  {
    id: 'type_var', name: 'Value Added Reseller',
    roles: { lead: 100, closes: true, support: 'level12', services: true },
    registered: rates([25, 20, 20]), preferred: rates([35, 25, 25]), fee: 0,
  },
];

type Entry = { label: string; case: BusinessCase };

export const EXAMPLE_KEYS = ['saas', 'referral', 'services', 'onprem', 'hardware'] as const;
export type ExampleKey = (typeof EXAMPLE_KEYS)[number];

/** The PartnerStandard Desk type each starting type stands for in the examples. */
const PARTNER_TYPE_OF: Record<string, PartnerType> = {
  type_referral: 'referral', type_reseller: 'reseller', type_service: 'system-integrator', type_var: 'var',
};

const UPDATED_AT = '2026-10-25T09:00:00.000Z';
const EXAMPLE_BENEFITS = ['New customers', 'Stronger offering', 'Recurring revenue'];

const products = (list: Omit<ProductLine, 'id'>[]): ProductLine[] =>
  list.map((p, i) => ({ id: `prod_${i + 1}`, ...p }));
const costs = (list: Omit<CostLine, 'id'>[]): CostLine[] =>
  list.map((c, i) => ({ id: `cost_${i + 1}`, ...c }));
const ourCosts = (prefix: string, list: Omit<OurCostLine, 'id'>[]): OurCostLine[] =>
  list.map((c, i) => ({ id: `${prefix}_${i + 1}`, ...c }));

type Five = [number, number, number, number, number];
type Driver<T extends Reason> = Omit<T, 'on' | 'mode' | 'from' | 'source' | 'note' | 'alone'> & Partial<Pick<T, 'on' | 'mode' | 'from' | 'source' | 'note' | 'alone'>>;
const driver = <T extends Reason>(o: Driver<T>) =>
  ({ on: false, mode: 'simple', from: 1, source: 'assumption', note: '', alone: false, ...o }) as unknown as T;

interface OursInput {
  margin: number;
  marginSource: CaseSource;
  serve: Figures['serve'];
  anyway: number;
  anywaySource: CaseSource;
  dealsSource: CaseSource;
  costs: Omit<OurCostLine, 'id'>[];
  efficiency: Efficiency;
  churn: Churn;
  strategic: Omit<StrategicReason, 'id'>[];
  alone: Omit<Alone, 'costs'> & { costs: Omit<OurCostLine, 'id'>[] };
  risk: OurCase['risk'];
  ask: string;
}

interface ExampleInput {
  offer: {
    company: string;
    renewal: number;
    prefDeals: number;
    currency: CaseOffer['currency'];
    products: Omit<ProductLine, 'id'>[];
    /** One type of this example's offer, changed: its roles, its share of the partner's services (both tiers), its fee. */
    type?: { typeId: string; roles?: Partial<Roles>; servicesShare?: number; fee?: number };
  };
  partner: {
    name: string;
    typeId: string;
    deals: Five;
    implementation: number;
    managed: number;
    other: number;
    serviceProfit: number;
    supportCost: number;
    costs: Omit<CostLine, 'id'>[];
  };
  ours: OursInput;
}

function example(
  key: ExampleKey,
  label: string,
  { offer: o, partner: c, ours: i }: ExampleInput,
): [ExampleKey, Entry] {
  const makeOffer = (): CaseOffer => {
    const types = DEFAULT_TYPES.map((t) => structuredClone(t));
    if (o.type) {
      const { typeId, roles, servicesShare, fee } = o.type;
      const t = types.find((x) => x.id === typeId)!;
      t.roles = { ...t.roles, ...roles };
      if (servicesShare !== undefined) {
        t.registered.servicesShare = servicesShare;
        t.preferred.servicesShare = servicesShare;
      }
      if (fee !== undefined) t.fee = fee;
    }
    return {
      levels: { registered: 'Registered', preferred: 'Preferred' },
      company: o.company,
      currency: o.currency,
      renewal: o.renewal,
      preferred: { on: false, rule: 'deals', deals: o.prefDeals, revenue: 250000, year: 2 },
      products: products(o.products),
      // A case holds only its own partner type.
      types: types.filter((t) => t.id === c.typeId),
    };
  };
  const makeFigures = (): Figures => ({
    margin: i.margin,
    marginSource: i.marginSource,
    serve: { ...i.serve },
  });
  const ours = (): OurCase => ({
    figures: makeFigures(),
    costs: ourCosts('ourcost', i.costs),
    anyway: i.anyway,
    anywaySource: i.anywaySource,
    dealsSource: i.dealsSource,
    efficiency: structuredClone(i.efficiency),
    churn: structuredClone(i.churn),
    strategic: i.strategic.map((s, n) => ({ id: `reason_${n + 1}`, ...s })),
    alone: { ...i.alone, deals: [...i.alone.deals] as Five, costs: ourCosts('alonecost', i.alone.costs) },
    risk: { ...i.risk },
    recommendation: '',
    ask: i.ask,
    preparedBy: '',
  });
  return [
    key,
    {
      label,
      case: {
        id: `case_${key}`,
        companyId: 'co_example',
        partnerId: 'pt_example',
        partnerType: PARTNER_TYPE_OF[c.typeId]!,
        programId: null,
        title: c.name,
        createdAt: UPDATED_AT,
        stageWhenMade: 'growth',
        recalculatedAt: null,
        notes: [] as TermNote[],
        partner: c.name,
        typeId: c.typeId,
        startsAs: 'registered',
        deals: c.deals,
        scenario: 'expected',
        implementation: c.implementation,
        managed: c.managed,
        other: c.other,
        serviceProfit: c.serviceProfit,
        supportCost: c.supportCost,
        costs: costs(c.costs),
        benefits: [...EXAMPLE_BENEFITS],
        offer: makeOffer(),
        ours: ours(),
        shared: null,
        updatedAt: UPDATED_AT,
      },
    },
  ];
}

export const EXAMPLES: Record<ExampleKey, Entry> = Object.fromEntries([
  example('saas', 'Software, sold by resellers', {
    offer: {
      company: 'Acme', renewal: 90, prefDeals: 8, currency: 'EUR',
      products: [
        { name: 'Platform, Pro edition', paid: 'yearly', price: 600, per: 'user', amount: 40 },
        { name: 'Onboarding package', paid: 'once', price: 4000, per: 'account', amount: 1 },
      ],
    },
    partner: {
      name: 'Northwind', typeId: 'type_reseller', deals: [3, 7, 11, 15, 19],
      implementation: 12000, managed: 400, other: 2000, serviceProfit: 35, supportCost: 300,
      costs: [
        { name: 'Sales and technical training', when: 'start', amount: 8000 },
        { name: 'Certification', when: 'start', amount: 4000 },
        { name: 'Sales time for the first deals', when: 'start', amount: 13000 },
        { name: 'Enablement and refreshers', when: 'yearly', amount: 3000 },
        { name: 'Events and marketing', when: 'yearly', amount: 5000 },
        { name: 'Extra certified consultants', when: 'preferred', amount: 6000 },
      ],
    },
    ours: {
      margin: 80, marginSource: 'finance', anyway: 10, anywaySource: 'assumption', dealsSource: 'partner',
      serve: {
        find: 3000, close: 6000, salesSource: 'sales', support1: 300, support2: 250, supportSource: 'finance',
        servicesCost: 0, servicesCharge: 0, servicesSource: 'finance',
      },
      costs: [
        { name: 'Partner manager time', when: 'yearly', amount: 30000, source: 'finance' },
        { name: 'Onboarding and enablement', when: 'start', amount: 15000, source: 'assumption' },
        { name: 'Certification vouchers', when: 'start', amount: 3000, source: 'finance' },
        { name: 'Co-marketing budget (MDF)', when: 'yearly', amount: 10000, source: 'finance' },
        { name: 'Free licenses for the partner’s own use', when: 'yearly', amount: 4800, source: 'finance' },
        { name: 'Dedicated partner support', when: 'preferred', amount: 8000, source: 'assumption' },
      ],
      efficiency: driver<Efficiency>({ simple: 10000, hours: 200, rate: 80 }),
      churn: driver<Churn>({
        on: true, mode: 'detailed', from: 2, source: 'finance',
        note: 'Finance, 2025: customers with a local partner renew more often',
        simple: 30000, customers: 40, revenue: 24000, now: 12, withPartner: 8,
      }),
      strategic: [
        { text: 'Present in the Nordics before competitors arrive', weight: 'high', alone: true },
        { text: 'Northwind’s references with retail customers', weight: 'medium', alone: false },
      ],
      alone: {
        mode: 'simple', share: 60, delay: 9, setup: 40000, fixed: 90000, source: 'sales', deals: [1, 4, 7, 10, 12],
        costs: [
          { name: 'Team lead and office in the region', when: 'yearly', amount: 90000, source: 'finance' },
          { name: 'Market entry and set-up', when: 'start', amount: 40000, source: 'assumption' },
        ],
      },
      risk: { amount: 20000, from: 3, source: 'assumption', why: 'A competitor’s partner starts winning our renewals in the region' },
      ask: 'About 30% of a partner manager’s time for Northwind.',
    },
  }),
  example('referral', 'Software, leads from referral partners', {
    offer: {
      company: 'Brightdesk', renewal: 88, prefDeals: 10, currency: 'USD',
      products: [{ name: 'Business subscription', paid: 'yearly', price: 360, per: 'user', amount: 25 }],
    },
    partner: {
      name: 'Lumen Consulting', typeId: 'type_referral', deals: [4, 9, 14, 18, 22],
      implementation: 4000, managed: 0, other: 0, serviceProfit: 40, supportCost: 0,
      costs: [
        { name: 'Product training', when: 'start', amount: 2000 },
        { name: 'Sales time', when: 'start', amount: 4000 },
        { name: 'Events', when: 'yearly', amount: 2000 },
      ],
    },
    ours: {
      margin: 85, marginSource: 'finance', anyway: 15, anywaySource: 'sales', dealsSource: 'partner',
      serve: {
        find: 1500, close: 2500, salesSource: 'sales', support1: 150, support2: 100, supportSource: 'finance',
        servicesCost: 0, servicesCharge: 0, servicesSource: 'finance',
      },
      costs: [
        { name: 'Partner manager time', when: 'yearly', amount: 12000, source: 'finance' },
        { name: 'Onboarding', when: 'start', amount: 5000, source: 'assumption' },
        { name: 'Referral tracking tool', when: 'yearly', amount: 2400, source: 'finance' },
      ],
      efficiency: driver<Efficiency>({
        on: true, source: 'sales', note: 'Lumen runs the onboarding workshops our team runs today',
        simple: 15000, hours: 180, rate: 85,
      }),
      churn: driver<Churn>({ from: 2, simple: 10000, customers: 50, revenue: 9000, now: 10, withPartner: 7 }),
      strategic: [{ text: 'Access to Lumen’s clients in professional services', weight: 'medium', alone: false }],
      alone: {
        mode: 'simple', share: 50, delay: 6, setup: 10000, fixed: 20000, source: 'sales', deals: [2, 5, 8, 10, 12],
        costs: [{ name: 'Marketing for the segment', when: 'yearly', amount: 20000, source: 'finance' }],
      },
      risk: { amount: 0, from: 3, source: 'assumption', why: '' },
      ask: '',
    },
  }),
  example('services', 'Software you sell, partners deliver the services', {
    offer: {
      company: 'Cloudline', renewal: 90, prefDeals: 10, currency: 'EUR',
      products: [{ name: 'Platform subscription', paid: 'yearly', price: 480, per: 'user', amount: 50 }],
      type: { typeId: 'type_service', roles: { support: 'level1' }, fee: 2500 },
    },
    partner: {
      name: 'Clearpath Consulting', typeId: 'type_service', deals: [5, 10, 15, 20, 25],
      implementation: 15000, managed: 500, other: 3000, serviceProfit: 35, supportCost: 250,
      costs: [
        { name: 'Certification', when: 'start', amount: 4000 },
        { name: 'Implementation training', when: 'start', amount: 6000 },
        { name: 'Refreshers', when: 'yearly', amount: 2000 },
        { name: 'Marketing', when: 'yearly', amount: 3000 },
      ],
    },
    ours: {
      margin: 85, marginSource: 'finance', anyway: 10, anywaySource: 'assumption', dealsSource: 'partner',
      serve: {
        find: 2000, close: 5000, salesSource: 'sales', support1: 300, support2: 200, supportSource: 'finance',
        servicesCost: 9000, servicesCharge: 10000, servicesSource: 'finance',
      },
      costs: [
        { name: 'Partner manager time', when: 'yearly', amount: 15000, source: 'finance' },
        { name: 'Partner onboarding', when: 'start', amount: 8000, source: 'assumption' },
      ],
      efficiency: driver<Efficiency>({
        on: true, from: 2, source: 'sales', note: 'Clearpath takes over implementations our consultants do today',
        simple: 20000, hours: 250, rate: 80,
      }),
      churn: driver<Churn>({ from: 2, simple: 0, customers: 50, revenue: 24000, now: 10, withPartner: 8 }),
      strategic: [{ text: 'Implementation capacity for larger customers', weight: 'high', alone: false }],
      alone: {
        mode: 'simple', share: 50, delay: 9, setup: 20000, fixed: 60000, source: 'assumption', deals: [1, 4, 7, 10, 13],
        costs: [
          { name: 'Implementation consultants', when: 'yearly', amount: 60000, source: 'assumption' },
          { name: 'Hiring and set-up', when: 'start', amount: 20000, source: 'assumption' },
        ],
      },
      risk: { amount: 0, from: 3, source: 'assumption', why: '' },
      ask: '',
    },
  }),
  example('onprem', 'Licenses and services, through value added resellers', {
    offer: {
      company: 'Secura', renewal: 95, prefDeals: 5, currency: 'EUR',
      products: [
        { name: 'Perpetual license', paid: 'once', price: 1500, per: 'user', amount: 30 },
        { name: 'Maintenance', paid: 'yearly', price: 300, per: 'user', amount: 30 },
      ],
      type: { typeId: 'type_var', servicesShare: 10 },
    },
    partner: {
      name: 'Kessler IT', typeId: 'type_var', deals: [2, 4, 6, 8, 10],
      implementation: 25000, managed: 0, other: 5000, serviceProfit: 30, supportCost: 600,
      costs: [
        { name: 'Technical training', when: 'start', amount: 10000 },
        { name: 'Certification', when: 'start', amount: 8000 },
        { name: 'Presales time', when: 'start', amount: 12000 },
        { name: 'Recertification', when: 'yearly', amount: 4000 },
        { name: 'Marketing', when: 'yearly', amount: 6000 },
      ],
    },
    ours: {
      margin: 75, marginSource: 'finance', anyway: 20, anywaySource: 'assumption', dealsSource: 'partner',
      serve: {
        find: 5000, close: 9000, salesSource: 'sales', support1: 400, support2: 500, supportSource: 'finance',
        servicesCost: 15000, servicesCharge: 18000, servicesSource: 'finance',
      },
      costs: [
        { name: 'Partner manager time', when: 'yearly', amount: 25000, source: 'finance' },
        { name: 'Technical enablement', when: 'start', amount: 20000, source: 'assumption' },
        { name: 'Demo and test licenses', when: 'yearly', amount: 6000, source: 'finance' },
        { name: 'Joint events', when: 'yearly', amount: 8000, source: 'sales' },
      ],
      efficiency: driver<Efficiency>({ simple: 0, hours: 0, rate: 90 }),
      churn: driver<Churn>({ on: true, from: 2, simple: 20000, customers: 30, revenue: 9000, now: 8, withPartner: 5 }),
      strategic: [{ text: 'Public-sector tenders need a local partner', weight: 'high', alone: false }],
      alone: {
        mode: 'simple', share: 40, delay: 12, setup: 60000, fixed: 60000, source: 'assumption', deals: [0, 2, 3, 4, 5],
        costs: [
          { name: 'Running the local entity', when: 'yearly', amount: 60000, source: 'finance' },
          { name: 'Local entity and set-up', when: 'start', amount: 60000, source: 'assumption' },
        ],
      },
      risk: { amount: 30000, from: 2, source: 'sales', why: 'Tenders we can’t bid on without a local partner' },
      ask: '',
    },
  }),
  example('hardware', 'Hardware with a service subscription', {
    offer: {
      company: 'Sensio', renewal: 85, prefDeals: 10, currency: 'GBP',
      products: [
        { name: 'Sensor kit', paid: 'once', price: 900, per: 'site', amount: 20 },
        { name: 'Service plan Gold', paid: 'yearly', price: 120, per: 'site', amount: 20 },
      ],
      type: { typeId: 'type_var', roles: { support: 'level1' } },
    },
    partner: {
      name: 'FieldOps', typeId: 'type_var', deals: [4, 8, 12, 16, 20],
      implementation: 6000, managed: 250, other: 1500, serviceProfit: 35, supportCost: 200,
      costs: [
        { name: 'Installer training', when: 'start', amount: 6000 },
        { name: 'Certification', when: 'start', amount: 3000 },
        { name: 'Sales time', when: 'start', amount: 6000 },
        { name: 'Refresher training', when: 'yearly', amount: 2000 },
        { name: 'Marketing', when: 'yearly', amount: 3000 },
      ],
    },
    ours: {
      margin: 45, marginSource: 'finance', anyway: 5, anywaySource: 'assumption', dealsSource: 'partner',
      serve: {
        find: 1500, close: 2500, salesSource: 'sales', support1: 150, support2: 100, supportSource: 'finance',
        servicesCost: 2500, servicesCharge: 2000, servicesSource: 'finance',
      },
      costs: [
        { name: 'Partner manager time', when: 'yearly', amount: 20000, source: 'finance' },
        { name: 'Installer training kits', when: 'start', amount: 8000, source: 'finance' },
        { name: 'Spare parts stock at the partner', when: 'start', amount: 12000, source: 'finance' },
      ],
      efficiency: driver<Efficiency>({ simple: 0, hours: 0, rate: 60 }),
      churn: driver<Churn>({ from: 2, simple: 0, customers: 40, revenue: 2400, now: 15, withPartner: 10 }),
      strategic: [{ text: 'Nationwide coverage our competitors don’t have', weight: 'high', alone: false }],
      alone: {
        mode: 'simple', share: 50, delay: 12, setup: 30000, fixed: 40000, source: 'assumption', deals: [0, 3, 6, 9, 12],
        costs: [
          { name: 'Depot and vans', when: 'yearly', amount: 40000, source: 'finance' },
          { name: 'Tools and set-up', when: 'start', amount: 30000, source: 'finance' },
        ],
      },
      risk: { amount: 0, from: 3, source: 'assumption', why: '' },
      ask: '',
    },
  }),
]) as Record<ExampleKey, Entry>;

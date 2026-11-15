// The tables, columns and words of a business case, and turning a case into rows. PartnerStandard Desk keeps one case
// per file, so the Case key column is gone: Offer, Case and Our case are Setting / Value tabs, the lists keep their
// columns. US spelling; the PartnerStandard Desk fields of a case are settings of the Case tab. Our figures and cost
// lines are also Company facts' (format version 2).
import {
  PARTNER_TYPE_LABELS,
  PARTNER_TYPES,
  STAGE_LABELS,
  type PartnerType,
} from '@partner-desk/method';
import type { BusinessCase, CaseOffer, CaseRates, CaseSource, CostLine, Figures, OurCase, OurCostLine, Reason } from '@partner-desk/core';
import type { Cell } from './grid';
import type { Reader, Values } from './program-records';

/* ---------- Tabs and columns ---------- */

export const OFFER_TAB = 'Offer';
export const PRODUCTS_TAB = 'Products';
export const TYPE_TAB = 'Partner type';
export const CASE_TAB = 'Case';
export const COSTS_TAB = 'Costs';
export const OURS_TAB = 'Our case';
export const REASONS_TAB = 'Strategic reasons';
/** Company facts' list of our default cost lines (format version 2). */
export const OUR_COSTS_TAB = 'Our cost lines';

export const DEALS = ['Deals year 1', 'Deals year 2', 'Deals year 3', 'Deals year 4', 'Deals year 5'] as const;
export const CASE_RATES = {
  registered: ['Registered: first year (%)', 'Registered: renewals (%)', 'Registered: one-off (%)', 'Registered: your share of services (%)'],
  preferred: ['Preferred: first year (%)', 'Preferred: renewals (%)', 'Preferred: one-off (%)', 'Preferred: your share of services (%)'],
} as const;
/** What a partner of the type pays the vendor every year. */
export const FEE = 'Partner fee a year';

/** Our figures: settings of Our case, and of Company facts. */
export const FIGURES = {
  margin: 'Gross margin (%)', marginSource: 'Gross margin source',
  find: 'Finding a lead', close: 'Closing a deal', salesSource: 'Sales source',
  support1: 'Support level 1 a year', support2: 'Support level 2 a year', supportSource: 'Support source',
  servicesCost: 'Services: our cost', servicesCharge: 'Services: what we charge', servicesSource: 'Services source',
} as const;

const reasonColumns = <N extends string>(name: N) => ({
  on: name, mode: `${name}: simplified or detailed`, from: `${name}: from year`, source: `${name}: source`, note: `${name}: note`,
  alone: `${name}: also if we go alone`,
}) as const;

export const OURS = {
  anyway: 'Deals won anyway (%)', anywaySource: 'Deals won anyway source', dealsSource: 'Deal plan source',
  recommendation: 'Recommendation', ask: 'Ask', preparedBy: 'Prepared by',
} as const;
export const EFFICIENCY = {
  ...reasonColumns('More efficient'),
  simple: 'More efficient: worth a year', hours: 'More efficient: hours freed a year', rate: 'More efficient: cost per hour',
} as const;
export const CHURN = {
  ...reasonColumns('Less churn'),
  simple: 'Less churn: revenue kept a year', customers: 'Less churn: customers affected', revenue: 'Less churn: revenue per customer a year',
  now: 'Less churn: churn today (%)', withPartner: 'Less churn: churn with the partner (%)',
} as const;
export const ALONE = {
  mode: 'Alone: simplified or detailed', share: 'Alone: deals (% of the plan)', delay: 'Alone: months later',
  setup: 'Alone: set-up cost', fixed: 'Alone: fixed cost a year', source: 'Alone: source',
} as const;
export const ALONE_DEALS = ['Alone: deals year 1', 'Alone: deals year 2', 'Alone: deals year 3', 'Alone: deals year 4', 'Alone: deals year 5'] as const;
export const RISK = {
  amount: "Don't do it: revenue at risk a year", from: "Don't do it: from year", source: "Don't do it: source", why: "Don't do it: why",
} as const;

/** BC's offer settings, and the program's two level names. */
export const OFFER_SETTINGS = [
  'Company', 'Currency', 'Customers who renew (%)', 'Preferred conditions', 'Preferred when', 'Preferred deals a year',
  'Preferred revenue a year', 'Preferred from year', 'Registered level name', 'Preferred level name',
] as const;
export type OfferSetting = (typeof OFFER_SETTINGS)[number];

/** A setting's names before: a case file made before 2026-11-10 keeps "Partner Desk type" (owner, 2026-11-10). */
export const CASE_EARLIER_NAMES: Record<string, readonly string[]> = { 'PartnerStandard Desk type': ['Partner Desk type'] };

/** BC's Cases columns, and what PartnerStandard Desk adds to a case. "Partner type" is the offer type's name, written for people, never read. */
export const CASE_SETTINGS = [
  'Id', 'Title', 'Partner', 'Partner type', 'Partner type id', 'PartnerStandard Desk type', 'Type id', 'Program id', 'Made on',
  'Stage when made', 'Recalculated on', 'Starts as', ...DEALS, 'Scenario', 'Implementation', 'Managed service a month', 'Other sales',
  'Partner profit on services (%)', 'Partner support cost a year', 'Benefits', 'Notes', 'Shared on', 'Updated',
] as const;
export type CaseSetting = (typeof CASE_SETTINGS)[number];

/** BC's Our case columns, as settings. */
export const OURS_SETTINGS = [
  ...Object.values(FIGURES), OURS.anyway, OURS.anywaySource, OURS.dealsSource, ...Object.values(EFFICIENCY), ...Object.values(CHURN),
  ...Object.values(ALONE), ...ALONE_DEALS, ...Object.values(RISK), OURS.recommendation, OURS.ask, OURS.preparedBy,
] as const;

/** The list tabs of a case file and their columns. */
export const CASE_LISTS = [PRODUCTS_TAB, TYPE_TAB, COSTS_TAB, REASONS_TAB] as const;
export type CaseList = (typeof CASE_LISTS)[number];
export const CASE_LIST_COLUMNS: Record<CaseList, readonly string[]> = {
  [PRODUCTS_TAB]: ['Product', 'Paid', 'Price', 'Per', 'Amount', 'Id'],
  [TYPE_TAB]: [
    'Partner type', 'Brings the lead (%)', 'Closes and invoices', 'Customer support', 'Delivers services',
    ...CASE_RATES.registered, ...CASE_RATES.preferred, FEE, 'Id',
  ],
  [COSTS_TAB]: ['Side', 'Cost', 'When', 'Amount', 'Source', 'Id'],
  [REASONS_TAB]: ['Reason', 'Matters', 'Alone too', 'Id'],
};
export const OUR_COST_COLUMNS = ['Cost', 'When', 'Amount', 'Source', 'Id'] as const;

/* ---------- Words ---------- */

export const PAID = { yearly: 'Yearly', once: 'Once' } as const;
export const PER = { user: 'user', site: 'site', account: 'account' } as const;
export const YES_NO = { yes: 'Yes', no: 'No' } as const;
export const ON_OFF = { yes: 'On', no: 'Off' } as const;
export const PREFERRED_WHEN = { deals: 'After deals a year', revenue: 'After revenue a year', year: 'From a set year' } as const;
export const SUPPORT = { none: 'You', level1: 'Partner: level 1', level12: 'Partner: level 1 and 2' } as const;
export const WHEN = { start: 'To get started', yearly: 'Every year', preferred: 'When Preferred' } as const;
export const SIDE = { partner: 'Partner', ours: 'Ours', alone: 'Ours if alone' } as const;
export const SOURCE: Record<CaseSource, string> = { assumption: 'Assumption', finance: 'Finance', sales: 'Sales', partner: 'Partner', other: 'Other' };
export const MODE = { simple: 'Simplified', detailed: 'Detailed' } as const;
export const MATTERS = { high: 'High', medium: 'Medium', low: 'Low' } as const;
export const STARTS_AS = { registered: 'Registered', preferred: 'Preferred' } as const;
export const SCENARIO = { careful: 'Careful', expected: 'Expected', ambitious: 'Ambitious' } as const;
const SEPARATOR = ', ';

export type Side = keyof typeof SIDE;

const flagWord = (value: boolean, words: Record<'yes' | 'no', string> = YES_NO) => (value ? words.yes : words.no);
/** Comma-separated words ("New customers, Recurring revenue"), as a list. */
const listIn = (text: string) => text.split(',').map((item) => item.trim()).filter((item) => item !== '');

/** The setting each path of a case is stored under, by tab (paths from the case, the offer, our side). */
export const CASE_PATHS: Record<string, CaseSetting> = {
  id: 'Id', title: 'Title', partner: 'Partner', partnerId: 'Partner type id', partnerType: 'PartnerStandard Desk type', typeId: 'Type id',
  programId: 'Program id', createdAt: 'Made on', stageWhenMade: 'Stage when made', recalculatedAt: 'Recalculated on', startsAs: 'Starts as',
  'deals.0': DEALS[0], 'deals.1': DEALS[1], 'deals.2': DEALS[2], 'deals.3': DEALS[3], 'deals.4': DEALS[4], scenario: 'Scenario',
  implementation: 'Implementation', managed: 'Managed service a month', other: 'Other sales', serviceProfit: 'Partner profit on services (%)',
  supportCost: 'Partner support cost a year', benefits: 'Benefits', notes: 'Notes', shared: 'Shared on', updatedAt: 'Updated',
};
export const OFFER_PATHS: Record<string, OfferSetting> = {
  company: 'Company', currency: 'Currency', renewal: 'Customers who renew (%)', 'preferred.on': 'Preferred conditions',
  'preferred.rule': 'Preferred when', 'preferred.deals': 'Preferred deals a year', 'preferred.revenue': 'Preferred revenue a year',
  'preferred.year': 'Preferred from year', 'levels.registered': 'Registered level name', 'levels.preferred': 'Preferred level name',
};
/** Our figures' settings by their path in `Figures`. */
export const FIGURE_PATHS: Record<string, string> = {
  margin: FIGURES.margin, marginSource: FIGURES.marginSource, 'serve.find': FIGURES.find, 'serve.close': FIGURES.close,
  'serve.salesSource': FIGURES.salesSource, 'serve.support1': FIGURES.support1, 'serve.support2': FIGURES.support2,
  'serve.supportSource': FIGURES.supportSource, 'serve.servicesCost': FIGURES.servicesCost, 'serve.servicesCharge': FIGURES.servicesCharge,
  'serve.servicesSource': FIGURES.servicesSource,
};
const reasonPaths = (key: string, columns: ReturnType<typeof reasonColumns> & { simple: string }) => ({
  [`${key}.on`]: columns.on, [`${key}.mode`]: columns.mode, [`${key}.from`]: columns.from, [`${key}.source`]: columns.source,
  [`${key}.note`]: columns.note, [`${key}.alone`]: columns.alone, [`${key}.simple`]: columns.simple,
});
export const OURS_PATHS: Record<string, string> = {
  ...Object.fromEntries(Object.entries(FIGURE_PATHS).map(([path, setting]) => [`figures.${path}`, setting])),
  anyway: OURS.anyway, anywaySource: OURS.anywaySource, dealsSource: OURS.dealsSource,
  ...reasonPaths('efficiency', EFFICIENCY), 'efficiency.hours': EFFICIENCY.hours, 'efficiency.rate': EFFICIENCY.rate,
  ...reasonPaths('churn', CHURN), 'churn.customers': CHURN.customers, 'churn.revenue': CHURN.revenue, 'churn.now': CHURN.now,
  'churn.withPartner': CHURN.withPartner,
  'alone.mode': ALONE.mode, 'alone.share': ALONE.share, 'alone.delay': ALONE.delay, 'alone.setup': ALONE.setup, 'alone.fixed': ALONE.fixed,
  'alone.source': ALONE.source, ...Object.fromEntries(ALONE_DEALS.map((setting, i) => [`alone.deals.${i}`, setting])),
  'risk.amount': RISK.amount, 'risk.from': RISK.from, 'risk.source': RISK.source, 'risk.why': RISK.why,
  recommendation: OURS.recommendation, ask: OURS.ask, preparedBy: OURS.preparedBy,
};

/* ---------- Case to rows ---------- */

/** A case's cells: its three Setting / Value tabs, and the rows of each list. */
export interface CaseRecords {
  offer: Values;
  case: Values;
  ours: Values;
  lists: Record<CaseList, Values[]>;
}

/** The name of the case's partner type in its own offer, '' when the offer no longer has it. */
const typeNameOf = (c: BusinessCase) => c.offer.types.find((t) => t.id === c.typeId)?.name ?? '';

export function figuresRecord(f: Figures): Values {
  const s = f.serve;
  return {
    [FIGURES.margin]: f.margin, [FIGURES.marginSource]: SOURCE[f.marginSource],
    [FIGURES.find]: s.find, [FIGURES.close]: s.close, [FIGURES.salesSource]: SOURCE[s.salesSource],
    [FIGURES.support1]: s.support1, [FIGURES.support2]: s.support2, [FIGURES.supportSource]: SOURCE[s.supportSource],
    [FIGURES.servicesCost]: s.servicesCost, [FIGURES.servicesCharge]: s.servicesCharge, [FIGURES.servicesSource]: SOURCE[s.servicesSource],
  };
}

/** Company facts' Our cost lines rows. */
export const ourCostRecords = (lines: OurCostLine[]): Values[] =>
  lines.map((cost) => ({ Cost: cost.name, When: WHEN[cost.when], Amount: cost.amount, Source: SOURCE[cost.source], Id: cost.id }));

function offerRecord(offer: CaseOffer): Values {
  const values: Record<OfferSetting, Cell> = {
    Company: offer.company,
    Currency: offer.currency,
    'Customers who renew (%)': offer.renewal,
    'Preferred conditions': flagWord(offer.preferred.on, ON_OFF),
    'Preferred when': PREFERRED_WHEN[offer.preferred.rule],
    'Preferred deals a year': offer.preferred.deals,
    'Preferred revenue a year': offer.preferred.revenue,
    'Preferred from year': offer.preferred.year,
    'Registered level name': offer.levels.registered,
    'Preferred level name': offer.levels.preferred,
  };
  return values;
}

function caseRecord(c: BusinessCase): Values {
  const values: Record<CaseSetting, Cell> = {
    Id: c.id,
    Title: c.title,
    Partner: c.partner,
    'Partner type': typeNameOf(c),
    'Partner type id': c.partnerId,
    'PartnerStandard Desk type': PARTNER_TYPE_LABELS[c.partnerType],
    'Type id': c.typeId,
    'Program id': c.programId ?? '',
    'Made on': c.createdAt,
    'Stage when made': STAGE_LABELS[c.stageWhenMade],
    'Recalculated on': c.recalculatedAt ?? '',
    'Starts as': STARTS_AS[c.startsAs],
    [DEALS[0]]: c.deals[0], [DEALS[1]]: c.deals[1], [DEALS[2]]: c.deals[2], [DEALS[3]]: c.deals[3], [DEALS[4]]: c.deals[4],
    Scenario: SCENARIO[c.scenario],
    Implementation: c.implementation,
    'Managed service a month': c.managed,
    'Other sales': c.other,
    'Partner profit on services (%)': c.serviceProfit,
    'Partner support cost a year': c.supportCost,
    Benefits: c.benefits.join(SEPARATOR),
    Notes: c.notes.join(SEPARATOR),
    'Shared on': c.shared?.sharedAt ?? '',
    Updated: c.updatedAt,
  };
  return values;
}

function reasonRecord(columns: ReturnType<typeof reasonColumns> & { simple: string }, r: Reason): Values {
  return {
    [columns.on]: flagWord(r.on, ON_OFF), [columns.mode]: MODE[r.mode], [columns.from]: r.from, [columns.source]: SOURCE[r.source],
    [columns.note]: r.note, [columns.alone]: flagWord(r.alone), [columns.simple]: r.simple,
  };
}

function oursRecord(o: OurCase): Values {
  return {
    ...figuresRecord(o.figures),
    [OURS.anyway]: o.anyway, [OURS.anywaySource]: SOURCE[o.anywaySource], [OURS.dealsSource]: SOURCE[o.dealsSource],
    ...reasonRecord(EFFICIENCY, o.efficiency),
    [EFFICIENCY.hours]: o.efficiency.hours, [EFFICIENCY.rate]: o.efficiency.rate,
    ...reasonRecord(CHURN, o.churn),
    [CHURN.customers]: o.churn.customers, [CHURN.revenue]: o.churn.revenue, [CHURN.now]: o.churn.now, [CHURN.withPartner]: o.churn.withPartner,
    [ALONE.mode]: MODE[o.alone.mode], [ALONE.share]: o.alone.share, [ALONE.delay]: o.alone.delay, [ALONE.setup]: o.alone.setup,
    [ALONE.fixed]: o.alone.fixed, [ALONE.source]: SOURCE[o.alone.source],
    ...Object.fromEntries(ALONE_DEALS.map((column, i) => [column, o.alone.deals[i]!])),
    [RISK.amount]: o.risk.amount, [RISK.from]: o.risk.from, [RISK.source]: SOURCE[o.risk.source], [RISK.why]: o.risk.why,
    [OURS.recommendation]: o.recommendation, [OURS.ask]: o.ask, [OURS.preparedBy]: o.preparedBy,
  };
}

function costRecords(side: Side, lines: Array<CostLine | OurCostLine>): Values[] {
  return lines.map((cost) => ({
    Side: SIDE[side], Cost: cost.name, When: WHEN[cost.when], Amount: cost.amount, Source: 'source' in cost ? SOURCE[cost.source] : '', Id: cost.id,
  }));
}

const ratesRecord = ([first, renewal, once, servicesShare]: readonly string[], r: CaseRates): Values => ({
  [first!]: r.first, [renewal!]: r.renewal, [once!]: r.once, [servicesShare!]: r.servicesShare,
});

/** Every cell of case `c`. */
export function caseRecords(c: BusinessCase): CaseRecords {
  return {
    offer: offerRecord(c.offer),
    case: caseRecord(c),
    ours: oursRecord(c.ours),
    lists: {
      [PRODUCTS_TAB]: c.offer.products.map((p) => ({ Product: p.name, Paid: PAID[p.paid], Price: p.price, Per: PER[p.per], Amount: p.amount, Id: p.id })),
      [TYPE_TAB]: c.offer.types.map((t) => ({
        'Partner type': t.name,
        'Brings the lead (%)': t.roles.lead,
        'Closes and invoices': flagWord(t.roles.closes),
        'Customer support': SUPPORT[t.roles.support],
        'Delivers services': flagWord(t.roles.services),
        ...ratesRecord(CASE_RATES.registered, t.registered),
        ...ratesRecord(CASE_RATES.preferred, t.preferred),
        [FEE]: t.fee,
        Id: t.id,
      })),
      [COSTS_TAB]: [...costRecords('partner', c.costs), ...costRecords('ours', c.ours.costs), ...costRecords('alone', c.ours.alone.costs)],
      [REASONS_TAB]: c.ours.strategic.map((s) => ({ Reason: s.text, Matters: MATTERS[s.weight], 'Alone too': flagWord(s.alone), Id: s.id })),
    },
  };
}

/* ---------- Rows to a case (unchecked: parseStoredCase checks) ---------- */

/** A source; empty reads as Assumption (a line or figure typed by hand, a figure a version 1 file didn't have). */
export function sourceOf(r: Reader, column: string): CaseSource {
  return r.text(column) === '' ? 'assumption' : r.word(column, SOURCE);
}

/** Our figures. `blankIsZero`: an empty number reads as 0 (Company facts), else it is a problem (a case). */
export function readFigures(r: Reader, blankIsZero: boolean) {
  const n = (column: string) => (blankIsZero ? (r.number(column, null) ?? 0) : r.number(column));
  return {
    margin: n(FIGURES.margin),
    marginSource: sourceOf(r, FIGURES.marginSource),
    serve: {
      find: n(FIGURES.find), close: n(FIGURES.close), salesSource: sourceOf(r, FIGURES.salesSource),
      support1: n(FIGURES.support1), support2: n(FIGURES.support2), supportSource: sourceOf(r, FIGURES.supportSource),
      servicesCost: n(FIGURES.servicesCost), servicesCharge: n(FIGURES.servicesCharge), servicesSource: sourceOf(r, FIGURES.servicesSource),
    },
  };
}

/** A cost line of a row: Cost, When, Amount, Id. A row typed without an Id gets `fallbackId`, written on the next save. */
export function readCostLine(r: Reader, fallbackId: string) {
  return { id: r.text('Id') || fallbackId, name: r.text('Cost'), when: r.word('When', WHEN), amount: r.number('Amount') };
}

export function readOfferValues(r: Reader<OfferSetting>) {
  return {
    company: r.text('Company'),
    currency: r.text('Currency'),
    renewal: r.number('Customers who renew (%)'),
    preferred: {
      on: r.word('Preferred conditions', ON_OFF) === 'yes',
      rule: r.word('Preferred when', PREFERRED_WHEN),
      deals: r.number('Preferred deals a year'),
      revenue: r.number('Preferred revenue a year'),
      year: r.number('Preferred from year'),
    },
    levels: { registered: r.text('Registered level name'), preferred: r.text('Preferred level name') },
  };
}

/** The partner type named in the cell: PartnerStandard Desk's label or key, in any case. */
function partnerTypeOf(r: Reader<CaseSetting>, column: CaseSetting, place: string): PartnerType | '' {
  const text = r.text(column).toLowerCase();
  const found = PARTNER_TYPES.find((type) => PARTNER_TYPE_LABELS[type].toLowerCase() === text || type === text);
  if (found === undefined) r.problems.push(`${place} isn't a partner type this tool knows.`);
  return found ?? '';
}

export function readCaseValues(r: Reader<CaseSetting>) {
  const optional = (column: CaseSetting) => r.text(column) || null;
  const sharedAt = r.text('Shared on');
  return {
    id: r.text('Id'),
    title: r.text('Title'),
    partner: r.text('Partner'),
    partnerId: r.text('Partner type id'),
    partnerType: partnerTypeOf(r, 'PartnerStandard Desk type', `PartnerStandard Desk type in ${CASE_TAB}`),
    typeId: r.text('Type id'),
    programId: optional('Program id'),
    createdAt: r.text('Made on'),
    stageWhenMade: r.word('Stage when made', STAGE_LABELS),
    recalculatedAt: optional('Recalculated on'),
    startsAs: r.word('Starts as', STARTS_AS),
    deals: DEALS.map((column) => r.number(column)),
    scenario: r.word('Scenario', SCENARIO),
    implementation: r.number('Implementation'),
    managed: r.number('Managed service a month'),
    other: r.number('Other sales'),
    serviceProfit: r.number('Partner profit on services (%)'),
    supportCost: r.number('Partner support cost a year'),
    benefits: listIn(r.text('Benefits')),
    notes: listIn(r.text('Notes')),
    shared: sharedAt === '' ? null : { sharedAt },
    updatedAt: r.text('Updated'),
  };
}

/** Our side's single values; its cost lines and reasons come from their tabs. */
export function readOursValues(r: Reader) {
  const reason = (columns: ReturnType<typeof reasonColumns> & { simple: string }) => ({
    on: r.word(columns.on, ON_OFF) === 'yes',
    mode: r.word(columns.mode, MODE),
    from: r.number(columns.from),
    source: r.word(columns.source, SOURCE),
    note: r.text(columns.note),
    alone: r.flag(columns.alone),
    simple: r.number(columns.simple),
  });
  return {
    figures: readFigures(r, false),
    anyway: r.number(OURS.anyway),
    anywaySource: r.word(OURS.anywaySource, SOURCE),
    dealsSource: r.word(OURS.dealsSource, SOURCE),
    efficiency: { ...reason(EFFICIENCY), hours: r.number(EFFICIENCY.hours), rate: r.number(EFFICIENCY.rate) },
    churn: {
      ...reason(CHURN),
      customers: r.number(CHURN.customers), revenue: r.number(CHURN.revenue), now: r.number(CHURN.now), withPartner: r.number(CHURN.withPartner),
    },
    alone: {
      mode: r.word(ALONE.mode, MODE),
      share: r.number(ALONE.share),
      delay: r.number(ALONE.delay),
      setup: r.number(ALONE.setup),
      fixed: r.number(ALONE.fixed),
      source: r.word(ALONE.source, SOURCE),
      deals: ALONE_DEALS.map((column) => r.number(column)),
    },
    risk: { amount: r.number(RISK.amount), from: r.number(RISK.from), source: r.word(RISK.source, SOURCE), why: r.text(RISK.why) },
    recommendation: r.text(OURS.recommendation),
    ask: r.text(OURS.ask),
    preparedBy: r.text(OURS.preparedBy),
  };
}

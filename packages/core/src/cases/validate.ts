import { z } from 'zod';
import { PARTNER_TYPES, STAGES } from '@partner-desk/method';
import { CASE_BENEFITS, CASE_SOURCES, TERM_NOTES, type BusinessCase, type CaseOffer } from './types';

const TYPE_GONE = 'This case’s partner type is no longer in its offer. Pick another type.';

export type CaseIssue = { path: string; message: string };

export const MAX_MONEY = 1_000_000_000;
export const MAX_DEALS = 10_000;
const MAX_NAME = 80;

const fmt = (n: number) => n.toLocaleString('en-US');

interface NumberRules {
  min: number;
  max: number;
  whole?: boolean;
  twoDecimals?: boolean;
}

function number(label: string, { min, max, whole, twoDecimals }: NumberRules) {
  let schema = z
    .number({ error: `${label} must be a number.` })
    .min(min, { error: `${label} must be ${fmt(min)} or more.` })
    .max(max, { error: `${label} must be ${fmt(max)} or less.` });
  if (whole) {
    schema = schema.refine((n) => Number.isInteger(n), { error: `${label} must be a whole number.` });
  }
  if (twoDecimals) {
    schema = schema.refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, {
      error: `${label} can have at most 2 decimals.`,
    });
  }
  return schema;
}

const money = (label: string) => number(label, { min: 0, max: MAX_MONEY, twoDecimals: true });
const percent = (label: string) => number(label, { min: 0, max: 100 });
const deals = (year: number) => number(`Deals in year ${year}`, { min: 0, max: MAX_DEALS, whole: true });

const bounded = (label: string, max: number) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .max(max, { error: `${label} must be ${fmt(max)} characters or fewer.` });

const source = z.enum(CASE_SOURCES as unknown as [string, ...string[]], { error: 'Pick where the figure comes from.' });
const year = (label: string) => number(label, { min: 1, max: 5, whole: true });

const text = (label: string) =>
  z
    .string({ error: `${label} must be text.` })
    .trim()
    .min(1, { error: `${label} must be at least 1 character.` })
    .max(MAX_NAME, { error: `${label} must be ${MAX_NAME} characters or fewer.` });

const id = z.string({ error: 'Id must be text.' }).min(1, { error: 'Id must not be empty.' });

const dateTime = (label: string) => z.iso.datetime({ offset: true, error: `${label} must be a date and time.` });

const rates = z.object({
  first: percent('First year rate'),
  renewal: percent('Renewal rate'),
  once: percent('One-time rate'),
  servicesShare: percent('Your share of partner services'),
});

const productLine = z.object({
  id,
  name: text('Product name'),
  paid: z.enum(['yearly', 'once'], { error: 'Pick yearly or once for how it is paid.' }),
  price: money('Price'),
  per: z.enum(['user', 'site', 'account'], { error: 'Pick user, site or account for what the price is per.' }),
  amount: money('Amount'),
});

const partnerType = z.object({
  id,
  name: text('Partner type name'),
  roles: z.object({
    lead: percent('Lead share'),
    closes: z.boolean({ error: 'Pick yes or no for who closes the deal.' }),
    support: z.enum(['none', 'level1', 'level12'], { error: 'Pick the support the partner provides.' }),
    services: z.boolean({ error: 'Pick yes or no for whether the partner provides services.' }),
  }),
  registered: rates,
  preferred: rates,
  fee: money('Partner fee'),
});

const offerSchema = z.object({
  company: text('Company name'),
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF'], { error: 'Pick a currency from the list.' }),
  renewal: percent('Customers who renew'),
  preferred: z.object({
    on: z.boolean({ error: 'Pick yes or no for Preferred.' }),
    rule: z.enum(['deals', 'revenue', 'year'], { error: 'Pick deals, revenue or year for Preferred.' }),
    deals: number('Preferred deals', { min: 1, max: MAX_DEALS, whole: true }),
    revenue: money('Preferred revenue'),
    year: number('Preferred year', { min: 2, max: 5, whole: true }),
  }),
  products: z.array(productLine, { error: 'Products must be a list.' }).max(20, { error: 'Add up to 20 products.' }),
  // A case is for one partner type, so its offer holds exactly one.
  types: z
    .array(partnerType, { error: 'Partner types must be a list.' })
    .length(1, { error: 'A case is for one partner type.' }),
  levels: z.object({
    registered: text('Level name'),
    preferred: text('Level name'),
  }),
});

const costLine = z.object({
  id,
  name: text('Cost name'),
  when: z.enum(['start', 'yearly', 'preferred'], { error: 'Pick start, yearly or preferred for when the cost is paid.' }),
  amount: money('Cost amount'),
});

const ourCostLine = costLine.extend({ source });

/** For Company facts, which holds our figures and default cost lines. */
export const ourCostLineSchema = ourCostLine;

export const figuresSchema = z.object({
  margin: percent('Gross margin'),
  marginSource: source,
  serve: z.object({
    find: money('Finding a lead'),
    close: money('Closing a deal'),
    salesSource: source,
    support1: money('Level 1 support'),
    support2: money('Level 2 support'),
    supportSource: source,
    servicesCost: money('Services cost'),
    servicesCharge: money('Services charge'),
    servicesSource: source,
  }),
});

const reasonFields = {
  on: z.boolean({ error: 'Pick yes or no.' }),
  mode: z.enum(['simple', 'detailed'], { error: 'Pick simple or detailed.' }),
  from: year('From year'),
  source,
  note: bounded('Note', 200),
  alone: z.boolean({ error: 'Pick yes or no.' }),
  simple: money('Amount per year'),
};

const dealsTuple = z.tuple([deals(1), deals(2), deals(3), deals(4), deals(5)], { error: 'Enter deals for all 5 years.' });

const ourSchema = z.object({
  figures: figuresSchema,
  costs: z.array(ourCostLine, { error: 'Costs must be a list.' }).max(20, { error: 'Add up to 20 costs.' }),
  anyway: percent('Deals won anyway'),
  anywaySource: source,
  dealsSource: source,
  efficiency: z.object({
    ...reasonFields,
    hours: number('Hours', { min: 0, max: 1_000_000 }),
    rate: money('Hourly rate'),
  }),
  churn: z.object({
    ...reasonFields,
    customers: number('Customers', { min: 0, max: 1_000_000, whole: true }),
    revenue: money('Revenue per customer'),
    now: percent('Churn now'),
    withPartner: percent('Churn with the partner'),
  }),
  strategic: z
    .array(
      z.object({
        id,
        text: z
          .string({ error: 'Reason must be text.' })
          .trim()
          .min(1, { error: 'Write the reason, or remove it.' })
          .max(200, { error: 'Reason must be 200 characters or fewer.' }),
        weight: z.enum(['high', 'medium', 'low'], { error: 'Pick high, medium or low.' }),
        alone: z.boolean({ error: 'Pick yes or no.' }),
      }),
      { error: 'Reasons must be a list.' },
    )
    .max(10, { error: 'Add up to 10 reasons.' }),
  alone: z.object({
    mode: z.enum(['simple', 'detailed'], { error: 'Pick simple or detailed.' }),
    share: number('Share', { min: 0, max: 500 }),
    delay: number('Delay', { min: 0, max: 36, whole: true }),
    setup: money('Setup cost'),
    fixed: money('Yearly cost'),
    source,
    deals: dealsTuple,
    costs: z.array(ourCostLine, { error: 'Costs must be a list.' }).max(20, { error: 'Add up to 20 costs.' }),
  }),
  risk: z.object({
    amount: money('Risk amount'),
    from: year('Risk from year'),
    source,
    why: bounded('Why', 200),
  }),
  recommendation: bounded('Recommendation', 1000),
  ask: bounded('Ask', 1000),
  preparedBy: bounded('Prepared by', 80),
});

/** A whole business case, as stored. `parseCase` adds that its partner type is in its own offer. */
export const caseSchema = z.object({
  id,
  companyId: id,
  partnerId: id,
  partnerType: z.enum(PARTNER_TYPES, { error: 'Pick a partner type from the list.' }),
  programId: id.nullable(),
  title: text('Title'),
  createdAt: dateTime('Created'),
  stageWhenMade: z.enum(STAGES, { error: 'Pick a stage from the list.' }),
  recalculatedAt: dateTime('Recalculated').nullable(),
  notes: z.array(z.enum(TERM_NOTES as unknown as [string, ...string[]], { error: 'Pick a note from the list.' }), { error: 'Notes must be a list.' }),
  partner: text('Partner name'),
  typeId: z.string({ error: 'Pick a partner type from the offer.' }),
  startsAs: z.enum(['registered', 'preferred'], { error: 'Pick registered or preferred.' }),
  deals: dealsTuple,
  scenario: z.enum(['careful', 'expected', 'ambitious'], { error: 'Pick careful, expected or ambitious.' }),
  implementation: money('Implementation'),
  managed: money('Managed services'),
  other: money('Other services'),
  serviceProfit: percent('Service profit'),
  supportCost: money('Support cost'),
  costs: z.array(costLine, { error: 'Costs must be a list.' }).max(20, { error: 'Add up to 20 costs.' }),
  benefits: z
    .array(z.enum(CASE_BENEFITS, { error: 'Pick benefits from the list.' }), { error: 'Benefits must be a list.' })
    .max(4, { error: 'Pick up to 4 benefits.' }),
  offer: offerSchema,
  ours: ourSchema,
  shared: z.object({ sharedAt: dateTime('Shared') }).nullable(),
  updatedAt: dateTime('Updated'),
});

const toIssues = (error: z.ZodError): CaseIssue[] =>
  error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

export function parseOffer(input: unknown): { ok: true; offer: CaseOffer } | { ok: false; issues: CaseIssue[] } {
  const r = offerSchema.safeParse(input);
  return r.success ? { ok: true, offer: r.data as CaseOffer } : { ok: false, issues: toIssues(r.error) };
}

/**
 * A case as stored: every field checked, but its partner type may have left its own offer (a row removed by hand). Such
 * a case is still read, so the owner can open it and pick another type; parseCase refuses to save it until then.
 */
export function parseStoredCase(input: unknown): { ok: true; case: BusinessCase } | { ok: false; issues: CaseIssue[] } {
  const r = caseSchema.safeParse(input);
  return r.success ? { ok: true, case: r.data as BusinessCase } : { ok: false, issues: toIssues(r.error) };
}

/** A case to save: parseStoredCase, and its partner type is in its own offer. */
export function parseCase(input: unknown): { ok: true; case: BusinessCase } | { ok: false; issues: CaseIssue[] } {
  const parsed = parseStoredCase(input);
  if (!parsed.ok) return parsed;
  const c = parsed.case;
  if (!c.offer.types.some((t) => t.id === c.typeId)) {
    return { ok: false, issues: [{ path: 'typeId', message: TYPE_GONE }] };
  }
  return parsed;
}

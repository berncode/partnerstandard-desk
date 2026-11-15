import { z } from 'zod';
import { KIND, MODELS, OUT, BENEFITS, PLURAL, rateLabel } from './catalog';
import { figuresSchema, ourCostLineSchema } from '../cases/validate';
import { emptyFigures } from '../cases/new-case';
import type { CompanyFacts, Program, ProgramType } from './types';

/**
 * Something wrong with a field. `message` is a sentence for the screen ("Performance bar row 2: At least must be a
 * number."); `located` is the same without what a stored record names by itself, the row or the setting ("At least
 * must be a number."), for a sentence that starts with where it is.
 */
export type Issue = { path: string; message: string; located: string };

/** Between where a field is and what is wrong with it: ": " on the screen, nothing in `located`. */
const SEP = '\u0000';

const MAX_MONEY = 1_000_000_000;
const MAX_NAME = 80;
/** The most a one-line program text holds (a reason to join, the focus, the lead). */
export const MAX_LINE = 200;
/** The most a longer program text holds (the ideal partner, the ideal customer, goals). */
export const MAX_LONG = 2000;

const fmt = (n: number) => n.toLocaleString('en-US');

/** `unit`: a count of days, hours or years, asked for as "Paid within: enter a number from 0 to 3,650 days." */
interface NumberRules { min: number; max: number; whole?: boolean; twoDecimals?: boolean; unit?: string }

function number(label: string, { min, max, whole, twoDecimals, unit }: NumberRules) {
  if (unit) {
    const enter = `${label}${SEP}enter a number from ${fmt(min)} to ${fmt(max)} ${unit}.`;
    const counted = z.number({ error: enter }).min(min, { error: enter }).max(max, { error: enter });
    return whole ? counted.refine((n) => Number.isInteger(n), { error: `${label}${SEP}enter a whole number of ${unit}.` }) : counted;
  }
  const range = `${label} must be between ${fmt(min)} and ${fmt(max)}.`;
  let schema = z.number({ error: `${label} must be a number.` }).min(min, { error: range }).max(max, { error: range });
  if (whole) schema = schema.refine((n) => Number.isInteger(n), { error: `${label} must be a whole number.` });
  if (twoDecimals) {
    schema = schema.refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, { error: `${label} can have at most 2 decimals.` });
  }
  return schema;
}

const money = (label: string) => number(label, { min: 0, max: MAX_MONEY, twoDecimals: true });
const percent = (label: string) => number(label, { min: 0, max: 100 });
const days = (label: string) => number(label, { min: 0, max: 3650, whole: true, unit: 'days' });

const bounded = (label: string, max: number) =>
  z.string({ error: `${label} must be text.` }).trim().max(max, { error: `${label} must be ${fmt(max)} characters or fewer.` });
const line = (label: string) => bounded(label, MAX_LINE);
const long = (label: string) => bounded(label, MAX_LONG);
const name = (label: string) =>
  z.string({ error: `${label} must be text.` }).trim()
    .min(1, { error: `${label} can't be empty.` })
    .max(MAX_NAME, { error: `${label} must be ${MAX_NAME} characters or fewer.` });

const id = z.string({ error: "This item's id is missing." }).trim().min(1, { error: "This item's id is missing." });
const updatedAt = z.string({ error: 'The last saved time must be text.' }).trim();

const company = z.object({
  id,
  currency: z.enum(['EUR', 'USD', 'GBP', 'CHF'], { error: 'Pick a currency from the list.' }),
  yearly: money('Pays every year'),
  once: money('Pays once'),
  renew: percent('Customers who renew'),
  spend: money('Sales and marketing, last year').nullable(),
  revenue: money('Revenue, last year').nullable(),
  rules: z.object({
    protect: days('A registered deal is protected for'),
    extend: days('Extension while working on it'),
    answer: number('You answer within', { min: 0, max: 3650, whole: true, unit: 'hours' }),
    conflict: z.enum(['first', 'case'], { error: 'Pick an answer for When two register the same customer.' }),
    paidInFull: z.boolean({ error: 'Pick yes or no for Partner paid in full if your own team closes the deal.' }),
    ownerNote: long('Who keeps the customer'),
    handover: long('Handover to your sales team'),
  }),
  ours: z.object({
    figures: figuresSchema,
    costs: z.array(ourCostLineSchema, { error: 'Costs must be a list.' }).max(20, { error: 'Add up to 20 costs.' }),
  }).default(() => ({ figures: emptyFigures(), costs: [] })),
  updatedAt,
});

/** Each rate is named by its row on the screen, which follows the pay model: `{rate0}` is filled in by `present`. */
const rates = (tier: string) =>
  z.tuple([
    percent(`${tier}: {rate0}`),
    percent(`${tier}: {rate1}`),
    percent(`${tier}: {rate2}`),
  ], { error: `${tier} rates must be three numbers.` });

const benefitKeys = (label: string) =>
  z.array(z.string({ error: `${label} benefits must be text.` }).trim(), { error: `${label} benefits must be a list.` });

const STANDARD_KEYS = new Set(BENEFITS.flatMap((g) => g.items.map(([k]) => k)));
const MODEL_WORD = { commission: 'Commission', margin: 'Margin', fee: 'Flat fee', none: 'No payment' } as const;

const program = z.object({
  id,
  companyId: id,
  type: z.string({ error: 'Pick a partner type from the list.' }),
  name: name('Program name'),
  focus: line('Focus'),
  lead: line('Program lead'),
  goals: long('Goals'),
  description: long('Description'),
  ipp: long('Ideal partner'),
  icp: long('Ideal customer'),
  kpis: long('Measure'),
  enablement: long('Training'),
  tools: long('Tools'),
  regName: line('Registered level: Name of the level'),
  prefName: line('Preferred level: Name of the level'),
  prefOn: z.boolean({ error: 'Pick yes or no for the Preferred level.' }),
  reg: benefitKeys('Registered'),
  pref: benefitKeys('Preferred'),
  own: z.array(z.object({
    k: z.string({ error: 'Your own benefit is missing its key.' }).trim().min(1, { error: 'Your own benefit is missing its key.' }),
    g: z.enum(['Selling', 'Marketing', 'Product and training', 'Support'], { error: 'Pick a group for your own benefit.' }),
    n: line('Your own benefit'),
  }), { error: 'Own benefits must be a list.' }).max(40, { error: 'Add up to 40 own benefits.' }),
  entry: z.array(line('Requirement {n}'), { error: 'Entry rules must be a list.' }).max(20, { error: 'Add up to 20 entry rules.' }),
  prefReq: z.object({
    certified: z.object({
      on: z.boolean({ error: 'Pick yes or no for certified people.' }),
      people: number('Certified people', { min: 1, max: 1000, whole: true }),
    }),
    contact: z.boolean({ error: 'Pick yes or no for a named contact.' }),
    register: z.boolean({ error: 'Pick yes or no for registering every deal.' }),
    pipeline: z.boolean({ error: 'Pick yes or no for the pipeline review.' }),
    qbr: z.boolean({ error: 'Pick yes or no for the quarterly business review.' }),
    brand: z.boolean({ error: 'Pick yes or no for representing your brand.' }),
  }),
  why: z.array(line('Reason {n}'), { error: 'Reasons must be a list.' }).max(10, { error: 'Add up to 10 reasons.' }),
  bars: z.array(z.object({
    label: line(`Performance bar row {n}${SEP}What you measure`),
    value: number(`Performance bar row {n}${SEP}At least`, { min: 0, max: MAX_MONEY, twoDecimals: true }),
    unit: line(`Performance bar row {n}${SEP}Unit`),
  }), { error: 'Bars must be a list.' }).max(20, { error: 'Add up to 20 bars.' }),
  notice: days('Notice before moving a partner down'),
  plan: z.boolean({ error: 'Pick yes or no for a joint plan.' }),
  pilots: long('Pilot partners'),
  publish: z.string({ error: 'Publish the criteria on must be text.' }).trim().refine((s) => {
    if (s === '') return true;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, { error: 'Publish the criteria on must be a real date, like 2027-01-15.' }),
  money: z.object({
    model: z.string({ error: 'Pick how partners are paid.' }),
    rates: z.object({ reg: rates('Registered'), pref: rates('Preferred') }),
    fee: z.object({ reg: money('Registered flat fee'), pref: money('Preferred flat fee') }),
    pattern: z.enum(['oneoff', 'lifetime'], { error: 'Pick an answer for Paid as.' }),
    base: z.enum(['year', 'contract'], { error: 'Pick an answer for Paid on.' }),
    years: number('First contract runs', { min: 1, max: 10, whole: true, unit: 'years' }),
    payout: z.enum(['customer', 'month', 'quarter'], { error: 'Pick an answer for Paid.' }),
    payDays: days('Paid within'),
    rewards: long('Rewards instead of cash'),
  }),
  run: z.object({
    manager: money('Partner manager time'),
    funds: money('Funds for partner marketing'),
    training: money('Training, material and tools'),
    deals: number('New customers you expect from it', { min: 0, max: 100_000, whole: true }),
  }),
  updatedAt,
}).superRefine((p, ctx) => {
  const add = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message });
  const type = p.type as ProgramType;
  if (Object.hasOwn(OUT, p.type)) return add(['type'], OUT[p.type as keyof typeof OUT]);
  if (!Object.hasOwn(KIND, p.type)) return add(['type'], 'Pick a partner type from the list.');
  const allowed = MODELS[KIND[type]].map(([m]) => m as string);
  if (!allowed.includes(p.money.model)) {
    const word = Object.hasOwn(MODEL_WORD, p.money.model) ? MODEL_WORD[p.money.model as keyof typeof MODEL_WORD] : '';
    add(['money', 'model'], word ? `${word} isn't a way to pay ${PLURAL[type]}.` : 'Pick how partners are paid.');
  }
  const own = new Set(p.own.map((o) => o.k));
  (['reg', 'pref'] as const).forEach((tier) => {
    if (p[tier].some((k) => !STANDARD_KEYS.has(k) && !own.has(k))) {
      add([tier], `${tier === 'reg' ? 'Registered' : 'Preferred'} benefits can only use standard benefits or your own.`);
    }
  });
});

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * An issue as sentences: the list row's number (`{n}`, counted from 1 as on the screen) and the rate's row (`{rate0}`,
 * from the pay model in `input`) filled in.
 */
function present(issue: z.core.$ZodIssue, input: unknown): Issue {
  const path = issue.path.map(String);
  const index = path.find((part) => /^\d+$/.test(part));
  const money = typeof input === 'object' && input !== null ? (input as { money?: unknown }).money : undefined;
  const pay = typeof money === 'object' && money !== null ? money as { model: unknown; pattern: unknown; base: unknown } : { model: null, pattern: null, base: null };
  const fill = (text: string) => text
    .replace('{n}', index === undefined ? '' : String(Number(index) + 1))
    .replace(/\{rate([012])\}/, (_, i: string) => rateLabel(pay, Number(i) as 0 | 1 | 2));
  const [where, what] = issue.message.split(SEP);
  if (what !== undefined) return { path: path.join('.'), message: fill(`${where}: ${what}`), located: capital(fill(what)) };
  return { path: path.join('.'), message: fill(issue.message), located: fill(issue.message.replace(' {n}', '')) };
}

const toIssues = (error: z.ZodError, input: unknown): Issue[] => error.issues.map((i) => present(i, input));

/** The schemas `parseCompanyFacts` and `parseProgram` check with, for the agent calculations' inputs. */
export const companyFactsSchema = company;
export const programSchema = program;

export function parseCompanyFacts(input: unknown): { ok: true; company: CompanyFacts } | { ok: false; issues: Issue[] } {
  const r = company.safeParse(input);
  return r.success ? { ok: true, company: r.data as CompanyFacts } : { ok: false, issues: toIssues(r.error, input) };
}

export function parseProgram(input: unknown): { ok: true; program: Program } | { ok: false; issues: Issue[] } {
  const r = program.safeParse(input);
  return r.success ? { ok: true, program: r.data as unknown as Program } : { ok: false, issues: toIssues(r.error, input) };
}

import { COPY } from '@partner-desk/copy';
import { PREF_REQ, TYPE, WHO_INVOICES, KIND, benefitNames, levelNames, namedBars } from './catalog';
import { costCheck, formatMoney, formatPerOne, num } from './calculate';
import type { CompanyFacts, Program, Level } from './types';

export const NOT_SET = 'Not set yet.';

export interface SheetContent {
  eyebrow: string;
  name: string;
  description: string;
  facts: Array<{ label: string; value: string }>;
  why: string[];
  goals: string;
  ipp: string;
  icp: string;
  levels: { columns: string[]; rows: Array<{ label: string; cells: Array<string | string[]> }> };
  money: string[];
  rules: string[];
  kpis: string;
  enablement: string;
  tools: string;
  rollout: string | null;
  footer: [string, string];
}

/**
 * How a tier is paid, in a sentence fragment ("30% margin off your suggested price, every year"). A number that isn't
 * one yet (being typed) reads as 0, as the money is worked out (calculate.ts).
 */
export function rateLine(c: CompanyFacts, p: Program, tier: Level): string {
  const m = p.money;
  if (m.model === 'none') return 'no cash';
  if (m.model === 'fee') return `${formatMoney(num(m.fee[tier]), c.currency)} per new customer`;
  const [f = 0, rn = 0, o = 0] = m.rates[tier].map(num);
  if (m.model === 'margin') return `${f}% margin off your suggested price, every year`;
  const once = num(c.once) > 0 && o > 0 ? `, and ${o}% of what the customer pays once` : '';
  if (m.pattern === 'oneoff') return `${f}% of ${m.base === 'contract' ? `the first ${num(m.years)}-year contract` : 'the first year'}, one-off${once}`;
  return rn > 0
    ? `${f}% when the customer signs, then ${rn}% every year the customer renews${once}`
    : `${f}% when the customer signs, nothing on renewals${once}`;
}

/** The bars and requirements Preferred asks for, as sentences. A bar without a label measures nothing and is left out. */
export function prefRequirements(p: Program): string[] {
  const bars = namedBars(p).map((b) => `${b.label.trim()}: at least ${num(b.value).toLocaleString('en-GB')} ${b.unit}`.trim());
  const reqs = PREF_REQ.flatMap(([k, n]) => {
    const v = p.prefReq[k];
    if (typeof v === 'object') return v.on ? [`${n}: at least ${num(v.people)}`] : [];
    return v ? [n] : [];
  });
  return [...bars, ...reqs];
}

const text = (s: string): string => (s.trim() ? s : NOT_SET);

/** `companyName` is the PartnerStandard Desk company's name (Settings); the facts don't carry it. */
export function programSheet(c: CompanyFacts, p: Program, companyName: string): SheetContent {
  const r = costCheck(c, p);
  const rules = c.rules, m = p.money, cur = c.currency;
  const list = (items: string[]): string[] => (items.length ? items : [NOT_SET]);
  const prefExtra = p.pref.filter((k) => !p.reg.includes(k));
  const names = levelNames(p);

  const facts = [
    { label: 'Program lead', value: p.lead || 'Not set' },
    { label: 'Partner type', value: TYPE[p.type] },
    ...(p.focus ? [{ label: 'Focus', value: p.focus }] : []),
    { label: 'Levels', value: p.prefOn ? `${names.reg} → ${names.pref}` : names.reg },
  ];

  const rows: SheetContent['levels']['rows'] = [
    { label: 'To get there', cells: [list(p.entry.filter((x) => x.trim())), ...(p.prefOn ? [list(prefRequirements(p))] : [])] },
    { label: 'What they get', cells: [list(benefitNames(p, p.reg)), ...(p.prefOn ? [[`Everything in ${names.reg}`, ...benefitNames(p, prefExtra)]] : [])] },
    { label: 'What they earn', cells: [rateLine(c, p, 'reg'), ...(p.prefOn ? [rateLine(c, p, 'pref')] : [])] },
  ];
  if (p.prefOn) {
    rows.push({
      label: 'Keeping it',
      cells: ['Stays while the agreement runs.', `Checked every year. ${num(p.notice)} days' notice${p.plan ? ' and an improvement plan' : ''} before moving down.`],
    });
  }

  const paid = m.model === 'none'
    ? `No cash. Rewards: ${m.rewards.trim() || NOT_SET}`
    : `Paid ${m.payout === 'customer' ? 'after the customer pays' : m.payout === 'month' ? 'monthly' : 'quarterly'}, within ${num(m.payDays)} days.`;

  const costs = formatMoney(r.costReg, cur) === formatMoney(r.costPref ?? r.costReg, cur)
    ? formatMoney(r.costReg, cur)
    : `${formatMoney(r.costReg, cur)} to ${formatMoney(r.costPref ?? r.costReg, cur)}`;
  // Review Focus 4: margin and commission are a share of what the customer pays. With a typical customer worth nothing
  // (Company facts not filled in) they give no figures, never 0; a flat fee or no payment still says what it is.
  const customerUnknown = r.value <= 0 && (m.model === 'margin' || m.model === 'commission');
  let sentence = customerUnknown ? COPY.PROGRAM_CUSTOMER_UNKNOWN : `Per typical customer over five years: partners earn ${formatMoney(r.reg.total, cur)}${r.pref ? ` (${names.pref}: ${formatMoney(r.pref.total, cur)})` : ''}; with running costs a customer through this program costs you ${costs}.`;
  if (r.ratioReg !== null) {
    const one = formatPerOne(1, cur).replace('.00', '');
    const lo = formatPerOne(r.ratioReg, cur), hi = r.ratioPref === null ? lo : formatPerOne(r.ratioPref, cur);
    sentence += ` That is ${lo === hi ? lo : `${lo} to ${hi}`} of every ${one} the customer brings in${r.direct !== null ? `, compared with ${formatPerOne(r.direct, cur)} when you sell direct` : ''}.`;
  }

  const rulesList = [
    WHO_INVOICES[KIND[p.type]],
    `A registered deal is protected for ${num(rules.protect)} days, with one ${num(rules.extend)}-day extension while the partner is working on it. You answer within ${num(rules.answer)} hours.`,
    rules.conflict === 'first'
      ? 'When two partners register the same customer, the first to register wins, with proof of work.'
      : 'When two partners register the same customer, you decide case by case.',
    ...(rules.paidInFull ? ['If your own team closes a registered deal, the partner is still paid in full.'] : []),
    ...(rules.ownerNote ? [rules.ownerNote] : []),
    ...(rules.handover ? [rules.handover] : []),
  ];

  const rollout = p.prefOn && (p.pilots || p.publish)
    ? `${p.pilots ? `Pilot with ${p.pilots}. ` : ''}${p.publish ? `Criteria published on ${p.publish}.` : ''}`.trim()
    : null;

  return {
    eyebrow: 'Partner Program Sheet · internal',
    name: p.name,
    description: p.description,
    facts,
    why: list(p.why.filter((x) => x.trim())),
    goals: text(p.goals),
    ipp: text(p.ipp),
    icp: text(p.icp),
    levels: { columns: ['', names.reg, ...(p.prefOn ? [names.pref] : [])], rows },
    money: [paid, sentence, ...(r.direct === null ? [COPY.PROGRAM_DIRECT_UNKNOWN] : [])],
    rules: rulesList,
    kpis: text(p.kpis),
    enablement: text(p.enablement),
    tools: text(p.tools),
    rollout,
    footer: [`${companyName} · internal, not for partners`, 'Made with PartnerStandard Desk'],
  };
}

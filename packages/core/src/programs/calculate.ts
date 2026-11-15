import { COPY } from '@partner-desk/copy';
import { benefitNames, levelNames, namedBars } from './catalog';
import type { CompanyFacts, Currency, Program, Level } from './types';

export type Tone = 'good' | 'warn' | 'info';
export interface Callout { tone: Tone; text: string }

export interface CostCheck {
  reg: { first: number; total: number };
  pref: { first: number; total: number } | null;
  running: number;
  costReg: number;
  costPref: number | null;
  value: number;
  ratioReg: number | null;
  ratioPref: number | null;
  direct: number | null;
  /** Preferred earns more over five years; with a customer worth nothing, its pay settings are higher. */
  moneyUp: boolean;
  callout: Callout;
}

/** A number as the money lines read it: anything that isn't one yet (a field being typed) is 0, never NaN. */
export const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function formatPerOne(v: number, currency: Currency): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v || 0);
}

export function formatMoney(v: number, currency: Currency): string {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency, currencyDisplay: 'narrowSymbol', maximumFractionDigits: 0 }).format(Math.round(v || 0));
}

/** Share of customers still there in years 1 to 5. */
export function survival(c: CompanyFacts): number[] {
  const r = num(c.renew) / 100;
  return [1, 2, 3, 4, 5].map((y) => Math.pow(r, y - 1));
}

export function customerValue(c: CompanyFacts): number {
  return num(c.once) + num(c.yearly) * survival(c).reduce((a, b) => a + b, 0);
}

export function earn(c: CompanyFacts, p: Program, tier: Level): { first: number; total: number } {
  const m = p.money, s = survival(c), yearly = num(c.yearly), once = num(c.once);
  if (m.model === 'none') return { first: 0, total: 0 };
  if (m.model === 'fee') {
    const f = num(m.fee[tier]);
    return { first: f, total: f };
  }
  const [f = 0, rn = 0, o = 0] = m.rates[tier].map((x) => num(x) / 100);
  if (m.model === 'margin') {
    const first = (yearly + once) * f;
    return { first, total: first + [2, 3, 4, 5].reduce((a, y) => a + (s[y - 1] ?? 0) * yearly * f, 0) };
  }
  if (m.pattern === 'oneoff') {
    const first = yearly * f * (m.base === 'contract' ? Math.max(1, num(m.years) || 1) : 1) + once * o;
    return { first, total: first };
  }
  const first = yearly * f + once * o;
  return { first, total: first + [2, 3, 4, 5].reduce((a, y) => a + (s[y - 1] ?? 0) * yearly * rn, 0) };
}

/** What selling direct costs for every 1 of revenue, or null when not known. */
export function directRatio(c: CompanyFacts): number | null {
  const spend = c.spend === null ? 0 : num(c.spend);
  const revenue = c.revenue === null ? 0 : num(c.revenue);
  return spend > 0 && revenue > 0 ? spend / revenue : null;
}

/**
 * Whether Preferred's pay settings are above Registered's, for when a typical customer is worth nothing and the
 * five-year totals can't tell: a rate that can apply is higher and none is lower, or the flat fee is higher. A customer
 * worth nothing pays nothing once, so the once rate never counts (Money hides it and the money lines leave it out):
 * margin compares the margin, one-off commission the first year, commission on renewals the first year and renewals.
 * No payment never is.
 */
function paysMore(p: Program): boolean {
  const m = p.money;
  if (m.model === 'none') return false;
  if (m.model === 'fee') return num(m.fee.pref) > num(m.fee.reg);
  const used = m.model === 'margin' || m.pattern === 'oneoff' ? [0] : [0, 1];
  const diffs = used.map((i) => num(m.rates.pref[i]) - num(m.rates.reg[i]));
  return diffs.some((d) => d > 0) && diffs.every((d) => d >= 0);
}

export function costCheck(c: CompanyFacts, p: Program): CostCheck {
  const cur = c.currency;
  const reg = earn(c, p, 'reg');
  const pref = p.prefOn ? earn(c, p, 'pref') : null;
  const running = (num(p.run.manager) + num(p.run.funds) + num(p.run.training)) / Math.max(1, num(p.run.deals));
  const costReg = reg.total + running;
  const costPref = pref ? pref.total + running : null;
  const value = customerValue(c);
  const direct = directRatio(c);
  const ratioReg = value > 0 ? costReg / value : null;
  const ratioPref = pref && value > 0 && costPref !== null ? costPref / value : null;
  // With a customer worth nothing every total is 0, so the levels' pay settings decide.
  const moneyUp = !!pref && (value > 0 ? pref.total > reg.total : paysMore(p));
  const one = formatPerOne(1, cur).replace('.00', '');

  let callout: Callout;
  if (ratioReg === null) {
    callout = { tone: 'info', text: COPY.PROGRAM_CUSTOMER_UNKNOWN };
  } else {
    const top = ratioPref ?? ratioReg;
    const range = ratioPref !== null && formatPerOne(ratioPref, cur) !== formatPerOne(ratioReg, cur)
      ? `${formatPerOne(ratioReg, cur)} to ${formatPerOne(ratioPref, cur)}` : formatPerOne(ratioReg, cur);
    if (direct === null) {
      callout = { tone: 'info', text: `Partners cost you ${range} of every ${one} a customer brings in. Add last year's sales and marketing spend and revenue under Company facts to compare with selling direct.` };
    } else if (top > direct) {
      callout = { tone: 'warn', text: `Through ${pref ? `${levelNames(p).pref} ` : ''}partners a customer costs you ${formatPerOne(top, cur)} of every ${one} it brings in. Selling direct costs you ${formatPerOne(direct, cur)}.` };
    } else {
      callout = { tone: 'good', text: `Partners cost you ${range} of every ${one} a customer brings in. Selling direct costs you ${formatPerOne(direct, cur)}.` };
    }
  }
  return { reg, pref, running, costReg, costPref, value, ratioReg, ratioPref, direct, moneyUp, callout };
}

export function levelCheck(c: CompanyFacts, p: Program): Callout[] {
  if (!p.prefOn) return [{ tone: 'info', text: 'This program has one level only. Turn on Preferred to give partners something to grow into.' }];
  const names = levelNames(p);
  // An own benefit without a name gives partners nothing, and a bar without a label measures nothing.
  const extra = benefitNames(p, p.pref.filter((b) => !p.reg.includes(b))).length;
  const r = costCheck(c, p);
  const diff = extra + (r.moneyUp ? 1 : 0);
  const out: Callout[] = [];
  if (diff < 3) out.push({ tone: 'warn', text: `Can a partner feel the difference? Only ${diff} thing${diff === 1 ? ' is' : 's are'} different from ${names.reg}.` });
  if (!r.moneyUp && p.money.model !== 'none') out.push({ tone: 'warn', text: `${names.pref} partners earn the same as ${names.reg}.` });
  if (!namedBars(p).length) out.push({ tone: 'warn', text: 'Add at least one performance bar, so partners know what it takes.' });
  if (!out.length) {
    out.push({ tone: 'good', text: `${names.pref} adds ${extra} benefit${extra === 1 ? '' : 's'}${r.pref && r.pref.total > r.reg.total ? ` and ${formatMoney(r.pref!.total - r.reg.total, c.currency)} more per customer over five years` : ''}.` });
  }
  return out;
}

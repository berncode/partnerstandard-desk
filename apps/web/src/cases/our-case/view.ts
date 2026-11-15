import {
  simulateCase, simulateOurCase, type BusinessCase as Case, type CaseResult, type CaseSource as Source, type OptionResult, type OurResult, type SureLine,
} from '@partner-desk/core';
import { formatMoney, formatNumber } from '../format';

/**
 * Our case worked out (spec §7.2): the case, the partner case's result and ours. Every result component of our case
 * takes one, on the Our case tab and on the internal one-pager. None of it ever reaches the partner's page.
 */
export interface OurView {
  case: Case;
  partner: CaseResult;
  ours: OurResult;
}

/** Our case worked out from the case alone. The case's type must be in its offer (simulateCase throws otherwise). */
export function ourView(c: Case): OurView {
  const partner = simulateCase(c);
  return { case: c, partner, ours: simulateOurCase(c, partner) };
}

/** `value` with every number that isn't finite (one still being typed) as 0, so a result never shows NaN. */
export function finiteNumbers<T>(value: T): T {
  if (typeof value === 'number') return (Number.isFinite(value) ? value : 0) as T;
  if (Array.isArray(value)) return value.map(finiteNumbers) as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, finiteNumbers(v)])) as T;
  }
  return value;
}

/** The partner's name in the vendor's screens: named, never "they". */
export const partnerName = (c: Case) => c.partner.trim() || 'the partner';
export const vendorName = (c: Case) => c.offer.company.trim() || 'your company';

export const moneyOf = (view: OurView) => (n: number) => formatMoney(n, view.case.offer.currency);
export const yearsOf = (view: OurView) => view.ours.years.length;

/** "Year 2, month 2", or "Not within 5 years". */
export const paysBack = (p: OptionResult['payback']) => (p ? `Year ${p.year}, month ${p.month}` : 'Not within 5 years');
/** "pays back in year 2, month 6", or "doesn’t pay back in 5 years". */
export const paysBackIn = (p: { year: number; month: number } | null) =>
  (p ? `pays back in year ${p.year}, month ${p.month}` : 'doesn’t pay back in 5 years');

/** Net value ÷ what we invest, as a whole percent; "n/a" when we invest nothing. */
export const roiText = (ours: OurResult) => (ours.roi === null ? 'n/a' : `${formatNumber(Math.round(ours.roi * 100))}%`);

/** A whole percent, as the call-outs and the legends show it. */
export const percent = (n: number) => `${formatNumber(Math.round(n))}%`;

/** The both-sides call-out (spec §8.4): good when it works for both and the split is neither thin nor generous. */
export function verdictOf(view: OurView): { kind: 'good' | 'warn'; text: string } {
  const partner = partnerName(view.case);
  const vendor = vendorName(view.case);
  const v = view.ours.verdict;
  if (v.kind === 'both') {
    const text = `Works for both sides. Of the profit over five years, ${partner} keeps ${percent(v.partnerShare)} and ${vendor} ${percent(100 - v.partnerShare)}.`;
    if (v.warn === 'thin') return { kind: 'warn', text: `${text} That may be too little to keep ${partner} motivated.` };
    if (v.warn === 'generous') return { kind: 'warn', text: `${text} The offer may be more generous than it needs to be.` };
    return { kind: 'good', text };
  }
  if (v.kind === 'oursOnly') {
    return { kind: 'warn', text: `Works for ${vendor}, not for ${partner}. A partner who loses money won’t stay: look at the terms or the partner’s costs.` };
  }
  if (v.kind === 'theirsOnly') return { kind: 'warn', text: `Works for ${partner}, not for ${vendor}, on these numbers.` };
  return { kind: 'warn', text: 'Doesn’t work for either side on these numbers.' };
}

/** What the numbers say (spec §8.5): the best of the three options by net value. */
export function numbersSay(view: OurView): string {
  const { withPartner: P, alone: A, best } = view.ours;
  const money = moneyOf(view);
  const n = yearsOf(view);
  const partner = partnerName(view.case);
  if (best === 'partner') return `Partnering with ${partner} gives the most value: ${money(P.total)} over ${n} years, ${money(P.total - A.total)} more than doing it alone.`;
  if (best === 'alone') {
    const later = (A.payback?.year ?? 99) > (P.payback?.year ?? 99) ? ', but pays back later' : '';
    return `Doing it alone gives ${money(A.total - P.total)} more over ${n} years than partnering with ${partner}${later}.`;
  }
  return 'On these numbers, doing nothing costs the least. Neither option earns back what it needs.';
}

/** The three options (spec §7.2), in order, with their colours and how many strategic reasons each covers. */
export function optionsOf(view: OurView): { key: OurResult['best']; name: string; color: string; result: OptionResult; reasons: number }[] {
  const strategic = view.case.ours.strategic;
  return [
    { key: 'partner', name: `With ${partnerName(view.case)}`, color: 'var(--s1)', result: view.ours.withPartner, reasons: strategic.length },
    { key: 'alone', name: 'Alone', color: 'var(--s3)', result: view.ours.alone, reasons: strategic.filter((s) => s.alone).length },
    { key: 'nothing', name: 'Don’t do it', color: 'var(--s5)', result: view.ours.nothing, reasons: 0 },
  ];
}

/** A line of the result, named with the partner where it is about the partner. */
export function sureLabel(line: SureLine, partner: string): string {
  switch (line.key) {
    case 'newRevenue': return `New revenue, after ${partner}’s share`;
    case 'sales': return `Our sales on ${partner}’s deals`;
    case 'supportTaken': return `Support ${partner} takes over`;
    case 'servicesShare': return `Share of ${partner}’s services`;
    case 'fee': return `Partner fee from ${partner}`;
    default: return line.label;
  }
}

export const SOURCE_COLOR: Record<Source, string> = {
  finance: 'var(--s1)', sales: 'var(--s3)', partner: 'var(--s4)', assumption: 'var(--s5)', other: '#9aa39d',
};

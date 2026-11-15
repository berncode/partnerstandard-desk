import { PARTNER_TYPE_LABELS, type PartnerType, type Stage } from '@partner-desk/method';
import { CURRENCY_SYMBOL, KIND, levelNames, namedBars } from '../programs/catalog';
import type { CompanyFacts, Currency, Level, Program } from '../programs/types';
import type { IsoDate, IsoDateTime } from '../partners/types';
import { dayLabel } from '../shared/day';
import { emptyOurCase } from './new-case';
import { MAX_DEALS, MAX_MONEY } from './validate';
import type {
  BusinessCase, CaseRates, CaseType, PreferredConditions, ProductLine, Roles, TermNote,
} from './types';

/** What a case is filled from: the partner type, the company's facts and the program that applies. */
export interface CaseSources {
  companyName: string;
  partnerName: string;
  partnerId: string;
  partnerType: PartnerType;
  stage: Stage;
  level: Level | null;
  facts: CompanyFacts;
  program: Program | null;
}

const REFERRAL: Roles = { lead: 100, closes: false, support: 'none', services: false };

/** Spec 5.2's roles table. Types no program covers start as Referral [builder's call]. */
export function rolesFor(type: PartnerType, program: Program | null): Roles {
  if (!Object.hasOwn(KIND, type)) return { ...REFERRAL };
  switch (KIND[type as keyof typeof KIND]) {
    case 'resale':
      return type === 'var' || type === 'vad'
        ? { lead: 100, closes: true, support: 'level12', services: true }
        : { lead: 100, closes: true, support: 'level1', services: false };
    case 'services':
      return { lead: 30, closes: program?.money.model === 'margin', support: 'none', services: true };
    default:
      return { ...REFERRAL };
  }
}

const zero = (): CaseRates => ({ first: 0, renewal: 0, once: 0, servicesShare: 0 });

/** Spec 5.2: the rates as the program's own calculation reads them. */
export function ratesFrom(p: Program, level: Level): CaseRates {
  const m = p.money;
  const [f = 0, rn = 0, o = 0] = m.rates[level];
  if (m.model === 'margin') return { first: f, renewal: f, once: f, servicesShare: 0 };
  if (m.model === 'commission') {
    return m.pattern === 'oneoff'
      ? { first: f, renewal: 0, once: o, servicesShare: 0 }
      : { first: f, renewal: rn, once: o, servicesShare: 0 };
  }
  return zero();
}

/** What the case could not take from the program, so it says so. */
export function notesFor(p: Program | null, type: PartnerType): TermNote[] {
  if (!p) return [Object.hasOwn(KIND, type) ? 'no-program' : 'no-program-type'];
  const notes: TermNote[] = [];
  if (p.money.model === 'fee') notes.push('flat-fee');
  if (p.money.model === 'commission' && p.money.pattern === 'oneoff' && p.money.base === 'contract') notes.push('contract-years');
  if (namedBars(p).length) notes.push('bars');
  const r = p.prefReq;
  if (p.prefOn && (r.certified.on || r.contact || r.register || r.pipeline || r.qbr || r.brand)) notes.push('pref-req');
  return notes;
}

/** `text` (lower case) has `word` (letters) as a whole word: "eur" is in "sales in eur", not in "europe". */
const hasWord = (text: string, word: string): boolean => new RegExp(`(^|[^\\p{L}\\p{N}])${word}([^\\p{L}\\p{N}]|$)`, 'u').test(text);

/**
 * The case's rule for becoming Preferred starts from the first named bar that counts revenue or deals [controller's
 * ruling]. Revenue: the label or unit says "revenue" (as a word), or names the currency: its code as a word, its sign
 * anywhere ("90k€"). Deals: the unit is "deal(s)", or the label says "customer" or "deal", and the unit is not "%". A
 * value the case can't hold (deals: a whole number from 1 to 10,000; revenue: 0 to 1,000,000,000 with two decimals)
 * leaves BC's default (deals, 10).
 */
export function preferredFrom(p: Program, currency: Currency): PreferredConditions {
  const base: PreferredConditions = { on: p.prefOn, rule: 'deals', deals: 10, revenue: 0, year: 2 };
  const code = currency.toLowerCase();
  const symbol = CURRENCY_SYMBOL[currency].toLowerCase();
  // A sign made of letters (CHF) is a word, as a code is.
  const names = (text: string) => hasWord(text, code) || (/^\p{L}+$/u.test(symbol) ? hasWord(text, symbol) : text.includes(symbol));
  const says = (text: string) => hasWord(text, 'revenues?') || names(text);
  for (const bar of namedBars(p)) {
    const label = bar.label.trim().toLowerCase();
    const unit = bar.unit.trim().toLowerCase();
    const v = bar.value;
    if (says(label) || says(unit)) {
      const fits = Number.isFinite(v) && v >= 0 && v <= MAX_MONEY && Math.abs(Math.round(v * 100) - v * 100) < 1e-6;
      return fits ? { ...base, rule: 'revenue', revenue: v } : base;
    }
    if (unit !== '%' && (unit === 'deal' || unit === 'deals' || label.includes('customer') || label.includes('deal'))) {
      return Number.isInteger(v) && v >= 1 && v <= MAX_DEALS ? { ...base, rule: 'deals', deals: v } : base;
    }
  }
  return base;
}

export type PickedProgram =
  | { kind: 'one'; programId: string }
  | { kind: 'choose'; programIds: string[] }
  | { kind: 'none' };

/** Spec 5.2's order: the linked program, the first program a linked market feeds, a choice among the type's, none. */
export function pickProgram(
  type: PartnerType,
  linked: string | null,
  fedBy: string[],
  programs: Array<{ programId: string; partnerType: PartnerType }>,
): PickedProgram {
  const same = programs.filter((p) => p.partnerType === type).map((p) => p.programId);
  if (linked !== null && same.includes(linked)) return { kind: 'one', programId: linked };
  const fed = fedBy.find((id) => same.includes(id));
  if (fed !== undefined) return { kind: 'one', programId: fed };
  return same.length ? { kind: 'choose', programIds: same } : { kind: 'none' };
}

/** "Case of 30 Oct 2026". */
export function caseTitle(date: IsoDate): string {
  return `Case of ${dayLabel(date)}`;
}

type Ids = { lineId: () => string };

function productsFrom(facts: CompanyFacts, ids: Ids): ProductLine[] {
  return [
    { id: ids.lineId(), name: 'Pays every year', paid: 'yearly', price: facts.yearly, per: 'account', amount: 1 },
    { id: ids.lineId(), name: 'Pays once', paid: 'once', price: facts.once, per: 'account', amount: 1 },
  ];
}

/** The fields spec 5.2 fills from the sources, which a recalculation fills again. */
function filled(src: CaseSources, ids: Ids) {
  const { program, facts } = src;
  const names = program ? levelNames(program) : { reg: 'Registered', pref: 'Preferred' };
  return {
    programId: program?.id ?? null,
    notes: notesFor(program, src.partnerType),
    startsAs: (src.level === 'pref' && program?.prefOn ? 'preferred' : 'registered') as 'preferred' | 'registered',
    roles: rolesFor(src.partnerType, program),
    registered: program ? ratesFrom(program, 'reg') : zero(),
    preferred: program ? ratesFrom(program, 'pref') : zero(),
    offer: {
      currency: facts.currency,
      renewal: facts.renew,
      preferred: program ? preferredFrom(program, facts.currency) : { on: false, rule: 'deals' as const, deals: 10, revenue: 0, year: 2 as const },
      products: productsFrom(facts, ids),
      levels: { registered: names.reg, preferred: names.pref },
    },
  };
}

/** A new case, filled as spec 5.2 says. Everything else starts empty, as in the Business Case app. */
export function newBusinessCase(
  src: CaseSources,
  ids: { caseId: string; lineId: () => string },
  now: IsoDateTime,
): BusinessCase {
  const f = filled(src, ids);
  const type: CaseType = {
    id: ids.lineId(), name: PARTNER_TYPE_LABELS[src.partnerType], roles: f.roles,
    registered: f.registered, preferred: f.preferred, fee: 0,
  };
  const costs = src.facts.ours.costs.map((c) => ({ ...structuredClone(c), id: ids.lineId() }));
  return {
    id: ids.caseId,
    companyId: src.facts.id,
    partnerId: src.partnerId,
    partnerType: src.partnerType,
    programId: f.programId,
    title: caseTitle(now.slice(0, 10)),
    createdAt: now,
    stageWhenMade: src.stage,
    recalculatedAt: null,
    notes: f.notes,
    partner: src.partnerName,
    typeId: type.id,
    startsAs: f.startsAs,
    deals: [0, 0, 0, 0, 0],
    scenario: 'expected',
    implementation: 0,
    managed: 0,
    other: 0,
    serviceProfit: 0,
    supportCost: 0,
    costs: [],
    benefits: [],
    offer: { company: src.companyName, ...f.offer, types: [type] },
    ours: emptyOurCase(src.facts.ours.figures, costs),
    shared: null,
    updatedAt: now,
  };
}

/**
 * Spec 5.4: fills again the currency, renewals, products, roles, rates, level names, Preferred and "starts as", and
 * records the program and the notes. Deals, costs, the partner type's name and fee, and everything in `ours` stay.
 * A program that is gone is no program: the case says so, and never fails.
 */
export function recalculateCase(c: BusinessCase, src: CaseSources, ids: Ids, now: IsoDateTime): BusinessCase {
  const f = filled(src, ids);
  return {
    ...structuredClone(c),
    programId: f.programId,
    notes: f.notes,
    startsAs: f.startsAs,
    recalculatedAt: now,
    offer: {
      ...structuredClone(c.offer),
      ...f.offer,
      types: c.offer.types.map((t) => t.id === c.typeId
        ? { ...t, roles: f.roles, registered: f.registered, preferred: f.preferred }
        : structuredClone(t)),
    },
  };
}

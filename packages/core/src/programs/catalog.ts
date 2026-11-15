import {
  BADGE_URL, CERTIFICATE_URL, PARTNER_TYPES, PARTNER_TYPE_LABELS, PAYMENT_MODELS, PREFERRED_REQUIREMENTS, PROGRAM_BENEFITS, PROGRAM_KINDS,
  PROGRAM_NOT_COVERED, PROGRAM_TYPE_DESCRIPTIONS, PROGRAM_TYPE_GROUPS, PROGRAM_TYPE_PLURALS, WHO_INVOICES as METHOD_WHO_INVOICES, type PartnerType,
} from '@partner-desk/method';
import { PROGRAM_OTHER_REASON } from '@partner-desk/copy';
import type { BenefitGroup, Currency, Kind, Model, OutKey, PrefReq, Program, ProgramType } from './types';

/** PartnerStandard Desk's partner type names are the single source; a program reads the same words as the Partners list. */
export const TYPE: Record<ProgramType | OutKey, string> = PARTNER_TYPE_LABELS;

export const TYPE_DESC: Record<ProgramType, string> = PROGRAM_TYPE_DESCRIPTIONS;

/** Each covered type in the plural, for "The usual starting answers for Resellers." and the performance bars. */
export const PLURAL: Record<ProgramType, string> = PROGRAM_TYPE_PLURALS;

const groups: readonly { name: string; types: readonly (ProgramType | OutKey)[] }[] = PROGRAM_TYPE_GROUPS;
export const GROUPS: { name: string; types: (ProgramType | OutKey)[] }[] = groups.map((g) => ({ name: g.name, types: [...g.types] }));

export const OUT: Record<OutKey, string> = { ...PROGRAM_NOT_COVERED, other: PROGRAM_OTHER_REASON };

export const KIND: Record<ProgramType, Kind> = PROGRAM_KINDS;
// PROGRAM_TYPES is built from KIND's keys: a key in the method's list that is no program type would quietly become one.
const onlyProgramTypes: Exclude<keyof typeof PROGRAM_KINDS, ProgramType> extends never ? true : never = true;
void onlyProgramTypes;

/** PartnerStandard Desk's partner types a program can be for, in PartnerStandard Desk's order. */
export const PROGRAM_TYPES: ProgramType[] = PARTNER_TYPES.filter((t): t is ProgramType => Object.hasOwn(KIND, t));

/** The partner type a program is for. It is fixed once the program exists. */
export const programTypeOf = (p: Pick<Program, 'type'>): PartnerType => p.type;

export const WHO_INVOICES: Record<Kind, string> = METHOD_WHO_INVOICES;

const models: Record<Kind, readonly (readonly [Model, string])[]> = PAYMENT_MODELS;
export const MODELS = Object.fromEntries(Object.entries(models).map(([kind, list]) => [kind, list.map(([m, name]): [Model, string] => [m, name])])) as Record<Kind, [Model, string][]>;

export const WORD: Record<Model, string> = { commission: 'commission', margin: 'margin', fee: 'fee', none: '' };

/* From the hub's Preferred Partner Program guide and the Partner Program Sheet (packages/method, CC BY 4.0) */
export const BENEFITS: { g: BenefitGroup; items: readonly (readonly [string, string])[] }[] = [...PROGRAM_BENEFITS];

const BNAME: Record<string, string> = Object.fromEntries(BENEFITS.flatMap((g) => g.items));

/** Preferred requirements: key, label, and 'people' when the row also asks for a number. */
export const PREF_REQ: readonly (readonly [keyof PrefReq, string, 'people'?])[] = PREFERRED_REQUIREMENTS;

/** Free Canva templates from the hub (planning ruling 9; the owner confirms them). */
export { CERTIFICATE_URL, BADGE_URL };

export const CURRENCY_SYMBOL: Record<Currency, string> = { EUR: '€', USD: '$', GBP: '£', CHF: 'CHF' };

type WithOwn = Pick<Program, 'own'>;

/** Standard benefit names, or the program's own benefit name (trimmed; '' if none). */
export const benefitName = (p: WithOwn, k: string): string => BNAME[k] ?? (p.own.find((o) => o.k === k)?.n ?? '').trim();
export const benefitNames = (p: WithOwn, keys: string[]): string[] => keys.map((k) => benefitName(p, k)).filter(Boolean);

/** The level names as every screen and output reads them: a name left blank is Registered or Preferred. */
export const levelNames = (p: { regName?: string; prefName?: string }): { reg: string; pref: string } => ({
  reg: (p.regName ?? '').trim() || 'Registered',
  pref: (p.prefName ?? '').trim() || 'Preferred',
});

/** The performance bars that measure something: a row without a label is left out everywhere. */
export const namedBars = (p: Pick<Program, 'bars'>) => p.bars.filter((b) => b.label.trim());

export const programLabel = (p: Pick<Program, 'type' | 'focus'>): string => `${TYPE[p.type]}${p.focus ? ` · ${p.focus}` : ''}`;

export const defaultName = (type: ProgramType, company: string): string =>
  `${company} ${TYPE[type].replace(/ Partner$| \(SI\)$/, '')} Program`;

/**
 * The row a rate is asked on (spec §4.7), by its index in a level's rates (first sale, renewal, once). The first
 * sale's row follows the pay model, so a message about a rate names the row the owner sees.
 */
export function rateLabel(m: { model: unknown; pattern: unknown; base: unknown }, index: 0 | 1 | 2): string {
  if (index === 2) return 'Of what the customer pays once';
  if (index === 1) return 'Every year the customer renews';
  if (m.model === 'margin') return 'Margin, every year the customer stays';
  if (m.pattern === 'oneoff') return m.base === 'contract' ? 'Of the whole first contract' : 'Of the first year';
  return 'When the customer signs, on the first year';
}

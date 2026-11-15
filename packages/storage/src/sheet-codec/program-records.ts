// The settings, lists and words of Company facts and a program, and the cell readers. The company's name is not in
// Company facts (it lives in PartnerStandard Desk's company); the list rows are read one by one in program-layout.ts,
// so one bad row is left out instead of making the whole program unreadable.
import {
  BENEFITS, PREF_REQ, TYPE, benefitName, type Base, type BenefitGroup, type CompanyFacts, type Currency, type Model, type OutKey,
  type Pattern, type Payout, type Program, type ProgramType, type Rules,
} from '@partner-desk/core';
import type { Cell } from './grid';

/** One setting table or one list row: name to cell. */
export type Values = Record<string, Cell>;

export const COMPANY_TAB = 'Company facts';

export const COMPANY_SETTINGS = [
  'Id', 'Currency', 'Pays every year', 'Pays once', 'Customers who renew (%)', 'Sales and marketing, last year',
  'Revenue, last year', 'A registered deal is protected (days)', 'Extension while working on it (days)', 'You answer within (hours)',
  'When two register the same customer', 'Partner paid in full if your own team closes the deal', 'Who keeps the customer',
  'Handover to your sales team', 'Updated',
] as const;
export type CompanySetting = (typeof COMPANY_SETTINGS)[number];

export const RATES = {
  reg: ['Registered: first year (%)', 'Registered: renewals (%)', 'Registered: one-off (%)'],
  pref: ['Preferred: first year (%)', 'Preferred: renewals (%)', 'Preferred: one-off (%)'],
} as const;

export const PROGRAM_SETTINGS = [
  'Id', 'Company', 'Partner type', 'Program name', 'Focus', 'Program lead', 'What you want to achieve', 'Description for partners',
  'Ideal partner', 'Ideal customer', 'How you measure the program', 'Training and material', 'Tools',
  'Registered: name of the level', 'Preferred level', 'Preferred: name of the level', 'Notice before moving a partner down (days)',
  'Improvement plan with milestones first', 'Pilot partners', 'Publish the criteria on', 'Paid as', 'Commission', 'Paid on',
  'First contract runs (years)', ...RATES.reg, ...RATES.pref, 'Registered: flat fee', 'Preferred: flat fee', 'Rewards instead of cash',
  'Paid', 'Paid within (days)', 'Partner manager time', 'Funds for partner marketing', 'Training, material and tools',
  'New customers you expect from it', 'Updated',
] as const;
export type ProgramSetting = (typeof PROGRAM_SETTINGS)[number];

/** A program's lists, by the names of the spreadsheet's tabs. */
export const LISTS = ['Reasons', 'Entry', 'Benefits', 'Requirements', 'Performance bar'] as const;
export type List = (typeof LISTS)[number];

export const LIST_COLUMNS: Record<List, readonly string[]> = {
  Reasons: ['Reason'],
  Entry: ['What it takes'],
  Benefits: ['Benefit', 'Group', 'Registered', 'Preferred', 'Own', 'Key'],
  Requirements: ['Requirement', 'On', 'People'],
  'Performance bar': ['Measure', 'At least', 'Unit'],
};

/** The words people read for each stored value. Partner types are their `TYPE` names. */
export const YES_NO = { yes: 'Yes', no: 'No' } as const;
export const CURRENCIES: Record<Currency, string> = { EUR: 'EUR', USD: 'USD', GBP: 'GBP', CHF: 'CHF' };
export const MODEL_WORDS: Record<Model, string> = { commission: 'Commission', margin: 'Margin', fee: 'Flat fee', none: 'No payment' };
export const PATTERN_WORDS: Record<Pattern, string> = { oneoff: 'One-off', lifetime: 'Signs plus renewals' };
export const BASE_WORDS: Record<Base, string> = { year: 'First year', contract: 'Whole first contract' };
export const PAYOUT_WORDS: Record<Payout, string> = { customer: 'After the customer pays', month: 'Monthly', quarter: 'Quarterly' };
export const CONFLICT_WORDS: Record<Rules['conflict'], string> = { first: 'First to register wins', case: 'You decide' };
export const GROUP_WORDS: Record<BenefitGroup, string> = {
  Selling: 'Selling', Marketing: 'Marketing', 'Product and training': 'Product and training', Support: 'Support',
};

export const isBlank = (cell: Cell | undefined) => cell === null || cell === undefined || (typeof cell === 'string' && cell.trim() === '');
export const textOf = (cell: Cell | undefined) => (isBlank(cell) ? '' : String(cell).trim());
/** "2", "2 and 3", "2, 3 and 5". */
export const listOf = (items: Array<string | number>, last = 'and') =>
  items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${last} ${items[items.length - 1]}`;
export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** Cells by name, in any case and with spaces trimmed. */
export class Cells {
  private readonly byName = new Map<string, Cell>();

  constructor(values: Values) {
    for (const [name, cell] of Object.entries(values)) this.byName.set(Cells.key(name), cell);
  }

  private static key(name: string) {
    return name.trim().toLowerCase();
  }

  has(name: string) {
    return this.byName.has(Cells.key(name));
  }

  get(name: string): Cell {
    return this.byName.get(Cells.key(name)) ?? null;
  }
}

/**
 * Reads the cells of one settings table or one list row, collecting a sentence for each that can't be read. The
 * sentences name the setting or the column, never what was typed.
 */
export class Reader<C extends string = string> {
  private readonly cells: Cells;

  /**
   * `place(column)` names a cell ("Focus in Program"); `missing(column)`, when given, is the sentence for a column
   * that isn't there at all (a setting); otherwise a column that isn't there reads as an empty cell.
   */
  constructor(
    values: Values, private readonly place: (column: C) => string, readonly problems: string[],
    private readonly missing?: (column: C) => string,
  ) {
    this.cells = new Cells(values);
  }

  /** The cell, or undefined when the setting isn't there (its problem said). */
  private cell(column: C): Cell | undefined {
    if (this.missing && !this.cells.has(column)) {
      this.problems.push(this.missing(column));
      return undefined;
    }
    return this.cells.get(column);
  }

  text(column: C): string {
    return textOf(this.cell(column));
  }

  /** A number, or a number a person typed as text. Empty is a problem, or null when `blankIs` says so. */
  number(column: C): number;
  number(column: C, blankIs: null): number | null;
  number(column: C, blankIs?: null): number | null {
    const cell = this.cell(column);
    if (cell === undefined) return Number.NaN;
    if (typeof cell === 'number') return cell;
    const text = textOf(cell);
    if (text === '') {
      if (blankIs === null) return null;
      this.problems.push(`${this.place(column)} is empty.`);
      return Number.NaN;
    }
    if (typeof cell === 'string' && Number.isFinite(Number(text))) return Number(text);
    this.problems.push(`${this.place(column)} isn't a number.`);
    return Number.NaN;
  }

  /** The stored value for the word in the cell, matched in any case. */
  word<K extends string>(column: C, words: Record<K, string>): K {
    const cell = this.cell(column);
    if (cell === undefined) return '' as K;
    const text = textOf(cell).toLowerCase();
    const found = (Object.keys(words) as K[]).find((key) => words[key].toLowerCase() === text);
    if (found === undefined) this.problems.push(`${this.place(column)} must be ${listOf(Object.values<string>(words), 'or')}.`);
    return found ?? ('' as K);
  }

  /** Yes or No, or a ticked box. */
  flag(column: C): boolean {
    const cell = this.cell(column);
    if (cell === undefined) return false;
    if (typeof cell === 'boolean') return cell;
    const text = textOf(cell).toLowerCase();
    const found = (Object.keys(YES_NO) as Array<keyof typeof YES_NO>).find((key) => YES_NO[key].toLowerCase() === text);
    if (found === undefined) this.problems.push(`${this.place(column)} must be Yes or No.`);
    return found === 'yes';
  }

  /** The partner type named in the cell, an uncovered one too (the checks say why it can't be used). */
  type(column: C): ProgramType | OutKey | '' {
    const cell = this.cell(column);
    if (cell === undefined) return '';
    const text = textOf(cell);
    if (text === '') {
      this.problems.push(`${this.place(column)} is empty.`);
      return '';
    }
    const keys = Object.keys(TYPE) as Array<ProgramType | OutKey>;
    const found = keys.find((key) => TYPE[key].toLowerCase() === text.toLowerCase()) ?? keys.find((key) => key === text.toLowerCase());
    // PD named the typed text here; PartnerStandard Desk never puts what a person typed into a problem.
    if (found === undefined) this.problems.push(`${this.place(column)} isn't a partner type this tool knows.`);
    return found ?? '';
  }
}

/** Reads one settings table. */
export function settingsReader<C extends string>(values: Values, settings: string, problems: string[]) {
  return new Reader<C>(values, (name) => `${name} in ${settings}`, problems, (name) => `${name} is missing from ${settings}.`);
}

const flagWord = (value: boolean) => (value ? YES_NO.yes : YES_NO.no);

/** The setting a path of the record is stored under: the longest leading part of the path that has one. */
export function settingAt(paths: Record<string, string>, path: string[]): string | undefined {
  for (let end = path.length; end > 0; end -= 1) {
    const setting = paths[path.slice(0, end).join('.')];
    if (setting) return setting;
  }
  return undefined;
}

/* ---------- Company facts ---------- */

/** The setting each company field is stored under, by its path in the company facts. */
export const COMPANY_PATHS: Record<string, CompanySetting> = {
  id: 'Id', currency: 'Currency', yearly: 'Pays every year', once: 'Pays once', renew: 'Customers who renew (%)',
  spend: 'Sales and marketing, last year', revenue: 'Revenue, last year', 'rules.protect': 'A registered deal is protected (days)',
  'rules.extend': 'Extension while working on it (days)', 'rules.answer': 'You answer within (hours)',
  'rules.conflict': 'When two register the same customer', 'rules.paidInFull': 'Partner paid in full if your own team closes the deal',
  'rules.ownerNote': 'Who keeps the customer', 'rules.handover': 'Handover to your sales team', updatedAt: 'Updated',
};

/** The company facts' cells, one per setting. A value not known is left empty. */
export function companyRecord(c: CompanyFacts): Record<CompanySetting, Cell> {
  return {
    Id: c.id,
    Currency: CURRENCIES[c.currency],
    'Pays every year': c.yearly,
    'Pays once': c.once,
    'Customers who renew (%)': c.renew,
    'Sales and marketing, last year': c.spend ?? '',
    'Revenue, last year': c.revenue ?? '',
    'A registered deal is protected (days)': c.rules.protect,
    'Extension while working on it (days)': c.rules.extend,
    'You answer within (hours)': c.rules.answer,
    'When two register the same customer': CONFLICT_WORDS[c.rules.conflict],
    'Partner paid in full if your own team closes the deal': flagWord(c.rules.paidInFull),
    'Who keeps the customer': c.rules.ownerNote,
    'Handover to your sales team': c.rules.handover,
    Updated: c.updatedAt,
  };
}

/** The company facts in `values`, unchecked: `parseCompanyFacts` checks them. */
export function readCompanyValues(r: Reader<CompanySetting>) {
  // In the order of COMPANY_SETTINGS, so the problems are too.
  return {
    id: r.text('Id'),
    currency: r.word('Currency', CURRENCIES),
    yearly: r.number('Pays every year'),
    once: r.number('Pays once'),
    renew: r.number('Customers who renew (%)'),
    spend: r.number('Sales and marketing, last year', null),
    revenue: r.number('Revenue, last year', null),
    rules: {
      protect: r.number('A registered deal is protected (days)'),
      extend: r.number('Extension while working on it (days)'),
      answer: r.number('You answer within (hours)'),
      conflict: r.word('When two register the same customer', CONFLICT_WORDS),
      paidInFull: r.flag('Partner paid in full if your own team closes the deal'),
      ownerNote: r.text('Who keeps the customer'),
      handover: r.text('Handover to your sales team'),
    },
    updatedAt: r.text('Updated'),
  };
}

/* ---------- Programs ---------- */

/** The setting each program field is stored under, by its path in the program. */
export const PROGRAM_PATHS: Record<string, ProgramSetting> = {
  id: 'Id', companyId: 'Company', type: 'Partner type', name: 'Program name', focus: 'Focus', lead: 'Program lead',
  goals: 'What you want to achieve', description: 'Description for partners', ipp: 'Ideal partner', icp: 'Ideal customer',
  kpis: 'How you measure the program', enablement: 'Training and material', tools: 'Tools', regName: 'Registered: name of the level',
  prefOn: 'Preferred level', prefName: 'Preferred: name of the level', notice: 'Notice before moving a partner down (days)',
  plan: 'Improvement plan with milestones first', pilots: 'Pilot partners', publish: 'Publish the criteria on', 'money.model': 'Paid as',
  'money.pattern': 'Commission', 'money.base': 'Paid on', 'money.years': 'First contract runs (years)',
  'money.rates.reg.0': RATES.reg[0], 'money.rates.reg.1': RATES.reg[1], 'money.rates.reg.2': RATES.reg[2],
  'money.rates.pref.0': RATES.pref[0], 'money.rates.pref.1': RATES.pref[1], 'money.rates.pref.2': RATES.pref[2],
  'money.fee.reg': 'Registered: flat fee', 'money.fee.pref': 'Preferred: flat fee', 'money.rewards': 'Rewards instead of cash',
  'money.payout': 'Paid', 'money.payDays': 'Paid within (days)', 'run.manager': 'Partner manager time',
  'run.funds': 'Funds for partner marketing', 'run.training': 'Training, material and tools', 'run.deals': 'New customers you expect from it',
  updatedAt: 'Updated',
};

export const STANDARD = BENEFITS.flatMap(({ g, items }) => items.map(([k]) => ({ k, g })));
export const STANDARD_KEYS = new Set(STANDARD.map(({ k }) => k));

/** A program's cells: its single values and the rows of each list. */
export interface ProgramRecords {
  values: Values;
  lists: Record<List, Values[]>;
}

/** The program's cells: one per setting, and the rows of each list. */
export function programRecords(p: Program): ProgramRecords {
  const m = p.money;
  const values: Record<ProgramSetting, Cell> = {
    Id: p.id,
    Company: p.companyId,
    'Partner type': TYPE[p.type],
    'Program name': p.name,
    Focus: p.focus,
    'Program lead': p.lead,
    'What you want to achieve': p.goals,
    'Description for partners': p.description,
    'Ideal partner': p.ipp,
    'Ideal customer': p.icp,
    'How you measure the program': p.kpis,
    'Training and material': p.enablement,
    Tools: p.tools,
    'Registered: name of the level': p.regName,
    'Preferred level': flagWord(p.prefOn),
    'Preferred: name of the level': p.prefName,
    'Notice before moving a partner down (days)': p.notice,
    'Improvement plan with milestones first': flagWord(p.plan),
    'Pilot partners': p.pilots,
    'Publish the criteria on': p.publish,
    'Paid as': MODEL_WORDS[m.model],
    Commission: PATTERN_WORDS[m.pattern],
    'Paid on': BASE_WORDS[m.base],
    'First contract runs (years)': m.years,
    [RATES.reg[0]]: m.rates.reg[0],
    [RATES.reg[1]]: m.rates.reg[1],
    [RATES.reg[2]]: m.rates.reg[2],
    [RATES.pref[0]]: m.rates.pref[0],
    [RATES.pref[1]]: m.rates.pref[1],
    [RATES.pref[2]]: m.rates.pref[2],
    'Registered: flat fee': m.fee.reg,
    'Preferred: flat fee': m.fee.pref,
    'Rewards instead of cash': m.rewards,
    Paid: PAYOUT_WORDS[m.payout],
    'Paid within (days)': m.payDays,
    'Partner manager time': p.run.manager,
    'Funds for partner marketing': p.run.funds,
    'Training, material and tools': p.run.training,
    'New customers you expect from it': p.run.deals,
    Updated: p.updatedAt,
  };
  const benefit = (k: string, g: BenefitGroup, own: boolean): Values => ({
    Benefit: benefitName(p, k), Group: GROUP_WORDS[g], Registered: flagWord(p.reg.includes(k)), Preferred: flagWord(p.pref.includes(k)),
    Own: flagWord(own), Key: k,
  });
  return {
    values,
    lists: {
      Reasons: p.why.map((reason) => ({ Reason: reason })),
      Entry: p.entry.map((rule) => ({ 'What it takes': rule })),
      Benefits: [
        ...STANDARD.map(({ k, g }) => benefit(k, g, false)),
        ...p.own.map((o) => ({ ...benefit(o.k, o.g, true), Benefit: o.n })),
      ],
      Requirements: PREF_REQ.map(([key, label, people]) => {
        const req = p.prefReq[key];
        return typeof req === 'boolean'
          ? { Requirement: label, On: flagWord(req), People: '' }
          : { Requirement: label, On: flagWord(req.on), People: people ? req.people : '' };
      }),
      'Performance bar': p.bars.map((bar) => ({ Measure: bar.label, 'At least': bar.value, Unit: bar.unit })),
    },
  };
}

/** The program's single values, unchecked: `parseProgram` checks them with the lists. */
export function readProgramValues(r: Reader<ProgramSetting>) {
  // In the order of PROGRAM_SETTINGS, so the problems are too.
  const single = {
    id: r.text('Id'),
    companyId: r.text('Company'),
    type: r.type('Partner type'),
    name: r.text('Program name'),
    focus: r.text('Focus'),
    lead: r.text('Program lead'),
    goals: r.text('What you want to achieve'),
    description: r.text('Description for partners'),
    ipp: r.text('Ideal partner'),
    icp: r.text('Ideal customer'),
    kpis: r.text('How you measure the program'),
    enablement: r.text('Training and material'),
    tools: r.text('Tools'),
    regName: r.text('Registered: name of the level'),
    prefOn: r.flag('Preferred level'),
    prefName: r.text('Preferred: name of the level'),
    notice: r.number('Notice before moving a partner down (days)'),
    plan: r.flag('Improvement plan with milestones first'),
    pilots: r.text('Pilot partners'),
    publish: r.text('Publish the criteria on'),
  };
  const model = r.word('Paid as', MODEL_WORDS);
  const pattern = r.word('Commission', PATTERN_WORDS);
  const base = r.word('Paid on', BASE_WORDS);
  const years = r.number('First contract runs (years)');
  const rates = (columns: readonly ProgramSetting[]): [number, number, number] =>
    [r.number(columns[0]!), r.number(columns[1]!), r.number(columns[2]!)];
  const money = {
    model, pattern, base, years,
    rates: { reg: rates(RATES.reg), pref: rates(RATES.pref) },
    fee: { reg: r.number('Registered: flat fee'), pref: r.number('Preferred: flat fee') },
    rewards: r.text('Rewards instead of cash'),
    payout: r.word('Paid', PAYOUT_WORDS),
    payDays: r.number('Paid within (days)'),
  };
  const run = {
    manager: r.number('Partner manager time'),
    funds: r.number('Funds for partner marketing'),
    training: r.number('Training, material and tools'),
    deals: r.number('New customers you expect from it'),
  };
  return { ...single, money, run, updatedAt: r.text('Updated') };
}

/**
 * The clock's time `now`, but always later than each of `floors` (the record's stored stamp): one millisecond after the
 * latest of them when the clock hasn't moved past.
 */
export function stampAfter(now: string, floors: Array<string | null>): string {
  let ms = Date.parse(now);
  for (const floor of floors) {
    const at = floor === null ? Number.NaN : Date.parse(floor);
    if (Number.isFinite(at) && ms <= at) ms = at + 1;
  }
  return new Date(ms).toISOString();
}

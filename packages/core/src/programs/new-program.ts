import { CURRENCY_SYMBOL, KIND, MODELS, defaultName } from './catalog';
import { emptyFigures } from '../cases/new-case';
import type { CompanyFacts, Program, ProgramType } from './types';

export function newCompanyFacts(id: string): CompanyFacts {
  return {
    id, currency: 'EUR', yearly: 0, once: 0, renew: 0, spend: null, revenue: null,
    rules: { protect: 90, extend: 30, answer: 48, conflict: 'first', paidInFull: true, ownerNote: '', handover: '' },
    ours: { figures: emptyFigures(), costs: [] },
    updatedAt: '',
  };
}

/** The program's own id, and the company's name (it lives in Settings), which the default program name uses. */
export interface ProgramIds {
  id: string;
  companyName: string;
}

/** A program with the starting answers for its type, or a copy of `from` (spec 4.2) when one is given. */
export function newProgram(type: ProgramType, company: CompanyFacts, ids: ProgramIds, from?: Program): Program {
  return from ? copyProgram(from, type, company, ids) : startingProgram(type, company, ids);
}

function startingProgram(type: ProgramType, company: CompanyFacts, { id, companyName }: ProgramIds): Program {
  const kind = KIND[type];
  const p: Program = {
    id, companyId: company.id, type, name: defaultName(type, companyName),
    focus: '', lead: '', goals: '', description: '', ipp: '', icp: '', kpis: '', enablement: '', tools: '',
    regName: 'Registered', prefName: 'Preferred', prefOn: kind !== 'affiliate',
    reg: ['dealreg', 'playbook', 'demo', 'listing', 'training', 'docs', 'portal'],
    pref: ['dealprio', 'leads', 'toplisting', 'comarketing', 'funds', 'badge', 'early', 'manager', 'escalation'],
    own: [],
    entry: ['Signed partner agreement', 'One certified sales person'],
    prefReq: { certified: { on: true, people: 2 }, contact: true, register: true, pipeline: true, qbr: true, brand: true },
    why: [], bars: [], notice: 90, plan: true, pilots: '', publish: '',
    money: {
      model: MODELS[kind][0]?.[0] ?? 'none', rates: { reg: [15, 5, 0], pref: [20, 10, 0] }, fee: { reg: 500, pref: 750 },
      pattern: 'lifetime', base: 'year', years: 3, payout: 'customer', payDays: 30, rewards: '',
    },
    run: { manager: 60000, funds: 15000, training: 10000, deals: 20 },
    updatedAt: '',
  };
  if (kind === 'resale') {
    p.money.rates = { reg: [25, 25, 25], pref: [30, 30, 30] };
    p.bars = [
      { label: 'New customers', value: 5, unit: 'a year' },
      { label: `Revenue through you, in ${CURRENCY_SYMBOL[company.currency]}`, value: 150000, unit: 'a year' },
    ];
    p.entry.push('Passes the partner qualification check');
  }
  if (kind === 'referral') p.bars = [{ label: 'Referred customers who sign', value: 4, unit: 'a year' }];
  if (kind === 'services') {
    p.money.rates = { reg: [10, 0, 0], pref: [15, 5, 0] };
    p.bars = [{ label: 'Implementations completed', value: 3, unit: 'a year' }, { label: 'Customer satisfaction score', value: 85, unit: '%' }];
    p.entry = ['Signed partner agreement', 'Two trained consultants'];
  }
  if (kind === 'affiliate') {
    p.money.rates = { reg: [20, 0, 0], pref: [25, 0, 0] };
    p.money.pattern = 'oneoff';
    p.reg = ['listing', 'portal', 'docs'];
    p.pref = [];
    p.entry = ['Accepted terms and a tracking link'];
    p.bars = [{ label: 'Customers who sign', value: 10, unit: 'a year' }];
    p.run = { manager: 15000, funds: 5000, training: 2000, deals: 40 };
  }
  if (kind === 'reward') {
    p.reg = ['listing', 'early', 'portal'];
    p.pref = ['toplisting', 'comarketing', 'badge', 'roadmap', 'sponsor'];
    p.entry = ['Signed partner agreement'];
    p.bars = [{ label: 'Pieces of content or events', value: 4, unit: 'a year' }];
    p.money.rewards = 'Free license, early access, a speaking slot at our customer event';
    p.run = { manager: 10000, funds: 8000, training: 0, deals: 5 };
  }
  return p;
}

/**
 * Spec 4.2: every answer is copied; money starts fresh when the new type can't use the pay model. PartnerStandard Desk copies
 * only within a partner type (owner, 2026-10-30; `createProgram` refuses another), so the other-type branches are
 * Program Designer's and unused here.
 */
export function copyProgram(source: Program, type: ProgramType, company: CompanyFacts, ids: ProgramIds): Program {
  const fresh = startingProgram(type, company, ids);
  const copy = structuredClone(source);
  copy.id = ids.id;
  copy.companyId = company.id;
  copy.type = type;
  copy.focus = '';
  copy.updatedAt = '';
  copy.name = type === source.type ? `${source.name} (copy)` : defaultName(type, ids.companyName);
  if (!MODELS[KIND[type]].some(([m]) => m === source.money.model)) copy.money = fresh.money;
  return copy;
}

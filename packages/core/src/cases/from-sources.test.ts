import { describe, expect, it } from 'vitest';
import { earn, levelNames, newCompanyFacts, newProgram, parseCompanyFacts } from '../programs';
import { brightpage, northwind } from '../programs/examples';
import type { CompanyFacts, Program } from '../programs/types';
import {
  caseTitle, newBusinessCase, notesFor, pickProgram, preferredFrom, ratesFrom, recalculateCase, rolesFor,
  type CaseSources,
} from './from-sources';
import { emptyFigures } from './new-case';
import { simulateCase } from './simulate';
import { simulateOurCase } from './our-case';
import { leadShare } from './types';
import { parseCase } from './validate';

const NOW = '2026-10-30T10:00:00.000Z';
const counter = (prefix = 'line') => { let n = 0; return () => `${prefix}_${++n}`; };

function sources(over: Partial<CaseSources> = {}): CaseSources {
  const { programs, ...facts } = northwind();
  const program = programs[0];
  return {
    companyName: 'Northwind Security', partnerName: 'Acme', partnerId: 'pt_acme', partnerType: 'reseller', stage: 'growth',
    level: null, facts: { ...facts, name: undefined } as unknown as CompanyFacts, program, ...over,
  };
}
const make = (src = sources()) => newBusinessCase(src, { caseId: 'case_1', lineId: counter() }, NOW);
const typeOf = (c: ReturnType<typeof make>) => c.offer.types[0]!;

describe('rolesFor', () => {
  const R = { lead: 100, closes: false, support: 'none', services: false } as const;
  it.each([
    ['reseller', { lead: 100, closes: true, support: 'level1', services: false }],
    ['distributor', { lead: 100, closes: true, support: 'level1', services: false }],
    ['var', { lead: 100, closes: true, support: 'level12', services: true }],
    ['vad', { lead: 100, closes: true, support: 'level12', services: true }],
    ['referral', R], ['co-seller', R], ['broker', R], ['affiliate', R], ['content', R], ['ambassador', R],
    ['managed', { lead: 30, closes: false, support: 'none', services: true }],
    ['fulfillment', { lead: 30, closes: false, support: 'none', services: true }],
    ['solution', { lead: 30, closes: false, support: 'none', services: true }],
    ['system-integrator', { lead: 30, closes: false, support: 'none', services: true }],
    ['oem', R], ['technology', R], ['data', R], ['integration', R], ['other', R],
  ] as const)('%s', (type, roles) => {
    expect(rolesFor(type, null)).toEqual(roles);
  });

  it('a services program paid as a margin closes and invoices', () => {
    const p = northwind().programs[1];
    p.money.model = 'margin';
    expect(rolesFor('solution', p)).toEqual({ lead: 30, closes: true, support: 'none', services: true });
    p.money.model = 'commission';
    expect(rolesFor('solution', p).closes).toBe(false);
  });
});

describe('ratesFrom', () => {
  const program = (model: Program['money']['model'], pattern: Program['money']['pattern']): Program => {
    const p = northwind().programs[0];
    p.money = { ...p.money, model, pattern, rates: { reg: [10, 5, 3], pref: [20, 8, 4] } };
    return p;
  };
  it('margin: the first rate for every kind of income', () => {
    expect(ratesFrom(program('margin', 'lifetime'), 'reg')).toEqual({ first: 10, renewal: 10, once: 10, servicesShare: 0 });
  });
  it('commission, lifetime', () => {
    expect(ratesFrom(program('commission', 'lifetime'), 'pref')).toEqual({ first: 20, renewal: 8, once: 4, servicesShare: 0 });
  });
  it('commission, one-off: no renewals', () => {
    expect(ratesFrom(program('commission', 'oneoff'), 'reg')).toEqual({ first: 10, renewal: 0, once: 3, servicesShare: 0 });
  });
  it('fee or none: all 0', () => {
    expect(ratesFrom(program('fee', 'lifetime'), 'reg')).toEqual({ first: 0, renewal: 0, once: 0, servicesShare: 0 });
    expect(ratesFrom(program('none', 'lifetime'), 'pref')).toEqual({ first: 0, renewal: 0, once: 0, servicesShare: 0 });
  });
});

describe('notesFor', () => {
  it('names what the case cannot take from the program', () => {
    const p = northwind().programs[0];
    expect(notesFor(p, 'reseller')).toEqual(['bars', 'pref-req']);
    p.money.model = 'fee';
    expect(notesFor(p, 'reseller')).toContain('flat-fee');
    p.money.model = 'commission'; p.money.pattern = 'oneoff'; p.money.base = 'contract';
    expect(notesFor(p, 'reseller')).toContain('contract-years');
    p.money.base = 'year';
    expect(notesFor(p, 'reseller')).not.toContain('contract-years');
    p.bars = []; p.prefOn = false;
    expect(notesFor(p, 'reseller')).toEqual([]);
  });
  it('no program', () => {
    expect(notesFor(null, 'reseller')).toEqual(['no-program']);
    expect(notesFor(null, 'oem')).toEqual(['no-program-type']);
  });
});

describe('preferredFrom', () => {
  const withBars = (bars: Program['bars'], prefOn = true) => ({ ...northwind().programs[0], bars, prefOn });
  it('takes a deals bar', () => {
    expect(preferredFrom(withBars([{ label: 'x', value: 7, unit: ' Deals ' }]), 'EUR')).toMatchObject({ on: true, rule: 'deals', deals: 7 });
  });
  it('takes a revenue bar by currency code or symbol', () => {
    expect(preferredFrom(withBars([{ label: 'x', value: 90000, unit: 'EUR' }]), 'EUR')).toMatchObject({ rule: 'revenue', revenue: 90000 });
    expect(preferredFrom(withBars([{ label: 'x', value: 90000, unit: '€' }]), 'EUR')).toMatchObject({ rule: 'revenue', revenue: 90000 });
  });
  it('matches the currency code and "revenue" as whole words, in any case; the symbol anywhere', () => {
    const one = (label: string, unit = '', value = 5) => preferredFrom(withBars([{ label, value, unit }]), 'EUR');
    expect(one('New customers in Europe')).toMatchObject({ rule: 'deals', deals: 5 });
    expect(one('Deals in Eurasia', 'deals')).toMatchObject({ rule: 'deals', deals: 5 });
    expect(one('Prerevenue deals')).toMatchObject({ rule: 'deals', deals: 5 });
    expect(one('Sales in EUR', 'a year', 90000)).toMatchObject({ rule: 'revenue', revenue: 90000 });
    expect(one('Sales (eur)', '', 90000)).toMatchObject({ rule: 'revenue', revenue: 90000 });
    expect(one('Yearly Revenue', '', 90000)).toMatchObject({ rule: 'revenue', revenue: 90000 });
    expect(one('Sales', 'revenue a year', 90000)).toMatchObject({ rule: 'revenue', revenue: 90000 });
    expect(one('Sales of 90k€', '', 90000)).toMatchObject({ rule: 'revenue', revenue: 90000 });
  });
  it('the first named bar decides; a bar without a label does not count', () => {
    expect(preferredFrom(withBars([{ label: ' ', value: 1, unit: 'deals' }, { label: 'y', value: 5, unit: 'deal' }]), 'USD')).toMatchObject({ rule: 'deals', deals: 5 });
    expect(preferredFrom(withBars([{ label: 'a', value: 3, unit: '%' }, { label: 'y', value: 5, unit: 'deal' }]), 'USD')).toMatchObject({ rule: 'deals', deals: 5 });
    expect(preferredFrom(withBars([{ label: 'Customer satisfaction score', value: 85, unit: '%' }]), 'USD')).toMatchObject({ rule: 'deals', deals: 10 });
  });
  it.each([
    ['resale', 'reseller', { rule: 'deals', deals: 5 }],
    ['referral', 'referral', { rule: 'deals', deals: 4 }],
    ['affiliate', 'affiliate', { rule: 'deals', deals: 10 }],
    ['services', 'solution', { rule: 'deals', deals: 10 }],
    ['reward', 'content', { rule: 'deals', deals: 10 }],
  ] as const)("the default bars of a %s program", (_, type, want) => {
    const p = newProgram(type, newCompanyFacts('co_x'), { id: 'pr_x', companyName: 'X' });
    expect(preferredFrom(p, 'EUR')).toMatchObject({ on: p.prefOn, ...want });
  });
  it('a revenue bar first wins, by label', () => {
    const p = { ...newProgram('reseller', newCompanyFacts('co_x'), { id: 'pr_x', companyName: 'X' }) };
    p.bars = [p.bars[1]!, p.bars[0]!];
    expect(p.bars[0]!.label).toBe('Revenue through you, in €');
    expect(preferredFrom(p, 'EUR')).toMatchObject({ rule: 'revenue', revenue: 150000 });
  });
  it('a bar the case cannot hold gives the default, and the case still parses', () => {
    const deals = (value: number) => [{ label: 'Deals', value, unit: 'deals' }];
    const revenue = (value: number) => [{ label: 'Revenue', value, unit: 'a year' }];
    const cases: Array<[Program['bars'], string]> = [
      [deals(0), 'deals'], [deals(2.5), 'deals'], [deals(20000), 'deals'],
      [revenue(2e9), 'deals'], [revenue(10.005), 'deals'], [revenue(-1), 'deals'],
    ];
    for (const [bars, rule] of cases) {
      const src = sources();
      src.program!.bars = bars;
      const c = make(src);
      expect(c.offer.preferred, JSON.stringify(bars)).toMatchObject({ rule, deals: 10, revenue: 0 });
      expect(parseCase(c).ok).toBe(true);
      const r = recalculateCase(c, src, { lineId: counter('n') }, NOW);
      expect(parseCase(r).ok).toBe(true);
      expect(r.offer.preferred).toEqual(c.offer.preferred);
    }
    const ok = sources();
    ok.program!.bars = revenue(90000.5);
    expect(make(ok).offer.preferred).toMatchObject({ rule: 'revenue', revenue: 90000.5 });
    expect(parseCase(make(ok)).ok).toBe(true);
  });
  it('falls back to the default and follows prefOn', () => {
    expect(preferredFrom(withBars([], false), 'EUR')).toEqual({ on: false, rule: 'deals', deals: 10, revenue: 0, year: 2 });
  });
});

describe('pickProgram', () => {
  const programs = [
    { programId: 'a', partnerType: 'reseller' as const }, { programId: 'b', partnerType: 'reseller' as const },
    { programId: 'c', partnerType: 'referral' as const },
  ];
  it('the linked program first', () => {
    expect(pickProgram('reseller', 'b', ['a'], programs)).toEqual({ kind: 'one', programId: 'b' });
  });
  it('then the first program a linked market feeds', () => {
    expect(pickProgram('reseller', null, ['c', 'b', 'a'], programs)).toEqual({ kind: 'one', programId: 'b' });
  });
  it('a program of another type does not count', () => {
    expect(pickProgram('reseller', 'c', ['c'], programs)).toEqual({ kind: 'choose', programIds: ['a', 'b'] });
  });
  it('then a choice, then none', () => {
    expect(pickProgram('referral', null, [], programs)).toEqual({ kind: 'choose', programIds: ['c'] });
    expect(pickProgram('var', null, [], programs)).toEqual({ kind: 'none' });
    expect(pickProgram('oem', null, [], programs)).toEqual({ kind: 'none' });
  });
});

it('caseTitle', () => {
  expect(caseTitle('2026-10-30')).toBe('Case of 30 Oct 2026');
  expect(caseTitle('2027-01-05')).toBe('Case of 5 Jan 2027');
});

describe('newBusinessCase', () => {
  it('fills the case from facts and program as spec 5.2 says', () => {
    const src = sources({ level: 'pref' });
    const c = make(src);
    expect(parseCase(c).ok).toBe(true);
    expect(c).toMatchObject({
      id: 'case_1', companyId: src.facts.id, partnerId: 'pt_acme', partnerType: 'reseller', programId: src.program!.id,
      title: 'Case of 30 Oct 2026', createdAt: NOW, stageWhenMade: 'growth', recalculatedAt: null, partner: 'Acme',
      startsAs: 'preferred', scenario: 'expected', deals: [0, 0, 0, 0, 0], shared: null, updatedAt: NOW, costs: [], benefits: [],
    });
    expect(c.offer).toMatchObject({ company: 'Northwind Security', currency: 'EUR', renewal: 90 });
    expect(c.offer.products.map((p) => [p.name, p.paid, p.price, p.per, p.amount])).toEqual([
      ['Pays every year', 'yearly', 18000, 'account', 1], ['Pays once', 'once', 6000, 'account', 1],
    ]);
    expect(c.offer.levels).toEqual({ registered: levelNames(src.program!).reg, preferred: levelNames(src.program!).pref });
    const t = typeOf(c);
    expect(c.typeId).toBe(t.id);
    expect(c.offer.types).toHaveLength(1);
    expect(t).toMatchObject({ name: 'Reseller', fee: 0, roles: rolesFor('reseller', src.program) });
    expect(t.registered).toEqual(ratesFrom(src.program!, 'reg'));
    expect(t.preferred).toEqual(ratesFrom(src.program!, 'pref'));
  });

  it('uses the program level names', () => {
    const src = sources();
    src.program!.regName = 'Silver'; src.program!.prefName = 'Gold';
    expect(make(src).offer.levels).toEqual({ registered: 'Silver', preferred: 'Gold' });
  });

  it('no program: rates 0, the roles of its kind, a note', () => {
    const c = make(sources({ program: null }));
    expect(typeOf(c).registered).toEqual({ first: 0, renewal: 0, once: 0, servicesShare: 0 });
    expect(typeOf(c).preferred).toEqual({ first: 0, renewal: 0, once: 0, servicesShare: 0 });
    expect(typeOf(c).roles).toEqual(rolesFor('reseller', null));
    expect(c.programId).toBeNull();
    expect(c.notes).toEqual(['no-program']);
    expect(c.offer.levels).toEqual({ registered: 'Registered', preferred: 'Preferred' });
    expect(c.offer.preferred.on).toBe(false);
    expect(parseCase(c).ok).toBe(true);
  });

  it('a type no program covers says so', () => {
    const c = make(sources({ partnerType: 'oem', program: null }));
    expect(c.notes).toEqual(['no-program-type']);
    expect(typeOf(c).name).toBe('OEM Partner');
  });

  it('a program without Preferred: preferred is off, and starts as Registered', () => {
    const src = sources({ level: 'pref' });
    src.program!.prefOn = false;
    const c = make(src);
    expect(c.offer.preferred.on).toBe(false);
    expect(c.startsAs).toBe('registered');
  });

  it('starts as follows the level, Registered when there is none', () => {
    expect(make(sources({ level: 'pref' })).startsAs).toBe('preferred');
    expect(make(sources({ level: 'reg' })).startsAs).toBe('registered');
    expect(make(sources({ level: null })).startsAs).toBe('registered');
  });

  it('copies our figures and cost lines with fresh ids, structurally', () => {
    const src = sources();
    src.facts.ours = {
      figures: { ...emptyFigures(), margin: 80, marginSource: 'finance' },
      costs: [{ id: 'facts_cost', name: 'Partner manager', when: 'yearly', amount: 5000, source: 'finance' }],
    };
    const c = make(src);
    expect(c.ours.figures.margin).toBe(80);
    expect(c.ours.costs).toHaveLength(1);
    expect(c.ours.costs[0]).toMatchObject({ name: 'Partner manager', when: 'yearly', amount: 5000, source: 'finance' });
    expect(c.ours.costs[0]!.id).not.toBe('facts_cost');
    src.facts.ours.figures.margin = 10;
    src.facts.ours.costs[0]!.amount = 1;
    expect(c.ours.figures.margin).toBe(80);
    expect(c.ours.costs[0]!.amount).toBe(5000);
    expect(c.ours.recommendation).toBe('');
    expect(c.ours.alone.deals).toEqual([0, 0, 0, 0, 0]);
  });
});

describe('the case matches the program (spec 5.2)', () => {
  const facts = [northwind(), brightpage()];
  const programs = facts.flatMap((f) => f.programs.map((p) => ({ f, p })));
  const eligible = programs.filter(({ p }) => (p.money.model === 'margin' || p.money.model === 'commission') && !(p.money.model === 'commission' && p.money.pattern === 'oneoff' && p.money.base === 'contract'));
  const models = ['margin', 'commission'] as const;
  const patterns = ['lifetime', 'oneoff'] as const;
  // Every pay model on every fixture program, so each branch of the rates is checked.
  const variants = eligible.flatMap(({ f, p }) => models.flatMap((model) => patterns.map((pattern) => {
    const q: Program = structuredClone(p);
    q.money.model = model; q.money.pattern = pattern; q.money.base = 'year';
    q.money.rates = { reg: [12, 7, 4], pref: [18, 9, 6] };
    return { f, q };
  })));
  it.each([...eligible.map(({ f, p }) => ({ f, q: p })), ...variants].map((v, i) => [i, v] as const))('program %i', (_, { f, q }) => {
    const { programs: _p, name, ...rest } = f;
    void _p;
    const src: CaseSources = {
      companyName: name, partnerName: 'Acme', partnerId: 'pt', partnerType: q.type, stage: 'growth', level: null,
      facts: rest, program: q,
    };
    const c = make(src);
    c.deals = [1, 0, 0, 0, 0]; c.scenario = 'expected'; c.startsAs = 'registered';
    const want = earn(rest, q, 'reg').total * leadShare(typeOf(c).roles);
    expect(simulateCase(c).earnings).toBeCloseTo(want, 2);
  });
  it('covers some programs', () => expect(eligible.length).toBeGreaterThan(0));
});

describe('recalculateCase', () => {
  function edited() {
    const src = sources();
    const c = make(src);
    c.deals = [3, 4, 5, 6, 7];
    c.costs = [{ id: 'k1', name: 'Training', when: 'start', amount: 900 }];
    c.title = 'My own title';
    c.partner = 'Acme Ltd';
    c.benefits = ['New customers'];
    c.implementation = 500;
    c.ours.recommendation = 'Go';
    c.ours.anyway = 12;
    typeOf(c).fee = 250;
    return { src, c };
  }

  it('keeps deals, the partner costs and the whole of ours', () => {
    const { src, c } = edited();
    const before = structuredClone(c);
    src.facts.ours = { figures: { ...emptyFigures(), margin: 99 }, costs: [] };
    const r = recalculateCase(c, src, { lineId: counter('new') }, '2026-11-02T08:00:00.000Z');
    expect(r.deals).toEqual(before.deals);
    expect(r.costs).toEqual(before.costs);
    expect(r.ours).toEqual(before.ours);
    expect(r.title).toBe('My own title');
    expect(r.partner).toBe('Acme Ltd');
    expect(r.benefits).toEqual(before.benefits);
    expect(r.implementation).toBe(500);
    expect(r.stageWhenMade).toBe('growth');
    expect(r.createdAt).toBe(before.createdAt);
    expect(r.id).toBe(before.id);
    expect(r.typeId).toBe(before.typeId);
    expect(typeOf(r).fee).toBe(250);
    expect(typeOf(r).id).toBe(typeOf(before).id);
    expect(typeOf(r).name).toBe(typeOf(before).name);
    expect(c).toEqual(before);
  });

  it('fills the spec 5.4 fields again from the new sources', () => {
    const { src, c } = edited();
    const next = sources({ stage: 'expansion', level: 'pref', facts: { ...src.facts, currency: 'USD', renew: 70, yearly: 1000, once: 0 }, program: brightpage().programs[0], partnerType: 'reseller' });
    next.program!.type = 'reseller';
    const r = recalculateCase(c, next, { lineId: counter('new') }, '2026-11-02T08:00:00.000Z');
    expect(r.recalculatedAt).toBe('2026-11-02T08:00:00.000Z');
    expect(r.programId).toBe(next.program!.id);
    expect(r.offer.currency).toBe('USD');
    expect(r.offer.renewal).toBe(70);
    expect(r.offer.products.map((p) => p.price)).toEqual([1000, 0]);
    expect(r.offer.products.map((p) => p.id)).toEqual(['new_1', 'new_2']);
    expect(r.offer.levels).toEqual({ registered: levelNames(next.program!).reg, preferred: levelNames(next.program!).pref });
    expect(r.offer.preferred).toEqual(preferredFrom(next.program!, 'USD'));
    expect(r.startsAs).toBe('preferred');
    expect(typeOf(r).roles).toEqual(rolesFor('reseller', next.program));
    expect(typeOf(r).registered).toEqual(ratesFrom(next.program!, 'reg'));
    expect(r.notes).toEqual(notesFor(next.program, 'reseller'));
    expect(r.offer.company).toBe(c.offer.company);
    expect(r.stageWhenMade).toBe('growth');
    const parsed = parseCase(r);
    expect(parsed.ok ? [] : parsed.issues).toEqual([]);
  });

  it('a program that is gone falls back to no program, and never fails', () => {
    const { src, c } = edited();
    expect(c.programId).not.toBeNull();
    const r = recalculateCase(c, { ...src, program: null }, { lineId: counter() }, NOW);
    expect(r.programId).toBeNull();
    expect(r.notes).toEqual(['no-program']);
    expect(typeOf(r).registered.first).toBe(0);
    expect(r.offer.levels).toEqual({ registered: 'Registered', preferred: 'Preferred' });
    expect(r.deals).toEqual(c.deals);
  });
});

describe('partnerSide', () => {
  it('has nothing of ours, no ids and no notes', async () => {
    const { partnerSide } = await import('./partner-side');
    const c = make();
    const o = c.ours;
    o.figures.margin = 71717; o.figures.serve.find = 72727; o.figures.serve.close = 73737; o.figures.serve.support1 = 74747;
    o.figures.serve.support2 = 75757; o.figures.serve.servicesCost = 76767; o.figures.serve.servicesCharge = 77777;
    o.costs = [{ id: 'ourcostid_zz', name: 'OURCOSTNAME_zz', when: 'yearly', amount: 78787, source: 'finance' }];
    o.anyway = 79797; o.efficiency.note = 'EFFNOTE_zz'; o.efficiency.hours = 80808; o.efficiency.rate = 81818;
    o.churn.customers = 82828; o.churn.revenue = 83838; o.churn.note = 'CHURNNOTE_zz';
    o.strategic = [{ id: 'stratid_zz', text: 'STRATTEXT_zz', weight: 'high', alone: false }];
    o.alone = { ...o.alone, share: 84848, delay: 85858, setup: 86868, fixed: 87878, deals: [88888, 0, 0, 0, 0], costs: [{ id: 'alonecostid_zz', name: 'ALONECOST_zz', when: 'start', amount: 89898, source: 'sales' }] };
    o.risk = { amount: 90909, from: 2, source: 'other', why: 'RISKWHY_zz' };
    o.recommendation = 'RECO_zz'; o.ask = 'ASK_zz'; o.preparedBy = 'PREPBY_zz';
    c.notes = ['no-program']; c.programId = 'pr_secretprogram'; c.companyId = 'co_secretco'; c.partnerId = 'pt_secretpartner';
    c.costs = [{ id: 'partnercostid_zz', name: 'Partner training', when: 'start', amount: 500 }];
    const json = JSON.stringify(partnerSide(c, 'Northwind Security'));
    for (const marker of ['71717', '72727', '73737', '74747', '75757', '76767', '77777', '78787', '79797', '80808', '81818', '82828', '83838', '84848', '85858', '86868', '87878', '88888', '89898', '90909',
      'OURCOSTNAME_zz', 'ourcostid_zz', 'EFFNOTE_zz', 'CHURNNOTE_zz', 'STRATTEXT_zz', 'stratid_zz', 'ALONECOST_zz', 'alonecostid_zz', 'RISKWHY_zz', 'RECO_zz', 'ASK_zz', 'PREPBY_zz',
      'no-program', 'pr_secretprogram', 'co_secretco', 'pt_secretpartner', 'partnercostid_zz', 'case_1', 'ours', 'notes']) {
      expect(json, marker).not.toContain(marker);
    }
    expect(json).toContain('Partner training');
    expect(json).toContain('Acme');
  });

  it('a key added to the case later does not appear', async () => {
    const { partnerSide } = await import('./partner-side');
    const c = { ...make(), futureField: 'FUTURE_zz' } as ReturnType<typeof make>;
    expect(JSON.stringify(partnerSide(c, 'Northwind Security'))).not.toContain('FUTURE_zz');
  });

  it('carries the partner view and the result', async () => {
    const { partnerSide } = await import('./partner-side');
    const c = make();
    c.deals = [2, 2, 2, 2, 2];
    const v = partnerSide(c, 'Northwind Security');
    expect(v.company).toBe('Northwind Security');
    expect(v.partner).toBe('Acme');
    expect(v.result).toEqual(simulateCase(c));
    expect(v.type.name).toBe('Reseller');
    expect(v.currency).toBe('EUR');
    // The one-pager says how many customers renew each year.
    expect(v.renewal).toBe(c.offer.renewal);
  });
});

describe('a case filled from empty facts (Review Focus 5)', () => {
  it('shows only finite numbers, never -0, and no break-even', () => {
    const facts = newCompanyFacts('co_empty');
    const parsed = parseCompanyFacts(JSON.parse(JSON.stringify(facts)));
    expect(parsed.ok).toBe(true);
    for (const program of [null, newProgram('reseller', facts, { id: 'pr_x', companyName: 'X' })]) {
      const c = newBusinessCase(
        { companyName: 'X', partnerName: 'Acme', partnerId: 'pt', partnerType: 'reseller', stage: 'recruitment', level: null, facts, program },
        { caseId: 'case_e', lineId: counter() }, NOW,
      );
      const walk = (v: unknown, path: string): void => {
        if (typeof v === 'number') {
          expect(Number.isFinite(v), path).toBe(true);
          expect(Object.is(v, -0), path).toBe(false);
        } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
        else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
      };
      const sim = simulateCase(c);
      walk(sim, 'sim');
      walk(simulateOurCase(c, sim), 'ours');
      expect(sim.breakEven).toBeNull();
    }
  });
});

describe('Company facts ours', () => {
  it('starts empty and a missing ours is read as empty', () => {
    const facts = newCompanyFacts('co_x');
    expect(facts.ours).toEqual({ figures: emptyFigures(), costs: [] });
    const { ours: _o, ...stored } = facts;
    void _o;
    const r = parseCompanyFacts(stored);
    expect(r.ok && r.company.ours).toEqual({ figures: emptyFigures(), costs: [] });
  });
});

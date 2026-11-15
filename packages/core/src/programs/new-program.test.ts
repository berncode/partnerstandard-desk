import { describe, expect, it } from 'vitest';
import { benefitNames, defaultName, programLabel } from './catalog';
import { copyProgram, newCompanyFacts, newProgram } from './new-program';
import type { CompanyFacts, ProgramType } from './types';

const company: CompanyFacts = { ...newCompanyFacts('co_1'), currency: 'EUR' };
const ids = (id: string) => ({ id, companyName: 'Northwind Security' });

describe('newCompanyFacts', () => {
  it('starts empty with the rules defaults', () => {
    const c = newCompanyFacts('co_x');
    expect(c).not.toHaveProperty('name');
    expect(c).toMatchObject({ id: 'co_x', currency: 'EUR', yearly: 0, once: 0, renew: 0, spend: null, revenue: null, updatedAt: '' });
    expect(c.rules).toEqual({ protect: 90, extend: 30, answer: 48, conflict: 'first', paidInFull: true, ownerNote: '', handover: '' });
  });
});

describe('defaultName', () => {
  it('drops Partner and (SI)', () => {
    expect(defaultName('solution', 'Northwind Security')).toBe('Northwind Security Solution Program');
    expect(defaultName('system-integrator', 'Northwind Security')).toBe('Northwind Security System Integrator Program');
    expect(defaultName('co-seller', 'Acme')).toBe('Acme Co-Seller Program');
    expect(defaultName('managed', 'Acme')).toBe('Acme Managed Service Provider Program');
    expect(defaultName('referral', 'Northwind Security')).toBe('Northwind Security Referral Program');
    expect(defaultName('var', 'Acme')).toBe('Acme Value Added Reseller Program');
  });
});

describe('newProgram', () => {
  it('sets the common defaults', () => {
    const p = newProgram('referral', company, ids('pr_1'));
    expect(p).toMatchObject({
      id: 'pr_1', companyId: 'co_1', type: 'referral', name: 'Northwind Security Referral Program', focus: '', updatedAt: '',
      regName: 'Registered', prefName: 'Preferred', notice: 90, plan: true, publish: '', why: [], own: [],
      entry: ['Signed partner agreement', 'One certified sales person'],
      prefReq: { certified: { on: true, people: 2 }, contact: true, register: true, pipeline: true, qbr: true, brand: true },
    });
    expect(p.reg).toEqual(['dealreg', 'playbook', 'demo', 'listing', 'training', 'docs', 'portal']);
    expect(p.pref).toEqual(['dealprio', 'leads', 'toplisting', 'comarketing', 'funds', 'badge', 'early', 'manager', 'escalation']);
    expect(p.money).toMatchObject({ pattern: 'lifetime', base: 'year', years: 3, payout: 'customer', payDays: 30, rewards: '', fee: { reg: 500, pref: 750 } });
  });

  it('referral kind', () => {
    for (const t of ['referral', 'co-seller', 'broker'] as ProgramType[]) {
      const p = newProgram(t, company, ids('pr_1'));
      expect(p.money.model).toBe('commission');
      expect(p.money.rates).toEqual({ reg: [15, 5, 0], pref: [20, 10, 0] });
      expect(p.bars).toEqual([{ label: 'Referred customers who sign', value: 4, unit: 'a year' }]);
      expect(p.prefOn).toBe(true);
      expect(p.run).toEqual({ manager: 60000, funds: 15000, training: 10000, deals: 20 });
    }
  });

  it('resale kind', () => {
    for (const t of ['reseller', 'var', 'distributor', 'vad'] as ProgramType[]) {
      const p = newProgram(t, company, ids('pr_1'));
      expect(p.money.model).toBe('margin');
      expect(p.money.rates).toEqual({ reg: [25, 25, 25], pref: [30, 30, 30] });
      expect(p.bars).toEqual([
        { label: 'New customers', value: 5, unit: 'a year' },
        { label: 'Revenue through you, in €', value: 150000, unit: 'a year' },
      ]);
      expect(p.entry).toEqual(['Signed partner agreement', 'One certified sales person', 'Passes the partner qualification check']);
      expect(p.prefOn).toBe(true);
    }
    expect(newProgram('reseller', { ...company, currency: 'CHF' }, ids('x')).bars[1]!.label).toBe('Revenue through you, in CHF');
  });

  it('services kind', () => {
    for (const t of ['managed', 'fulfillment', 'solution', 'system-integrator'] as ProgramType[]) {
      const p = newProgram(t, company, ids('pr_1'));
      expect(p.money.model).toBe('commission');
      expect(p.money.rates).toEqual({ reg: [10, 0, 0], pref: [15, 5, 0] });
      expect(p.bars).toEqual([
        { label: 'Implementations completed', value: 3, unit: 'a year' },
        { label: 'Customer satisfaction score', value: 85, unit: '%' },
      ]);
      expect(p.entry).toEqual(['Signed partner agreement', 'Two trained consultants']);
      expect(p.prefOn).toBe(true);
    }
  });

  it('affiliate kind', () => {
    const p = newProgram('affiliate', company, ids('pr_1'));
    expect(p.money.model).toBe('commission');
    expect(p.money.rates).toEqual({ reg: [20, 0, 0], pref: [25, 0, 0] });
    expect(p.money.pattern).toBe('oneoff');
    expect(p.prefOn).toBe(false);
    expect(p.reg).toEqual(['listing', 'portal', 'docs']);
    expect(p.pref).toEqual([]);
    expect(p.entry).toEqual(['Accepted terms and a tracking link']);
    expect(p.bars).toEqual([{ label: 'Customers who sign', value: 10, unit: 'a year' }]);
    expect(p.run).toEqual({ manager: 15000, funds: 5000, training: 2000, deals: 40 });
  });

  it('reward kind', () => {
    for (const t of ['content', 'ambassador'] as ProgramType[]) {
      const p = newProgram(t, company, ids('pr_1'));
      expect(p.money.model).toBe('none');
      expect(p.money.rewards).toBe('Free license, early access, a speaking slot at our customer event');
      expect(p.reg).toEqual(['listing', 'early', 'portal']);
      expect(p.pref).toEqual(['toplisting', 'comarketing', 'badge', 'roadmap', 'sponsor']);
      expect(p.entry).toEqual(['Signed partner agreement']);
      expect(p.bars).toEqual([{ label: 'Pieces of content or events', value: 4, unit: 'a year' }]);
      expect(p.run).toEqual({ manager: 10000, funds: 8000, training: 0, deals: 5 });
      expect(p.prefOn).toBe(true);
    }
  });

  it('does not share arrays between programs', () => {
    const a = newProgram('reseller', company, ids('a'));
    const b = newProgram('reseller', company, ids('b'));
    a.reg.push('x');
    a.money.rates.reg[0] = 99;
    expect(b.reg).not.toContain('x');
    expect(b.money.rates.reg[0]).toBe(25);
  });
});

describe('copyProgram', () => {
  const source = () => {
    const p = newProgram('reseller', company, ids('pr_src'));
    p.focus = 'DACH';
    p.name = 'Northwind Reseller DACH';
    p.why = ['A reason'];
    p.goals = 'Reach more';
    p.pref.push('board');
    p.own = [{ k: 'own_abcd1234', g: 'Selling', n: 'Free lunch' }];
    p.reg.push('own_abcd1234');
    p.prefReq.certified = { on: false, people: 3 };
    p.bars[0]!.value = 9;
    p.money.rates.reg = [28, 28, 28];
    p.run.deals = 33;
    p.updatedAt = '2026-10-26T10:00:00Z';
    return p;
  };

  it('same type keeps every answer with a new id and name (copy)', () => {
    const s = source();
    const c = copyProgram(s, 'reseller', company, ids('pr_new'));
    expect(c).toEqual({ ...s, id: 'pr_new', focus: '', name: 'Northwind Reseller DACH (copy)', updatedAt: '' });
  });

  it('to var uses the default name and keeps the margin', () => {
    const c = copyProgram(source(), 'var', company, ids('pr_new'));
    expect(c.type).toBe('var');
    expect(c.name).toBe('Northwind Security Value Added Reseller Program');
    expect(c.money.model).toBe('margin');
    expect(c.money.rates.reg).toEqual([28, 28, 28]);
  });

  it('to referral resets money but keeps the rest', () => {
    const s = source();
    const c = copyProgram(s, 'referral', company, ids('pr_new'));
    expect(c.money).toEqual(newProgram('referral', company, ids('x')).money);
    expect(c.why).toEqual(['A reason']);
    expect(c.goals).toBe('Reach more');
    expect(c.pref).toEqual(s.pref);
    expect(c.own).toEqual(s.own);
    expect(c.bars).toEqual(s.bars);
    expect(c.run).toEqual(s.run);
    expect(c.prefReq.certified).toEqual({ on: false, people: 3 });
  });

  it('deep copies', () => {
    const s = source();
    const c = copyProgram(s, 'reseller', company, ids('pr_new'));
    c.own[0]!.n = 'Changed';
    c.reg.push('zzz');
    c.bars[0]!.value = 1;
    c.money.rates.reg[0] = 1;
    c.prefReq.certified.people = 9;
    expect(s.own[0]!.n).toBe('Free lunch');
    expect(s.reg).not.toContain('zzz');
    expect(s.bars[0]!.value).toBe(9);
    expect(s.money.rates.reg[0]).toBe(28);
    expect(s.prefReq.certified.people).toBe(3);
  });
});

describe('benefit names and labels', () => {
  it('leaves out empty own benefits and trims', () => {
    const p = newProgram('reseller', company, ids('pr_1'));
    p.own = [{ k: 'own_aaaaaaaa', g: 'Support', n: '  ' }, { k: 'own_bbbbbbbb', g: 'Support', n: ' Hotline ' }];
    expect(benefitNames(p, ['dealreg', 'own_aaaaaaaa', 'own_bbbbbbbb', 'nope'])).toEqual(['Deal registration', 'Hotline']);
  });
  it('labels a program', () => {
    const p = newProgram('reseller', company, ids('pr_1'));
    expect(programLabel(p)).toBe('Reseller');
    p.focus = 'DACH';
    expect(programLabel(p)).toBe('Reseller · DACH');
  });
});

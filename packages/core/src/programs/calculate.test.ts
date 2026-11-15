import { describe, expect, it } from 'vitest';
import { costCheck, customerValue, directRatio, earn, formatMoney, formatPerOne, levelCheck, survival } from './calculate';
import { brightpage, northwind } from './examples';

const nw = northwind();
const [reseller, consulting] = nw.programs;
const bp = brightpage();
const [referral] = bp.programs;
const clone = <T,>(x: T): T => structuredClone(x);

describe('fixtures', () => {
  it('customer value and survival', () => {
    expect(customerValue(nw)).toBeCloseTo(79711.8, 2);
    expect(customerValue(bp)).toBeCloseTo(17801.43, 2);
    expect(survival(nw)[2]).toBeCloseTo(0.81, 5);
  });
  it.each([
    ['Reseller', nw, reseller, 19927.95, 23913.54, 24177.95, 28163.54, 0.3033, 0.3533, 0.4],
    ['Consulting', nw, consulting, 1800, 5485.59, 6050, 9735.59, 0.0759, 0.1221, 0.4],
    ['Referral', bp, referral, 480, 480, 3230, 3230, 0.1814, 0.1814, null],
  ] as const)('%s numbers', (_n, c, p, reg, pref, costReg, costPref, rr, rp, direct) => {
    const r = costCheck(c, p);
    expect(r.reg.total).toBeCloseTo(reg, 2);
    expect(r.pref!.total).toBeCloseTo(pref, 2);
    expect(r.running).toBeCloseTo(c === nw ? 4250 : 2750, 2);
    expect(r.costReg).toBeCloseTo(costReg, 2);
    expect(r.costPref).toBeCloseTo(costPref, 2);
    expect(r.ratioReg).toBeCloseTo(rr, 4);
    expect(r.ratioPref).toBeCloseTo(rp, 4);
    if (direct === null) expect(r.direct).toBeNull();
    else expect(r.direct).toBeCloseTo(direct, 4);
  });
  it('directRatio', () => {
    expect(directRatio(nw)).toBeCloseTo(0.4, 4);
    expect(directRatio(bp)).toBeNull();
    expect(directRatio({ ...nw, spend: 0 })).toBeNull();
  });
});

describe('cost check call-outs', () => {
  it('reseller good', () => {
    expect(costCheck(nw, reseller).callout).toEqual({ tone: 'good', text: 'Partners cost you €0.30 to €0.35 of every €1 a customer brings in. Selling direct costs you €0.40.' });
  });
  it('consulting good', () => {
    expect(costCheck(nw, consulting).callout).toEqual({ tone: 'good', text: 'Partners cost you €0.08 to €0.12 of every €1 a customer brings in. Selling direct costs you €0.40.' });
  });
  it('brightpage info', () => {
    expect(costCheck(bp, referral).callout).toEqual({ tone: 'info', text: "Partners cost you $0.18 of every $1 a customer brings in. Add last year's sales and marketing spend and revenue under Company facts to compare with selling direct." });
  });
  it('warns when Preferred margin is 50', () => {
    const p = clone(reseller);
    p.money.rates.pref = [50, 50, 50];
    const r = costCheck(nw, p);
    expect(r.pref!.total).toBeCloseTo(39855.9, 2);
    expect(r.callout).toEqual({ tone: 'warn', text: 'Through Preferred partners a customer costs you €0.55 of every €1 it brings in. Selling direct costs you €0.40.' });
  });
  it('one level: warn drops the level name', () => {
    const p = clone(reseller);
    p.money.rates.reg = [50, 50, 50];
    p.prefOn = false;
    const r = costCheck(nw, p);
    expect(r.pref).toBeNull();
    expect(r.costPref).toBeNull();
    expect(r.ratioPref).toBeNull();
    expect(r.callout.text).toMatch(/^Through partners a customer costs you/);
    expect(r.callout.tone).toBe('warn');
  });
  it('empty and zero inputs stay finite', () => {
    const c = { ...clone(nw), yearly: 0, once: 0, renew: 0 };
    const p = clone(reseller);
    p.money.rates = { reg: [0, 0, 0], pref: [0, 0, 0] };
    p.run.deals = 0;
    const r = costCheck(c, p);
    for (const v of [r.reg.first, r.reg.total, r.pref!.total, r.running, r.costReg, r.costPref!, r.value]) expect(Number.isFinite(v)).toBe(true);
    expect(r.ratioReg).toBeNull();
    expect(r.ratioPref).toBeNull();
    expect(r.callout).toEqual({ tone: 'info', text: 'Fill in what a typical customer pays under Company facts to see what partners cost you.' });
    expect(levelCheck(c, p).every((x) => !/NaN|Infinity/.test(x.text))).toBe(true);
  });
});

describe('earn', () => {
  it('one-off commission on a contract pays yearly x first x years', () => {
    const p = clone(referral);
    p.money.base = 'contract';
    p.money.years = 3;
    expect(earn(bp, p, 'reg').total).toBeCloseTo(4800 * 0.1 * 3, 6);
  });
  it('none earns 0 and never warns "earn the same"', () => {
    const p = clone(consulting);
    p.money.model = 'none';
    expect(earn(nw, p, 'pref')).toEqual({ first: 0, total: 0 });
    expect(levelCheck(nw, p).some((x) => /earn the same/.test(x.text))).toBe(false);
  });
  it('fee is flat', () => {
    const p = clone(referral);
    p.money.model = 'fee';
    expect(earn(bp, p, 'pref')).toEqual({ first: 750, total: 750 });
  });
});

describe('level check', () => {
  it('good sentences', () => {
    expect(levelCheck(nw, reseller)).toEqual([{ tone: 'good', text: 'Preferred adds 9 benefits and €3,986 more per customer over five years.' }]);
    expect(levelCheck(nw, consulting)).toEqual([{ tone: 'good', text: 'Preferred adds 9 benefits and €3,686 more per customer over five years.' }]);
  });
  it('brightpage warns twice', () => {
    expect(levelCheck(bp, referral)).toEqual([
      { tone: 'warn', text: 'Can a partner feel the difference? Only 1 thing is different from Registered.' },
      { tone: 'warn', text: 'Preferred partners earn the same as Registered.' },
    ]);
  });
  it('one level is info', () => {
    const p = clone(reseller);
    p.prefOn = false;
    expect(levelCheck(nw, p)).toEqual([{ tone: 'info', text: 'This program has one level only. Turn on Preferred to give partners something to grow into.' }]);
  });
  it('no bars adds a warning', () => {
    const p = clone(reseller);
    p.bars = [];
    expect(levelCheck(nw, p)).toEqual([{ tone: 'warn', text: 'Add at least one performance bar, so partners know what it takes.' }]);
  });
  it('an own benefit ticked only for Preferred counts as extra', () => {
    const p = clone(referral);
    p.own = [{ k: 'own_abcd1234', g: 'Selling', n: 'Free audit' }];
    p.pref = ['toplisting', 'own_abcd1234'];
    expect(levelCheck(bp, p)[0]!.text).toBe('Can a partner feel the difference? Only 2 things are different from Registered.');
  });
  it('an own benefit without a name doesn’t count as extra', () => {
    const p = clone(referral);
    p.own = [{ k: 'own_abcd1234', g: 'Selling', n: '   ' }];
    p.pref = ['toplisting', 'own_abcd1234'];
    expect(levelCheck(bp, p)[0]!.text).toBe('Can a partner feel the difference? Only 1 thing is different from Registered.');
  });
  it('a performance bar without a label doesn’t count as one', () => {
    const p = clone(reseller);
    p.bars = [{ label: '  ', value: 5, unit: 'a year' }];
    expect(levelCheck(nw, p)).toEqual([{ tone: 'warn', text: 'Add at least one performance bar, so partners know what it takes.' }]);
  });
  it('a level without a name reads as Registered or Preferred', () => {
    const p = clone(referral);
    p.regName = '';
    p.prefName = '  ';
    expect(levelCheck(bp, p)).toEqual([
      { tone: 'warn', text: 'Can a partner feel the difference? Only 1 thing is different from Registered.' },
      { tone: 'warn', text: 'Preferred partners earn the same as Registered.' },
    ]);
    const q = clone(reseller);
    q.prefName = '';
    expect(levelCheck(nw, q)[0]!.text).toBe('Preferred adds 9 benefits and €3,986 more per customer over five years.');
    const r = clone(reseller);
    r.prefName = '';
    r.money.rates.pref = [50, 50, 50];
    expect(costCheck(nw, r).callout.text).toMatch(/^Through Preferred partners a customer costs you/);
  });
});

describe('a typical customer worth nothing', () => {
  const zero = { ...clone(nw), yearly: 0, once: 0 };
  it('a Reseller whose Preferred margin is higher is "up": no "earn the same", no money in the good sentence', () => {
    expect(costCheck(zero, reseller).moneyUp).toBe(true);
    expect(levelCheck(zero, reseller)).toEqual([{ tone: 'good', text: 'Preferred adds 9 benefits.' }]);
  });
  it('equal rates still warn "earn the same"', () => {
    const p = clone(reseller);
    p.money.rates.pref = [...p.money.rates.reg];
    expect(costCheck(zero, p).moneyUp).toBe(false);
    expect(levelCheck(zero, p)).toContainEqual({ tone: 'warn', text: 'Preferred partners earn the same as Registered.' });
  });
  it.each([
    ['lifetime: one rate higher, none lower', 'commission', 'lifetime', [15, 5, 0], [20, 5, 0], true],
    ['lifetime: one higher, one lower', 'commission', 'lifetime', [15, 5, 0], [20, 4, 0], false],
    ['one-off: the renewal rate does not count', 'commission', 'oneoff', [10, 0, 0], [10, 5, 0], false],
    ['one-off: a higher once rate does not count (nothing is paid once)', 'commission', 'oneoff', [10, 0, 0], [10, 0, 5], false],
    ['one-off: a higher first-year rate', 'commission', 'oneoff', [10, 0, 0], [15, 0, 0], true],
    ['signs plus renewals: only the once rate higher does not count', 'commission', 'lifetime', [15, 5, 0], [15, 5, 5], false],
    ['margin: only the margin rate counts', 'margin', 'lifetime', [25, 0, 0], [25, 9, 9], false],
  ] as const)('%s', (_n, model, pattern, reg, pref, up) => {
    const p = clone(referral);
    p.money = { ...p.money, model, pattern, rates: { reg: [...reg], pref: [...pref] } };
    expect(costCheck({ ...clone(bp), yearly: 0, once: 0 }, p).moneyUp).toBe(up);
  });
  it('a higher flat fee is up; no payment never is', () => {
    const p = clone(referral);
    p.money = { ...p.money, model: 'fee', fee: { reg: 500, pref: 750 } };
    expect(costCheck({ ...clone(bp), yearly: 0, once: 0 }, p).moneyUp).toBe(true);
    p.money = { ...p.money, model: 'fee', fee: { reg: 500, pref: 500 } };
    expect(costCheck({ ...clone(bp), yearly: 0, once: 0 }, p).moneyUp).toBe(false);
    p.money = { ...p.money, model: 'none', rates: { reg: [10, 0, 0], pref: [20, 0, 0] } };
    expect(costCheck({ ...clone(bp), yearly: 0, once: 0 }, p).moneyUp).toBe(false);
  });
});

describe('formatting', () => {
  it('formats money', () => {
    expect(formatMoney(3985.59, 'EUR')).toBe('€3,986');
    expect(formatMoney(1200, 'USD')).toBe('$1,200');
    expect(formatPerOne(0.3533, 'EUR')).toBe('€0.35');
    expect(formatPerOne(0, 'GBP')).toBe('£0.00');
  });
});

import { describe, expect, it } from 'vitest';
import { brightpage, northwind } from './examples';
import { hiddenPaths, keepHiddenSaved } from './hidden';
import { newProgram } from './new-program';
import type { CompanyFacts, Program } from './types';
import { parseProgram } from './validate';

const NW = northwind();
const { programs: [reseller, consulting], ...nwCompany } = NW;
const company: CompanyFacts = nwCompany;
const ids = (id: string) => ({ id, companyName: '' });
const BP = brightpage();
const { programs: [referral], ...bpCompany } = BP;

describe('hiddenPaths', () => {
  it('a margin hides the renewal and once rates, the fee and the contract length', () => {
    expect(hiddenPaths(reseller, company)).toEqual(['money.fee', 'money.years', 'money.rates.reg.1', 'money.rates.reg.2', 'money.rates.pref.1', 'money.rates.pref.2']);
  });

  it('without a Preferred level, the Preferred step and the Preferred rates are hidden', () => {
    expect(hiddenPaths({ ...reseller, prefOn: false }, company)).toEqual(expect.arrayContaining(['prefName', 'prefReq', 'bars', 'notice', 'money.rates.pref', 'money.fee.pref']));
  });

  it('a commission shows what its pattern asks for, and the once rate only when a customer pays something once', () => {
    expect(hiddenPaths(consulting, company)).toEqual(['money.fee', 'money.years']);
    expect(hiddenPaths(referral, bpCompany)).toEqual(['money.fee', 'money.rates.reg.1', 'money.rates.pref.1', 'money.years', 'money.rates.reg.2', 'money.rates.pref.2']);
    expect(hiddenPaths({ ...referral, money: { ...referral.money, base: 'contract' } }, bpCompany)).not.toContain('money.years');
  });

  it('the certified people are hidden while that requirement is off', () => {
    expect(hiddenPaths({ ...reseller, prefReq: { ...reseller.prefReq, certified: { on: false, people: 2 } } }, company)).toContain('prefReq.certified.people');
  });
});

describe('keepHiddenSaved', () => {
  const withPref150 = (p: Program): Program => ({ ...p, money: { ...p.money, rates: { ...p.money.rates, pref: [150, 30, 30] } } });

  it('takes the saved answer for a hidden answer with a mistake, and keeps everything else as on screen', () => {
    const screen = { ...withPref150(reseller), prefOn: false, money: { ...withPref150(reseller).money, payDays: 45 } };
    const sent = keepHiddenSaved(screen, reseller, company);
    expect(parseProgram(sent).ok).toBe(true);
    expect(sent.money.rates.pref).toEqual(reseller.money.rates.pref);
    expect(sent.money.payDays).toBe(45);
    expect(sent.prefOn).toBe(false);
  });

  it('leaves a mistake the screen shows, so the owner is told', () => {
    const screen = withPref150(reseller);
    expect(keepHiddenSaved(screen, reseller, company)).toBe(screen);
  });

  it('keeps a hidden answer without a mistake as it is on screen', () => {
    const screen = { ...reseller, prefOn: false, money: { ...reseller.money, rates: { ...reseller.money.rates, pref: [40, 30, 30] as [number, number, number] } } };
    expect(keepHiddenSaved(screen, reseller, company)).toBe(screen);
  });

  it('takes the starting answer when nothing usable was saved', () => {
    const screen = { ...reseller, prefOn: false, bars: [{ label: 'x', value: -5, unit: 'a year' }] };
    const sent = keepHiddenSaved(screen, null, company);
    expect(sent.bars).toEqual(newProgram('reseller', company, ids(reseller.id)).bars);
    expect(parseProgram(sent).ok).toBe(true);
  });
});

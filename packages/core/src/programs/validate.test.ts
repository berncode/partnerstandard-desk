import { describe, expect, it } from 'vitest';
import { brightpage, northwind } from './examples';
import { parseCompanyFacts, parseProgram } from './validate';
import type { CompanyFacts, Program } from './types';

const clone = <T,>(x: T): T => structuredClone(x);
const withProgs = [northwind(), brightpage()];
const programs = withProgs.flatMap((c) => c.programs);
const companies: CompanyFacts[] = withProgs.map((c) => { const d: Partial<typeof c> = clone(c); delete d.programs; delete d.name; return d as CompanyFacts; });

const company = (f: (c: CompanyFacts) => void) => { const c = clone(companies[0]!); f(c); return parseCompanyFacts(c); };
const prog = (f: (p: Program) => void, i = 0) => { const p = clone(programs[i]!); f(p); return parseProgram(p); };
const messages = (r: { ok: boolean; issues?: { message: string }[] }) => (r.ok ? [] : r.issues!.map((i) => i.message));

describe('fixtures', () => {
  it.each(companies.map((c, i) => [withProgs[i]!.name, c] as const))('company %s passes unchanged', (_n, c) => {
    const r = parseCompanyFacts(c);
    expect(r.ok && r.company).toEqual(c);
  });
  it.each(programs.map((p) => [p.id, p] as const))('program %s passes unchanged', (_n, p) => {
    const r = parseProgram(p);
    expect(r.ok && r.program).toEqual(p);
  });
  it('trims strings', () => {
    const r = company((c) => { c.rules.handover = '  Hand over.  '; });
    expect(r.ok && r.company.rules.handover).toBe('Hand over.');
  });
  it('refuses things that are not objects', () => {
    expect(parseCompanyFacts(null).ok).toBe(false);
    expect(parseProgram('x').ok).toBe(false);
  });
});

describe('company limits', () => {
  it('has no name: the company name lives in Settings', () => {
    const r = parseCompanyFacts({ ...companies[0], name: 'Acme' });
    expect(r.ok && r.company).not.toHaveProperty('name');
  });
  it('currency', () => {
    expect(messages(company((c) => { (c as { currency: string }).currency = 'JPY'; }))).toContain('Pick a currency from the list.');
  });
  it('percent and money', () => {
    expect(messages(company((c) => { c.renew = 101; }))).toContain('Customers who renew must be between 0 and 100.');
    expect(messages(company((c) => { c.renew = -1; }))).toContain('Customers who renew must be between 0 and 100.');
    expect(messages(company((c) => { c.yearly = 1_000_000_001; }))).toContain('Pays every year must be between 0 and 1,000,000,000.');
    expect(messages(company((c) => { c.once = 1.234; }))).toContain('Pays once can have at most 2 decimals.');
    expect(messages(company((c) => { c.spend = -5; }))).toContain("Sales and marketing, last year must be between 0 and 1,000,000,000.");
    expect(company((c) => { c.revenue = null; }).ok).toBe(true);
  });
  it('numbers must be finite numbers', () => {
    expect(messages(company((c) => { c.yearly = NaN; }))).toContain('Pays every year must be a number.');
    expect(messages(company((c) => { c.yearly = Infinity; }))).toContain('Pays every year must be a number.');
    expect(messages(company((c) => { (c as { renew: unknown }).renew = '90'; }))).toContain('Customers who renew must be a number.');
  });
  it('rules', () => {
    expect(messages(company((c) => { c.rules.protect = 3651; }))).toContain('A registered deal is protected for: enter a number from 0 to 3,650 days.');
    expect(messages(company((c) => { c.rules.protect = NaN; }))).toContain('A registered deal is protected for: enter a number from 0 to 3,650 days.');
    expect(messages(company((c) => { c.rules.extend = 1.5; }))).toContain('Extension while working on it: enter a whole number of days.');
    expect(messages(company((c) => { c.rules.answer = -1; }))).toContain('You answer within: enter a number from 0 to 3,650 hours.');
    expect(messages(company((c) => { c.rules.handover = 'x'.repeat(2001); }))).toContain('Handover to your sales team must be 2,000 characters or fewer.');
    expect(messages(company((c) => { (c.rules as { conflict: string }).conflict = 'x'; }))).toContain('Pick an answer for When two register the same customer.');
  });
  it('ids and date', () => {
    expect(messages(company((c) => { c.id = ''; }))).toContain("This item's id is missing.");
    expect(company((c) => { c.updatedAt = ''; }).ok).toBe(true);
  });
});

describe('program limits', () => {
  it('name and text', () => {
    expect(messages(prog((p) => { p.name = ''; }))).toContain("Program name can't be empty.");
    expect(messages(prog((p) => { p.name = 'x'.repeat(81); }))).toContain('Program name must be 80 characters or fewer.');
    expect(messages(prog((p) => { p.focus = 'x'.repeat(201); }))).toContain('Focus must be 200 characters or fewer.');
    expect(messages(prog((p) => { p.goals = 'x'.repeat(2001); }))).toContain('Goals must be 2,000 characters or fewer.');
    expect(messages(prog((p) => { p.money.rewards = 'x'.repeat(2001); }))).toContain('Rewards instead of cash must be 2,000 characters or fewer.');
  });
  it('numbers', () => {
    expect(messages(prog((p) => { p.notice = 3651; }))).toContain('Notice before moving a partner down: enter a number from 0 to 3,650 days.');
    expect(messages(prog((p) => { p.money.payDays = 0.5; }))).toContain('Paid within: enter a whole number of days.');
    expect(messages(prog((p) => { p.money.years = 0; }))).toContain('First contract runs: enter a number from 1 to 10 years.');
    expect(messages(prog((p) => { p.money.years = 11; }))).toContain('First contract runs: enter a number from 1 to 10 years.');
    expect(messages(prog((p) => { p.run.deals = 100_001; }))).toContain('New customers you expect from it must be between 0 and 100,000.');
    expect(messages(prog((p) => { p.run.manager = 1.005; }))).toContain('Partner manager time can have at most 2 decimals.');
    expect(messages(prog((p) => { p.money.rates.reg[1] = 120; }))).toContain('Registered: Every year the customer renews must be between 0 and 100.');
    expect(messages(prog((p) => { p.money.fee.pref = -1; }))).toContain('Preferred flat fee must be between 0 and 1,000,000,000.');
    expect(messages(prog((p) => { p.prefReq.certified.people = 0; }))).toContain('Certified people must be between 1 and 1,000.');
    expect(messages(prog((p) => { p.prefReq.certified.people = 1001; }))).toContain('Certified people must be between 1 and 1,000.');
  });
  it('lists', () => {
    expect(messages(prog((p) => { p.why = Array(11).fill('x'); }))).toContain('Add up to 10 reasons.');
    expect(messages(prog((p) => { p.entry = Array(21).fill('x'); }))).toContain('Add up to 20 entry rules.');
    expect(messages(prog((p) => { p.bars = Array(21).fill({ label: 'a', value: 1, unit: 'b' }); }))).toContain('Add up to 20 bars.');
    expect(messages(prog((p) => { p.own = Array.from({ length: 41 }, (_, i) => ({ k: `own_${String(i).padStart(8, '0')}`, g: 'Selling' as const, n: 'x' })); }))).toContain('Add up to 40 own benefits.');
    expect(messages(prog((p) => { p.bars = [{ label: 'a', value: -1, unit: 'b' }]; }))).toContain('Performance bar row 1: At least must be between 0 and 1,000,000,000.');
    expect(messages(prog((p) => { p.bars = [{ label: 'a', value: 1, unit: 'b' }, { label: 'b', value: NaN, unit: 'b' }]; })))
      .toContain('Performance bar row 2: At least must be a number.');
    expect(messages(prog((p) => { p.bars = [{ label: 'x'.repeat(201), value: 1, unit: 'b' }]; }))).toContain('Performance bar row 1: What you measure must be 200 characters or fewer.');
    expect(messages(prog((p) => { p.bars = [{ label: 'a', value: 1, unit: 'x'.repeat(201) }]; }))).toContain('Performance bar row 1: Unit must be 200 characters or fewer.');
    expect(messages(prog((p) => { p.why = ['Fine', 'x'.repeat(201)]; }))).toContain('Reason 2 must be 200 characters or fewer.');
    expect(messages(prog((p) => { p.entry = ['x'.repeat(201)]; }))).toContain('Requirement 1 must be 200 characters or fewer.');
    expect(messages(prog((p) => { p.own = [{ k: 'own_abcdefgh', g: 'Selling', n: 'x'.repeat(201) }]; }))).toContain('Your own benefit must be 200 characters or fewer.');
  });
  it('benefit keys', () => {
    expect(messages(prog((p) => { p.reg = ['nope']; }))).toContain('Registered benefits can only use standard benefits or your own.');
    expect(messages(prog((p) => { p.own = [{ k: 'own_abcdefgh', g: 'Selling', n: 'Free lunch' }]; p.pref = ['own_abcdefgh']; })).length).toBe(0);
    expect(messages(prog((p) => { p.pref = ['own_zzzzzzzz']; }))).toContain('Preferred benefits can only use standard benefits or your own.');
  });
  it('type and model', () => {
    expect(messages(prog((p) => { (p as { type: string }).type = 'oem'; }))).toContain('Not covered: OEM deals are negotiated one by one, not run as a standard program.');
    expect(messages(prog((p) => { (p as { type: string }).type = 'wizard'; }))).toContain('Pick a partner type from the list.');
    for (const t of ['co-seller', 'system-integrator']) expect(messages(prog((p) => { (p as { type: string }).type = t; }))).not.toContain('Pick a partner type from the list.');
    expect(messages(prog((p) => { p.type = 'system-integrator'; p.money.model = 'fee'; }, 1))).toContain("Flat fee isn't a way to pay System Integrators.");
    expect(messages(prog((p) => { (p as { type: string }).type = 'other'; }))).toContain('Not covered: a partnership that fits none of the types has no standard program.');
    expect(messages(prog((p) => { p.money.model = 'margin'; }, 2))).toContain("Margin isn't a way to pay Referral Partners.");
    expect(messages(prog((p) => { p.money.model = 'none'; }, 2))).toContain("No payment isn't a way to pay Referral Partners.");
    expect(messages(prog((p) => { p.money.model = 'fee'; }, 2))).toEqual([]);
    expect(messages(prog((p) => { p.money.model = 'commission'; }, 0))).toContain("Commission isn't a way to pay Resellers.");
    expect(messages(prog((p) => { (p.money as { model: string }).model = 'bonus'; }))).toContain('Pick how partners are paid.');
  });
  it('plurals and untrusted keys', () => {
    expect(messages(prog((p) => { p.type = 'solution'; p.money.model = 'fee'; }, 1))).toContain("Flat fee isn't a way to pay Solution Partners.");
    expect(messages(prog((p) => { p.type = 'ambassador'; p.money.model = 'margin'; }, 2))).toContain("Margin isn't a way to pay Brand Ambassadors and Influencers.");
    expect(messages(prog((p) => { (p as { type: string }).type = 'constructor'; }))).toContain('Pick a partner type from the list.');
    expect(messages(prog((p) => { (p.money as { model: string }).model = 'toString'; }))).toContain('Pick how partners are paid.');
  });
  it('publish date', () => {
    expect(prog((p) => { p.publish = ''; }).ok).toBe(true);
    expect(messages(prog((p) => { p.publish = '2027-02-30'; }))).toContain('Publish the criteria on must be a real date, like 2027-01-15.');
    expect(messages(prog((p) => { p.publish = 'soon'; }))).toContain('Publish the criteria on must be a real date, like 2027-01-15.');
  });
  it('names a rate by its row on the screen, which follows the pay model', () => {
    // Northwind's Reseller pays a margin; its Consulting Partner a referral fee when the customer signs, plus every
    // renewal; Brightpage's Referral Partner a one-off commission on the first year.
    expect(messages(prog((p) => { p.money.rates.pref[0] = 150; }, 0))).toEqual(['Preferred: Margin, every year the customer stays must be between 0 and 100.']);
    expect(messages(prog((p) => { p.money.rates.reg[0] = -1; }, 1))).toEqual(['Registered: When the customer signs, on the first year must be between 0 and 100.']);
    expect(messages(prog((p) => { p.money.rates.reg[0] = -1; }, 2))).toEqual(['Registered: Of the first year must be between 0 and 100.']);
    expect(messages(prog((p) => { p.money.base = 'contract'; p.money.rates.reg[0] = -1; }, 2))).toEqual(['Registered: Of the whole first contract must be between 0 and 100.']);
    expect(messages(prog((p) => { p.money.rates.pref[2] = NaN; }, 2))).toEqual(['Preferred: Of what the customer pays once must be a number.']);
  });

  it('says each problem in a list row without the row too, for a stored record that names the row itself', () => {
    const r = prog((p) => { p.bars = [{ label: 'a', value: 1, unit: 'b' }, { label: 'b', value: NaN, unit: 'b' }]; p.why = ['Fine', 'x'.repeat(201)]; });
    expect(!r.ok && r.issues.map(({ path, located }) => [path, located])).toEqual([
      ['why.1', 'Reason must be 200 characters or fewer.'],
      ['bars.1.value', 'At least must be a number.'],
    ]);
    const days = company((c) => { c.rules.protect = 3651; });
    expect(!days.ok && days.issues[0]!.located).toBe('Enter a number from 0 to 3,650 days.');
  });

  it('reports the path', () => {
    const r = prog((p) => { p.money.years = 0; });
    expect(!r.ok && r.issues[0]!.path).toBe('money.years');
  });
});

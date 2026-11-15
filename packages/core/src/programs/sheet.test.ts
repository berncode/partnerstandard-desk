import { describe, expect, it } from 'vitest';
import { brightpage, northwind } from './examples';
import { OUTPUT_NOTE, publicBlocks, publicPlain } from './public-page';
import { newCompanyFacts } from './new-program';
import { programSheet, rateLine } from './sheet';
import type { CompanyFacts, Program } from './types';

const nw = northwind();
const [reseller, consulting] = nw.programs;
const bp = brightpage();
const [referral] = bp.programs;
const clone = <T,>(x: T): T => structuredClone(x);
const plain = (c: CompanyFacts, p: Program) => publicPlain(publicBlocks(c, p));

const RESELLER = `# The Northwind Security Reseller Program
For IT resellers who sell security software to mid-sized companies and want a product their customers renew every year.

## Why partners join
- A security product your customers ask for, which opens doors to new accounts.
- Leads from us in your region.
- Certification that makes your team the security experts your customers trust.
- Installation and support work around every customer.

## Who it is for
IT reseller, 20 to 200 people, at least two sales people selling security, existing customers in manufacturing.

## What Registered partners get
- Deal registration
- Sales playbook and battle cards
- Demo account
- Listing in your partner directory
- Product training and certification
- Technical documentation
- Partner portal and community

## Grow into a Preferred partner
Preferred partners get everything above, plus:
- Higher margin: 30% margin off your suggested price, every year
- First in line on deal registration
- Leads passed on from you
- Top spot in your partner directory
- Joint marketing: webinars, case studies, events
- Funds for partner marketing
- Certificate and badge
- Early access to new features
- A dedicated partner manager
- Faster escalation
What it takes, checked every year:
- New customers: at least 5 a year
- Revenue through you, in €: at least 150,000 a year
- Certified people working on your product: at least 2
- A named contact for the partnership
- Registers every deal it works on
- Joint pipeline review every quarter
- Quarterly business review
- Represents your brand correctly

## What you earn
You earn 25% margin off your suggested price, every year. As a Preferred partner: 30% margin off your suggested price, every year.

## Your deals are protected
Register a deal and it is yours for 90 days, with one 30-day extension while you are working on it. We answer within 48 hours. If our own team closes a deal you registered, you are still paid in full.

## Become a partner
Apply on this page and we will be in touch within a week.`;
const CONSULTING = `# The Northwind Security Consulting Partner Program
For consultancies and integrators who implement and run security projects for their clients.

## Why partners join
- An implementation project with every new customer.
- Certified consultants your clients can rely on.
- Early access to new features, so you can plan projects ahead.

## Who it is for
Consultancy with a security practice and at least two consultants who can be certified.

## What Registered partners get
- Deal registration
- Sales playbook and battle cards
- Demo account
- Listing in your partner directory
- Product training and certification
- Technical documentation
- Partner portal and community

## Grow into a Preferred partner
Preferred partners get everything above, plus:
- Higher commission: 15% when the customer signs, then 5% every year the customer renews
- First in line on deal registration
- Leads passed on from you
- Top spot in your partner directory
- Joint marketing: webinars, case studies, events
- Funds for partner marketing
- Certificate and badge
- Early access to new features
- A dedicated partner manager
- Faster escalation
What it takes, checked every year:
- Implementations completed: at least 3 a year
- Customer satisfaction score: at least 85 %
- Certified people working on your product: at least 2
- A named contact for the partnership
- Registers every deal it works on
- Joint pipeline review every quarter
- Quarterly business review
- Represents your brand correctly

## What you earn
You earn 10% when the customer signs, nothing on renewals. As a Preferred partner: 15% when the customer signs, then 5% every year the customer renews.

## Your deals are protected
Register a deal and it is yours for 90 days, with one 30-day extension while you are working on it. We answer within 48 hours. If our own team closes a deal you registered, you are still paid in full.

## Become a partner
Apply on this page and we will be in touch within a week.`;
const REFERRAL = `# The Brightpage Referral Program
For marketing agencies whose clients publish brochures and catalogs.

## Why partners join
- A tool your clients thank you for recommending.
- Your agency listed in our partner directory.

## Who it is for
Marketing agency with publishing clients.

## What Registered partners get
- Deal registration
- Sales playbook and battle cards
- Demo account
- Listing in your partner directory
- Product training and certification
- Technical documentation
- Partner portal and community

## Grow into a Preferred partner
Preferred partners get everything above, plus:
- Top spot in your partner directory
What it takes, checked every year:
- Referred customers who sign: at least 4 a year
- Certified people working on your product: at least 2
- A named contact for the partnership
- Registers every deal it works on
- Joint pipeline review every quarter
- Quarterly business review
- Represents your brand correctly

## What you earn
You earn 10% of the first year, one-off. As a Preferred partner: 10% of the first year, one-off.

## Your deals are protected
Register a deal and it is yours for 60 days, with one 30-day extension while you are working on it. We answer within 48 hours. If our own team closes a deal you registered, you are still paid in full.

## Become a partner
Apply on this page and we will be in touch within a week.`;

describe('public page', () => {
  it('Northwind Reseller matches prototype 2', () => expect(plain(nw, reseller)).toBe(RESELLER));
  it('Consulting matches prototype 2 with ruling 5', () => expect(plain(nw, consulting)).toBe(CONSULTING));
  it('Brightpage matches prototype 2 with ruling 4', () => {
    expect(plain(bp, referral)).toBe(REFERRAL);
    expect(plain(bp, referral)).not.toContain('Higher commission');
    expect(plain(bp, referral)).toContain('Register a deal and it is yours for 60 days');
  });
  it('a program without payment has no protection section and rewards in the earn line', () => {
    const p = clone(referral);
    p.money.model = 'none';
    p.money.rewards = 'Early access and a listing';
    const t = plain(bp, p);
    expect(t).not.toContain('Your deals are protected');
    expect(t).toContain('We reward you with early access and a listing.');
    expect(t).not.toContain('Higher');
  });
  it('a flat fee reads per new customer', () => {
    const p = clone(reseller);
    p.money.model = 'fee';
    p.money.fee = { reg: 500, pref: 800 };
    const t = plain(nw, p);
    expect(t).toContain('You earn €500 for every new customer. As a Preferred partner: €800 per new customer.');
    expect(t).toContain('- Higher fee: €800 per new customer');
  });
  it('has no em dash and exports blocks', () => {
    for (const [c, p] of [[nw, reseller], [nw, consulting], [bp, referral]] as const) expect(plain(c, p)).not.toContain('—');
    expect(publicBlocks(nw, reseller)[0]).toEqual({ h1: 'The Northwind Security Reseller Program' });
  });
  it('with Preferred off there is no grow section', () => {
    const p = clone(reseller);
    p.prefOn = false;
    expect(plain(nw, p)).not.toContain('Grow into');
    expect(plain(nw, p)).toContain('You earn 25% margin off your suggested price, every year.');
  });
});

describe('public page: blanks and gaps', () => {
  it('a level without a name reads as Registered or Preferred', () => {
    const p = clone(reseller);
    p.regName = '';
    p.prefName = '   ';
    const t = plain(nw, p);
    expect(t).toContain('## What Registered partners get');
    expect(t).toContain('## Grow into a Preferred partner');
    expect(t).toContain('Preferred partners get everything above, plus:');
    expect(t).toContain('As a Preferred partner: 30% margin off your suggested price, every year.');
    expect(t).not.toMatch(/What {2}partners|a {2}partner|^ partners/m);
  });
  it('leaves out performance bars without a label', () => {
    const p = clone(reseller);
    p.bars = [{ label: '', value: 3, unit: 'a year' }, ...p.bars];
    const t = plain(nw, p);
    expect(t).not.toMatch(/^- : at least/m);
    expect(t).toContain('- New customers: at least 5 a year');
  });
  it('without Registered benefits there is no Registered heading, and Preferred partners get what is listed', () => {
    const p = clone(reseller);
    p.reg = [];
    const t = plain(nw, p);
    expect(t).not.toContain('What Registered partners get');
    expect(t).not.toContain('everything above');
    expect(t).toContain('Preferred partners get:\n- Higher margin');
  });
  it('rewards keep their capitals, except a sentence’s first letter', () => {
    const p = clone(referral);
    p.money.model = 'none';
    p.money.rewards = 'Free license and a SAP training slot';
    expect(plain(bp, p)).toContain('We reward you with free license and a SAP training slot.');
    p.money.rewards = 'SAP training.';
    expect(plain(bp, p)).toContain('We reward you with SAP training.');
  });
  it('no payment and no rewards: no What you earn section at all', () => {
    const p = clone(referral);
    p.money.model = 'none';
    p.money.rewards = '  ';
    const t = plain(bp, p);
    expect(t).not.toContain('What you earn');
    expect(t).not.toContain('We reward you with');
    expect(t).toContain('## Become a partner');
  });
});

describe('rateLine', () => {
  it('covers the models', () => {
    expect(rateLine(nw, reseller, 'pref')).toBe('30% margin off your suggested price, every year');
    expect(rateLine(nw, consulting, 'reg')).toBe('10% when the customer signs, nothing on renewals');
    expect(rateLine(bp, referral, 'reg')).toBe('10% of the first year, one-off');
    const p = clone(consulting);
    p.money.rates.reg = [10, 5, 20];
    expect(rateLine(nw, p, 'reg')).toBe('10% when the customer signs, then 5% every year the customer renews, and 20% of what the customer pays once');
    p.money.model = 'none';
    expect(rateLine(nw, p, 'reg')).toBe('no cash');
  });
});

describe('programSheet', () => {
  it('Northwind Reseller', () => {
    const s = programSheet(nw, reseller, nw.name);
    expect(s.eyebrow).toBe('Partner Program Sheet · internal');
    expect(s.name).toBe('Northwind Security Reseller Program');
    expect(s.facts.map((f) => f.label)).toEqual(['Program lead', 'Partner type', 'Levels']);
    expect(s.facts[2]!.value).toBe('Registered → Preferred');
    expect(s.money[1]).toBe('Per typical customer over five years: partners earn €19,928 (Preferred: €23,914); with running costs a customer through this program costs you €24,178 to €28,164. That is €0.30 to €0.35 of every €1 the customer brings in, compared with €0.40 when you sell direct.');
    expect(s.levels.columns).toEqual(['', 'Registered', 'Preferred']);
    expect(s.levels.rows.map((r) => r.label)).toEqual(['To get there', 'What they get', 'What they earn', 'Keeping it']);
    const get = s.levels.rows[1]!.cells;
    expect(Array.isArray(get[0])).toBe(true);
    expect((get[1] as string[])[0]).toBe('Everything in Registered');
    expect(s.levels.rows[2]!.cells[1]).toBe('30% margin off your suggested price, every year');
    expect(s.levels.rows[3]!.cells[1]).toContain("Checked every year. 90 days' notice and an improvement plan before moving down.");
    expect(s.rules[1]).toBe('A registered deal is protected for 90 days, with one 30-day extension while the partner is working on it. You answer within 48 hours.');
    expect(s.rollout).toBe('Pilot with Two current resellers: Alpen IT and Nordlicht Systems. Criteria published on 2027-01-15.');
    expect(s.footer).toEqual(['Northwind Security · internal, not for partners', 'Made with PartnerStandard Desk']);
  });
  it('Focus appears only when set', () => {
    const p = clone(reseller);
    p.focus = 'DACH';
    expect(programSheet(nw, p, nw.name).facts.map((f) => f.label)).toContain('Focus');
    expect(programSheet(nw, reseller, nw.name).facts.map((f) => f.label)).not.toContain('Focus');
  });
  it('empty Basics say Not set yet.', () => {
    const p = clone(referral);
    Object.assign(p, { goals: '', ipp: '', icp: '', kpis: '', enablement: '', tools: '', why: [], entry: [], pilots: '', publish: '' });
    const s = programSheet(bp, p, bp.name);
    for (const v of [s.goals, s.ipp, s.icp, s.kpis, s.enablement, s.tools]) expect(v).toBe('Not set yet.');
    expect(s.why).toEqual(['Not set yet.']);
    expect(s.levels.rows[0]!.cells[0]).toEqual(['Not set yet.']);
    expect(s.rollout).toBeNull();
  });
  it('no direct figure drops the comparison; no customer value drops the ratios', () => {
    const s = programSheet(bp, referral, bp.name);
    expect(s.money[1]).toMatch(/^Per typical customer over five years: partners earn \$480 \(Preferred: \$480\);/);
    expect(s.money[1]).toContain('That is $0.18 of every $1 the customer brings in.');
    expect(s.money[1]).not.toContain('compared with');
    expect(s.money[2]).toBe('Company facts has no sales and marketing or revenue for last year. Fill in both to compare partners with selling direct.');
    // Review Focus 4: a typical customer worth nothing gives no money figures at all, never €0.
    const c = clone(bp);
    c.yearly = 0; c.once = 0;
    const z = programSheet(c, referral, c.name).money;
    expect(z[1]).toBe('Fill in what a typical customer pays under Company facts to see what partners cost you.');
    expect(z.join(' ')).not.toMatch(/\$0\b|NaN|Infinity/);
  });
  it('Review Focus 4: empty Company facts say what to fill in, never NaN, 0 or Infinity', () => {
    const empty = newCompanyFacts(nw.id);
    const s = programSheet(empty, reseller, 'Northwind Security');
    expect(s.money.slice(1)).toEqual([
      'Fill in what a typical customer pays under Company facts to see what partners cost you.',
      'Company facts has no sales and marketing or revenue for last year. Fill in both to compare partners with selling direct.',
    ]);
    expect(JSON.stringify(s)).not.toMatch(/€0\b|€0\.00|NaN|Infinity/);
  });
  it('a flat fee with no typical customer keeps what partners earn: only margin and commission need the customer', () => {
    const c = { ...newCompanyFacts(bp.id), currency: 'USD' as const };
    const p = clone(referral);
    p.money.model = 'fee';
    p.money.fee = { reg: 500, pref: 800 };
    const money = programSheet(c, p, bp.name).money;
    expect(money[1]).toMatch(/^Per typical customer over five years: partners earn \$500 \(Preferred: \$800\);/);
    expect(money[1]).not.toContain('That is');
    expect(money[2]).toContain('Fill in both to compare partners with selling direct.');
  });
  it('a known direct figure adds no line about it', () => {
    expect(programSheet(nw, reseller, nw.name).money).toHaveLength(2);
  });
  it('a program without payment says no cash', () => {
    const p = clone(referral);
    p.money.model = 'none';
    p.money.rewards = 'Early access';
    expect(programSheet(bp, p, bp.name).money[0]).toBe('No cash. Rewards: Early access');
  });
  it('one level only has one column and no Keeping it', () => {
    const p = clone(reseller);
    p.prefOn = false;
    const s = programSheet(nw, p, nw.name);
    expect(s.levels.columns).toEqual(['', 'Registered']);
    expect(s.levels.rows.map((r) => r.label)).not.toContain('Keeping it');
    expect(s.facts[2]!.value).toBe('Registered');
  });
  it('a level without a name reads as Registered or Preferred', () => {
    const p = clone(reseller);
    p.regName = ' ';
    p.prefName = '';
    const s = programSheet(nw, p, nw.name);
    expect(s.facts[2]!.value).toBe('Registered → Preferred');
    expect(s.levels.columns).toEqual(['', 'Registered', 'Preferred']);
    expect((s.levels.rows[1]!.cells[1] as string[])[0]).toBe('Everything in Registered');
    expect(s.money[1]).toContain('(Preferred: €23,914)');
  });
  it('leaves out blank entry rules and performance bars without a label', () => {
    const p = clone(reseller);
    p.entry = ['', 'Signed partner agreement', '   '];
    p.bars = [{ label: ' ', value: 3, unit: 'a year' }, { label: 'New customers', value: 5, unit: 'a year' }];
    const s = programSheet(nw, p, nw.name);
    expect(s.levels.rows[0]!.cells[0]).toEqual(['Signed partner agreement']);
    expect((s.levels.rows[0]!.cells[1] as string[])[0]).toBe('New customers: at least 5 a year');
    p.entry = ['  '];
    expect(programSheet(nw, p, nw.name).levels.rows[0]!.cells[0]).toEqual(['Not set yet.']);
  });
  it('no payment and no rewards says the rewards are not set yet', () => {
    const p = clone(referral);
    p.money.model = 'none';
    p.money.rewards = '';
    expect(programSheet(bp, p, bp.name).money[0]).toBe('No cash. Rewards: Not set yet.');
  });
  it('a number that is not one yet (being typed) reads as 0, never NaN', () => {
    const p = clone(consulting);
    p.money.rates.reg = [NaN, Number('x'), 5];
    p.money.rates.pref = [Number(''), 5, 5];
    p.bars = [{ label: 'Projects', value: NaN, unit: 'a year' }];
    p.prefReq.certified.people = NaN;
    p.notice = NaN;
    p.money.payDays = NaN;
    const s = JSON.stringify(programSheet(nw, p, nw.name));
    expect(s).not.toContain('NaN');
    expect(rateLine(nw, p, 'reg')).toBe('0% when the customer signs, nothing on renewals, and 5% of what the customer pays once');
    expect(s).toContain('Projects: at least 0 a year');
    const q = clone(referral);
    q.money.base = 'contract';
    q.money.years = NaN;
    expect(rateLine(bp, q, 'reg')).not.toContain('NaN');
    expect(plain(nw, p)).not.toContain('NaN');
  });
  it('no string has an em dash, nor NaN', () => {
    for (const [c, p] of [[nw, reseller], [nw, consulting], [bp, referral]] as const) {
      const j = JSON.stringify(programSheet(c, p, c.name));
      expect(j).not.toContain('—');
      expect(j).not.toContain('NaN');
    }
  });
});

describe('OUTPUT_NOTE', () => {
  it('reads as specified', () => expect(OUTPUT_NOTE('26 Oct 2026')).toBe('Made by PartnerStandard Desk from your answers. Last updated 26 Oct 2026. Changes here are overwritten; change the answers in the tool.'));
});

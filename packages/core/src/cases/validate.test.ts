import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples';
import type { BusinessCase, CaseOffer } from './types';
import { parseCase, parseOffer, parseStoredCase } from './validate';

const clone = <T,>(v: T): T => structuredClone(v);
const GONE = 'This case’s partner type is no longer in its offer. Pick another type.';

function offerIssues(offer: unknown) {
  const r = parseOffer(offer);
  if (r.ok) throw new Error('expected issues');
  return r.issues;
}
function caseIssues(c: unknown) {
  const r = parseCase(c);
  if (r.ok) throw new Error('expected issues');
  return r.issues;
}
function offerWith(edit: (o: CaseOffer) => void) {
  const o = clone(EXAMPLES.saas.case.offer);
  edit(o);
  return o;
}
function caseWith(edit: (c: BusinessCase) => void) {
  const c = clone(EXAMPLES.saas.case);
  edit(c);
  return c;
}
const loose = (v: unknown) => v as Record<string, unknown>;

describe('parseOffer', () => {
  it('passes every example offer unchanged, as a new object', () => {
    for (const ex of Object.values(EXAMPLES)) {
      const input = clone(ex.case.offer);
      const r = parseOffer(input);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.offer).toEqual(ex.case.offer);
        expect(r.offer).not.toBe(input);
        expect(r.offer.products[0]).not.toBe(input.products[0]);
      }
    }
  });

  it('trims names and company', () => {
    const r = parseOffer(offerWith((o) => {
      o.company = '  Acme  ';
      o.products[0]!.name = ' Pro ';
      o.types[0]!.name = ' Referral ';
    }));
    expect(r.ok && r.offer.company).toBe('Acme');
    expect(r.ok && r.offer.products[0]!.name).toBe('Pro');
    expect(r.ok && r.offer.types[0]!.name).toBe('Referral');
  });

  it('refuses anything that is not an offer', () => {
    expect(parseOffer(null).ok).toBe(false);
    expect(parseOffer('x').ok).toBe(false);
  });

  it('refuses a price below 0 with a plain message and a path', () => {
    expect(offerIssues(offerWith((o) => { o.products[0]!.price = -1; }))).toContainEqual({
      path: 'products.0.price',
      message: 'Price must be 0 or more.',
    });
  });

  it('refuses too large amounts and more than 2 decimals', () => {
    expect(offerIssues(offerWith((o) => { o.products[0]!.price = 1_000_000_001; }))).toContainEqual({
      path: 'products.0.price',
      message: 'Price must be 1,000,000,000 or less.',
    });
    expect(offerIssues(offerWith((o) => { o.products[0]!.price = 10.123; }))).toContainEqual({
      path: 'products.0.price',
      message: 'Price can have at most 2 decimals.',
    });
    expect(parseOffer(offerWith((o) => { o.products[0]!.price = 1_000_000_000; o.products[1]!.price = 10.12; })).ok).toBe(true);
  });

  it('refuses strings, NaN and Infinity as numbers', () => {
    for (const bad of ['600', Number.NaN, Infinity, -Infinity, null]) {
      const issues = offerIssues(offerWith((o) => { loose(o.products[0]).price = bad; }));
      expect(issues).toContainEqual({ path: 'products.0.price', message: 'Price must be a number.' });
    }
  });

  it('limits names and company to 1 to 80 characters after trimming', () => {
    expect(offerIssues(offerWith((o) => { o.company = '   '; }))).toContainEqual({
      path: 'company',
      message: 'Company name must be at least 1 character.',
    });
    expect(offerIssues(offerWith((o) => { o.company = 'a'.repeat(81); }))).toContainEqual({
      path: 'company',
      message: 'Company name must be 80 characters or fewer.',
    });
    expect(parseOffer(offerWith((o) => { o.company = ` ${'a'.repeat(80)} `; })).ok).toBe(true);
    expect(offerIssues(offerWith((o) => { o.products[1]!.name = ''; }))).toContainEqual({
      path: 'products.1.name',
      message: 'Product name must be at least 1 character.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.name = 'b'.repeat(81); }))).toContainEqual({
      path: 'types.0.name',
      message: 'Partner type name must be 80 characters or fewer.',
    });
  });

  it('limits percentages to 0 to 100', () => {
    expect(offerIssues(offerWith((o) => { o.renewal = 101; }))).toContainEqual({
      path: 'renewal',
      message: 'Customers who renew must be 100 or less.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.registered.first = -5; }))).toContainEqual({
      path: 'types.0.registered.first',
      message: 'First year rate must be 0 or more.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.preferred.once = 100.5; }))).toContainEqual({
      path: 'types.0.preferred.once',
      message: 'One-time rate must be 100 or less.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.roles.lead = 101; }))).toContainEqual({
      path: 'types.0.roles.lead',
      message: 'Lead share must be 100 or less.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.roles.lead = -1; }))).toContainEqual({
      path: 'types.0.roles.lead',
      message: 'Lead share must be 0 or more.',
    });
  });

  it('limits the share of partner services to a percent and the partner fee to money', () => {
    expect(offerIssues(offerWith((o) => { o.types[0]!.registered.servicesShare = 101; }))).toContainEqual({
      path: 'types.0.registered.servicesShare',
      message: 'Your share of partner services must be 100 or less.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.preferred.servicesShare = -1; }))).toContainEqual({
      path: 'types.0.preferred.servicesShare',
      message: 'Your share of partner services must be 0 or more.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.fee = -1; }))).toContainEqual({
      path: 'types.0.fee',
      message: 'Partner fee must be 0 or more.',
    });
    expect(offerIssues(offerWith((o) => { o.types[0]!.fee = 12.345; }))).toContainEqual({
      path: 'types.0.fee',
      message: 'Partner fee can have at most 2 decimals.',
    });
    expect(offerIssues(offerWith((o) => { delete (o.types[0] as Partial<typeof o.types[0]>).fee; }))).toContainEqual({
      path: 'types.0.fee',
      message: 'Partner fee must be a number.',
    });
    expect(parseOffer(offerWith((o) => { o.types[0]!.registered.servicesShare = 100; o.types[0]!.fee = 2500.5; })).ok).toBe(true);
  });

  it('limits preferred deals to a whole number from 1 to 10,000', () => {
    expect(offerIssues(offerWith((o) => { o.preferred.deals = 0; }))).toContainEqual({
      path: 'preferred.deals',
      message: 'Preferred deals must be 1 or more.',
    });
    expect(offerIssues(offerWith((o) => { o.preferred.deals = 10_001; }))).toContainEqual({
      path: 'preferred.deals',
      message: 'Preferred deals must be 10,000 or less.',
    });
    expect(offerIssues(offerWith((o) => { o.preferred.deals = 2.5; }))).toContainEqual({
      path: 'preferred.deals',
      message: 'Preferred deals must be a whole number.',
    });
  });

  it('checks the Preferred revenue and year', () => {
    expect(offerIssues(offerWith((o) => { o.preferred.revenue = -1; }))).toContainEqual({
      path: 'preferred.revenue',
      message: 'Preferred revenue must be 0 or more.',
    });
    expect(offerIssues(offerWith((o) => { o.preferred.revenue = 1.234; }))).toContainEqual({
      path: 'preferred.revenue',
      message: 'Preferred revenue can have at most 2 decimals.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.preferred).year = 1; }))).toContainEqual({
      path: 'preferred.year',
      message: 'Preferred year must be 2 or more.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.preferred).year = 6; }))).toContainEqual({
      path: 'preferred.year',
      message: 'Preferred year must be 5 or less.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.preferred).year = 2.5; }))).toContainEqual({
      path: 'preferred.year',
      message: 'Preferred year must be a whole number.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.preferred).rule = 'luck'; }))).toContainEqual({
      path: 'preferred.rule',
      message: 'Pick deals, revenue or year for Preferred.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.preferred).on = 'yes'; }))).toContainEqual({
      path: 'preferred.on',
      message: 'Pick yes or no for Preferred.',
    });
  });

  it('allows up to 20 products and refuses 21', () => {
    const mk = (n: number) => offerWith((o) => {
      o.products = Array.from({ length: n }, (_, i) => ({ ...o.products[0]!, id: `p${i}` }));
    });
    expect(parseOffer(mk(20)).ok).toBe(true);
    expect(offerIssues(mk(21))).toContainEqual({ path: 'products', message: 'Add up to 20 products.' });
  });

  it('holds exactly one partner type: the one the case is for', () => {
    const mk = (n: number) => offerWith((o) => {
      o.types = Array.from({ length: n }, (_, i) => ({ ...o.types[0]!, id: `t${i}`, name: `Type ${i}` }));
    });
    expect(parseOffer(mk(1)).ok).toBe(true);
    expect(offerIssues(mk(2))).toContainEqual({ path: 'types', message: 'A case is for one partner type.' });
    expect(offerIssues(mk(0))).toContainEqual({ path: 'types', message: 'A case is for one partner type.' });
  });

  it('refuses a case with two entries in offer.types', () => {
    const issues = caseIssues(caseWith((c) => { c.offer.types = [c.offer.types[0]!, { ...c.offer.types[0]!, id: 'other', name: 'Other' }]; }));
    expect(issues).toContainEqual({ path: 'offer.types', message: 'A case is for one partner type.' });
  });

  it('needs both level names', () => {
    expect(offerIssues(offerWith((o) => { o.levels.registered = ' '; }))).toContainEqual({
      path: 'levels.registered',
      message: 'Level name must be at least 1 character.',
    });
  });

  it('refuses a currency or support level outside the lists, and non-boolean roles', () => {
    expect(offerIssues(offerWith((o) => { loose(o).currency = 'JPY'; }))).toContainEqual({
      path: 'currency',
      message: 'Pick a currency from the list.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.types[0]!.roles).support = 'level3'; }))).toContainEqual({
      path: 'types.0.roles.support',
      message: 'Pick the support the partner provides.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.types[0]!.roles).closes = 'yes'; }))).toContainEqual({
      path: 'types.0.roles.closes',
      message: 'Pick yes or no for who closes the deal.',
    });
    expect(offerIssues(offerWith((o) => { loose(o.types[0]!.roles).services = 1; }))).toContainEqual({
      path: 'types.0.roles.services',
      message: 'Pick yes or no for whether the partner provides services.',
    });
  });
});

describe('the PartnerStandard Desk fields of a case', () => {
  it('refuses a note outside TermNote', () => {
    expect(caseIssues(caseWith((c) => { loose(c).notes = ['free-pizza']; }))).toContainEqual({
      path: 'notes.0',
      message: 'Pick a note from the list.',
    });
  });

  it('takes every TermNote, a null program and a null recalculation date', () => {
    const r = parseCase(caseWith((c) => {
      c.notes = ['flat-fee', 'contract-years', 'bars', 'pref-req', 'no-program', 'no-program-type'];
      c.programId = null;
      c.recalculatedAt = null;
    }));
    expect(r.ok).toBe(true);
  });

  it('takes a program id and a recalculation date', () => {
    expect(parseCase(caseWith((c) => { c.programId = 'pg_1'; c.recalculatedAt = '2026-10-30T09:00:00.000Z'; })).ok).toBe(true);
  });

  it('refuses a partner type or stage outside the lists, and a missing partner id', () => {
    expect(caseIssues(caseWith((c) => { loose(c).partnerType = 'wizard'; }))).toContainEqual({
      path: 'partnerType',
      message: 'Pick a partner type from the list.',
    });
    expect(caseIssues(caseWith((c) => { loose(c).stageWhenMade = 'lost'; }))).toContainEqual({
      path: 'stageWhenMade',
      message: 'Pick a stage from the list.',
    });
    expect(caseIssues(caseWith((c) => { c.partnerId = ''; }))).toContainEqual({ path: 'partnerId', message: 'Id must not be empty.' });
  });
});

describe('parseCase', () => {
  it('passes every example case unchanged, as a new object', () => {
    for (const ex of Object.values(EXAMPLES)) {
      const input = clone(ex.case);
      const r = parseCase(input);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.case).toEqual(ex.case);
        expect(r.case).not.toBe(input);
        expect(r.case.deals).not.toBe(input.deals);
        expect(r.case.costs[0]).not.toBe(input.costs[0]);
        expect(r.case.ours.alone.deals).not.toBe(input.ours.alone.deals);
      }
    }
  });

  it('trims the partner name and cost names', () => {
    const r = parseCase(caseWith((c) => { c.partner = '  Northwind '; c.costs[0]!.name = ' Training '; }));
    expect(r.ok && r.case.partner).toBe('Northwind');
    expect(r.ok && r.case.costs[0]!.name).toBe('Training');
  });

  it('limits deals to whole numbers from 0 to 10,000', () => {
    expect(caseIssues(caseWith((c) => { c.deals[2] = -1; }))).toContainEqual({
      path: 'deals.2',
      message: 'Deals in year 3 must be 0 or more.',
    });
    expect(caseIssues(caseWith((c) => { c.deals[0] = 10_001; }))).toContainEqual({
      path: 'deals.0',
      message: 'Deals in year 1 must be 10,000 or less.',
    });
    expect(caseIssues(caseWith((c) => { c.deals[4] = 1.5; }))).toContainEqual({
      path: 'deals.4',
      message: 'Deals in year 5 must be a whole number.',
    });
    expect(caseIssues(caseWith((c) => { loose(c).deals = [1, 2, 3]; }))).toContainEqual({
      path: 'deals',
      message: 'Enter deals for all 5 years.',
    });
  });

  it('limits the money fields and the service profit', () => {
    expect(caseIssues(caseWith((c) => { c.implementation = -1; }))).toContainEqual({
      path: 'implementation',
      message: 'Implementation must be 0 or more.',
    });
    expect(caseIssues(caseWith((c) => { c.managed = 1.234; }))).toContainEqual({
      path: 'managed',
      message: 'Managed services can have at most 2 decimals.',
    });
    expect(caseIssues(caseWith((c) => { c.other = 2e9; }))).toContainEqual({
      path: 'other',
      message: 'Other services must be 1,000,000,000 or less.',
    });
    expect(caseIssues(caseWith((c) => { c.serviceProfit = 101; }))).toContainEqual({
      path: 'serviceProfit',
      message: 'Service profit must be 100 or less.',
    });
    expect(caseIssues(caseWith((c) => { c.supportCost = -1; }))).toContainEqual({
      path: 'supportCost',
      message: 'Support cost must be 0 or more.',
    });
  });

  it('allows 20 cost lines and refuses 21', () => {
    const mk = (n: number) => caseWith((c) => {
      c.costs = Array.from({ length: n }, (_, i) => ({ ...c.costs[0]!, id: `c${i}` }));
    });
    expect(parseCase(mk(20)).ok).toBe(true);
    expect(caseIssues(mk(21))).toContainEqual({ path: 'costs', message: 'Add up to 20 costs.' });
  });

  it('checks cost line fields, including the time preferred', () => {
    expect(caseIssues(caseWith((c) => { c.costs[1]!.amount = -3; }))).toContainEqual({
      path: 'costs.1.amount',
      message: 'Cost amount must be 0 or more.',
    });
    expect(caseIssues(caseWith((c) => { c.costs[1]!.name = ''; }))).toContainEqual({
      path: 'costs.1.name',
      message: 'Cost name must be at least 1 character.',
    });
    expect(parseCase(caseWith((c) => { c.costs[1]!.when = 'preferred'; })).ok).toBe(true);
  });

  it('allows up to 4 benefits, all from the list', () => {
    const four = ['New customers', 'Stronger offering', 'Recurring revenue', 'Market credibility'];
    expect(parseCase(caseWith((c) => { c.benefits = four; })).ok).toBe(true);
    expect(caseIssues(caseWith((c) => { c.benefits = [...four, 'Co-marketing budget']; }))).toContainEqual({
      path: 'benefits',
      message: 'Pick up to 4 benefits.',
    });
    expect(caseIssues(caseWith((c) => { c.benefits = ['Free pizza']; }))).toContainEqual({
      path: 'benefits.0',
      message: 'Pick benefits from the list.',
    });
  });

  it('refuses a partner type that is not in the case’s own offer', () => {
    expect(caseIssues(caseWith((c) => { c.typeId = 'nope'; }))).toContainEqual({ path: 'typeId', message: GONE });
    expect(caseIssues(caseWith((c) => { c.offer.types = [{ ...c.offer.types[0]!, id: 'other', name: 'Other' }]; }))).toContainEqual({
      path: 'typeId',
      message: GONE,
    });
  });

  it('reads a stored case whose type id is not its offer’s type: only a save needs it', () => {
    const gone = caseWith((c) => { c.offer.types = [{ ...c.offer.types[0]!, id: 'other', name: 'Other' }]; });
    expect(parseStoredCase(gone)).toEqual({ ok: true, case: gone });
    expect(parseStoredCase(caseWith((c) => { c.typeId = 'nope'; }))).toMatchObject({ ok: true, case: { typeId: 'nope' } });
    // Everything else is still checked.
    expect(parseStoredCase(caseWith((c) => { c.deals[0] = -1; })).ok).toBe(false);
  });

  it('refuses a scenario or starting level outside the lists', () => {
    expect(caseIssues(caseWith((c) => { loose(c).scenario = 'wild'; }))).toContainEqual({
      path: 'scenario',
      message: 'Pick careful, expected or ambitious.',
    });
    expect(caseIssues(caseWith((c) => { loose(c).startsAs = 'gold'; }))).toContainEqual({
      path: 'startsAs',
      message: 'Pick registered or preferred.',
    });
  });

  it('refuses a bad updatedAt date', () => {
    expect(caseIssues(caseWith((c) => { c.updatedAt = 'yesterday'; }))).toContainEqual({
      path: 'updatedAt',
      message: 'Updated must be a date and time.',
    });
  });

  it('validates the case’s own offer with the offer rules', () => {
    expect(caseIssues(caseWith((c) => { c.offer.products[0]!.price = -1; }))).toContainEqual({
      path: 'offer.products.0.price',
      message: 'Price must be 0 or more.',
    });
  });

  describe('shared', () => {
    it('is null or a date and time', () => {
      expect(parseCase(caseWith((c) => { c.shared = null; })).ok).toBe(true);
      expect(parseCase(caseWith((c) => { c.shared = { sharedAt: '2026-10-25T10:00:00.000Z' }; })).ok).toBe(true);
      expect(caseIssues(caseWith((c) => { c.shared = { sharedAt: 'later' }; }))).toContainEqual({
        path: 'shared.sharedAt',
        message: 'Shared must be a date and time.',
      });
    });
  });

  describe('our case', () => {
    const bad = (edit: (c: BusinessCase) => void, path: string, message: string) =>
      expect(caseIssues(caseWith(edit))).toContainEqual({ path, message });

    it('limits our figures and sources', () => {
      bad((c) => { c.ours.figures.margin = -1; }, 'ours.figures.margin', 'Gross margin must be 0 or more.');
      bad((c) => { c.ours.anyway = 101; }, 'ours.anyway', 'Deals won anyway must be 100 or less.');
      bad((c) => { c.ours.figures.serve.close = 1.234; }, 'ours.figures.serve.close', 'Closing a deal can have at most 2 decimals.');
      bad((c) => { loose(c.ours).anywaySource = 'hunch'; }, 'ours.anywaySource', 'Pick where the figure comes from.');
      bad((c) => { loose(c.ours).dealsSource = 'hunch'; }, 'ours.dealsSource', 'Pick where the figure comes from.');
    });

    it('allows 20 of our costs and refuses 21, each with a source', () => {
      const mk = (n: number) => (c: BusinessCase) => {
        c.ours.costs = Array.from({ length: n }, (_, i) => ({ ...c.ours.costs[0]!, id: `o${i}` }));
      };
      expect(parseCase(caseWith(mk(20))).ok).toBe(true);
      bad(mk(21), 'ours.costs', 'Add up to 20 costs.');
      bad((c) => { loose(c.ours.costs[0]).source = 'hunch'; }, 'ours.costs.0.source', 'Pick where the figure comes from.');
      bad((c) => { c.ours.costs[0]!.amount = -1; }, 'ours.costs.0.amount', 'Cost amount must be 0 or more.');
    });

    it('checks efficiency and churn', () => {
      bad((c) => { c.ours.efficiency.from = 0 as never; }, 'ours.efficiency.from', 'From year must be 1 or more.');
      bad((c) => { c.ours.efficiency.from = 6 as never; }, 'ours.efficiency.from', 'From year must be 5 or less.');
      bad((c) => { c.ours.efficiency.from = 2.5 as never; }, 'ours.efficiency.from', 'From year must be a whole number.');
      bad((c) => { c.ours.efficiency.note = 'n'.repeat(201); }, 'ours.efficiency.note', 'Note must be 200 characters or fewer.');
      bad((c) => { loose(c.ours.efficiency).mode = 'fancy'; }, 'ours.efficiency.mode', 'Pick simple or detailed.');
      bad((c) => { c.ours.efficiency.simple = -1; }, 'ours.efficiency.simple', 'Amount per year must be 0 or more.');
      bad((c) => { c.ours.efficiency.hours = -1; }, 'ours.efficiency.hours', 'Hours must be 0 or more.');
      bad((c) => { c.ours.efficiency.hours = 1_000_001; }, 'ours.efficiency.hours', 'Hours must be 1,000,000 or less.');
      bad((c) => { c.ours.efficiency.rate = 1.234; }, 'ours.efficiency.rate', 'Hourly rate can have at most 2 decimals.');
      bad((c) => { c.ours.churn.now = 101; }, 'ours.churn.now', 'Churn now must be 100 or less.');
      bad((c) => { c.ours.churn.withPartner = -1; }, 'ours.churn.withPartner', 'Churn with the partner must be 0 or more.');
      bad((c) => { c.ours.churn.customers = 2.5; }, 'ours.churn.customers', 'Customers must be a whole number.');
      bad((c) => { c.ours.churn.customers = 1_000_001; }, 'ours.churn.customers', 'Customers must be 1,000,000 or less.');
      bad((c) => { c.ours.churn.revenue = -1; }, 'ours.churn.revenue', 'Revenue per customer must be 0 or more.');
      bad((c) => { loose(c.ours.churn).source = 'hunch'; }, 'ours.churn.source', 'Pick where the figure comes from.');
    });

    it('allows up to 10 strategic reasons of 1 to 200 characters', () => {
      const mk = (n: number) => (c: BusinessCase) => {
        c.ours.strategic = Array.from({ length: n }, (_, i) => ({ id: `r${i}`, text: 'Reason', weight: 'high' as const, alone: false }));
      };
      expect(parseCase(caseWith(mk(10))).ok).toBe(true);
      bad(mk(11), 'ours.strategic', 'Add up to 10 reasons.');
      bad((c) => { c.ours.strategic[0]!.text = ''; }, 'ours.strategic.0.text', 'Write the reason, or remove it.');
      bad((c) => { c.ours.strategic[0]!.text = '   '; }, 'ours.strategic.0.text', 'Write the reason, or remove it.');
      bad((c) => { c.ours.strategic[0]!.text = 'x'.repeat(201); }, 'ours.strategic.0.text', 'Reason must be 200 characters or fewer.');
      bad((c) => { loose(c.ours.strategic[0]).weight = 'huge'; }, 'ours.strategic.0.weight', 'Pick high, medium or low.');
      expect(parseCase(caseWith((c) => { c.ours.strategic[0]!.text = 'x'.repeat(200); })).ok).toBe(true);
    });

    it('checks the alone plan', () => {
      bad((c) => { c.ours.alone.share = -1; }, 'ours.alone.share', 'Share must be 0 or more.');
      bad((c) => { c.ours.alone.share = 501; }, 'ours.alone.share', 'Share must be 500 or less.');
      bad((c) => { c.ours.alone.delay = 37; }, 'ours.alone.delay', 'Delay must be 36 or less.');
      bad((c) => { c.ours.alone.delay = 1.5; }, 'ours.alone.delay', 'Delay must be a whole number.');
      bad((c) => { c.ours.alone.delay = -1; }, 'ours.alone.delay', 'Delay must be 0 or more.');
      bad((c) => { c.ours.alone.setup = -1; }, 'ours.alone.setup', 'Setup cost must be 0 or more.');
      bad((c) => { c.ours.alone.fixed = 1.234; }, 'ours.alone.fixed', 'Yearly cost can have at most 2 decimals.');
      bad((c) => { c.ours.alone.deals[1] = -1; }, 'ours.alone.deals.1', 'Deals in year 2 must be 0 or more.');
      bad((c) => { c.ours.alone.deals[3] = 10_001; }, 'ours.alone.deals.3', 'Deals in year 4 must be 10,000 or less.');
      bad((c) => { loose(c.ours.alone).deals = [1, 2]; }, 'ours.alone.deals', 'Enter deals for all 5 years.');
      bad((c) => { loose(c.ours.alone).mode = 'x'; }, 'ours.alone.mode', 'Pick simple or detailed.');
      bad((c) => { c.ours.alone.costs = Array.from({ length: 21 }, (_, i) => ({ ...c.ours.costs[0]!, id: `a${i}` })); }, 'ours.alone.costs', 'Add up to 20 costs.');
    });

    it('checks the risk and the texts', () => {
      bad((c) => { c.ours.risk.amount = -1; }, 'ours.risk.amount', 'Risk amount must be 0 or more.');
      bad((c) => { c.ours.risk.from = 6 as never; }, 'ours.risk.from', 'Risk from year must be 5 or less.');
      bad((c) => { c.ours.risk.why = 'w'.repeat(201); }, 'ours.risk.why', 'Why must be 200 characters or fewer.');
      bad((c) => { c.ours.recommendation = 'r'.repeat(1001); }, 'ours.recommendation', 'Recommendation must be 1,000 characters or fewer.');
      bad((c) => { c.ours.ask = 'a'.repeat(1001); }, 'ours.ask', 'Ask must be 1,000 characters or fewer.');
      bad((c) => { c.ours.preparedBy = 'p'.repeat(81); }, 'ours.preparedBy', 'Prepared by must be 80 characters or fewer.');
      expect(parseCase(caseWith((c) => {
        c.ours.recommendation = 'r'.repeat(1000);
        c.ours.ask = 'a'.repeat(1000);
        c.ours.preparedBy = '';
        c.ours.risk.why = '';
      })).ok).toBe(true);
    });
  });
});

import { EXAMPLES, simulateCase, simulateOurCase, type BusinessCase } from '@partner-desk/core';
import { aPartner, sampleBook } from '@partner-desk/core/test-builders';
import { describe, expect, it } from 'vitest';
import { caseCards, caseMoney, caseNumbers, casePath, type ListedCase } from './case-rows';

const example = (): BusinessCase => structuredClone(EXAMPLES.saas.case);

describe('caseNumbers', () => {
  it('gives what the partner earns and our net value over five years, as the case’s tabs work them out, and the stage then', () => {
    const c = example();
    const partner = simulateCase(c);
    expect(caseNumbers(c)).toEqual({
      stageWhenMade: c.stageWhenMade,
      earnings: partner.earnings,
      net: simulateOurCase(c, partner).withPartner.total,
      currency: c.offer.currency,
    });
  });

  it('never gives a negative zero or a number that isn’t one (Review Focus 5)', () => {
    const c = example();
    const empty: BusinessCase = { ...c, deals: [0, 0, 0, 0, 0], costs: [], offer: { ...c.offer, products: [] } };
    const numbers = caseNumbers(empty)!;
    expect(Object.is(numbers.earnings, -0)).toBe(false);
    expect(Object.is(numbers.net, -0)).toBe(false);
    expect(Number.isFinite(numbers.earnings) && Number.isFinite(numbers.net)).toBe(true);
  });

  it('gives no numbers for a case whose partner type isn’t in its offer, and never throws', () => {
    expect(caseNumbers({ ...example(), typeId: 'type_gone' })).toBeNull();
  });
});

describe('caseMoney', () => {
  it('shows whole amounts with the sign, and never "-€0"', () => {
    expect(caseMoney(1234.4, 'EUR')).toBe('€1,234');
    expect(caseMoney(-0.3, 'EUR')).toBe('€0');
    expect(caseMoney(-0, 'USD')).toBe('$0');
    expect(caseMoney(Number.NaN, 'EUR')).toBe('€0');
    expect(caseMoney(-1500, 'EUR')).toBe('-€1,500');
  });
});

describe('caseCards', () => {
  const book = sampleBook({ partners: [aPartner()] });
  const reseller: ListedCase = { caseId: 'case_1', title: 'Case of 30 Oct 2026', partnerId: 'p_abc123', partnerType: 'reseller', createdAt: '2026-10-30T10:00:00.000Z' };

  it('names the partner and type, and links to the partner type’s tab', () => {
    expect(caseCards([reseller], book)).toEqual([{
      caseId: 'case_1', title: 'Case of 30 Oct 2026', createdAt: reseller.createdAt, partnerType: 'reseller',
      heading: 'Acme GmbH as reseller', partner: { company: 'Acme GmbH', href: '/partners/a_abc123?type=reseller' }, typeGone: false,
    }]);
  });

  it('shows a partner type gone from Partners, or of another type now, by the directory’s type, with no partner (Review Focus 2)', () => {
    const gone = { ...reseller, partnerId: 'p_gone' };
    const retyped = { ...reseller, caseId: 'case_2', partnerType: 'technology' as const };
    expect(caseCards([gone, retyped], book)).toMatchObject([
      { caseId: 'case_1', heading: 'Reseller', partner: null, typeGone: true },
      { caseId: 'case_2', heading: 'Technology Partner', partner: null, typeGone: true },
    ]);
  });

  it('shows every card by its type when Partners can’t be read, without saying the type is gone', () => {
    expect(caseCards([reseller], null)).toMatchObject([{ heading: 'Reseller', partner: null, title: 'Case of 30 Oct 2026', typeGone: false }]);
  });
});

describe('casePath', () => {
  it('opens a case on its offer tab', () => {
    expect(casePath('case_abc')).toBe('/business-cases/case_abc/offer');
  });
});

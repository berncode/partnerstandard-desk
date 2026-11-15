import { describe, expect, it } from 'vitest';
import { marketInfo, sampleMarket } from '../test-builders';
import type { Market, ValuePoint } from '../markets/types';
import { newCompanyFacts, newProgram } from './new-program';
import { PROGRAM_TYPES, programTypeOf } from './catalog';
import { clipText, programFromMarket } from './from-market';
import { MAX_LINE, MAX_LONG, parseProgram } from './validate';

const facts = newCompanyFacts('co_abcdefghij');
const ids = { id: 'pr_1', companyName: 'Halden' };
const point = (n: number, state: ValuePoint['state'] = 'confirmed'): ValuePoint => ({
  id: `v_${n}`, kind: 'portfolio', text: `Reason ${n}`, state, evidence: '', checkAgain: false, updatedAt: null, updatedBy: 'Someone',
});
const market = (over: Partial<Market> = {}): Market => {
  const base = sampleMarket();
  return { ...base, info: marketInfo({ marketName: 'DACH', ourTargetCustomers: 'Factories with 200 staff', statement: 'Regional IT firms resell it.' }), ...over };
};

describe('programFromMarket', () => {
  it('fills ideal partner, ideal customer, reasons and focus from a market with a holding hypothesis', () => {
    const m = market({ valuePoints: [1, 2, 3, 4, 5, 6].map((n) => point(n)) });
    const p = programFromMarket('reseller', facts, m, ids);
    expect(p.ipp).toBe('Mid-size IT firms. For example: IT firms with 10-50 staff.');
    expect(p.icp).toBe('Factories with 200 staff');
    expect(p.why).toEqual(['Reason 1', 'Reason 2', 'Reason 3', 'Reason 4', 'Reason 5']);
    expect(p.focus).toBe('DACH');
  });

  it('is a fresh program otherwise', () => {
    const m = market({ valuePoints: [point(1)] });
    const fresh = newProgram('reseller', facts, ids);
    const p = programFromMarket('reseller', facts, m, ids);
    expect({ ...p, ipp: '', icp: '', why: [], focus: '' }).toEqual(fresh);
  });

  it('keeps only confirmed value points, in order', () => {
    const m = market({ valuePoints: [point(1, 'assumption'), point(2), point(3, 'dropped'), point(4)] });
    expect(programFromMarket('reseller', facts, m, ids).why).toEqual(['Reason 2', 'Reason 4']);
  });

  const hyp = (id: string, name: string, status: Market['hypotheses'][number]['status'], lookalike: string) => ({
    ...sampleMarket().hypotheses[0]!, id, name, status, lookalike,
  });
  it('names the first hypothesis that holds, and adds its lookalike when it has one', () => {
    const hypotheses = [hyp('h_1', 'Draft one', 'draft', 'No'), hyp('h_2', 'Regional IT firms', 'holds', ''), hyp('h_3', 'Other firms', 'holds', 'Yes')];
    expect(programFromMarket('reseller', facts, market({ hypotheses }), ids).ipp).toBe('Regional IT firms');
    expect(programFromMarket('reseller', facts, market({ hypotheses: hypotheses.slice(2) }), ids).ipp).toBe('Other firms. For example: Yes.');
  });

  it('leaves the ideal partner empty when no hypothesis holds', () => {
    const base = sampleMarket();
    const hypotheses = base.hypotheses.map((h) => ({ ...h, status: 'draft' as const }));
    const p = programFromMarket('reseller', facts, market({ hypotheses, valuePoints: [point(1)] }), ids);
    expect(p.ipp).toBe('');
    expect(p.icp).toBe('Factories with 200 staff');
  });
});

describe('programFromMarket with long market texts', () => {
  const words = (n: number) => Array.from({ length: Math.ceil(n / 5) }, (_, i) => `w${String(i % 1000).padStart(3, '0')}`).join(' ').slice(0, n);
  const long = market({
    info: marketInfo({ marketName: words(250), ourTargetCustomers: words(2100), statement: '' }),
    valuePoints: [{ ...point(1), text: words(250) }, point(2)],
    hypotheses: [{ ...sampleMarket().hypotheses[0]!, status: 'holds', name: words(1500), lookalike: words(900) }],
  });
  const p = programFromMarket('reseller', facts, long, ids);

  it('clips each copied text to what a program holds, so the program is valid', () => {
    expect(parseProgram(p).ok).toBe(true);
    for (const reason of p.why) expect(reason.length).toBeLessThanOrEqual(MAX_LINE);
    expect(p.focus.length).toBeLessThanOrEqual(MAX_LINE);
    expect(p.icp.length).toBeLessThanOrEqual(MAX_LONG);
    expect(p.ipp.length).toBeLessThanOrEqual(MAX_LONG);
  });
  it('clips on a word boundary and marks the cut with …', () => {
    expect(p.why[0]).toMatch(/ w\d{3}…$/);
    expect(p.focus).toMatch(/ w\d{3}…$/);
    expect(p.icp).toMatch(/ w\d{3}…$/);
    expect(p.why[1]).toBe('Reason 2');
  });
  it('leaves texts that fit as they are', () => {
    const exact = words(MAX_LINE);
    const fits = programFromMarket('reseller', facts, market({ valuePoints: [{ ...point(1), text: exact }] }), ids);
    expect(fits.why).toEqual([exact]);
  });
});

describe('clipText', () => {
  it('cuts a text with no space mid-word, and never splits a character in two', () => {
    expect(clipText('a'.repeat(300), 200)).toBe(`${'a'.repeat(199)}…`);
    const emoji = clipText(`${'a'.repeat(198)}😀😀`, 200);
    expect(emoji).toBe(`${'a'.repeat(198)}…`);
    expect(clipText('  short  ', 200)).toBe('short');
  });
});

describe('program types', () => {
  it('are the PartnerStandard Desk types that Program Designer covers', () => {
    expect(PROGRAM_TYPES).toEqual([
      'referral', 'co-seller', 'reseller', 'distributor', 'var', 'vad', 'broker',
      'affiliate', 'content', 'ambassador', 'managed', 'fulfillment', 'solution', 'system-integrator',
    ]);
  });
  it('programTypeOf reads the type', () => {
    expect(programTypeOf(newProgram('var', facts, ids))).toBe('var');
  });
});

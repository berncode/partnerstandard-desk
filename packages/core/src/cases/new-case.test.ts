import { describe, expect, it } from 'vitest';
import { EXAMPLES } from './examples';
import { emptyOurCase } from './new-case';
import { simulateCase } from './simulate';
import { simulateOurCase } from './our-case';

describe('emptyOurCase', () => {
  const standard = { figures: EXAMPLES.saas.case.ours.figures, ourCosts: EXAMPLES.saas.case.ours.costs };

  it('holds the given figures and costs and nothing else', () => {
    const ours = emptyOurCase(standard.figures, standard.ourCosts);
    expect(ours.figures).toEqual(standard.figures);
    expect(ours.costs).toEqual(standard.ourCosts);
    expect(ours).toMatchObject({
      anyway: 0, anywaySource: 'assumption', dealsSource: 'partner', strategic: [],
      recommendation: '', ask: '', preparedBy: '',
      risk: { amount: 0, from: 1, source: 'assumption', why: '' },
      alone: { mode: 'simple', share: 0, delay: 0, setup: 0, fixed: 0, source: 'assumption', deals: [0, 0, 0, 0, 0], costs: [] },
    });
    const off = { on: false, mode: 'simple', from: 1, source: 'assumption', note: '', alone: false, simple: 0 };
    expect(ours.efficiency).toEqual({ ...off, hours: 0, rate: 0 });
    expect(ours.churn).toEqual({ ...off, customers: 0, revenue: 0, now: 0, withPartner: 0 });
  });

  it('copies, so changing the case never changes the standard', () => {
    const ours = emptyOurCase(standard.figures, standard.ourCosts);
    ours.figures.margin = 1;
    ours.figures.serve.find = 12345;
    ours.costs[0]!.amount = 1;
    expect(standard.figures.margin).not.toBe(1);
    expect(standard.figures.serve.find).not.toBe(12345);
    expect(standard.ourCosts[0]!.amount).not.toBe(1);
    expect(emptyOurCase(standard.figures, standard.ourCosts).alone.deals).not.toBe(ours.alone.deals);
  });

  it('works out to numbers, never NaN', () => {
    const c = { ...structuredClone(EXAMPLES.saas.case), deals: [0, 0, 0, 0, 0] as [number, number, number, number, number], costs: [], ours: emptyOurCase(standard.figures, []) };
    const result = simulateOurCase(c, simulateCase(c));
    const numbers = (v: unknown): number[] => (typeof v === 'number' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(numbers) : []);
    expect(numbers(result).every(Number.isFinite)).toBe(true);
  });
});

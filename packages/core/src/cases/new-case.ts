import type { Figures, OurCase, OurCostLine, Reason } from './types';

const off = (): Reason => ({ on: false, mode: 'simple', from: 1, source: 'assumption', note: '', alone: false, simple: 0 });

/**
 * Our side of a new case: the given figures and cost lines (copied), everything else empty and off. Nothing from an
 * example is ever in it. The caller gives the cost lines their own ids.
 */
export function emptyOurCase(figures: Figures, costs: OurCostLine[]): OurCase {
  return {
    figures: structuredClone(figures),
    costs: structuredClone(costs),
    anyway: 0,
    anywaySource: 'assumption',
    dealsSource: 'partner',
    efficiency: { ...off(), hours: 0, rate: 0 },
    churn: { ...off(), customers: 0, revenue: 0, now: 0, withPartner: 0 },
    strategic: [],
    alone: { mode: 'simple', share: 0, delay: 0, setup: 0, fixed: 0, source: 'assumption', deals: [0, 0, 0, 0, 0], costs: [] },
    risk: { amount: 0, from: 1, source: 'assumption', why: '' },
    recommendation: '',
    ask: '',
    preparedBy: '',
  };
}

/** Every figure 0 and every source an assumption: what Company facts starts with. */
export function emptyFigures(): Figures {
  return {
    margin: 0, marginSource: 'assumption',
    serve: { find: 0, close: 0, salesSource: 'assumption', support1: 0, support2: 0, supportSource: 'assumption', servicesCost: 0, servicesCharge: 0, servicesSource: 'assumption' },
  };
}

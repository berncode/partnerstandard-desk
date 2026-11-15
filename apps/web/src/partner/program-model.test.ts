import { describe, expect, it } from 'vitest';
import { coversType } from './program-model';

describe('coversType', () => {
  it('is true for the types a program can be for, Co-Seller and System Integrator among them', () => {
    for (const t of ['reseller', 'referral', 'co-seller', 'system-integrator', 'solution'] as const) expect(coversType(t)).toBe(true);
  });
  it('is false for the types no program covers', () => {
    for (const t of ['oem', 'technology', 'data', 'integration', 'other'] as const) expect(coversType(t)).toBe(false);
  });
});

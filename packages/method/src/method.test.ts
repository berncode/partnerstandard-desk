import { describe, expect, it } from 'vitest';
import * as method from './index';
import {
  FOUR_C_LABELS,
  PARTNER_TYPES,
  PARTNER_TYPE_LABELS,
  RECRUITMENT_PARTNER_TYPES,
  RECRUITMENT_STEPS,
  STAGES,
  STAGE_LABELS,
  STEP_LABELS,
  VIEWS,
  VIEW_LABELS,
  categoryOf,
} from './index';

function strings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => strings(v, out));
  else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      out.push(k);
      strings(v, out);
    }
  }
  return out;
}

describe('method', () => {
  it('labels every stage, step, view and partner type', () => {
    const pairs: [readonly string[], Record<string, string>][] = [
      [STAGES, STAGE_LABELS],
      [RECRUITMENT_STEPS, STEP_LABELS],
      [VIEWS, VIEW_LABELS],
      [PARTNER_TYPES, PARTNER_TYPE_LABELS],
    ];
    for (const [ids, labels] of pairs) {
      for (const id of ids) expect(labels[id]?.length, id).toBeGreaterThan(0);
    }
  });

  it('offers recruitment only channel and service types', () => {
    expect(RECRUITMENT_PARTNER_TYPES.every((t) => ['channel', 'service'].includes(categoryOf(t) as string))).toBe(true);
    expect(RECRUITMENT_PARTNER_TYPES).toHaveLength(12);
  });

  it('has no em dash in any text', () => {
    for (const s of strings(method)) expect(s.includes('—'), s).toBe(false);
  });

  it('names the four Cs as decided', () => {
    expect(Object.values(FOUR_C_LABELS)).toEqual(['Customer base', 'Credibility', 'Capability', 'Commitment']);
  });
});

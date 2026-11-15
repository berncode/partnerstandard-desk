import { describe, expect, it } from 'vitest';
import { settleHidden } from './issues';

describe('settleHidden', () => {
  const value = { a: Number.NaN, b: -3, list: [{ name: '', amount: Number.NaN }, { name: 'Kept', amount: 7 }], shown: Number.NaN };
  const issues = ['a', 'b', 'list.0.name', 'list.0.amount', 'shown'].map((path) => ({ path, message: 'wrong' }));

  it('puts right only the wrong values under the hidden paths, and keeps everything else', () => {
    expect(settleHidden(value, ['a', 'b', 'list.0'], issues)).toEqual({
      a: 0, b: 0, list: [{ name: 'New cost', amount: 0 }, { name: 'Kept', amount: 7 }], shown: Number.NaN,
    });
  });

  it('goes back to the value kept at the same path, when there is a right one', () => {
    const kept = { a: 4, b: 5, list: [{ name: 'Training', amount: 900 }], shown: 1 };
    expect(settleHidden(value, ['a', 'b', 'list.0'], issues, kept)).toEqual({
      a: 4, b: 5, list: [{ name: 'Training', amount: 900 }, { name: 'Kept', amount: 7 }], shown: Number.NaN,
    });
  });

  it('returns the value as it is when nothing hidden is wrong, and never changes what it was given', () => {
    expect(settleHidden(value, ['list.1'], issues)).toBe(value);
    settleHidden(value, ['a'], issues);
    expect(value.a).toBeNaN();
  });
});

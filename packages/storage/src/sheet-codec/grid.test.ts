import { describe, expect, it } from 'vitest';
import { lastContentRow } from './grid';

describe('lastContentRow', () => {
  it('is the 1-based number of the last row with any content', () => {
    expect(lastContentRow([['ID', 'Company'], ['c_1', 'Acme'], ['', '  '], [], [null]])).toBe(2);
    expect(lastContentRow([])).toBe(0);
    expect(lastContentRow(undefined)).toBe(0);
  });

  it('counts a row whose only content sits in a column the user added', () => {
    expect(lastContentRow([['ID', 'Company', 'My notes'], ['c_1', 'Acme', ''], ['', '', 'call back in May'], ['', '', '']])).toBe(3);
  });

  it('counts numbers and booleans as content', () => {
    expect(lastContentRow([['h'], [0], [false]])).toBe(3);
  });
});

import { describe, expect, it } from 'vitest';
import { cellRange, columnLetter, quoteTab, rowRange, tabRange } from './a1';

describe('A1 notation', () => {
  it('turns 0-based column indexes into letters', () => {
    expect([0, 25, 26, 27, 51, 52, 701, 702].map(columnLetter)).toEqual(['A', 'Z', 'AA', 'AB', 'AZ', 'BA', 'ZZ', 'AAA']);
  });

  it('always quotes tab names and doubles apostrophes', () => {
    expect(quoteTab('Market')).toBe("'Market'");
    expect(quoteTab('Partner hypotheses')).toBe("'Partner hypotheses'");
    expect(quoteTab("Ben's tab")).toBe("'Ben''s tab'");
  });

  it('builds tab, cell and row ranges', () => {
    expect(tabRange('_meta')).toBe("'_meta'");
    expect(cellRange('Candidates', 5, 2)).toBe("'Candidates'!C5");
    expect(rowRange('Candidates', 5, 0, 28)).toBe("'Candidates'!A5:AC5");
  });
});

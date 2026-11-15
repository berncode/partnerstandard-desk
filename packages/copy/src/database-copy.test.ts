import { describe, expect, it } from 'vitest';
import { COPY, copyFor, DATABASE_COPY } from './copy';

describe('copyFor (plan 13, task 12)', () => {
  it('gives Google’s and memory’s screens COPY itself, unchanged', () => {
    expect(copyFor('google')).toBe(COPY);
    expect(copyFor('memory')).toBe(COPY);
  });

  it('gives a company server its own texts for what speaks of Drive, and COPY for everything else', () => {
    const words = copyFor('database');
    expect(words.OPEN_IN_SHEETS).toBe('Download as a spreadsheet');
    expect(words.PROG_DELETE_TEXT('Reseller')).toBe('Reseller goes to the trash, where an admin can restore it later.');
    expect(copyFor('database')).toBe(words);
    expect(words.CANCEL).toBe(COPY.CANCEL);
  });

  it('says the links stop working without an "either way", since a company server offers only the trash', () => {
    const words = copyFor('database');
    expect(words.ITEMS_LINKS_OFF(1)).toBe('Its links stop working.');
    expect(words.CASES_LINKS_OFF(2)).toBe('Their share links stop working.');
    expect(words.CASES_TRASH_HINT(1)).toBe('It can come back from the trash only with its partner type.');
  });

  it('only replaces texts COPY has, and never says Google, Drive or Sheets, nor uses an em dash', () => {
    for (const [key, value] of Object.entries(DATABASE_COPY)) {
      expect(Object.hasOwn(COPY, key)).toBe(true);
      // A function text is tried with one and with many, so both its branches are read.
      const texts = typeof value === 'function' ? [1, 2, 'Acme'].map((arg) => (value as (a: unknown) => string)(arg)) : [value];
      for (const text of texts) expect(text, key).not.toMatch(/Google|Drive|Sheets|—/);
    }
  });
});

import { describe, expect, it } from 'vitest';
import { programCrumb, programTitle, twinIds, withTitles, type ListedProgram } from './title';

const listed: ListedProgram[] = [
  { programId: 'pg_a', label: 'Reseller', partnerType: 'reseller' },
  { programId: 'pg_b', label: 'Reseller · DACH', partnerType: 'reseller' },
  { programId: 'pg_c', label: 'Reseller', partnerType: 'reseller' },
];

describe('telling programs apart (Program Designer’s rule)', () => {
  it('needs the names of twins only', () => {
    expect(twinIds(listed)).toEqual(['pg_a', 'pg_c']);
    expect(twinIds(listed.slice(0, 2))).toEqual([]);
  });

  it('adds the name to a twin’s label, "Untitled" for an empty one, and keeps the label when the name couldn’t be read', () => {
    const names = new Map([['pg_a', 'Northwind Reseller Program'], ['pg_c', ' ']]);
    expect(withTitles(listed, names).map((p) => p.title)).toEqual([
      'Reseller · Northwind Reseller Program', 'Reseller · DACH', 'Reseller · Untitled',
    ]);
    expect(withTitles(listed, new Map()).map((p) => p.title)).toEqual(['Reseller', 'Reseller · DACH', 'Reseller']);
  });

  it('names the program on screen by its live label, and the crumb ends in "program" only without the name', () => {
    const p = { id: 'pg_c', type: 'reseller' as const, focus: '', name: 'Second' };
    expect(programTitle(p, listed)).toBe('Reseller · Second');
    expect(programCrumb(p, listed)).toBe('Reseller · Second');
    expect(programTitle({ ...p, focus: ' DACH ' }, [listed[0]!])).toBe('Reseller · DACH');
    expect(programCrumb({ ...p, focus: 'Nordics' }, listed)).toBe('Reseller · Nordics program');
    // Its own row in the list is not a twin.
    expect(programCrumb({ ...p, id: 'pg_b', focus: 'DACH' }, listed)).toBe('Reseller · DACH program');
  });
});

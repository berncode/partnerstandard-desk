// The public page comes as its text.
import { describe, expect, it } from 'vitest';
import { OUTPUT_NOTE, programSheet, publicBlocks, publicPlain } from '@partner-desk/core';
import { northwind } from '@partner-desk/core/test-builders';
import { noteTime, publicTabFormat, publicTabValues, sheetTabFormat, sheetTabValues } from './program-output';

const nw = northwind();
const [reseller, consulting] = nw.programs;
const NOTE = OUTPUT_NOTE('26 Oct 2026, 09:05 UTC');

describe('sheetTabValues', () => {
  const rows = sheetTabValues(programSheet(nw, reseller, nw.name), NOTE);

  it('opens with the output note on row 1, then the eyebrow, the name and the description', () => {
    expect(rows.slice(0, 4)).toEqual([
      [NOTE],
      ['Partner Program Sheet · internal'],
      ['Northwind Security Reseller Program'],
      ['For IT resellers who sell security software to mid-sized companies and want a product their customers renew every year.'],
    ]);
  });

  it('puts labels and headings in column A and their text beside them', () => {
    expect(rows).toContainEqual(['Program lead', 'Anna Berger, Head of Partnerships']);
    expect(rows).toContainEqual(['Partner type', 'Reseller']);
    expect(rows).toContainEqual(['Why partners join', 'A security product your customers ask for, which opens doors to new accounts.']);
    expect(rows).toContainEqual(['', 'Leads from us in your region.']);
    expect(rows).toContainEqual(['Program goals', reseller.goals]);
    expect(rows).toContainEqual(['Ideal partner', reseller.ipp]);
    expect(rows).toContainEqual(['Ideal customer', reseller.icp]);
    expect(rows).toContainEqual(['How you measure it', reseller.kpis]);
    expect(rows).toContainEqual(['Training and material', reseller.enablement]);
    expect(rows).toContainEqual(['Tools', reseller.tools]);
    expect(rows).toContainEqual(['Rollout', 'Pilot with Two current resellers: Alpen IT and Nordlicht Systems. Criteria published on 2027-01-15.']);
    expect(rows.findIndex((row) => row[0] === 'Rules of engagement')).toBeGreaterThan(0);
    const money = rows.findIndex((row) => row[0] === 'Money');
    expect(rows[money + 1]![0]).toBe('');
  });

  it('lays the levels out as a table, one line per item inside a cell', () => {
    const at = rows.findLastIndex((row) => row[0] === 'Levels');
    expect(rows[at]).toEqual(['Levels', 'Registered', 'Preferred']);
    expect(rows[at + 1]![0]).toBe('To get there');
    expect(rows[at + 2]![0]).toBe('What they get');
    expect(String(rows[at + 2]![2]).split('\n')[0]).toBe('Everything in Registered');
    expect(rows[at + 3]![0]).toBe('What they earn');
    expect(rows[at + 4]![0]).toBe('Keeping it');
  });

  it('ends with the footer', () => {
    expect(rows.slice(-2)).toEqual([['Northwind Security · internal, not for partners'], ['Made with PartnerStandard Desk']]);
  });

  it('leaves out Rollout when there is none, and says Not set yet for empty text', () => {
    const empty = { ...consulting, kpis: '', tools: '' };
    const out = sheetTabValues(programSheet(nw, empty, nw.name), NOTE);
    expect(out.some((row) => row[0] === 'Rollout')).toBe(false);
    expect(out).toContainEqual(['Tools', 'Not set yet.']);
  });

  it('uses no em dash', () => {
    expect(JSON.stringify(rows)).not.toContain('—');
  });
});

describe('sheetTabFormat', () => {
  const requests = sheetTabFormat(7, 40) as Array<Record<string, { range?: { sheetId?: number } }>>;

  it('formats only the given tab', () => {
    for (const request of requests) expect(Object.values(request)[0]!.range?.sheetId).toBe(7);
  });

  it('makes column A bold, the name larger, two wide columns, and wraps the text', () => {
    const text = JSON.stringify(requests);
    expect(text).toContain('"bold":true');
    expect(text).toContain('"wrapStrategy":"WRAP"');
    const widths = requests.filter((r) => 'updateDimensionProperties' in r).map((r) => JSON.stringify(r));
    expect(widths.some((w) => w.includes('"startIndex":1') && w.includes('"endIndex":3'))).toBe(true);
    const title = requests.find((r) => 'repeatCell' in r && JSON.stringify(r).includes('"startRowIndex":2,"endRowIndex":3'));
    expect(JSON.stringify(title)).toMatch(/"fontSize":1[4-9]/);
  });
});

describe('publicTabValues', () => {
  it('writes the note, then the public text one line per row, with # and - as on the public page', () => {
    const text = publicPlain(publicBlocks(nw, reseller));
    const rows = publicTabValues(text, NOTE);
    expect(rows[0]).toEqual([NOTE]);
    expect(rows[1]).toEqual([]);
    expect(rows.slice(2).map((row) => row[0] ?? '').join('\n')).toBe(text);
    expect(rows[2]).toEqual(['# The Northwind Security Reseller Program']);
    expect(rows).toContainEqual(['## Why partners join']);
    expect(rows).toContainEqual(['- Leads from us in your region.']);
  });

  it('is formatted as one wide wrapped column', () => {
    const text = JSON.stringify(publicTabFormat(3, 30));
    expect(text).toContain('"sheetId":3');
    expect(text).toContain('"wrapStrategy":"WRAP"');
  });
});

describe('noteTime', () => {
  it('names the day and the time in UTC', () => {
    expect(noteTime('2026-10-26T09:05:42.123Z')).toBe('26 Oct 2026, 09:05 UTC');
    expect(noteTime('2027-01-05T23:59:00.000Z')).toBe('5 Jan 2027, 23:59 UTC');
  });
});

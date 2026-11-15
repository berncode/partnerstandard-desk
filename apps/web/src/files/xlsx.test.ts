import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { disposition, sheetNames, xlsx } from './xlsx';

const file = (tabs: Array<{ title: string; rows: Array<Array<string | number | boolean | null>> }>) =>
  ({ kind: 'partners' as const, companyId: 'co_aaaaaaaaaa', name: 'Partner Desk – Partners', tabs });

function open(bytes: Uint8Array) {
  const parts = unzipSync(bytes);
  const text = (path: string) => strFromU8(parts[path]!);
  const sheets = [...text('xl/workbook.xml').matchAll(/<sheet name="([^"]*)" sheetId="\d+"( state="hidden")?/g)]
    .map((m) => ({ name: m[1], hidden: Boolean(m[2]) }));
  return { parts, text, sheets };
}

describe('xlsx', () => {
  it('makes one sheet per tab in order, with _meta hidden', () => {
    const { sheets, parts } = open(xlsx(file([{ title: 'Accounts', rows: [['ID']] }, { title: 'Partners', rows: [['ID']] }, { title: '_meta', rows: [['key']] }])));
    expect(sheets).toEqual([{ name: 'Accounts', hidden: false }, { name: 'Partners', hidden: false }, { name: '_meta', hidden: true }]);
    expect(Object.keys(parts)).toEqual(expect.arrayContaining([
      '[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml',
      'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'xl/worksheets/sheet3.xml',
    ]));
  });

  it('writes text as text, numbers as numbers, true and false as such, and nothing for an empty cell', () => {
    const { text } = open(xlsx(file([{ title: 'Accounts', rows: [['ID', 'Company', 'Score', 'Active'], ['a_1', '=1+1', 3, true], ['a_2', '007', null, ''], ['a_3', '', 2.5, false]] }])));
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).not.toContain('<f>');
    expect(sheet).toContain('<c r="B2" t="inlineStr"><is><t xml:space="preserve">=1+1</t></is></c>');
    expect(sheet).toContain('<c r="B3" t="inlineStr"><is><t xml:space="preserve">007</t></is></c>');
    expect(sheet).toContain('<c r="C2"><v>3</v></c>');
    expect(sheet).toContain('<c r="C4"><v>2.5</v></c>');
    expect(sheet).toContain('<c r="D2" t="b"><v>1</v></c>');
    expect(sheet).toContain('<c r="D4" t="b"><v>0</v></c>');
    expect(sheet).not.toContain('r="C3"');
    expect(sheet).not.toContain('r="D3"');
    expect(sheet).not.toContain('r="B4"');
  });

  it('keeps a cell reading “constructor”, “__proto__” or “toString” as that text (task 12’s review)', () => {
    const { text } = open(xlsx(file([{ title: 'Markets', rows: [['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']] }])));
    const sheet = text('xl/worksheets/sheet1.xml');
    for (const word of ['constructor', '__proto__', 'toString', 'valueOf', 'hasOwnProperty']) {
      expect(sheet).toContain(`<t xml:space="preserve">${word}</t>`);
    }
    expect(sheet).not.toContain('function');
  });

  it('escapes what XML must, drops what XML can’t hold, and makes a broken character whole', () => {
    const { text } = open(xlsx(file([{ title: 'Calls', rows: [['<b>Tom & "Jerry"</b>', 'a\u0000b\u0007c', 'line one\nline two', 'x\ud800y']] }])));
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('&lt;b&gt;Tom &amp; &quot;Jerry&quot;&lt;/b&gt;');
    expect(sheet).toContain('<t xml:space="preserve">abc</t>');
    expect(sheet).toContain('<t xml:space="preserve">line one\nline two</t>');
    expect(sheet).toContain('<t xml:space="preserve">x�y</t>');
  });

  it('cuts a cell to Excel’s 32,767 characters', () => {
    const { text } = open(xlsx(file([{ title: 'Calls', rows: [['x'.repeat(40_000)]] }])));
    expect(text('xl/worksheets/sheet1.xml')).toContain(`>${'x'.repeat(32_767)}</t>`);
    expect(text('xl/worksheets/sheet1.xml')).not.toContain('x'.repeat(32_768));
  });

  it('names columns past Z as AA, AB, ZZ, AAA', () => {
    const { text } = open(xlsx(file([{ title: 'Wide', rows: [Array.from({ length: 703 }, (_, i) => i)] }])));
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<c r="AB1"><v>27</v></c>');
    expect(sheet).toContain('<c r="ZZ1"><v>701</v></c>');
    expect(sheet).toContain('<c r="AAA1"><v>702</v></c>');
  });

  it('keeps text shaped like Excel’s own escape as it is: "_x0041_" opens as "_x0041_", not "A" (task 12’s review)', () => {
    const { text } = open(xlsx(file([{ title: 'Calls', rows: [['_x0041_', 'a_x0000_b', '_x41_']] }])));
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain('<t xml:space="preserve">_x005F_x0041_</t>');
    expect(sheet).toContain('<t xml:space="preserve">a_x005F_x0000_b</t>');
    expect(sheet).toContain('<t xml:space="preserve">_x41_</t>');
  });

  it('writes a carriage return as a reference, so it survives the reading', () => {
    const { text } = open(xlsx(file([{ title: 'Calls', rows: [['one\r\ntwo']] }])));
    expect(text('xl/worksheets/sheet1.xml')).toContain('<t xml:space="preserve">one&#13;\ntwo</t>');
  });

  it('never cuts an emoji in half at the cell limit', () => {
    const { text } = open(xlsx(file([{ title: 'Calls', rows: [['a'.repeat(32_766) + '😀']] }])));
    const sheet = text('xl/worksheets/sheet1.xml');
    expect(sheet).toContain(`>${'a'.repeat(32_766)}</t>`);
    expect(sheet).not.toContain('\ufffd');
  });

  it('counts the limit in the cell’s characters, not its escaped XML', () => {
    const { text } = open(xlsx(file([{ title: 'Calls', rows: [['&'.repeat(40_000)]] }])));
    expect(text('xl/worksheets/sheet1.xml')).toContain(`>${'&amp;'.repeat(32_767)}</t>`);
  });

  it('writes one empty sheet for a file with no tab, and shows _meta when nothing else would show', () => {
    expect(open(xlsx(file([]))).sheets).toEqual([{ name: 'Sheet', hidden: false }]);
    expect(open(xlsx(file([{ title: '_meta', rows: [['key']] }, { title: '_meta', rows: [['key']] }]))).sheets)
      .toEqual([{ name: '_meta', hidden: false }, { name: '_meta (2)', hidden: false }]);
  });
});

describe('sheetNames', () => {
  it('keeps the layouts’ names as they are', () => {
    expect(sheetNames(['Start here', 'Accounts', 'Partners', '_meta'])).toEqual(['Start here', 'Accounts', 'Partners', '_meta']);
  });

  it('never leaves an apostrophe or a space at the end after the cut, never splits an emoji, and never keeps a control character', () => {
    expect(sheetNames(['a'.repeat(30) + "'b"])).toEqual(['a'.repeat(30)]);
    expect(sheetNames(['a'.repeat(30) + '😀'])).toEqual(['a'.repeat(30)]);
    expect(sheetNames(['x\ny', 'x y', 'tab\there'])).toEqual(['x y', 'x y (2)', 'tab here']);
  });

  it('never names a tab History, which Excel keeps for itself', () => {
    expect(sheetNames(['History', 'history'])).toEqual(['History (2)', 'history (3)']);
  });

  it('drops the characters Excel refuses, cuts to 31, and makes names that match in any letter case different', () => {
    const names = sheetNames(['A/B: C?', "'quoted'", 'A tab name that is much longer than Excel allows', 'A tab name that is much longer than Excel allows too', 'proposals', 'Proposals', '']);
    expect(names[0]).toBe('A B  C');
    expect(names[1]).toBe('quoted');
    expect(names[2]).toBe('A tab name that is much longer');
    expect(names[3]).toBe('A tab name that is much lon (2)');
    expect(names[4]).toBe('proposals');
    expect(names[5]).toBe('Proposals (2)');
    expect(names[6]).toBe('Sheet');
    for (const name of names) expect(name.length).toBeLessThanOrEqual(31);
    expect(new Set(names.map((n) => n.toLowerCase())).size).toBe(names.length);
  });
});

describe('disposition', () => {
  it('names the download in plain ASCII and in full', () => {
    expect(disposition('Partner Desk – Partners')).toBe(
      "attachment; filename=\"Partner Desk - Partners.xlsx\"; filename*=UTF-8''Partner%20Desk%20%E2%80%93%20Partners.xlsx",
    );
    expect(disposition('A "quoted" \\ name')).toContain('filename="A quoted  name.xlsx"');
  });

  it('never breaks on a broken character or a control character in a name', () => {
    expect(() => disposition('Acme\ud800 GmbH')).not.toThrow();
    expect(disposition('Acme\r\nX-Evil: 1')).toBe("attachment; filename=\"Acme X-Evil: 1.xlsx\"; filename*=UTF-8''Acme%20X-Evil%3A%201.xlsx");
    expect(disposition("O'Brien (Ltd)*")).toContain("filename*=UTF-8''O%27Brien%20%28Ltd%29%2A.xlsx");
  });

  it('keeps a very long name short enough for any proxy', () => {
    const header = disposition('Partner Desk – Business case – ' + 'Acme '.repeat(200));
    expect(header.length).toBeLessThan(1_000);
    expect(() => disposition('😀'.repeat(200))).not.toThrow();
  });
});

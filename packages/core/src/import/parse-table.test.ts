import { describe, expect, it } from 'vitest';
import { buildSearchPrompt } from '../prompt/build-prompt';
import { sampleBook, sampleMarket } from '../test-builders';
import { columnFor, IMPORT_COLUMNS, NO_TABLE, parseTable, type ParsedTable } from './parse-table';

function table(text: string): ParsedTable {
  const out = parseTable(text);
  if (!out.ok) throw new Error(`expected a table, got: ${out.message}`);
  return out.table;
}

describe('parseTable', () => {
  it('reads the CSV file the search prompt asks for: every cell quoted, commas inside cells', () => {
    const csv = [
      '"Company","Website","Country","Vertical","Sub-vertical","Target customer type","Partner type","Why it fits","Evidence and sources","Existing partnerships"',
      '"Acme Advisors, LLC","acme.example","United States","Wealth management","Family offices","SMB","Reseller","Serves family offices, has engineers","https://acme.example/about","None known"',
    ].join('\n');
    const t = table(csv);
    expect(t.headers).toHaveLength(10);
    expect(t.rows).toEqual([[
      'Acme Advisors, LLC', 'acme.example', 'United States', 'Wealth management', 'Family offices', 'SMB', 'Reseller',
      'Serves family offices, has engineers', 'https://acme.example/about', 'None known',
    ]]);
  });

  it('finds a Markdown table with prose before and after', () => {
    const text = [
      'Here are the companies I found:',
      '',
      '| Company | Website | Country |',
      '|---|---|---|',
      '| Acme GmbH | acme.at | Austria |',
      '| Beta AG | https://beta.at | Austria |',
      '',
      'Let me know if you want more.',
    ].join('\n');
    expect(table(text)).toEqual({
      headers: ['Company', 'Website', 'Country'],
      rows: [['Acme GmbH', 'acme.at', 'Austria'], ['Beta AG', 'https://beta.at', 'Austria']],
    });
  });

  it('skips an alignment row', () => {
    const text = '| Company | Website |\n|:---|---:|\n| Acme | acme.at |';
    expect(table(text).rows).toEqual([['Acme', 'acme.at']]);
  });

  it('keeps an escaped pipe inside a cell', () => {
    const text = '| Company | Why it fits |\n|---|---|\n| Acme | ERP \\| CRM reseller |';
    expect(table(text).rows).toEqual([['Acme', 'ERP | CRM reseller']]);
  });

  it('finds a table whose header says "Company name" and "URL"', () => {
    const text = '| Company name | URL |\n|---|---|\n| Acme | acme.at |';
    expect(table(text)).toEqual({ headers: ['Company name', 'URL'], rows: [['Acme', 'acme.at']] });
  });

  it('reads a semicolon CSV from European Excel', () => {
    const text = 'Company;Website;Why it fits\nAcme GmbH;acme.at;Sells ERP, CRM and more\n';
    expect(table(text)).toEqual({
      headers: ['Company', 'Website', 'Why it fits'],
      rows: [['Acme GmbH', 'acme.at', 'Sells ERP, CRM and more']],
    });
  });

  it('reads a comma CSV', () => {
    const text = 'Company,Website\nAcme,acme.at\r\nBeta,beta.at';
    expect(table(text).rows).toEqual([['Acme', 'acme.at'], ['Beta', 'beta.at']]);
  });

  it('reads a tab-separated table', () => {
    const text = 'Company\tWebsite\tCountry\nAcme\tacme.at\tAustria\nBeta\t\tGermany';
    expect(table(text)).toEqual({
      headers: ['Company', 'Website', 'Country'],
      rows: [['Acme', 'acme.at', 'Austria'], ['Beta', '', 'Germany']],
    });
  });

  it('reads a Markdown table with a trailing empty column', () => {
    const text = '| Company | Website | |\n|---|---|---|\n| Acme | acme.at | |';
    expect(table(text)).toEqual({ headers: ['Company', 'Website', ''], rows: [['Acme', 'acme.at', '']] });
  });

  it('reads a CSV with a trailing empty column', () => {
    const text = 'Company,Website,\nAcme,acme.at,\n';
    expect(table(text)).toEqual({ headers: ['Company', 'Website', ''], rows: [['Acme', 'acme.at', '']] });
  });

  it('reads a quoted CSV cell with a comma and a newline', () => {
    const text = 'Company,Website,Why it fits\n"Acme, Inc.",acme.at,"Line one\nline two with ""quotes"""\nBeta,beta.at,Short';
    expect(table(text).rows).toEqual([
      ['Acme, Inc.', 'acme.at', 'Line one\nline two with "quotes"'],
      ['Beta', 'beta.at', 'Short'],
    ]);
  });

  it('pads short rows to the header width', () => {
    const text = '| Company | Website | Country |\n|---|---|---|\n| Acme | acme.at |';
    expect(table(text).rows).toEqual([['Acme', 'acme.at', '']]);
  });

  it('keeps formula-looking cells as plain text', () => {
    const text = '| Company | Website | Why it fits |\n|---|---|---|\n| =HYPERLINK("x") | +43 1 234 | @acme -x |';
    expect(table(text).rows).toEqual([['=HYPERLINK("x")', '+43 1 234', '@acme -x']]);
  });

  it('skips a header without rows, such as the prompt copied with the answer', () => {
    const prompt = buildSearchPrompt({ market: sampleMarket(), book: sampleBook(), companyName: 'Invoicely', hypothesisId: null });
    const answer = 'Here you go:\n\n| Company | Website |\n|---|---|\n| Acme | acme.at |';
    expect(table(`${prompt}\n\n${answer}`).rows).toEqual([['Acme', 'acme.at']]);
  });

  it('skips a header whose rows are all empty', () => {
    const text = 'Company,Website\n,\n\n| Company | Website |\n|---|---|\n| | |\n\nCompany;Website\nAcme;acme.at';
    expect(table(text).rows).toEqual([['Acme', 'acme.at']]);
  });

  it('refuses a header without rows', () => {
    expect(parseTable('| Company | Website |\n|---|---|\n\n| Acme | acme.at |')).toEqual({ ok: false, message: NO_TABLE });
  });

  it('reads a Source detail column too, beside the columns the search prompt asks for', () => {
    expect(IMPORT_COLUMNS).toEqual(['Company', 'Website', 'Country', 'Vertical', 'Sub-vertical', 'Target customer type',
      'Partner type', 'Why it fits', 'Evidence and sources', 'Existing partnerships', 'Source detail']);
    expect(columnFor('source DETAIL')).toBe('Source detail');
    expect(table('Company,Source detail\nDelta,Web search')).toEqual({ headers: ['Company', 'Source detail'], rows: [['Delta', 'Web search']] });
    expect(buildSearchPrompt({ market: sampleMarket(), book: sampleBook(), companyName: 'Invoicely', hypothesisId: null })).not.toContain('Source detail');
  });

  it('refuses text without a table', () => {
    expect(parseTable('Sorry, I could not find any companies that match.')).toEqual({ ok: false, message: NO_TABLE });
    expect(NO_TABLE).toBe("We couldn't find the columns. Ask the AI to return the table in the format from the prompt.");
  });

  it('refuses a table without the company column', () => {
    expect(parseTable('| Foo | Bar |\n|---|---|\n| a | b |')).toEqual({ ok: false, message: NO_TABLE });
  });
});

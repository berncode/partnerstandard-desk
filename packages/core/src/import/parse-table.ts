import { COPY } from '@partner-desk/copy';
import { OUTPUT_COLUMNS } from '../prompt/build-prompt';

export type OutputColumn = (typeof OUTPUT_COLUMNS)[number];
/**
 * The columns an import reads: the search prompt's, and the source's detail, which an agent's proposal gives for each
 * company (decided 2026-11-03) and a pasted table may have too. The search prompt keeps asking for `OUTPUT_COLUMNS`.
 */
export const IMPORT_COLUMNS = [...OUTPUT_COLUMNS, 'Source detail'] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];
export type ParsedTable = { headers: string[]; rows: string[][] };

export const NO_TABLE = COPY.NO_TABLE;

const key = (header: string) => header.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const COLUMN_BY_KEY = new Map<string, ImportColumn>([
  ...IMPORT_COLUMNS.map((column) => [key(column), column] as const),
  ['companyname', 'Company'], ['name', 'Company'], ['url', 'Website'], ['web', 'Website'],
]);

/** The import column a header names, ignoring case, spaces and punctuation; null for any other header. */
export function columnFor(header: string): ImportColumn | null {
  return COLUMN_BY_KEY.get(key(header)) ?? null;
}

type Format = '|' | '\t' | ';' | ',';

/** A header names the company and at least one other import column. */
function isHeader(cells: string[]): boolean {
  const columns = new Set(cells.map(columnFor).filter((c) => c !== null));
  return columns.has('Company') && columns.size >= 2;
}

/** Splits a Markdown table line on unescaped pipes, without the outer pipes; `\|` becomes `|`. */
function pipeCells(line: string): string[] {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

const hasPipe = (line: string) => /(?<!\\)\|/.test(line);
const isAlignment = (cells: string[]) => cells.every((cell) => /^:?-+:?$/.test(cell));

/**
 * Reads delimited records (CSV rules: quoted cells may hold the delimiter, newlines and doubled quotes) until the
 * text ends or a record has no delimiter, such as a blank line or prose after the table.
 */
function delimitedRecords(text: string, delimiter: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const endRecord = () => {
    record.push(cell);
    cell = '';
    const done = record.length < 2;
    if (!done) records.push(record);
    record = [];
    return done;
  };
  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i += 2; continue; }
      if (ch === '"') quoted = false;
      else cell += ch;
      i++;
      continue;
    }
    if (ch === '"' && cell.trim() === '') { cell = ''; quoted = true; }
    else if (ch === delimiter) { record.push(cell); cell = ''; }
    else if (ch === '\n') { if (endRecord()) return records; }
    else cell += ch;
    i++;
  }
  if (record.length > 0 || cell !== '') endRecord();
  return records;
}

const firstRecord = (line: string, delimiter: string) => delimitedRecords(line, delimiter)[0] ?? [line];

/** The format whose split of `line` makes it a header, or null. Pipes win, then tab, then `;` or `,`. */
function headerFormat(line: string): Format | null {
  if (hasPipe(line)) return isHeader(pipeCells(line)) ? '|' : null;
  if (line.includes('\t')) return isHeader(firstRecord(line, '\t')) ? '\t' : null;
  const semicolon = firstRecord(line, ';');
  const comma = firstRecord(line, ',');
  const [format, cells]: [Format, string[]] = semicolon.length > comma.length ? [';', semicolon] : [',', comma];
  return isHeader(cells) ? format : null;
}

function markdownRows(lines: string[]): string[][] {
  const rows: string[][] = [];
  for (const [index, line] of lines.entries()) {
    if (!hasPipe(line)) break;
    const cells = pipeCells(line);
    if (index === 0 && isAlignment(cells)) continue;
    rows.push(cells);
  }
  return rows;
}

const fit = (row: string[], width: number) => (row.length >= width ? row : [...row, ...Array(width - row.length).fill('')]);

/**
 * Finds the first table with a non-empty row in pasted AI output: a Markdown table, TSV, or CSV with `;` or `,`.
 * A header without rows, such as the one in the copied prompt, is skipped. Cells are trimmed.
 */
export function parseTable(text: string): { ok: true; table: ParsedTable } | { ok: false; message: string } {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  for (const [index, line] of lines.entries()) {
    const format = headerFormat(line);
    if (!format) continue;
    const [headers = [], ...rows] = format === '|'
      ? [pipeCells(line), ...markdownRows(lines.slice(index + 1))]
      : delimitedRecords(lines.slice(index).join('\n'), format).map((row) => row.map((cell) => cell.trim()));
    if (!rows.some((row) => row.some((cell) => cell !== ''))) continue;
    return { ok: true, table: { headers, rows: rows.map((row) => fit(row, headers.length)) } };
  }
  return { ok: false, message: NO_TABLE };
}

// The Program Sheet and Public page tabs. The public page comes as its plain text (publicPlain), so the store needs no program to write it.
import type { SheetContent } from '@partner-desk/core';
import type { Cell } from './grid';

/**
 * The Program Sheet and Public page tabs of a program's spreadsheet: their rows and their formatting. Pure. Both
 * tabs are output only, rewritten whole and never read back.
 *
 * The Program Sheet tab has three columns: A holds the labels and section headings (bold), B and C the text (the
 * Registered and Preferred levels side by side). The first four rows (note, eyebrow, name, description) span all
 * three columns.
 */

/** Rows 1 to 4 (the note, the eyebrow, the name and the description) span the columns. */
const HEAD_ROWS = 4;
/** The row of the program's name (0-based), set larger. */
const NAME_ROW = 2;
const COLUMNS = 3;

/** A cell that holds several items, one per line. */
const lines = (cell: string | string[]) => (Array.isArray(cell) ? cell.join('\n') : cell);

/** `label` beside the first item, the other items below it with column A empty. */
function section(label: string, items: string[]): Cell[][] {
  return items.map((item, i) => [i === 0 ? label : '', item]);
}

/** The Program Sheet as rows for its tab: the output note on row 1, then the sheet laid out for a person. */
export function sheetTabValues(content: SheetContent, note: string): Cell[][] {
  const { levels } = content;
  return [
    [note],
    [content.eyebrow],
    [content.name],
    [content.description],
    [],
    ...content.facts.map(({ label, value }) => [label, value]),
    [],
    ...section('Why partners join', content.why),
    ['Program goals', content.goals],
    ['Ideal partner', content.ipp],
    ['Ideal customer', content.icp],
    [],
    ['Levels', ...levels.columns.slice(1)],
    ...levels.rows.map((row) => [row.label, ...row.cells.map(lines)]),
    [],
    ...section('Money', content.money),
    ...section('Rules of engagement', content.rules),
    [],
    ['How you measure it', content.kpis],
    ['Training and material', content.enablement],
    ['Tools', content.tools],
    ...(content.rollout ? [['Rollout', content.rollout]] : []),
    [],
    [content.footer[0]],
    [content.footer[1]],
  ];
}

const range = (sheetId: number, rows: [number, number], columns: [number, number]) => ({
  sheetId, startRowIndex: rows[0], endRowIndex: rows[1], startColumnIndex: columns[0], endColumnIndex: columns[1],
});
const width = (sheetId: number, from: number, to: number, pixelSize: number) => ({
  updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: from, endIndex: to }, properties: { pixelSize }, fields: 'pixelSize' },
});
const textFormat = (sheetId: number, rows: [number, number], columns: [number, number], format: Record<string, unknown>) => ({
  repeatCell: { range: range(sheetId, rows, columns), cell: { userEnteredFormat: { textFormat: format } }, fields: 'userEnteredFormat.textFormat' },
});
const wrap = (sheetId: number, rows: number, columns: number) => ({
  repeatCell: {
    range: range(sheetId, [0, rows], [0, columns]),
    cell: { userEnteredFormat: { wrapStrategy: 'WRAP', verticalAlignment: 'TOP' } },
    fields: 'userEnteredFormat(wrapStrategy,verticalAlignment)',
  },
});

/**
 * Formatting for a Program Sheet tab of `rows` rows, after it was cleared: labels and headings (column A) bold, the
 * name larger, the note small and gray, a label column and two wide text columns, text wrapped.
 */
export function sheetTabFormat(sheetId: number, rows: number): object[] {
  return [
    { unmergeCells: { range: { sheetId } } },
    width(sheetId, 0, 1, 220),
    width(sheetId, 1, COLUMNS, 380),
    wrap(sheetId, rows, COLUMNS),
    ...Array.from({ length: HEAD_ROWS }, (_, row) => ({
      mergeCells: { range: range(sheetId, [row, row + 1], [0, COLUMNS]), mergeType: 'MERGE_ALL' },
    })),
    textFormat(sheetId, [0, rows], [0, 1], { bold: true, fontSize: 11 }),
    textFormat(sheetId, [0, 1], [0, COLUMNS], { bold: false, italic: true, fontSize: 9, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } }),
    textFormat(sheetId, [NAME_ROW, NAME_ROW + 1], [0, COLUMNS], { bold: true, fontSize: 16 }),
  ];
}

/** The public page as rows for its tab: the output note, a blank row, then one line per row, with # and - as in `publicPlain`. */
export function publicTabValues(text: string, note: string): Cell[][] {
  return [[note], [], ...text.split('\n').map((line) => (line === '' ? [] : [line]))];
}

/** Formatting for a Public page tab of `rows` rows: one wide column of wrapped text, the note small and gray. */
export function publicTabFormat(sheetId: number, rows: number): object[] {
  return [
    width(sheetId, 0, 1, 720),
    wrap(sheetId, rows, 1),
    textFormat(sheetId, [0, 1], [0, 1], { italic: true, fontSize: 9, foregroundColor: { red: 0.4, green: 0.4, blue: 0.4 } }),
  ];
}

const NOTE_TIME = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC',
});

/** When the outputs were written, for the output note: "26 Oct 2026, 09:05 UTC". */
export function noteTime(iso: string): string {
  const parts = Object.fromEntries(NOTE_TIME.formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.day} ${parts.month} ${parts.year}, ${parts.hour}:${parts.minute} UTC`;
}

// A database file as an Excel file, for "Download as a spreadsheet" (plan 13, task 12). Written here, with fflate's zip
// only: an .xlsx is a zip of a few XML files. Text is written inline in its cell (never through a table of shared
// strings, where a library's lookup once turned a cell reading "constructor" into a broken file: task 12's review), so
// no text can become a formula or a number, and every character Excel can't hold is dropped.
import type { ExportedFile } from '@partner-desk/storage';
import { strToU8, zipSync } from 'fflate';

/** Excel's limits: 31 characters in a tab's name, 32,767 in a cell, 1,048,576 rows and 16,384 columns in a sheet. */
const MAX_TAB_NAME = 31;
const MAX_CELL = 32_767;
const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;
/** A download's name stays short enough for any proxy's header limit. */
const MAX_FILE_NAME = 150;

/** Characters XML 1.0 can't hold at all (a lone surrogate is made whole first, as U+FFFD). */
const NOT_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g;

/** `value` cut to at most `max` characters, never between the two halves of an emoji or another surrogate pair. */
function cut(value: string, max: number): string {
  return value.length <= max ? value : value.slice(0, max).replace(/[\uD800-\uDBFF]$/, '');
}

/**
 * Text as a spreadsheet keeps it: well formed, without the characters XML refuses, within a cell's limit, escaped for
 * XML, a carriage return written as a character reference (XML reading would turn it into a line break), and any text
 * shaped like Excel's own escape `_xHHHH_` escaped in turn, so "_x0041_" opens as "_x0041_", not "A" (task 12's
 * review; the escape isn't counted in the limit, which is the cell's value).
 */
function xmlText(value: string, max = MAX_CELL): string {
  const clean = cut(value.toWellFormed().replace(NOT_XML, ''), max);
  return clean.replace(/_(x[0-9A-Fa-f]{4}_)/g, '_x005F_$1')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
    .replace(/\r/g, '&#13;');
}

/** "A", "B", ..., "Z", "AA": a column's letters, from 0. */
function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** A tab name after its cut: no space or apostrophe at either end, so a cut never leaves one there (task 12's review). */
const tidy = (name: string) => name.replace(/^[\s']+|[\s']+$/g, '');

/**
 * Tab names Excel takes: no control character and none of `: \ / ? * [ ]`, no apostrophe at either end, 1 to 31
 * characters, never "History" (Excel keeps it for itself), and no two the same in any letter case (a second one gets
 * " (2)", within the 31).
 */
export function sheetNames(titles: readonly string[]): string[] {
  const taken = new Set<string>(['history']);
  return titles.map((title) => {
    const clean = title.toWellFormed().replace(/[\u0000-\u001F\u007F]/g, ' ').replace(NOT_XML, '').replace(/[:\\/?*[\]]/g, ' ');
    const base = tidy(cut(tidy(clean), MAX_TAB_NAME)) || 'Sheet';
    let name = base;
    for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      name = tidy(cut(base, MAX_TAB_NAME - suffix.length)) + suffix;
    }
    taken.add(name.toLowerCase());
    return name;
  });
}

/** One cell: text inline, numbers as numbers, true or false as such; nothing for an empty one. */
function cellXml(cell: unknown, ref: string): string {
  if (cell === null || cell === undefined || cell === '') return '';
  if (typeof cell === 'boolean') return `<c r="${ref}" t="b"><v>${cell ? 1 : 0}</v></c>`;
  if (typeof cell === 'number' && Number.isFinite(cell)) return `<c r="${ref}"><v>${cell}</v></c>`;
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(String(cell))}</t></is></c>`;
}

function sheetXml(rows: ExportedFile['tabs'][number]['rows']): string {
  const body = rows.slice(0, MAX_ROWS).map((row, r) => {
    const cells = row.slice(0, MAX_COLUMNS).map((cell, c) => cellXml(cell, `${columnName(c)}${r + 1}`)).join('');
    return cells ? `<row r="${r + 1}">${cells}</row>` : '';
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

/**
 * The workbook as an .xlsx: one sheet per tab in the file's order; `_meta` hidden, as Google keeps it out of sight, but
 * only beside a tab that shows (a workbook must show at least one); one empty sheet for a file with no tab at all.
 */
export function xlsx(file: ExportedFile): Uint8Array {
  const tabs = file.tabs.length > 0 ? file.tabs : [{ title: 'Sheet', rows: [] }];
  const names = sheetNames(tabs.map((t) => t.title));
  const anyShown = tabs.some((t) => t.title !== '_meta');
  const sheets = tabs.map((tab, i) => ({ name: names[i]!, hidden: anyShown && tab.title === '_meta', rows: tab.rows }));
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`),
    '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}"><Relationship Id="rId1" Type="${NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    'xl/workbook.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${NS}"><sheets>${sheets.map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="${PKG}">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${NS}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="${NS}/styles" Target="styles.xml"/></Relationships>`),
    'xl/styles.xml': strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s.rows)); });
  return zipSync(files, { level: 6 });
}

/**
 * The download's file name for a browser: plain ASCII with the full name beside it (RFC 6266). The name is made well
 * formed first and loses its control characters, so no name can break the header or the encoding.
 */
export function disposition(name: string): string {
  const clean = cut(name.toWellFormed().replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim(), MAX_FILE_NAME).trim() || 'PartnerStandard Desk';
  const plain = clean.replace(/[^\x20-\x7e]/g, '-').replace(/["\\]/g, '');
  const encoded = encodeURIComponent(`${clean}.xlsx`).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${plain}.xlsx"; filename*=UTF-8''${encoded}`;
}

import type { Cell, Workbook } from '../sheet-codec/grid';
import { DRIVE_API, GoogleClient, SHEETS_API } from './client';

/**
 * Test support: an in-memory stand-in for the Sheets v4 and Drive v3 endpoints the adapter calls. Not production code.
 * Grid sizes are modeled: 26 columns and 1000 rows unless a tab is made bigger (appendDimension grows it, a row delete
 * shrinks it). Values writes, explicit-row reads and formatting past them are refused, as Google refuses writes (Google
 * may clamp such reads; the adapter relies on neither). As in Google, a trashed spreadsheet can still be read and
 * written by id. A new tab whose name differs from one there only in letter case is refused, as Google is expected to.
 */

/** `columnCount` and `rowCount` are the tab's grid size: writes, dropdowns and formatting past it are refused, as Google does. */
export interface FakeSheet {
  sheetId: number; title: string; index: number; hidden: boolean; frozenRows: number; columnCount: number; rowCount: number; grid: Cell[][];
}
export interface FakeSpreadsheet {
  id: string; name: string; parents: string[]; trashed: boolean; sheets: FakeSheet[];
  validations: unknown[]; protections: Array<{ range: GridRange; warningOnly?: boolean; description?: string }>;
  formats: unknown[];
}
export interface FakeFolder { id: string; name: string; parents: string[]; trashed: boolean }
type Call = { method: string; url: URL; body: unknown };
type GridRange = { sheetId: number; startRowIndex?: number; endRowIndex?: number; startColumnIndex?: number; endColumnIndex?: number };

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const fail = (status: number, message: string, statusText: string) => json(status, { error: { code: status, message, status: statusText } });
const notFound = () => fail(404, 'Requested entity was not found.', 'NOT_FOUND');
const badRequest = (message: string) => fail(400, message, 'INVALID_ARGUMENT');

const columnIndex = (letters: string) => [...letters].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const RANGE = /^'((?:[^']|'')*)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?)?$/;

/** Google's size for a new tab that doesn't say otherwise. */
const DEFAULT_COLUMNS = 26;
const DEFAULT_ROWS = 1000;

const isBlank = (cell: Cell | undefined) => cell == null || cell === '';

/** What a values read returns: trailing blank cells and rows dropped, inner blanks as ''. */
function trimGrid(grid: Cell[][]): Cell[][] {
  const rows = grid.map((row) => {
    let end = row.length;
    while (end > 0 && isBlank(row[end - 1])) end--;
    return row.slice(0, end).map((c) => (c == null ? '' : c));
  });
  let end = rows.length;
  while (end > 0 && rows[end - 1]!.length === 0) end--;
  return rows.slice(0, end);
}

export class FakeGoogle {
  readonly calls: Call[] = [];
  beforeRequest?: (call: Call) => void;
  private readonly sheets = new Map<string, FakeSpreadsheet>();
  private readonly folderMap = new Map<string, FakeFolder>();
  private readonly failures: Array<{ status: number; body?: unknown }> = [];
  private counter = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const method = init?.method ?? 'GET';
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
    const call = { method, url, body };
    this.calls.push(call);
    const failure = this.failures.shift();
    if (failure) return json(failure.status, failure.body ?? { error: { code: failure.status, message: 'injected', status: 'INJECTED' } });
    this.beforeRequest?.(call);
    return this.route(call);
  };

  failNext(status: number, times = 1, body?: unknown): void {
    for (let i = 0; i < times; i++) this.failures.push({ status, body });
  }

  spreadsheet(fileId: string): FakeSpreadsheet | undefined {
    return this.sheets.get(fileId);
  }

  folders(): FakeFolder[] {
    return [...this.folderMap.values()];
  }

  /** Moves an item to the trash, and everything inside it, as Drive does. */
  trash(id: string): void {
    const item = this.sheets.get(id) ?? this.folderMap.get(id);
    if (!item) return;
    item.trashed = true;
    for (const child of [...this.sheets.values(), ...this.folderMap.values()]) {
      if (child.parents.includes(id) && !child.trashed) this.trash(child.id);
    }
  }

  remove(id: string): void {
    this.sheets.delete(id);
    this.folderMap.delete(id);
  }

  getWorkbook(fileId: string): Workbook {
    const s = this.sheets.get(fileId);
    if (!s) throw new Error(`no spreadsheet ${fileId}`);
    return Object.fromEntries(s.sheets.map((sheet) => [sheet.title, structuredClone(sheet.grid)]));
  }

  setWorkbook(fileId: string, wb: Workbook): void {
    const s = this.sheets.get(fileId);
    if (!s) throw new Error(`no spreadsheet ${fileId}`);
    s.sheets = s.sheets.filter((sheet) => Object.hasOwn(wb, sheet.title));
    for (const [title, grid] of Object.entries(wb)) {
      const sheet = s.sheets.find((x) => x.title === title);
      // A person typing rows in the sheet grows it to hold them.
      if (sheet) {
        sheet.grid = structuredClone(grid);
        sheet.rowCount = Math.max(sheet.rowCount, grid.length);
      } else {
        s.sheets.push({
          sheetId: 1000 + s.sheets.length, title, index: s.sheets.length, hidden: false, frozenRows: 0, columnCount: DEFAULT_COLUMNS,
          rowCount: Math.max(DEFAULT_ROWS, grid.length), grid: structuredClone(grid),
        });
      }
    }
  }

  /** A person deleting the empty rows at the bottom of a tab (or adding some): the tab's grid becomes `rowCount` rows. */
  setRowCount(fileId: string, title: string, rowCount: number): void {
    const sheet = this.sheets.get(fileId)?.sheets.find((x) => x.title === title);
    if (!sheet) throw new Error(`no tab ${title}`);
    if (sheet.grid.length > rowCount) throw new Error('the tab has content past that row');
    sheet.rowCount = rowCount;
  }

  private nextId(prefix: string) {
    this.counter += 1;
    return `${prefix}${String(this.counter).padStart(8, '0')}AbCdEfGhIjKlMnOpQrStUv`;
  }

  private route({ method, url, body }: Call): Response {
    if (url.href.startsWith(DRIVE_API)) return this.drive(method, url, body);
    if (url.href.startsWith(SHEETS_API)) return this.sheetsApi(method, url, body);
    return notFound();
  }

  private drive(method: string, url: URL, body: unknown): Response {
    const id = decodeURIComponent(url.pathname.split('/files')[1]?.replace(/^\//, '') ?? '');
    if (method === 'GET' && !id) return this.list(url.searchParams.get('q'));
    if (method === 'POST' && !id) {
      const { name, mimeType, parents = [] } = body as { name: string; mimeType: string; parents?: string[] };
      for (const parent of parents) if (!this.folderMap.has(parent)) return notFound();
      if (mimeType === 'application/vnd.google-apps.folder') {
        const folder = { id: this.nextId('fold'), name, parents, trashed: false };
        this.folderMap.set(folder.id, folder);
        return json(200, { id: folder.id });
      }
      if (mimeType === 'application/vnd.google-apps.spreadsheet') {
        const sheet: FakeSpreadsheet = {
          id: this.nextId('1sht'), name, parents, trashed: false,
          sheets: [{ sheetId: 0, title: 'Sheet1', index: 0, hidden: false, frozenRows: 0, columnCount: DEFAULT_COLUMNS, rowCount: DEFAULT_ROWS, grid: [] }],
          validations: [], protections: [], formats: [],
        };
        this.sheets.set(sheet.id, sheet);
        return json(200, { id: sheet.id });
      }
      return badRequest(`unsupported mimeType ${mimeType}`);
    }
    const item = this.sheets.get(id) ?? this.folderMap.get(id);
    if (!item) return notFound();
    if (method === 'GET') return json(200, { id: item.id, name: item.name, trashed: item.trashed });
    if (method === 'PATCH') {
      const patch = body as { trashed?: boolean; name?: string };
      if (patch.trashed) item.trashed = true;
      if (typeof patch.name === 'string') item.name = patch.name;
      return json(200, { id: item.id });
    }
    return badRequest('unsupported drive call');
  }

  /** files.list for the one query the adapter sends: folders by name and parent ('root' is My Drive). Else 400. */
  private list(q: string | null): Response {
    const m = /^name = '([^']*)' and mimeType = '([^']*)' and trashed = false and '([^']*)' in parents$/.exec(q ?? '');
    if (!m) return badRequest(`fake does not support q=${q}`);
    const [, name, mimeType, parent] = m;
    if (mimeType !== 'application/vnd.google-apps.folder') return badRequest('fake lists folders only');
    const files = this.folders()
      .filter((f) => f.name === name && !f.trashed && (parent === 'root' ? f.parents.length === 0 : f.parents.includes(parent!)))
      .map((f) => ({ id: f.id }));
    return json(200, { files });
  }

  private sheetsApi(method: string, url: URL, body: unknown): Response {
    const rest = url.pathname.slice(new URL(SHEETS_API).pathname.length + 1);
    const [, rawId, action] = /^([^/:]*)(\/values:batchGet|\/values:batchUpdate|:batchUpdate)?$/.exec(rest) ?? [];
    const s = this.sheets.get(decodeURIComponent(rawId!));
    if (!s) return notFound();

    if (method === 'GET' && action === undefined) {
      return json(200, {
        properties: { title: s.name },
        sheets: [...s.sheets].sort((a, b) => a.index - b.index).map((sheet) => ({
          properties: {
            sheetId: sheet.sheetId, title: sheet.title, index: sheet.index, hidden: sheet.hidden,
            gridProperties: { rowCount: sheet.rowCount, columnCount: sheet.columnCount },
          },
        })),
      });
    }
    if (method === 'GET' && action === '/values:batchGet') {
      const q = url.searchParams;
      if (q.get('valueRenderOption') !== 'UNFORMATTED_VALUE' || q.get('dateTimeRenderOption') !== 'SERIAL_NUMBER') {
        return badRequest('fake requires UNFORMATTED_VALUE and SERIAL_NUMBER');
      }
      const valueRanges = [];
      for (const range of q.getAll('ranges')) {
        const parsed = this.resolve(s, range);
        if (!parsed) return badRequest(`Unable to parse range: ${range}`);
        const { sheet, row, col, endRow, endCol } = parsed;
        if (endRow !== undefined && endRow >= sheet.rowCount) return this.pastGrid(range, sheet);
        const slice = sheet.grid.slice(row, endRow === undefined ? undefined : endRow + 1)
          .map((r) => r.slice(col, endCol === undefined ? undefined : endCol + 1));
        const values = trimGrid(slice);
        valueRanges.push(values.length ? { range, majorDimension: 'ROWS', values } : { range, majorDimension: 'ROWS' });
      }
      return json(200, { spreadsheetId: s.id, valueRanges });
    }
    if (method === 'POST' && action === '/values:batchUpdate') {
      const { valueInputOption, data } = body as { valueInputOption: string; data: Array<{ range: string; values: Cell[][] }> };
      if (valueInputOption !== 'RAW') return badRequest('fake requires valueInputOption=RAW');
      for (const { range, values } of data) {
        const parsed = this.resolve(s, range);
        if (!parsed) return badRequest(`Unable to parse range: ${range}`);
        const rows = values.length;
        const cols = Math.max(0, ...values.map((r) => r.length));
        if ((parsed.endRow !== undefined && rows > parsed.endRow - parsed.row + 1)
          || (parsed.endCol !== undefined && cols > parsed.endCol - parsed.col + 1)) {
          return badRequest(`Range (${range}): tried writing to row or column outside the range`);
        }
        if (parsed.row + rows > parsed.sheet.rowCount || parsed.col + cols > parsed.sheet.columnCount) return this.pastGrid(range, parsed.sheet);
      }
      for (const { range, values } of data) {
        const parsed = this.resolve(s, range)!;
        values.forEach((rowValues, i) => {
          const r = parsed.row + i;
          const target = (parsed.sheet.grid[r] ??= []);
          rowValues.forEach((value, j) => {
            if (value === null || value === undefined) return; // null = leave the cell alone (Sheets semantics)
            target[parsed.col + j] = value;
          });
          for (let k = 0; k < target.length; k++) if (target[k] === undefined) target[k] = null;
        });
        for (let r = 0; r < parsed.sheet.grid.length; r++) parsed.sheet.grid[r] ??= [];
      }
      return json(200, { totalUpdatedCells: data.length });
    }
    if (method === 'POST' && action === ':batchUpdate') {
      const replies: unknown[] = [];
      const snapshot = structuredClone(s); // :batchUpdate is all or nothing
      for (const request of (body as { requests: Array<Record<string, Record<string, unknown>>> }).requests) {
        const [kind, args] = Object.entries(request)[0]!;
        const reply = this.batchRequest(s, kind, args);
        if (reply instanceof Response) {
          Object.assign(s, snapshot);
          return reply;
        }
        replies.push(reply);
      }
      return json(200, { spreadsheetId: s.id, replies });
    }
    return badRequest(`unsupported sheets call ${method} ${action}`);
  }

  private batchRequest(s: FakeSpreadsheet, kind: string, args: Record<string, unknown>): unknown {
    const byId = (sheetId: unknown) => s.sheets.find((x) => x.sheetId === sheetId);
    switch (kind) {
      case 'updateSheetProperties': {
        const props = args.properties as Partial<FakeSheet> & { sheetId: number; gridProperties?: { frozenRowCount?: number } };
        const sheet = byId(props.sheetId);
        if (!sheet) return badRequest('no such sheet');
        if (props.title !== undefined) sheet.title = props.title;
        if (props.index !== undefined) sheet.index = props.index;
        if (props.hidden !== undefined) sheet.hidden = props.hidden;
        if (props.gridProperties?.frozenRowCount !== undefined) sheet.frozenRows = props.gridProperties.frozenRowCount;
        return {};
      }
      case 'addSheet': {
        const props = args.properties as {
          sheetId: number; title: string; index: number; hidden?: boolean;
          gridProperties?: { frozenRowCount?: number; columnCount?: number; rowCount?: number };
        };
        // As Google is expected to (seen in the real Drive upgrade from 4 to 5): two names that differ only
        // in letter case are one name.
        const taken = (title: string) => title.toLowerCase() === props.title.toLowerCase();
        if (s.sheets.some((x) => taken(x.title) || x.sheetId === props.sheetId)) return badRequest('duplicate sheet');
        // As Google: the tabs from that position on move one to the right.
        for (const sheet of s.sheets) if (sheet.index >= props.index) sheet.index += 1;
        s.sheets.push({
          sheetId: props.sheetId, title: props.title, index: props.index, hidden: !!props.hidden,
          frozenRows: props.gridProperties?.frozenRowCount ?? 0, columnCount: props.gridProperties?.columnCount ?? DEFAULT_COLUMNS,
          rowCount: props.gridProperties?.rowCount ?? DEFAULT_ROWS, grid: [],
        });
        return { addSheet: { properties: props } };
      }
      case 'appendDimension': {
        const { sheetId, dimension, length } = args as { sheetId: number; dimension: string; length: number };
        const sheet = byId(sheetId);
        if (!sheet || !(length > 0)) return badRequest('bad appendDimension');
        if (dimension === 'ROWS') sheet.rowCount += length;
        else if (dimension === 'COLUMNS') sheet.columnCount += length;
        else return badRequest('bad appendDimension');
        return {};
      }
      case 'deleteDimension': {
        const range = args.range as { sheetId: number; dimension: string; startIndex: number; endIndex: number };
        const sheet = byId(range.sheetId);
        if (!sheet || range.dimension !== 'ROWS') return badRequest('bad deleteDimension');
        sheet.grid.splice(range.startIndex, range.endIndex - range.startIndex);
        sheet.rowCount -= range.endIndex - range.startIndex;
        return {};
      }
      case 'setDataValidation': {
        const refused = this.outsideGrid(s, args.range as GridRange);
        if (refused) return refused;
        s.validations.push(args);
        return {};
      }
      case 'addProtectedRange': {
        const protectedRange = args.protectedRange as FakeSpreadsheet['protections'][number];
        const refused = this.outsideGrid(s, protectedRange.range);
        if (refused) return refused;
        s.protections.push(protectedRange);
        return {};
      }
      case 'repeatCell': {
        const refused = this.outsideGrid(s, args.range as GridRange);
        if (refused) return refused;
        s.formats.push({ [kind]: args });
        return {};
      }
      case 'updateCells': {
        // Only clearing, as the output tabs use it: every cell in the range loses its value and its format.
        const range = args.range as GridRange;
        const refused = this.outsideGrid(s, range);
        if (refused) return refused;
        if (!String(args.fields).includes('userEnteredValue')) return badRequest('fake supports clearing updateCells only');
        const sheet = byId(range.sheetId)!;
        const [r0, r1] = [range.startRowIndex ?? 0, range.endRowIndex ?? sheet.rowCount];
        const [c0, c1] = [range.startColumnIndex ?? 0, range.endColumnIndex ?? sheet.columnCount];
        sheet.grid.forEach((row, r) => {
          if (r < r0 || r >= r1) return;
          for (let c = c0; c < Math.min(c1, row.length); c++) row[c] = null;
        });
        s.formats.push({ [kind]: args });
        return {};
      }
      case 'mergeCells':
      case 'unmergeCells': {
        const refused = this.outsideGrid(s, args.range as GridRange);
        if (refused) return refused;
        s.formats.push({ [kind]: args });
        return {};
      }
      case 'updateDimensionProperties': {
        const range = args.range as { sheetId: number; dimension: string; startIndex: number; endIndex: number };
        const refused = range.dimension === 'COLUMNS'
          ? this.outsideGrid(s, { sheetId: range.sheetId, startColumnIndex: range.startIndex, endColumnIndex: range.endIndex })
          : this.outsideGrid(s, { sheetId: range.sheetId });
        if (refused) return refused;
        s.formats.push({ [kind]: args });
        return {};
      }
      default:
        return badRequest(`fake does not support ${kind}`);
    }
  }

  /** A 400 when `range` names no tab or reaches past the tab's columns or rows, as Google answers; otherwise null. */
  private outsideGrid(s: FakeSpreadsheet, range: GridRange): Response | null {
    const sheet = s.sheets.find((x) => x.sheetId === range.sheetId);
    if (!sheet) return badRequest(`No grid with id: ${range.sheetId}`);
    if ((range.endColumnIndex ?? 0) > sheet.columnCount || (range.startColumnIndex ?? 0) >= sheet.columnCount
      || (range.endRowIndex ?? 0) > sheet.rowCount || (range.startRowIndex ?? 0) >= sheet.rowCount) {
      return this.pastGrid(`'${sheet.title}'`, sheet);
    }
    return null;
  }

  private pastGrid(range: string, sheet: FakeSheet): Response {
    return badRequest(`Range (${range}) exceeds grid limits. Max rows: ${sheet.rowCount}, max columns: ${sheet.columnCount}`);
  }

  private resolve(s: FakeSpreadsheet, range: string) {
    const m = RANGE.exec(range);
    if (!m) return null;
    const sheet = s.sheets.find((x) => x.title === m[1]!.replaceAll("''", "'"));
    if (!sheet) return null;
    if (!m[2]) return { sheet, row: 0, col: 0, endRow: undefined, endCol: undefined };
    const row = Number(m[3]) - 1;
    const col = columnIndex(m[2]);
    return { sheet, row, col, endRow: m[5] ? Number(m[5]) - 1 : row, endCol: m[4] ? columnIndex(m[4]) : col };
  }
}

/** A GoogleClient wired to the fake, with instant retries. */
export function fakeClient(fake: FakeGoogle, token: () => Promise<string> = async () => 'test-token'): GoogleClient {
  return new GoogleClient({ getAccessToken: token, fetch: fake.fetch, sleep: async () => {}, random: () => 0 });
}

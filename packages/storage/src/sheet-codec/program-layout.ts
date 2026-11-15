// How Company facts and a program lie in their spreadsheets. PartnerStandard Desk adds the `_meta` tab (format
// version 1) and reads a program's lists row by row: a row that can't be read is left out with a problem (a RowIssue)
// and is never written over, where Program Designer refused the whole program. Company facts version 2 adds our
// figures and the Our cost lines tab (business cases).
import { parseCompanyFacts, parseProgram, PREF_REQ, type BenefitGroup, type CompanyFacts, type Issue, type PrefReq, type Program } from '@partner-desk/core';
import { SHEET_COPY } from '@partner-desk/copy';
import type { RowIssue } from '../types';
import {
  FIGURE_PATHS, OUR_COST_COLUMNS, OUR_COSTS_TAB, figuresRecord, ourCostRecords, readCostLine, readFigures, sourceOf,
} from './case-records';
import { CREATED_WITH } from './encode';
import type { Cell, Workbook } from './grid';
import {
  COMPANY_PATHS, COMPANY_TAB, GROUP_WORDS, LISTS, LIST_COLUMNS, PROGRAM_PATHS, Reader, STANDARD_KEYS, capital, companyRecord, isBlank,
  listOf, programRecords, readCompanyValues, readProgramValues, settingAt, settingsReader, textOf, type CompanySetting, type List,
  type ProgramSetting, type Values,
} from './program-records';
import { CURRENT_SCHEMA_VERSIONS, OLDEST_READABLE_VERSIONS, upgrade, type WorkbookKind } from './version';

/**
 * A Setting / Value tab holds one row per setting, found by its name; a list tab one row per item. Columns are found by
 * their header, so a person may move rows and columns, add blank rows or their own columns. A problem names the tab
 * and the row number as a person sees it, never what was typed.
 */

export const META_TAB = '_meta';
export { COMPANY_TAB, OUR_COSTS_TAB };
export const PROGRAM_SHEET_TAB = 'Program Sheet';
export const PROGRAM_TAB = 'Program';
export const PUBLIC_TAB = 'Public page';

/** The tabs each file is read from (`_meta` included). The Program Sheet and Public page are output only, never read. */
export const COMPANY_READ_TABS = [COMPANY_TAB, OUR_COSTS_TAB, META_TAB] as const;
export const PROGRAM_READ_TABS = [PROGRAM_TAB, ...LISTS, META_TAB] as const;
/** Each file's tabs, in order. */
export const COMPANY_TABS = [COMPANY_TAB, OUR_COSTS_TAB, META_TAB] as const;
export const PROGRAM_TABS = [PROGRAM_SHEET_TAB, PROGRAM_TAB, ...LISTS, PUBLIC_TAB, META_TAB] as const;
export const OUTPUT_TABS = [PROGRAM_SHEET_TAB, PUBLIC_TAB] as const;

export const SETTINGS_HEADER = ['Setting', 'Value'] as const;
const HEADERS: Record<string, readonly string[]> = { [PROGRAM_TAB]: SETTINGS_HEADER, ...LIST_COLUMNS, [OUR_COSTS_TAB]: OUR_COST_COLUMNS };

/** Tabs' values as read, row 1 first, by title. A tab left out is missing from the spreadsheet. */
export type Grids = Partial<Record<string, Cell[][]>>;

/** One row to write: `values` fill row `row` (1-based) from column `from` (0-based); null leaves a cell alone. */
export interface RowWrite { tab: string; row: number; from: number; values: Cell[] }

/** Why a file can't be read at all. The tab is where the problem is; the message is for people. */
export type BookFailure = { ok: false; error: 'structure'; tab: string; message: string };

/**
 * A file as read: its value, the rows left out (`issues`), and `writes`, which makes the file hold `next` without
 * touching those rows, a person's own rows and columns, or the output tabs.
 */
export type BookRead<T> = { ok: true; value: T; issues: RowIssue[]; writes(next: T): RowWrite[] } | BookFailure;

/** Settings that hold a date: a date a person typed is a day number (a date serial), read as YYYY-MM-DD; a time of day in it is dropped. */
const DATE_SETTINGS = new Set(['publish the criteria on']);
/** Day 0 of a spreadsheet's date serials. */
const SERIAL_EPOCH = Date.UTC(1899, 11, 30);

export const normal = (cell: Cell | undefined) => String(cell ?? '').trim().toLowerCase();
const unique = (items: string[]) => [...new Set(items)];
export const failure = (tab: string, problems: string[]): BookFailure => ({ ok: false, error: 'structure', tab, message: unique(problems).join(' ') });

export interface TabRow { at: number; cells: Cell[] }

/** One tab as read: where its columns are, its record rows, and what is wrong with it. */
export class Tab {
  readonly columns = new Map<string, number>();
  readonly problems: string[] = [];
  readonly rows: TabRow[] = [];
  /** The last row with anything in it (1-based); new rows go below it. */
  readonly end: number;

  /**
   * `headers`: the tab's columns (by default the program and Company facts tab's own). `key`: the column that makes a
   * row a record (Setting); otherwise any of the tab's columns filled in does.
   */
  constructor(readonly title: string, grid: Cell[][] | undefined, headers: readonly string[] = HEADERS[title]!, key?: string) {
    if (grid === undefined) {
      this.problems.push(SHEET_COPY.ISSUES.MISSING_TAB(title));
      this.end = 0;
      return;
    }
    const header = grid[0] ?? [];
    for (const column of headers) {
      const at = header.findIndex((cell) => normal(cell) === normal(column));
      if (at >= 0) this.columns.set(column, at);
      else this.problems.push(SHEET_COPY.ISSUES.MISSING_COLUMN(title, column));
    }
    const counted = key === undefined ? [...this.columns.values()] : [this.columns.get(key)].filter((at) => at !== undefined);
    let end = 0;
    grid.forEach((cells, i) => {
      if (cells.some((cell) => !isBlank(cell))) end = i + 1;
      if (i > 0 && counted.some((at) => !isBlank(cells[at]))) this.rows.push({ at: i + 1, cells });
    });
    this.end = end;
  }

  cell(row: TabRow, column: string): Cell {
    const at = this.columns.get(column);
    return at === undefined ? null : (row.cells[at] ?? null);
  }

  /** The row's cells by column. */
  values(row: TabRow): Values {
    return Object.fromEntries([...this.columns.keys()].map((column) => [column, this.cell(row, column)]));
  }

  /** Writes the columns `record` names into row `at`, as '' where the record holds null; other cells are left alone. */
  write(at: number, record: Values): RowWrite {
    const positions = [...this.columns.values()];
    const from = Math.min(...positions);
    const values: Cell[] = Array.from({ length: Math.max(...positions) - from + 1 }, () => null);
    for (const [column, position] of this.columns) {
      if (Object.hasOwn(record, column)) values[position - from] = record[column] ?? '';
    }
    return { tab: this.title, row: at, from, values };
  }

  /** Empties the tab's own columns of row `at`, so it reads as a blank row; a person's own columns are left alone. */
  blank(at: number): RowWrite {
    return this.write(at, Object.fromEntries([...this.columns.keys()].map((column) => [column, ''])));
  }
}

/**
 * A Setting / Value tab: one row per setting. A setting named twice is a problem. `earlierNames` maps a setting to the
 * names it had before: a file that still has an earlier one is read and written under it, never given a second row.
 */
export class SettingsTab extends Tab {
  constructor(title: string, grid: Cell[][] | undefined, private readonly earlierNames: Record<string, readonly string[]> = {}) {
    super(title, grid, SETTINGS_HEADER, 'Setting');
    const byName = new Map<string, number[]>();
    for (const row of this.rows) {
      const name = normal(this.cell(row, 'Setting'));
      byName.set(name, [...(byName.get(name) ?? []), row.at]);
    }
    for (const rows of byName.values()) {
      if (rows.length > 1) this.problems.push(`${title} rows ${listOf(rows)} have the same Setting.`);
    }
  }

  /** The row (1-based) a setting is on, under its name or an earlier one, if it has one. */
  rowOf(name: string): number | undefined {
    return this.rowNamed(name)?.at;
  }

  private rowNamed(name: string): TabRow | undefined {
    for (const candidate of [name, ...(this.earlierNames[name] ?? [])]) {
      const row = this.rows.find((r) => normal(this.cell(r, 'Setting')) === normal(candidate));
      if (row) return row;
    }
    return undefined;
  }

  /** Each setting's value, by its name as written. */
  settings(): Values {
    const values: Values = {};
    for (const row of this.rows) {
      const name = textOf(this.cell(row, 'Setting'));
      let value = this.cell(row, 'Value');
      if (DATE_SETTINGS.has(name.toLowerCase()) && typeof value === 'number' && Number.isFinite(value)) {
        value = new Date(SERIAL_EPOCH + Math.floor(value) * 86_400_000).toISOString().slice(0, 10);
      }
      if (!Object.hasOwn(values, name)) values[name] = value;
    }
    for (const [name, earlier] of Object.entries(this.earlierNames)) {
      const found = earlier.find((old) => Object.hasOwn(values, old));
      if (!Object.hasOwn(values, name) && found !== undefined) values[name] = values[found]!;
    }
    return values;
  }

  /** Each setting's value into its own row, wherever it is; a setting without a row goes below everything. */
  writes(values: Values): RowWrite[] {
    let next = this.end + 1;
    return Object.entries(values).map(([name, value]) => {
      const row = this.rowNamed(name);
      return row ? this.write(row.at, { Value: value }) : this.write(next++, { Setting: name, Value: value });
    });
  }
}

/* ---------- _meta ---------- */

export function metaRows(kind: WorkbookKind, ids: Array<[string, string]>): Cell[][] {
  return [['key', 'value'], ['schemaVersion', CURRENT_SCHEMA_VERSIONS[kind]], ...ids, ['createdWith', CREATED_WITH]];
}

/** What `readMeta` gives: the grids as this version reads them, the file's ids, and the cells that upgrade the file. */
export type MetaRead = { ok: true; grids: Grids; ids: Record<string, string>; upgrades: RowWrite[] };

/**
 * The file's format version and ids, as in the other PartnerStandard Desk files: a file without them is not ours, one saved
 * by a newer version is not read. An older version is read upgraded; `upgrades` are the cells the next save writes
 * to upgrade the file itself (each a cell the upgrade fills in, `_meta`'s schemaVersion last).
 */
export function readMeta(kind: WorkbookKind, grids: Grids, idKeys: string[]): MetaRead | BookFailure {
  const I = SHEET_COPY.ISSUES;
  const grid = grids[META_TAB];
  if (!grid) return failure(META_TAB, [I.NOT_OURS]);
  const meta = new Map(grid.map((row) => [normal(row[0]).replace(/[^a-z0-9]/g, ''), row[1]]));
  const version = Number(meta.get('schemaversion'));
  if (!Number.isInteger(version) || version < OLDEST_READABLE_VERSIONS[kind] || idKeys.some((key) => textOf(meta.get(key.toLowerCase())) === '')) {
    return failure(META_TAB, [I.NOT_OURS]);
  }
  if (version > CURRENT_SCHEMA_VERSIONS[kind]) return failure(META_TAB, [I.NEWER_VERSION]);
  const ids = Object.fromEntries(idKeys.map((key) => [key, textOf(meta.get(key.toLowerCase()))]));
  const upgraded = upgrade(kind, grids as Workbook, version);
  const upgrades = upgraded.cells.map((cell): RowWrite => ({ tab: cell.tab, row: cell.row, from: cell.col, values: [cell.value] }));
  return { ok: true, grids: upgraded.wb, ids, upgrades };
}

/* ---------- Company facts ---------- */

/** Company facts' settings by path: the company's, and our figures'. */
const FACTS_PATHS: Record<string, string> = {
  ...COMPANY_PATHS, ...Object.fromEntries(Object.entries(FIGURE_PATHS).map(([path, setting]) => [`ours.figures.${path}`, setting])),
};

/** Problems name the setting: "Customers who renew (%) in Company facts: enter a number from 0 to 100.". */
function sentences(issues: Issue[], settings: string, paths: Record<string, string>): string[] {
  return issues.map(({ path, message, located }) => {
    const setting = settingAt(paths, path === '' ? [] : path.split('.'));
    return setting ? `${setting} in ${settings}: ${located}` : message;
  });
}

/** A cost line typed without an Id gets one from its row, written on the next save. */
export const rowId = (at: number) => `row_${at}`;

/** Company facts' cells, our figures after the company's own settings (where a version 1 file gets them too). */
const factsRecord = (facts: CompanyFacts): Values => ({ ...companyRecord(facts), ...figuresRecord(facts.ours.figures) });

/**
 * The Company facts file as read. Every setting must be readable: one that isn't makes the file unreadable (as in
 * Program Designer), so a save never writes a stand-in over what a person typed. An empty figure reads as 0, an empty
 * source as Assumption. A row of Our cost lines that can't be read is left out with an issue, as a program's list row; a save finds each
 * line's row by its Id.
 */
export function readCompanyFactsBook(input: Grids): BookRead<CompanyFacts> {
  const meta = readMeta('companyFacts', input, ['companyId']);
  if (!meta.ok) return meta;
  const tab = new SettingsTab(COMPANY_TAB, meta.grids[COMPANY_TAB]);
  if (tab.problems.length > 0) return failure(COMPANY_TAB, tab.problems);
  const costTab = new Tab(OUR_COSTS_TAB, meta.grids[OUR_COSTS_TAB]);
  if (costTab.problems.length > 0) return failure(OUR_COSTS_TAB, costTab.problems);
  const problems: string[] = [];
  const r = settingsReader<CompanySetting>(tab.settings(), COMPANY_TAB, problems);
  const values = readCompanyValues(r);
  const figures = readFigures(r as Reader, true);
  if (problems.length > 0) return failure(COMPANY_TAB, problems);
  const costs = readRows(costTab, OUR_COSTS_TAB, (c, row) => ({ ...readCostLine(c, rowId(row.at)), source: sourceOf(c, 'Source') }),
    (row) => normal(costTab.cell(row, 'Id')) || rowId(row.at));
  markDuplicates(costs, OUR_COSTS_TAB, 'Id');

  // A cost line that breaks a rule of the facts is left out too; then the rest is checked again.
  for (;;) {
    const parsed = parseCompanyFacts({ ...values, ours: { figures, costs: good(costs).map((row) => row.value) } });
    if (parsed.ok) {
      const issues = costs.flatMap((row) => row.problems.map((message) => ({ tab: OUR_COSTS_TAB, row: row.at, message })));
      const writes = (next: CompanyFacts): RowWrite[] => [
        ...meta.upgrades, ...tab.writes(factsRecord(next)), ...keyedWrites(costTab, costs, ourCostRecords(next.ours.costs), 'Id'),
      ];
      return { ok: true, value: parsed.company, issues, writes };
    }
    const lineOf = (path: string): ListRow<unknown> | undefined => {
      const [ours, list, at] = path.split('.');
      return ours === 'ours' && list === 'costs' && at !== undefined ? good(costs)[Number(at)] : undefined;
    };
    const unplaced = parsed.issues.filter((issue) => lineOf(issue.path) === undefined);
    if (unplaced.length > 0) {
      const tabOf = unplaced[0]!.path.startsWith('ours.costs') ? OUR_COSTS_TAB : COMPANY_TAB;
      return failure(tabOf, sentences(unplaced, COMPANY_TAB, FACTS_PATHS));
    }
    for (const issue of parsed.issues) {
      const row = lineOf(issue.path)!;
      row.problems.push(`${rowName(OUR_COSTS_TAB, row.at)}: ${issue.located}`);
      row.value = null;
    }
  }
}

/** Every tab of a Company facts file just made to hold `facts`. */
export function freshCompanyFactsGrids(facts: CompanyFacts, companyId: string): Workbook {
  return {
    [COMPANY_TAB]: [[...SETTINGS_HEADER], ...Object.entries(factsRecord(facts))],
    [OUR_COSTS_TAB]: [[...OUR_COST_COLUMNS], ...ourCostRecords(facts.ours.costs).map((record) => OUR_COST_COLUMNS.map((column) => record[column] ?? ''))],
    [META_TAB]: metaRows('companyFacts', [['companyId', companyId]]),
  };
}

/* ---------- Programs ---------- */

/** One list row as read: its value, or the problems that leave it out. `key` finds the row on a save (Benefits, Requirements). */
export interface ListRow<T> { list: string; at: number; value: T | null; problems: string[]; key: string }

type BenefitRow = { key: string; own: boolean; reg: boolean; pref: boolean; group: BenefitGroup; name: string };
type RequirementRow = { key: keyof PrefReq; on: boolean; people: number };
type BarRow = { label: string; value: number; unit: string };

export const rowName = (list: string, at: number) => `${list} row ${at}`;
/** An id setting that isn't the file's own (the ids in `_meta`). */
export const ID_CHANGED = (setting: string, tab: string) =>
  `${setting} in ${tab} isn't this file's own. PartnerStandard Desk keeps the file's own and puts it back on the next save.`;

/** Each record row of `tab` read by `read`, with the problems of its cells. */
export function readRows<T>(tab: Tab, list: string, read: (r: Reader, row: TabRow) => T, keyOf: (row: TabRow) => string = () => ''): Array<ListRow<T>> {
  return tab.rows.map((row) => {
    const problems: string[] = [];
    const r = new Reader(tab.values(row), (column) => `${column} in ${rowName(list, row.at)}`, problems);
    const value = read(r, row);
    return { list, at: row.at, value: problems.length > 0 ? null : value, problems, key: keyOf(row) };
  });
}

/** Rows that share a key are all left out: which one is meant can't be told. */
export function markDuplicates<T>(rows: Array<ListRow<T>>, list: string, what: string): void {
  const byKey = new Map<string, Array<ListRow<T>>>();
  for (const row of rows) if (row.key !== '') byKey.set(row.key, [...(byKey.get(row.key) ?? []), row]);
  for (const same of byKey.values()) {
    if (same.length < 2) continue;
    const message = `${list} rows ${listOf(same.map((row) => row.at))} have the same ${what}.`;
    for (const row of same) {
      row.problems.push(message);
      row.value = null;
    }
  }
}

export const good = <T>(rows: Array<ListRow<T>>) => rows.filter((row): row is ListRow<T> & { value: T } => row.value !== null);

/** A list's records into the rows that were read, in order, then below everything; read rows left over are blanked. Rows left out are never touched. */
export function positionalWrites<T>(tab: Tab, rows: Array<ListRow<T>>, records: Values[]): RowWrite[] {
  const old = good(rows).map((row) => row.at);
  let next = tab.end + 1;
  return [
    ...records.map((record, i) => tab.write(old[i] ?? next++, record)),
    ...old.slice(records.length).map((at) => tab.blank(at)),
  ];
}

/**
 * Each record into the read row with its key, or below everything. A key held only by a row left out is not written at
 * all, so that row stays as the person typed it. Read rows no record names are blanked.
 */
export function keyedWrites<T>(tab: Tab, rows: Array<ListRow<T>>, records: Values[], keyColumn: string): RowWrite[] {
  const byKey = new Map(good(rows).map((row) => [row.key, row.at]));
  const held = new Set(rows.filter((row) => row.value === null && row.key !== '').map((row) => row.key));
  const used = new Set<number>();
  let next = tab.end + 1;
  const writes: RowWrite[] = [];
  for (const record of records) {
    const key = normal(record[keyColumn]);
    const at = byKey.get(key);
    if (at !== undefined) {
      used.add(at);
      writes.push(tab.write(at, record));
    } else if (!held.has(key)) {
      writes.push(tab.write(next++, record));
    }
  }
  for (const at of byKey.values()) if (!used.has(at)) writes.push(tab.blank(at));
  return writes;
}

/**
 * A program's file as read. The Program tab must be readable (as in Program Designer). A list row that can't be
 * read (a cell, a rule of the program, or a key another row has too) is left out with an issue: a Requirements row
 * left out, or one deleted, reads as not asked for.
 */
export function readProgramBook(input: Grids): BookRead<Program> {
  const meta = readMeta('program', input, ['companyId', 'programId']);
  if (!meta.ok) return meta;
  const grids = meta.grids;
  const settings = new SettingsTab(PROGRAM_TAB, grids[PROGRAM_TAB]);
  if (settings.problems.length > 0) return failure(PROGRAM_TAB, settings.problems);
  const tabs = Object.fromEntries(LISTS.map((list) => [list, new Tab(list, grids[list])])) as Record<List, Tab>;
  for (const list of LISTS) if (tabs[list].problems.length > 0) return failure(list, tabs[list].problems);

  const problems: string[] = [];
  const single = readProgramValues(settingsReader<ProgramSetting>(settings.settings(), PROGRAM_TAB, problems));
  if (problems.length > 0) return failure(PROGRAM_TAB, problems);
  // The ids in _meta are the file's own: a person who changed the Id or Company setting is told, and a save puts it back.
  const settingIssues: RowIssue[] = [];
  const fileIds: Array<['id' | 'companyId', ProgramSetting, string]> = [['id', 'Id', meta.ids.programId!], ['companyId', 'Company', meta.ids.companyId!]];
  for (const [field, setting, id] of fileIds) {
    if (single[field] === id) continue;
    single[field] = id;
    settingIssues.push({ tab: PROGRAM_TAB, row: settings.rowOf(setting) ?? 0, message: ID_CHANGED(setting, PROGRAM_TAB) });
  }

  const reasons = readRows(tabs.Reasons, 'Reasons', (r) => r.text('Reason'));
  const entry = readRows(tabs.Entry, 'Entry', (r) => r.text('What it takes'));
  const bars = readRows<BarRow>(tabs['Performance bar'], 'Performance bar', (r) => ({ label: r.text('Measure'), value: r.number('At least'), unit: r.text('Unit') }));
  const benefits = readRows<BenefitRow>(tabs.Benefits, 'Benefits', (r, row) => {
    const own = r.flag('Own');
    const value = { key: r.text('Key'), own, reg: r.flag('Registered'), pref: r.flag('Preferred'), group: 'Selling' as BenefitGroup, name: r.text('Benefit') };
    const place = `Key in ${rowName('Benefits', row.at)}`;
    if (value.key === '') r.problems.push(`${place} is empty.`);
    else if (!own && !STANDARD_KEYS.has(value.key)) r.problems.push(`${place} isn't a standard benefit. Set Own to Yes for a benefit of your own.`);
    else if (own && STANDARD_KEYS.has(value.key)) r.problems.push(`${place} belongs to a standard benefit. Set Own to No for it.`);
    if (own) value.group = r.word('Group', GROUP_WORDS);
    return value;
  }, (row) => normal(tabs.Benefits.cell(row, 'Key')));
  markDuplicates(benefits, 'Benefits', 'Key');
  const requirements = readRows<RequirementRow>(tabs.Requirements, 'Requirements', (r, row) => {
    const name = r.text('Requirement');
    const on = r.flag('On');
    const known = PREF_REQ.find(([, label]) => label.toLowerCase() === name.toLowerCase());
    if (name === '') r.problems.push(`Requirement in ${rowName('Requirements', row.at)} is empty.`);
    else if (!known) r.problems.push(`${rowName('Requirements', row.at)} has a requirement this tool doesn't know.`);
    const people = known?.[2] ? r.number('People') : 0;
    return { key: known?.[0] ?? 'contact', on, people };
  }, (row) => normal(tabs.Requirements.cell(row, 'Requirement')));
  markDuplicates(requirements, 'Requirements', 'Requirement');

  // A rule of the program that one list row breaks leaves that row out too; then the rest is checked again.
  for (;;) {
    const ownRows = good(benefits).filter((row) => row.value.own);
    const req = (key: keyof PrefReq) => good(requirements).find((row) => row.value.key === key);
    const flag = (key: Exclude<keyof PrefReq, 'certified'>) => req(key)?.value.on ?? false;
    const certified = req('certified')?.value;
    const candidate = {
      ...single,
      why: good(reasons).map((row) => row.value),
      entry: good(entry).map((row) => row.value),
      bars: good(bars).map((row) => row.value),
      reg: good(benefits).filter((row) => row.value.reg).map((row) => row.value.key),
      pref: good(benefits).filter((row) => row.value.pref).map((row) => row.value.key),
      own: ownRows.map(({ value }) => ({ k: value.key, g: value.group, n: value.name })),
      prefReq: {
        certified: certified ? { on: certified.on, people: certified.people } : { on: false, people: 1 },
        contact: flag('contact'), register: flag('register'), pipeline: flag('pipeline'), qbr: flag('qbr'), brand: flag('brand'),
      },
    };
    const parsed = parseProgram(candidate);
    if (parsed.ok) {
      const lists = { Reasons: reasons, Entry: entry, Benefits: benefits, Requirements: requirements, 'Performance bar': bars } as Record<List, Array<ListRow<unknown>>>;
      const issues = [...settingIssues, ...LISTS.flatMap((list) => lists[list].flatMap((row) => row.problems.map((message) => ({ tab: list, row: row.at, message }))))];
      const writes = (next: Program): RowWrite[] => {
        const records = programRecords(next);
        return [
          ...meta.upgrades,
          ...settings.writes(records.values),
          ...positionalWrites(tabs.Reasons, reasons, records.lists.Reasons),
          ...positionalWrites(tabs.Entry, entry, records.lists.Entry),
          ...keyedWrites(tabs.Benefits, benefits, records.lists.Benefits, 'Key'),
          ...keyedWrites(tabs.Requirements, requirements, records.lists.Requirements, 'Requirement'),
          ...positionalWrites(tabs['Performance bar'], bars, records.lists['Performance bar']),
        ];
      };
      return { ok: true, value: parsed.program, issues, writes };
    }
    /** The list row an issue is about, or null when it is about a setting or a whole list. */
    const rowOf = (path: string[]): ListRow<unknown> | null => {
      const [field, at] = path;
      const index = Number(at);
      if (at === undefined) return null;
      if (field === 'why') return good(reasons)[index] ?? null;
      if (field === 'entry') return good(entry)[index] ?? null;
      if (field === 'bars') return good(bars)[index] ?? null;
      if (field === 'own') return ownRows[index] ?? null;
      if (field === 'prefReq') return req(at as keyof PrefReq) ?? null;
      return null;
    };
    const located = parsed.issues.map((issue) => ({ issue, row: rowOf(issue.path === '' ? [] : issue.path.split('.')) }));
    const unplaced = located.filter(({ row }) => row === null);
    if (unplaced.length > 0) {
      const LIST_OF: Record<string, List> = { why: 'Reasons', entry: 'Entry', bars: 'Performance bar', own: 'Benefits', reg: 'Benefits', pref: 'Benefits', prefReq: 'Requirements' };
      const field = unplaced[0]!.issue.path.split('.')[0]!;
      const tab = LIST_OF[field] ?? PROGRAM_TAB;
      const words = unplaced.map(({ issue }) => {
        const setting = settingAt(PROGRAM_PATHS, issue.path === '' ? [] : issue.path.split('.'));
        return setting ? `${setting} in ${PROGRAM_TAB}: ${issue.located}` : LIST_OF[field] ? `${capital(issue.located)}` : issue.message;
      });
      return failure(tab, words);
    }
    for (const { issue, row } of located) {
      row!.problems.push(`${rowName(row!.list, row!.at)}: ${issue.located}`);
      row!.value = null;
    }
  }
}

/** Every tab of a program file just made to hold `p`: the data tabs filled, the output tabs empty. */
export function freshProgramGrids(p: Program, companyId: string): Workbook {
  const records = programRecords({ ...p, companyId });
  const lists = Object.fromEntries(LISTS.map((list) => [
    list, [[...LIST_COLUMNS[list]], ...records.lists[list].map((record) => LIST_COLUMNS[list].map((column) => record[column] ?? ''))],
  ]));
  return {
    [PROGRAM_SHEET_TAB]: [],
    [PROGRAM_TAB]: [[...SETTINGS_HEADER], ...Object.entries(records.values)],
    ...lists,
    [PUBLIC_TAB]: [],
    [META_TAB]: metaRows('program', [['companyId', companyId], ['programId', p.id]]),
  };
}

/** The grids with `writes` applied (null leaves a cell alone), as the file holds them after the write. */
export function applyRowWrites(grids: Grids, writes: RowWrite[]): Grids {
  const out: Grids = Object.fromEntries(Object.entries(grids).map(([tab, grid]) => [tab, grid!.map((row) => [...row])]));
  for (const w of writes) {
    const grid = (out[w.tab] ??= []);
    while (grid.length < w.row) grid.push([]);
    const row = grid[w.row - 1]!;
    w.values.forEach((value, i) => {
      if (value === null) return;
      while (row.length < w.from + i) row.push(null);
      row[w.from + i] = value;
    });
  }
  return out;
}

// How one business case lies in its spreadsheet. The Business Case app kept every case in one spreadsheet keyed by a
// Case column; PartnerStandard Desk keeps one case per file (format version 1 in `_meta`), with its ids in `_meta`.
// Read as a program is (program-layout.ts): the Setting / Value tabs must be readable, a list row that can't be read
// is left out with an issue and never written over.
import { parseStoredCase, type BusinessCase, type CaseIssue, type CostLine, type OurCostLine, type StrategicReason } from '@partner-desk/core';
import type { RowIssue } from '../types';
import {
  CASE_EARLIER_NAMES, CASE_LIST_COLUMNS, CASE_LISTS, CASE_PATHS, CASE_RATES, CASE_TAB, COSTS_TAB, FEE, MATTERS, OFFER_PATHS, OFFER_TAB, OURS_PATHS, OURS_TAB,
  PAID, PER, PRODUCTS_TAB, REASONS_TAB, SIDE, SUPPORT, TYPE_TAB, caseRecords, readCaseValues, readCostLine, readOfferValues,
  readOursValues, sourceOf, type CaseList, type CaseSetting, type OfferSetting, type Side,
} from './case-records';
import type { Workbook } from './grid';
import {
  failure, good, ID_CHANGED, keyedWrites, META_TAB, metaRows, normal, positionalWrites, readMeta, readRows, markDuplicates, rowId, rowName,
  SETTINGS_HEADER, SettingsTab, Tab, type BookRead, type Grids, type ListRow, type RowWrite, type TabRow,
} from './program-layout';
import { settingAt, settingsReader, type Reader } from './program-records';

/** Each tab of a case file, in order. Every one but `_meta` is read and written. */
export const CASE_TABS = [OFFER_TAB, PRODUCTS_TAB, TYPE_TAB, CASE_TAB, COSTS_TAB, OURS_TAB, REASONS_TAB, META_TAB] as const;
export const CASE_DATA_TABS = CASE_TABS.filter((tab) => tab !== META_TAB);
const SETTINGS_TABS = [OFFER_TAB, CASE_TAB, OURS_TAB] as const;

/** The Case tab's Type id and the Id in Partner type differ (a hand edit): the row's Id is kept. */
export const TYPE_ID_CHANGED =
  "Type id in Case isn't the Id in Partner type. PartnerStandard Desk keeps the Id in Partner type and writes it to both on the next save.";

type CostRow = { side: Side; line: CostLine | OurCostLine };

/** The list a path of the case is in, and the tab and the paths of the setting a path names when it is in none. */
function placeOf(path: string[]): { tab: string; paths: Record<string, string>; rest: string[] } {
  const [field, list] = path;
  if (field === 'offer') {
    if (list === 'types') return { tab: TYPE_TAB, paths: {}, rest: [] };
    if (list === 'products') return { tab: PRODUCTS_TAB, paths: {}, rest: [] };
    return { tab: OFFER_TAB, paths: OFFER_PATHS, rest: path.slice(1) };
  }
  if (field === 'costs') return { tab: COSTS_TAB, paths: {}, rest: [] };
  if (field === 'ours') {
    if (list === 'costs' || (list === 'alone' && path[2] === 'costs')) return { tab: COSTS_TAB, paths: {}, rest: [] };
    if (list === 'strategic') return { tab: REASONS_TAB, paths: {}, rest: [] };
    return { tab: OURS_TAB, paths: OURS_PATHS, rest: path.slice(1) };
  }
  return { tab: CASE_TAB, paths: CASE_PATHS, rest: path };
}

/** A problem with no one list row: "Deals year 2 in Case: Deals in year 2 must be 0 or more." */
function sentence(issue: CaseIssue, typeRows: TabRow[]): { tab: string; text: string } {
  const path = issue.path === '' ? [] : issue.path.split('.');
  const { tab, paths, rest } = placeOf(path);
  if (tab === TYPE_TAB && path[2] !== undefined) {
    const row = typeRows[Number(path[2])];
    return { tab, text: row ? `${rowName(TYPE_TAB, row.at)}: ${issue.message}` : issue.message };
  }
  const setting = settingAt(paths, rest);
  return { tab, text: setting ? `${setting} in ${tab}: ${issue.message}` : issue.message };
}

/**
 * A case's file as read. The Offer, Case and Our case tabs must be readable, and so must the one row of Partner type.
 * A row of Products, Costs or Strategic reasons that can't be read (a cell, a rule of the case, or an Id another row
 * has too) is left out with an issue. A row typed without an Id gets one from its row, written on the next save. A save
 * finds each line's row by its Id: a removed line blanks its own row, a new one goes below the last row in use, and the
 * one row of Partner type is written in place.
 */
export function readCaseBook(input: Grids): BookRead<BusinessCase> {
  const meta = readMeta('businessCase', input, ['companyId', 'caseId']);
  if (!meta.ok) return meta;
  const grids = meta.grids;
  const settings = Object.fromEntries(SETTINGS_TABS.map((title) => [title, new SettingsTab(title, grids[title], title === CASE_TAB ? CASE_EARLIER_NAMES : {})])) as Record<(typeof SETTINGS_TABS)[number], SettingsTab>;
  const lists = Object.fromEntries(CASE_LISTS.map((list) => [list, new Tab(list, grids[list], CASE_LIST_COLUMNS[list])])) as Record<CaseList, Tab>;
  const tabs: Record<string, Tab> = { ...settings, ...lists };
  for (const title of CASE_DATA_TABS) if (tabs[title]!.problems.length > 0) return failure(title, tabs[title]!.problems);

  const problemsOf = <T>(read: (problems: string[]) => T): { ok: true; value: T } | { ok: false; problems: string[] } => {
    const problems: string[] = [];
    const value = read(problems);
    return problems.length > 0 ? { ok: false, problems } : { ok: true, value };
  };
  const offer = problemsOf((p) => readOfferValues(settingsReader<OfferSetting>(settings[OFFER_TAB].settings(), OFFER_TAB, p)));
  if (!offer.ok) return failure(OFFER_TAB, offer.problems);
  const idOf = (tab: Tab) => (row: TabRow) => normal(tab.cell(row, 'Id')) || rowId(row.at);
  const products = readRows(lists[PRODUCTS_TAB], PRODUCTS_TAB, (r, row) => ({
    id: r.text('Id') || rowId(row.at), name: r.text('Product'), paid: r.word('Paid', PAID), price: r.number('Price'), per: r.word('Per', PER),
    amount: r.number('Amount'),
  }), idOf(lists[PRODUCTS_TAB]));
  markDuplicates(products, PRODUCTS_TAB, 'Id');
  const types = readRows(lists[TYPE_TAB], TYPE_TAB, (r, row) => {
    const rates = ([first, renewal, once, servicesShare]: readonly string[]) => ({
      first: r.number(first!), renewal: r.number(renewal!), once: r.number(once!), servicesShare: r.number(servicesShare!),
    });
    return {
      id: r.text('Id') || rowId(row.at),
      name: r.text('Partner type'),
      roles: {
        lead: r.number('Brings the lead (%)'), closes: r.flag('Closes and invoices'), support: r.word('Customer support', SUPPORT),
        services: r.flag('Delivers services'),
      },
      registered: rates(CASE_RATES.registered),
      preferred: rates(CASE_RATES.preferred),
      fee: r.number(FEE),
    };
  });
  // The case needs its partner type: a row of it that can't be read makes the case unreadable.
  const typeProblems = types.flatMap((row) => row.problems);
  if (typeProblems.length > 0) return failure(TYPE_TAB, typeProblems);
  const single = problemsOf((p) => readCaseValues(settingsReader<CaseSetting>(settings[CASE_TAB].settings(), CASE_TAB, p)));
  if (!single.ok) return failure(CASE_TAB, single.problems);
  // The ids in _meta are the file's own: a person who changed the Id setting is told, and a save puts it back.
  const settingIssues: RowIssue[] = [];
  if (single.value.id !== meta.ids.caseId) {
    settingIssues.push({ tab: CASE_TAB, row: settings[CASE_TAB].rowOf('Id') ?? 0, message: ID_CHANGED('Id', CASE_TAB) });
  }
  // A case has exactly one partner type, and its row's Id and the Case tab's Type id both name it. A row whose Id was
  // cleared takes the Type id, as a list row typed without an Id gets one. Else, when the two differ, the row's Id wins:
  // the person is told, and the next save writes the two in agreement (a case whose type isn't in its offer can't be
  // saved or worked out).
  const [typeRow] = types;
  if (types.length === 1 && typeRow!.value && typeRow!.value.id !== single.value.typeId) {
    if (normal(lists[TYPE_TAB].cell(lists[TYPE_TAB].rows[0]!, 'Id')) === '' && single.value.typeId.trim() !== '') {
      typeRow!.value.id = single.value.typeId;
    } else {
      settingIssues.push({ tab: CASE_TAB, row: settings[CASE_TAB].rowOf('Type id') ?? 0, message: TYPE_ID_CHANGED });
      single.value.typeId = typeRow!.value.id;
    }
  }
  const costs = readRows<CostRow>(lists[COSTS_TAB], COSTS_TAB, (r, row) => {
    const side = r.word('Side', SIDE);
    const line = readCostLine(r, rowId(row.at));
    return { side, line: side === 'partner' ? line : { ...line, source: sourceOf(r, 'Source') } };
  }, idOf(lists[COSTS_TAB]));
  markDuplicates(costs, COSTS_TAB, 'Id');
  const ours = problemsOf((p) => readOursValues(settingsReader<string>(settings[OURS_TAB].settings(), OURS_TAB, p) as Reader));
  if (!ours.ok) return failure(OURS_TAB, ours.problems);
  const reasons = readRows<StrategicReason>(lists[REASONS_TAB], REASONS_TAB, (r, row) => ({
    id: r.text('Id') || rowId(row.at), text: r.text('Reason'), weight: r.word('Matters', MATTERS), alone: r.flag('Alone too'),
  }), idOf(lists[REASONS_TAB]));
  markDuplicates(reasons, REASONS_TAB, 'Id');

  // A list row that breaks a rule of the case is left out too; then the rest is checked again.
  for (;;) {
    const side = (s: Side) => good(costs).filter((row) => row.value.side === s);
    const lines = (s: Side) => side(s).map((row) => row.value.line);
    const fields = {
      ...single.value,
      id: meta.ids.caseId!,
      companyId: meta.ids.companyId!,
      costs: lines('partner'),
      offer: { ...offer.value, products: good(products).map((row) => row.value), types: types.map((row) => row.value) },
      ours: {
        ...ours.value,
        costs: lines('ours'),
        strategic: good(reasons).map((row) => row.value),
        alone: { ...ours.value.alone, costs: lines('alone') },
      },
    };
    const parsed = parseStoredCase(fields);
    if (parsed.ok) {
      const all: Array<Array<ListRow<unknown>>> = [products, costs, reasons];
      const issues = [...settingIssues, ...all.flatMap((rows) => rows.flatMap((row) => row.problems.map((message) => ({ tab: row.list, row: row.at, message }))))];
      const writes = (next: BusinessCase): RowWrite[] => {
        const records = caseRecords({ ...next, id: meta.ids.caseId! });
        return [
          ...meta.upgrades,
          ...settings[OFFER_TAB].writes(records.offer),
          ...keyedWrites(lists[PRODUCTS_TAB], products, records.lists[PRODUCTS_TAB], 'Id'),
          ...positionalWrites(lists[TYPE_TAB], types, records.lists[TYPE_TAB]),
          ...settings[CASE_TAB].writes(records.case),
          ...keyedWrites(lists[COSTS_TAB], costs, records.lists[COSTS_TAB], 'Id'),
          ...settings[OURS_TAB].writes(records.ours),
          ...keyedWrites(lists[REASONS_TAB], reasons, records.lists[REASONS_TAB], 'Id'),
        ];
      };
      return { ok: true, value: parsed.case, issues, writes };
    }
    /** The list row an issue is about, or null when it is about a setting, the partner type or a whole list. */
    const rowOf = (path: string[]): ListRow<unknown> | null => {
      const at = (rows: Array<ListRow<unknown>>, index: string | undefined) => (index === undefined ? null : (rows[Number(index)] ?? null));
      const [field, a, b, c] = path;
      if (field === 'offer' && a === 'products') return at(good(products), b);
      if (field === 'costs') return at(side('partner'), a);
      if (field === 'ours' && a === 'costs') return at(side('ours'), b);
      if (field === 'ours' && a === 'alone' && b === 'costs') return at(side('alone'), c);
      if (field === 'ours' && a === 'strategic') return at(good(reasons), b);
      return null;
    };
    const located = parsed.issues.map((issue) => ({ issue, row: rowOf(issue.path === '' ? [] : issue.path.split('.')) }));
    const unplaced = located.filter(({ row }) => row === null).map(({ issue }) => sentence(issue, lists[TYPE_TAB].rows));
    if (unplaced.length > 0) return failure(unplaced[0]!.tab, unplaced.map(({ text }) => text));
    for (const { issue, row } of located) {
      row!.problems.push(`${rowName(row!.list, row!.at)}: ${issue.message}`);
      row!.value = null;
    }
  }
}

/** Every tab of a case file just made to hold `c`. */
export function freshCaseGrids(c: BusinessCase, companyId: string): Workbook {
  const records = caseRecords({ ...c, companyId });
  const settingRows = (values: Record<string, unknown>) => [[...SETTINGS_HEADER], ...Object.entries(values)] as Workbook[string];
  const lists = Object.fromEntries(CASE_LISTS.map((list) => [
    list, [[...CASE_LIST_COLUMNS[list]], ...records.lists[list].map((record) => CASE_LIST_COLUMNS[list].map((column) => record[column] ?? ''))],
  ]));
  return {
    [OFFER_TAB]: settingRows(records.offer),
    ...lists,
    [CASE_TAB]: settingRows(records.case),
    [OURS_TAB]: settingRows(records.ours),
    [META_TAB]: metaRows('businessCase', [['companyId', companyId], ['caseId', c.id]]),
  };
}

// docs/file-format.md describes every workbook both editions store (plan 18, task 4). Its tabs, columns and fields
// come from here: each kind is made the way the app makes it, and the page's generated part must match. After a
// change to a format, run `UPDATE_FILE_FORMAT=1 pnpm vitest run packages/storage/src/file-format.test.ts` and read
// the diff before you commit it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { MapPlan } from '@partner-desk/core';
import { sampleMarket } from '@partner-desk/core/test-builders';
import { buildSamplePlan } from '@partner-desk/method';
import { sampleCase } from './case-store.contract';
import { sampleFacts } from './company-facts-store.contract';
import { createDatabaseCaseStore } from './database/case-store';
import { exportWorkFile } from './database/export';
import { createDatabaseMapStore } from './database/map-store';
import { createDatabaseMarketStore } from './database/market-store';
import { MemoryWorkFiles } from './database/memory-work-files';
import { createDatabasePartnerBookStore } from './database/partner-book-store';
import { createDatabaseCompanyFactsStore, createDatabaseProgramStore } from './database/program-store';
import { sampleProgram } from './program-store.contract';
import type { Cell } from './sheet-codec/grid';
import { CURRENT_SCHEMA_VERSIONS, OLDEST_READABLE_VERSIONS, WORKBOOK_KINDS, type WorkbookKind } from './sheet-codec/version';

const PAGE = fileURLToPath(new URL('../../../docs/file-format.md', import.meta.url));
const START = '<!-- generated: the workbooks (packages/storage/src/file-format.test.ts) -->';
const END = '<!-- end of generated -->';

const TITLES: Record<WorkbookKind, string> = {
  partners: 'Partners', market: 'A market', program: 'A program', companyFacts: 'Company facts', businessCase: 'A business case', map: 'A MAP',
};
/** Tabs the app writes for people to read and never reads back. */
const VIEWS = new Set(['Start here', 'Program Sheet', 'Public page']);
/** A tab of fields, one per row (its first row's first cell names the field column). */
const FIELD_HEADERS = new Set(['Field', 'Setting']);
/** Field tabs read by position: the name in column A, the value in B (decode.ts). The others go by their header. */
const FIXED_FIELD_TABS = new Set(['Market', 'Plan']);
/** Tables whose rows are matched by another column than an id (program-layout.ts, keyedWrites). */
const KEYED: Record<string, string> = { Benefits: 'Key', Requirements: 'Requirement' };
/** Tables of exactly one row, written in place (case-layout.ts). */
const ONE_ROW = new Set(['Partner type']);

/** Each kind as the app makes it, from the contract tests' samples. */
async function workbooks(): Promise<Array<[WorkbookKind, Array<{ title: string; rows: Cell[][] }>]>> {
  const files = new MemoryWorkFiles();
  const owner = { userId: 'u_format', displayName: 'Anna Keller' };
  const company = 'co_contract001';
  const options = { files, appBaseUrl: 'https://desk.example' };
  const market = sampleMarket();
  const plan = buildSamplePlan('2026-11-07') as MapPlan;
  const made: Array<[WorkbookKind, string]> = [
    ['partners', (await createDatabasePartnerBookStore(options).create(owner, company)).fileId],
    ['market', (await createDatabaseMarketStore(options).create(owner, { ...market, info: { ...market.info, companyId: company } })).fileId],
    ['program', (await createDatabaseProgramStore(options).create(owner, company, sampleProgram())).fileId],
    ['companyFacts', (await createDatabaseCompanyFactsStore(options).create(owner, company, sampleFacts())).fileId],
    ['businessCase', (await createDatabaseCaseStore(options).create(owner, company, sampleCase())).fileId],
    ['map', (await createDatabaseMapStore(options).create(owner, company, { ...plan, info: { ...plan.info, partnerType: 'reseller' } }, 'Acme')).fileId],
  ];
  return Promise.all(made.map(async ([kind, fileId]) => {
    const out = await exportWorkFile(files, fileId);
    if (!out || out === 'unavailable') throw new Error(`no ${kind}`);
    return [kind, out.tabs] as [WorkbookKind, Array<{ title: string; rows: Cell[][] }>];
  })).then((all) => {
    // Every kind the app stores, so a new one can't be left off the page.
    expect(all.map(([kind]) => kind)).toEqual([...WORKBOOK_KINDS]);
    return all;
  });
}

const list = (cells: Cell[]) => cells.filter((c) => c !== '' && c !== null && c !== undefined).map((c) => `\`${String(c)}\``).join(', ');

/** The page's generated part: per workbook, its version and each tab with its columns or fields. */
async function generated(): Promise<string> {
  const out: string[] = [START, ''];
  for (const [kind, tabs] of await workbooks()) {
    out.push(`### ${TITLES[kind]} (\`${kind}\`)`, '');
    const [oldest, current] = [OLDEST_READABLE_VERSIONS[kind], CURRENT_SCHEMA_VERSIONS[kind]];
    out.push(oldest === current
      ? `Format version ${current}.`
      : `Format version ${current}. The app also reads ${oldest === current - 1 ? `version ${oldest}` : oldest === current - 2 ? `versions ${oldest} and ${current - 1}` : `versions ${oldest} to ${current - 1}`}, and brings such a file up to date on its next save. An older one is not read.`, '');
    out.push('| Tab | Holds |', '| --- | --- |');
    for (const { title, rows } of tabs) {
      const header = rows[0] ?? [];
      let holds: string;
      if (VIEWS.has(title)) holds = 'For people to read: the app writes it and never reads it back.';
      else if (title === '_meta') holds = `The file's own facts, under the columns ${list(header)}, one per row: ${list(rows.slice(1).map((r) => r[0] ?? ''))}.`;
      else if (FIELD_HEADERS.has(String(header[0]))) {
        const where = FIXED_FIELD_TABS.has(title) ? 'by position, in this order' : 'by header';
        holds = `One field per row, under the columns ${list(header)}, found ${where}. Its fields: ${list(rows.slice(1).map((r) => r[0] ?? ''))}.`;
      }
      else if (ONE_ROW.has(title)) holds = `One row, written in place, under the columns ${list(header)}.`;
      else if (KEYED[title]) holds = `One row each, found by its \`${KEYED[title]}\`, under the columns ${list(header)}.`;
      else if (header.some((c) => /^id$/i.test(String(c)))) holds = `One row each, found by its id, under the columns ${list(header)}.`;
      else holds = `A list, kept whole: one row each, in order, under the columns ${list(header)}.`;
      out.push(`| \`${title}\` | ${holds} |`);
    }
    out.push('');
  }
  out.push(END);
  return out.join('\n');
}

describe('docs/file-format.md', () => {
  it('describes every workbook as the app writes it now', async () => {
    const page = readFileSync(PAGE, 'utf8');
    const now = await generated();
    if (process.env.UPDATE_FILE_FORMAT === '1') {
      const parts = page.split(START);
      const inner = parts[1]?.split(END);
      if (parts.length !== 2 || inner?.length !== 2) throw new Error('the page needs exactly one generated part, between its two markers');
      const [before, after] = [parts[0]!, inner[1]!];
      writeFileSync(PAGE, `${before}${now}${after}`);
      return;
    }
    expect(page).toContain(START);
    expect(page).toContain(END);
    expect(page.slice(page.indexOf(START), page.indexOf(END) + END.length)).toBe(now);
  });
});

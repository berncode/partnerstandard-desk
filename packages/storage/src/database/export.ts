// A database file as a spreadsheet's tabs, for its download (plan 13, task 12): the same workbook Google holds, in the
// file's own tab order (never the body's key order), and named as its Drive file would be.
import { programLabel } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { SHEET_COPY } from '@partner-desk/copy';
import { CASE_TABS, readCaseBook } from '../sheet-codec/case-layout';
import { decodeMap, decodeMarket } from '../sheet-codec/decode';
import type { Cell, Workbook } from '../sheet-codec/grid';
import { MARKET_LAYOUT, PARTNERS_LAYOUT } from '../sheet-codec/layouts';
import { MAP_LAYOUT } from '../sheet-codec/map-layout';
import { COMPANY_TABS, PROGRAM_TABS, readProgramBook } from '../sheet-codec/program-layout';
import { readTabsOf } from './file-store';
import type { WorkFileKind, WorkFiles } from './work-files';
import { loadWorkFile } from './workbook-store';
import { PROGRAM_SPEC, CASE_SPEC } from '../workbook/file-specs';

export interface ExportedFile {
  kind: WorkFileKind;
  companyId: string;
  /** The file's name, as its Drive file would have it (without ".xlsx"). */
  name: string;
  /** Every tab, in the file's order: the layout's tabs first, then any other tab the file holds. */
  tabs: Array<{ title: string; rows: Cell[][] }>;
}

const TAB_ORDER: Record<WorkFileKind, readonly string[]> = {
  partners: PARTNERS_LAYOUT.tabOrder, market: MARKET_LAYOUT.tabOrder, map: MAP_LAYOUT.tabOrder,
  program: PROGRAM_TABS, companyFacts: COMPANY_TABS, businessCase: CASE_TABS,
};

/** The tabs of `wb` in the kind's order, then the rest in the order the body has them. */
export function orderedTabs(kind: WorkFileKind, wb: Workbook): ExportedFile['tabs'] {
  const order = TAB_ORDER[kind];
  const known = order.filter((title) => Object.hasOwn(wb, title));
  const others = Object.keys(wb).filter((title) => !order.includes(title));
  return [...known, ...others].map((title) => ({ title, rows: wb[title]! }));
}

/** A download's name: the name the file's Drive file would have; the kind's plain name when the file doesn't say more. */
export function exportName(kind: WorkFileKind, wb: Workbook): string {
  const D = SHEET_COPY.DRIVE;
  try {
    if (kind === 'partners') return D.partnersFile;
    if (kind === 'companyFacts') return D.companyFactsFile;
    if (kind === 'market') {
      const decoded = decodeMarket(wb);
      if (decoded.ok) return D.marketFile(decoded.value.value.info.marketName, PARTNER_TYPE_LABELS[decoded.value.value.info.partnerType]);
    }
    if (kind === 'program') {
      const read = readProgramBook(readTabsOf(wb, PROGRAM_SPEC.readTabs));
      if (read.ok) return D.programFile(programLabel(read.value));
    }
    if (kind === 'businessCase') {
      const read = readCaseBook(readTabsOf(wb, CASE_SPEC.readTabs));
      if (read.ok) return D.caseFile(read.value.partner, PARTNER_TYPE_LABELS[read.value.partnerType], read.value.createdAt.slice(0, 10));
    }
    if (kind === 'map') {
      // A MAP's file doesn't hold its partner's name (the Partners file does): the partner type names it.
      const decoded = decodeMap(wb);
      if (decoded.ok) return D.mapFileByType(PARTNER_TYPE_LABELS[decoded.value.value.info.partnerType]);
    }
  } catch {
    // A file that reads only in part still downloads, under its kind's plain name.
  }
  return FALLBACK_NAMES[kind];
}

const FALLBACK_NAMES: Record<WorkFileKind, string> = {
  partners: SHEET_COPY.DRIVE.partnersFile, companyFacts: SHEET_COPY.DRIVE.companyFactsFile, ...SHEET_COPY.DRIVE.plainFile,
};

/**
 * A database file as its tabs, for its download: null when there is no such file, it is trashed, or it can't be read
 * (`unavailable` when the database didn't answer). Reads only. The caller checks the file is the person's own.
 */
export async function exportWorkFile(files: WorkFiles, fileId: string): Promise<ExportedFile | null | 'unavailable'> {
  let kind: WorkFileKind;
  try {
    const row = await files.read(fileId);
    if (!row) return null;
    kind = row.kind;
  } catch {
    return 'unavailable';
  }
  const loaded = await loadWorkFile(files, kind, fileId);
  if (!loaded.ok) return loaded.error === 'unavailable' ? 'unavailable' : null;
  return { kind, companyId: loaded.row.companyId, name: exportName(kind, loaded.wb), tabs: orderedTabs(kind, loaded.wb) };
}

// Moved from google/program-store.ts and google/case-store.ts (plan 13): what each whole-file kind needs, shared by
// every store that keeps its workbook (Google Sheets, and the database edition's rows).
import type { BusinessCase, CompanyFacts, Program } from '@partner-desk/core';
import { CASE_DATA_TABS, CASE_TABS, readCaseBook } from '../sheet-codec/case-layout';
import {
  COMPANY_READ_TABS, COMPANY_TAB, COMPANY_TABS, OUR_COSTS_TAB, PROGRAM_READ_TABS, PROGRAM_TAB, PROGRAM_TABS, readCompanyFactsBook,
  readProgramBook, type BookRead, type Grids,
} from '../sheet-codec/program-layout';
import { LISTS } from '../sheet-codec/program-records';
import type { CaseChange, CompanyFactsChange, ProgramChange } from '../types';
import { CASE_SAVE, COMPANY_FACTS_SAVE, PROGRAM_SAVE, type SaveSpec } from '../whole-save';

/** What one kind of file needs: its tabs, how it reads, how a save is checked. */
export interface FileSpec<T extends { id: string; updatedAt: string }, C> {
  /** Every tab, in file order; the tabs read back, `_meta` included; the data tabs (header row frozen and bold). */
  tabs: readonly string[];
  readTabs: readonly string[];
  dataTabs: readonly string[];
  read(grids: Grids): BookRead<T>;
  save: SaveSpec<T, C>;
}

export const PROGRAM_SPEC: FileSpec<Program, ProgramChange> = {
  tabs: PROGRAM_TABS, readTabs: PROGRAM_READ_TABS, dataTabs: [PROGRAM_TAB, ...LISTS], read: readProgramBook, save: PROGRAM_SAVE,
};

export const COMPANY_FACTS_SPEC: FileSpec<CompanyFacts, CompanyFactsChange> = {
  tabs: COMPANY_TABS, readTabs: COMPANY_READ_TABS, dataTabs: [COMPANY_TAB, OUR_COSTS_TAB], read: readCompanyFactsBook, save: COMPANY_FACTS_SAVE,
};

export const CASE_SPEC: FileSpec<BusinessCase, CaseChange> = {
  tabs: CASE_TABS, readTabs: CASE_TABS, dataTabs: CASE_DATA_TABS, read: readCaseBook, save: CASE_SAVE,
};

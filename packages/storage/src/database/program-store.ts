import { OUTPUT_NOTE, type CompanyFacts, type Program, type SheetContent } from '@partner-desk/core';
import { COPY, SHEET_COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import type { Workbook } from '../sheet-codec/grid';
import { freshCompanyFactsGrids, freshProgramGrids, PROGRAM_SHEET_TAB, PUBLIC_TAB } from '../sheet-codec/program-layout';
import { noteTime, publicTabValues, sheetTabValues } from '../sheet-codec/program-output';
import type { CompanyFactsChange, CompanyFactsStore, CreatedFile, FileRef, OwnerContext, ProgramChange, ProgramStore } from '../types';
import { COMPANY_FACTS_SPEC, PROGRAM_SPEC } from '../workbook/file-specs';
import { DatabaseSettingsFileStore } from './file-store';
import { SAVE_ATTEMPTS, type DatabaseStoreOptions } from './workbook-store';

/** One program per file in the database: Program Designer's tabs, and `_meta`, as on Google. */
class DatabaseProgramStore extends DatabaseSettingsFileStore<Program, ProgramChange> implements ProgramStore {
  constructor(options: DatabaseStoreOptions) {
    super(PROGRAM_SPEC, 'program', options);
  }

  create(_owner: OwnerContext, companyId: string, program: Program): Promise<CreatedFile> {
    return this.createFile(companyId, program, freshProgramGrids(program, companyId));
  }

  /** A deleted program goes to the trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }

  /**
   * Rewrites the Program Sheet and Public page tabs with the output note, as on Google, and never the tabs the program
   * is read from. Throws StoreFailure when it can't.
   */
  async writeOutputs(ref: FileRef, sheet: SheetContent, publicText: string): Promise<void> {
    const note = OUTPUT_NOTE(noteTime(this.now()));
    const outputs: Workbook = { [PROGRAM_SHEET_TAB]: sheetTabValues(sheet, note), [PUBLIC_TAB]: publicTabValues(publicText, note) };
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const loaded = await this.load(ref);
      if (!loaded.ok) throw new StoreFailure(loaded.error, loaded.message);
      // A tab of the same name in other letters would sit beside the output tab, and Sheets and Excel take both as one:
      // the download would be a file no tool opens (plan 13's final review, as the workbook stores' upgrades refuse it).
      for (const tab of Object.keys(outputs)) {
        const theirs = Object.keys(loaded.wb).find((title) => title !== tab && title.toLowerCase() === tab.toLowerCase());
        if (theirs !== undefined) throw new StoreFailure('structure', SHEET_COPY.ISSUES.TAB_NAME_TAKEN(theirs, tab));
      }
      let wrote: boolean;
      try {
        // The row's own format version stays: outputs aren't a save of the program, and never upgrade it.
        wrote = await this.files.write(ref.fileId, loaded.row.revision, {
          body: JSON.stringify({ ...loaded.wb, ...outputs }), formatVersion: loaded.row.formatVersion, updatedAt: loaded.row.updatedAt,
        });
      } catch {
        throw new StoreFailure('unavailable', COPY.DB_UNAVAILABLE_MESSAGE);
      }
      if (wrote) return;
    }
    throw new StoreFailure('conflict', COPY.SHEET_CHANGED_MESSAGE);
  }
}

/** One Company facts file per company in the database: a Setting / Value tab, and `_meta`. */
class DatabaseCompanyFactsStore extends DatabaseSettingsFileStore<CompanyFacts, CompanyFactsChange> implements CompanyFactsStore {
  constructor(options: DatabaseStoreOptions) {
    super(COMPANY_FACTS_SPEC, 'companyFacts', options);
  }

  create(_owner: OwnerContext, companyId: string, facts: CompanyFacts): Promise<CreatedFile> {
    return this.createFile(companyId, facts, freshCompanyFactsGrids(facts, companyId));
  }
}

/** A program store in the database. Wrap it in `serializeApplies(...)` in the app; no read cache. */
export const createDatabaseProgramStore = (options: DatabaseStoreOptions): ProgramStore => new DatabaseProgramStore(options);
/** A Company facts store in the database. Wrap it in `serializeApplies(...)` in the app; no read cache. */
export const createDatabaseCompanyFactsStore = (options: DatabaseStoreOptions): CompanyFactsStore => new DatabaseCompanyFactsStore(options);


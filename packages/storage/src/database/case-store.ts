import type { BusinessCase } from '@partner-desk/core';
import { freshCaseGrids } from '../sheet-codec/case-layout';
import type { CaseChange, CaseStore, CreatedFile, FileRef, OwnerContext } from '../types';
import { CASE_SPEC } from '../workbook/file-specs';
import { DatabaseSettingsFileStore } from './file-store';
import type { DatabaseStoreOptions } from './workbook-store';

/** One business case per file in the database: the Business Case app's tabs for one case, and `_meta`, as on Google. */
class DatabaseCaseStore extends DatabaseSettingsFileStore<BusinessCase, CaseChange> implements CaseStore {
  constructor(options: DatabaseStoreOptions) {
    super(CASE_SPEC, 'businessCase', options);
  }

  create(_owner: OwnerContext, companyId: string, c: BusinessCase): Promise<CreatedFile> {
    return this.createFile(companyId, c, freshCaseGrids(c, companyId));
  }

  /** A deleted case goes to the trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }
}

/** A business case store in the database. Wrap it in `serializeApplies(...)` in the app; no read cache. */
export const createDatabaseCaseStore = (options: DatabaseStoreOptions): CaseStore => new DatabaseCaseStore(options);

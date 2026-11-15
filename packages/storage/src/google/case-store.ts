// A business case's spreadsheet on the person's Google Drive: one file per case, on the same whole-file store as a
// program (program-store.ts). The Business Case app kept every case in one file.
import type { BusinessCase } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS } from '@partner-desk/method';
import { SHEET_COPY } from '@partner-desk/copy';
import { freshCaseGrids } from '../sheet-codec/case-layout';
import type { CaseChange, CaseStore, CreatedFile, FileRef, OwnerContext } from '../types';
import { renameKeepingPrefix } from './rename';
import { GoogleSettingsFileStore } from './program-store';
import { CASE_SPEC } from '../workbook/file-specs';
import type { GoogleStoreOptions } from './workbook-store';

/** "PartnerStandard Desk – Business case – Acme as Reseller · 2026-10-30": the partner, its type and the day the case was made. */
export const caseFileName = (c: Pick<BusinessCase, 'partner' | 'partnerType' | 'createdAt'>) =>
  SHEET_COPY.DRIVE.caseFile(c.partner, PARTNER_TYPE_LABELS[c.partnerType], c.createdAt.slice(0, 10));

/** One spreadsheet per case: the Business Case app's tabs for one case, and `_meta`. */
class GoogleCaseStore extends GoogleSettingsFileStore<BusinessCase, CaseChange> implements CaseStore {
  constructor(options: GoogleStoreOptions) {
    super(CASE_SPEC, options);
  }

  create(owner: OwnerContext, companyId: string, c: BusinessCase): Promise<CreatedFile> {
    return this.createFile(owner, caseFileName(c), c, freshCaseGrids(c, companyId));
  }

  /** A deleted case goes to the person's Drive trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }

  /** The file is named after the partner: renamed when that changes. Best effort. */
  protected override async saved(ref: FileRef, before: BusinessCase, after: BusinessCase): Promise<void> {
    if (caseFileName(before) === caseFileName(after)) return;
    await renameKeepingPrefix(this.client, ref.fileId, caseFileName(after));
  }
}

/** A business case store on the person's Google Drive. Wrap it in `cacheReads(serializeApplies(...))` in the app. */
export const createGoogleCaseStore = (options: GoogleStoreOptions): CaseStore => new GoogleCaseStore(options);

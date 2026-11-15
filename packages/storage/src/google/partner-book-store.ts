import type { PartnerBook, PartnerChange, PartnerEntity } from '@partner-desk/core';
import { SHEET_COPY } from '@partner-desk/copy';
import { encodePartnerBook } from '../sheet-codec/encode';
import type { CreatedFile, FileRef, OwnerContext, PartnerBookStore } from '../types';
import { GoogleWorkbookStore, type GoogleStoreOptions } from './workbook-store';
import { PARTNERS_SPEC } from '../workbook/writer';

/** The Partners workbook, one per company, named "PartnerStandard Desk – Partners". */
class GooglePartnerBookStore extends GoogleWorkbookStore<PartnerBook, PartnerChange, PartnerEntity> implements PartnerBookStore {
  constructor(options: GoogleStoreOptions) {
    super(PARTNERS_SPEC, options);
  }

  create(owner: OwnerContext, companyId: string): Promise<CreatedFile> {
    const book: PartnerBook = { companyId, accounts: [], partners: [], people: [], calls: [], qualifications: [], marketLinks: [], proposalItems: [] };
    return this.createFile(owner, SHEET_COPY.DRIVE.partnersFile, encodePartnerBook(book, { appUrl: `${this.appBaseUrl}/partners` }));
  }

  /** A file the app replaced (an old version) goes to the person's Drive trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }
}

/** A Partner book store on the person's Google Drive. Wrap it in `cacheReads(serializeApplies(...))` in the app. */
export const createGooglePartnerBookStore = (options: GoogleStoreOptions): PartnerBookStore => new GooglePartnerBookStore(options);

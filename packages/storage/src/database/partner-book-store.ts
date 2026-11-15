import type { PartnerBook, PartnerChange, PartnerEntity } from '@partner-desk/core';
import { encodePartnerBook } from '../sheet-codec/encode';
import type { CreatedFile, FileRef, OwnerContext, PartnerBookStore } from '../types';
import { PARTNERS_SPEC } from '../workbook/writer';
import { DatabaseWorkbookStore, type DatabaseStoreOptions } from './workbook-store';

/** The Partners workbook in the database, one per company, as the Google store makes it. */
class DatabasePartnerBookStore extends DatabaseWorkbookStore<PartnerBook, PartnerChange, PartnerEntity> implements PartnerBookStore {
  constructor(options: DatabaseStoreOptions) {
    super(PARTNERS_SPEC, 'partners', options);
  }

  create(_owner: OwnerContext, companyId: string): Promise<CreatedFile> {
    const book: PartnerBook = { companyId, accounts: [], partners: [], people: [], calls: [], qualifications: [], marketLinks: [], proposalItems: [] };
    return this.createFile(companyId, encodePartnerBook(book, { appUrl: `${this.appBaseUrl}/partners` }));
  }

  /** An old file the app replaced goes to the trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }
}

/** A Partner book store in the database. Wrap it in `serializeApplies(...)` in the app; no read cache. */
export const createDatabasePartnerBookStore = (options: DatabaseStoreOptions): PartnerBookStore => new DatabasePartnerBookStore(options);

import type { EntityKind, MapPlan } from '@partner-desk/core';
import { encodeMap } from '../sheet-codec/encode';
import type { CreatedFile, FileRef, MapFileChange, MapStore, OwnerContext } from '../types';
import { MAP_SPEC } from '../workbook/writer';
import { DatabaseWorkbookStore, type DatabaseStoreOptions } from './workbook-store';

/** A MAP's workbook in the database, one per MAP, as the Google store makes it. */
class DatabaseMapStore extends DatabaseWorkbookStore<MapPlan, MapFileChange, EntityKind> implements MapStore {
  constructor(options: DatabaseStoreOptions) {
    super(MAP_SPEC, 'map', options);
  }

  /** The Start here tab links to the Plans page: the MAP's own id is made by the caller, after the file. */
  create(_owner: OwnerContext, companyId: string, plan: MapPlan): Promise<CreatedFile> {
    return this.createFile(companyId, encodeMap(plan, companyId, { appUrl: `${this.appBaseUrl}/plans` }));
  }

  /** A deleted MAP goes to the trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }
}

/** A MAP store in the database. Wrap it in `serializeApplies(...)` in the app; no read cache. */
export const createDatabaseMapStore = (options: DatabaseStoreOptions): MapStore => new DatabaseMapStore(options);

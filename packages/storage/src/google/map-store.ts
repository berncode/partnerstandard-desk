// A MAP's spreadsheet on the person's Google Drive: one file per MAP, on the Partners file's row-by-row store
// (workbook-store.ts). The MAP app's Microsoft and Notion stores are not carried over.
import type { EntityKind, MapPlan } from '@partner-desk/core';
import { PARTNER_TYPE_LABELS, type PartnerType } from '@partner-desk/method';
import { SHEET_COPY } from '@partner-desk/copy';
import { encodeMap } from '../sheet-codec/encode';
import type { CreatedFile, FileRef, MapFileChange, MapStore, OwnerContext } from '../types';
import { GoogleWorkbookStore, type GoogleStoreOptions } from './workbook-store';
import { MAP_SPEC } from '../workbook/writer';

/** "PartnerStandard Desk – MAP – Acme as Reseller": the partner and its partner type. */
export const mapFileName = (partnerName: string, partnerType: PartnerType) => SHEET_COPY.DRIVE.mapFile(partnerName, PARTNER_TYPE_LABELS[partnerType]);

class GoogleMapStore extends GoogleWorkbookStore<MapPlan, MapFileChange, EntityKind> implements MapStore {
  constructor(options: GoogleStoreOptions) {
    super(MAP_SPEC, options);
  }

  /** The Start here tab links to the Plans page: the MAP's own id is made by the caller, after the file. */
  create(owner: OwnerContext, companyId: string, plan: MapPlan, partnerName: string): Promise<CreatedFile> {
    return this.createFile(owner, mapFileName(partnerName, plan.info.partnerType), encodeMap(plan, companyId, { appUrl: `${this.appBaseUrl}/plans` }));
  }

  /** A deleted MAP goes to the person's Drive trash, never deleted for good. */
  trash(ref: FileRef): Promise<void> {
    return this.moveToTrash(ref);
  }
}

/** A MAP store on the person's Google Drive. Wrap it in `cacheReads(serializeApplies(...))` in the app. */
export const createGoogleMapStore = (options: GoogleStoreOptions): MapStore => new GoogleMapStore(options);

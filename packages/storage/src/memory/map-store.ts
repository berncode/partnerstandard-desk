// MAPs held in memory as domain values, changed with the same function the Google store plans its writes from.
import type { MapPlan } from '@partner-desk/core';
import { applyMapFileChanges } from '../map-changes';
import type { CreatedFile, FileRef, MapFileChange, MapStore, OwnerContext } from '../types';
import { MemoryFileStore } from './file-store';

class MemoryMapStore extends MemoryFileStore<MapPlan, MapFileChange> implements MapStore {
  constructor() {
    super({
      apply(plan, change, stamp) {
        const out = applyMapFileChanges(plan, [change], stamp);
        if (out.ok) return { ok: true, value: out.value, entityId: out.entityIds[0] ?? null };
        return { ok: false, error: out.error, message: out.message, ...(out.fieldErrors === undefined ? {} : { fieldErrors: out.fieldErrors }) };
      },
      applyMany: applyMapFileChanges,
    });
  }

  async create(_owner: OwnerContext, _companyId: string, plan: MapPlan): Promise<CreatedFile> {
    return this.put(plan);
  }

  /** Memory has no Drive trash: the file is gone, as a trashed Google file reads as gone. */
  async trash(ref: FileRef): Promise<void> {
    this.files.delete(ref.fileId);
  }
}

/** A MAP store in memory: for development, the demo and tests. */
export const createMemoryMapStore = (): MapStore => new MemoryMapStore();

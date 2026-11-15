import type { BusinessCase } from '@partner-desk/core';
import type { CaseChange, CaseStore, CreatedFile, FileRef, OwnerContext } from '../types';
import { CASE_SAVE } from '../whole-save';
import { MemorySaveStore } from './program-stores';

class MemoryCaseStore extends MemorySaveStore<BusinessCase, CaseChange> implements CaseStore {
  constructor() {
    super(CASE_SAVE);
  }

  async create(_owner: OwnerContext, _companyId: string, c: BusinessCase): Promise<CreatedFile> {
    return this.put(c);
  }

  /** Memory has no Drive trash: the file is gone, as a trashed Google file reads as gone. */
  async trash(ref: FileRef): Promise<void> {
    this.files.delete(ref.fileId);
  }
}

/** A business case store in memory: for development, the demo and tests. */
export const createMemoryCaseStore = (): CaseStore => new MemoryCaseStore();

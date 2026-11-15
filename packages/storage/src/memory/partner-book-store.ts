import { applyPartnerChange, applyPartnerChanges, type PartnerBook, type PartnerChange } from '@partner-desk/core';
import { SHEET_COPY } from '@partner-desk/copy';
import type { CreatedFile, FileRef, OwnerContext, PartnerBookStore, ReadResult } from '../types';
import { MemoryFileStore } from './file-store';

/**
 * Test-only lists, on globalThis. Next can load this module twice (the seed route and the page), and a plain
 * module variable would then be two lists. A read of a marked file answers old_version and does not return the rows.
 */
const memoryBooks = globalThis as unknown as { __pdMemoryBooks?: { old: Set<string>; trashed: string[] } };
function bookTestState(): { old: Set<string>; trashed: string[] } {
  memoryBooks.__pdMemoryBooks ??= { old: new Set(), trashed: [] };
  return memoryBooks.__pdMemoryBooks;
}

/** Marks a memory Partners file as version 1, so the next read offers a new file. For the test seed only. */
export function markMemoryBookOld(fileId: string): void {
  bookTestState().old.add(fileId);
}

/** The Partners files trash() has been asked to drop, oldest first. */
export function memoryTrashedPartnerFiles(): readonly string[] {
  return bookTestState().trashed;
}

/** Clears the test-only old-version and trash lists. Does not delete files. */
export function resetMemoryBookTestState(): void {
  const state = bookTestState();
  state.old.clear();
  state.trashed.length = 0;
}

class MemoryPartnerBookStore extends MemoryFileStore<PartnerBook, PartnerChange> implements PartnerBookStore {
  constructor() {
    super({ apply: applyPartnerChange, applyMany: applyPartnerChanges });
  }

  async create(_owner: OwnerContext, companyId: string): Promise<CreatedFile> {
    return this.put({ companyId, accounts: [], partners: [], people: [], calls: [], qualifications: [], marketLinks: [], proposalItems: [] });
  }

  override async read(ref: FileRef): Promise<ReadResult<PartnerBook>> {
    if (bookTestState().old.has(ref.fileId)) return { ok: false, error: 'old_version', message: SHEET_COPY.ISSUES.OLD_VERSION };
    return super.read(ref);
  }

  /** Memory has no Drive trash: the file is gone, as a trashed Google file reads as gone, and the id is remembered. */
  async trash(ref: FileRef): Promise<void> {
    const state = bookTestState();
    state.trashed.push(ref.fileId);
    state.old.delete(ref.fileId);
    this.files.delete(ref.fileId);
  }
}

/** A Partner book store in memory: for development, the demo and tests. */
export const createMemoryPartnerBookStore = (): PartnerBookStore => new MemoryPartnerBookStore();

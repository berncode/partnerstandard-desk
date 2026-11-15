import type { ChangeStamp, CompanyFacts, Program, SheetContent } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { StoreFailure } from '../errors';
import { COMPANY_FACTS_SAVE, oneSave, planSave, PROGRAM_SAVE, type SaveSpec } from '../whole-save';
import type {
  ApplyManyResult, ApplyResult, CompanyFactsChange, CompanyFactsStore, CreatedFile, FileRef, OwnerContext, ProgramChange,
  ProgramStore, ReadResult, RowIssue, StoreError,
} from '../types';

const FILE_NOT_FOUND: StoreError = { ok: false, error: 'file_not_found', message: COPY.FILE_GONE };

/**
 * Hand edits waiting for their file, by file id: a person typing in the sheet, for the test seed. On globalThis, as the
 * Partners file's test state: the app may load this module twice, and the stores live in another copy than the route.
 */
const handEdits = globalThis as unknown as { __pdMemoryHandEdits?: Map<string, Record<string, unknown>> };
const pendingHandEdits = (): Map<string, Record<string, unknown>> => (handEdits.__pdMemoryHandEdits ??= new Map());

/**
 * Changes a Company facts or program file in memory as a hand edit in the sheet does: the values change, Updated
 * stays. Applied at the file's next read or save. For the test seed only.
 */
export function editMemoryFileByHand(fileId: string, patch: Record<string, unknown>): void {
  pendingHandEdits().set(fileId, { ...pendingHandEdits().get(fileId), ...patch });
}

/**
 * Row issues a file reads with, by file id, as a hand-edited sheet with unreadable rows has: for the test seed. Kept
 * until set again. On globalThis, as the hand edits.
 */
const testState = globalThis as unknown as {
  __pdMemoryRowIssues?: Map<string, RowIssue[]>;
  __pdMemoryOutputs?: Map<string, { sheet: SheetContent; publicText: string }>;
};
const rowIssues = (): Map<string, RowIssue[]> => (testState.__pdMemoryRowIssues ??= new Map());
/** The outputs last written, per program file: memory has no tabs to hold them. */
const writtenOutputs = (): Map<string, { sheet: SheetContent; publicText: string }> => (testState.__pdMemoryOutputs ??= new Map());

/** Makes a file in memory read (and save) with these row issues, as a sheet with unreadable rows does. For the test seed only. */
export function showMemoryRowIssues(fileId: string, issues: RowIssue[]): void {
  if (issues.length === 0) rowIssues().delete(fileId);
  else rowIssues().set(fileId, structuredClone(issues));
}

/** The Program Sheet and Public page last written to a program file in memory, or null. For the test seed only. */
export function memoryProgramOutputs(fileId: string): { sheet: SheetContent; publicText: string } | null {
  const written = writtenOutputs().get(fileId);
  return written ? structuredClone(written) : null;
}

const issuesOf = (fileId: string): RowIssue[] => structuredClone(rowIssues().get(fileId) ?? []);

/** Whole-record files kept in memory: programs, Company facts and business cases. */
export class MemorySaveStore<T extends { id: string; updatedAt: string }, C> {
  protected readonly files = new Map<string, T>();

  constructor(private readonly spec: SaveSpec<T, C>) {}

  protected put(value: T): CreatedFile {
    const parsed = this.spec.parse(value);
    if (!parsed.ok) throw new StoreFailure('invalid', parsed.issues[0]?.message ?? COPY.FIX_FIELDS);
    const fileId = `mem_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`;
    this.files.set(fileId, structuredClone(value));
    return { fileId, fileUrl: this.urlFor({ fileId }) };
  }

  urlFor(ref: FileRef): string {
    return `memory://${ref.fileId}`;
  }

  /** The file as it is now, a waiting hand edit applied. */
  private current(fileId: string): T | undefined {
    const stored = this.files.get(fileId);
    const patch = pendingHandEdits().get(fileId);
    if (stored === undefined || patch === undefined) return stored;
    pendingHandEdits().delete(fileId);
    const edited = { ...stored, ...patch, updatedAt: stored.updatedAt };
    this.files.set(fileId, edited);
    return edited;
  }

  async read(ref: FileRef): Promise<ReadResult<T>> {
    const value = this.current(ref.fileId);
    return value === undefined ? FILE_NOT_FOUND : { ok: true, snapshot: { value: structuredClone(value), issues: issuesOf(ref.fileId) } };
  }

  async apply(ref: FileRef, change: C, stamp: ChangeStamp): Promise<ApplyResult<T>> {
    const stored = this.current(ref.fileId);
    if (stored === undefined) return FILE_NOT_FOUND;
    const planned = planSave(this.spec, stored, change, stamp);
    if (!planned.ok) return planned;
    this.files.set(ref.fileId, structuredClone(planned.value));
    return { ok: true, snapshot: { value: structuredClone(planned.value), issues: issuesOf(ref.fileId) }, entityId: null };
  }

  async applyMany(ref: FileRef, changes: C[], stamp: ChangeStamp): Promise<ApplyManyResult<T>> {
    const batch = oneSave(changes);
    if (!batch.ok) return { ...batch, valid: 0 };
    if (batch.change === null) {
      const read = await this.read(ref);
      return read.ok ? { ok: true, snapshot: read.snapshot, entityIds: [] } : read;
    }
    const result = await this.apply(ref, batch.change, stamp);
    return result.ok ? { ok: true, snapshot: result.snapshot, entityIds: [null] } : { ...result, valid: 0 };
  }

  async discard(ref: FileRef): Promise<void> {
    this.files.delete(ref.fileId);
  }
}

class MemoryProgramStore extends MemorySaveStore<Program, ProgramChange> implements ProgramStore {
  constructor() {
    super(PROGRAM_SAVE);
  }

  async create(_owner: OwnerContext, _companyId: string, program: Program): Promise<CreatedFile> {
    return this.put(program);
  }

  /** Memory has no Drive trash: the file is gone, as a trashed Google file reads as gone. */
  async trash(ref: FileRef): Promise<void> {
    this.files.delete(ref.fileId);
    writtenOutputs().delete(ref.fileId);
  }

  async writeOutputs(ref: FileRef, sheet: SheetContent, publicText: string): Promise<void> {
    if (!this.files.has(ref.fileId)) throw new StoreFailure('file_not_found', COPY.FILE_GONE);
    writtenOutputs().set(ref.fileId, structuredClone({ sheet, publicText }));
  }
}

class MemoryCompanyFactsStore extends MemorySaveStore<CompanyFacts, CompanyFactsChange> implements CompanyFactsStore {
  constructor() {
    super(COMPANY_FACTS_SAVE);
  }

  async create(_owner: OwnerContext, _companyId: string, facts: CompanyFacts): Promise<CreatedFile> {
    return this.put(facts);
  }
}

/** A program store in memory: for development, the demo and tests. */
export const createMemoryProgramStore = (): ProgramStore => new MemoryProgramStore();
/** A Company facts store in memory: for development, the demo and tests. */
export const createMemoryCompanyFactsStore = (): CompanyFactsStore => new MemoryCompanyFactsStore();

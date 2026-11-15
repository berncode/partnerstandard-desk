/**
 * When the app last wrote each file, shared across instances so a read cache can tell its copy is stale. Keys are bare
 * file ids. The platform's TursoWriteMarks fits this shape; storage never imports it.
 */
export interface WriteMarks {
  mark(fileId: string, atMs: number): Promise<void>;
  latest(fileId: string): Promise<number | null>;
  /** Housekeeping: forgets marks written before `beforeMs`. Returns how many went. */
  prune(beforeMs: number): Promise<number>;
}

/** Write marks in memory: for one process (tests, development, the demo). */
export class MemoryWriteMarks implements WriteMarks {
  private readonly marks = new Map<string, number>();

  async mark(fileId: string, atMs: number): Promise<void> {
    this.marks.set(fileId, Math.max(this.marks.get(fileId) ?? atMs, atMs));
  }

  async latest(fileId: string): Promise<number | null> {
    return this.marks.get(fileId) ?? null;
  }

  async prune(beforeMs: number): Promise<number> {
    let count = 0;
    for (const [fileId, atMs] of this.marks) {
      if (atMs >= beforeMs) continue;
      this.marks.delete(fileId);
      count += 1;
    }
    return count;
  }
}

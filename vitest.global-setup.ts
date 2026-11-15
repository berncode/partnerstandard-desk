// One temporary folder per test run, removed when the run ends. Tests make a fresh database in the system's temporary
// folder (`createTestDb`, the migration tests), and before this they were never removed: 39,000 of them filled a
// disk (plan 15). Workers start after this runs, so `os.tmpdir()` in every test reads the run's own folder.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default function setup(): () => void {
  const dir = mkdtempSync(join(tmpdir(), 'pd-vitest-'));
  process.env.TMPDIR = dir;
  return () => rmSync(dir, { recursive: true, force: true });
}

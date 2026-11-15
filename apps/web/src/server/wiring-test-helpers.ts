// Test support for the wiring tests (plan 13, task 10). Not imported by app code.
import type { WorkFiles } from '@partner-desk/storage';

/**
 * A `work_files` port hosted wiring must never reach: every call throws and is counted, so a store that caught the
 * throw still fails the test's `afterEach` check of `touched`.
 */
export function untouchableWorkFiles(): WorkFiles & { touched: string[] } {
  const touched: string[] = [];
  const refuse = (name: string) => () => {
    touched.push(name);
    throw new Error(`hosted touched work_files.${name}`);
  };
  return { touched, create: refuse('create'), read: refuse('read'), write: refuse('write'), trash: refuse('trash'), restore: refuse('restore') };
}

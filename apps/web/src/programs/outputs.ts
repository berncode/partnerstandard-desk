// The outputs are rewritten through the `refreshProgramOutputs` command, which answers a result instead of throwing.

/** The most programs one refresh or one beacon rewrites. */
export const MAX_OUTPUT_IDS = 50;

/** What a program id looks like (`pg_` and 10 characters, packages/commands/src/programs.ts). */
export const PROGRAM_ID = /^pg_[0-9a-z]{10}$/;

/**
 * No rewrite starts later than this after the first: one started at the edge can take about 30 seconds more, and must
 * still end inside the 60 seconds of the route (`maxDuration`).
 */
export const REWRITE_BUDGET_MS = 25_000;

/**
 * Which rewrites didn't happen. `failed`: the storage failed (down, rate limited, signed out), or there was no time
 * left to start it; worth trying again soon. `refused`: the command said no (the program is gone, isn't the
 * person's, or can't be read); trying again only helps once something changed, so it waits for the program's screen
 * or its next save.
 */
export interface Rewritten {
  failed: string[];
  refused: string[];
}

/** What one rewrite answers: done, or the command's error code. */
export type RewriteOne = (programId: string) => Promise<{ ok: true } | { ok: false; error: string }>;

/** Errors a later try can get past: the storage was busy or down, or the sign-in needs renewing. */
const TRY_AGAIN = new Set(['unavailable', 'auth', 'quota']);

/**
 * Rewrites each program's Program Sheet and Public page, one after another, never two at once (Google allows about
 * 60 reads a minute), each id once. Never throws: a program whose rewrite was refused or failed is in the answer and
 * logged with ids only (`onFail`), and the rest go on. None starts after REWRITE_BUDGET_MS on `now`; those are failed
 * (`out_of_time`), so the screens send them again.
 */
export async function rewriteOutputs(
  programIds: readonly string[],
  rewrite: RewriteOne,
  onFail: (programId: string, reason: string) => void,
  now: () => number = Date.now,
): Promise<Rewritten> {
  const answer: Rewritten = { failed: [], refused: [] };
  const startBy = now() + REWRITE_BUDGET_MS;
  for (const id of new Set(programIds)) {
    if (now() >= startBy) {
      answer.failed.push(id);
      onFail(id, 'out_of_time');
      continue;
    }
    try {
      const result = await rewrite(id);
      if (result.ok) continue;
      (TRY_AGAIN.has(result.error) ? answer.failed : answer.refused).push(id);
      onFail(id, result.error);
    } catch (error) {
      answer.failed.push(id);
      onFail(id, error instanceof Error ? error.name : 'unknown');
    }
  }
  return answer;
}

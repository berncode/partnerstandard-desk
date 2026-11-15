// A company server's own timer for the scheduled job (plan 17, task 2; spec 2026-11-07 §10.3). Hosted keeps Vercel Cron
// and never starts it (instrumentation.ts). Every quarter hour, on the clock as Vercel Cron runs it, the server calls its
// own /api/cron/tick: the same work, inside a request, where the job's after-the-answer sends work [builder's call].
import type { Log } from './log';

/** The job's interval: every 15 minutes, as Vercel Cron runs it (vercel.json). */
export const EVERY_MS = 15 * 60_000;

export interface SchedulerDeps {
  /** One run of the job. Resolves when it is done; a rejection is logged and the next run comes as usual. */
  run: () => Promise<void>;
  log: Log;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => { unref?: () => void };
  clearTimer?: (timer: unknown) => void;
}

export interface Scheduler {
  /** No more runs; resolves once a run that is going has ended. */
  stop: () => Promise<void>;
}

/**
 * How long after the quarter hour a run starts. A timer may fire a few milliseconds early; aimed just past the
 * boundary, a run never lands a moment before it (which would run twice, or miss the hour's clean-up at :59:59).
 */
export const PAST_THE_QUARTER_MS = 2000;

/**
 * The time until the next run: the next quarter hour on the clock, and a moment more. Less than a second away means a
 * timer that fired early for this run: the next one is a quarter hour later.
 */
export function untilNextRun(now: number): number {
  const wait = EVERY_MS - ((now - PAST_THE_QUARTER_MS + EVERY_MS) % EVERY_MS);
  return wait < 1000 ? wait + EVERY_MS : wait;
}

/** Starts the timer. A run still going when the next one is due is skipped, never doubled. */
export function startScheduler(deps: SchedulerDeps): Scheduler {
  const now = deps.now ?? Date.now;
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((timer) => clearTimeout(timer as NodeJS.Timeout));
  let running: Promise<void> | null = null;
  let stopped = false;
  let timer: ReturnType<typeof setTimer> | null = null;

  const schedule = () => {
    if (stopped) return;
    timer = setTimer(tick, untilNextRun(now()));
    // The timer never keeps the process alive on its own: the server does.
    timer.unref?.();
  };
  function tick() {
    if (stopped) return;
    if (running) {
      deps.log('scheduler_skipped', {});
    } else {
      const began = now();
      running = deps.run()
        // One line a run, so whoever runs the server sees the job runs: its time only.
        .then(() => { deps.log('scheduler_ran', { ms: String(now() - began) }); })
        .catch((error: unknown) => { deps.log('scheduler_run_failed', { reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }); })
        .finally(() => { running = null; });
    }
    schedule();
  }

  schedule();
  return {
    stop: async () => {
      stopped = true;
      if (timer) clearTimer(timer);
      await running;
    },
  };
}

/** Where the server answers itself: its own address when it listens on one, else this computer. */
export function selfAddress(env: { PORT?: string; HOSTNAME?: string }): string {
  const host = env.HOSTNAME && !['0.0.0.0', '::', '[::]'].includes(env.HOSTNAME) ? env.HOSTNAME : '127.0.0.1';
  return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${env.PORT || '3000'}`;
}

/** One run: the server's own /api/cron/tick with its secret. Throws when it doesn't answer 200. */
export async function callTick(base: string, secret: string, fetcher: typeof fetch = fetch): Promise<void> {
  const res = await fetcher(`${base}/api/cron/tick`, {
    headers: { authorization: `Bearer ${secret}` },
    // The job's own deadline is 50 seconds; this only stops a server that never answers from holding the timer.
    signal: AbortSignal.timeout(120_000),
  });
  await res.body?.cancel();
  if (!res.ok) throw new Error(`tick_status_${res.status}`);
}

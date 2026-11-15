// The Node.js half of instrumentation.ts, on a company server only (plan 17): the database's start-up copy and
// migrations, then the scheduled job's own timer. Kept apart so the edge build never sees it.
import { randomBytes } from 'node:crypto';
import { serverEnv } from '@partner-desk/platform/env';
import { prepareDatabase } from '@partner-desk/platform/startup';
import { migrationsFolder, startCompanyServer } from './server/company-start';
import { log } from './server/log';
import { callTick, selfAddress, startScheduler, type Scheduler } from './server/scheduler';

// One timer per process, even if this runs twice (a dev server's reload).
const memo = globalThis as unknown as { __partnerDeskScheduler?: Scheduler };

/** Calls `stop` when the process is told to end. Next.js ends it on these signals itself, unless told not to. */
export type OnShutdown = (stop: () => void) => void;
const onSignals: OnShutdown = (stop) => {
  // With NEXT_MANUAL_SIG_HANDLE, ours would be the only listeners and the first SIGTERM would no longer end the process.
  if (process.env.NEXT_MANUAL_SIG_HANDLE) return;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, stop);
};

export async function startNode(onShutdown: OnShutdown = onSignals): Promise<void> {
  // The timer calls the job with CRON_SECRET. Without one set, a random one for this process: nobody else knows it, so
  // the job stays closed to the outside, as before [builder's call]. Set before the settings are first read.
  if (!process.env.CRON_SECRET) process.env.CRON_SECRET = randomBytes(32).toString('hex');
  let env: ReturnType<typeof serverEnv>;
  try {
    env = serverEnv();
  } catch (error) {
    // A setting is missing or wrong: say which, and stop.
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
  const ready = await startCompanyServer({
    databaseUrl: env.DATABASE_URL, databaseAuthToken: env.DATABASE_AUTH_TOKEN, migrationsFolder: migrationsFolder(), prepare: prepareDatabase,
    log, exit: (code) => process.exit(code),
  });
  if (!ready) return;
  // Under `next dev` the timer waits to be asked for (SCHEDULER=on): a developer's real mail keys would otherwise send
  // MAP emails every 15 minutes.
  const devDefault = process.env.NODE_ENV === 'development' && !process.env.SCHEDULER;
  if (env.SCHEDULER === 'off' || devDefault) {
    log('scheduler_off', {});
    return;
  }
  if (memo.__partnerDeskScheduler) return;
  // The job's route reads the same setting: if it was read before the random one was set, every run would get a 401.
  const secret = env.CRON_SECRET;
  if (!secret || secret !== process.env.CRON_SECRET) {
    log('scheduler_no_secret', {});
    return;
  }
  const base = selfAddress({ PORT: process.env.PORT, HOSTNAME: process.env.HOSTNAME });
  const scheduler = startScheduler({ run: () => callTick(base, secret), log });
  memo.__partnerDeskScheduler = scheduler;
  log('scheduler_started', {});
  // Next.js closes the server and ends the process; the timer only stops starting runs.
  onShutdown(() => { void scheduler.stop(); });
}

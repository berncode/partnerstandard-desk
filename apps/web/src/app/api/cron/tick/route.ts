import { timingSafeEqual } from 'node:crypto';
import { serverEnv } from '@partner-desk/platform';
import { connection, NextResponse } from 'next/server';
import { runCleanup, runTick, shouldClean, type CleanupResult } from '@/server/map-notifications';
import { cleanupDeps, notifyDeps } from '@/server/runtime';

/** Seconds Vercel lets this function run; the job's own deadline is 50 seconds. */
export const maxDuration = 60;

/** Test sign-in only (e2e): the job's "now", so a test can be at 08:30 in Berlin on a day of its choosing. */
const TEST_NOW_HEADER = 'x-pd-test-now';

function authorized(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(request.headers.get('authorization') ?? '', 'utf8');
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function tickNow(request: Request, testMode: boolean): Date {
  const forced = testMode ? Date.parse(request.headers.get(TEST_NOW_HEADER) ?? '') : Number.NaN;
  return Number.isNaN(forced) ? new Date() : new Date(forced);
}

/**
 * Hourly housekeeping after the job, on the real clock (a forced later time would prune live sessions). Null when this
 * isn't the hour's first run, or when it failed: a clean-up failure never fails the job's answer.
 */
async function cleanup(log: (event: string, ids: Record<string, string>) => void): Promise<CleanupResult | null> {
  const now = new Date();
  if (!shouldClean(now)) return null;
  try {
    return await runCleanup(cleanupDeps(), now);
  } catch {
    log('cleanup_failed', {});
    return null;
  }
}

/**
 * The scheduled job (Vercel Cron, every 15 minutes, with `Authorization: Bearer CRON_SECRET`): the MAPs' daily refresh
 * and emails (spec 5.7), their webhook events and the due webhook deliveries (agents spec 7). Answers with counts only:
 * no ids, no addresses, no MAP content.
 */
export async function GET(request: Request) {
  await connection();
  const env = serverEnv();
  if (!authorized(request, env.CRON_SECRET)) return new NextResponse('Unauthorized', { status: 401 });
  const deps = notifyDeps();
  const result = await runTick(deps, tickNow(request, env.PD_TEST_AUTH));
  return NextResponse.json({ ...result, cleanup: await cleanup(deps.log) }, { headers: { 'Cache-Control': 'no-store' } });
}

import { connection } from 'next/server';
import { builtStorage, servedStorage } from '@/server/edition';
import { log } from '@/server/log';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Whether the database answers a trivial read. */
async function databaseAnswers(ping: () => Promise<unknown>): Promise<boolean> {
  try {
    await ping();
    return true;
  } catch (error) {
    log('health_database_failed', { reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' });
    return false;
  }
}

/**
 * The health check. Hosted: `{"ok":true}`, as before. A company server (plan 17, task 1; spec §10): `{"ok":true}` only
 * once its database answers, 503 otherwise, so Docker and a proxy see a server that can't reach its data as unwell.
 */
export async function GET() {
  await connection();
  // On Vercel (always hosted) the settings aren't even read, and the database is never asked. The runtime is loaded
  // only on a company server.
  if (builtStorage() === null && servedStorage() === 'database' && !(await databaseAnswers(async () => (await import('@/server/runtime')).getDb().$client.execute('SELECT count(*) FROM __drizzle_migrations')))) {
    return Response.json({ ok: false }, { status: 503, headers: NO_STORE });
  }
  return Response.json({ ok: true }, { headers: NO_STORE });
}

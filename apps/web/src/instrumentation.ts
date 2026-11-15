// Runs once when a server starts, before it answers (Next.js `register`). On a company server only: the database's
// start-up copy and migrations (plan 17, task 1). Hosted, on Vercel or anywhere else, does nothing here.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // `next build` calls it too, while it renders pages: the build never touches a database.
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { selfHostedProcess } = await import('@partner-desk/platform/env');
  if (!selfHostedProcess()) return;
  const { startNode } = await import('./instrumentation-node');
  await startNode();
}

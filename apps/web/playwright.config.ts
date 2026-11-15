import { defineConfig, devices } from '@playwright/test';
import { baseUrl, dirOf, EDITIONS, serverEnv, type Edition } from './e2e/servers';

/** A fresh database (migrated before hosted starts, by the start itself on a company server), test sign-in, and the standalone server (the artifact self-hosting ships). */
function server(edition: Edition, { build }: { build: boolean }) {
  const dir = dirOf(edition);
  return {
    command: [
      `rm -rf '${dir}'`,
      `mkdir -p '${dir}'`,
      // Hosted is migrated here; a company server migrates its own database when it starts (plan 17, task 1).
      ...(edition === 'hosted' ? [`DATABASE_URL='file:${dir}/e2e.db' pnpm --filter @partner-desk/platform db:migrate`] : []),
      // One build for both: Playwright starts the servers one after the other, each once the one before answers.
      ...(build ? ['pnpm build'] : []),
      `PORT=${EDITIONS[edition].port} pnpm start:standalone`,
    ].join(' && '),
    url: baseUrl(edition),
    env: serverEnv(edition),
    // Every worktree's e2e server uses these ports: reusing one already running would test another checkout's code,
    // database and load. Only on request (PD_E2E_REUSE=1, for servers you started yourself from this checkout).
    reuseExistingServer: process.env.PD_E2E_REUSE === '1',
    timeout: 240_000,
  };
}

export default defineConfig({
  testDir: 'e2e',
  // One server process holds the test users' files in memory, so tests run one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? 'github' : 'list',
  outputDir: '.playwright/results',
  // The browser's time zone is the owner's default one (Settings, Europe/Berlin), so no test depends on the runner's.
  // `use.baseURL` is each project's own server.
  use: { trace: 'retain-on-failure', timezoneId: 'Europe/Berlin' },
  projects: [
    { name: 'hosted', use: { ...devices['Desktop Chrome'], baseURL: baseUrl('hosted') } },
    // A test only the hosted edition has is tagged @drive-only, with its reason in its title (plan 13, task 14).
    { name: 'database', use: { ...devices['Desktop Chrome'], baseURL: baseUrl('database') }, grepInvert: /@drive-only/ },
  ],
  webServer: [server('hosted', { build: true }), server('database', { build: false })],
});

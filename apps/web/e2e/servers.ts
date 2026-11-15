// The e2e servers' settings, for the Playwright config and for a test that starts a server of its own.
import { resolve } from 'node:path';

/**
 * The suite runs on both editions (plan 13, task 14): hosted as today, and a company server (EDITION=self-hosted, the
 * work in its own database), each on its own port with its own fresh database, from one build.
 */
export const EDITIONS = {
  // Set, not left to the shell: a stray EDITION in .env.local would turn hosted into a company server.
  // The one build both servers share is PartnerStandard's own look (brand.ts); unit tests cover the Community Edition's.
  hosted: { port: 3800, env: { EDITION: 'hosted', NEXT_PUBLIC_PD_BRAND: 'partnerstandard' } },
  // A company server signs in by email link (plan 14): its first admin, and no Google settings.
  database: { port: 3801, env: { EDITION: 'self-hosted', ADMIN_EMAIL: 'admin@halden.example', GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' } },
} as const;
export type Edition = keyof typeof EDITIONS;
export const baseUrl = (edition: Edition) => `http://127.0.0.1:${EDITIONS[edition].port}`;

// A fresh database for every run, at <repo>/.data/e2e/<edition>. An absolute path: the standalone server runs from its own folder.
export const dirOf = (edition: Edition) => resolve(__dirname, `../../../.data/e2e/${edition}`);

const E2E_ENV = {
  BETTER_AUTH_SECRET: 'e2e-only-secret-never-used-anywhere-else-000',
  PD_TEST_AUTH: '1',
  // Webhooks may go to a local http address: the e2e receiver runs inside the test (the env module refuses it on Vercel).
  WEBHOOKS_ALLOW_PRIVATE: '1',
  // The scheduled job's secret: the e2e tests call /api/cron/tick with it. Test sign-in keeps every email in memory.
  CRON_SECRET: 'e2e-cron-secret-0000000000',
  // The tests call the job themselves, at the times they choose: a company server's own timer stays off (plan 17).
  SCHEDULER: 'off',
  // Fake values: they only switch the Google button on. The e2e tests answer Google's sign-in page themselves.
  GOOGLE_CLIENT_ID: 'e2e-google-client',
  GOOGLE_CLIENT_SECRET: 'e2e-google-secret',
};

/** An e2e server's environment. VERCEL_ENV is dropped: on Vercel the app refuses test sign-in. */
export function serverEnv(edition: Edition): Record<string, string> {
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>), ...E2E_ENV, ...EDITIONS[edition].env,
    APP_URL: baseUrl(edition), DATABASE_URL: `file:${dirOf(edition)}/e2e.db`,
  };
  delete (env as Record<string, string | undefined>).VERCEL_ENV;
  return env;
}

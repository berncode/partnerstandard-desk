import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Vitest 5 reads `test.projects` here; vitest.workspace.ts is no longer used (ruling R1).
export default defineConfig({
  test: {
    globalSetup: ['./vitest.global-setup.ts'],
    projects: [
      {
        test: {
          name: 'packages',
          include: ['packages/*/src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        // The app's `@/` imports, as in apps/web/tsconfig.json.
        resolve: { alias: { '@': fileURLToPath(new URL('./apps/web/src', import.meta.url)) } },
        test: {
          name: 'web',
          include: ['apps/web/src/**/*.test.{ts,tsx}'],
          // Component tests opt into jsdom with `// @vitest-environment jsdom`, as in Recruitment.
          environment: 'node',
          setupFiles: ['./apps/web/src/test/setup-dom.ts'],
          // The screens' tests describe PartnerStandard's own look, as the e2e build shows it; a test of the Community
          // Edition's look unsets it (vi.stubEnv), and brand.test.ts checks that unset is the Community Edition.
          env: { NEXT_PUBLIC_PD_BRAND: 'partnerstandard' },
        },
      },
    ],
  },
});

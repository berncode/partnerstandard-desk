import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    '**/.next/**',
    '**/out/**',
    '**/build/**',
    '**/next-env.d.ts',
    '**/.playwright/**',
    '**/node_modules/**',
    // Agents' scratch work, never committed (.gitignore).
    '**/.superpowers/**',
  ]),
  {
    settings: { next: { rootDir: 'apps/web/' } },
  },
  // Purity: the rule packages do no I/O and know no framework. Each package's own list, since a later block for the
  // same rule replaces an earlier one: core may use method and copy; copy only method (plan 18, task 2); method,
  // under its own license, nothing of the app's.
  ...[
    ['packages/core/**/*.{ts,tsx}', 'core', ['@partner-desk/storage', '@partner-desk/commands', '@partner-desk/platform']],
    ['packages/copy/**/*.{ts,tsx}', 'copy', ['@partner-desk/*', '!@partner-desk/method']],
    ['packages/method/**/*.{ts,tsx}', 'method', ['@partner-desk/*']],
  ].map(([files, name, below]) => ({
    files: [files],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['next', 'next/*'], message: `${name} is pure: no Next.js.` },
            { group: ['react', 'react/*'], message: `${name} is pure: no React.` },
            { group: ['node:*'], message: `${name} is pure: no node: imports.` },
            { group: below, message: `${name} sits below the rest: it imports only the packages beneath it.` },
          ],
        },
      ],
    },
  })),
  {
    files: ['packages/core/**/*.{ts,tsx}', 'packages/method/**/*.{ts,tsx}', 'packages/copy/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-properties': [
        'error',
        { object: 'Date', property: 'now', message: 'Inject the time as a stamp.' },
        { object: 'Math', property: 'random', message: 'Inject randomness.' },
      ],
    },
  },
  // The shared workbook planner knows no Google: the database edition uses it too (plan 13). Tests may compare with Google's checks.
  {
    files: ['packages/storage/src/workbook/**/*.ts'],
    ignores: ['packages/storage/src/workbook/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/google', '**/google/**', '../http/*', '**/http/**'], message: 'workbook/ is shared by every store: no Google or HTTP code.' }] },
      ],
    },
  },
]);

export default eslintConfig;

import { test, type Page } from '@playwright/test';
import type { Edition } from './servers';

/**
 * The edition the running test is on: its Playwright project (plan 13, task 14). Hosted keeps the work in Google
 * Drive (test users in memory); the database edition in the company server's own database.
 */
export type { Edition } from './servers';
export const edition = (): Edition => (test.info().project.name === 'database' ? 'database' : 'hosted');

/** What the test expects on each edition: the same feature, in each edition's words. */
export const byEdition = <T>(expected: { hosted: T; database: T }): T => expected[edition()];

/** The app's address on the running test's server, as its links and OAuth resource name it. */
export const appUrl = (): string => test.info().project.use.baseURL!;

/** The landing page's way in: Google's button on hosted, the link to the email sign-in on a company server (plan 14). */
export const signInEntry = (page: Page) => (edition() === 'database'
  ? page.getByRole('link', { name: 'Sign in', exact: true })
  : page.getByRole('button', { name: 'Sign in with Google' }));

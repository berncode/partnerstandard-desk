import { expect, test, type Page } from '@playwright/test';
import { actionAnswer } from './saves';

// This week (reviews spec 4.1, task 10), with the test sign-in and the test user's files in memory, as reviews.spec.ts.

/** The sample book's partners, in /api/test-seed's order. */
const SAMPLE = { litware: 4 } as const;

interface Seeded { partnerIds: string[]; accountIds: string[] }

async function seed<T>(page: Page, data: Record<string, unknown>): Promise<T> {
  const out = await page.request.post('/api/test-seed', { data });
  expect(out.ok()).toBe(true);
  return out.json() as Promise<T>;
}

/** Today's date in Berlin: the browser's time zone in e2e (playwright.config.ts) and the owner's default one. */
function berlinNow(): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((p) => [p.type, Number(p.value)]));
  return new Date(parts.year!, parts.month! - 1, parts.day!);
}

/** A date `days` from today as YYYY-MM-DD, in the browser's own time zone (the date inputs'), whatever the runner's. */
function iso(days: number): string {
  const d = berlinNow();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const main = (page: Page) => page.getByRole('main');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('after sign-in you land on This week, and a company with nothing yet sees four empty sections', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('link', { name: 'Try with a test account' }).click();
  await expect(page).toHaveURL(/\/this-week$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'This week' })).toBeVisible();
  await expect(main(page).getByRole('heading', { level: 2 })).toHaveText([
    'Business reviews coming up', 'Partnerships that need you', 'Activities due', 'Recruitment waiting',
  ]);
  await expect(main(page)).toContainText('No reviews in the next three weeks.');
  await expect(main(page)).toContainText('Nothing is due this week.');
  await expect(page.getByRole('complementary').getByRole('link', { name: 'This week', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('a plain sign-in page with the test account lands on This week', async ({ page }) => {
  await page.goto('/sign-in');
  await page.getByRole('link', { name: 'Continue with a test account' }).click();
  await expect(page).toHaveURL(/\/this-week$/);
});

test('an overdue activity is listed under Activities due, and Mark done removes it, on a phone too', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/api/test-auth?name=Week+Keeper&next=/partners');
  const { accountIds, partnerIds } = await seed<Seeded>(page, { fixture: 'sample' });
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware], health: 'at_risk' });
  await page.goto(`/partners/${accountIds[SAMPLE.litware]}`);
  await page.getByRole('button', { name: 'Mark signed' }).click();
  const dialog = page.getByRole('dialog', { name: /^Mark .* signed$/ });
  await dialog.getByLabel('Date signed').fill(iso(-5));
  await dialog.getByRole('button', { name: 'Mark signed' }).click();
  // The dialog closes at once and the signing saves after it: This week is opened once the signing's own save answers.
  const signed = actionAnswer(page, '"markSigned"');
  await dialog.getByRole('button', { name: 'Go ahead anyway' }).click();
  await expect(dialog).toBeHidden();
  await signed;

  await page.goto('/this-week');
  const due = main(page).getByRole('region', { name: 'Activities due' });
  await expect(due.getByRole('link', { name: 'Litware Group as reseller' })).toHaveAttribute('href', `/plans/${mapId}`);
  await expect(due.getByRole('link', { name: 'Kickoff with both sponsors' })).toBeVisible();
  await expect(due).toContainText('overdue');
  expect(await noSidewaysScroll(page)).toBe(true);

  // The line opens the MAP at the activity: the hash is there and the row is in view.
  await due.getByRole('link', { name: 'Kickoff with both sponsors' }).click();
  await expect(page).toHaveURL(new RegExp(`/plans/${mapId}#activity-a_`));
  await expect(main(page).locator('[id^="activity-"]').filter({ hasText: 'Kickoff with both sponsors' })).toBeInViewport();
  await page.goto('/this-week');

  await due.getByRole('button', { name: 'Mark done: Kickoff with both sponsors' }).click();
  await expect(due.getByRole('link', { name: 'Kickoff with both sponsors' })).toHaveCount(0);
  await expect(page.getByText('Marked done')).toBeVisible();
  await expect(due).toContainText('Nothing is due this week.');

  // The write reached the MAP: a new visit does not list it.
  await page.goto('/this-week');
  await expect(main(page).getByRole('region', { name: 'Activities due' })).toContainText('Nothing is due this week.');
});

import { expect, test, type Page } from '@playwright/test';

const sample = (page: Page) => page.getByRole('region', { name: 'Your week in PartnerStandard Desk' });

test('the landing page shows a sample week in the app’s own sidebar and cards, and nothing in it leaves the page (hosted only: a company server shows no sample)', { tag: '@drive-only' }, async ({ page }) => {
  const asked: string[] = [];
  // A signed-in page, or the landing page read again after it opened (a refresh): the sample asks the server nothing.
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (/\/(partners|plans|markets|settings|this-week)\b/.test(path) || (path === '/' && !request.isNavigationRequest())) asked.push(request.url());
  });
  await page.goto('/');
  const week = sample(page);
  await expect(week).toContainText('Brookvale Software and its partners are made up.');
  await expect(week.getByRole('heading', { level: 2, name: 'Business reviews coming up' })).toBeVisible();
  await expect(week).toContainText('Brightwater IT as reseller');
  await expect(week.getByTitle('This week')).toHaveAttribute('aria-current', 'page');
  await expect(week.locator('[href]')).toHaveCount(0);

  await week.getByText('Brightwater IT as reseller').first().click();
  await week.getByTitle('Partners').click();
  await expect(page).toHaveURL(/\/$/);

  await week.getByRole('button', { name: 'Mark done: Plan the joint webinar' }).click();
  await expect(week.getByText('Plan the joint webinar')).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(week.getByText('Plan the joint webinar')).toBeVisible();
  await week.getByRole('button', { name: 'Accept' }).click();
  await expect(week).toContainText('Accepted');
  expect(asked).toEqual([]);
  const community = page.getByRole('region', { name: 'Run it on your own server: the Community Edition' });
  await expect(community.getByRole('link', { name: 'See it on GitHub' })).toHaveAttribute('href', 'https://github.com/berncode/partnerstandard-desk');
});

test('the sample week on a phone: no sidebar and no sideways scroll (hosted only: a company server shows no sample)', { tag: '@drive-only' }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  const week = sample(page);
  await expect(week).toContainText('Brightwater IT as reseller');
  await expect(week.locator('aside')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('the landing page’s HTML still names the legal pages before any script runs (Google’s brand check; hosted only: a company server shows its own legal links only when it sets them)', { tag: '@drive-only' }, async ({ request }) => {
  const html = await (await request.get('/')).text();
  expect(html).toContain('href="/privacy"');
});

test('a company server’s landing page: the name, the title and Sign in, and nothing else', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'database', 'hosted’s landing page is the tests above');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'One workspace for every partner, from the first idea to exit.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(sample(page)).toHaveCount(0);
  await expect(page.getByText('Guided by the PartnerStandard method.')).toHaveCount(0);
  await expect(page.getByText('Your work stays in')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Run it on your own server: the Community Edition' })).toHaveCount(0);
});

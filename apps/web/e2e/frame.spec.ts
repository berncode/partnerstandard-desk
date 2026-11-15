import { expect, test } from '@playwright/test';
import { signInEntry } from './edition';

async function signIn(page: import('@playwright/test').Page, name = 'Anna') {
  await page.goto(`/api/test-auth?name=${name}&next=/partners`);
  await expect(page).toHaveURL(/\/partners$/);
}

test('the sidebar shows the company, Partners, Markets, Call guide and Settings, and shrinks to icons', async ({ page }) => {
  await signIn(page);
  const sidebar = page.getByRole('complementary');
  await expect(sidebar.getByRole('link', { name: 'PartnerStandard' })).toBeVisible();
  // The logo says PartnerStandard and the badge beside it Desk; the link carries the whole name.
  await expect(sidebar).toContainText('Desk');
  await expect(sidebar.getByRole('link', { name: 'PartnerStandard Desk', exact: true })).toBeVisible();
  await expect(sidebar.getByTestId('company-name').getByRole('link', { name: 'Name your company' })).toHaveAttribute('href', '/settings');
  for (const name of ['Partners', 'Markets', 'Call guide', 'Settings']) {
    await expect(sidebar.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await expect(sidebar.getByRole('link', { name: 'Partners', exact: true })).toHaveAttribute('aria-current', 'page');
  const wide = (await sidebar.boundingBox())!.width;

  await sidebar.getByRole('button', { name: 'Shrink menu' }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'true');
  await expect(sidebar.getByTestId('company-name')).toBeHidden();
  await expect(sidebar.getByRole('link', { name: 'Markets', exact: true })).toBeVisible();
  expect((await sidebar.boundingBox())!.width).toBeLessThan(wide / 2);

  await sidebar.getByRole('button', { name: 'Expand menu' }).click();
  await expect(sidebar).toHaveAttribute('data-collapsed', 'false');
});

test('the account menu offers Settings and the theme, and signs out to the landing page', async ({ page }) => {
  await signIn(page, 'Anna Keller');
  await page.getByRole('complementary').getByRole('button', { name: 'Account: Anna Keller' }).click();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await page.getByRole('menuitemradio', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('complementary').getByRole('button', { name: 'Account: Anna Keller' }).click();
  await page.getByRole('menuitemradio', { name: 'Light' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

  await page.getByRole('complementary').getByRole('button', { name: 'Account: Anna Keller' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(signInEntry(page)).toBeVisible();
});

test('on a phone a top bar button opens the panel and Escape closes it, with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page);
  await expect(page.getByRole('complementary')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);

  await page.getByRole('button', { name: 'Open menu' }).click();
  const panel = page.getByRole('dialog', { name: 'Main menu' });
  await expect(panel).toBeVisible();
  for (const name of ['Partners', 'Markets', 'Call guide', 'Settings']) {
    await expect(panel.getByRole('link', { name, exact: true })).toBeVisible();
  }
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('the sign-in page says where the work lives and links the terms (hosted only: a company server’s are checked in database-edition.spec.ts)', { tag: '@drive-only' }, async ({ page }) => {
  await page.goto('/sign-in');
  await expect(page.getByRole('heading', { name: 'Sign in to PartnerStandard Desk' })).toBeVisible();
  await expect(page.getByText('Your partner work lives in your own Google Drive. We never store it.')).toBeVisible();
  await expect(page.getByRole('main').getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms');
});

test('at 375 px the call guide, the legal pages and sign-in fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  for (const path of ['/privacy', '/terms', '/imprint', '/sign-in']) {
    await page.goto(path);
    expect(await fits(), path).toBe(true);
  }
  await signIn(page);
  await page.goto('/call-guide');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await fits(), '/call-guide').toBe(true);
});

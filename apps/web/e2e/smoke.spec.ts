import { expect, test } from '@playwright/test';
import { signInEntry } from './edition';

test('the landing page tells signed-out visitors what PartnerStandard Desk is and offers Google sign-in (hosted only: a company server’s are checked in database-edition.spec.ts)', { tag: '@drive-only' }, async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'One workspace for every partner, from the first idea to exit.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in with Google' })).toBeVisible();
  await expect(page.getByText('Your work stays in your Google Drive.')).toBeVisible();
  const footer = page.getByRole('contentinfo');
  await expect(footer).toContainText('© PartnerStandard Desk');
  for (const name of ['Privacy Policy', 'Terms of Service', 'Imprint', 'Knowledge Hub']) {
    await expect(footer.getByRole('link', { name })).toBeVisible();
  }
});

test('a signed-in visit to the landing page goes to This week', async ({ page }) => {
  await page.goto('/api/test-auth?name=Anna&next=/partners');
  await page.goto('/');
  await expect(page).toHaveURL(/\/this-week$/);
});

test('after deleting an account the landing page says the files are still there (hosted only: a company server’s are checked in database-edition.spec.ts)', { tag: '@drive-only' }, async ({ page }) => {
  await page.goto('/?account=deleted');
  await expect(page.getByRole('status')).toContainText('Your account is deleted. Your files are still in your Google Drive.');
  await expect(page.getByRole('link', { name: 'Google\'s Third-party connections page' })).toHaveAttribute('href', 'https://myaccount.google.com/connections');
});

test('the landing page has no sideways scroll on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');
  await expect(signInEntry(page)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

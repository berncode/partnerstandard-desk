import { expect, test } from '@playwright/test';
import { appUrl } from './edition';

test('signed out, the partners page sends you to sign in and back', async ({ page }) => {
  await page.goto('/partners');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fpartners$/);
  await expect(page.getByRole('heading', { name: 'Sign in to PartnerStandard Desk' })).toBeVisible();
});

test('a test user starts with no partners, sees seeded ones, and a second test user sees none of them', async ({ page }) => {
  await page.goto('/api/test-auth?name=Anna&next=/partners');
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByRole('heading', { name: 'No partners yet' })).toBeVisible();

  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(seeded.status()).toBe(200);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Potential 6' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'Active 2' })).toBeVisible();

  // Another person: their own company, so none of Anna's partners.
  await page.context().clearCookies();
  await page.goto('/api/test-auth?name=Ben&next=/partners');
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByRole('heading', { name: 'No partners yet' })).toBeVisible();
});

test('seeding needs a signed-in test user', async ({ request }) => {
  const response = await request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(response.status()).toBe(401);
});

test('a signed-in visit to sign in goes straight on', async ({ page }) => {
  await page.goto('/api/test-auth?next=/partners');
  await page.goto('/sign-in?next=%2Fpartners');
  await expect(page).toHaveURL(/\/partners$/);
});

test('a failed sign-in shows our message, never the code', async ({ page }) => {
  await page.goto('/sign-in?error=invalid_code');
  await expect(page.getByRole('main').getByRole('alert')).toHaveText('Sign-in didn’t finish. Try again.');
  await expect(page.getByText('invalid_code')).toHaveCount(0);
});

test('Continue with Google asks Google for Drive files only, offline, with consent (hosted only: a company server signs in by email link, in database-edition.spec.ts)', { tag: '@drive-only' }, async ({ page }) => {
  // Google is never reached: the request is answered here.
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Google</p>' }));
  await page.goto('/sign-in?next=%2Fpartners');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.waitForURL(/^https:\/\/accounts\.google\.com\//);
  const url = new URL(page.url());
  expect(url.searchParams.get('client_id')).toBe('e2e-google-client');
  expect(url.searchParams.get('scope')?.split(' ')).toEqual(expect.arrayContaining(['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file']));
  expect(url.searchParams.get('scope')?.split(' ')).toHaveLength(4);
  expect(url.searchParams.get('access_type')).toBe('offline');
  expect(url.searchParams.get('prompt')).toBe('select_account consent');
  expect(url.searchParams.get('redirect_uri')).toBe(`${appUrl()}/api/auth/callback/google`);
  // Better Auth checks this cookie on the way back from Google: the server action must hand it to the browser.
  const cookies = await page.context().cookies(appUrl());
  expect(cookies.map((c) => c.name)).toContain('better-auth.state');
});

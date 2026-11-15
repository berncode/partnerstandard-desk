import { expect, test } from '@playwright/test';

// The address every API error names in `type` (src/agents/rest.ts, question 26): no sign-in, one page for every code.
test('an API error’s address shows the page that lists every code', async ({ page, request }) => {
  const refused = await request.get('/api/v1/partners');
  expect(refused.status()).toBe(401);
  const { type } = await refused.json() as { type: string };
  expect(type).toBe('https://desk.partnerstandard.com/problems/unauthorized');

  for (const path of [new URL(type).pathname, '/problems']) {
    const shown = await page.goto(path);
    expect(shown?.status(), path).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'API errors' })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: 'unauthorized', exact: true })).toBeVisible();
    await expect(page.getByText('Status 401.')).toBeVisible();
  }
  await page.setViewportSize({ width: 375, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test('no page shows inside another site’s frame', async ({ page }) => {
  for (const path of ['/', '/sign-in', '/problems']) {
    const shown = await page.goto(path);
    expect(shown?.headers(), path).toMatchObject({
      'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'x-content-type-options': 'nosniff',
    });
  }
});

import { expect, test, type Page } from '@playwright/test';

async function signIn(page: Page, name: string, next = '/partners') {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=${next}`);
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
const journeyBox = (page: Page, name: RegExp) => page.getByRole('group', { name: /partner journey/ }).getByRole('link', { name });

test('the guide is open to everyone and prerendered, with the journey and 19 sections', async ({ page }) => {
  const response = await page.goto('/guide');
  expect(response?.status()).toBe(200);
  expect(response?.headers()['x-nextjs-prerender']).toContain('1');
  expect(response?.headers()['set-cookie']).toBeUndefined();
  await expect(page.getByRole('heading', { level: 1, name: 'How PartnerStandard Desk works' })).toBeVisible();
  await expect(page.locator('h2[id]')).toHaveCount(19);
  await expect(page.getByRole('group', { name: /partner journey/ })).toBeVisible();
});

test('the sidebar shows How it works first under Guides and opens the guide', async ({ page }) => {
  await signIn(page, 'Guide Reader');
  const sidebar = page.getByRole('complementary');
  const links = sidebar.getByRole('navigation').getByRole('link');
  const names = await links.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
  expect(names.indexOf('How it works')).toBe(names.indexOf('Call guide') - 1);
  await sidebar.getByRole('link', { name: 'How it works', exact: true }).click();
  await expect(page).toHaveURL(/\/guide$/);
  await expect(sidebar.getByRole('link', { name: 'How it works', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'How PartnerStandard Desk works' })).toBeVisible();
});

test('a click on the journey’s Signed box lands on the signing section, below the sticky header', async ({ page }) => {
  // The sticky header is the phone's top bar; on a wide screen nothing covers the top.
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, 'Guide Jumper', '/guide');
  await journeyBox(page, /^Signed/).click();
  await expect(page).toHaveURL(/\/guide#signing$/);
  const heading = page.locator('h2#signing');
  await expect(heading).toBeInViewport();
  await expect(page.locator('header').first()).toBeVisible();
  const header = (await page.locator('header').first().boundingBox())!;
  await expect.poll(() => heading.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(header.y + header.height);
});

test('opening /guide#reviews lands on the reviews section, below the sticky header', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, 'Guide Anchor', '/partners');
  await page.goto('/guide#reviews');
  const heading = page.locator('h2#reviews');
  await expect(heading).toBeInViewport();
  await expect(page.locator('header').first()).toBeVisible();
  const header = (await page.locator('header').first().boundingBox())!;
  await expect.poll(() => heading.evaluate((el) => el.getBoundingClientRect().top)).toBeGreaterThanOrEqual(header.y + header.height);
});

test('at 375 px only the journey and the two wide pictures scroll sideways, each inside its frame', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/guide');
  expect(await noSidewaysScroll(page)).toBe(true);
  expect(await page.getByTestId('journey-frame').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.getByText('Scroll sideways to see the whole journey.')).toBeVisible();
  // The two wide pictures of Agents and the API scroll inside their own frames, like the journey, never the page.
  const frames = page.getByTestId('picture-frame');
  await expect(frames).toHaveCount(2);
  for (const frame of await frames.all()) expect(await frame.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  await expect(page.getByText('Scroll sideways to see the whole picture.').first()).toBeVisible();
  // The small ones: the account, markets feed a program, the MAP over time and how it ends.
  const diagrams = page.getByRole('main').locator('svg[role="img"]:not([data-testid="picture-frame"] svg)');
  await expect(diagrams).toHaveCount(4);
  for (const svg of await diagrams.all()) {
    // Each small diagram sits inside its own column, not wider than its parent.
    expect(await svg.evaluate((el) => el.getBoundingClientRect().width <= el.parentElement!.clientWidth + 1)).toBe(true);
  }
});

test('the journey takes the dark theme’s colors', async ({ page }) => {
  await page.goto('/guide');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  const box = page.getByRole('group', { name: /partner journey/ }).locator('rect').first();
  const light = await box.evaluate((el) => getComputedStyle(el).fill);
  // The theme is the viewer's choice, kept in this browser (src/ui/theme.ts).
  await page.evaluate(() => localStorage.setItem('map-theme', 'dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await box.evaluate((el) => getComputedStyle(el).fill)).not.toBe(light);
});

test('on paper: the title and the journey, no Print button, sidebar or contents', async ({ page }) => {
  await page.goto('/guide');
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect(page.getByRole('navigation', { name: 'Contents' })).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'How PartnerStandard Desk works' })).toBeVisible();
  await expect(page.getByRole('group', { name: /partner journey/ })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

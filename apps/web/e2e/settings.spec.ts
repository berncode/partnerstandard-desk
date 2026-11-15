import { expect, test, type Page } from '@playwright/test';
import { byEdition } from './edition';

async function signIn(page: Page, name: string, next = '/settings') {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=${next}`);
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('the call guide is open to everyone, lists the six topics and prints only the guide', async ({ page }) => {
  const response = await page.goto('/call-guide');
  // The guide is prerendered by the build (only the sidebar's name is read per visit), and no cookie is set for a visitor.
  expect(response?.headers()['x-nextjs-prerender']).toContain('1');
  expect(response?.headers()['set-cookie']).toBeUndefined();
  expect(await response?.text()).toContain('Revenue Model');
  await expect(page.getByRole('heading', { level: 1, name: 'Discovery call guide' })).toBeVisible();
  await expect(page.getByText(/Paste it into the call on the partner’s page/)).toBeVisible();
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(6);
  await expect(page.getByRole('heading', { level: 2 }).first()).toContainText('Revenue Model');
  await expect(page.getByRole('button', { name: 'Print' })).toBeVisible();

  // On paper: only the guide. No Print button, no sidebar, no footer.
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('button', { name: 'Print' })).toBeHidden();
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect(page.getByRole('contentinfo')).toBeHidden();
  await expect(page.getByRole('heading', { level: 1, name: 'Discovery call guide' })).toBeVisible();
  await page.emulateMedia({ media: 'screen' });
});

test('the call guide opens from the sidebar', async ({ page }) => {
  await signIn(page, 'Guide Reader', '/partners');
  await page.getByRole('complementary').getByRole('link', { name: 'Call guide', exact: true }).click();
  await expect(page).toHaveURL(/\/call-guide$/);
  // It stays inside the frame: the sidebar is still there.
  await expect(page.getByRole('complementary').getByRole('link', { name: 'Call guide', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1, name: 'Discovery call guide' })).toBeVisible();
});

for (const [path, title, fact] of [
  // The public code's stand-ins: the hosted build puts the operator's own texts in their place (plan 19, task 3).
  ['/privacy', 'Privacy Policy', 'LEGAL_PRIVACY_URL'],
  ['/terms', 'Terms of Service', 'LEGAL_TERMS_URL'],
  ['/imprint', 'Imprint', 'LEGAL_IMPRINT_URL'],
] as const) {
  // PartnerStandard's legal pages are hosted's: a company server answers "not found" (database-edition.spec.ts).
  test(`${path} shows its text with no sign-in, and is served as a static page (hosted only: never on a company server)`, { tag: '@drive-only' }, async ({ page }) => {
    const response = await page.goto(path);
    // A prerendered page: cached for a year by the build, and no cookie is set for a visitor.
    expect(response?.headers()['cache-control']).toMatch(/s-maxage=\d{7,}/);
    expect(response?.headers()['set-cookie']).toBeUndefined();
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
    await expect(page.getByRole('main')).toContainText(fact);
    await expect(page.getByRole('contentinfo').getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(await noSidewaysScroll(page)).toBe(true);
  });
}

test('settings saves the company name, the sidebar shows it at once, and it stays after a reload', async ({ page }) => {
  await signIn(page, 'Settings Saver');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  const sidebarName = page.getByRole('complementary').getByTestId('company-name');
  await expect(sidebarName).toHaveText('Name your company');
  await expect(page.getByText('Add it so the search prompts can name your company.')).toBeVisible();

  await page.getByLabel('Company name').fill('  Halden Security  ');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await expect(sidebarName).toHaveText('Halden Security');
  await expect(page.getByText('The search prompts name your company as “Halden Security”.')).toBeVisible();

  await page.reload();
  await expect(page.getByLabel('Company name')).toHaveValue('Halden Security');
  await expect(sidebarName).toHaveText('Halden Security');

  // Empty clears it.
  await page.getByLabel('Company name').fill('');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Saved.');
  await expect(sidebarName).toHaveText('Name your company');
});

test('a test account has nothing to connect, and Delete my account waits for DELETE', async ({ page }) => {
  await signIn(page, 'Settings Tester');
  await expect(page.getByText(byEdition({
    hosted: 'Test account: your partners and markets live in the server’s memory, so there’s nothing to connect.',
    database: 'Your partners, markets and plans are in your company’s own database, on this server.',
  }), { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect Google' })).toHaveCount(0);
  await expect(page.getByText(byEdition({
    hosted: 'This deletes your account, your company name and your list of files, and signs you out. Your spreadsheets stay in your Google Drive. This can’t be undone.',
    database: 'This deletes your account and signs you out. Your company’s partner work stays in its database. This can’t be undone.',
  }))).toBeVisible();
  const remove = page.getByRole('button', { name: 'Delete my account' });
  await expect(remove).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('delete');
  await expect(remove).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await expect(remove).toBeEnabled();
});

test('Delete my account signs out, shows the notice on the landing page and the account is gone', async ({ page }) => {
  await signIn(page, 'Settings Leaver');
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByRole('button', { name: 'Delete my account' }).click();
  await expect(page).toHaveURL(/\/\?account=deleted$/);
  await expect(page.getByRole('status')).toContainText(byEdition({
    hosted: 'Your account is deleted. Your files are still in your Google Drive.',
    database: 'Your account is deleted. Your company’s partner work is still in its database.',
  }));
  // A company server has no Google access to remove (plan 14).
  const connections = page.getByRole('link', { name: "Google's Third-party connections page" });
  await expect(connections).toHaveCount(byEdition({ hosted: 1, database: 0 }));
  if (byEdition({ hosted: true, database: false })) await expect(connections).toHaveAttribute('href', 'https://myaccount.google.com/connections');
  await page.goto('/settings');
  await expect(page).toHaveURL(/\/sign-in/);
});

test('settings fits a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, 'Settings Phone');
  await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete my account' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto('/call-guide');
  await expect(page.getByRole('heading', { level: 1, name: 'Discovery call guide' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('a lost Partners file offers a new one on the Partners screen', async ({ page }) => {
  await signIn(page, 'File Loser', '/partners');
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', lose: 'partners' } });
  expect(seeded.ok()).toBe(true);

  await page.goto('/partners');
  await expect(page.getByRole('heading', { level: 1, name: 'Your partners file is missing' })).toBeVisible();
  await expect(page.getByText(byEdition({
    hosted: 'We can’t find your partners file. It may have been moved to the trash. If you restore it from the trash in Google Drive, reload this page. Or start a new partners file.',
    database: 'We can’t find your partners file. It may have been moved to the trash. Or start a new partners file.',
  }))).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Start a new Partners file' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Partners' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No partners yet' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a new Partners file' })).toHaveCount(0);
});

test('on a partner’s page a new partners file goes to the list', async ({ page }) => {
  await signIn(page, 'File Loser Partner', '/partners');
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', lose: 'partners' } });
  expect(seeded.ok()).toBe(true);
  const { partnerIds } = (await seeded.json()) as { partnerIds: string[] };
  await page.goto(`/partners/${partnerIds[0]}`);
  await expect(page.getByRole('heading', { level: 1, name: 'Your partners file is missing' })).toBeVisible();
  // That partner is not in the new file, so the page goes to the list.
  await page.getByRole('button', { name: 'Start a new Partners file' }).click();
  await expect(page).toHaveURL(/\/partners$/);
  await expect(page.getByRole('heading', { name: 'No partners yet' })).toBeVisible();
});

test('a lost Partners file is named on Markets, New market and a market page, with the way to Partners', async ({ page }) => {
  await signIn(page, 'File Loser Markets', '/partners');
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', lose: 'partners' } });
  expect(seeded.ok()).toBe(true);
  const { marketIds } = (await seeded.json()) as { marketIds: string[] };
  for (const path of ['/markets', '/markets/new', `/markets/${marketIds[0]}`]) {
    await page.goto(path);
    const alert = page.getByRole('main').getByRole('alert');
    await expect(alert).toHaveText(/Your partners file is missing\. On Partners you can restore it or start a new one\./);
    await expect(alert.getByRole('link', { name: 'Go to Partners' })).toHaveAttribute('href', '/partners');
  }
  await page.getByRole('link', { name: 'Go to Partners' }).click();
  await expect(page.getByRole('button', { name: 'Start a new Partners file' })).toBeVisible();
});

test('a lost Partners file looks right on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, 'File Loser Phone', '/partners');
  expect((await page.request.post('/api/test-seed', { data: { fixture: 'sample', lose: 'partners' } })).ok()).toBe(true);
  await page.goto('/partners');
  await expect(page.getByRole('button', { name: 'Start a new Partners file' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('a lost market file offers Archive, which takes the market off the Markets screen', async ({ page }) => {
  await signIn(page, 'Market Loser', '/partners');
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', lose: 'market' } });
  expect(seeded.ok()).toBe(true);
  const { marketIds } = (await seeded.json()) as { marketIds: string[] };

  await page.goto(`/markets/${marketIds[0]}`);
  await expect(page.getByRole('heading', { level: 1, name: 'We can’t reach this market’s file' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive' }).click();
  await expect(page).toHaveURL(/\/markets$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Markets' })).toBeVisible();
  await expect(page.getByText('Germany')).toBeVisible();
  await expect(page.getByRole('link', { name: /Austria/ })).toHaveCount(0);
});

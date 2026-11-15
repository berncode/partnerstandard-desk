import { expect, test, type Page } from '@playwright/test';
import { byEdition } from './edition';

async function signIn(page: Page, name = 'Anna', next = '/markets') {
  await page.goto(`/api/test-auth?name=${name}&next=${next}`);
  await expect(page).toHaveURL(new RegExp(next.replace(/[/?=]/g, '\\$&')));
}

/** The sample book (see /api/test-seed), with the closed and the exited partner also in Austria. */
async function signInWithSample(page: Page, name = 'Anna') {
  await signIn(page, name);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', closedInMarket: true } });
  expect(seeded.ok()).toBe(true);
  await page.goto('/markets');
  await expect(page.getByRole('article', { name: 'Austria · Reseller' })).toBeVisible();
}

const card = (page: Page, name: string) => page.getByRole('article', { name });
const main = (page: Page) => page.getByRole('main');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('a new account sees No markets yet, and Create your first market starts the flow', async ({ page }) => {
  await signIn(page);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Your markets' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'No markets yet' })).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Copy from another market' })).toBeVisible();
  await main(page).getByRole('link', { name: 'Create your first market' }).click();
  await expect(page).toHaveURL(/\/markets\/new/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Which market, and what will partners sell there?' })).toBeVisible();
});

test('market cards count partners per step plus Signed, and a closed or exited partner only counts as closed', async ({ page }) => {
  await signInWithSample(page);
  const austria = card(page, 'Austria · Reseller');
  await expect(austria.getByRole('link', { name: 'Austria · Reseller' })).toHaveAttribute('href', /\/markets\/.+/);
  await expect(austria.getByLabel('Partners per step')).toHaveText('Researched1Discovery call0Qualification0MAP0Signed1');
  await expect(austria).toContainText('2 closed');
  const germany = card(page, 'Germany · Reseller');
  await expect(germany.getByLabel('Partners per step')).toHaveText('Researched1Discovery call0Qualification0MAP0Signed1');
  await expect(germany).toContainText('0 closed');
});

test('Find partners from the Partners screen shows its tip above the cards', async ({ page }) => {
  await signInWithSample(page);
  await page.goto('/markets?find=partners');
  await expect(main(page).getByText('Pick a market. Its search prompt finds companies that fit it.')).toBeVisible();
  await expect(card(page, 'Austria · Reseller')).toBeVisible();
});

test('Archive asks first, the card leaves, and Show archived lists it with Unarchive', async ({ page }) => {
  await signInWithSample(page);
  await page.getByRole('button', { name: 'Archive Germany · Reseller' }).click();
  const dialog = page.getByRole('dialog', { name: 'Archive Germany · Reseller?' });
  await expect(dialog).toContainText(byEdition({ hosted: 'It leaves your markets. Its spreadsheet stays in your Google Drive.', database: 'It leaves your markets. Its file stays in the database.' }));
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog).toBeHidden();
  await expect(card(page, 'Germany · Reseller')).toHaveCount(0);
  await expect(card(page, 'Austria · Reseller')).toBeVisible();

  await main(page).getByRole('link', { name: 'Show archived' }).click();
  await expect(page).toHaveURL(/archived=1/);
  const archived = main(page).getByRole('region', { name: 'Archived markets' });
  await expect(archived).toContainText('Germany · Reseller');
  await archived.getByRole('button', { name: 'Unarchive Germany · Reseller' }).click();
  await expect(card(page, 'Germany · Reseller')).toBeVisible();
  await expect(archived).toContainText('No archived markets.');
  await archived.getByRole('link', { name: 'Hide archived' }).click();
  await expect(main(page).getByRole('link', { name: 'Show archived' })).toBeVisible();
});

test('the four-step new market: tips, the example, channel and service types, first partners with the duplicate check', async ({ page }) => {
  await signInWithSample(page, 'Berta');
  await main(page).getByRole('link', { name: 'New market' }).click();
  await expect(page).toHaveURL(/\/markets\/new/);

  // Step 1
  await expect(main(page).getByText('New market · Step 1 of 4')).toBeVisible();
  await expect(main(page).getByText(/A market is one country or region and one partner type/)).toBeVisible();
  await expect(main(page).getByRole('complementary', { name: 'Example' })).toContainText('Halden Security Endpoint');
  const type = main(page).getByLabel('Partner type');
  expect(await type.locator('optgroup').evaluateAll((groups) => groups.map((g) => (g as HTMLOptGroupElement).label))).toEqual(['Channel', 'Service']);
  await expect(type.locator('option')).toHaveCount(12);
  // The product and customers start from the newest market.
  await expect(main(page).getByLabel(/^Our product/)).toHaveValue('Our product');
  await main(page).getByRole('button', { name: 'Next' }).click();
  await expect(main(page).getByText('Market is required')).toBeVisible();
  await main(page).getByLabel(/^Market/).first().fill('France');
  await type.selectOption({ label: 'Reseller' });
  await main(page).getByRole('button', { name: 'Next' }).click();

  // Steps 2 and 3
  await expect(page).toHaveURL(/step=2/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Why does the partner route work here?' })).toBeVisible();
  await expect(main(page).getByRole('complementary', { name: 'Example' })).toContainText('trusted for years');
  await main(page).getByLabel(/^Why the partner route works/).fill('Local trust.');
  await main(page).getByRole('button', { name: 'Next' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'What must a partner have, and how does this market buy?' })).toBeVisible();
  await expect(main(page).getByLabel(/^Must-haves/)).toHaveValue(/Has solutions engineers/);
  await main(page).getByRole('radio', { name: /Customer first/ }).check();
  await main(page).getByRole('button', { name: 'Skip' }).click();

  // Step 4: Back and Skip work, a repeat is refused, and Remove drops a name.
  await expect(main(page).getByRole('heading', { level: 1, name: 'Which companies come to mind first?' })).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Skip' })).toHaveCount(0);
  const add = async (company: string, website = '') => {
    await main(page).getByLabel('Company').fill(company);
    await main(page).getByLabel('Website').fill(website);
    await main(page).getByRole('button', { name: 'Add', exact: true }).click();
  };
  await add('Northwind Consulting', 'northwind.example');
  await add('Brand New AG', 'brandnew.example');
  await add('northwind consulting');
  await expect(main(page).getByText('This company is already in the list')).toBeVisible();
  await add('Dropped Ltd');
  await main(page).getByRole('button', { name: 'Remove Dropped Ltd' }).click();
  await expect(main(page).getByRole('list', { name: 'First partners' }).getByRole('listitem')).toHaveCount(2);
  await main(page).getByRole('button', { name: 'Create market' }).click();
  await expect(page).toHaveURL(/\/markets\/[^/?]+$/);

  // The partners went in through the import: Northwind (known) gets a link, Brand New AG is a new partner.
  await page.goto('/partners?view=potential');
  const northwind = page.getByTestId('partner-row').filter({ hasText: 'Northwind Consulting' });
  await expect(northwind).toHaveCount(1);
  await expect(northwind).toContainText('Austria · Reseller and France · Reseller');
  await expect(page.getByTestId('partner-row').filter({ hasText: 'Brand New AG' })).toContainText('France · Reseller');
  await page.goto('/markets');
  await expect(card(page, 'France · Reseller').getByLabel('Partners per step')).toHaveText('Researched2Discovery call0Qualification0MAP0Signed0');
});

test('a reload keeps the step in the address and the answers in the tab', async ({ page }) => {
  await signIn(page, 'Carl', '/markets/new');
  await main(page).getByLabel(/^Market/).first().fill('Spain');
  await main(page).getByLabel(/^Our product/).fill('A product');
  await main(page).getByLabel(/^Our target customers/).fill('Some customers');
  await main(page).getByRole('button', { name: 'Next' }).click();
  await expect(page).toHaveURL(/step=2/);
  await page.reload();
  await expect(main(page).getByText('New market · Step 2 of 4')).toBeVisible();
  await main(page).getByRole('button', { name: 'Back' }).click();
  await expect(main(page).getByLabel(/^Market/).first()).toHaveValue('Spain');
});

test('Copy from another market makes a draft under a new name', async ({ page }) => {
  await signInWithSample(page, 'Dora');
  await main(page).getByRole('link', { name: 'Copy from another market' }).click();
  await expect(page).toHaveURL(/\/markets\/copy/);
  await expect(main(page).getByText(/Hypotheses do not transfer across markets/)).toBeVisible();
  await main(page).getByLabel('Copy from').selectOption({ label: 'Austria · Reseller' });
  await main(page).getByLabel(/^New market/).fill('Switzerland');
  await main(page).getByRole('button', { name: 'Copy market' }).click();
  // The new market's own page, once the copy is made (`/markets/copy` would match a looser pattern at once).
  await expect(page).toHaveURL(/\/markets\/m_[0-9a-z]{10}$/);
  await page.goto('/markets');
  await expect(card(page, 'Switzerland · Reseller').getByLabel('Partners per step')).toHaveText('Researched0Discovery call0Qualification0MAP0Signed0');
});

test('first partners show the same notes as the import', async ({ page }) => {
  await signInWithSample(page, 'Greta');
  await main(page).getByRole('link', { name: 'New market' }).click();
  await main(page).getByLabel(/^Market/).first().fill('France');
  await main(page).getByRole('button', { name: 'Next' }).click();
  await main(page).getByLabel(/^Why the partner route works/).fill('Local trust.');
  await main(page).getByRole('button', { name: 'Next' }).click();
  await main(page).getByRole('button', { name: 'Skip' }).click();

  const add = async (company: string, website = '') => {
    await main(page).getByLabel('Company').fill(company);
    await main(page).getByLabel('Website').fill(website);
    await main(page).getByRole('button', { name: 'Add', exact: true }).click();
  };
  const longName = 'Northern Isles Maritime Logistics And Trading Group Holdings';
  await add('Wingtip Digital', 'wingtip.example');
  await expect(main(page).getByRole('listitem').filter({ hasText: 'Wingtip Digital' })).toContainText('Already a signed reseller');
  await add(longName);
  await expect(main(page).getByRole('listitem').filter({ hasText: longName })).toContainText(
    `${longName} is already your managed service provider. This adds ${longName} as a reseller.`,
  );
});

test('a market’s page shows the partner type as text', async ({ page }) => {
  await signInWithSample(page, 'Hugo');
  await card(page, 'Austria · Reseller').getByRole('link', { name: 'Austria · Reseller' }).click();
  await page.getByRole('tab', { name: 'Market hypothesis' }).click();
  await expect(page.getByRole('combobox', { name: 'Partner type' })).toHaveCount(0);
  await expect(page.getByText('Partner type', { exact: true })).toBeVisible();
  await expect(page.locator('div').filter({ has: page.getByText('Partner type', { exact: true }) }).filter({ hasText: 'Reseller' }).first()).toBeVisible();
});

test('a version 1 Partners file offers a new one, and the old file is trashed', async ({ page }) => {
  await signIn(page, 'Old File', '/partners');
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', oldPartners: true } });
  expect(seeded.ok()).toBe(true);
  const { partnersFileId, marketIds } = (await seeded.json()) as { partnersFileId: string; marketIds: string[] };
  // Markets, a new market and a market page say so too, with the way to Partners, where the new file starts.
  for (const path of ['/markets', '/markets/new', `/markets/${marketIds[0]}`]) {
    await page.goto(path);
    const alert = main(page).getByRole('alert');
    await expect(alert).toHaveText(/Your Partners file was made by an earlier test version of PartnerStandard Desk\. On Partners you can start a new one\./);
    await expect(alert.getByRole('link', { name: 'Go to Partners' })).toHaveAttribute('href', '/partners');
  }
  await page.goto('/partners');
  await expect(page.getByRole('heading', { level: 1, name: 'This Partners file was made by an earlier test version of PartnerStandard Desk.' })).toBeVisible();
  await expect(page.getByText(byEdition({ hosted: 'The old file goes to the trash in your Google Drive', database: 'The old file goes to the trash and stays in the database' }), { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Start a new Partners file' }).click();
  await expect(page.getByRole('heading', { name: 'No partners yet' })).toBeVisible();
  const trash = await page.request.get('/api/test-seed');
  expect((await trash.json() as { trashedPartnerFiles: string[] }).trashedPartnerFiles).toContain(partnersFileId);
});

test('Copy with no market yet points to New market', async ({ page }) => {
  await signIn(page, 'Emil', '/markets/copy');
  await expect(main(page).getByText('There’s no market to copy yet.')).toBeVisible();
  await main(page).getByRole('link', { name: 'New market' }).click();
  await expect(page).toHaveURL(/\/markets\/new/);
});

test.describe('on a phone', () => {
  test.use({ viewport: { width: 375, height: 800 } });

  test('the cards, the flow and the copy form fit without sideways scrolling', async ({ page }) => {
    await signInWithSample(page, 'Fred');
    expect(await noSidewaysScroll(page)).toBe(true);
    await expect(card(page, 'Austria · Reseller')).toBeVisible();
    await page.goto('/markets/new?step=4');
    await expect(main(page).getByText('New market · Step 4 of 4')).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    await page.goto('/markets/new?step=1');
    await expect(main(page).getByRole('complementary', { name: 'Example' })).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
    await page.goto('/markets/copy');
    await expect(main(page).getByLabel('Copy from')).toBeVisible();
    expect(await noSidewaysScroll(page)).toBe(true);
  });
});

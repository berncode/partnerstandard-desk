import { expect, test, type Page } from '@playwright/test';
import { actionAnswer } from './saves';

async function signIn(page: Page, name = 'Anna') {
  await page.goto(`/api/test-auth?name=${name}&next=/partners`);
  await expect(page).toHaveURL(/\/partners/);
}

interface Seeded { partnerIds: string[]; accountIds: string[]; marketIds: string[]; acmeAccountId?: string }

/** The sample book (see /api/test-seed): 6 potential, 2 active, 3 closed; two markets, Austria and Germany. */
async function signInWithSample(page: Page, name = 'Anna', extra: Record<string, boolean> = {}): Promise<Seeded> {
  await signIn(page, name);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', ...extra } });
  expect(seeded.ok()).toBe(true);
  await page.goto('/partners');
  await expect(page.getByRole('tab', { name: /^Active/ })).toBeVisible();
  return seeded.json() as Promise<Seeded>;
}

const rows = (page: Page) => page.getByTestId('partner-row');
const select = (page: Page, label: string, option: string) => page.getByLabel(label, { exact: true }).selectOption({ label: option });
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('a new account sees an empty page with two ways to start, and Find partners goes to Markets', async ({ page }) => {
  await signIn(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Partners' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'No partners yet' })).toBeVisible();
  await expect(page.getByRole('tab')).toHaveCount(0);
  await expect(page.getByRole('main').getByRole('button', { name: 'Add a partner' })).toHaveCount(2);

  await page.getByRole('main').getByRole('link', { name: 'Find partners' }).first().click();
  await expect(page).toHaveURL(/\/markets\?find=partners$/);
  // No market to pick yet: no tip that says to pick one.
  await expect(page.getByRole('link', { name: 'Create your first market' })).toBeVisible();
  await expect(page.getByText('Pick a market. Its search prompt finds companies that fit it.')).toHaveCount(0);
});

test('it opens on Active with the counts on the three tabs, and a partner in two markets shows once', async ({ page }) => {
  await signInWithSample(page);
  await expect(tab(page, 'Active 2')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Potential 6')).toBeVisible();
  await expect(tab(page, 'Closed 3')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  const tailspin = rows(page).filter({ hasText: 'Tailspin Solutions' });
  await expect(tailspin).toHaveCount(1);
  await expect(tailspin).toContainText('Austria · Reseller and Germany · Reseller');
  await expect(tailspin).toContainText('Onboarding');
  await expect(rows(page).filter({ hasText: 'Wingtip Digital' })).toContainText('No market');
  await expect(page.getByRole('columnheader')).toHaveText(['Company', 'Partner type', 'Stage', 'Markets', 'Updated']);
});

test('it opens on Potential when nobody is active, and shows an empty view and an empty filter in words', async ({ page }) => {
  await signIn(page);
  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Add a partner' });
  await dialog.getByLabel('Company').fill('Globex');
  // The row shows at once and saves in the background: the page is opened again once the add's own save answers.
  const added = actionAnswer(page, '"Globex"');
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page)).toHaveCount(1);
  await added;

  await page.goto('/partners');
  await expect(tab(page, 'Potential 1')).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).first()).toContainText('Globex');
  await expect(rows(page).first()).toContainText('Recruitment · Researched');

  await tab(page, 'Active 0').click();
  await expect(page.getByText('No active partners yet. A partner shows here once you mark it signed.')).toBeVisible();

  await tab(page, 'Potential 1').click();
  await select(page, 'Partner type', 'Distributor');
  await expect(page.getByRole('heading', { name: 'No partners match these filters.' })).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await expect(rows(page)).toHaveCount(1);
});

test('filters by partner type, market and stage, and a view switch keeps type, market and layout', async ({ page }) => {
  await signInWithSample(page);
  await tab(page, 'Potential 6').click();
  await expect(rows(page)).toHaveCount(6);

  await select(page, 'Partner type', 'Managed Service Provider');
  await expect(rows(page)).toHaveCount(1);
  await expect(page).toHaveURL(/view=potential&type=managed/);
  await select(page, 'Partner type', 'All partner types');

  await select(page, 'Market', 'Germany · Reseller');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Fabrikam Systems');
  await expect(tab(page, 'Active 1')).toBeVisible();

  await page.getByRole('button', { name: 'Board' }).click();
  await select(page, 'Stage', 'Researched');
  await expect(page).toHaveURL(/market=m_\w+&stage=researched&layout=board/);

  await tab(page, 'Active 1').click();
  await expect(page).toHaveURL(/view=active&market=m_\w+&layout=board$/);
  await expect(page.getByLabel('Market', { exact: true })).toHaveValue(/^m_/);
  await expect(page.getByLabel('Stage', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('region', { name: 'Onboarding' }).getByRole('link', { name: 'Tailspin Solutions' })).toBeVisible();

  await tab(page, 'Active 1').click();
  await select(page, 'Stage', 'Growth');
  await expect(page.getByRole('heading', { name: 'No partners match these filters.' })).toBeVisible();
});

test('Potential has stage choices by step and Closed by how it ended', async ({ page }) => {
  await signInWithSample(page);
  await tab(page, 'Potential 6').click();
  await expect(page.getByLabel('Stage', { exact: true }).locator('option')).toHaveText(['All stages', 'Researched', 'Discovery call', 'Qualification', 'MAP']);
  await select(page, 'Stage', 'MAP');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Litware Group');
  await expect(rows(page).first()).toContainText('Recruitment · MAP');

  await tab(page, 'Closed 3').click();
  await expect(page.getByLabel('Stage', { exact: true }).locator('option')).toHaveText(['All stages', 'Not now', 'No', 'Exited']);
  await expect(rows(page)).toHaveCount(3);
  await expect(rows(page).filter({ hasText: 'Proseware Ltd' })).toContainText('Not now');
  await expect(rows(page).filter({ hasText: 'Humongous Insurance' })).toContainText('No');
  await expect(rows(page).filter({ hasText: 'Lucerne Publishing' })).toContainText('Exited on 21 Oct 2026');
  await expect(page.getByRole('button', { name: 'Board' })).toHaveCount(0);
  await select(page, 'Stage', 'Exited');
  await expect(rows(page)).toHaveCount(1);
});

test('the board has a column per step for Potential and per stage for Active', async ({ page }) => {
  await signInWithSample(page);
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page).toHaveURL(/layout=board/);
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Onboarding', 'Growth', 'Expansion', 'Exit']);
  await expect(page.getByRole('region', { name: 'Growth' }).getByRole('link', { name: 'Wingtip Digital' })).toBeVisible();

  await tab(page, 'Potential 6').click();
  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['Researched', 'Discovery call', 'Qualification', 'MAP']);
  await expect(page.getByRole('region', { name: 'Researched' })).toContainText('3');
  await expect(page.getByRole('region', { name: 'Researched' }).getByTestId('partner-card')).toHaveCount(3);
  await expect(page.getByRole('region', { name: 'Discovery call' }).getByRole('link', { name: 'Contoso Partners' })).toBeVisible();

  await page.reload();
  await expect(page.getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true');
  await expect(tab(page, 'Potential 6')).toHaveAttribute('aria-selected', 'true');
});

test('a row opens the partner', async ({ page }) => {
  await signInWithSample(page);
  await rows(page).filter({ hasText: 'Wingtip Digital' }).getByRole('cell', { name: 'Growth' }).click();
  await expect(page).toHaveURL(/\/partners\/a_\w+\?type=reseller$/);
  await page.goBack();
  await page.getByRole('link', { name: 'Tailspin Solutions' }).click();
  await expect(page).toHaveURL(/\/partners\/a_\w+\?type=reseller$/);
});

test('adding a partner that is already there: the same type offers the market or Open it, another type warns', async ({ page }) => {
  await signInWithSample(page);
  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a partner' });

  // Same type, by name, in a market it is not in yet.
  await dialog.getByLabel('Company').fill('northwind consulting');
  await expect(dialog.getByText('Northwind Consulting is already a partner as Reseller.')).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', /\/partners\/a_\w+\?type=reseller$/);
  await expect(dialog.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Market (optional)').selectOption({ label: 'Austria · Reseller' });
  await expect(dialog.getByText('It is already in Austria · Reseller.')).toBeVisible();
  await dialog.getByLabel('Market (optional)').selectOption({ label: 'Germany · Reseller' });
  await dialog.getByRole('button', { name: 'Add Germany · Reseller to it' }).click();
  await expect(dialog).toBeHidden();
  await tab(page, 'Potential 6').click();
  await expect(rows(page).filter({ hasText: 'Northwind Consulting' })).toContainText('Austria · Reseller and Germany · Reseller');
  await expect(rows(page).filter({ hasText: 'Northwind Consulting' })).toHaveCount(1);

  // The same website, another name.
  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  await dialog.getByLabel('Company').fill('Fabrikam Inc');
  await dialog.getByLabel('Website').fill('https://www.fabrikam.example/team');
  await expect(dialog.getByText('Fabrikam Systems is already a partner as Reseller.')).toBeVisible();

  // Another type: a warning, then Add puts that type on the same company.
  await dialog.getByLabel('Partner type').selectOption({ label: 'Managed Service Provider' });
  await expect(dialog.getByText('Fabrikam Systems is already your reseller. This adds Fabrikam Systems as a managed service provider.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(tab(page, 'Potential 7')).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Fabrikam' })).toHaveCount(2);
});

test('adding a partner with a market and a place: it shows at once, in the right view, and stays after a reload', async ({ page }) => {
  await signInWithSample(page);
  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a partner' });
  await dialog.getByLabel('Company').fill('Initech');
  await dialog.getByLabel('Country').fill('Austria');
  await dialog.getByLabel('Where are they now?').selectOption({ label: 'Growth' });
  await dialog.getByLabel('Signed on').fill('2026-09-01');
  await dialog.getByLabel('Market (optional)').selectOption({ label: 'Austria · Reseller' });
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  // While the moves save, the new partner is not flagged as a duplicate of itself.
  await expect(dialog.getByRole('status')).toHaveCount(0);
  await expect(dialog).toBeHidden();
  await expect(tab(page, 'Active 3')).toHaveAttribute('aria-selected', 'true');
  const initech = rows(page).filter({ hasText: 'Initech' });
  await expect(initech).toContainText('Growth');
  await expect(initech).toContainText('Austria · Reseller');

  await page.reload();
  await expect(tab(page, 'Active 3')).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Initech' })).toContainText('Growth');
});

test('the dialog needs a company, offers every type grouped, and only the markets of the chosen type', async ({ page }) => {
  await signInWithSample(page);
  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a partner' });
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog.getByText('Company is required')).toBeVisible();
  await expect(dialog.getByLabel('Partner type').locator('optgroup')).toHaveCount(4);
  await expect(dialog.getByLabel('Where are they now?').locator('option')).toHaveText(['Researched', 'Discovery call', 'Qualification', 'MAP', 'Onboarding', 'Growth', 'Expansion']);
  await expect(dialog.getByLabel('Market (optional)').locator('option')).toHaveText(['No market', 'Austria · Reseller', 'Germany · Reseller']);
  await dialog.getByLabel('Partner type').selectOption({ label: 'Broker' });
  await expect(dialog.getByLabel('Market (optional)').locator('option')).toHaveText(['No market']);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
});

test('on a phone the list, the board and the dialog fit without sideways scroll, with a 60-character name', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signInWithSample(page, 'Phone Anna');
  await tab(page, 'Potential 6').click();
  await expect(page.getByRole('link', { name: 'Northern Isles Maritime Logistics And Trading Group Holdings' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByTestId('partner-card').first()).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  await expect(page.getByRole('dialog', { name: 'Add a partner' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('one row per partner type: both of Acme’s rows open the same page, each on its own tab', async ({ page }) => {
  const { acmeAccountId } = await signInWithSample(page, 'Anna', { twoTypes: true });
  expect(acmeAccountId).toBeTruthy();
  await expect(tab(page, 'Active 3')).toHaveAttribute('aria-selected', 'true');
  const active = rows(page).filter({ hasText: 'Acme' });
  await expect(active).toHaveCount(1);
  await expect(active).toContainText('Technology Partner');
  await expect(active.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', `/partners/${acmeAccountId}?type=technology`);

  await tab(page, 'Potential 7').click();
  const potential = rows(page).filter({ hasText: 'Acme' });
  await expect(potential).toHaveCount(1);
  await expect(potential).toContainText('Reseller');
  await expect(potential.getByRole('link', { name: 'Acme' })).toHaveAttribute('href', `/partners/${acmeAccountId}?type=reseller`);
  await potential.getByRole('link', { name: 'Acme' }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${acmeAccountId}\\?type=reseller$`));
  await expect(page.getByRole('tab', { name: 'Reseller' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Technology Partner' })).toBeVisible();

  await page.goBack();
  await page.getByRole('button', { name: 'Board' }).click();
  await expect(page.getByRole('region', { name: 'Researched' }).getByRole('link', { name: 'Acme' }))
    .toHaveAttribute('href', `/partners/${acmeAccountId}?type=reseller`);
  await tab(page, 'Active 3').click();
  await page.getByRole('region', { name: 'Growth' }).getByRole('link', { name: 'Acme' }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${acmeAccountId}\\?type=technology$`));
  await expect(page.getByRole('tab', { name: 'Technology Partner' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Reseller' })).toBeVisible();
});

test('adding ACME as Reseller when Acme is a technology partner adds that type to Acme', async ({ page }) => {
  await signInWithSample(page);
  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  let dialog = page.getByRole('dialog', { name: 'Add a partner' });
  await dialog.getByLabel('Company').fill('Acme');
  await dialog.getByLabel('Partner type').selectOption({ label: 'Technology Partner' });
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(tab(page, 'Potential 7')).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page).filter({ hasText: 'Acme' })).toHaveCount(1);

  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  dialog = page.getByRole('dialog', { name: 'Add a partner' });
  await dialog.getByLabel('Company').fill('ACME');
  await dialog.getByLabel('Partner type').selectOption({ label: 'Reseller' });
  await expect(dialog.getByText('Acme is already your technology partner. This adds Acme as a reseller.')).toBeVisible();
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(rows(page).filter({ hasText: 'Acme' })).toHaveCount(2);

  await rows(page).filter({ hasText: 'Reseller' }).filter({ hasText: 'Acme' }).getByRole('link', { name: 'Acme' }).click();
  await expect(page.getByRole('tab', { name: 'Reseller' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'Technology Partner' })).toBeVisible();
});

test('adding a closed reseller says how it was closed, with no date, and offers the market or Open it', async ({ page }) => {
  const { accountIds } = await signInWithSample(page);
  // The sample book's 8th company is Proseware Ltd, closed as Not now, in no market.
  await page.getByRole('main').getByRole('button', { name: 'Add a partner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add a partner' });
  await dialog.getByLabel('Company').fill('Proseware');
  await expect(dialog.getByText('You closed Proseware Ltd as a reseller (Not now).', { exact: true })).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', `/partners/${accountIds[7]}?type=reseller`);
  await dialog.getByLabel('Market (optional)').selectOption({ label: 'Germany · Reseller' });
  await dialog.getByRole('button', { name: 'Add Germany · Reseller to it' }).click();
  await expect(dialog).toBeHidden();
  await tab(page, 'Closed 3').click();
  await expect(rows(page).filter({ hasText: 'Proseware Ltd' })).toContainText('Germany · Reseller');
});

test('the Source list offers Existing partner', async ({ page }) => {
  await signInWithSample(page);
  await page.getByRole('link', { name: 'Tailspin Solutions' }).click();
  await expect(page.getByRole('combobox', { name: 'Source' }).locator('option')).toHaveText([
    'Research', 'AI search', 'Competitor of', 'Existing partner',
  ]);
});

import { readFile } from 'node:fs/promises';
import { expect, test, type Locator, type Page } from '@playwright/test';

const LONG_NAME = 'Northern Isles Maritime Logistics And Trading Group Holdings';

interface Seeded { partnerIds: string[]; marketIds: string[] }

/**
 * Signs a new test user in, seeds the sample book and opens Austria. Austria holds Northwind (Researched) and Tailspin
 * (Onboarding, linked to "Mid-size IT resellers"); Contoso is a reseller in no market; the long name is a managed
 * service partner.
 */
async function openAustria(page: Page, query = ''): Promise<Seeded> {
  await page.goto('/api/test-auth?name=Anna&next=/markets');
  await expect(page).toHaveURL(/\/markets/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(seeded.ok()).toBe(true);
  const ids = (await seeded.json()) as Seeded;
  await page.goto(`/markets/${ids.marketIds[0]}${query}`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Austria · Reseller' })).toBeVisible();
  return ids;
}

const main = (page: Page) => page.getByRole('main');
const column = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const header = (page: Page) => main(page).locator('header');
const allSaved = (page: Page) => expect(header(page).getByRole('status')).toHaveText('Saved');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** The prompt *Download* saves: its file name and its text. */
async function download(page: Page, scope: Locator): Promise<{ name: string; text: string }> {
  const [file] = await Promise.all([page.waitForEvent('download'), scope.getByRole('button', { name: 'Download' }).click()]);
  return { name: file.suggestedFilename(), text: await readFile((await file.path())!, 'utf8') };
}

/** Adds an exclusion to the open market through the Exclusions panel. */
async function exclude(page: Page, company: string, reason: string) {
  await main(page).getByRole('button', { name: 'Exclusions' }).click();
  const panel = page.getByRole('dialog', { name: 'Exclusions' });
  await panel.getByRole('button', { name: 'Add company' }).click();
  const form = panel.getByRole('form', { name: 'New exclusion' });
  await form.getByLabel('Company').fill(company);
  await form.getByLabel('Reason').fill(reason);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByText(company)).toBeVisible();
  await page.keyboard.press('Escape');
  await allSaved(page);
}

const TABLE = [
  '| Company | Website | Country | Why it fits | Evidence and sources |',
  '|---|---|---|---|---|',
  '| Datum Labs | https://datum.example | Austria | Sells IT to mid-size firms | datum.example/about |',
  '| Contoso Partners | contoso.example | Austria | A reseller we know | |',
  '| Northwind Consulting | northwind.example | Austria | Already here | |',
  '| Datum Labs | datum.example | Austria | Listed twice | |',
  `| ${LONG_NAME} | | Austria | Runs IT for shipping firms | |`,
  '| Tauern Systems | tauern.example | Austria | Excluded | |',
  '| Fourth Coffee | fourth.example | Austria | New | |',
].join('\n');

test('the search prompt: copy and download for the market and for a partner hypothesis', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openAustria(page);
  await main(page).getByRole('link', { name: 'Find partners with AI' }).click();
  const card = main(page).getByRole('region', { name: 'Find partners with AI' });
  await card.getByRole('button', { name: 'Copy search prompt' }).click();
  await expect(card.getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toContain('## Leave out');
  expect(copied).toContain('- Northwind Consulting (northwind.example)');
  expect(copied).toContain('- Tailspin Solutions (tailspin.example)');
  // Every reseller is left out, including one in no market. A managed service partner is not.
  expect(copied).toContain('- Contoso Partners (contoso.example)');
  expect(copied).not.toContain(LONG_NAME);

  const marketFile = await download(page, card);
  expect(marketFile.name).toBe('search-prompt-Austria.md');
  expect(marketFile.text).toBe(copied);

  await page.getByRole('tab', { name: 'Partner hypotheses' }).click();
  const hypothesis = main(page).getByRole('article', { name: 'Mid-size IT resellers' });
  await expect(hypothesis).toContainText('Find companies like these with AI. The prompt includes the linked partners as examples.');
  await hypothesis.getByRole('button', { name: 'Copy search prompt' }).click();
  const fromCard = await page.evaluate(() => navigator.clipboard.readText());
  expect(fromCard).toContain('Examples of companies we have spoken with:\n  - Tailspin Solutions (tailspin.example)');
  expect(fromCard).not.toBe(copied);
  const cardFile = await download(page, hypothesis);
  expect(cardFile).toEqual({ name: 'search-prompt-Austria.md', text: fromCard });
});

test('Import AI results: a preview with every duplicate kind, then one button that says what it does', async ({ page }) => {
  await openAustria(page);
  await exclude(page, 'Tauern Systems', 'Existing partner');

  await main(page).getByRole('button', { name: 'Import AI results' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import AI results' });
  await dialog.getByLabel('Paste the AI’s table').fill(TABLE);
  await dialog.getByRole('button', { name: 'Show preview' }).click();

  const preview = dialog.getByRole('table', { name: 'Preview' });
  const row = (company: string, nth = 0) => preview.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Import ${company}`, exact: true }) }).nth(nth);
  await expect(dialog.getByRole('status')).toHaveText('4 of 7 ticked.');
  await expect(row('Contoso Partners')).toContainText('already a partner: adds this market');
  await expect(row('Northwind Consulting')).toContainText('already in this market');
  await expect(row('Datum Labs', 1)).toContainText('already in this table');
  await expect(row(LONG_NAME)).toContainText(`${LONG_NAME} is already your managed service provider. This adds ${LONG_NAME} as a reseller.`);
  await expect(row('Tauern Systems')).toContainText('excluded: Existing partner');
  for (const blocked of ['Northwind Consulting', 'Tauern Systems']) {
    await expect(dialog.getByRole('checkbox', { name: `Import ${blocked}` })).toBeDisabled();
  }

  await dialog.getByRole('button', { name: 'Add 3 partners and add this market to 1' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByText('3 partners added, and this market added to 1 partner')).toBeVisible();
  for (const company of ['Datum Labs', 'Fourth Coffee', LONG_NAME]) await expect(column(page, 'Researched')).toContainText(company);
  await expect(column(page, 'Discovery call')).toContainText('Contoso Partners');

  await allSaved(page);
  await page.reload();
  for (const company of ['Datum Labs', 'Fourth Coffee', LONG_NAME]) await expect(column(page, 'Researched')).toContainText(company);
  await expect(column(page, 'Discovery call')).toContainText('Contoso Partners');
  // One section per company and type: Contoso got this market, at its own step.
  await expect(main(page).getByRole('link', { name: 'Contoso Partners' })).toHaveCount(1);
});

test('Import AI results from a CSV file, for a partner hypothesis', async ({ page }) => {
  await openAustria(page);
  await main(page).getByRole('button', { name: 'Import AI results' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import AI results' });
  await dialog.getByRole('combobox', { name: 'Results for' }).selectOption({ label: 'Mid-size IT resellers' });
  await dialog.getByLabel('Or upload a .csv file').setInputFiles({
    name: 'partners.csv', mimeType: 'text/csv',
    buffer: Buffer.from('"Company","Website","Why it fits"\n"Kappa IT","kappa.example","Sells to mid-size firms"\n"Lambda Systems","lambda.example","Same customers"\n'),
  });
  await expect(dialog.getByRole('checkbox', { name: 'Import Kappa IT' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Add 2 partners' }).click();
  await expect(dialog).toBeHidden();
  await main(page).getByRole('combobox', { name: 'Partner hypothesis' }).selectOption({ label: 'Mid-size IT resellers' });
  for (const company of ['Kappa IT', 'Lambda Systems']) await expect(column(page, 'Researched')).toContainText(company);
});

test('at 375 px the search prompt and the import preview fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openAustria(page, '?tab=hypothesis');
  await expect(main(page).getByRole('region', { name: 'Find partners with AI' }).getByRole('button', { name: 'Download' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.getByRole('tab', { name: 'Pipeline' }).click();
  await main(page).getByRole('button', { name: 'Import AI results' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import AI results' });
  await dialog.getByLabel('Paste the AI’s table').fill(TABLE);
  await dialog.getByRole('button', { name: 'Show preview' }).click();
  // No exclusions here: Tauern Systems is a new company too.
  await expect(dialog.getByRole('button', { name: 'Add 4 partners and add this market to 1' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('a signed partner starts unticked, and another type uses the same note as adding by hand', async ({ page }) => {
  await openAustria(page);
  await main(page).getByRole('button', { name: 'Import AI results' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import AI results' });
  await dialog.getByLabel('Paste the AI’s table').fill([
    '| Company | Website |',
    '|---|---|',
    '| Wingtip Digital | wingtip.example |',
    `| ${LONG_NAME} | |`,
  ].join('\n'));
  await dialog.getByRole('button', { name: 'Show preview' }).click();

  const preview = dialog.getByRole('table', { name: 'Preview' });
  const row = (company: string) => preview.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Import ${company}`, exact: true }) });
  const wingtip = dialog.getByRole('checkbox', { name: 'Import Wingtip Digital' });
  await expect(wingtip).toBeEnabled();
  await expect(wingtip).not.toBeChecked();
  await expect(row('Wingtip Digital')).toContainText('Already a signed reseller');
  await expect(row(LONG_NAME)).toContainText(
    `${LONG_NAME} is already your managed service provider. This adds ${LONG_NAME} as a reseller.`,
  );
  await expect(dialog.getByRole('status')).toHaveText('1 of 2 ticked.');
});

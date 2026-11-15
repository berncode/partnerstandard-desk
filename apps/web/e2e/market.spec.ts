import { expect, test, type Page } from '@playwright/test';
import { byEdition } from './edition';

/** The sample book's partners, in /api/test-seed's order. */
const SAMPLE = { northwind: 0, fabrikam: 1, tailspin: 5 } as const;
const LONG_NAME = 'Northern Isles Maritime Logistics And Trading Group Holdings';
const CALL_NOTE = 'Customers ask for security they can run without a security team.';

interface Seeded { partnerIds: string[]; accountIds: string[]; marketIds: string[] }

/**
 * Signs a new test user in and seeds the sample book with the closed and the exited partner in Austria, and a
 * discovery call with Tailspin dated today. Austria then holds Northwind (Researched), Tailspin (Onboarding, linked to
 * "Mid-size IT resellers"), Proseware (Not now) and Lucerne (exited).
 */
async function signInWithSample(page: Page, name = 'Anna'): Promise<Seeded> {
  await page.goto(`/api/test-auth?name=${name}&next=/markets`);
  await expect(page).toHaveURL(/\/markets/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', closedInMarket: true, callInMarket: true } });
  expect(seeded.ok()).toBe(true);
  return seeded.json() as Promise<Seeded>;
}

async function openAustria(page: Page, query = ''): Promise<Seeded> {
  const seeded = await signInWithSample(page);
  await page.goto(`/markets/${seeded.marketIds[0]}${query}`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Austria · Reseller' })).toBeVisible();
  return seeded;
}

const main = (page: Page) => page.getByRole('main');
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
const column = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const header = (page: Page) => main(page).locator('header');
/** Waits until every change made so far is saved. */
const allSaved = (page: Page) => expect(header(page).getByRole('status')).toHaveText('Saved');
const offer = (page: Page) => page.getByRole('region', { name: 'What changed and why?' });
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('a market card opens the market: its header, and the Pipeline by step with a Signed lane, closed ones hidden', async ({ page }) => {
  const { accountIds } = await signInWithSample(page);
  await page.goto('/markets');
  await main(page).getByRole('link', { name: 'Austria · Reseller' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Austria · Reseller' })).toBeVisible();
  await expect(header(page)).toContainText('Open');
  // Hosted, test users' files live in memory: there is no spreadsheet to open. A company server offers the download.
  await expect(header(page).getByRole('link', { name: byEdition({ hosted: 'Open in Google Sheets', database: 'Download as a spreadsheet' }) }))
    .toHaveCount(byEdition({ hosted: 0, database: 1 }));
  await expect(tab(page, 'Pipeline')).toHaveAttribute('aria-selected', 'true');

  await expect(column(page, 'Researched')).toContainText('Northwind Consulting');
  await expect(column(page, 'Signed')).toContainText('Tailspin Solutions');
  await expect(column(page, 'Signed')).toContainText('Onboarding');
  await expect(main(page).getByText('2 closed hidden')).toBeVisible();
  await expect(main(page).getByText('Proseware Ltd')).toHaveCount(0);

  await main(page).getByLabel('Show closed').check();
  await expect(column(page, 'Researched')).toContainText('Proseware Ltd');
  await expect(column(page, 'Researched')).toContainText('Not now');
  await expect(column(page, 'Signed')).toContainText('Lucerne Publishing');
  await expect(column(page, 'Signed')).toContainText('Exited');

  const filter = main(page).getByRole('combobox', { name: 'Partner hypothesis' });
  await filter.selectOption({ label: 'Mid-size IT resellers' });
  await expect(main(page).getByText('Northwind Consulting')).toHaveCount(0);
  await expect(column(page, 'Signed')).toContainText('Tailspin Solutions');
  await filter.selectOption({ label: 'No hypothesis' });
  await expect(column(page, 'Researched')).toContainText('Northwind Consulting');
  await expect(main(page).getByText('Tailspin Solutions')).toHaveCount(0);
  await filter.selectOption({ label: 'All partner hypotheses' });

  await column(page, 'Signed').getByRole('link', { name: 'Tailspin Solutions' }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${accountIds[SAMPLE.tailspin]}\\?type=reseller$`));
});

test('Add a partner runs the duplicate check: a new company, one from another market, one already here, another type', async ({ page }) => {
  await openAustria(page);
  await main(page).getByRole('button', { name: 'Add a partner' }).click();
  const form = main(page).getByRole('form', { name: 'New partner' });
  await form.getByLabel('Company').fill('Datum Labs');
  await form.getByLabel('Website').fill('datum.example');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(column(page, 'Researched')).toContainText('Datum Labs');
  await expect(form.getByLabel('Company')).toHaveValue('');

  // Fabrikam is a reseller in Germany: the same type, so it gets this market instead of a second record.
  await form.getByLabel('Company').fill('Fabrikam Systems');
  await expect(form).toContainText('Fabrikam Systems is already a partner as Reseller.');
  await expect(form.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  await form.getByRole('button', { name: 'Add Austria · Reseller to it' }).click();
  await expect(column(page, 'Researched')).toContainText('Fabrikam Systems');

  await form.getByLabel('Company').fill('Northwind Consulting');
  await expect(form).toContainText('It is already in Austria · Reseller.');
  await expect(form.getByRole('button', { name: 'Add Austria · Reseller to it' })).toHaveCount(0);

  // The long name is a managed service partner: another type is a warning, then allowed.
  await form.getByLabel('Company').fill(LONG_NAME);
  await expect(form).toContainText(`${LONG_NAME} is already your managed service provider. This adds ${LONG_NAME} as a reseller.`);
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(column(page, 'Researched')).toContainText(LONG_NAME);

  await allSaved(page);
  await page.reload();
  for (const company of ['Datum Labs', 'Fabrikam Systems', LONG_NAME]) await expect(column(page, 'Researched')).toContainText(company);
});

test('Find partners with AI is one click from the Pipeline: the search prompt on the Market hypothesis tab', async ({ page }) => {
  await openAustria(page);
  await main(page).getByRole('link', { name: 'Find partners with AI' }).click();
  await expect(page).toHaveURL(/\?tab=hypothesis#search-prompt$/);
  await expect(tab(page, 'Market hypothesis')).toHaveAttribute('aria-selected', 'true');
  await expect(main(page).getByRole('region', { name: 'Find partners with AI' })).toBeVisible();
});

test('Exclusions: add a company in one market, then import it into another', async ({ page }) => {
  const { marketIds } = await signInWithSample(page);
  await page.goto(`/markets/${marketIds[1]}`);
  await main(page).getByRole('button', { name: 'Exclusions' }).click();
  let panel = page.getByRole('dialog', { name: 'Exclusions' });
  await expect(panel).toContainText('Companies to leave out of this market’s searches and imports. Partners already in this market are left out anyway.');
  await expect(panel).toContainText('No companies excluded yet.');
  await panel.getByRole('button', { name: 'Add company' }).click();
  const form = panel.getByRole('form', { name: 'New exclusion' });
  await form.getByLabel('Company').fill('Tauern Systems');
  await form.getByLabel('Website').fill('tauern.example');
  await form.getByLabel('Reason').fill('Existing partner');
  await form.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByText('Tauern Systems')).toBeVisible();
  await page.keyboard.press('Escape');
  await allSaved(page);

  await page.goto(`/markets/${marketIds[0]}`);
  await main(page).getByRole('button', { name: 'Exclusions' }).click();
  panel = page.getByRole('dialog', { name: 'Exclusions' });
  await panel.getByRole('button', { name: 'Import from another market' }).click();
  await panel.getByRole('combobox', { name: 'Market' }).selectOption({ label: 'Germany · Reseller' });
  await panel.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(panel).toContainText('1 company added, 0 already there');
  await expect(panel.getByText('Existing partner')).toBeVisible();
  await panel.getByRole('button', { name: 'Import', exact: true }).click();
  await expect(panel).toContainText('0 companies added, 1 already there');

  await page.reload();
  await main(page).getByRole('button', { name: 'Exclusions' }).click();
  await expect(page.getByRole('dialog', { name: 'Exclusions' }).getByText('Tauern Systems')).toBeVisible();
});

test('editing the market hypothesis or a value point within 7 days of a call offers the change log; Changes lists it', async ({ page }) => {
  await openAustria(page, '?tab=hypothesis');
  await expect(tab(page, 'Market hypothesis')).toHaveAttribute('aria-selected', 'true');
  await main(page).getByRole('button', { name: /^Statement:/ }).click();
  await main(page).getByRole('textbox', { name: 'Statement' }).fill('In Austria, IT resellers will resell it.');
  await main(page).getByRole('textbox', { name: 'Statement' }).press('Control+Enter');
  await expect(offer(page)).toContainText('About Statement.');
  await expect(offer(page).getByLabel('Call').locator('option:checked')).toContainText('Tailspin Solutions · Discovery');
  await offer(page).getByRole('textbox', { name: 'What changed and why?' }).fill('Resellers, not distributors, after the Tailspin call');
  await offer(page).getByRole('button', { name: 'Save' }).click();
  await expect(offer(page)).toHaveCount(0);

  await tab(page, 'Value proposition').click();
  const margin = main(page).getByRole('region', { name: 'Margin or fees' });
  await margin.getByRole('button', { name: 'Add value point' }).click();
  await margin.getByRole('textbox', { name: 'New value point' }).fill('A monthly fee they can bill');
  await margin.getByRole('textbox', { name: 'New value point' }).press('Enter');
  await expect(margin.getByText('A monthly fee they can bill')).toBeVisible();
  await expect(offer(page)).toContainText('About A monthly fee they can bill.');
  await offer(page).getByRole('button', { name: 'Skip' }).click();
  await expect(offer(page)).toHaveCount(0);

  await tab(page, 'Changes').click();
  const changes = main(page).getByRole('region', { name: 'Changes' });
  await expect(changes).toContainText('Market hypothesis');
  await expect(changes).toContainText('Statement');
  await expect(changes).toContainText('Resellers, not distributors, after the Tailspin call');
  await expect(changes).toContainText(/After the call: .* · Tailspin Solutions · Discovery/);
  await changes.getByRole('button', { name: 'Value points' }).click();
  await expect(changes).toContainText('No changes about value points yet.');

  await allSaved(page);
  await page.reload();
  await tab(page, 'Changes').click();
  await expect(main(page).getByRole('region', { name: 'Changes' })).toContainText('Resellers, not distributors, after the Tailspin call');
});

test('?tab=hypotheses opens Partner hypotheses, and the editor takes call notes as evidence', async ({ page }) => {
  await openAustria(page, '?tab=hypotheses');
  await expect(tab(page, 'Partner hypotheses')).toHaveAttribute('aria-selected', 'true');
  const card = main(page).getByRole('article', { name: 'Mid-size IT resellers' });
  await expect(card).toContainText('Holds');
  await expect(card.getByRole('link', { name: 'Tailspin Solutions' })).toBeVisible();

  await card.getByRole('button', { name: 'Edit Mid-size IT resellers' }).click();
  const editor = card.getByRole('region', { name: 'Partner hypothesis editor' });
  await expect(editor).toContainText(CALL_NOTE);
  await editor.getByRole('button', { name: 'Use as evidence: Customer Pains' }).click();
  await expect(editor.getByRole('button', { name: /^Evidence for their side:/ })).toContainText(`Customer Pains: ${CALL_NOTE}`);
  await expect(offer(page)).toContainText('About Mid-size IT resellers.');
  await offer(page).getByRole('button', { name: 'Skip' }).click();
  await editor.getByRole('button', { name: 'Done' }).click();
  await expect(card).toContainText(`Evidence: Customer Pains: ${CALL_NOTE}`);

  await allSaved(page);
  await page.reload();
  await expect(main(page).getByRole('article', { name: 'Mid-size IT resellers' })).toContainText(`Evidence: Customer Pains: ${CALL_NOTE}`);
});

test('first partners not added show a notice that goes away; a market that isn’t yours is not found', async ({ page }) => {
  const { marketIds } = await openAustria(page, '?firstPartners=2');
  const notice = main(page).getByText('2 first partners weren’t added. Add them on the Pipeline tab.');
  await expect(notice).toBeVisible();
  await main(page).getByRole('button', { name: 'Dismiss' }).click();
  await expect(notice).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/markets/${marketIds[0]}$`));

  await page.goto('/markets/m_nope000000');
  await expect(main(page).getByRole('heading', { name: 'Market not found' })).toBeVisible();

  await page.goto('/api/test-auth?name=Ben&next=/markets');
  await page.goto(`/markets/${marketIds[0]}`);
  await expect(main(page).getByRole('heading', { name: 'Market not found' })).toBeVisible();
});

test('adding an excluded company asks, then adds it', async ({ page }) => {
  await openAustria(page);
  await main(page).getByRole('button', { name: 'Exclusions' }).click();
  const panel = page.getByRole('dialog', { name: 'Exclusions' });
  await panel.getByRole('button', { name: 'Add company' }).click();
  const exclusion = panel.getByRole('form', { name: 'New exclusion' });
  await exclusion.getByLabel('Company').fill('Acme');
  await exclusion.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(panel.getByText('Acme')).toBeVisible();
  await page.keyboard.press('Escape');

  await main(page).getByRole('button', { name: 'Add a partner' }).click();
  const form = main(page).getByRole('form', { name: 'New partner' });
  await form.getByLabel('Company').fill('ACME');
  await expect(form.getByText('Acme is on this market’s Exclusions. Add anyway?')).toBeVisible();
  await form.getByRole('button', { name: 'Add anyway' }).click();
  await expect(column(page, 'Researched')).toContainText('ACME');
  await allSaved(page);
});

test('at 375 px the market page fits without sideways scroll, its steps stacked', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openAustria(page);
  await expect(column(page, 'Researched')).toContainText('Northwind Consulting');
  expect(await noSidewaysScroll(page)).toBe(true);
  for (const name of ['Market hypothesis', 'Value proposition', 'Partner hypotheses', 'Changes']) {
    await tab(page, name).click();
    expect(await noSidewaysScroll(page)).toBe(true);
  }
  await main(page).getByRole('button', { name: 'Exclusions' }).click();
  expect(await noSidewaysScroll(page)).toBe(true);
});

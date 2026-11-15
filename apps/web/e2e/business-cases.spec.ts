import { expect, test, type Browser, type Page } from '@playwright/test';
import { actionAnswer } from './saves';
import { appUrl, byEdition } from './edition';

/** The sample book's partners, in /api/test-seed's order. */
const SAMPLE = { proseware: 7, lucerne: 9 } as const;

/** "Case of 30 Oct 2026": a new case's title, made with today's date. */
const CASE_TITLE = /^Case of \d{1,2} [A-Z][a-z]{2} \d{4}$/;
/** A case address whose case is not in the directory (owner, 2026-10-30), in each edition's words. */
const notListed = () => byEdition({
  hosted: 'This case is no longer in PartnerStandard Desk. If its file was kept, it is still in your Google Drive.',
  database: 'This case is no longer in PartnerStandard Desk. If it went to the trash, an admin can restore it later.',
});
/** The trash button for several files, and the way to keep them: a company server only trashes (plan 13, task 12). */
const trashFiles = () => byEdition({ hosted: 'Move the files to the Drive trash', database: 'Move the files to the trash' });
const keepFiles = () => byEdition({ hosted: 'Keep the files in Drive', database: 'Move the files to the trash' });
/** Delete asks by the case's title (a copy's starts with "Copy of"). */
const CASE_DELETE_DIALOG = /^Delete (Copy of )?Case of \d{1,2} [A-Z][a-z]{2} \d{4}\?$/;

interface Seeded {
  partnerIds: string[];
  accountIds: string[];
  acmeAccountId?: string;
  acmePartnerIds?: { reseller: string; technology: string; referral?: string };
}

/** Signs a new test user in and seeds the sample book (with Acme as a reseller and a technology partner by default). */
async function signInWithSample(page: Page, name: string, body: Record<string, unknown> = { twoTypes: true }): Promise<Seeded> {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=/partners`);
  await expect(page).toHaveURL(/\/partners/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', ...body } });
  expect(seeded.ok()).toBe(true);
  return seeded.json() as Promise<Seeded>;
}

/** Makes a business case for a partner type through the commands, as New case does. */
async function seedCase(page: Page, partnerId: string): Promise<string> {
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'case', partnerId } });
  expect(made.ok()).toBe(true);
  return ((await made.json()) as { caseId: string }).caseId;
}

/** Seeds through /api/test-seed and answers its JSON. */
async function seed<T>(page: Page, data: Record<string, unknown>): Promise<T> {
  const out = await page.request.post('/api/test-seed', { data });
  expect(out.ok()).toBe(true);
  return out.json() as Promise<T>;
}

const main = (page: Page) => page.getByRole('main');
const area = (page: Page) => main(page).getByRole('region', { name: 'Business case' });
const cards = (page: Page) => main(page).getByRole('article');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('the sidebar has Business cases first under Operations, and the empty page says what a case is for', async ({ page }) => {
  await signInWithSample(page, 'Case Starter', {});
  const sidebar = page.getByRole('complementary');
  const links = sidebar.getByRole('navigation', { name: 'Main menu' }).getByRole('link');
  await expect(links).toHaveText(['This week', 'Partners', 'Markets', 'Programs', 'Business cases', 'Mutual Action Plans', 'Business reviews', 'How it works', 'Call guide', 'Company facts', 'Settings']);
  await sidebar.getByRole('link', { name: 'Business cases', exact: true }).click();
  await expect(page).toHaveURL(/\/business-cases$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Business cases' })).toBeVisible();
  await expect(main(page).getByRole('heading', { level: 2, name: 'No business cases yet' })).toBeVisible();
  await expect(main(page)).toContainText('what a partner earns with you and what you get');
  await expect(main(page).getByRole('link', { name: 'New case' }).first()).toHaveAttribute('href', '/business-cases/new');
  await expect(sidebar.getByRole('link', { name: 'Business cases', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('a partner type’s tab has its Business case area: New case opens the case on its offer tab, and the row shows its numbers', async ({ page }) => {
  const { acmeAccountId } = await signInWithSample(page, 'Case Maker');
  await page.goto(`/partners/${acmeAccountId}?type=reseller`);
  await expect(area(page)).toContainText('No case yet for this partner type.');

  await area(page).getByRole('button', { name: 'New case' }).click();
  await expect(page).toHaveURL(/\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme as reseller' })).toBeVisible();
  await expect(main(page).getByText(CASE_TITLE)).toBeVisible();

  // Back on the partner: the row names the case, when it was made, the stage then, and the two numbers.
  await main(page).getByRole('link', { name: 'Back to Acme' }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${acmeAccountId}\\?type=reseller$`));
  const row = area(page).getByRole('listitem');
  await expect(row).toHaveCount(1);
  await expect(row.getByRole('link', { name: CASE_TITLE })).toHaveAttribute('href', /\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  await expect(row).toContainText(/Made \d{1,2} [A-Z][a-z]{2} \d{4}, in Recruitment/);
  await expect(row).toContainText('Over five years: Acme earns €0, and your net value is €0.');

  // The other partner type has its own area, with none yet.
  await page.getByRole('tab', { name: 'Technology Partner' }).click();
  await expect(area(page)).toContainText('No case yet for this partner type.');
});

test('the Business cases page lists the cards, filters by partner type, and copies and deletes', async ({ page }) => {
  const { acmeAccountId, acmePartnerIds } = await signInWithSample(page, 'Case Lister');
  await seedCase(page, acmePartnerIds!.reseller);
  await seedCase(page, acmePartnerIds!.technology);
  await page.goto('/business-cases');
  await expect(cards(page)).toHaveCount(2);

  const reseller = main(page).getByRole('article', { name: 'Acme as reseller' });
  await expect(reseller.getByRole('link', { name: CASE_TITLE })).toHaveAttribute('href', /\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  await expect(reseller.getByRole('link', { name: 'Go to Acme' })).toHaveAttribute('href', `/partners/${acmeAccountId}?type=reseller`);
  await expect(reseller).toContainText(/Made \d{1,2} [A-Z][a-z]{2} \d{4}/);
  await expect(main(page).getByRole('article', { name: 'Acme as technology partner' })).toBeVisible();

  // The filter by partner type.
  await main(page).getByLabel('Partner type').selectOption({ label: 'Technology Partner' });
  await expect(cards(page)).toHaveCount(1);
  await expect(main(page).getByRole('article', { name: 'Acme as technology partner' })).toBeVisible();
  await main(page).getByLabel('Partner type').selectOption({ label: 'All partner types' });
  await expect(cards(page)).toHaveCount(2);

  // Copy makes a case of the same partner type, titled "Copy of" the original's title, and opens it.
  await reseller.getByRole('button', { name: /^Copy Case of/ }).click();
  await expect(page).toHaveURL(/\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme as reseller' })).toBeVisible();
  await expect(main(page).getByRole('button', { name: /^Title: Copy of Case of \d{1,2} [A-Z][a-z]{2} \d{4}$/ })).toBeVisible();
  await page.getByRole('complementary').getByRole('link', { name: 'Business cases', exact: true }).click();
  await expect(cards(page)).toHaveCount(3);
  await expect(main(page).getByRole('article', { name: 'Acme as reseller' })).toHaveCount(2);
  await expect(main(page).getByRole('link', { name: /^Copy of Case of \d{1,2} [A-Z][a-z]{2} \d{4}$/ })).toBeVisible();

  // Delete asks first, and the card leaves.
  const first = main(page).getByRole('article', { name: 'Acme as reseller' }).first();
  await first.getByRole('button', { name: /^Delete (Copy of )?Case of/ }).click();
  const dialog = page.getByRole('dialog', { name: CASE_DELETE_DIALOG });
  await expect(dialog).toContainText(byEdition({ hosted: 'goes to the trash in your Google Drive', database: 'goes to the trash, where an admin can restore it later' }));
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(cards(page)).toHaveCount(3);
  await first.getByRole('button', { name: /^Delete (Copy of )?Case of/ }).click();
  await page.getByRole('dialog', { name: CASE_DELETE_DIALOG }).getByRole('button', { name: 'Delete case' }).click();
  await expect(cards(page)).toHaveCount(2);
  await page.reload();
  await expect(cards(page)).toHaveCount(2);
});

test('New case on the page asks for the partner and type, then for a program when it must', async ({ page }) => {
  await signInWithSample(page, 'Case Picker');
  expect((await page.request.post('/api/test-seed', { data: { fixture: 'programs' } })).ok()).toBe(true);
  await page.goto('/business-cases');
  await main(page).getByRole('link', { name: 'New case' }).first().click();
  await expect(page).toHaveURL(/\/business-cases\/new$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'New case' })).toBeVisible();
  await expect(main(page).getByLabel('Program')).toHaveCount(0);
  await main(page).getByLabel('Partner').selectOption({ label: 'Acme as reseller' });
  await main(page).getByRole('button', { name: 'Make the case' }).click();

  // Two reseller programs, and Acme is in neither: the person picks, the first already picked.
  await expect(main(page).getByText('Pick the program this case is for.')).toBeVisible();
  await expect(main(page).getByLabel('Program')).toHaveValue(/^pg_/);
  await main(page).getByLabel('Program').selectOption({ label: 'Reseller · DACH' });
  await main(page).getByRole('button', { name: 'Make the case' }).click();
  await expect(page).toHaveURL(/\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme as reseller' })).toBeVisible();
});

test('a closed or an exited partner type keeps its cases and still offers New case', async ({ page }) => {
  const { accountIds, partnerIds } = await signInWithSample(page, 'Case Keeper', {});
  await seedCase(page, partnerIds[SAMPLE.lucerne]!);
  await page.goto(`/partners/${accountIds[SAMPLE.lucerne]}`);
  await expect(area(page).getByRole('listitem')).toHaveCount(1);
  await expect(area(page).getByRole('listitem')).toContainText(', in Exit');
  await expect(area(page).getByRole('button', { name: 'New case' })).toBeEnabled();

  await page.goto(`/partners/${accountIds[SAMPLE.proseware]}`);
  await area(page).getByRole('button', { name: 'New case' }).click();
  await expect(page).toHaveURL(/\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Proseware Ltd as reseller' })).toBeVisible();
});

test('removing a partner type with cases says how many and that closing keeps everything, then asks what happens to them', async ({ page }) => {
  const { acmeAccountId, acmePartnerIds } = await signInWithSample(page, 'Case Remover');
  const caseIds: string[] = [];
  for (const partnerId of [acmePartnerIds!.reseller, acmePartnerIds!.reseller, acmePartnerIds!.technology, acmePartnerIds!.technology]) {
    caseIds.push(await seedCase(page, partnerId));
  }
  await page.goto(`/partners/${acmeAccountId}?type=reseller`);
  await expect(area(page).getByRole('listitem')).toHaveCount(2);

  await page.getByRole('button', { name: 'Remove Reseller' }).click();
  const trash = page.getByRole('dialog', { name: 'Remove Acme as a reseller?' });
  await expect(trash).toContainText('Acme has 2 business cases as a reseller.');
  await expect(trash).toContainText('To stop working with a partner, close it or exit it. That keeps everything.');
  await expect(trash).toContainText('What happens to the cases?');
  await trash.getByRole('button', { name: trashFiles() }).click();
  await expect(trash).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Reseller' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Technology Partner' })).toHaveAttribute('aria-selected', 'true');

  await page.goto('/business-cases');
  await expect(cards(page)).toHaveCount(2);
  await expect(main(page).getByRole('article', { name: 'Acme as reseller' })).toHaveCount(0);

  // The company's last partner type: the company goes too, and the files stay in Drive (on a company server, the trash).
  await page.goto(`/partners/${acmeAccountId}?type=technology`);
  await page.getByRole('button', { name: 'Remove Technology Partner' }).click();
  const keep = page.getByRole('dialog', { name: 'Remove Acme as a technology partner?' });
  await expect(keep).toContainText('Acme has 2 business cases as a technology partner.');
  await keep.getByRole('button', { name: keepFiles() }).click();
  await expect(keep).toBeHidden();
  await expect(page.getByText('This partner isn’t in your list any more.')).toBeVisible();

  await page.goto('/business-cases');
  await expect(main(page).getByRole('heading', { level: 2, name: 'No business cases yet' })).toBeVisible();

  // The old address of a case kept in Drive, or moved to the trash, or never made, says the case is no longer in
  // PartnerStandard Desk, not that its file may be in the trash (owner, 2026-10-30).
  for (const caseId of [caseIds[3]!, caseIds[0]!, 'case_nothere0000']) {
    await page.goto(`/business-cases/${caseId}/offer`);
    await expect(main(page).getByRole('alert')).toHaveText(notListed());
  }
});

test('Start a new Partners file asks the same question for all the company’s cases', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case File Loser');
  await seedCase(page, acmePartnerIds!.reseller);
  await seedCase(page, acmePartnerIds!.technology);
  expect((await page.request.post('/api/test-seed', { data: { fixture: 'losePartners' } })).ok()).toBe(true);

  await page.goto('/partners');
  await page.getByRole('button', { name: 'Start a new Partners file' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start a new Partners file?' });
  await expect(dialog).toContainText('You have 2 business cases.');
  await dialog.getByRole('button', { name: keepFiles() }).click();
  await expect(page.getByRole('heading', { name: 'No partners yet' })).toBeVisible();

  await page.goto('/business-cases');
  await expect(main(page).getByRole('heading', { level: 2, name: 'No business cases yet' })).toBeVisible();
});

test('a partner type taken out of the Partners sheet by hand still shows its card, by its type and title', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Hand Edit');
  await seedCase(page, acmePartnerIds!.reseller);
  expect((await page.request.post('/api/test-seed', { data: { fixture: 'handRemovePartner', partnerId: acmePartnerIds!.reseller } })).ok()).toBe(true);

  await page.goto('/business-cases');
  const card = main(page).getByRole('article', { name: 'Reseller' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('This partner type is no longer in Partners.');
  await expect(card.getByRole('link', { name: CASE_TITLE })).toHaveAttribute('href', /\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  await expect(card.getByRole('link', { name: /^Go to/ })).toHaveCount(0);
});

test('at 375 px the Business cases page, New case and the partner’s area fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { acmeAccountId, acmePartnerIds } = await signInWithSample(page, 'Case Phone');
  await seedCase(page, acmePartnerIds!.reseller);
  await page.goto('/business-cases');
  await expect(cards(page)).toHaveCount(1);
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto('/business-cases/new');
  await expect(main(page).getByLabel('Partner')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto(`/partners/${acmeAccountId}?type=reseller`);
  await expect(area(page).getByRole('listitem')).toHaveCount(1);
  await expect(area(page)).toContainText('Over five years');
  expect(await noSidewaysScroll(page)).toBe(true);
  await area(page).getByRole('link', { name: CASE_TITLE }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme as reseller' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// The case page: the offer and the partner case (plan 7, task 6)

const caseNav = (page: Page) => main(page).getByRole('navigation', { name: 'Case' });
const caseTab = (page: Page, name: RegExp) => caseNav(page).getByRole('link', { name });
const status = (page: Page) => main(page).getByRole('status');
const saved = (page: Page) => expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
const box = (page: Page, name: string) => main(page).getByRole('textbox', { name, exact: true });
const caseCard = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });
const offerPath = (caseId: string) => `/business-cases/${caseId}/offer`;
const partnerCasePath = (caseId: string) => `/business-cases/${caseId}`;
/** Nothing a person reads says NaN, Infinity or a negative zero (Review Focus 5). */
async function expectNoBrokenNumbers(page: Page) {
  const text = await main(page).innerText();
  expect(text).not.toMatch(/NaN|Infinity|-\s?[€$£]\s?0(?![\d,.])|-CHF\s?0(?![\d,.])/);
}

test('a case has the four tabs, and its offer comes from Company facts and the program, level names included', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Offer');
  await seed(page, { fixture: 'caseFacts' });
  await seed(page, { fixture: 'caseProgram', partnerId: acmePartnerIds!.reseller });
  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(offerPath(caseId));

  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme as reseller' })).toBeVisible();
  await expect(caseNav(page).getByRole('link')).toHaveText([
    '1. Offer to Acme Products and partner terms',
    '2. Partner case What Acme gets out of it',
    '3. Our case Internal: what it’s worth to us',
    '4. Share The one-pagers, ready to send',
  ]);
  await expect(caseTab(page, /^1\. Offer to Acme/)).toHaveAttribute('aria-current', 'page');
  // Our case is internal: its subtitle is in the warning color.
  await expect(caseNav(page).getByText('Internal: what it’s worth to us')).toHaveClass(/text-warn/);
  await expect(caseTab(page, /^3\. Our case/)).toHaveAttribute('href', `/business-cases/${caseId}/ours`);
  await expect(caseTab(page, /^4\. Share/)).toHaveAttribute('href', `/business-cases/${caseId}/share`);

  // Company facts: the currency, the customers who renew and a typical customer as two products.
  await expect(caseCard(page, 'This offer').getByRole('combobox', { name: 'Currency' })).toHaveValue('EUR');
  await expect(box(page, 'Customers who renew')).toHaveValue('90');
  await expect(box(page, 'Product 1 name')).toHaveValue('Pays every year');
  await expect(box(page, 'Product 1 price')).toHaveValue('24,000');
  await expect(box(page, 'Product 2 name')).toHaveValue('Pays once');
  await expect(box(page, 'Product 2 price')).toHaveValue('4,000');
  await expect(main(page).getByText('A typical customer is worth €24,000 a year plus €4,000 once.')).toBeVisible();

  // The program: a reseller closes and gives level 1 support; its margin; its level names; Preferred and its bar.
  const terms = caseCard(page, 'Partner type');
  await expect(terms.getByRole('combobox', { name: 'Customer support' })).toHaveValue('level1');
  await expect(terms.getByRole('checkbox', { name: 'Closes the deal and invoices the customer' })).toBeChecked();
  await expect(terms.getByText('Earns a margin on everything it sells.')).toBeVisible();
  await expect(box(page, 'First year of yearly products, Member')).toHaveValue('25');
  await expect(box(page, 'First year of yearly products, Gold')).toHaveValue('30');
  await expect(main(page).getByRole('checkbox', { name: 'Include Gold partner conditions' })).toBeChecked();
  await expect(main(page).getByRole('combobox', { name: 'A partner becomes Gold' })).toHaveValue('deals');
  await expect(box(page, 'Deals in a year')).toHaveValue('5');
  // What the case can't take from the program, it says.
  await expect(main(page).getByText(/^The program’s performance bars aren’t in the case\./)).toBeVisible();
  await expect(main(page).getByText(/^The program asks more of a Gold partner than deals or revenue/)).toBeVisible();

  // The partner case tab: Starts as uses the program's level names.
  await caseTab(page, /^2\. Partner case/).click();
  await expect(page).toHaveURL(new RegExp(`/business-cases/${caseId}$`));
  await expect(caseTab(page, /^2\. Partner case/)).toHaveAttribute('aria-current', 'page');
  const startsAs = main(page).getByRole('combobox', { name: 'Starts as' });
  await expect(startsAs).toHaveValue('registered');
  await expect(startsAs.getByRole('option')).toHaveText(['Member', 'Gold']);

  // Hosted, a test account's files live in memory: there is no spreadsheet to open, on any tab. On a company server
  // every tab offers the file's download.
  const sheetLink = main(page).getByRole('link', { name: byEdition({ hosted: 'Open in Google Sheets', database: 'Download as a spreadsheet' }) });
  for (const tab of [/^1\. Offer/, /^2\. Partner case/, /^3\. Our case/, /^4\. Share/]) {
    await caseTab(page, tab).click();
    await expect(caseTab(page, tab)).toHaveAttribute('aria-current', 'page');
    await expect(sheetLink).toHaveCount(byEdition({ hosted: 0, database: 1 }));
  }
  if (byEdition({ hosted: false, database: true })) await expect(sheetLink).toHaveAttribute('href', /\/files\/wf_[a-z0-9]{20}\/download$/);
});

test('a flat-fee program and a partner type with no program say so on the offer tab', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Notes', { twoTypes: true, referral: true });
  // No reseller program yet.
  const noProgram = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(offerPath(noProgram));
  await expect(main(page).getByText('No program for this partner type yet. Add one, or fill in the terms here.')).toBeVisible();
  await expect(box(page, 'First year of yearly products')).toHaveValue('0');

  // A referral program that pays a flat fee per new customer.
  await seed(page, { fixture: 'caseProgram', partnerId: acmePartnerIds!.referral, flatFee: true });
  const flat = await seedCase(page, acmePartnerIds!.referral!);
  await page.goto(offerPath(flat));
  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme as referral partner' })).toBeVisible();
  await expect(main(page).getByText(/^The program pays a flat fee for each new customer\./)).toBeVisible();
  await expect(main(page).getByText('No program for this partner type yet. Add one, or fill in the terms here.')).toHaveCount(0);
});

test('after Company facts change the offer tab says so, and Update asks first, then fills again while the deals stay', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Updater');
  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(partnerCasePath(caseId));
  await box(page, 'Year 1').fill('4');
  await saved(page);

  await page.goto(offerPath(caseId));
  await expect(box(page, 'Product 1 price')).toHaveValue('0');
  await expect(main(page).getByText(/^Company facts changed on/)).toHaveCount(0);

  await page.goto('/company-facts');
  await page.getByLabel('Pays every year').fill('30000');
  await expect(page.getByRole('main').getByRole('status')).toHaveText('Saved', { timeout: 10_000 });

  // The case keeps its numbers, and says what changed since.
  await page.goto(offerPath(caseId));
  await expect(main(page).getByText(/^Company facts changed on \d{1,2} [A-Z][a-z]{2} \d{4}, after this case was filled\./)).toBeVisible();
  await expect(box(page, 'Product 1 price')).toHaveValue('0');

  const update = main(page).getByRole('button', { name: 'Update from Company facts and program' });
  await update.click();
  const dialog = page.getByRole('dialog', { name: 'Update from Company facts and program?' });
  await expect(dialog).toContainText('the currency, customers who renew, the portfolio');
  await expect(dialog).toContainText('Deals, costs and everything in Our case stay.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(box(page, 'Product 1 price')).toHaveValue('0');

  await update.click();
  await dialog.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(box(page, 'Product 1 price')).toHaveValue('30,000');
  await expect(main(page).getByText(/^Company facts changed on/)).toHaveCount(0);
  await caseTab(page, /^2\. Partner case/).click();
  await expect(box(page, 'Year 1')).toHaveValue('4');

  // Two reseller programs now, Acme in neither: Update asks which, the first picked already.
  await seed(page, { fixture: 'programs' });
  await caseTab(page, /^1\. Offer to Acme/).click();
  await update.click();
  await dialog.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(dialog).toContainText('Pick the program this case is for.');
  await expect(dialog.getByLabel('Program')).toHaveValue(/^pg_/);
  await dialog.getByLabel('Program').selectOption({ label: 'Reseller · DACH' });
  await dialog.getByRole('button', { name: 'Update', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(box(page, 'First year of yearly products, Registered')).toHaveValue('25');
  await expect(main(page).getByText('No program for this partner type yet. Add one, or fill in the terms here.')).toHaveCount(0);
});

test('a partner type taken out of Partners by hand: the case opens, says so, and can’t be updated', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Type Gone');
  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await seed(page, { fixture: 'handRemovePartner', partnerId: acmePartnerIds!.reseller });
  await page.goto(offerPath(caseId));
  await expect(main(page).getByText('This partner type is no longer in Partners.').first()).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Back to Business cases' })).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Update from Company facts and program' })).toBeDisabled();
  await expect(box(page, 'Product 1 name')).toHaveValue('Pays every year');
});

test('the partner case shows the Business Case app’s chart, year table and results for its SaaS example', async ({ page }) => {
  // As wide as the Business Case app's content at 1280 px: the year table fits beside the inputs.
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { acmePartnerIds } = await signInWithSample(page, 'Case Example');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(partnerCasePath(caseId));

  await expect(main(page).getByRole('heading', { level: 2, name: /^What partnering with .+ is worth to Acme$/ })).toBeVisible();
  await expect(main(page).getByText('Reseller partner, 5 years, expected scenario. A typical customer is worth €24,000 a year plus €4,000 once.')).toBeVisible();
  // The Business Case app's numbers for the same inputs (BC v2 section 13.2, the SaaS example).
  await expect(main(page).getByRole('group', { name: /^Margin from / })).toContainText('€578,608');
  const profit = main(page).getByRole('group', { name: 'Partner profit after costs' });
  await expect(profit).toContainText('€479,507');
  await expect(profit).toContainText('pays for itself in year 2, month 6');
  await expect(main(page).getByText(/ gets €2,948,039 in revenue through this partner, before what it pays the partner\.$/)).toBeVisible();

  const chart = caseCard(page, 'Revenue per year, and profit so far');
  await expect(chart.getByRole('list', { name: 'Legend' }).getByRole('listitem'))
    .toHaveText(['Margin, new customers', 'Margin, renewals', 'Partner profit so far, after costs']);
  await chart.getByRole('button', { name: 'Year 2' }).hover();
  await expect(page.getByRole('tooltip')).toContainText('Year 2 · 7 new deals');

  const years = caseCard(page, 'Year by year').getByRole('table', { name: 'Year by year' });
  await expect(years.getByRole('row', { name: /^New deals/ })).toContainText('3711151955');
  await expect(years.getByRole('row', { name: /^Revenue/ }).getByRole('cell').last()).toHaveText('€578,608');
  await expect(years.getByRole('row', { name: /^Profit so far/ }).getByRole('cell').nth(4)).toHaveText('€479,507');
  await expectNoBrokenNumbers(page);
});

test('with Company facts left empty, no tab shows NaN, Infinity or a negative zero', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Empty Facts');
  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(partnerCasePath(caseId));
  await expect(main(page).getByRole('group', { name: 'Partner profit after costs' })).toContainText('€0');
  await expect(main(page).getByRole('group', { name: 'Partner profit after costs' })).toContainText('not paid back yet');
  await expectNoBrokenNumbers(page);
  await box(page, 'Year 1').fill('3');
  await main(page).getByRole('group', { name: 'To get started' }).getByRole('button', { name: 'Add a cost' }).click();
  await saved(page);
  await expectNoBrokenNumbers(page);
  await caseTab(page, /^1\. Offer to Acme/).click();
  await expect(box(page, 'Product 1 price')).toHaveValue('0');
  await expectNoBrokenNumbers(page);
});

test('the case saves as you type, also when you go Back at once, and its title can be renamed', async ({ page }) => {
  const { acmeAccountId, acmePartnerIds } = await signInWithSample(page, 'Case Saver');
  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(offerPath(caseId));

  // The title, renamed in the header.
  await main(page).getByRole('button', { name: /^Title: Case of/ }).click();
  await main(page).getByRole('textbox', { name: 'Title' }).fill('Expansion 2027');
  await main(page).getByRole('textbox', { name: 'Title' }).press('Enter');
  await saved(page);

  // A tab, then the browser's Back: one case on screen, saved as you go.
  await caseTab(page, /^2\. Partner case/).click();
  await box(page, 'Year 1').fill('6');
  await caseTab(page, /^1\. Offer to Acme/).click();
  await expect(page).toHaveURL(/\/offer$/);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/business-cases/${caseId}$`));
  await expect(box(page, 'Year 1')).toHaveValue('6');
  await saved(page);

  // A change, then at once Back to the partner: it is saved all the same.
  await box(page, 'Year 2').fill('9');
  await main(page).getByRole('link', { name: 'Back to Acme' }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${acmeAccountId}\\?type=reseller$`));
  await expect(area(page).getByRole('link', { name: 'Expansion 2027' })).toBeVisible();
  await expect(async () => {
    await page.goto(partnerCasePath(caseId));
    await expect(box(page, 'Year 2')).toHaveValue('9', { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await expect(box(page, 'Year 1')).toHaveValue('6');
  await expect(main(page).getByRole('button', { name: 'Title: Expansion 2027' })).toBeVisible();
});

test('at 375 px the offer and the partner case fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { acmePartnerIds } = await signInWithSample(page, 'Case Phone Tabs');
  await seed(page, { fixture: 'caseFacts' });
  await seed(page, { fixture: 'caseProgram', partnerId: acmePartnerIds!.reseller });
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(offerPath(caseId));
  await expect(box(page, 'Product 1 name')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await caseTab(page, /^2\. Partner case/).click();
  await expect(main(page).getByRole('group', { name: 'Partner profit after costs' })).toBeVisible();
  // The year table lists each year on its own on a phone.
  await expect(caseCard(page, 'Year by year').getByRole('group', { name: 'Year 1' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

// Our case, and our figures (plan 7, task 7)

const oursPath = (caseId: string) => `/business-cases/${caseId}/ours`;
const oursCard = (page: Page, name: string) => main(page).getByRole('region', { name, exact: true });

test('a new case copies Our figures from Company facts, and changing the card afterwards leaves the case as it was', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Figures');
  await page.goto('/company-facts');
  const ours = main(page).getByRole('region', { name: 'Our figures', exact: true });
  await ours.getByRole('textbox', { name: 'Your gross margin', exact: true }).fill('70');
  await ours.getByRole('button', { name: 'Add a cost every year' }).click();
  await ours.getByRole('textbox', { name: 'Every year, line 1', exact: true }).fill('Partner manager time');
  await ours.getByRole('textbox', { name: 'Every year, line 1 amount', exact: true }).fill('30000');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(oursPath(caseId));
  await expect(box(page, 'Your gross margin')).toHaveValue('70');
  await expect(box(page, 'Every year, line 1')).toHaveValue('Partner manager time');
  await expect(box(page, 'Every year, line 1 amount')).toHaveValue('30,000');

  // The card changes; the case keeps what it copied, also after a reload.
  await page.goto('/company-facts');
  await ours.getByRole('textbox', { name: 'Your gross margin', exact: true }).fill('55');
  await ours.getByRole('textbox', { name: 'Every year, line 1 amount', exact: true }).fill('99000');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  await page.goto(oursPath(caseId));
  await expect(box(page, 'Your gross margin')).toHaveValue('70');
  await expect(box(page, 'Every year, line 1 amount')).toHaveValue('30,000');
  await expectNoBrokenNumbers(page);
});

test('Our case shows the banner, a source on every number, the options, the recommendation and what we ask for', async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const { acmePartnerIds } = await signInWithSample(page, 'Case Ours');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(partnerCasePath(caseId));
  await caseTab(page, /^3\. Our case/).click();
  await expect(page).toHaveURL(new RegExp(`/business-cases/${caseId}/ours$`));
  await expect(caseTab(page, /^3\. Our case/)).toHaveAttribute('aria-current', 'page');

  await expect(main(page).getByText('Internal. Never shared with Acme and never part of the partner’s link.')).toBeVisible();
  await expect(main(page).getByRole('heading', { level: 2, name: /^Is the partnership with Acme worth it for .+\?$/ })).toBeVisible();

  // The options: with the partner, alone, and don't do it.
  const options = oursCard(page, 'The options');
  await expect(options.getByRole('table')).toBeVisible();
  const rows = options.getByRole('table').getByRole('row');
  // The Business Case app's numbers for the same inputs (BC v2 section 13.2, the SaaS example, expected scenario).
  await expect(rows.filter({ hasText: /^With Acme/ })).toContainText('€1,433,415');
  await expect(rows.filter({ hasText: /^With Acme/ })).toContainText('€242,000');
  await expect(rows.filter({ hasText: /^With Acme/ })).toContainText('Year 2, month 2');
  await expect(rows.filter({ hasText: /^Alone/ })).toContainText('€233,259');
  await expect(rows.filter({ hasText: /^Don’t do it/ })).toContainText('-€60,000');

  // Where each number comes from.
  const sure = oursCard(page, 'How sure are these numbers?');
  await expect(sure).toContainText('Finance');
  await expect(sure).toContainText('Assumption');
  await expect(box(page, 'Your gross margin')).toHaveValue('80');
  await expect(main(page).getByRole('combobox', { name: 'Your gross margin source' })).toHaveValue('finance');

  // The recommendation and what we ask for, saved as you type.
  await expect(box(page, 'What you ask for, besides the costs')).toHaveValue('About 30% of a partner manager’s time for Northwind.');
  await box(page, 'Your recommendation').fill('Go ahead with Acme.');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  await page.reload();
  await expect(box(page, 'Your recommendation')).toHaveValue('Go ahead with Acme.');
  await expectNoBrokenNumbers(page);

  // The same case on screen as the other tabs: a deal changed on the partner case moves our result.
  await caseTab(page, /^2\. Partner case/).click();
  await box(page, 'Year 1').fill('9');
  await caseTab(page, /^3\. Our case/).click();
  await expect(main(page).getByRole('combobox', { name: 'Your gross margin source' })).toBeVisible();
  await caseTab(page, /^2\. Partner case/).click();
  await expect(box(page, 'Year 1')).toHaveValue('9');
});

test('a case made with Company facts left empty shows 0 and no broken numbers on Our case', async ({ page }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Ours Empty');
  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(oursPath(caseId));
  await expect(main(page).getByText('Internal. Never shared with Acme and never part of the partner’s link.')).toBeVisible();
  await expect(box(page, 'Your gross margin')).toBeVisible();
  await expectNoBrokenNumbers(page);
});

test('at 375 px Our case fits without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { acmePartnerIds } = await signInWithSample(page, 'Case Phone Ours');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(oursPath(caseId));
  await expect(main(page).getByText('Internal. Never shared with Acme and never part of the partner’s link.')).toBeVisible();
  await expect(oursCard(page, 'The options')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  // The cost lines and the strategic reasons are the widest rows.
  await oursCard(page, 'Your costs').scrollIntoViewIfNeeded();
  expect(await noSidewaysScroll(page)).toBe(true);
  await oursCard(page, 'Strategic reasons').scrollIntoViewIfNeeded();
  expect(await noSidewaysScroll(page)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Sharing: the link, the partner's page and both PDFs (plan 7, task 8)

const GONE = "This link doesn't work any more. Ask the person who sent it for a new one.";
const OUR_SIDE = 'Our case · internal, for your manager';
const PARTNER_HEADING = /^What partnering with .+ is worth to Acme$/;
/** What `exampleCase` with `oursMarkers` puts in every part of our case. */
const OUR_MARKERS = ['OURS-MARKER', '919,191', '919191', '818,181', '818181', '717,171', '717171'];
const sharePath = (caseId: string) => `/business-cases/${caseId}/share`;
const shareButton = (page: Page) => main(page).getByRole('button', { name: 'Share a link with Acme' });
const linkBox = (page: Page) => main(page).getByRole('textbox', { name: 'Link for Acme' });

/** The pages of a PDF: Chromium writes one `/Type /Page` object per page (and `/Type /Pages` for the tree). */
const pageCount = (pdf: Buffer) => pdf.toString('latin1').match(/\/Type\s*\/Page(?![a-z])/g)?.length ?? 0;

/** One page on A4 and on Letter; and the count is not stuck at 1: on a much smaller sheet the same page needs more. */
async function expectOnePage(page: Page, what: string) {
  for (const format of ['A4', 'Letter'] as const) {
    expect(pageCount(await page.pdf({ format, printBackground: true })), `${what} on ${format}`).toBe(1);
  }
  expect(pageCount(await page.pdf({ format: 'A6', printBackground: true })), `${what} on A6`).toBeGreaterThan(1);
}

/** Shares the case open on the Share tab, and gives back its link. */
async function shareLink(page: Page): Promise<string> {
  await shareButton(page).click();
  await expect(linkBox(page)).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  await expect(main(page).getByText(/^Shared on \d{1,2} [A-Z][a-z]{2} \d{4}\.$/)).toBeVisible();
  return linkBox(page).inputValue();
}

/** A visitor with no session at all, as the partner is, and every response body the page gets. */
async function partnerVisitor(browser: Browser) {
  const context = await browser.newContext();
  expect(await context.cookies()).toEqual([]);
  const partner = await context.newPage();
  const bodies: Promise<{ type: string; body: string }>[] = [];
  partner.on('response', (response) => {
    const type = response.headers()['content-type'] ?? '';
    bodies.push(response.body().then((b) => ({ type, body: b.toString('utf8') })).catch(() => ({ type, body: '' })));
  });
  return { context, partner, bodies: async () => Promise.all(bodies) };
}

/** The flight data in a document is in JavaScript strings: read it with its quotes unescaped. */
const unescaped = (raw: string) => raw.replaceAll('\\"', '"');

async function expectGone(partner: Page) {
  await expect(partner.getByRole('heading', { level: 1 })).toHaveText(GONE);
  await expect(partner.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
  await expect(partner.getByRole('group', { name: 'Your profit after costs' })).toHaveCount(0);
}

test('Share makes a link the partner opens without signing in: today’s numbers, an edit shows, and nothing of our case', async ({ page, browser }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Sharer');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller, oursMarkers: true });
  await page.goto(sharePath(caseId));
  await expect(caseTab(page, /^4\. Share/)).toHaveAttribute('aria-current', 'page');
  const switcher = main(page).getByRole('navigation', { name: 'One-pager' });
  await expect(switcher.getByRole('link', { name: 'Partner case · for Acme' })).toHaveAttribute('aria-current', 'page');
  await expect(switcher.getByRole('link', { name: OUR_SIDE })).toBeVisible();
  await expect(main(page).getByRole('heading', { level: 1, name: PARTNER_HEADING })).toBeVisible();
  await expect(main(page).getByText('The link shows this case as it is now. Changes you make here show up for Acme.')).toBeVisible();

  // Share turns the link on: on the app's own address, with Copy.
  const link = await shareLink(page);
  expect(link.startsWith(`${appUrl()}/s/`)).toBe(true);
  await expect(main(page).getByRole('button', { name: 'Copy link' })).toBeVisible();
  await expect(main(page).getByRole('button', { name: 'Make a new link' })).toBeVisible();

  // The partner, with no session, sees the partner one-pager with today's numbers, outside the app frame.
  const visitor = await partnerVisitor(browser);
  const { partner } = visitor;
  const response = await partner.goto(link);
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  expect(response?.headers()['x-robots-tag']).toBe('noindex, nofollow');
  await expect(partner.getByRole('heading', { level: 1 })).toHaveText(PARTNER_HEADING);
  await expect(partner.getByRole('group', { name: /^Margin from / })).toContainText('€578,608');
  await expect(partner.getByRole('group', { name: 'Your profit after costs' })).toContainText('€479,507');
  await expect(partner.getByRole('group', { name: 'Your profit after costs' })).toContainText('pays for itself in year 2, month 6');
  await expect(partner.getByRole('button', { name: 'Download PDF' })).toBeVisible();
  await expect(partner.getByRole('complementary')).toHaveCount(0);
  // The logo is not a link: nothing here leads into PartnerStandard Desk, only the footer's legal pages (owner, 2026-10-30).
  await expect(partner.getByRole('banner').getByRole('img', { name: 'PartnerStandard' }).first()).toBeAttached();
  await expect(partner.getByRole('banner').getByRole('link')).toHaveCount(0);
  await expect(partner.getByRole('navigation', { name: 'Case' })).toHaveCount(0);
  await expect(partner.getByText(OUR_SIDE)).toHaveCount(0);
  await expect(partner.getByText('The link shows this case as it is now', { exact: false })).toHaveCount(0);

  // Nothing of our case: not in the HTML, not in any response the page got, not in the flight data a navigation fetches.
  const responses = await visitor.bodies();
  const pages = [
    await partner.content(),
    ...responses.filter((r) => /html|x-component/.test(r.type)).map((r) => unescaped(r.body)),
    unescaped(await (await partner.request.get(link)).text()),
    unescaped(await (await partner.request.get(link, { headers: { RSC: '1' } })).text()),
  ];
  for (const body of pages) {
    for (const marker of [...OUR_MARKERS, 'Partner manager time', 'Net value', 'Gross margin', 'Internal']) expect(body, marker).not.toContain(marker);
  }
  // The scripts and styles are the app's own code: none of our case's words are in them either.
  for (const { body } of responses) expect(body).not.toContain('OURS-MARKER');

  // After an edit, the link shows the new numbers.
  await caseTab(page, /^2\. Partner case/).click();
  await box(page, 'Year 1').fill('6');
  await saved(page);
  await partner.reload();
  await expect(partner.getByRole('region', { name: 'The plan' })).toContainText('New deals per year: 6, 7, 11, 15, 19.');

  // Our case is only on the signed-in Share tab.
  await caseTab(page, /^4\. Share/).click();
  await main(page).getByRole('navigation', { name: 'One-pager' }).getByRole('link', { name: OUR_SIDE }).click();
  await expect(page).toHaveURL(new RegExp(`${sharePath(caseId)}\\?show=ours$`));
  await expect(main(page).getByRole('heading', { level: 1, name: /^Partnership with Acme: is it worth it for .+\?$/ })).toBeVisible();
  await expect(main(page).getByText('Internal: download it and send it to your manager. It has no link.')).toBeVisible();
  await expect(main(page).getByText('OURS-MARKER-RECOMMENDATION')).toBeVisible();
  await expect(shareButton(page)).toHaveCount(0);
  await visitor.context.close();
});

test('Make a new link turns the old link off, and so does Stop sharing', async ({ page, browser }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Link Changer');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(sharePath(caseId));
  const first = await shareLink(page);
  const { context, partner } = await partnerVisitor(browser);
  await partner.goto(first);
  await expect(partner.getByRole('heading', { level: 1 })).toHaveText(PARTNER_HEADING);

  // Make a new link asks first; the old link then doesn't work, the new one does.
  await main(page).getByRole('button', { name: 'Make a new link' }).click();
  const renew = page.getByRole('dialog', { name: 'Make a new link?' });
  await expect(renew).toContainText('The link you sent stops working. Send the new one instead.');
  await renew.getByRole('button', { name: 'Make a new link' }).click();
  await expect(renew).toBeHidden();
  await expect(linkBox(page)).not.toHaveValue(first);
  const second = await linkBox(page).inputValue();
  await partner.reload();
  await expectGone(partner);
  await partner.goto(second);
  await expect(partner.getByRole('heading', { level: 1 })).toHaveText(PARTNER_HEADING);

  // The case was saved before and after: changes still save, with no conflict from the share.
  await caseTab(page, /^2\. Partner case/).click();
  await box(page, 'Year 1').fill('4');
  await saved(page);
  await caseTab(page, /^4\. Share/).click();

  // Stop sharing asks first; the link then doesn't work, and Share makes a new one.
  await main(page).getByRole('button', { name: 'Stop sharing' }).click();
  const stop = page.getByRole('dialog', { name: 'Stop sharing with Acme?' });
  await stop.getByRole('button', { name: 'Stop sharing' }).click();
  await expect(stop).toBeHidden();
  await expect(shareButton(page)).toBeVisible();
  await partner.reload();
  await expectGone(partner);
  await page.reload();
  await expect(shareButton(page)).toBeVisible();
  await context.close();
});

test('Delete case turns its link off', async ({ page, browser }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Link Deleter');
  const caseId = await seedCase(page, acmePartnerIds!.reseller);
  await page.goto(sharePath(caseId));
  const link = await shareLink(page);
  // The page knows the link is on after a reload too.
  await page.reload();
  await expect(main(page).getByText(/^Shared on /)).toBeVisible();

  await page.goto('/business-cases');
  await cards(page).first().getByRole('button', { name: /^Delete Case of/ }).click();
  // The card goes at once and the case is deleted after it: the link is tried once the delete's own answer is in.
  const deleted = actionAnswer(page, caseId);
  await page.getByRole('dialog', { name: CASE_DELETE_DIALOG }).getByRole('button', { name: 'Delete case' }).click();
  await expect(cards(page)).toHaveCount(0);
  await deleted;

  const { context, partner } = await partnerVisitor(browser);
  await partner.goto(link);
  await expectGone(partner);
  await context.close();
});

test('both one-pagers print alone, each on one page, A4 and Letter', async ({ page, browser }) => {
  const { acmePartnerIds } = await signInWithSample(page, 'Case Printer');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(sharePath(caseId));
  await expect(main(page).getByRole('heading', { level: 1, name: PARTNER_HEADING })).toBeVisible();
  const link = await shareLink(page);

  await page.emulateMedia({ media: 'print' });
  for (const hidden of [
    page.getByRole('complementary'), caseNav(page), main(page).getByRole('navigation', { name: 'One-pager' }),
    main(page).getByRole('button', { name: 'Download PDF' }), main(page).getByRole('button', { name: 'Make a new link' }),
    main(page).getByRole('heading', { level: 1, name: 'Acme as reseller' }), page.getByRole('link', { name: 'Privacy Policy' }),
  ]) {
    await expect(hidden).toBeHidden();
  }
  await expect(main(page).getByRole('heading', { level: 1, name: PARTNER_HEADING })).toBeVisible();
  await expect(main(page).getByText('Estimates, not a promise of revenue')).toBeVisible();
  // The chart keeps its colors on paper.
  expect(await main(page).getByRole('article').evaluate((el) => getComputedStyle(el).printColorAdjust)).toBe('exact');
  await expectOnePage(page, 'The partner’s one-pager');
  await page.emulateMedia({ media: 'screen' });

  await page.goto(`${sharePath(caseId)}?show=ours`);
  await expect(main(page).getByText('Internal · not for Acme')).toBeVisible();
  await page.emulateMedia({ media: 'print' });
  await expect(main(page).getByRole('button', { name: 'Download PDF' })).toBeHidden();
  await expect(main(page).getByText('Internal: download it and send it to your manager. It has no link.')).toBeHidden();
  await expect(main(page).getByText(/^Internal\. Prepared for .+ leadership\.$/)).toBeVisible();
  await expectOnePage(page, 'Our one-pager');
  await page.emulateMedia({ media: 'screen' });

  // The partner's page prints its one-pager alone too.
  const { context, partner } = await partnerVisitor(browser);
  await partner.goto(link);
  await expect(partner.getByRole('heading', { level: 1 })).toHaveText(PARTNER_HEADING);
  await partner.emulateMedia({ media: 'print' });
  await expect(partner.getByRole('banner')).toBeHidden();
  await expect(partner.getByRole('button', { name: 'Download PDF' })).toBeHidden();
  await expectOnePage(partner, 'The partner’s page');
  await context.close();
});

test('at 375 px the Share tab and the partner’s page fit without sideways scroll', async ({ page, browser }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { acmePartnerIds } = await signInWithSample(page, 'Case Phone Share');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(sharePath(caseId));
  await expect(main(page).getByRole('heading', { level: 1, name: PARTNER_HEADING })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  const link = await shareLink(page);
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto(`${sharePath(caseId)}?show=ours`);
  await expect(main(page).getByText('Internal · not for Acme')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const partner = await context.newPage();
  await partner.goto(link);
  await expect(partner.getByRole('heading', { level: 1 })).toHaveText(PARTNER_HEADING);
  expect(await noSidewaysScroll(partner)).toBe(true);
  await context.close();
});

test('a case is named as Partners names the partner: a rename there reaches the case page, its card and the partner’s link', async ({ page, browser }) => {
  const { acmeAccountId, acmePartnerIds } = await signInWithSample(page, 'Case Renamed');
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'exampleCase', partnerId: acmePartnerIds!.reseller });
  await page.goto(sharePath(caseId));
  const link = await shareLink(page);

  // The company renamed on its partner page (owner, 2026-10-30: one name everywhere).
  await page.goto(`/partners/${acmeAccountId}?type=reseller`);
  await main(page).getByRole('heading', { level: 1 }).getByRole('button', { name: 'Company: Acme' }).click();
  await main(page).getByRole('textbox', { name: 'Company' }).fill('Acme Group');
  // The rename's own save: the partner page's areas load with server actions too, and may answer first.
  const renamed = actionAnswer(page, '"Acme Group"');
  await main(page).getByRole('textbox', { name: 'Company' }).press('Enter');
  await renamed;

  await page.goto(offerPath(caseId));
  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme Group as reseller' })).toBeVisible();
  await expect(caseTab(page, /^1\. Offer to Acme Group /)).toHaveAttribute('aria-current', 'page');
  await expect(main(page).getByRole('link', { name: 'Back to Acme Group' })).toBeVisible();
  await caseTab(page, /^2\. Partner case/).click();
  await expect(main(page).getByRole('heading', { level: 2, name: /is worth to Acme Group$/ })).toBeVisible();
  // The case has no field of its own for the name.
  await expect(main(page).getByRole('textbox', { name: 'Company' })).toHaveCount(0);
  await expect(box(page, 'Partner type')).toHaveValue('Reseller');

  await page.goto('/business-cases');
  await expect(main(page).getByRole('article', { name: 'Acme Group as reseller' })).toBeVisible();

  const visitor = await partnerVisitor(browser);
  await visitor.partner.goto(link);
  await expect(visitor.partner.getByRole('heading', { level: 1 })).toHaveText(/^What partnering with .+ is worth to Acme Group$/);
  await visitor.context.close();
});

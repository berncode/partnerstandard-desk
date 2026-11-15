import { expect, test, type Page } from '@playwright/test';
import { actionAnswer } from './saves';

// Plan 6, task 7: markets feed programs, partners join them (spec 4.1 to 4.4), and Review Focus 1 and 2 on screen.

/** The sample book's partners, in /api/test-seed's order. */
const SAMPLE = { northwind: 0, fabrikam: 1, litware: 4, tailspin: 5 } as const;

interface Seeded { partnerIds: string[]; accountIds: string[]; marketIds: string[]; programId?: string }

/** Signs a new test user in, seeds the sample book (Austria has a hypothesis that holds), and answers its ids. */
async function signInWithSample(page: Page, name: string, body: Record<string, unknown> = {}): Promise<Seeded> {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=/partners`);
  await expect(page).toHaveURL(/\/partners/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', ...body } });
  expect(seeded.ok()).toBe(true);
  return seeded.json() as Promise<Seeded>;
}

const main = (page: Page) => page.getByRole('main');
const region = (page: Page, name: string) => main(page).getByRole('region', { name });
const status = (page: Page) => main(page).getByRole('status');
/** The open partner type's Program card. */
const programCard = (page: Page) => page.getByRole('tabpanel').getByRole('region', { name: 'Program' });
const members = (page: Page) => region(page, 'Partners and markets');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
/**
 * A server action that only reads, by its arguments: the partner page's areas (the MAP, Reviews and business cases)
 * load with `{ partnerId }` and load again when a save changes the stage, the signing or the MAP; the program card reads
 * its levels with `{ programIds }`; a market page reads its market by its id alone. Any of them can answer first.
 */
const READ_ONLY = /^\[(\{"partnerId":"[^"]*"\}|\{"programIds":\[[^\]]*\]\}|"[^"]*")\]$/;
/** Resolves once the next save (a server action that isn't a read) has answered. Start it before the change that saves. */
const nextSave = (page: Page) => page.waitForResponse((r) => {
  const request = r.request();
  return request.method() === 'POST' && request.headers()['next-action'] !== undefined && !READ_ONLY.test(request.postData() ?? '');
});

/** Marks the open partner type signed, past the MAP advice; answers the dialog for what comes before. */
async function markSigned(page: Page, before?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>) {
  await page.getByRole('button', { name: 'Mark signed' }).click();
  const dialog = page.getByRole('dialog', { name: /^Mark .* signed$/ });
  if (before) await before(dialog);
  await dialog.getByRole('button', { name: 'Mark signed' }).click();
  const saved = nextSave(page);
  await dialog.getByRole('button', { name: 'Go ahead anyway' }).click();
  await saved;
  await expect(dialog).toBeHidden();
}

test('Start from a market fills the four fields and links the market; its Feeds program lists only programs of its type', async ({ page }) => {
  const { marketIds } = await signInWithSample(page, 'Market Starter', { valuePoints: true });
  await page.goto('/programs/new');
  await main(page).getByRole('button', { name: /^Reseller/ }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'How do you want to start?' })).toBeVisible();
  // Germany has no hypothesis that holds: only Austria is offered.
  await expect(main(page).getByRole('button', { name: /^Start from/ })).toHaveCount(1);
  await main(page).getByRole('button', { name: /^Start from Austria · Reseller/ }).click();
  await expect(page).toHaveURL(/\/programs\/pg_[0-9a-z]{10}\/why$/);
  const programId = new URL(page.url()).pathname.split('/')[2]!;
  await expect(main(page).getByText('Reseller · Austria program · step 1 of 5')).toBeVisible();
  await expect(main(page).getByRole('textbox', { name: 'Reason 1' })).toHaveValue('Leads from us in your region');
  await expect(main(page).getByRole('textbox', { name: 'Reason 2' })).toHaveValue('A product your customers renew');
  await main(page).getByRole('navigation', { name: 'Program steps' }).getByRole('link', { name: 'Basics' }).click();
  await expect(main(page).getByLabel(/^Focus/)).toHaveValue('Austria');
  await expect(main(page).getByLabel('Ideal partner')).toHaveValue('Mid-size IT resellers');
  await expect(main(page).getByLabel('Ideal customer')).toHaveValue('Our customers');
  // The page lists the market that feeds it.
  await expect(members(page)).toContainText('Registered: 0 · Preferred: 0');
  await expect(members(page).getByRole('link', { name: 'Austria · Reseller' })).toHaveAttribute('href', `/markets/${marketIds[0]}`);

  // A program of another type is never offered to a reseller market.
  // With no Distributor program to copy and no Distributor market, it is made fresh at once.
  await page.goto('/programs/new');
  await main(page).getByRole('button', { name: /^Distributor/ }).click();
  await expect(main(page).getByText('Distributor program · step 1 of 5')).toBeVisible();

  await page.goto(`/markets/${marketIds[0]}?tab=hypothesis`);
  const feeds = main(page).getByRole('combobox', { name: 'Feeds program' });
  await expect(feeds).toHaveValue(programId);
  await expect(feeds.getByRole('option')).toHaveText(['No program', 'Reseller · Austria']);
  await expect(main(page).getByRole('link', { name: 'Open program' })).toHaveAttribute('href', `/programs/${programId}/why`);
});

test('Mark signed proposes the program the partner’s market feeds; Program and Level on the tab; moving down asks first', async ({ page }) => {
  const { accountIds, programId, marketIds } = await signInWithSample(page, 'Program Joiner', { feedingProgram: true });
  await page.goto(`/partners/${accountIds[SAMPLE.northwind]}`);
  await expect(programCard(page).getByLabel('Program')).toHaveValue('');
  await markSigned(page, async (dialog) => {
    await expect(dialog.getByLabel('Program')).toHaveValue(programId!);
    await expect(dialog).toContainText('Proposed because Austria · Reseller feeds it.');
    await expect(dialog).toContainText('The partner joins at the starting level. You can change this later.');
  });
  await expect(programCard(page).getByLabel('Program')).toHaveValue(programId!);
  await expect(programCard(page).getByLabel('Level')).toHaveValue('reg');
  await expect(programCard(page).getByLabel('Level').getByRole('option')).toHaveText(['Registered', 'Preferred']);

  // The level's own save: the signing and the program join may still be saving, and the next save to answer is theirs.
  let saved = actionAnswer(page, '"level":"pref"');
  await programCard(page).getByLabel('Level').selectOption({ label: 'Preferred' });
  await saved;
  await programCard(page).getByLabel('Level').selectOption({ label: 'Registered' });
  const confirm = page.getByRole('dialog', { name: 'Move Northwind Consulting to Registered?' });
  await expect(confirm).toContainText('Registered is the starting level. The partner no longer gets what Preferred partners get.');
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(programCard(page).getByLabel('Level')).toHaveValue('pref');
  await page.reload();
  await expect(programCard(page).getByLabel('Level')).toHaveValue('pref');
  await programCard(page).getByLabel('Level').selectOption({ label: 'Registered' });
  saved = nextSave(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Move to Registered' }).click();
  await saved;
  await page.reload();
  await expect(programCard(page).getByLabel('Level')).toHaveValue('reg');

  // The program's page counts it by level, links to its tab, and lists the market that feeds it.
  await programCard(page).getByRole('link', { name: 'Open program' }).click();
  await expect(members(page)).toContainText('Registered: 1 · Preferred: 0');
  await expect(members(page).getByRole('link', { name: 'Northwind Consulting' }))
    .toHaveAttribute('href', `/partners/${accountIds[SAMPLE.northwind]}?type=reseller`);
  await expect(members(page).getByRole('link', { name: 'Austria · Reseller' })).toHaveAttribute('href', `/markets/${marketIds[0]}`);
  await members(page).getByRole('link', { name: 'Northwind Consulting' }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${accountIds[SAMPLE.northwind]}\\?type=reseller$`));
});

test('the proposal can be cleared, and a market set to feed a program proposes it', async ({ page }) => {
  const { accountIds, marketIds, programId } = await signInWithSample(page, 'Program Clearer', { feedingProgram: true });
  // Germany feeds the program too, set on its page.
  await page.goto(`/markets/${marketIds[1]}?tab=hypothesis`);
  const saved = nextSave(page);
  await main(page).getByRole('combobox', { name: 'Feeds program' }).selectOption({ label: 'Reseller' });
  await saved;

  await page.goto(`/partners/${accountIds[SAMPLE.fabrikam]}`);
  await markSigned(page, async (dialog) => {
    await expect(dialog.getByLabel('Program')).toHaveValue(programId!);
    await expect(dialog).toContainText('Proposed because Germany · Reseller feeds it.');
    await dialog.getByLabel('Program').selectOption({ label: 'No program' });
    await expect(dialog).not.toContainText('Proposed because');
  });
  await page.reload();
  await expect(programCard(page).getByLabel('Program')).toHaveValue('');
  await expect(programCard(page).getByLabel('Level')).toHaveCount(0);
});

test('the Partners list has a Program column and filters by program', async ({ page }) => {
  await signInWithSample(page, 'Program Filter', { feedingProgram: true, joinProgram: true });
  await page.goto('/partners?view=active');
  const rows = main(page).getByTestId('partner-row');
  await expect(main(page).getByRole('columnheader', { name: 'Program' })).toBeVisible();
  const programOf = (company: string) => rows.filter({ hasText: company }).locator('td[data-label="Program"]');
  await expect(programOf('Tailspin Solutions')).toHaveText('Reseller');
  await expect(programOf('Wingtip Digital')).toHaveText('No program');

  await main(page).getByRole('combobox', { name: 'Program' }).selectOption({ label: 'Reseller' });
  await expect(page).toHaveURL(/program=pg_/);
  await expect(rows).toHaveCount(1);
  await expect(rows).toContainText('Tailspin Solutions');
  await main(page).getByRole('combobox', { name: 'Program' }).selectOption({ label: 'No program' });
  await expect(rows.filter({ hasText: 'Tailspin Solutions' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Wingtip Digital' })).toHaveCount(1);
  await page.reload();
  await expect(main(page).getByRole('combobox', { name: 'Program' })).toHaveValue('none');
});

test('Review Focus 1 and 2: a used program can’t be deleted, and Preferred can’t go while a partner sits at it', async ({ page }) => {
  const { accountIds, programId } = await signInWithSample(page, 'Program Keeper', { feedingProgram: true, joinProgram: true });
  // Tailspin moves up to Preferred.
  await page.goto(`/partners/${accountIds[SAMPLE.tailspin]}`);
  const saved = nextSave(page);
  await programCard(page).getByLabel('Level').selectOption({ label: 'Preferred' });
  await saved;

  await page.goto(`/programs/${programId}/basics`);
  await main(page).getByRole('button', { name: 'Delete program' }).click();
  const dialog = page.getByRole('dialog', { name: /^Delete / });
  await dialog.getByRole('button', { name: 'Delete program' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('This program still has 1 partner and 1 market. Move its partners and markets to another program first.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(new RegExp(`/programs/${programId}/basics$`));

  await main(page).getByRole('navigation', { name: 'Program steps' }).getByRole('link', { name: 'Preferred' }).click();
  await main(page).getByRole('button', { name: 'Remove this level' }).click();
  await expect(status(page)).toHaveText('1 partner is at Preferred. Move it to Registered first.', { timeout: 10_000 });
  await page.reload();
  await expect(main(page).getByRole('button', { name: 'Remove this level' })).toBeVisible();
});

test('a program whose file was trashed by hand shows as gone on the partner and the market, and can be replaced', async ({ page }) => {
  const { accountIds, marketIds, programId } = await signInWithSample(page, 'Program Loser', { feedingProgram: true, joinProgram: true });
  const trashed = await page.request.post('/api/test-seed', { data: { fixture: 'trashProgram', programId } });
  expect(trashed.ok()).toBe(true);

  await page.goto(`/partners/${accountIds[SAMPLE.tailspin]}`);
  await expect(programCard(page).getByLabel('Program').locator('option:checked')).toHaveText('A deleted program');
  await expect(programCard(page)).toContainText('That program is gone. Pick another one, or No program.');
  await expect(programCard(page).getByLabel('Level')).toHaveCount(0);
  const saved = nextSave(page);
  await programCard(page).getByLabel('Program').selectOption({ label: 'No program' });
  await saved;
  await page.reload();
  await expect(programCard(page).getByLabel('Program')).toHaveValue('');

  await page.goto(`/markets/${marketIds[0]}?tab=hypothesis`);
  await expect(main(page).getByRole('combobox', { name: 'Feeds program' }).locator('option:checked')).toHaveText('A deleted program');
  await expect(main(page)).toContainText('That program is gone. Pick another one, or No program.');
});

test('two programs with the same type and focus are told apart by their names', async ({ page }) => {
  await signInWithSample(page, 'Twin Maker');
  await page.goto('/programs/new');
  await main(page).getByRole('button', { name: /^Reseller/ }).click();
  await main(page).getByRole('button', { name: /^Start fresh/ }).click();
  await expect(main(page).getByText('Reseller program · step 1 of 5')).toBeVisible();
  await page.goto('/programs/new');
  await main(page).getByRole('button', { name: /^Reseller/ }).click();
  await main(page).getByRole('button', { name: /^Copy your Reseller program/ }).click();
  await expect(main(page).getByText(/^Reseller · .+ · step 1 of 5$/)).toBeVisible();
  await page.goto('/programs');
  await expect(main(page).getByRole('article', { name: /^Reseller · / })).toHaveCount(2);
});

test('at 375 px the partner tab, the market and the program page fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { accountIds, marketIds, programId } = await signInWithSample(page, 'Phone Joiner', { feedingProgram: true, joinProgram: true });
  await page.goto(`/partners/${accountIds[SAMPLE.tailspin]}`);
  await expect(programCard(page).getByLabel('Level')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto(`/markets/${marketIds[0]}?tab=hypothesis`);
  await expect(main(page).getByRole('combobox', { name: 'Feeds program' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto(`/programs/${programId}/why`);
  await expect(members(page)).toContainText('Registered: 1 · Preferred: 0');
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto('/partners?view=active');
  await expect(main(page).getByTestId('partner-row').first()).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

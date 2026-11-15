import { expect, test, type Page } from '@playwright/test';
import { byEdition } from './edition';

async function signIn(page: Page, name: string, next = '/company-facts') {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=${next}`);
  await expect(page).toHaveURL(new RegExp(`${next}$`));
}

const main = (page: Page) => page.getByRole('main');
const card = (page: Page, name: string) => main(page).getByRole('region', { name });
const status = (page: Page) => main(page).getByRole('status');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('the sidebar has Programs under Ecosystem and Company facts at the bottom; the Programs page lists the programs', async ({ page }) => {
  await signIn(page, 'Program Lister', '/partners');
  const sidebar = page.getByRole('complementary');
  const links = sidebar.getByRole('navigation', { name: 'Main menu' }).getByRole('link');
  await expect(links).toHaveText(['This week', 'Partners', 'Markets', 'Programs', 'Business cases', 'Mutual Action Plans', 'Business reviews', 'How it works', 'Call guide', 'Company facts', 'Settings']);

  await sidebar.getByRole('link', { name: 'Programs', exact: true }).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(main(page).getByRole('heading', { level: 2, name: 'No programs yet' })).toBeVisible();

  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'programs' } });
  expect(seeded.ok()).toBe(true);
  const { programIds } = (await seeded.json()) as { programIds: string[] };
  await page.reload();
  // Oldest first, named by type and focus, each with its partners per level and the markets that feed it.
  const cards = main(page).getByRole('article');
  await expect(cards).toHaveCount(2);
  const dach = main(page).getByRole('article', { name: 'Reseller · DACH' });
  await expect(dach.getByRole('link', { name: 'Reseller · DACH', exact: true })).toHaveAttribute('href', `/programs/${programIds[1]}/why`);
  await expect(dach).toContainText('Registered: 0');
  await expect(dach).toContainText('No market feeds this program yet.');
  await expect(sidebar.getByRole('link', { name: 'Programs', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(main(page).getByRole('link', { name: 'Add a program' })).toHaveAttribute('href', '/programs/new');

  // Copy makes a copy of the same type and opens it; the page then lists three.
  await dach.getByRole('button', { name: 'Copy Reseller · DACH' }).click();
  await expect(page).toHaveURL(/\/programs\/pg_[0-9a-z]{10}\/why$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Why join' })).toBeVisible();
  await sidebar.getByRole('link', { name: 'Programs', exact: true }).click();
  await expect(cards).toHaveCount(3);

  // The copy has no focus: the two Reseller programs are told apart by their names.
  const copy = main(page).getByRole('article', { name: 'Reseller · Reseller Program (copy)', exact: true });
  await expect(main(page).getByRole('article', { name: 'Reseller · Reseller Program', exact: true })).toBeVisible();
  // Delete asks first, by the name shown on the card, and the card leaves.
  await copy.getByRole('button', { name: 'Delete Reseller · Reseller Program (copy)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Reseller · Reseller Program (copy)?' });
  await dialog.getByRole('button', { name: 'Delete program' }).click();
  await expect(cards).toHaveCount(2);
  await expect(copy).toHaveCount(0);
});

test('Company facts saves the five cards as you type and says what a typical customer brings over five years', async ({ page }) => {
  await signIn(page, 'Facts Keeper');
  await expect(main(page).getByRole('heading', { level: 1, name: 'Company facts' })).toBeVisible();
  await expect(main(page).getByText('Shared by all programs of this company')).toBeVisible();
  for (const name of ['The company', 'A typical customer', 'What selling direct costs you', 'Deal registration', 'The customer and the handover']) {
    await expect(card(page, name)).toBeVisible();
  }
  // The name lives in Settings.
  await expect(card(page, 'The company')).toContainText('Your company');
  await expect(card(page, 'The company').getByRole('link', { name: 'Change it in Settings' })).toHaveAttribute('href', '/settings');
  await expect(card(page, 'What selling direct costs you')).toContainText('Fill in both to compare partners with selling direct.');

  await page.getByLabel('Pays every year').fill('18000');
  await page.getByLabel('Pays once').fill('6000');
  await page.getByLabel('Customers who renew').fill('90');
  await expect(card(page, 'A typical customer')).toContainText(
    'A typical customer brings you €79,712 over five years: €6,000 once, then €18,000 a year while they stay.',
  );
  await page.getByLabel('Sales and marketing, last year').fill('2600000');
  await page.getByLabel('Revenue, last year').fill('6500000');
  await expect(card(page, 'What selling direct costs you')).toContainText('Selling direct costs you €0.40 of every €1 you bring in.');
  await page.getByLabel('A registered deal is protected').fill('60');
  await page.getByLabel('When two register the same customer').selectOption({ label: 'You decide, case by case' });
  await page.getByLabel('Partner paid in full if your own team closes the deal').uncheck();
  await page.getByLabel('Who keeps the customer').fill('Partner-sourced customers stay with the partner.');
  await page.getByLabel('Handover to your sales team').fill('Our sales team joins after the deal is registered.');
  await page.getByLabel('Currency').selectOption('USD');
  await expect(card(page, 'A typical customer')).toContainText('A typical customer brings you $79,712 over five years');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  await expect(page.getByLabel('Currency')).toHaveValue('USD');
  await expect(page.getByLabel('Pays every year')).toHaveValue('18,000');
  await expect(page.getByLabel('Pays once')).toHaveValue('6,000');
  await expect(page.getByLabel('Customers who renew')).toHaveValue('90');
  await expect(page.getByLabel('Sales and marketing, last year')).toHaveValue('2,600,000');
  await expect(page.getByLabel('Revenue, last year')).toHaveValue('6,500,000');
  await expect(page.getByLabel('A registered deal is protected')).toHaveValue('60');
  await expect(page.getByLabel('When two register the same customer')).toHaveValue('case');
  await expect(page.getByLabel('Partner paid in full if your own team closes the deal')).not.toBeChecked();
  await expect(page.getByLabel('Who keeps the customer')).toHaveValue('Partner-sourced customers stay with the partner.');
  await expect(page.getByLabel('Handover to your sales team')).toHaveValue('Our sales team joins after the deal is registered.');
  await expect(card(page, 'A typical customer')).toContainText('A typical customer brings you $79,712 over five years');
});

test('after a hand edit in the sheet the page says so, offers Reload, and never saves over it', async ({ page }) => {
  await signIn(page, 'Hand Editor');
  await expect(page.getByLabel('Pays every year')).toHaveValue('0');
  // Someone types 21,000 into the Company facts sheet; the screen still shows what it read.
  const edited = await page.request.post('/api/test-seed', { data: { fixture: 'handEditFacts' } });
  expect(edited.ok()).toBe(true);

  await page.getByLabel('Pays once').fill('500');
  await expect(status(page)).toHaveText('This was changed somewhere else. Reload to see the latest.', { timeout: 10_000 });
  await page.getByLabel('Pays once').fill('700');
  await main(page).getByRole('button', { name: 'Reload' }).click();
  // The sheet's value is there, and nothing from the screen went over it.
  await expect(page.getByLabel('Pays every year')).toHaveValue('21,000');
  await expect(page.getByLabel('Pays once')).toHaveValue('0');
  await expect(status(page)).toHaveText('');
});

test('Company facts has Our figures, marked internal, and saves our gross margin, our costs and our default cost lines as you type', async ({ page }) => {
  await signIn(page, 'Facts Ours');
  const ours = card(page, 'Our figures');
  await expect(ours).toBeVisible();
  await expect(ours).toContainText('Internal. A new case copies these. They never reach a partner.');
  // BC's figures form and our default cost lines, each number with where it comes from.
  for (const name of ['Your gross margin', 'Finding a lead', 'Closing a deal', 'Support level 1', 'Support level 2']) {
    await expect(ours.getByRole('textbox', { name, exact: true })).toBeVisible();
  }
  await expect(ours.getByRole('combobox', { name: 'Your gross margin source' })).toBeVisible();

  await ours.getByRole('textbox', { name: 'Your gross margin', exact: true }).fill('70');
  await ours.getByRole('textbox', { name: 'Closing a deal', exact: true }).fill('6000');
  await ours.getByRole('button', { name: 'Add a cost every year' }).click();
  await ours.getByRole('textbox', { name: 'Every year, line 1', exact: true }).fill('Partner manager time');
  await ours.getByRole('textbox', { name: 'Every year, line 1 amount', exact: true }).fill('30000');
  await ours.getByRole('combobox', { name: 'Every year, line 1 source' }).selectOption({ label: 'Finance' });
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  await page.reload();
  const again = card(page, 'Our figures');
  await expect(again.getByRole('textbox', { name: 'Your gross margin', exact: true })).toHaveValue('70');
  await expect(again.getByRole('textbox', { name: 'Closing a deal', exact: true })).toHaveValue('6,000');
  await expect(again.getByRole('textbox', { name: 'Every year, line 1', exact: true })).toHaveValue('Partner manager time');
  await expect(again.getByRole('textbox', { name: 'Every year, line 1 amount', exact: true })).toHaveValue('30,000');
  await expect(again.getByRole('combobox', { name: 'Every year, line 1 source' })).toHaveValue('finance');
});

test('at 375 px Company facts fits without sideways scroll, saves, and the phone menu lists Programs', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, 'Phone Facts');
  await expect(main(page).getByRole('heading', { level: 1, name: 'Company facts' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByLabel('Pays every year').fill('4800');
  await expect(card(page, 'A typical customer')).toContainText('A typical customer brings you €4,800 over five years');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  expect(await noSidewaysScroll(page)).toBe(true);
  // Our figures and its cost lines fit too.
  await card(page, 'Our figures').getByRole('button', { name: 'Add a cost every year' }).click();
  await expect(card(page, 'Our figures').getByRole('textbox', { name: 'Every year, line 1', exact: true })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.getByRole('button', { name: 'Open menu' }).click();
  const panel = page.getByRole('dialog', { name: 'Main menu' });
  for (const name of ['Company facts', 'Programs']) {
    await expect(panel.getByRole('link', { name, exact: true })).toBeVisible();
  }
});

// ---------------------------------------------------------------------------------------------------------------------
// Add a program, the five steps, Program Sheet and Public page (plan 6, task 6)

const tabs = (page: Page) => main(page).getByRole('navigation', { name: 'Program steps' });
const programIdOf = (page: Page) => new URL(page.url()).pathname.split('/')[2]!;

/** A new program has no reasons yet: adds the first and types it. */
async function addReason(page: Page, text: string) {
  await main(page).getByRole('button', { name: 'Add a reason' }).click();
  await main(page).getByRole('textbox', { name: 'Reason 1' }).fill(text);
}

/** Adds a fresh program of `type` for a user with none yet, and waits for step 1. Answers its id. */
async function addFirst(page: Page, type = 'Reseller'): Promise<string> {
  await expect(main(page).getByRole('heading', { level: 1, name: 'Add a program' })).toBeVisible();
  await main(page).getByRole('button', { name: new RegExp(`^${type}`) }).click();
  await expect(page).toHaveURL(/\/programs\/pg_[0-9a-z]{10}\/why$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Why join' })).toBeVisible();
  return programIdOf(page);
}

test('Add a program grays out the types without a program, with their reasons; Start fresh opens step 1', async ({ page }) => {
  await signIn(page, 'Program Starter', '/programs/new');
  await expect(main(page).getByText('Pick the partner type. You can run several programs for the same type')).toBeVisible();
  const reasons: Record<string, string> = {
    OEM: 'Not covered: OEM deals are negotiated one by one, not run as a standard program.',
    Technology: 'Not covered: usually negotiated one by one. May come later for app marketplaces.',
    Data: 'Not covered: usually negotiated one by one.',
    Integration: 'Not covered: usually negotiated one by one. May come later for app marketplaces.',
    Other: 'Not covered: a partnership that fits none of the types has no standard program.',
  };
  for (const [type, reason] of Object.entries(reasons)) {
    const button = main(page).getByRole('button', { name: new RegExp(`^${type}`) });
    await expect(button).toBeDisabled();
    await expect(button).toContainText(reason);
  }
  await addFirst(page);
  await expect(main(page).getByText('Reseller program · step 1 of 5')).toBeVisible();
  // Programs is the place you are in.
  await expect(page.getByRole('complementary').getByRole('link', { name: 'Programs', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(tabs(page).getByRole('link', { name: 'Why join' })).toHaveAttribute('aria-current', 'page');
});

test('each step saves as you type, with Back and Next, and the answers are there after a reload', async ({ page }) => {
  await signIn(page, 'Step Walker', '/programs/new');
  const id = await addFirst(page);
  await addReason(page, 'Leads from us in your region');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  await main(page).getByRole('link', { name: 'Next: Basics' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Basics' })).toBeVisible();
  await main(page).getByLabel('Program lead').fill('Anna Berger, Head of Partnerships');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  await main(page).getByRole('link', { name: 'Next: Registered' }).click();
  await main(page).getByLabel('Name of the level').fill('Member');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  // The tab row and Next follow the new name.
  await expect(tabs(page).getByRole('link', { name: 'Member' })).toHaveAttribute('aria-current', 'page');

  await main(page).getByRole('link', { name: 'Next: Preferred' }).click();
  await main(page).getByRole('checkbox', { name: 'Quarterly business review' }).click();
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  await main(page).getByRole('link', { name: 'Next: Money' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Money' })).toBeVisible();
  await main(page).getByLabel('Partner manager time').fill('30000');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  await main(page).getByRole('link', { name: 'Back' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Preferred' })).toBeVisible();

  await page.goto(`/programs/${id}/why`);
  await expect(main(page).getByRole('textbox', { name: 'Reason 1' })).toHaveValue('Leads from us in your region');
  await tabs(page).getByRole('link', { name: 'Basics' }).click();
  await expect(main(page).getByLabel('Program lead')).toHaveValue('Anna Berger, Head of Partnerships');
  await tabs(page).getByRole('link', { name: 'Member' }).click();
  await expect(main(page).getByLabel('Name of the level')).toHaveValue('Member');
  await tabs(page).getByRole('link', { name: 'Preferred' }).click();
  await expect(main(page).getByRole('checkbox', { name: 'Quarterly business review' })).not.toBeChecked();
  await tabs(page).getByRole('link', { name: 'Money' }).click();
  await expect(main(page).getByLabel('Partner manager time')).toHaveValue('30,000');
});

test('Money shows the cost check; with empty Company facts, Money and the Program Sheet say to fill in both (Review Focus 4)', async ({ page }) => {
  await signIn(page, 'Empty Facts', '/programs/new');
  const id = await addFirst(page);
  await page.goto(`/programs/${id}/money`);
  const glance = card(page, 'At a glance');
  await expect(glance).toContainText('Fill in both to compare partners with selling direct.');
  await expect(glance).toContainText('Fill in what a typical customer pays under Company facts to see what partners cost you.');
  await expect(glance).not.toContainText(/NaN|Infinity|€0(?![.,\d])|€0\.00/);

  await tabs(page).getByRole('link', { name: 'Program Sheet' }).click();
  const sheet = main(page).getByRole('article');
  await expect(sheet).toContainText('Fill in both to compare partners with selling direct.');
  await expect(sheet).not.toContainText(/NaN|Infinity|€0(?![.,\d])|€0\.00/);

  // With a typical customer and the direct figures, the cost check compares.
  await page.goto('/company-facts');
  await page.getByLabel('Pays every year').fill('18000');
  await page.getByLabel('Sales and marketing, last year').fill('2600000');
  await page.getByLabel('Revenue, last year').fill('6500000');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  await page.goto(`/programs/${id}/money`);
  await expect(card(page, 'At a glance')).toContainText(/Selling direct costs you €0\.40\./);
  await expect(card(page, 'At a glance')).not.toContainText('Fill in both');
});

test('a copy keeps the answers', async ({ page }) => {
  await signIn(page, 'Program Copier', '/programs/new');
  await addFirst(page);
  await addReason(page, 'A product your customers renew');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });

  await page.goto('/programs/new');
  // Only programs of the picked type can be copied: a Distributor starts fresh at once.
  await main(page).getByRole('button', { name: /^Reseller/ }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'How do you want to start?' })).toBeVisible();
  await main(page).getByRole('button', { name: /^Copy your Reseller program/ }).click();
  await expect(page).toHaveURL(/\/programs\/pg_[0-9a-z]{10}\/why$/);
  await expect(main(page).getByRole('textbox', { name: 'Reason 1' })).toHaveValue('A product your customers renew');
  await page.goto('/programs/new');
  await main(page).getByRole('button', { name: /^Distributor/ }).click();
  await expect(main(page).getByText('Distributor program · step 1 of 5')).toBeVisible();
  await expect(main(page).getByRole('textbox', { name: 'Reason 1' })).toHaveCount(0);
});

test('the Program Sheet prints alone and the Public page copies its text', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await signIn(page, 'Sheet Printer', '/programs/new');
  const id = await addFirst(page);
  await addReason(page, 'Leads from us in your region');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  await tabs(page).getByRole('link', { name: 'Program Sheet' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Program Sheet' })).toBeVisible();
  const sheet = main(page).getByRole('article');
  await expect(sheet).toContainText('Partner Program Sheet · internal');
  await expect(sheet).toContainText('Leads from us in your region');
  await expect(main(page).getByRole('button', { name: 'Download PDF' })).toBeVisible();
  // Opening the sheet rewrote the file's Program Sheet tab.
  await expect.poll(async () => {
    const answer = await page.request.get(`/api/test-seed?programId=${id}`);
    return ((await answer.json()) as { programOutputs: { publicText: string } | null }).programOutputs?.publicText ?? '';
  }, { timeout: 10_000 }).toContain('Leads from us in your region');

  // On paper: the sheet alone, on A4 or Letter (the page margins fit both).
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect(tabs(page)).toBeHidden();
  await expect(main(page).getByRole('button', { name: 'Download PDF' })).toBeHidden();
  await expect(sheet).toBeVisible();
  await page.emulateMedia({ media: 'screen' });

  await tabs(page).getByRole('link', { name: 'Public page' }).click();
  await expect(main(page).getByText('A first draft from your answers. Edit it on your website.')).toBeVisible();
  await main(page).getByRole('button', { name: 'Copy text' }).click();
  await expect(main(page).getByRole('button', { name: 'Copied' })).toBeVisible();
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied).toMatch(/^# /);
  expect(copied).toContain('## Why partners join\n- Leads from us in your region');
});

test('renaming in Basics renames the program on the Programs page; deleting trashes it after a confirmation', async ({ page }) => {
  await signIn(page, 'Program Renamer', '/programs/new');
  const id = await addFirst(page);
  await tabs(page).getByRole('link', { name: 'Basics' }).click();
  await main(page).getByLabel('Program name').fill('Alpine Reseller Program');
  await main(page).getByLabel(/^Focus/).fill('DACH');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  await expect(main(page).getByText('Reseller · DACH program · step 2 of 5')).toBeVisible();
  await page.getByRole('complementary').getByRole('link', { name: 'Programs', exact: true }).click();
  await expect(main(page).getByRole('article', { name: 'Reseller · DACH' })).toBeVisible();

  await page.goto(`/programs/${id}/basics`);
  await main(page).getByRole('button', { name: 'Delete program' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete Alpine Reseller Program?' });
  await expect(dialog).toContainText(byEdition({
    hosted: 'Alpine Reseller Program goes to the trash in your Google Drive. You can restore it from there.',
    database: 'Alpine Reseller Program goes to the trash, where an admin can restore it later.',
  }));
  await dialog.getByRole('button', { name: 'Delete program' }).click();
  await expect(page).toHaveURL(/\/programs$/);
  await expect(main(page).getByRole('heading', { level: 2, name: 'No programs yet' })).toBeVisible();
  await page.goto(`/programs/${id}/why`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'We can’t find that program. It may have been deleted.' })).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Go to Programs' })).toHaveAttribute('href', '/programs');
});

test('after a hand edit in the program sheet the step says so, offers Reload, and never saves over it', async ({ page }) => {
  await signIn(page, 'Program Hand Editor', '/programs/new');
  const id = await addFirst(page);
  const edited = await page.request.post('/api/test-seed', { data: { fixture: 'handEditProgram', programId: id } });
  expect(edited.ok()).toBe(true);
  await addReason(page, 'Typed on the screen');
  await expect(status(page)).toHaveText('This was changed somewhere else. Reload to see the latest.', { timeout: 10_000 });
  await main(page).getByRole('button', { name: 'Reload' }).click();
  // The file's program is back on screen: no reason, as the sheet holds it.
  await expect(main(page).getByRole('textbox', { name: 'Reason 1' })).toHaveCount(0);
  await tabs(page).getByRole('link', { name: 'Basics' }).click();
  await expect(main(page).getByLabel('Program lead')).toHaveValue('Typed in the sheet');
});

// Row issues come from a person typing in the Google sheet; nobody types into a company server's database.
test('an unreadable row of the program sheet shows in the card it belongs to (Google Sheets only: nobody types into the database)', { tag: '@drive-only' }, async ({ page }) => {
  await signIn(page, 'Row Issue Reader', '/programs/new');
  const id = await addFirst(page);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'programRowIssue', programId: id } });
  expect(seeded.ok()).toBe(true);
  await page.reload();
  const why = card(page, 'Why partners join, besides money');
  await expect(why.getByRole('note')).toContainText('Some rows of this program’s sheet need attention');
  await expect(why.getByRole('note')).toContainText('Reason in Reasons row 4 is longer than a cell can hold.');
  // The rest of the program still saves.
  await addReason(page, 'Still saves');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
});

test('a program that isn’t there says so', async ({ page }) => {
  await signIn(page, 'Program Seeker', '/company-facts');
  await page.goto('/programs/pg_zzzzzzzzzz/why');
  await expect(main(page).getByRole('heading', { level: 1, name: 'We can’t find that program. It may have been deleted.' })).toBeVisible();
});

test('at 375 px Programs, Add a program and the steps fit without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, 'Phone Programs', '/programs/new');
  expect(await noSidewaysScroll(page)).toBe(true);
  const id = await addFirst(page);
  for (const screen of ['why', 'basics', 'registered', 'preferred', 'money', 'sheet', 'public']) {
    await page.goto(`/programs/${id}/${screen}`);
    await expect(main(page).getByRole('heading', { level: 1 })).toBeVisible();
    expect(await noSidewaysScroll(page), screen).toBe(true);
  }
  await page.goto(`/programs/${id}/basics`);
  await main(page).getByLabel(/^Focus/).fill('A very long focus for one region of the market, Austria and Switzerland');
  await expect(status(page)).toHaveText('Saved', { timeout: 10_000 });
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto('/programs');
  await expect(main(page).getByRole('article')).toHaveCount(1);
  expect(await noSidewaysScroll(page), 'programs').toBe(true);
});

import { expect, test, type Locator, type Page } from '@playwright/test';
import { actionAnswer } from './saves';

/** The sample book's partners, in /api/test-seed's order. */
const SAMPLE = {
  northwind: 0, fabrikam: 1, contoso: 2, adatum: 3, litware: 4, tailspin: 5, wingtip: 6, lucerne: 9,
} as const;

/** Signs a new test user in, seeds the sample book, and answers its ids. */
async function signInWithSample(page: Page, name = 'Anna', body: Record<string, unknown> = {}) {
  await page.goto(`/api/test-auth?name=${name}&next=/partners`);
  await expect(page).toHaveURL(/\/partners/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', ...body } });
  expect(seeded.ok()).toBe(true);
  return seeded.json() as Promise<{ partnerIds: string[]; accountIds: string[]; marketIds: string[]; acmeAccountId?: string }>;
}

async function openPartner(page: Page, which: keyof typeof SAMPLE) {
  const ids = await signInWithSample(page);
  await page.goto(`/partners/${ids.accountIds[SAMPLE[which]]}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  return ids;
}

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

const stages = (page: Page) => page.getByRole('list', { name: 'Stage' });
const steps = (page: Page) => page.getByRole('group', { name: 'Recruitment step' });
const current = (scope: Locator) => scope.locator('[aria-current="step"]');
const tab = (page: Page, name: string) => page.getByRole('tab', { name });
/** Advice and errors on the page (Next's route announcer is an alert too, outside main). */
const alert = (page: Page) => page.getByRole('main').getByRole('alert');
const header = (page: Page) => page.locator('header').filter({ has: page.getByRole('heading', { level: 1 }) });
/** The open partner type's own header: the advice, the stepper, and closing, signing or the exit. */
const typeHeader = (page: Page) => page.getByRole('tabpanel').getByTestId('type-header');
const section = (page: Page, name: string) => page.getByRole('region', { name });
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('before signing it opens on Recruitment: the header, the five stages, and a step at a time with the advice', async ({ page }) => {
  await openPartner(page, 'northwind');
  await expect(tab(page, 'Reseller')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Northwind Consulting');
  await expect(header(page)).toContainText('northwind.example');

  await expect(stages(page).locator(':scope > li')).toHaveCount(5);
  await expect(stages(page).locator(':scope > li').first()).toContainText('Recruitment');
  await expect(steps(page).getByRole('button')).toHaveText(['Researched', 'Discovery call', 'Qualification', 'MAP']);
  await expect(steps(page).getByRole('button', { name: 'MAP' })).toBeDisabled();
  await expect(page.getByText('Move one step at a time. Mark signed moves a partner to Onboarding.')).toBeVisible();

  // The desk check's advice shows in the header.
  await section(page, 'Desk check').getByRole('group', { name: 'Credibility' }).getByRole('button', { name: /^2:/ }).click();
  await expect(typeHeader(page).getByText('Worth a discovery call')).toBeVisible();

  await steps(page).getByRole('button', { name: 'Discovery call' }).click();
  await expect(current(steps(page))).toHaveText('Discovery call');
  await steps(page).getByRole('button', { name: 'Qualification' }).click();
  await expect(alert(page)).toContainText('Write the partner hypothesis first.');
  // This step's own save: the desk check and Discovery call may still be saving, and the next save to answer is theirs.
  const saved = actionAnswer(page, '"to":"qualification"');
  await page.getByRole('button', { name: 'Go ahead anyway' }).click();
  await saved;
  await expect(current(steps(page))).toHaveText('Qualification');

  await page.reload();
  await expect(current(steps(page))).toHaveText('Qualification');
  await expect(typeHeader(page).getByText('Worth a discovery call')).toBeVisible();
});

test('closing needs Not now or No and a reason, and Reopen brings Mark signed back', async ({ page }) => {
  await openPartner(page, 'contoso');
  await page.getByRole('button', { name: 'Close partner' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close Contoso Partners' });
  await expect(dialog.getByRole('radio', { name: 'Not now' })).toBeChecked();
  await dialog.getByRole('button', { name: 'Close partner' }).click();
  await expect(dialog.getByText('Add a reason.')).toBeVisible();
  await dialog.getByLabel('Reason').fill('Busy with a merger until spring');
  await dialog.getByRole('button', { name: 'Close partner' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByText('Closed as', { exact: true })).toBeVisible();
  await expect(page.getByText('Busy with a merger until spring')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark signed' })).toHaveCount(0);
  await expect(typeHeader(page).getByText('Reopen this partner before you move it.')).toBeVisible();
  await expect(page.getByText('Closed already as Not now.')).toBeVisible();

  await page.getByRole('button', { name: 'Reopen' }).click();
  await expect(page.getByRole('button', { name: 'Mark signed' })).toBeVisible();
  await expect(current(steps(page))).toHaveText('Discovery call');
});

test('Mark signed works from any step, with the MAP advice, and moves the partner to Onboarding and Active', async ({ page }) => {
  await openPartner(page, 'fabrikam');
  await expect(page.getByRole('button', { name: 'Mark signed' })).toBeVisible();
  await page.getByRole('button', { name: 'Mark signed' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark Fabrikam Systems signed' });
  await dialog.getByRole('button', { name: 'Mark signed' }).click();
  await expect(dialog.getByRole('alert')).toContainText("Don't sign the agreement before the MAP is agreed.");
  const saved = nextSave(page);
  await dialog.getByRole('button', { name: 'Go ahead anyway' }).click();
  await saved;
  await expect(dialog).toBeHidden();

  await expect(current(stages(page))).toContainText('Onboarding');
  await expect(page.getByText(/^Signed on \d{1,2} \w{3} \d{4}$/).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark exited' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close partner' })).toHaveCount(0);
  // The steps are history now, and the MAP card shows.
  await expect(steps(page).getByRole('button')).toHaveCount(0);
  await expect(section(page, 'Mutual Action Plan')).toBeVisible();

  await page.getByRole('link', { name: 'Back to Partners' }).click();
  await expect(tab(page, 'Active 3')).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('partner-row').filter({ hasText: 'Fabrikam Systems' })).toContainText('Onboarding');
});

test('after signing a stage moves one back or forward, never back to Recruitment', async ({ page }) => {
  await openPartner(page, 'tailspin');
  await expect(tab(page, 'Reseller')).toHaveAttribute('aria-selected', 'true');
  await expect(stages(page).getByRole('button', { name: 'Recruitment' })).toHaveCount(0);
  await expect(stages(page).getByRole('button', { name: 'Expansion' })).toBeDisabled();
  await expect(page.getByText("Move one stage at a time. A signed partner can't go back to recruitment.")).toBeVisible();

  await stages(page).getByRole('button', { name: 'Growth' }).click();
  await expect(current(stages(page))).toContainText('Growth');
  await stages(page).getByRole('button', { name: 'Expansion' }).click();
  await stages(page).getByRole('button', { name: 'Exit' }).click();
  await expect(current(stages(page))).toContainText('Exit');
  await expect(page.getByText("The exit is under way. Use Mark exited when it’s done.")).toBeVisible();
  const saved = nextSave(page);
  await stages(page).getByRole('button', { name: 'Expansion' }).click();
  await saved;
  await expect(current(stages(page))).toContainText('Expansion');
});

test('Mark exited needs a date not before signing and a reason, and moves the partner to Closed', async ({ page }) => {
  await openPartner(page, 'wingtip');
  await page.getByRole('button', { name: 'Mark exited' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark Wingtip Digital exited' });
  await dialog.getByLabel('Exit date').fill('2026-09-01');
  await dialog.getByLabel('Reason').fill('They stopped selling in this region');
  await dialog.getByRole('button', { name: 'Mark exited' }).click();
  await expect(dialog.getByText("The exit date can't be before the signing date.")).toBeVisible();
  await dialog.getByLabel('Exit date').fill('2026-10-25');
  const saved = nextSave(page);
  await dialog.getByRole('button', { name: 'Mark exited' }).click();
  await saved;
  await expect(dialog).toBeHidden();

  await expect(page.getByText('Exited on 25 Oct 2026').first()).toBeVisible();
  await expect(page.getByText('They stopped selling in this region')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark exited' })).toHaveCount(0);
  await expect(stages(page).getByRole('button')).toHaveCount(0);

  await page.getByRole('link', { name: 'Back to Partners' }).click();
  await tab(page, 'Closed 4').click();
  await expect(page.getByTestId('partner-row').filter({ hasText: 'Wingtip Digital' })).toContainText('Exited on 25 Oct 2026');
});

test('Overview: details, each market with its own partner hypothesis, and people', async ({ page }) => {
  await openPartner(page, 'tailspin');
  await expect(header(page)).toContainText('tailspin.example');
  const links = page.getByTestId('market-link');
  await expect(links).toHaveCount(2);
  await expect(links.filter({ hasText: 'Austria · Reseller' })).toContainText('Mid-size IT resellers');
  await expect(links.filter({ hasText: 'Austria · Reseller' })).toContainText('Holds');
  await expect(links.filter({ hasText: 'Germany · Reseller' })).toContainText('No partner hypothesis picked yet.');
  await expect(page.getByText('No other market for Reseller yet.')).toBeVisible();

  const people = section(page, 'People');
  await people.getByRole('button', { name: 'Add person' }).click();
  await people.getByLabel('Name').fill('Eva Roth');
  await people.getByLabel('Role').selectOption({ label: 'Seller' });
  await people.getByRole('button', { name: 'Add', exact: true }).click();
  await people.getByRole('checkbox', { name: 'Active seller' }).check();
  await expect(people.getByText('1 active seller')).toBeVisible();
});

test('Add to a market links a market of the same type, and its partner hypotheses can then be picked', async ({ page }) => {
  await openPartner(page, 'northwind');
  await expect(page.getByTestId('market-link')).toHaveCount(1);
  await page.getByLabel('Add to a market').selectOption({ label: 'Germany · Reseller' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.getByTestId('market-link')).toHaveCount(2);
  await expect(page.getByTestId('market-link').filter({ hasText: 'Germany · Reseller' })).toContainText('No partner hypothesis picked yet.');

  const hypothesis = section(page, 'Partner hypothesis');
  await expect(hypothesis.getByRole('heading', { level: 3 })).toHaveText(['Austria · Reseller', 'Germany · Reseller']);
  await hypothesis.getByLabel('Linked partner hypothesis · Austria · Reseller').selectOption({ label: 'Mid-size IT resellers' });
  await expect(hypothesis.getByText('They resell it because their customers ask for it.')).toBeVisible();
  await expect(hypothesis.getByRole('link', { name: 'Edit partner hypothesis' })).toHaveAttribute('href', /^\/markets\/m_\w+\?tab=hypotheses$/);
  // With a hypothesis that holds, Qualification comes without the advice.
  await steps(page).getByRole('button', { name: 'Discovery call' }).click();
  await steps(page).getByRole('button', { name: 'Qualification' }).click();
  await expect(current(steps(page))).toHaveText('Qualification');
  await expect(alert(page)).toHaveCount(0);
});

test('Recruitment: desk check, a call with the six topics from pasted notes, a hypothesis written from it, qualification', async ({ page }) => {
  await openPartner(page, 'adatum');
  await expect(section(page, 'Desk check')).toBeVisible();
  await expect(section(page, 'Mutual Action Plan')).toHaveCount(0);
  // A partner in no market is pointed to Overview.
  await page.getByRole('button', { name: 'Add it to a market' }).click();
  await page.getByLabel('Add to a market').selectOption({ label: 'Germany · Reseller' });
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  const calls = section(page, 'Calls');
  await calls.getByRole('button', { name: 'Log a call' }).click();
  const form = calls.getByRole('form', { name: 'New call' });
  await form.getByLabel('Paste notes from Granola').fill('Revenue Model\nLicenses and services\n\nCustomer Pains: Manual invoices');
  await form.getByRole('button', { name: 'Sort into topics' }).click();
  await expect(form.getByText('Sorted into the boxes below. Check them, then save the call.')).toBeVisible();
  for (const topic of ['Revenue Model', 'Cost Drivers', 'Differentiators', 'Strategic Bets', 'Customer Pains', 'Partnership Experience']) {
    await expect(form.getByLabel(topic, { exact: true })).toBeVisible();
  }
  await expect(form.getByLabel('Customer Pains', { exact: true })).toHaveValue('Manual invoices');
  await form.getByRole('button', { name: 'Save call' }).click();
  await expect(calls.getByTestId('call')).toHaveCount(1);
  await expect(calls.getByTestId('call')).toContainText('Licenses and services');

  const hypothesis = section(page, 'Partner hypothesis');
  await hypothesis.getByRole('button', { name: 'Write one from this call' }).click();
  const linked = hypothesis.getByLabel('Linked partner hypothesis · Germany · Reseller');
  await expect(linked).toHaveValue(/^h_/);
  await expect(linked.locator('option:checked')).toHaveText('Adatum Advisory');
  await expect(hypothesis.getByText('Draft')).toBeVisible();

  const qualification = section(page, 'Qualification');
  await qualification.getByRole('button', { name: /CASO/ }).click();
  await expect(qualification.getByRole('radiogroup', { name: 'Culture' })).toBeVisible();
  await expect(qualification.getByText('The tool gives recommendations, and they are advice. You decide: go on, not now, or no.')).toBeVisible();
  await qualification.getByRole('button', { name: 'Proceed to MAP' }).click();
  await expect(qualification.getByRole('alert')).toContainText('Score all four Cs in the confirmed check first.');
  await qualification.getByRole('button', { name: 'Go ahead anyway' }).click();
  await expect(current(steps(page))).toHaveText('MAP');
  await expect(section(page, 'Mutual Action Plan')).toBeVisible();
  await expect(qualification.getByRole('button', { name: 'Proceed to MAP' })).toBeDisabled();
  await expect(qualification.getByText('Proceed to MAP works from Qualification. Adatum Advisory is at MAP.')).toBeVisible();
  // From MAP on, Mark signed is the main action.
  await expect(page.getByRole('button', { name: 'Mark signed' })).toHaveClass(/bg-brand-strong/);
});

test('a save that loses: the second tab is told, and nothing is overwritten', async ({ page, context }) => {
  const { accountIds } = await openPartner(page, 'contoso');
  const other = await context.newPage();
  await other.goto(`/partners/${accountIds[SAMPLE.contoso]}`);
  await expect(other.getByRole('heading', { level: 1, name: 'Contoso Partners' })).toBeVisible();

  const saved = nextSave(page);
  await page.getByRole('button', { name: 'Country: empty' }).click();
  await page.keyboard.type('Austria');
  await page.keyboard.press('Enter');
  await saved;

  const refused = nextSave(other);
  await other.getByRole('button', { name: 'Country: empty' }).click();
  await other.keyboard.type('Germany');
  await other.keyboard.press('Enter');
  await refused;
  await expect(other.getByText('Updated elsewhere just now. Refresh?')).toBeVisible();
  await other.getByRole('button', { name: 'Refresh' }).click();
  await expect(other.getByRole('button', { name: 'Country: Austria' })).toBeVisible();
});

test('from 1280 px the four recruitment steps share one row', async ({ page }) => {
  for (const width of [1280, 1500]) {
    await page.setViewportSize({ width, height: 900 });
    await openPartner(page, 'northwind');
    const pills = steps(page).getByRole('button');
    await expect(pills).toHaveCount(4);
    const tops = await pills.evaluateAll((els) => els.map((el) => (el as HTMLElement).offsetTop));
    expect(new Set(tops).size).toBe(1);
  }
});

test('on a phone the partner page fits without sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await openPartner(page, 'litware');
  await expect(stages(page)).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Mark signed' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(section(page, 'Details')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

test('one company shows one header, one contacts list and a tab per partner type', async ({ page }) => {
  const { acmeAccountId } = await signInWithSample(page, 'Anna', { twoTypes: true });
  await page.goto(`/partners/${acmeAccountId}`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Acme');
  await expect(section(page, 'People')).toHaveCount(1);
  await expect(tab(page, 'Reseller')).toBeVisible();
  await expect(tab(page, 'Technology Partner')).toBeVisible();
  await expect(page.getByRole('combobox', { name: 'Partner type' })).toHaveCount(0);

  // The open type is the address's (?type=), so the panel follows the tab once the address has changed.
  await tab(page, 'Technology Partner').click();
  await expect(page).toHaveURL(/\?type=technology$/);
  await expect(page.getByRole('tabpanel', { name: 'Technology Partner' })).toBeVisible();
  await expect(current(stages(page))).toContainText('Growth');
  await tab(page, 'Reseller').click();
  await expect(page.getByRole('tabpanel', { name: 'Reseller' })).toBeVisible();
  await expect(current(steps(page))).toHaveText('Researched');

  await page.getByRole('button', { name: 'Add partner type' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add partner type' });
  await dialog.getByLabel('Partner type').selectOption({ label: 'Referral Partner' });
  await dialog.getByLabel('Where are they now?').selectOption({ label: 'Discovery call' });
  const saved = nextSave(page);
  await dialog.getByRole('button', { name: 'Add' }).click();
  await saved;
  await expect(tab(page, 'Referral Partner')).toHaveAttribute('aria-selected', 'true');
  await expect(current(steps(page))).toHaveText('Discovery call');
});

test('Undo signing on a Growth partner goes back to Recruitment, step MAP', async ({ page }) => {
  await openPartner(page, 'wingtip');
  await expect(current(stages(page))).toContainText('Growth');
  await page.getByRole('button', { name: 'Undo signing' }).click();
  const confirm = page.getByRole('dialog', { name: 'Undo the signing of Wingtip Digital?' });
  await expect(confirm).toContainText('The partner goes back to Recruitment, step MAP');
  const saved = nextSave(page);
  await confirm.getByRole('button', { name: 'Undo signing' }).click();
  await saved;
  await expect(stages(page).locator(':scope > li[aria-current="step"]')).toContainText('Recruitment');
  await expect(current(steps(page))).toHaveText('MAP');
  await expect(page.getByRole('button', { name: 'Mark exited' })).toHaveCount(0);
});

test('Correct exit changes the exit date', async ({ page }) => {
  await openPartner(page, 'lucerne');
  await page.getByRole('button', { name: 'Correct exit' }).click();
  const dialog = page.getByRole('dialog', { name: 'Correct the exit of Lucerne Publishing' });
  await dialog.getByLabel('Exit date').fill('2026-11-02');
  const saved = nextSave(page);
  await dialog.getByRole('button', { name: 'Correct exit' }).click();
  await saved;
  await expect(page.getByText('Exited on 2 Nov 2026').first()).toBeVisible();
});

test('removing one partner type keeps the company, and removing the last removes it from Partners', async ({ page }) => {
  const { acmeAccountId } = await signInWithSample(page, 'Anna', { twoTypes: true });
  await page.goto(`/partners/${acmeAccountId}?type=reseller`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Acme');
  await page.getByRole('button', { name: 'Remove Reseller' }).click();
  const keep = page.getByRole('dialog', { name: 'Remove Acme as a reseller?' });
  await expect(keep).toContainText('Acme stays in Partners, with its other partner types and its contacts.');
  const removed = nextSave(page);
  await keep.getByRole('button', { name: 'Remove' }).click();
  await removed;
  await expect(keep).toBeHidden();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Acme');
  await expect(tab(page, 'Reseller')).toHaveCount(0);
  await expect(tab(page, 'Technology Partner')).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('link', { name: 'Back to Partners' }).click();
  await page.getByRole('tab', { name: /Potential/ }).click();
  await expect(page.getByTestId('partner-row').filter({ hasText: 'Northwind Consulting' })).toBeVisible();
  await page.getByRole('link', { name: 'Northwind Consulting' }).click();
  await page.getByRole('button', { name: 'Remove Reseller' }).click();
  const last = page.getByRole('dialog', { name: 'Remove Northwind Consulting as a reseller?' });
  await expect(last).toContainText('Northwind Consulting and its contacts are removed from Partners too.');
  // One save takes the partner type and the company.
  const oneSave = nextSave(page);
  await last.getByRole('button', { name: 'Remove' }).click();
  await oneSave;
  await expect(last).toBeHidden();
  await expect(page.getByText('This partner isn’t in your list any more.')).toBeVisible();

  // Undo brings the company back with its partner type, on screen at once. It saves the company, then the partner
  // type: Partners is opened once the second, the partner type's add, has answered.
  const restored = actionAnswer(page, '"kind":"add","entity":"partner"');
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Northwind Consulting');
  await expect(tab(page, 'Reseller')).toBeVisible();
  await restored;
  await page.getByRole('link', { name: 'Back to Partners' }).click();
  await page.getByRole('tab', { name: /Potential/ }).click();
  await expect(page.getByTestId('partner-row').filter({ hasText: 'Northwind Consulting' })).toBeVisible();

  // Removed for good: gone from Partners, and adding it again finds no company left behind.
  await page.getByRole('link', { name: 'Northwind Consulting' }).click();
  await page.getByRole('button', { name: 'Remove Reseller' }).click();
  const again = nextSave(page);
  await page.getByRole('dialog').getByRole('button', { name: 'Remove' }).click();
  await again;
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(page.getByText('This partner isn’t in your list any more.')).toBeVisible();
  await page.getByRole('link', { name: 'Back to Partners' }).click();
  await expect(page).toHaveURL(/\/partners$/);
  await page.reload();
  await page.getByRole('tab', { name: /Potential/ }).click();
  await expect(page.getByTestId('partner-row').filter({ hasText: 'Northwind Consulting' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Add a partner' }).first().click();
  const add = page.getByRole('dialog', { name: 'Add a partner' });
  await add.getByLabel('Company').fill('Northwind Consulting');
  await add.getByLabel('Website').fill('northwind.example');
  await expect(add.getByRole('status')).toHaveCount(0);
});

test('an old address that names a partner type opens its company on that type', async ({ page }) => {
  const ids = await signInWithSample(page);
  await page.goto(`/partners/${ids.partnerIds[SAMPLE.northwind]}`);
  await expect(page).toHaveURL(new RegExp(`/partners/${ids.accountIds[SAMPLE.northwind]}\\?type=reseller$`));
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Northwind Consulting');
});

test('signing in from a partner page comes back to the same partner type', async ({ page }) => {
  await page.goto('/partners/a_someone?type=technology');
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fpartners%2Fa_someone%3Ftype%3Dtechnology$/);
});

test('the company page fits on a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { acmeAccountId } = await signInWithSample(page, 'Anna', { twoTypes: true });
  await page.goto(`/partners/${acmeAccountId}`);
  await expect(tab(page, 'Reseller')).toBeVisible();
  await expect(tab(page, 'Technology Partner')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.getByRole('button', { name: 'Add partner type' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

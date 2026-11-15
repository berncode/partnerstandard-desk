import { expect, test, type Browser, type Page } from '@playwright/test';
import { actionAnswer } from './saves';
import { byEdition } from './edition';

/** The sample book's partners, in /api/test-seed's order. */
const SAMPLE = { adatum: 3, litware: 4, tailspin: 5, wingtip: 6, lucerne: 9 } as const;

interface Seeded {
  partnerIds: string[];
  accountIds: string[];
  acmeAccountId?: string;
  acmePartnerIds?: { reseller: string; technology: string };
}

/** Signs a new test user in and seeds the sample book. */
async function signInWithSample(page: Page, name: string, body: Record<string, unknown> = {}): Promise<Seeded> {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=/partners`);
  await expect(page).toHaveURL(/\/partners/);
  return seed<Seeded>(page, { fixture: 'sample', ...body });
}

/** Seeds through /api/test-seed and answers its JSON. */
async function seed<T>(page: Page, data: Record<string, unknown>): Promise<T> {
  const out = await page.request.post('/api/test-seed', { data });
  expect(out.ok()).toBe(true);
  return out.json() as Promise<T>;
}

/**
 * Starts a MAP for a partner type through the commands, with a milestone in 20 days and, for `health`, what makes it
 * so; `empty` leaves it with nothing in it.
 */
const seedMap = (page: Page, partnerId: string, health: 'on_track' | 'at_risk' | 'off_track' | 'empty' = 'on_track') =>
  seed<{ mapId: string }>(page, { fixture: 'map', partnerId, health });

/**
 * The date `days` after the owner's today, as a UTC midnight. The owner's today is Berlin's (the test owner's default
 * timezone): a MAP starts on it and its screens count from it, whatever the clock of the machine running the tests.
 */
function fromToday(days: number): Date {
  const { year, month, day } = berlinToday();
  return new Date(Date.UTC(year, month - 1, day + days));
}

/** A date `days` from the owner's today, as the screens show one in this year: "21 Nov", with the year when it is another. */
function shown(days: number): string {
  const d = fromToday(days);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = `${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
  return d.getUTCFullYear() === berlinToday().year ? base : `${base} ${d.getUTCFullYear()}`;
}

/** A date `days` from the owner's today as YYYY-MM-DD, as a date input takes it. */
function iso(days: number): string {
  return fromToday(days).toISOString().slice(0, 10);
}

const main = (page: Page) => page.getByRole('main');
const area = (page: Page) => main(page).getByRole('region', { name: 'Mutual Action Plan' });
const cards = (page: Page) => main(page).getByRole('list', { name: 'Your MAPs' }).getByRole('listitem');
const rows = (page: Page) => page.getByTestId('partner-row');
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('the sidebar has Mutual Action Plans after Business cases, and the empty page says where a MAP starts', async ({ page }) => {
  await signInWithSample(page, 'Plan Finder');
  const sidebar = page.getByRole('complementary');
  const links = sidebar.getByRole('navigation', { name: 'Main menu' }).getByRole('link');
  await expect(links).toHaveText(['This week', 'Partners', 'Markets', 'Programs', 'Business cases', 'Mutual Action Plans', 'Business reviews', 'How it works', 'Call guide', 'Company facts', 'Settings']);
  await sidebar.getByRole('link', { name: 'Mutual Action Plans', exact: true }).click();
  await expect(page).toHaveURL(/\/plans$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Mutual Action Plans' })).toBeVisible();
  await expect(main(page).getByRole('heading', { level: 2, name: 'No MAPs yet' })).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Go to Partners' })).toHaveAttribute('href', '/partners');
  await expect(sidebar.getByRole('link', { name: 'Mutual Action Plans', exact: true })).toHaveAttribute('aria-current', 'page');
});

test('Start the MAP on a partner at step MAP runs the guided steps and lands on the MAP page; the area shows it, once', async ({ page }) => {
  const { accountIds, partnerIds } = await signInWithSample(page, 'Plan Starter');
  await seed(page, { fixture: 'contact', accountId: accountIds[SAMPLE.litware], name: 'Lena Ortiz', title: 'Head of Partnerships' });
  await seed(page, { fixture: 'case', partnerId: partnerIds[SAMPLE.litware], benefits: ['Recurring revenue', 'Stronger offering'] });
  await page.goto(`/partners/${accountIds[SAMPLE.litware]}`);

  // Without a MAP: the question and Start the MAP. No old "MAP link" field, no link to the MAP app (owner, 2026-10-31).
  await expect(area(page)).toContainText('No MAP yet for this partner type.');
  await expect(area(page).getByRole('group', { name: 'Is the Mutual Action Plan filled in and agreed with the partner?' })).toBeVisible();
  await expect(area(page).getByText('MAP link', { exact: true })).toHaveCount(0);
  await expect(area(page).getByRole('link', { name: 'Open the Mutual Action Plan tool' })).toHaveCount(0);
  await area(page).getByRole('button', { name: 'Start the MAP' }).click();

  // Step 1, the partner: filled from Partners.
  await expect(page).toHaveURL(/\/plans\/map_[0-9a-z]{10}\/start$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Who is the partner?' })).toBeVisible();
  await expect(main(page)).toContainText('Litware Group');
  await expect(main(page)).toContainText('Reseller');
  await main(page).getByRole('button', { name: 'Next' }).click();

  // Objectives, on both sides; the partner's side offers what its business case names beyond the money.
  await expect(main(page).getByRole('heading', { level: 1, name: 'What does success look like, for both sides?' })).toBeVisible();
  const partnerObjectives = main(page).getByTestId('draft-objectives-partner');
  await expect(partnerObjectives).toContainText('From the business case, beyond the money. One click adds it:');
  await partnerObjectives.getByRole('button', { name: 'Recurring revenue' }).click();
  await expect(partnerObjectives.getByRole('listitem').filter({ hasText: 'Recurring revenue' })).toBeVisible();
  await expect(partnerObjectives.getByRole('button', { name: 'Recurring revenue', exact: true })).toHaveCount(0);
  await main(page).getByLabel('Add their objective').fill('Grow deal size with a more complete offer');
  await main(page).getByTestId('draft-objectives-partner').getByRole('button', { name: 'Add', exact: true }).click();
  await expect(main(page).getByTestId('draft-objectives-partner')).toContainText('Grow deal size with a more complete offer');
  await main(page).getByRole('button', { name: 'Next' }).click();

  // People: the partner's contacts are offered, one click each.
  await expect(main(page).getByRole('heading', { level: 1, name: 'Who is committed, by name?' })).toBeVisible();
  const theirs = main(page).getByTestId('draft-people-partner');
  await theirs.getByRole('button', { name: 'Lena Ortiz' }).click();
  await expect(theirs.getByRole('listitem').filter({ hasText: 'Lena Ortiz' })).toBeVisible();
  await expect(theirs.getByRole('button', { name: 'Lena Ortiz', exact: true })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Next' }).click();

  // Activities: the MAP app's starters for a reseller in recruitment.
  await expect(main(page).getByRole('heading', { level: 1, name: 'What will each side do during this horizon?' })).toBeVisible();
  await expect(main(page)).toContainText('Suggested for a Reseller in recruitment. One click adds it:');
  await main(page).getByRole('button', { name: 'Agree on seller activation targets' }).click();
  await expect(main(page).getByLabel('Owner of Agree on seller activation targets')).toBeVisible();
  await main(page).getByLabel('Owner of Agree on seller activation targets').selectOption({ label: 'Lena Ortiz' });
  await main(page).getByRole('button', { name: 'Next' }).click();

  // Milestones and exit triggers, then save.
  await expect(main(page).getByRole('heading', { level: 1, name: 'When do we check in, and when do we stop?' })).toBeVisible();
  await main(page).getByRole('button', { name: 'Day 30: Partner enabled' }).click();
  await main(page).getByRole('button', { name: 'No qualified opportunity registered within 90 days' }).click();
  await main(page).getByRole('button', { name: 'Save the MAP' }).click();

  // The MAP page.
  await expect(page).toHaveURL(/\/plans\/map_[0-9a-z]{10}$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();
  await expect(main(page)).toContainText('On track');
  await expect(main(page)).toContainText('Day 30: Partner enabled');
  const mapUrl = page.url();

  // Back on the partner: health, the horizon, the next milestone, the overdue count, and Open the MAP. No second MAP.
  await main(page).getByRole('link', { name: 'Back to Litware Group' }).click();
  await expect(area(page)).toContainText('On track');
  await expect(area(page)).toContainText('Before signing');
  await expect(area(page)).toContainText('Day 30: Partner enabled');
  await expect(area(page).getByTestId('overdue-count')).toHaveText('0');
  await expect(area(page).getByRole('link', { name: 'Open the MAP' })).toHaveAttribute('href', new URL(mapUrl).pathname);
  await expect(area(page).getByRole('button', { name: 'Start the MAP' })).toHaveCount(0);
  await expect(area(page).getByText('MAP link', { exact: true })).toHaveCount(0);
  // The yes/no stays a person's answer.
  await expect(area(page).getByRole('group', { name: 'Is the Mutual Action Plan filled in and agreed with the partner?' })).toBeVisible();

  // The guided steps of a MAP already filled in don't fill it twice.
  await page.goto(`${new URL(mapUrl).pathname}/start`);
  await expect(page).toHaveURL(/\/plans\/map_[0-9a-z]{10}$/);
});

test('Proceed to MAP offers to start the MAP now', async ({ page }) => {
  const { accountIds } = await signInWithSample(page, 'Plan Proceeder');
  await page.goto(`/partners/${accountIds[SAMPLE.adatum]}`);
  const qualification = main(page).getByRole('region', { name: 'Qualification' });
  await qualification.getByRole('button', { name: 'Proceed to MAP' }).click();
  await qualification.getByRole('button', { name: 'Go ahead anyway' }).click();
  const offer = qualification.getByRole('status');
  await expect(offer).toContainText('Adatum Advisory is at MAP now. Start the MAP?');
  await offer.getByRole('button', { name: 'Start the MAP now' }).click();
  await expect(page).toHaveURL(/\/plans\/map_[0-9a-z]{10}\/start$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Who is the partner?' })).toBeVisible();
});

test('the Plans page lists the MAPs, what needs attention first; the Partners list shows, sorts and filters by MAP health', async ({ page }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Lister');
  await seedMap(page, partnerIds[SAMPLE.tailspin]!, 'on_track');
  await seedMap(page, partnerIds[SAMPLE.litware]!, 'at_risk');
  await seedMap(page, partnerIds[SAMPLE.wingtip]!, 'off_track');

  await page.goto('/plans');
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).nth(0)).toContainText('Wingtip Digital as reseller');
  await expect(cards(page).nth(0)).toContainText('Off track');
  await expect(cards(page).nth(1)).toContainText('Litware Group as reseller');
  await expect(cards(page).nth(1)).toContainText('At risk');
  await expect(cards(page).nth(1).getByTestId('overdue-count')).toHaveText('1');
  await expect(cards(page).nth(1)).toContainText('Before signing');
  await expect(cards(page).nth(2)).toContainText('Tailspin Solutions as reseller');
  await expect(cards(page).nth(2)).toContainText('On track');
  await expect(cards(page).nth(2)).toContainText('Day 30: First check-in');
  await expect(cards(page).nth(2)).toContainText(shown(20));
  await cards(page).nth(2).getByRole('link').click();
  await expect(page).toHaveURL(/\/plans\/map_[0-9a-z]{10}$/);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Tailspin Solutions as reseller' })).toBeVisible();

  // Active: Tailspin (onboarding) and Wingtip (growth), with their MAP health.
  await page.goto('/partners?view=active');
  await expect(page.getByRole('columnheader', { name: /MAP health/ })).toBeVisible();
  await expect(rows(page).filter({ hasText: 'Tailspin Solutions' })).toContainText('On track');
  await expect(rows(page).filter({ hasText: 'Wingtip Digital' })).toContainText('Off track');
  await page.getByRole('button', { name: 'Sort by MAP health' }).click();
  await expect(page).toHaveURL(/sort=health/);
  await expect(rows(page).first()).toContainText('Wingtip Digital');
  await page.getByLabel('MAP health', { exact: true }).selectOption({ label: 'On track' });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Tailspin Solutions');
  // Every active partner type has a MAP; in Potential, Litware has one and the others none.
  await page.getByLabel('MAP health', { exact: true }).selectOption({ label: 'No MAP' });
  await expect(rows(page)).toHaveCount(0);
  await page.getByRole('tab', { name: /^Potential/ }).click();
  await expect(rows(page).filter({ hasText: 'Litware Group' })).toHaveCount(0);
  await expect(rows(page).filter({ hasText: 'Northwind Consulting' })).toHaveCount(1);
});

test('an empty MAP has no health: "Nothing planned yet" on the Plans page, the MAP, the partner and the Partners list', async ({ page }) => {
  const { accountIds, partnerIds } = await signInWithSample(page, 'Plan Empty');
  await seedMap(page, partnerIds[SAMPLE.tailspin]!, 'empty');
  await seedMap(page, partnerIds[SAMPLE.wingtip]!, 'on_track');

  // The Plans page: after the MAP on track.
  await page.goto('/plans');
  await expect(cards(page)).toHaveCount(2);
  await expect(cards(page).nth(0)).toContainText('Wingtip Digital as reseller');
  await expect(cards(page).nth(0)).toContainText('On track');
  await expect(cards(page).nth(1)).toContainText('Tailspin Solutions as reseller');
  await expect(cards(page).nth(1)).toContainText('Nothing planned yet');
  await expect(cards(page).nth(1)).not.toContainText('On track');
  await cards(page).nth(1).getByRole('link').click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Tailspin Solutions as reseller' })).toBeVisible();
  // The MAP page's header (the Plans page stays in the page, hidden, so only the header is read).
  const header = main(page).locator('header', { has: page.getByRole('heading', { level: 1, name: 'Tailspin Solutions as reseller' }) });
  await expect(header).toContainText('Nothing planned yet');
  await expect(header).not.toContainText('On track');

  // The partner's Mutual Action Plan area.
  await page.goto(`/partners/${accountIds[SAMPLE.tailspin]}`);
  await expect(area(page)).toContainText('Nothing planned yet');
  await expect(area(page)).not.toContainText('On track');

  // The Partners list: its own words, its own filter, after on track and before no MAP.
  await page.goto('/partners?view=active');
  await expect(rows(page).filter({ hasText: 'Tailspin Solutions' })).toContainText('Nothing planned yet');
  await expect(rows(page).filter({ hasText: 'Wingtip Digital' })).toContainText('On track');
  await page.getByRole('button', { name: 'Sort by MAP health' }).click();
  await expect(rows(page).nth(0)).toContainText('Wingtip Digital');
  await expect(rows(page).nth(1)).toContainText('Tailspin Solutions');
  await page.getByLabel('MAP health', { exact: true }).selectOption({ label: 'Nothing planned yet' });
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toContainText('Tailspin Solutions');
  await page.getByLabel('MAP health', { exact: true }).selectOption({ label: 'No MAP' });
  await expect(rows(page)).toHaveCount(0);
});

test('Mark signed offers to move the MAP’s open dates, and moves them', async ({ page }) => {
  const { accountIds, partnerIds } = await signInWithSample(page, 'Plan Signer');
  await seedMap(page, partnerIds[SAMPLE.litware]!, 'on_track');
  await page.goto(`/partners/${accountIds[SAMPLE.litware]}`);
  await expect(area(page)).toContainText(shown(20));

  await page.getByRole('button', { name: 'Mark signed' }).click();
  const dialog = page.getByRole('dialog', { name: 'Mark Litware Group signed' });
  // Signed today, the day the MAP was started: nothing to move.
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByLabel('Date signed').fill(iso(-5));
  const move = dialog.getByRole('checkbox', { name: 'Move the dates of the MAP’s open activities and milestones 5 days earlier so the agreed schedule keeps its timing' });
  await expect(move).toBeChecked();
  await dialog.getByRole('button', { name: 'Mark signed' }).click();
  await dialog.getByRole('button', { name: 'Go ahead anyway' }).click();
  await expect(dialog).toBeHidden();

  // Horizon 1 started on the signing date, and the milestone moved with it.
  await expect(area(page)).toContainText('Horizon 1');
  await expect(area(page)).toContainText(shown(15));
});

test('Mark signed with the MAP’s dates moving also joins the program, with no "updated elsewhere"', async ({ page }) => {
  // The walk-through of 2026-11-01 found the program lost: the join was sent on the version before the signing.
  const { accountIds, partnerIds, programId } = await signInWithSample(page, 'Plan Joiner', { feedingProgram: true }) as Seeded & { programId: string };
  await seedMap(page, partnerIds[0]!, 'on_track');
  await page.goto(`/partners/${accountIds[0]}`);
  await expect(area(page)).toContainText(shown(20));

  await page.getByRole('button', { name: 'Mark signed' }).click();
  const dialog = page.getByRole('dialog', { name: /^Mark .* signed$/ });
  await dialog.getByLabel('Date signed').fill(iso(-5));
  await expect(dialog.getByRole('checkbox')).toBeChecked();
  await expect(dialog.getByLabel('Program')).toHaveValue(programId);
  // The join's own save: it goes after the signing's, and before the fix it was refused as a conflict.
  const joined = actionAnswer(page, `"programId":"${programId}"`);
  await dialog.getByRole('button', { name: 'Mark signed' }).click();
  await dialog.getByRole('button', { name: 'Go ahead anyway' }).click();
  await expect(dialog).toBeHidden();
  await joined;

  await expect(page.getByText('Updated elsewhere just now. Refresh?')).toHaveCount(0);
  await expect(area(page)).toContainText(shown(15));
  await page.reload();
  await expect(page.getByRole('tabpanel').getByRole('region', { name: 'Program' }).getByLabel('Program')).toHaveValue(programId);
});

test('removing a partner type asks about its business cases and its MAP, and both answers work', async ({ page }) => {
  const { acmeAccountId, acmePartnerIds } = await signInWithSample(page, 'Plan Remover', { twoTypes: true });
  await seedMap(page, acmePartnerIds!.technology);
  await seed(page, { fixture: 'case', partnerId: acmePartnerIds!.technology });
  await seedMap(page, acmePartnerIds!.reseller);
  await page.goto('/plans');
  await expect(cards(page)).toHaveCount(2);

  // Business cases and the MAP: keep the files.
  await page.goto(`/partners/${acmeAccountId}?type=technology`);
  await page.getByRole('button', { name: 'Remove Technology Partner' }).click();
  const keep = page.getByRole('dialog', { name: 'Remove Acme as a technology partner?' });
  await expect(keep).toContainText('Acme has 1 business case and a MAP as a technology partner.');
  await expect(keep).toContainText('To stop working with a partner, close it or exit it. That keeps everything.');
  await expect(keep).toContainText('What happens to the case and the MAP?');
  await expect(keep).toContainText(byEdition({ hosted: 'Either way, their links stop working.', database: 'Their links stop working.' }));
  // A company server only trashes (plan 13, task 12).
  await keep.getByRole('button', { name: byEdition({ hosted: 'Keep the files in Drive', database: 'Move the files to the trash' }) }).click();
  await expect(keep).toBeHidden();
  await expect(page.getByRole('tab', { name: 'Technology Partner' })).toHaveCount(0);

  // The MAP alone: to the trash.
  await page.getByRole('button', { name: 'Remove Reseller' }).click();
  const trash = page.getByRole('dialog', { name: 'Remove Acme as a reseller?' });
  await expect(trash).toContainText('Acme has a MAP as a reseller.');
  await expect(trash).toContainText('What happens to the MAP?');
  await trash.getByRole('button', { name: byEdition({ hosted: 'Move the file to the Drive trash', database: 'Move the file to the trash' }) }).click();
  await expect(trash).toBeHidden();

  await page.goto('/plans');
  await expect(main(page).getByRole('heading', { level: 2, name: 'No MAPs yet' })).toBeVisible();
});

test('the Plans page, the MAP area and the guided steps fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { accountIds, partnerIds } = await signInWithSample(page, 'Plan Phone');
  await seedMap(page, partnerIds[SAMPLE.tailspin]!, 'at_risk');
  await page.goto('/plans');
  await expect(cards(page)).toHaveCount(1);
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.goto(`/partners/${accountIds[SAMPLE.tailspin]}`);
  await expect(area(page)).toContainText('At risk');
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.goto(`/partners/${accountIds[SAMPLE.litware]}`);
  await area(page).getByRole('button', { name: 'Start the MAP' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'Who is the partner?' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  for (let step = 0; step < 3; step++) await main(page).getByRole('button', { name: 'Next' }).click();
  await expect(main(page).getByRole('heading', { level: 1, name: 'What will each side do during this horizon?' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// The MAP page and the present view (task 6), copied from the MAP app's plan page.

const mapPath = (mapId: string) => `/plans/${mapId}`;
const unscheduled = (page: Page) => main(page).locator('[data-group="unscheduled"]');
/** An activity's row, found by its title button. */
const activityRow = (page: Page, title: string) =>
  main(page).getByRole('listitem').filter({ has: page.getByRole('button', { name: `Activity: ${title}`, exact: true }) });
const waitUntilSaved = async (page: Page) => expect(main(page).getByRole('status').filter({ hasText: 'Saving…' })).toHaveCount(0);

/** Opens `/partners/{accountId}` and marks its partner type signed on `date` (YYYY-MM-DD); `move`: the MAP's dates too. */
async function markSigned(page: Page, accountId: string, date: string, move: boolean) {
  await page.goto(`/partners/${accountId}`);
  await page.getByRole('button', { name: 'Mark signed' }).click();
  const dialog = page.getByRole('dialog', { name: /^Mark .* signed$/ });
  await dialog.getByLabel('Date signed').fill(date);
  // The MAP's dates would move: the box shows, checked.
  const box = dialog.getByRole('checkbox');
  await expect(box).toBeChecked();
  if (!move) await box.uncheck();
  await dialog.getByRole('button', { name: 'Mark signed' }).click();
  // The dialog closes at once and the signing saves after it: the test goes on once the signing's own save answers.
  const signed = actionAnswer(page, '"markSigned"');
  await dialog.getByRole('button', { name: 'Go ahead anyway' }).click();
  await expect(dialog).toBeHidden();
  await signed;
}

test('the MAP page: objectives on both sides, people, an activity with an owner and a due date, a milestone, one-click status and filters', async ({ page }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Editor');
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  await expect(main(page).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();
  await expect(main(page).getByRole('link', { name: 'Back to Litware Group' })).toBeVisible();
  await expect(main(page)).toContainText('On track');
  await expect(main(page)).toContainText('Before signing');
  // The stage, signing and closing are the partner page's: none of them here.
  await expect(main(page).getByRole('combobox', { name: 'Stage' })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: /Agreement signed|Ended without signing/ })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'Start next horizon' })).toHaveCount(0);

  // An objective on each side.
  for (const [side, text] of [['us', 'Close three joint deals by day 90'], ['partner', 'Grow deal size with a complete offer']] as const) {
    const column = main(page).getByTestId(`objectives-${side}`);
    await column.getByRole('button', { name: 'Add objective' }).click();
    await column.getByRole('textbox', { name: 'Add objective' }).fill(text);
    await page.keyboard.press('Enter');
    await page.keyboard.press('Escape');
    await expect(column.getByRole('button', { name: `Objective: ${text}` })).toBeVisible();
  }

  // A person on our side, to own the activity.
  const ours = main(page).getByTestId('people-us');
  await ours.getByRole('button', { name: 'Add person' }).click();
  await ours.getByRole('textbox', { name: 'Add person' }).fill('Anna Keller');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(ours.getByRole('button', { name: 'Name: Anna Keller' })).toBeVisible();

  // An activity with an owner and a due date.
  await unscheduled(page).getByRole('button', { name: 'Add activity' }).click();
  await unscheduled(page).getByRole('textbox', { name: 'Add activity' }).fill('Train the partner’s sellers');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  const row = activityRow(page, 'Train the partner’s sellers');
  await row.getByLabel('Owner of Train the partner’s sellers').selectOption({ label: 'Anna Keller' });
  await row.getByRole('button', { name: 'Due date: No date' }).click();
  await row.getByLabel('Due date').fill(iso(12));
  await page.keyboard.press('Enter');
  await expect(row.getByRole('button', { name: `Due date: ${shown(12)}` })).toBeVisible();

  // A milestone.
  const milestones = main(page).getByRole('region', { name: 'Milestones' });
  await milestones.getByRole('button', { name: 'Add milestone' }).click();
  await milestones.getByRole('textbox', { name: 'Add milestone' }).fill('Day 45: First deal registered');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape');
  await expect(milestones.getByRole('button', { name: 'Milestone: Day 45: First deal registered' })).toBeVisible();

  // One click moves the status along.
  await row.getByRole('button', { name: /^Status: Not started/ }).click();
  await expect(row.getByRole('button', { name: /^Status: In progress/ })).toBeVisible();

  // Filters.
  const filters = main(page).getByRole('group', { name: 'Filter activities' });
  await filters.getByLabel('Status').selectOption({ label: 'In progress' });
  await expect(activityRow(page, 'Train the partner’s sellers')).toBeVisible();
  await expect(activityRow(page, 'Kickoff with both sponsors')).toHaveCount(0);
  await filters.getByLabel('Owner').selectOption({ label: 'No owner' });
  await expect(main(page)).toContainText('No activities match these filters.');
  await main(page).getByRole('button', { name: 'Clear filters' }).click();
  await expect(activityRow(page, 'Kickoff with both sponsors')).toBeVisible();

  // Everything is in the file: a reload shows it.
  await waitUntilSaved(page);
  await page.reload();
  await expect(main(page).getByTestId('objectives-us')).toContainText('Close three joint deals by day 90');
  await expect(main(page).getByTestId('objectives-partner')).toContainText('Grow deal size with a complete offer');
  const saved = activityRow(page, 'Train the partner’s sellers');
  await expect(saved.getByRole('button', { name: /^Status: In progress/ })).toBeVisible();
  await expect(saved.getByLabel('Owner of Train the partner’s sellers')).toHaveValue(/.+/);
  await expect(saved.getByLabel('Owner of Train the partner’s sellers').locator('option:checked')).toHaveText('Anna Keller');
  await expect(saved.getByRole('button', { name: `Due date: ${shown(12)}` })).toBeVisible();
  await expect(main(page).getByRole('region', { name: 'Milestones' })).toContainText('Day 45: First deal registered');
});

test('a hand edit in the sheet, then an edit in the app: the MAP app’s conflict prompt and the latest version', async ({ page }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Conflict');
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  const row = activityRow(page, 'Kickoff with both sponsors');
  await expect(row.getByRole('button', { name: /^Status: Not started/ })).toBeVisible();

  // Someone sets the activity to Blocked in the sheet, with their name in Updated by.
  await seed(page, { fixture: 'handEditMap', mapId });
  await row.getByRole('button', { name: /^Status: Not started/ }).click();
  await expect(page.getByText('Updated by Lena Ortiz since you opened it. You’re now seeing the latest version.')).toBeVisible();
  await expect(row.getByRole('button', { name: /^Status: Blocked/ })).toBeVisible();
  await waitUntilSaved(page);
  await page.reload();
  await expect(activityRow(page, 'Kickoff with both sponsors').getByRole('button', { name: /^Status: Blocked/ })).toBeVisible();
});

test('Mark signed starts horizon 1 on the signing date on the MAP page; undo signing shows recruitment again', async ({ page }) => {
  const { accountIds, partnerIds } = await signInWithSample(page, 'Plan Horizon');
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  await expect(main(page)).toContainText('Before signing');

  await markSigned(page, accountIds[SAMPLE.litware]!, iso(-5), true);
  await page.goto(mapPath(mapId));
  const horizon = main(page).getByRole('progressbar', { name: 'Plan horizon' });
  await expect(horizon).toBeVisible();
  await expect(main(page)).toContainText('Horizon 1 · Day 6 of 90');
  await expect(main(page)).toContainText(`${shown(-5)} – ${shown(84)}`);

  // A person starts the next horizon on the MAP page.
  await main(page).getByRole('button', { name: 'Start next horizon' }).click();
  const dialog = page.getByRole('dialog', { name: 'Start next horizon' });
  await expect(dialog.getByRole('combobox', { name: 'Stage' })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Start horizon' }).click();
  await expect(main(page)).toContainText('Horizon 2 · Day 1 of 90');
  await waitUntilSaved(page);

  // Undo signing on the partner page: the MAP is back before signing, and its second horizon waits in the file.
  await page.goto(`/partners/${accountIds[SAMPLE.litware]}`);
  await page.getByRole('button', { name: 'Undo signing' }).click();
  // Mark signed is back at once and the undo saves after it: the MAP page is opened once the undo's own save answers.
  const undone = actionAnswer(page, '"undoSigned"');
  await page.getByRole('dialog', { name: 'Undo the signing of Litware Group?' }).getByRole('button', { name: 'Undo signing' }).click();
  await expect(page.getByRole('button', { name: 'Mark signed' })).toBeVisible();
  await undone;
  await page.goto(mapPath(mapId));
  await expect(main(page)).toContainText('Before signing');
  await expect(main(page).getByRole('progressbar', { name: 'Plan horizon' })).toHaveCount(0);
  await expect(main(page).getByRole('button', { name: 'Start next horizon' })).toHaveCount(0);
});

test('when the date move at signing failed, the MAP page offers it again, once', async ({ page }) => {
  const { accountIds, partnerIds } = await signInWithSample(page, 'Plan Mover');
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.litware]!);
  await markSigned(page, accountIds[SAMPLE.litware]!, iso(-5), false);
  await seed(page, { fixture: 'failMapDatesMove', mapId });
  await page.goto(mapPath(mapId));
  const note = main(page).getByRole('note').filter({ hasText: 'didn’t move' });
  await expect(note).toContainText('The MAP’s open dates didn’t move when the agreement was signed.');
  await expect(main(page).getByRole('region', { name: 'Milestones' })).toContainText(shown(20));
  await note.getByRole('button', { name: 'Move open dates 5 days earlier' }).click();
  await expect(note).toHaveCount(0);
  await expect(main(page).getByRole('region', { name: 'Milestones' })).toContainText(shown(15));
  await page.reload();
  await expect(main(page).getByRole('note').filter({ hasText: 'didn’t move' })).toHaveCount(0);
});

test('Delete MAP on the MAP page asks first, then the MAP is gone and its partner type offers Start the MAP again', async ({ page }) => {
  const { accountIds, partnerIds } = await signInWithSample(page, 'Plan Deleter');
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  await expect(main(page).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();

  // Asked first: Cancel keeps it.
  await main(page).getByRole('button', { name: 'Delete MAP' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete the MAP with Litware Group as reseller?' });
  await expect(dialog).toContainText(byEdition({
    hosted: 'Its file goes to the trash in your Google Drive. You can restore it from there.',
    database: 'Its file goes to the trash, where an admin can restore it later.',
  }));
  await expect(dialog).toContainText('Every link to it stops working, and you can start a new MAP for this partner type.');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();

  await main(page).getByRole('button', { name: 'Delete MAP' }).click();
  await dialog.getByRole('button', { name: 'Delete MAP' }).click();
  await expect(page).toHaveURL(new RegExp(`/partners/${accountIds[SAMPLE.litware]}`));
  await expect(area(page)).toContainText('No MAP yet for this partner type.');
  await expect(area(page).getByRole('button', { name: 'Start the MAP' })).toBeVisible();

  await page.goto(mapPath(mapId));
  await expect(main(page).getByRole('alert')).toContainText('This MAP is no longer in PartnerStandard Desk.');
  await expect(main(page).getByRole('button', { name: 'Delete MAP' })).toHaveCount(0);
  await page.goto('/plans');
  await expect(main(page).getByRole('heading', { level: 2, name: 'No MAPs yet' })).toBeVisible();
});

test('a MAP whose file can’t be read is offered Delete on the Plans page and on the MAP page', async ({ page }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Cleaner');
  await seedMap(page, partnerIds[SAMPLE.tailspin]!);
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.litware]!);
  await seed(page, { fixture: 'trashMap', mapId });

  // The MAP page says why, and offers Delete under it.
  await page.goto(mapPath(mapId));
  await expect(main(page).getByRole('alert')).toContainText('We can\'t reach this file.');
  await expect(main(page).getByRole('button', { name: 'Delete MAP' })).toBeVisible();

  await page.goto('/plans');
  await expect(cards(page)).toHaveCount(1);
  const problems = main(page).getByRole('region', { name: 'We couldn’t read these MAPs' });
  await expect(problems).toContainText('Litware Group as reseller');
  await problems.getByRole('button', { name: 'Delete the MAP with Litware Group as reseller' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete the MAP with Litware Group as reseller?' });
  await expect(dialog).toContainText(byEdition({ hosted: 'Its file goes to the trash in your Google Drive.', database: 'Its file goes to the trash, where an admin can restore it later.' }));
  await dialog.getByRole('button', { name: 'Delete MAP' }).click();
  await expect(dialog).toBeHidden();
  await expect(problems).toHaveCount(0);
  await expect(cards(page)).toHaveCount(1);
  await expect(cards(page).first()).toContainText('Tailspin Solutions as reseller');
});

test('Present shows the MAP read-only and prints, on A4 and on Letter', async ({ page }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Presenter');
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  await main(page).getByRole('link', { name: 'Present' }).click();
  await expect(page).toHaveURL(new RegExp(`/plans/${mapId}/present$`));
  await expect(main(page).getByRole('heading', { level: 1 })).toContainText('Litware Group');
  await expect(main(page).getByRole('heading', { name: 'Objectives' })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Milestones and activities' })).toBeVisible();
  await expect(main(page)).toContainText('Kickoff with both sponsors');
  await expect(main(page).getByRole('textbox')).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: 'Back to the MAP' })).toHaveAttribute('href', mapPath(mapId));
  await expect(main(page).getByRole('button', { name: 'Print or save as PDF' })).toBeVisible();

  // The print stylesheet: a page rule, light colors, and no sidebar or buttons on paper.
  const hasPageRule = await page.evaluate(() => {
    const walk = (rules: CSSRuleList): boolean => [...rules].some((r) => r instanceof CSSPageRule || ('cssRules' in r && walk((r as CSSGroupingRule).cssRules)));
    return [...document.styleSheets].some((sheet) => { try { return walk(sheet.cssRules); } catch { return false; } });
  });
  expect(hasPageRule).toBe(true);
  await page.emulateMedia({ media: 'print' });
  await expect(page.getByRole('complementary')).toBeHidden();
  await expect(main(page).getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  await expect(main(page).getByRole('link', { name: 'Back to the MAP' })).toBeHidden();
  for (const format of ['A4', 'Letter'] as const) {
    const pdf = await page.pdf({ format, printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(5000);
  }
});

test('the MAP page and the present view fit a phone', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { partnerIds } = await signInWithSample(page, 'Plan Pocket');
  const { mapId } = await seedMap(page, partnerIds[SAMPLE.tailspin]!, 'at_risk');
  await page.goto(mapPath(mapId));
  await expect(main(page).getByRole('heading', { level: 1, name: 'Tailspin Solutions as reseller' })).toBeVisible();
  await expect(main(page)).toContainText('At risk');
  expect(await noSidewaysScroll(page)).toBe(true);
  await activityRow(page, 'Kickoff with both sponsors').getByRole('button', { name: 'Show details' }).click();
  await expect(main(page).getByRole('button', { name: 'Delete activity' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  await page.goto(`${mapPath(mapId)}/present`);
  await expect(main(page).getByRole('heading', { name: 'Objectives' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// Access by link (spec 4): partner contacts and colleagues, each on their own side, without an account.

/** A MAP with Lena Ortiz (partner side) and Ben Ito (our side), both with an email, an objective and an activity each. */
const seedSharedMap = (page: Page, partnerId: string) => seed<{ mapId: string }>(page, { fixture: 'map', partnerId, people: true });

/** Opens Share on the MAP page and copies a new link for `name`: the link as the dialog shows it. */
async function copyLink(page: Page, name: string): Promise<string> {
  await main(page).getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this MAP' });
  await dialog.getByRole('button', { name: `Copy link for ${name}` }).click();
  const field = dialog.getByLabel(`Link for ${name}`, { exact: true });
  await expect(field).toHaveValue(/\/c\/[A-Za-z0-9_-]{43}$/);
  const url = await field.inputValue();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  return url;
}

/** Opens `url` in a fresh browser with no session, as the person the link went to. */
async function openAsGuest(browser: Browser, url: string) {
  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(url);
  return { context, guest };
}

const linkPath = (mapId: string) => `/m/${mapId}`;

// ---------------------------------------------------------------------------------------------------------------------
// Emails (task 8): test sign-in keeps every email in the server; /api/test-mail lists them, /api/cron/tick runs the job.

interface Mail { to: string; subject: string; text: string; html: string; replyTo?: string; headers?: Record<string, string> }

/** A tag for this test's addresses, so it finds only its own emails. */
const emailTag = () => `t${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;

/** The emails kept for `to`. */
async function mails(page: Page, to: string): Promise<Mail[]> {
  const res = await page.request.get(`/api/test-mail?to=${encodeURIComponent(to)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { messages: Mail[] }).messages;
}

/** The MAP link in an email. */
const linkIn = (mail: Mail): string => mail.text.match(/https?:\/\/\S+\/c\/[A-Za-z0-9_-]{43}/)![0];

const CRON = { authorization: 'Bearer e2e-cron-secret-0000000000' };

/** Runs the scheduled job as if it were `at`. */
async function tick(page: Page, at: Date): Promise<void> {
  const res = await page.request.get('/api/cron/tick', { headers: { ...CRON, 'x-pd-test-now': at.toISOString() } });
  expect(res.status()).toBe(200);
}

/** Berlin's today (an owner's default timezone): the owner's today in these tests. */
function berlinToday(): { year: number; month: number; day: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year!, month: parts.month!, day: parts.day! };
}

/** The instant at which Berlin's wall clock reads 08:30, `days` after Berlin's today (an owner's default timezone). */
function berlin0830(days: number): Date {
  const { year, month, day } = berlinToday();
  const probe = new Date(Date.UTC(year, month - 1, day + days, 8, 30));
  const wall = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(probe).map((p) => [p.type, Number(p.value)]));
  const shown = Date.UTC(wall.year!, wall.month! - 1, wall.day!, wall.hour!, wall.minute!);
  return new Date(probe.getTime() - (shown - probe.getTime()));
}
/** An activity's row on a link holder's page, where a title they can't rename is text, not a button. */
const guestRow = (page: Page, title: string) =>
  main(page).getByRole('listitem').filter({ hasText: title }).filter({ has: page.getByRole('button', { name: /^Status: / }) });
const INVALID = 'This link doesn’t work';

test('a copied link opens the MAP for a partner contact, who changes only their side and sees the rest read-only', async ({ page, browser }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Sharer');
  const { mapId } = await seedSharedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));

  // Share lists both sides' people with an email. Email is set up (test sign-in keeps the emails): Send link is there
  // for each, and Copy link works.
  await main(page).getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this MAP' });
  await expect(dialog.getByRole('heading', { name: 'Litware Group' })).toBeVisible();
  await expect(dialog).toContainText('Lena Ortiz');
  await expect(dialog).toContainText('Ben Ito');
  await expect(dialog).toContainText('No link yet');
  await expect(dialog.getByRole('button', { name: /^Send link/ })).toHaveCount(2);
  await expect(dialog).not.toContainText('Email isn’t set up');
  await page.keyboard.press('Escape');
  const url = await copyLink(page, 'Lena Ortiz');
  expect(new URL(url).pathname).toMatch(/^\/c\//);

  // The link swaps its token for a session: the address no longer holds it.
  const { context, guest } = await openAsGuest(browser, url);
  await expect(guest).toHaveURL(new RegExp(`${linkPath(mapId)}$`));
  const cookie = (await context.cookies()).find((c) => c.name === `pd_m_${mapId}`);
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Lax', path: '/' });
  expect(cookie!.value).not.toBe(new URL(url).pathname.split('/').at(-1));

  // The whole plan, outside PartnerStandard Desk: no sidebar, no Share, no sheet, and a way to sign out.
  await expect(main(guest).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();
  await expect(guest.getByRole('navigation', { name: 'Main menu' })).toHaveCount(0);
  await expect(guest.getByRole('button', { name: 'Share', exact: true })).toHaveCount(0);
  await expect(guest.getByRole('link', { name: 'Open sheet' })).toHaveCount(0);
  await expect(main(guest)).toContainText('Plan Sharer shared this MAP with you.');
  await expect(main(guest)).toContainText('You’re editing as Lena Ortiz');
  await expect(main(guest).getByTestId('objectives-us')).toContainText('Close three joint deals');
  await expect(main(guest).getByTestId('objectives-partner')).toContainText('Grow deal size');

  // Their side: a status changes, and stays after a reload.
  const theirs = guestRow(guest, 'Train our sellers');
  await theirs.getByRole('button', { name: /^Status: Not started\. Change to/ }).click();
  await expect(theirs.getByRole('button', { name: /^Status: In progress\. Change to/ })).toBeVisible();
  // The other side and plan info are read-only.
  await expect(guestRow(guest, 'Send the price list').getByRole('button', { name: 'Status: Not started', exact: true })).toBeDisabled();
  await expect(main(guest).getByTestId('objectives-us').getByRole('button', { name: 'Add objective' })).toHaveCount(0);
  await expect(main(guest).getByTestId('objectives-partner').getByRole('button', { name: 'Add objective' })).toBeVisible();
  await expect(main(guest).getByRole('combobox', { name: 'Onboarding length' })).toHaveCount(0);
  await expect(main(guest).getByRole('button', { name: 'Add milestone' })).toHaveCount(0);
  await waitUntilSaved(guest);
  await guest.reload();
  await expect(guestRow(guest, 'Train our sellers').getByRole('button', { name: /^Status: In progress/ })).toBeVisible();

  // The owner sees who changed it.
  await page.goto(mapPath(mapId));
  const row = activityRow(page, 'Train our sellers');
  await expect(row.getByRole('button', { name: /^Status: In progress/ })).toBeVisible();
  await row.getByRole('button', { name: 'Show details' }).click();
  await expect(row).toContainText('Last updated by Lena Ortiz (by link).');

  // Present works for them too, with the way back.
  await main(guest).getByRole('link', { name: 'Present' }).click();
  await expect(guest).toHaveURL(new RegExp(`${linkPath(mapId)}/present$`));
  await expect(main(guest)).toContainText('Train our sellers');
  await main(guest).getByRole('link', { name: 'Back to the MAP' }).click();
  await expect(guest).toHaveURL(new RegExp(`${linkPath(mapId)}$`));

  // Sign out ends the session: the plan isn't shown again without the link.
  await guest.getByRole('button', { name: 'Sign out' }).click();
  await expect(guest.getByRole('heading', { level: 1, name: 'You’re signed out of this MAP' })).toBeVisible();
  expect((await context.cookies()).find((c) => c.name === `pd_m_${mapId}`)).toBeUndefined();
  await guest.goto(linkPath(mapId));
  await expect(guest.getByRole('heading', { level: 1, name: INVALID })).toBeVisible();
  // The link itself still works.
  await guest.goto(url);
  await expect(guest).toHaveURL(new RegExp(`${linkPath(mapId)}$`));
  await context.close();
});

test('a link for a colleague on our side changes our side only', async ({ page, browser }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Colleague');
  const { mapId } = await seedSharedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  const url = await copyLink(page, 'Ben Ito');
  const { context, guest } = await openAsGuest(browser, url);
  await expect(main(guest)).toContainText('You’re editing as Ben Ito');
  const ours = guestRow(guest, 'Send the price list');
  await ours.getByRole('button', { name: /^Status: Not started\. Change to/ }).click();
  await expect(ours.getByRole('button', { name: /^Status: In progress\. Change to/ })).toBeVisible();
  await expect(guestRow(guest, 'Train our sellers').getByRole('button', { name: 'Status: Not started', exact: true })).toBeDisabled();
  await expect(main(guest).getByTestId('objectives-partner').getByRole('button', { name: 'Add objective' })).toHaveCount(0);
  await expect(main(guest).getByTestId('objectives-us').getByRole('button', { name: 'Add objective' })).toBeVisible();
  await waitUntilSaved(guest);
  await guest.reload();
  await expect(guestRow(guest, 'Send the price list').getByRole('button', { name: /^Status: In progress/ })).toBeVisible();
  await context.close();
});

test('Revoke ends a link holder’s access on their next request, on every device', async ({ page, browser }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Revoker');
  const { mapId } = await seedSharedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  const url = await copyLink(page, 'Lena Ortiz');
  const laptop = await openAsGuest(browser, url);
  const phone = await openAsGuest(browser, url);
  const theirs = guestRow(laptop.guest, 'Train our sellers');
  await expect(theirs.getByRole('button', { name: /^Status: Not started\. Change to/ })).toBeVisible();
  await expect(main(phone.guest).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();

  await main(page).getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this MAP' });
  await expect(dialog).toContainText('Last used');
  await dialog.getByRole('button', { name: 'Revoke access for Lena Ortiz' }).click();
  await expect(dialog).toContainText('Lena Ortiz will lose access at once, on every device. Reminders and weekly updates about this MAP stop too.');
  await dialog.getByRole('button', { name: 'Remove access for Lena Ortiz' }).click();
  await expect(dialog).toContainText('Access removed.');
  await expect(dialog).toContainText('No active link');

  // A save from one device is refused, and nothing is written.
  await theirs.getByRole('button', { name: /^Status: Not started\. Change to/ }).click();
  await expect(laptop.guest.getByText('Your access to this MAP was removed.').first()).toBeVisible();
  // The other device's next page says so, without the plan.
  await phone.guest.reload();
  await expect(phone.guest).toHaveURL(/\/c\/removed$/);
  await expect(phone.guest.getByRole('heading', { level: 1, name: 'Your access to this MAP was removed' })).toBeVisible();
  await expect(phone.guest.getByText('Train our sellers')).toHaveCount(0);
  expect((await phone.context.cookies()).find((c) => c.name === `pd_m_${mapId}`)).toBeUndefined();
  // The link no longer opens anything.
  await laptop.guest.goto(url);
  await expect(laptop.guest.getByRole('heading', { level: 1, name: INVALID })).toBeVisible();
  await page.goto(mapPath(mapId));
  await expect(activityRow(page, 'Train our sellers').getByRole('button', { name: /^Status: Not started/ })).toBeVisible();
  await laptop.context.close();
  await phone.context.close();
});

test('an unknown or expired link shows why; asking for a new one emails a new link to the address it went to', async ({ page, browser }) => {
  const tag = emailTag();
  const { partnerIds } = await signInWithSample(page, 'Plan Expirer');
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware]!, people: true, emailTag: tag });
  await page.goto(mapPath(mapId));
  const url = await copyLink(page, 'Lena Ortiz');

  const { context, guest } = await openAsGuest(browser, `/c/${'x'.repeat(43)}`);
  await expect(guest).toHaveURL(/\/c\/invalid$/);
  await expect(guest.getByRole('heading', { level: 1, name: INVALID })).toBeVisible();
  await guest.goto(linkPath(mapId));
  await expect(guest.getByRole('heading', { level: 1, name: INVALID })).toBeVisible();

  // The link wasn't used for 90 days.
  await seed(page, { fixture: 'ageMapLinks', mapId });
  await guest.goto(url);
  await expect(guest).toHaveURL(/\/c\/renew\?map=map_[0-9a-z]{10}$/);
  await expect(guest.getByRole('heading', { level: 1, name: 'Your link has expired' })).toBeVisible();
  // An address that never had a link gets the same answer, and nothing.
  await guest.getByLabel('Email address').fill(`someone+${tag}@example.com`);
  await guest.getByRole('button', { name: 'Send me a new link' }).click();
  await expect(guest.getByRole('status')).toHaveText('If that address can use this plan, a new link is on its way. Check your inbox.');
  const lena = `lena.ortiz+${tag}@example.com`;
  await guest.getByLabel('Email address').fill(lena);
  await guest.getByRole('button', { name: 'Send me a new link' }).click();
  await expect(guest.getByRole('status')).toHaveText('If that address can use this plan, a new link is on its way. Check your inbox.');
  expect((await context.cookies()).find((c) => c.name === `pd_m_${mapId}`)).toBeUndefined();
  await expect.poll(async () => (await mails(page, lena)).length).toBe(1);
  expect(await mails(page, `someone+${tag}@example.com`)).toEqual([]);
  const [mail] = await mails(page, lena);
  expect(mail!.subject).toBe('Plan Expirer shared a mutual action plan with you: Litware Group');
  await guest.goto(linkIn(mail!));
  await expect(guest).toHaveURL(new RegExp(`${linkPath(mapId)}$`));
  await expect(main(guest).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();
  await context.close();
});

test('a link whose partner type was taken out of Partners by hand shows the invalid page, and the session ends', async ({ page, browser }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Vanisher');
  const partnerId = partnerIds[SAMPLE.litware]!;
  const { mapId } = await seedSharedMap(page, partnerId);
  await page.goto(mapPath(mapId));
  const url = await copyLink(page, 'Lena Ortiz');
  const { context, guest } = await openAsGuest(browser, url);
  await expect(main(guest).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();

  await seed(page, { fixture: 'handRemovePartner', partnerId });
  await guest.reload();
  await expect(guest).toHaveURL(/\/c\/invalid$/);
  await expect(guest.getByRole('heading', { level: 1, name: INVALID })).toBeVisible();
  await expect(guest.locator('body')).not.toContainText('Partners');
  await expect(guest.locator('body')).not.toContainText('Litware');
  expect((await context.cookies()).find((c) => c.name === `pd_m_${mapId}`)).toBeUndefined();
  await guest.goto(linkPath(mapId));
  await expect(guest.getByRole('heading', { level: 1, name: INVALID })).toBeVisible();
  await context.close();
});

test('after the partner type’s exit, a link holder can only read the MAP', async ({ page, browser }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Exiter');
  const { mapId } = await seedSharedMap(page, partnerIds[SAMPLE.lucerne]!);
  await page.goto(mapPath(mapId));
  const url = await copyLink(page, 'Lena Ortiz');
  const { context, guest } = await openAsGuest(browser, url);
  await expect(main(guest).getByRole('heading', { level: 1, name: 'Lucerne Publishing as reseller' })).toBeVisible();
  await expect(main(guest)).toContainText('This partnership has ended. You can still read the plan, but not change it.');
  await expect(guestRow(guest, 'Train our sellers').getByRole('button', { name: 'Status: Not started', exact: true })).toBeDisabled();
  await expect(main(guest).getByRole('button', { name: 'Add objective' })).toHaveCount(0);
  await expect(main(guest).getByRole('button', { name: 'Add activity' })).toHaveCount(0);
  await context.close();
});

test('the link holder’s MAP fits a phone', async ({ page, browser }) => {
  const { partnerIds } = await signInWithSample(page, 'Plan Pocket Guest');
  const { mapId } = await seedSharedMap(page, partnerIds[SAMPLE.litware]!);
  await page.goto(mapPath(mapId));
  const url = await copyLink(page, 'Lena Ortiz');
  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const guest = await context.newPage();
  await guest.goto(url);
  await expect(main(guest).getByRole('heading', { level: 1, name: 'Litware Group as reseller' })).toBeVisible();
  expect(await noSidewaysScroll(guest)).toBe(true);
  await context.close();
});

test('Send link emails a person their link on the owner’s behalf, and the link in the email opens the MAP', async ({ page, browser }) => {
  const tag = emailTag();
  const { partnerIds } = await signInWithSample(page, 'Plan Mailer');
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware]!, people: true, emailTag: tag });
  const lena = `lena.ortiz+${tag}@example.com`;
  await page.goto(mapPath(mapId));
  await main(page).getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this MAP' });
  await dialog.getByRole('button', { name: 'Send link to Lena Ortiz' }).click();
  await expect(dialog.getByRole('status')).toHaveText(`Link sent to ${lena}.`);
  await expect(dialog).toContainText('Link not used yet');

  const [mail] = await mails(page, lena);
  expect(mail!.subject).toBe('Plan Mailer shared a mutual action plan with you: Litware Group');
  expect(mail!.text).toContain('Hi Lena Ortiz,');
  expect(mail!.text).not.toMatch(/unsubscribe/i);
  const { context, guest } = await openAsGuest(browser, linkIn(mail!));
  await expect(guest).toHaveURL(new RegExp(`${linkPath(mapId)}$`));
  await expect(main(guest)).toContainText('You’re editing as Lena Ortiz');
  await context.close();
});

test('an overdue activity’s reminder: its Mark done opens a page that changes nothing, and only its button marks it done', async ({ page, browser }) => {
  const tag = emailTag();
  const { partnerIds } = await signInWithSample(page, 'Plan Reminder');
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware]!, people: true, emailTag: tag });
  const ben = `ben.ito+${tag}@example.com`;

  // The job needs its secret.
  expect((await page.request.get('/api/cron/tick')).status()).toBe(401);
  // Ben's "Send the price list" was due in 7 days: on day 8, at 08:30 in Berlin, it is a day overdue.
  await tick(page, berlin0830(8));
  const [reminder] = await mails(page, ben);
  expect(reminder!.subject).toBe('Overdue: Send the price list');
  expect(reminder!.text).toContain('Hi Ben Ito,');
  expect(reminder!.headers!['List-Unsubscribe']).toMatch(/\/api\/unsubscribe\//);
  const [markDone] = reminder!.text.match(/https?:\/\/\S+\/n\/a\/[\w-]+\.[\w-]+/g)!;
  // A second run the same morning sends nothing more.
  await tick(page, new Date(berlin0830(8).getTime() + 15 * 60_000));
  expect(await mails(page, ben)).toHaveLength(1);

  // Opening the button's link (a GET, as a link scanner does) only asks.
  const { context, guest } = await openAsGuest(browser, markDone!);
  await expect(guest.getByRole('heading', { level: 1, name: 'Mark “Send the price list” done?' })).toBeVisible();
  await guest.reload();
  await page.goto(mapPath(mapId));
  await expect(guestRow(page, 'Send the price list').getByRole('button', { name: /^Status: Not started/ })).toBeVisible();

  // The button posts, as Ben, by link.
  await guest.getByRole('button', { name: 'Mark done' }).click();
  await expect(guest.getByRole('status')).toHaveText('Done: “Send the price list” is now done.');
  await page.reload();
  await expect(guestRow(page, 'Send the price list').getByRole('button', { name: /^Status: Done/ })).toBeVisible();
  await context.close();
});

test('removing access refuses the buttons of a reminder already sent, and stops the next ones', async ({ page, browser }) => {
  const tag = emailTag();
  const { partnerIds } = await signInWithSample(page, 'Plan Remover');
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware]!, people: true, emailTag: tag });
  const ben = `ben.ito+${tag}@example.com`;
  const lena = `lena.ortiz+${tag}@example.com`;

  // Day 8: Ben's "Send the price list" is a day overdue.
  await tick(page, berlin0830(8));
  const [reminder] = await mails(page, ben);
  expect(reminder!.subject).toBe('Overdue: Send the price list');
  const [markDone] = reminder!.text.match(/https?:\/\/\S+\/n\/a\/[\w-]+\.[\w-]+/g)!;

  // The owner shares the MAP with Ben, then removes his access.
  await page.goto(mapPath(mapId));
  await copyLink(page, 'Ben Ito');
  await main(page).getByRole('button', { name: 'Share', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Share this MAP' });
  await dialog.getByRole('button', { name: 'Revoke access for Ben Ito' }).click();
  await expect(dialog).toContainText('Ben Ito will lose access at once, on every device. Reminders and weekly updates about this MAP stop too.');
  await dialog.getByRole('button', { name: 'Remove access for Ben Ito' }).click();
  await expect(dialog).toContainText('Access removed.');
  await page.keyboard.press('Escape');

  // The reminder's button, opened as Ben, says so and offers nothing to press.
  const { context, guest } = await openAsGuest(browser, markDone!);
  await expect(guest.getByRole('heading', { level: 1, name: 'This button no longer works' })).toBeVisible();
  await expect(guest.getByText('Your access to this MAP was removed after this email was sent.', { exact: false })).toBeVisible();
  await expect(guest.getByRole('button', { name: 'Mark done' })).toHaveCount(0);
  await page.goto(mapPath(mapId));
  await expect(guestRow(page, 'Send the price list').getByRole('button', { name: /^Status: Not started/ })).toBeVisible();

  // Day 15: a week on, Ben's next overdue reminder would be due, but none comes; Lena, still on the MAP, gets hers.
  await tick(page, berlin0830(15));
  expect(await mails(page, ben)).toHaveLength(1);
  expect((await mails(page, lena)).map((m) => m.subject)).toEqual(['Overdue: Train our sellers']);
  await context.close();
});

test('unsubscribing from reminders stops them; opening the unsubscribe link alone changes nothing', async ({ page, browser }) => {
  const tag = emailTag();
  const { partnerIds } = await signInWithSample(page, 'Plan Unsubscriber');
  await seed(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware]!, people: true, emailTag: tag });
  const lena = `lena.ortiz+${tag}@example.com`;

  // Lena's "Train our sellers" is due in 14 days: on day 12 it is coming up.
  await tick(page, berlin0830(12));
  const [comingUp] = await mails(page, lena);
  expect(comingUp!.subject).toBe('Coming up: Train our sellers');
  const unsubscribe = comingUp!.text.match(/https?:\/\/\S+\/n\/u\/[\w-]+\.[\w-]+/)![0];

  // Opening the link only asks: on day 15 the overdue reminder still comes.
  const { context, guest } = await openAsGuest(browser, unsubscribe);
  await expect(guest.getByRole('heading', { level: 1, name: 'Unsubscribe from reminders about your activities?' })).toBeVisible();
  await tick(page, berlin0830(15));
  expect((await mails(page, lena)).map((m) => m.subject)).toEqual(['Coming up: Train our sellers', 'Overdue: Train our sellers']);

  // The button unsubscribes: a week later no reminder comes.
  await guest.getByRole('button', { name: 'Unsubscribe' }).click();
  await expect(guest.getByRole('heading', { level: 1, name: 'You’re unsubscribed' })).toBeVisible();
  await tick(page, berlin0830(22));
  expect(await mails(page, lena)).toHaveLength(2);
  // The one-click address takes no GET.
  expect((await page.request.get(new URL(comingUp!.headers!['List-Unsubscribe']!.slice(1, -1)).pathname)).status()).toBe(405);
  await context.close();
});

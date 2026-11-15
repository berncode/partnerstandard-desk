import { expect, test, type Page } from '@playwright/test';
import { actionAnswer } from './saves';

// The review page (task 8), with the test sign-in and the test user's files in memory, as maps.spec.ts.

/** The sample book's partners, in /api/test-seed's order. */
const SAMPLE = { litware: 4 } as const;

interface Seeded { partnerIds: string[]; accountIds: string[] }

async function signInWithSample(page: Page, name: string): Promise<Seeded> {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=/partners`);
  await expect(page).toHaveURL(/\/partners/);
  return seed<Seeded>(page, { fixture: 'sample' });
}

async function seed<T>(page: Page, data: Record<string, unknown>): Promise<T> {
  const out = await page.request.post('/api/test-seed', { data });
  expect(out.ok()).toBe(true);
  return out.json() as Promise<T>;
}

/** Today's date in Berlin: the browser's time zone in e2e (playwright.config.ts) and the owner's default one. */
function berlinNow(): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map((p) => [p.type, Number(p.value)]));
  return new Date(parts.year!, parts.month! - 1, parts.day!);
}

/** A date `days` from today as YYYY-MM-DD, in the browser's own time zone (the date inputs'), whatever the runner's. */
function iso(days: number): string {
  const d = berlinNow();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A date `days` from today, as the screens show one in this year: "21 Nov", with the year when it is another. */
function shown(days: number, withYear = false): string {
  const d = berlinNow();
  d.setDate(d.getDate() + days);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const base = `${d.getDate()} ${months[d.getMonth()]}`;
  return !withYear && d.getFullYear() === berlinNow().getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** The text's right edge is on screen at the phone's width: not cut off at the right of a table (walkthrough 2026-11-01). */
async function onScreenSideways(page: Page, text: ReturnType<Page['getByText']>) {
  const box = await text.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
}

/** Gives the review's one visible commitment a due date `days` from today. */
async function dueIn(page: Page, days: number) {
  const commitment = main(page).getByTestId(/^commitment-/).filter({ visible: true });
  await commitment.getByRole('button', { name: /^Due date:/ }).click();
  await commitment.getByLabel('Due date').fill(iso(days));
  await commitment.getByLabel('Due date').press('Enter');
  await expect(commitment.getByRole('button', { name: `Due date: ${shown(days)}` })).toBeVisible();
}

const main = (page: Page) => page.getByRole('main');
const mapPath = (mapId: string) => `/plans/${mapId}`;
const reviewPath = (mapId: string) => `/plans/${mapId}/review`;
const waitUntilSaved = async (page: Page) => expect(main(page).getByRole('status').filter({ hasText: 'Saving…' })).toHaveCount(0);
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Litware as a reseller with a MAP (an activity due in 10 days), signed 5 days ago with the MAP's dates moved. */
async function signedMap(page: Page, name: string, extra: Record<string, unknown> = {}): Promise<{ mapId: string; accountId: string }> {
  const { accountIds, partnerIds } = await signInWithSample(page, name);
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware], health: 'on_track', ...extra });
  const accountId = accountIds[SAMPLE.litware]!;
  await page.goto(`/partners/${accountId}`);
  await page.getByRole('button', { name: 'Mark signed' }).click();
  const dialog = page.getByRole('dialog', { name: /^Mark .* signed$/ });
  await dialog.getByLabel('Date signed').fill(iso(-5));
  await dialog.getByRole('button', { name: 'Mark signed' }).click();
  // The dialog closes at once and the signing saves after it: the test goes on once the signing's own save answers.
  const signed = actionAnswer(page, '"markSigned"');
  await dialog.getByRole('button', { name: 'Go ahead anyway' }).click();
  await expect(dialog).toBeHidden();
  await signed;
  return { mapId, accountId };
}

test('a review from prep to close: deals won, a commitment, and the MAP shows horizon 2 with the commitment as an activity', async ({ page }) => {
  const { mapId } = await signedMap(page, 'Review Holder');

  // The MAP page shows the review date and links the review.
  await page.goto(mapPath(mapId));
  await expect(main(page).getByRole('link', { name: `Review on ${shown(84)}` })).toHaveAttribute('href', reviewPath(mapId));
  await main(page).getByRole('link', { name: `Review on ${shown(84)}` }).click();

  // Before prep: the date, which can be changed already, and Start the prep.
  await expect(page).toHaveURL(new RegExp(`${reviewPath(mapId)}$`));
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Review · Litware Group as reseller · horizon 1');
  await expect(main(page).getByRole('heading', { name: 'Last quarter’s results' })).toHaveCount(0);
  await main(page).getByRole('button', { name: `Review date: ${shown(84)}` }).click();
  await main(page).getByLabel('Review date').fill(iso(80));
  await main(page).getByLabel('Review date').press('Enter');
  await expect(main(page).getByRole('button', { name: `Review date: ${shown(80)}` })).toBeVisible();
  await page.reload();
  await expect(main(page).getByRole('button', { name: `Review date: ${shown(80)}` })).toBeVisible();
  await expect(main(page).getByRole('heading', { name: 'Last quarter’s results' })).toHaveCount(0);
  await main(page).getByRole('button', { name: 'Start the prep' }).click();

  // The prep: the five areas, in order, then Decisions.
  await expect(main(page).getByRole('heading', { level: 2 })).toHaveText([
    'Last quarter’s results', 'Is the partner hypothesis still valid?', 'Next quarter', 'Enablement and blockers', 'The relationship', 'Decisions',
  ]);
  await expect(main(page)).toContainText('Kickoff with both sponsors');

  // Deals won, typed.
  const deals = main(page).getByRole('textbox', { name: 'Deals won: actual' });
  await deals.fill('3');
  await deals.press('Enter');

  // A commitment, with a due date.
  await main(page).getByRole('button', { name: 'Add commitment' }).click();
  await main(page).getByRole('textbox', { name: 'Add commitment' }).fill('Train five sellers');
  await main(page).getByRole('textbox', { name: 'Add commitment' }).press('Enter');
  await main(page).getByRole('textbox', { name: 'Add commitment' }).press('Escape');
  await expect(main(page).getByTestId(/^commitment-/).filter({ visible: true })).toContainText('Train five sellers');
  await dueIn(page, 30);
  await waitUntilSaved(page);

  // The MAP page points to the review now, not to Start next horizon.
  await page.goto(mapPath(mapId));
  await expect(main(page).getByRole('button', { name: 'Start next horizon' })).toHaveCount(0);
  await main(page).getByRole('link', { name: 'Go to the review' }).click();
  await expect(main(page).getByRole('textbox', { name: 'Deals won: actual' })).toHaveValue('3');

  // Close the review: what happens, today's date, then the held review.
  await main(page).getByRole('button', { name: 'Close the review' }).click();
  const dialog = page.getByRole('dialog', { name: 'Close the review' });
  await expect(dialog).toContainText('Horizon 2 starts that day and runs 90 days.');
  await expect(dialog.getByLabel('Held on')).toHaveValue(iso(0));
  await dialog.getByRole('button', { name: 'Close the review' }).click();
  await expect(page).toHaveURL(new RegExp(`${reviewPath(mapId)}/rv_[0-9a-z]+$`));
  await expect(main(page)).toContainText(`Held on ${shown(0)}`);
  await expect(main(page).getByTestId(/^commitment-/).filter({ visible: true })).toContainText('Now in the MAP');
  await expect(main(page).getByRole('button', { name: 'Close the review' })).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: 'Onboarding is done. Move Litware Group to Growth?' })).toBeVisible();

  // The MAP: horizon 2, and the commitment as an activity.
  await page.goto(mapPath(mapId));
  await expect(main(page)).toContainText('Horizon 2 · Day 1 of 90');
  await expect(main(page).getByRole('button', { name: 'Activity: Train five sellers', exact: true })).toBeVisible();
});

test('the review page and its present view fit a phone, and present prints', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  const { mapId } = await signedMap(page, 'Review Pocket');
  await page.goto(reviewPath(mapId));
  await main(page).getByRole('button', { name: 'Start the prep' }).click();
  await expect(main(page).getByRole('heading', { name: 'Last quarter’s results' })).toBeVisible();
  await main(page).getByRole('button', { name: 'Add blocker' }).click();
  await main(page).getByRole('textbox', { name: 'Add blocker' }).fill('No demo account for their sellers');
  await main(page).getByRole('textbox', { name: 'Add blocker' }).press('Enter');
  await main(page).getByRole('button', { name: 'Make it a commitment' }).click();
  await expect(main(page).getByTestId(/^commitment-/).filter({ visible: true })).toContainText('No demo account for their sellers');
  await dueIn(page, 30);
  await waitUntilSaved(page);
  expect(await noSidewaysScroll(page)).toBe(true);

  await main(page).getByRole('link', { name: 'Present' }).click();
  await expect(page).toHaveURL(new RegExp(`${reviewPath(mapId)}/present$`));
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText('Review · Litware Group as reseller · horizon 1');
  await expect(main(page).getByRole('heading', { name: 'Enablement and blockers' })).toBeVisible();
  await expect(main(page)).toContainText('No demo account for their sellers');
  // The commitment's due date is on screen at 375 px, not off the right edge.
  const due = main(page).getByText(`Due: ${shown(30)}`);
  await expect(due).toBeVisible();
  await onScreenSideways(page, due);
  await expect(main(page).getByRole('textbox')).toHaveCount(0);
  expect(await noSidewaysScroll(page)).toBe(true);
  await expect(main(page).getByRole('link', { name: 'Back to the review' })).toHaveAttribute('href', reviewPath(mapId));
  await page.emulateMedia({ media: 'print' });
  await expect(main(page).getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  for (const format of ['A4', 'Letter'] as const) {
    const pdf = await page.pdf({ format, printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  }
});

test('a person with a link never reaches the review: no session, so the sign-in page', async ({ browser, page }) => {
  const { partnerIds } = await signInWithSample(page, 'Review Guard');
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: partnerIds[SAMPLE.litware], people: true });
  await page.goto(mapPath(mapId));
  await main(page).getByRole('button', { name: 'Share', exact: true }).click();
  const share = page.getByRole('dialog', { name: 'Share this MAP' });
  await share.getByRole('button', { name: 'Copy link for Lena Ortiz' }).click();
  const url = await share.getByLabel('Link for Lena Ortiz', { exact: true }).inputValue();

  const context = await browser.newContext();
  const guest = await context.newPage();
  await guest.goto(url);
  await expect(guest).toHaveURL(new RegExp(`/m/${mapId}$`));
  await expect(guest.getByRole('link', { name: /Review/ })).toHaveCount(0);
  await guest.goto(reviewPath(mapId));
  await expect(guest).toHaveURL(/\/sign-in/);
  await guest.goto(`${reviewPath(mapId)}/present`);
  await expect(guest).toHaveURL(/\/sign-in/);
  await context.close();
});

test('the Reviews page lists the MAP’s review, and the partner’s page shows the Reviews area, on a phone too', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signInWithSample(page, 'Review Lister');
  await page.goto('/reviews');
  await expect(main(page).getByRole('heading', { level: 1, name: 'Business reviews' })).toBeVisible();
  await expect(main(page)).toContainText('No reviews yet. A review comes up 21 days before a MAP’s horizon ends.');
  expect(await noSidewaysScroll(page)).toBe(true);

  const { mapId, accountId } = await signedMap(page, 'Review Lister Two');
  await page.goto('/reviews');
  const line = main(page).getByRole('link', { name: /Litware Group as reseller/ });
  await expect(line).toHaveAttribute('href', reviewPath(mapId));
  await expect(line).toContainText(`Review on ${shown(84)}`);
  expect(await noSidewaysScroll(page)).toBe(true);

  await page.goto(`/partners/${accountId}`);
  const area = main(page).getByRole('region', { name: 'Business reviews' });
  await expect(area).toContainText(`Review on ${shown(84)}`);
  await expect(area).toContainText('No review has been held yet.');
  expect(await noSidewaysScroll(page)).toBe(true);
});

// ---------------------------------------------------------------------------------------------------------------------
// The summary for the partner (task 11): Send summary, its email, the page behind the link, and Turn off the link.

interface Mail { to: string; subject: string; text: string; html: string; replyTo?: string }

async function mails(page: Page, to: string): Promise<Mail[]> {
  const res = await page.request.get(`/api/test-mail?to=${encodeURIComponent(to)}`);
  expect(res.ok()).toBe(true);
  return ((await res.json()) as { messages: Mail[] }).messages;
}

test('a held review’s summary goes to the partner by email, opens without an account on a phone, prints, and its link can be turned off', async ({ page, browser }) => {
  const tag = `r${Date.now().toString(36)}${Math.floor(Math.random() * 1000)}`;
  const lena = `lena.ortiz+${tag}@example.com`;
  const { mapId } = await signedMap(page, 'Summary Sender', { people: true, emailTag: tag });

  // A prep with a blocker and the Decisions note, then closed.
  await page.goto(reviewPath(mapId));
  await main(page).getByRole('button', { name: 'Start the prep' }).click();
  await main(page).getByRole('button', { name: 'Add blocker' }).click();
  await main(page).getByRole('textbox', { name: 'Add blocker' }).fill('No demo account for their sellers');
  await main(page).getByRole('textbox', { name: 'Add blocker' }).press('Enter');
  await main(page).getByRole('textbox', { name: 'Add blocker' }).press('Escape');
  // A commitment with no owner, due in 30 days.
  await main(page).getByRole('button', { name: 'Make it a commitment' }).click();
  await dueIn(page, 30);
  await waitUntilSaved(page);
  await main(page).getByRole('button', { name: 'Close the review' }).click();
  await page.getByRole('dialog', { name: 'Close the review' }).getByRole('button', { name: 'Close the review' }).click();
  await expect(page).toHaveURL(new RegExp(`${reviewPath(mapId)}/rv_[0-9a-z]+$`));
  await expect(main(page)).toContainText(`Held on ${shown(0)}`);

  // Send summary: Lena, the one partner-side person with an email, ticked; the scorecard off.
  await main(page).getByRole('button', { name: 'Send summary' }).click();
  const dialog = page.getByRole('dialog', { name: 'Send summary' });
  await expect(dialog.getByRole('checkbox', { name: /Lena Ortiz/ })).toBeChecked();
  await expect(dialog).not.toContainText('Ben Ito');
  await expect(dialog.getByRole('checkbox', { name: 'Include the scorecard' })).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Send summary' }).click();
  await expect(dialog).toBeHidden();
  await expect(main(page)).toContainText(`Summary sent on ${shown(0)}`);

  const [mail] = await mails(page, lena);
  expect(mail).toMatchObject({ subject: expect.stringMatching(/^Summary Sender sent you the summary of your review on /) });
  const url = mail!.text.match(/https?:\/\/\S+\/r\/[A-Za-z0-9_-]{43}/)![0];

  // The partner opens it with no account, on a phone: one page, no link into PartnerStandard Desk, nothing of ours.
  const context = await browser.newContext({ viewport: { width: 375, height: 800 } });
  const guest = await context.newPage();
  const response = await guest.goto(url);
  expect(response!.headers()['referrer-policy']).toBe('no-referrer');
  await expect(main(guest).getByRole('heading', { level: 1 })).toHaveText(/Litware Group/);
  await expect(main(guest)).toContainText('No demo account for their sellers');
  await expect(main(guest)).not.toContainText('Decisions');
  await expect(main(guest)).not.toContainText('Is the partner hypothesis still valid?');
  await expect(main(guest)).not.toContainText('Scorecard');
  await expect(guest.getByRole('banner').getByRole('link')).toHaveCount(0);
  expect(await noSidewaysScroll(guest)).toBe(true);
  // The commitment reads on the phone: its due date on screen, and no "No owner" (walkthrough 2026-11-01).
  const commitments = main(guest).getByRole('region', { name: 'Commitments' });
  await expect(commitments).toContainText('No demo account for their sellers');
  await expect(commitments).not.toContainText('No owner');
  const due = commitments.getByText(shown(30, true));
  await expect(due).toBeVisible();
  await onScreenSideways(guest, due);
  await guest.emulateMedia({ media: 'print' });
  await expect(main(guest).getByRole('button', { name: 'Print or save as PDF' })).toBeHidden();
  for (const format of ['A4', 'Letter'] as const) {
    const pdf = await guest.pdf({ format, printBackground: true });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  }

  // Turn off the link: the same page says it doesn't work any more.
  await main(page).getByRole('button', { name: 'Send summary' }).click();
  await page.getByRole('dialog', { name: 'Send summary' }).getByRole('button', { name: 'Turn off the link' }).click();
  await expect(page.getByRole('dialog', { name: 'Send summary' })).toBeHidden();
  await guest.emulateMedia({ media: 'screen' });
  await guest.goto(url);
  await expect(guest.getByRole('heading', { level: 1 })).toHaveText('This link doesn\'t work any more. Ask the person who sent it for a new one.');
  await context.close();
});

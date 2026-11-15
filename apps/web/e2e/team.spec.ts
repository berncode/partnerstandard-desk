import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import { edition } from './edition';

// A company server's team (plan 15, task 7): the first admin invites a partner manager and a viewer by email; each signs
// in from the invite; they share one company's partners, each within their role; a removed member is signed out.
test.beforeEach(() => test.skip(edition() !== 'database', 'Only a company server has members'));

const ADMIN = 'admin@halden.example';
const main = (page: Page) => page.getByRole('main');

type Mail = { subject: string; text: string };
const outbox = async (request: APIRequestContext, to: string): Promise<Mail[]> =>
  ((await (await request.get(`/api/test-mail?to=${encodeURIComponent(to)}`)).json()) as { messages: Mail[] }).messages;

/** The newest email to `to` once there are more than `before`, and the confirm page link in it. */
async function newLink(request: APIRequestContext, to: string, before: number): Promise<{ mail: Mail; link: string }> {
  await expect.poll(async () => (await outbox(request, to)).length).toBeGreaterThan(before);
  const mail = (await outbox(request, to)).at(-1)!;
  const link = mail.text.match(/https?:\/\/\S+\/sign-in\/confirm\?token=[A-Za-z0-9]+/)?.[0];
  expect(link, mail.text).toBeTruthy();
  return { mail, link: link! };
}

/** Opens the link in a new browser and presses Sign in: the person lands on This week. */
async function signInWith(browser: Browser, link: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(link);
  await main(page).getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/this-week$/);
  return page;
}

test('the admin invites a partner manager and a viewer; they share the partners within their roles, a viewer with no button they can’t use; a removed member is signed out', async ({ browser, page, request }) => {
  // Three sign-ins by email link and many page loads.
  test.setTimeout(150_000);
  const suffix = Date.now().toString(36);
  const PM = `pm-${suffix}@halden.example`;
  const VIEWER = `vera-${suffix}@halden.example`;
  const company = `Globex ${suffix}`;

  // The first admin signs in by email link.
  const before = (await outbox(request, ADMIN)).length;
  await page.goto('/sign-in');
  await main(page).getByLabel('Your email').fill(ADMIN);
  await main(page).getByRole('button', { name: 'Email me a link' }).click();
  const admin = await signInWith(browser, (await newLink(request, ADMIN, before)).link);

  // Settings, Members: the admin invites two people.
  await admin.goto('/settings');
  const members = admin.getByRole('region', { name: 'Members' });
  await expect(members.getByText(/\(you\)$/)).toBeVisible();
  for (const [address, role] of [[PM, 'Partner manager'], [VIEWER, 'Viewer']] as const) {
    await members.getByRole('textbox', { name: 'Email' }).fill(address);
    await members.getByRole('combobox', { name: 'Role', exact: true }).selectOption({ label: role });
    await members.getByRole('button', { name: 'Send invite' }).click();
    await expect(members.getByRole('status')).toHaveText(`${address} is invited for 7 days. The invite email is on its way.`);
  }
  await expect(members.getByText(PM)).toBeVisible();

  // The partner manager signs in from the invite and adds a partner.
  const invited = await newLink(request, PM, 0);
  expect(invited.mail.subject).toMatch(/invited you to PartnerStandard Desk$/);
  const pm = await signInWith(browser, invited.link);
  await pm.goto('/partners');
  await main(pm).getByRole('button', { name: 'Add a partner' }).first().click();
  const dialog = pm.getByRole('dialog', { name: 'Add a partner' });
  await dialog.getByLabel('Company').fill(company);
  await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(pm.getByTestId('partner-row').filter({ hasText: company })).toBeVisible();

  // The viewer signs in from theirs: the same partners, read only, and the members, with nothing to change.
  const viewer = await signInWith(browser, (await newLink(request, VIEWER, 0)).link);
  await expect.poll(async () => {
    await viewer.goto('/partners');
    return viewer.getByTestId('partner-row').filter({ hasText: company }).count();
  }).toBe(1);
  await expect(main(viewer).getByText('You’re a viewer: you can read everything here, and change nothing. An admin can change your role.')).toBeVisible();
  await expect(main(viewer).getByRole('button', { name: 'Add a partner' })).toHaveCount(0);
  await viewer.goto('/settings');
  const seen = viewer.getByRole('region', { name: 'Members' });
  await expect(seen.getByRole('listitem').filter({ hasText: PM })).toContainText('Partner manager');
  await expect(seen.getByRole('button', { name: 'Send invite' })).toHaveCount(0);
  await expect(seen.getByRole('combobox')).toHaveCount(0);
  await expect(viewer.getByRole('region', { name: 'Company' }).getByText('Only an admin changes this.')).toBeVisible();

  // A viewer sees no start or change button they can't use (owner, 2026-11-14); the partner manager sees each one.
  // The partner manager adds a partner at MAP and starts its MAP.
  const mapped = `${company} MAP`;
  await pm.goto('/partners');
  await main(pm).getByRole('button', { name: 'Add a partner' }).first().click();
  const adding = pm.getByRole('dialog', { name: 'Add a partner' });
  await adding.getByLabel('Company').fill(mapped);
  await adding.getByLabel('Where are they now?').selectOption({ label: 'MAP' });
  await adding.getByRole('button', { name: 'Add', exact: true }).click();
  // Placed anywhere but Researched, the dialog closes once the partner and its moves are saved.
  await expect(adding).toBeHidden();
  const mappedRow = pm.getByTestId('partner-row').filter({ hasText: mapped });
  await expect(mappedRow).toContainText('MAP');
  await mappedRow.click();
  await expect(pm).toHaveURL(/\/partners\/[^/?]+/);
  const partnerPage = new URL(pm.url()).pathname;
  await main(pm).getByRole('region', { name: 'Mutual Action Plan' }).getByRole('button', { name: 'Start the MAP' }).click();
  await expect(pm).toHaveURL(/\/plans\/map_[0-9a-z]{10}\/start$/);
  const mapPage = new URL(pm.url()).pathname.replace(/\/start$/, '');

  // What only the partner manager sees: each list's start button, the partner's New case, the MAP's own buttons, Add webhook.
  const starts: Array<[string, string]> = [['/markets', 'New market'], ['/markets', 'Copy from another market'], ['/business-cases', 'New case'], ['/programs', 'Add a program']];
  for (const [path, name] of starts) {
    await pm.goto(path);
    await expect(main(pm).getByRole('link', { name, exact: true }).first()).toBeVisible();
    await viewer.goto(path);
    await expect(main(viewer).getByRole('heading', { level: 1 })).toBeVisible();
    // Off Vercel the header's buttons stream in after the page's frame: wait until everything has come in, so a count of 0
    // means the gate answered "viewer", not that it hadn't answered yet (review of 2026-11-14).
    await viewer.waitForLoadState('networkidle');
    await expect(main(viewer).getByRole('link', { name, exact: true })).toHaveCount(0);
  }
  for (const [address, list] of [['/markets/new', '/markets'], ['/business-cases/new', '/business-cases'], ['/programs/new', '/programs']]) {
    await viewer.goto(address!);
    await expect(viewer).toHaveURL(new RegExp(`${list}$`));
  }
  await pm.goto(partnerPage);
  await expect(main(pm).getByRole('region', { name: 'Business case' }).getByRole('button', { name: 'New case' })).toBeVisible();
  await viewer.goto(partnerPage);
  await expect(main(viewer).getByRole('region', { name: 'Mutual Action Plan' }).getByRole('link', { name: 'Open the MAP' })).toBeVisible();
  await expect(main(viewer).getByRole('region', { name: 'Business case' }).getByRole('button', { name: 'New case' })).toHaveCount(0);

  const mapButtons = ['Share', 'Notifications', 'Delete MAP'];
  await pm.goto(mapPage);
  for (const name of mapButtons) await expect(main(pm).getByRole('button', { name, exact: true })).toBeVisible();
  await viewer.goto(mapPage);
  await expect(main(viewer).getByRole('heading', { level: 1, name: `${mapped} as reseller` })).toBeVisible();
  await expect(main(viewer).getByText('You’re a viewer: you can read everything here, and change nothing. An admin can change your role.')).toBeVisible();
  for (const name of mapButtons) await expect(main(viewer).getByRole('button', { name, exact: true })).toHaveCount(0);

  // A viewer is not an editor (owner, 2026-11-14): every page that saves as you type shows a viewer its fields closed,
  // with the viewer line and no Add or Remove; the partner manager types there as before.
  await pm.goto(partnerPage);
  await main(pm).getByRole('region', { name: 'Business case' }).getByRole('button', { name: 'New case' }).click();
  await expect(pm).toHaveURL(/\/business-cases\/case_[0-9a-z]{12}\/offer$/);
  const casePage = new URL(pm.url()).pathname.replace(/\/offer$/, '');
  await pm.goto('/programs/new');
  await main(pm).getByRole('button', { name: /^Reseller/ }).click();
  await expect(pm).toHaveURL(/\/programs\/pg_[0-9a-z]{10}\/why$/);
  const programPage = new URL(pm.url()).pathname.replace(/\/why$/, '');
  await pm.goto('/markets/new');
  await main(pm).getByLabel(/^Market/).first().fill(`Spain ${suffix}`);
  await main(pm).getByLabel('Partner type').selectOption({ label: 'Reseller' });
  await main(pm).getByLabel(/^Our product/).fill('A product');
  await main(pm).getByLabel(/^Our target customers/).fill('Some customers');
  await main(pm).getByRole('button', { name: 'Next' }).click();
  await expect(pm).toHaveURL(/step=2/);
  await main(pm).getByLabel(/^Why the partner route works/).fill('Local trust.');
  await main(pm).getByRole('button', { name: 'Next' }).click();
  await main(pm).getByRole('button', { name: 'Skip' }).click();
  await main(pm).getByRole('button', { name: 'Create market' }).click();
  await expect(pm).toHaveURL(/\/markets\/m_[0-9a-z]{10}$/);
  const marketPage = new URL(pm.url()).pathname;
  // The fields a person can type in, pick or tick, but the filters, which only change what is shown (a MAP's Side, Owner
  // and Status, a market's Show closed and Partner hypothesis): a viewer keeps those.
  const viewOnly = ['Side', 'Owner', 'Status', 'Show closed', 'Partner hypothesis'];
  const typeable = (opened: Page) => main(opened)
    .locator('input:enabled:not([readonly]), select:enabled, textarea:enabled:not([readonly]), [contenteditable="true"]')
    .evaluateAll((fields, names) => fields
      .filter((f) => !names.includes(f.getAttribute('aria-label') ?? f.closest('label')?.textContent?.trim() ?? ''))
      .map((f) => f.outerHTML.slice(0, 160)), viewOnly);
  const typed = [`${casePage}/offer`, casePage, `${casePage}/ours`, `${programPage}/basics`, `${programPage}/money`, '/company-facts'];
  // Text edited in place (a case's title, a partner's details) is a button until clicked (InlineText, `cursor-text`).
  const inPlace = (opened: Page) => main(opened).locator('button.cursor-text:enabled');
  for (const path of typed) {
    await pm.goto(path);
    await expect.poll(async () => (await typeable(pm)).length, path).toBeGreaterThan(0);
  }
  await pm.goto(casePage);
  await expect(main(pm).getByRole('button', { name: /^Title: / })).toBeVisible();
  const readsOnly = async (path: string) => {
    await viewer.goto(path);
    await expect(main(viewer).getByText('You’re a viewer: you can read everything here, and change nothing. An admin can change your role.')).toBeVisible();
    await viewer.waitForLoadState('networkidle');
    expect(await typeable(viewer), path).toEqual([]);
    await expect(inPlace(viewer), path).toHaveCount(0);
    await expect(main(viewer).getByRole('button', { name: /^(\+ )?(Add|Remove)\b/ }), path).toHaveCount(0);
    // Nor the hints about changing something.
    await expect(main(viewer).getByText(/Change the company name in Settings|Changing it changes only the case/), path).toHaveCount(0);
  };
  for (const path of [...typed, `${programPage}/why`, `${programPage}/registered`, `${programPage}/preferred`, partnerPage, mapPage, marketPage]) {
    await readsOnly(path);
  }
  await expect(main(viewer).getByRole('button', { name: /^Title: / })).toHaveCount(0);
  // The guided steps of a new MAP send a viewer to the MAP itself.
  await viewer.goto(`${mapPage}/start`);
  await expect(viewer).toHaveURL(new RegExp(`${mapPage}$`));

  await pm.goto('/settings');
  await expect(pm.getByRole('button', { name: 'Add webhook' })).toBeVisible();
  await viewer.goto('/settings');
  await expect(viewer.getByRole('button', { name: 'Create key' })).toBeVisible();
  await expect(viewer.getByRole('button', { name: 'Add webhook' })).toHaveCount(0);
  // A viewer still makes a Read only key: the one level the dialog offers.
  await viewer.getByRole('button', { name: 'Create key' }).click();
  await expect(viewer.getByRole('dialog', { name: 'Create key' }).getByRole('radio')).toHaveCount(1);
  await expect(viewer.getByRole('dialog', { name: 'Create key' }).getByRole('radio', { name: /^Read only/ })).toBeChecked();
  await viewer.keyboard.press('Escape');

  // The admin removes the viewer: their next request is signed out.
  await admin.goto('/settings');
  await admin.getByRole('region', { name: 'Members' }).getByRole('button', { name: new RegExp(`^Remove ${VIEWER}$`) }).click();
  await admin.getByRole('dialog', { name: `Remove ${VIEWER}?` }).getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(admin.getByRole('region', { name: 'Members' }).getByText(VIEWER)).toHaveCount(0);
  await viewer.goto('/partners');
  await expect(viewer).toHaveURL(/\/sign-in/);
  for (const opened of [admin, pm, viewer]) await opened.context().close();
});

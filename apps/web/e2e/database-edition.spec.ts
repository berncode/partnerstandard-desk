import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { edition } from './edition';
import { serverEnv } from './servers';

// Only the company server's (plan 13, task 14): its work is in its own database, never in Google Drive.
test.beforeEach(() => test.skip(edition() !== 'database', 'Only the database edition keeps the work in its own database'));

const main = (page: Page) => page.getByRole('main');

async function signInWithSample(page: Page, name: string) {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=/partners`);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample', twoTypes: true, feedingProgram: true } });
  expect(seeded.ok()).toBe(true);
  return (await seeded.json()) as { marketIds: string[]; acmeAccountId: string; acmePartnerIds: { reseller: string }; programId: string };
}

test('no signed-in page of a company server speaks of Google, Drive or Sheets', async ({ page }) => {
  const seeded = await signInWithSample(page, 'Edition Reader');
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'case', partnerId: seeded.acmePartnerIds.reseller, programId: seeded.programId } });
  expect(made.ok()).toBe(true);
  const { caseId } = (await made.json()) as { caseId: string };
  const map = await page.request.post('/api/test-seed', { data: { fixture: 'map', partnerId: seeded.acmePartnerIds.reseller } });
  expect(map.ok()).toBe(true);
  const { mapId } = (await map.json()) as { mapId: string };
  const pages = [
    '/this-week', '/partners', `/partners/${seeded.acmeAccountId}`, '/markets', `/markets/${seeded.marketIds[0]}`, '/programs',
    `/programs/${seeded.programId}/basics`, `/programs/${seeded.programId}/sheet`, '/company-facts', '/business-cases', `/business-cases/${caseId}`,
    '/plans', `/plans/${mapId}`, '/reviews', '/call-guide', '/guide', '/settings',
  ];
  for (const path of pages) {
    await page.goto(path);
    await expect(main(page)).toBeVisible();
    // Everything streamed is in: the page's own loading states are gone.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 15_000 });
    const text = await page.locator('body').innerText();
    // Google Meet in the call guide is a note-taker, not where the work lives. "Program Sheet" is our own name.
    expect(text, path).not.toMatch(/\bGoogle\b(?! Meet)|\bDrive\b|\bSheets\b/);
  }
});

test('PartnerStandard’s legal pages answer “not found”, and the footer links none when the company set none', async ({ page }) => {
  for (const path of ['/privacy', '/terms', '/imprint']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
  }
  await page.goto('/sign-in');
  const footer = page.getByRole('contentinfo');
  await expect(footer.getByRole('link', { name: 'Knowledge Hub' })).toBeVisible();
  await expect(footer.getByRole('link')).toHaveCount(1);
  await expect(page.getByText('By continuing you agree to the', { exact: false })).toHaveCount(0);
});

test('the first admin signs in by email link: the link opens a confirm page, and only its button signs in (plan 14)', async ({ browser, page, request }) => {
  const ADMIN = 'admin@halden.example';
  const before = ((await (await request.get(`/api/test-mail?to=${encodeURIComponent(ADMIN)}`)).json()) as { messages: unknown[] }).messages.length;
  // Signed out: the landing page offers the email sign-in, and only that (owner, 2026-11-14: the team's door).
  await page.goto('/');
  await expect(page.getByText('Your work stays in')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Google/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in$/);
  await expect(main(page).getByText('Your partner work lives in your company’s own database, on its own server.')).toBeVisible();
  await expect(main(page).getByRole('button', { name: /Google/ })).toHaveCount(0);

  // Another address gets the same answer, and no email.
  await main(page).getByLabel('Your email').fill('mallory@elsewhere.example');
  await main(page).getByRole('button', { name: 'Email me a link' }).click();
  await expect(main(page).getByRole('status')).toHaveText('Check your email. If this address may sign in here, a link is on its way. It works once, for 15 minutes.');
  await main(page).getByLabel('Your email').fill(` ${ADMIN.toUpperCase()} `);
  await main(page).getByRole('button', { name: 'Email me a link' }).click();
  await expect(main(page).getByRole('status')).toHaveText('Check your email. If this address may sign in here, a link is on its way. It works once, for 15 minutes.');

  const outbox = async (to: string) => ((await (await request.get(`/api/test-mail?to=${encodeURIComponent(to)}`)).json()) as { messages: Array<{ subject: string; text: string }> }).messages;
  expect(await outbox('mallory@elsewhere.example')).toEqual([]);
  // Counted from what was there: the team test signs the same admin in (plan 15).
  await expect.poll(async () => (await outbox(ADMIN)).length).toBe(before + 1);
  const mail = (await outbox(ADMIN)).at(-1);
  expect(mail!.subject).toBe('Sign in to PartnerStandard Desk');
  const link = mail!.text.match(/https?:\/\/\S+\/sign-in\/confirm\?token=[A-Za-z0-9]+/)?.[0];
  expect(link, mail!.text).toBeTruthy();
  expect(mail!.text).not.toContain('/api/auth/magic-link');

  // A link scanner's visit, and the plugin's own link, sign nobody in and leave the link working.
  const token = new URL(link!).searchParams.get('token')!;
  const scan = await request.get(link!);
  expect(scan.status(), (await scan.text()).slice(0, 300)).toBe(200);
  expect((await request.get(`/api/auth/magic-link/verify?token=${token}`)).status()).toBe(404);

  await page.goto(link!);
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(`Sign in to PartnerStandard Desk as ${ADMIN}?`);
  await main(page).getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/this-week$/);
  await page.goto('/settings');
  await expect(page.getByText(ADMIN, { exact: false }).first()).toBeVisible();

  // The same link a second time, in another browser, signs nobody in.
  const other = await browser.newContext();
  try {
    const second = await other.newPage();
    await second.goto(link!);
    await expect(main(second).getByRole('alert')).toHaveText('This link was used already or is too old. Ask for a new one.');
    await expect(main(second).getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
  } finally {
    await other.close();
  }
});

test('a save survives a restart: another server process on the same database file shows it', async ({ page }) => {
  // Starting a server takes a while: more than the default 30 seconds (task 14's review).
  test.setTimeout(120_000);
  await page.goto('/api/test-auth?name=Restart+Keeper&next=/partners');
  const add = await page.request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(add.ok()).toBe(true);
  await page.goto('/partners');
  await expect(main(page).getByText('Tailspin Solutions').first()).toBeVisible();

  // A second server from the same build and the same database file, as after a restart: nothing kept in memory.
  const port = 3809;
  const health = `http://127.0.0.1:${port}/api/health`;
  const answers = async () => (await fetch(health).catch(() => null))?.status ?? 0;
  // A server left over from an earlier run would serve another database: there must be none.
  expect(await answers(), `something already answers on port ${port}`).toBe(0);
  const web = resolve(__dirname, '..');
  const env: NodeJS.ProcessEnv = { ...serverEnv('database'), NODE_ENV: 'production', PORT: String(port), HOSTNAME: '127.0.0.1', APP_URL: `http://127.0.0.1:${port}` };
  const server: ChildProcess = spawn(process.execPath, [`${web}/.next/standalone/apps/web/server.js`], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  server.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const exited = new Promise<number | null>((done) => server.once('exit', (code) => done(code)));
  try {
    await expect.poll(async () => {
      if (server.exitCode !== null) throw new Error(`the second server stopped (${server.exitCode}): ${stderr.slice(-2000)}`);
      return answers();
    }, { timeout: 60_000 }).toBe(200);
    // The session cookie is the same host's, and its session is in the same database.
    await page.goto(`http://127.0.0.1:${port}/partners`);
    await expect(main(page).getByText('Tailspin Solutions').first()).toBeVisible();
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
    await exited;
  }
});

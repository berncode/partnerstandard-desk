import { createHmac } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { expect, test, type Page } from '@playwright/test';
import { appUrl } from './edition';

// Settings, "Agents and API" (agents spec 4.5, 7.1): an API key made, used and turned off; a webhook to a receiver in
// this test (the e2e server allows a local http address: WEBHOOKS_ALLOW_PRIVATE in playwright.config.ts), checked
// with the Standard Webhooks signature and the secret shown once.

async function signIn(page: Page, name: string) {
  await page.goto(`/api/test-auth?name=${encodeURIComponent(name)}&next=/settings`);
  await expect(page).toHaveURL(/\/settings$/);
}

const panel = (page: Page) => page.getByRole('region', { name: 'Agents and API' });
const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

/** Makes an API key in Settings (Read only unless a level's label is given) and answers it, read from the dialog that shows it once. */
async function createKey(page: Page, name: string, level?: string): Promise<string> {
  await panel(page).getByRole('button', { name: 'Create key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create key' });
  await dialog.getByLabel('Name').fill(name);
  await expect(dialog.getByRole('radio', { name: /^Read only/ })).toBeChecked();
  if (level) await dialog.getByRole('radio', { name: new RegExp(`^${level}`) }).check();
  await dialog.getByRole('button', { name: 'Create key' }).click();
  const made = page.getByRole('dialog', { name: 'Your new API key' });
  await expect(made.getByText('Copy this key now. It can’t be shown again.')).toBeVisible();
  const key = await made.getByLabel(`API key ${name}`).inputValue();
  expect(key).toMatch(/^pd_[\w-]{43}$/);
  await made.getByRole('button', { name: 'Done' }).click();
  await expect(made).toBeHidden();
  return key;
}

/** Adds a webhook in Settings and answers its signing secret, read from the dialog that shows it once. */
async function addWebhook(page: Page, url: string, event = 'A partner is signed'): Promise<string> {
  await panel(page).getByRole('button', { name: 'Add webhook' }).click();
  const dialog = page.getByRole('dialog', { name: 'Add webhook' });
  await dialog.getByLabel('Address').fill(url);
  await dialog.getByRole('checkbox', { name: new RegExp(`^${event}`) }).check();
  await dialog.getByRole('button', { name: 'Add webhook' }).click();
  const made = page.getByRole('dialog', { name: 'Your new webhook' });
  const secret = await made.getByLabel('Signing secret').inputValue();
  expect(secret).toMatch(/^whsec_/);
  await made.getByRole('button', { name: 'Done' }).click();
  await expect(made).toBeHidden();
  return secret;
}

interface Received { headers: IncomingHttpHeaders; body: string }

/** A webhook receiver on a free local port: notes each request and answers 200, or `statuses` in turn (200 after them). */
async function receiver(statuses: number[] = []): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => { body += chunk; });
    request.on('end', () => {
      received.push({ headers: request.headers, body });
      response.writeHead(statuses[received.length - 1] ?? 200).end('ok');
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/hooks/partner-desk`, received };
}

test('create a key, use it on /api/v1/partners, turn it off, the next call is 401', async ({ page, request }) => {
  await signIn(page, 'Key Maker');
  // A Partners file to read: a new test user has none until it is made.
  expect((await page.request.post('/api/test-seed', { data: { fixture: 'sample' } })).ok()).toBe(true);
  await expect(panel(page).getByText('No API keys yet.')).toBeVisible();
  await expect(panel(page).getByText('No agents connected yet.')).toBeVisible();
  await expect(panel(page).getByText(`${appUrl()}/mcp`, { exact: true })).toBeVisible();

  const key = await createKey(page, 'n8n e2e');
  const row = panel(page).getByRole('listitem', { name: 'n8n e2e' });
  await expect(row).toContainText(`${key.slice(0, 8)}…`);
  await expect(row).toContainText('Read only');
  await expect(row).toContainText('Not used yet');
  // The key itself is gone from the page once the dialog closed.
  expect(await page.content()).not.toContain(key);

  // `request` sends no cookies: only the key signs it.
  const auth = { authorization: `Bearer ${key}` };
  const listed = await request.get('/api/v1/partners', { headers: auth });
  expect(listed.status()).toBe(200);
  expect(((await listed.json()) as { items: unknown[] }).items.length).toBeGreaterThan(0);

  await row.getByRole('button', { name: 'Turn off n8n e2e' }).click();
  const confirm = page.getByRole('dialog', { name: 'Turn off n8n e2e?' });
  await confirm.getByRole('button', { name: 'Turn off' }).click();
  await expect(confirm).toBeHidden();
  await expect(panel(page).getByText('No API keys yet.')).toBeVisible();
  expect((await request.get('/api/v1/partners', { headers: auth })).status()).toBe(401);

  // A reload agrees.
  await page.reload();
  await expect(panel(page).getByText('No API keys yet.')).toBeVisible();
});

test('a key at "Read, change and propose": it proposes through the API, and its row says how many proposals wait', async ({ page, request }) => {
  await signIn(page, 'Key Proposer');
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(seeded.ok()).toBe(true);
  const { accountIds } = (await seeded.json()) as { accountIds: string[] };

  // Three levels in the dialog, Read only first and picked.
  await panel(page).getByRole('button', { name: 'Create key' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create key' });
  await expect(dialog.getByRole('radio')).toHaveCount(3);
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  const key = await createKey(page, 'Proposer e2e', 'Read, change and propose');
  const row = panel(page).getByRole('listitem', { name: 'Proposer e2e' });
  await expect(row).toContainText('Read, change and propose');
  await expect(row).not.toContainText('waiting');

  // The key proposes desk check scores for the sample book's Adatum Advisory (Recruitment, reseller; 3 in the seed's order).
  const auth = { authorization: `Bearer ${key}` };
  const partner = (await (await request.get(`/api/v1/partners/${accountIds[3]}`, { headers: auth })).json()) as {
    partners: Array<{ id: string; updatedAt: string | null; desk: Record<string, number | null> }>;
  };
  const first = partner.partners[0]!;
  const made = await request.post('/api/v1/proposals/4c-scores', {
    headers: auth, data: { partnerId: first.id, expectedUpdatedAt: first.updatedAt, letters: { credibility: { score: first.desk.credibility === 3 ? 1 : 3, evidence: 'Their site lists ten customers.' } } },
  });
  expect(made.status()).toBe(200);

  await page.reload();
  await expect(panel(page).getByRole('listitem', { name: 'Proposer e2e' })).toContainText('1 proposal waiting');
});

test('add a webhook to the e2e receiver, Send test arrives signed', async ({ page }) => {
  const { server, url, received } = await receiver();
  try {
    await signIn(page, 'Hook Maker');
    await expect(panel(page).getByText('No webhooks yet.')).toBeVisible();
    const secret = await addWebhook(page, url);
    expect(await page.content()).not.toContain(secret);

    const row = panel(page).getByRole('listitem', { name: url });
    await expect(row).toContainText('On');
    await expect(row).toContainText('partner.signed');
    await row.getByRole('button', { name: `Send test to ${url}` }).click();
    await expect(row.getByRole('status')).toHaveText('Test sent.');

    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);
    const [{ headers, body }] = received as [Received];
    const id = String(headers['webhook-id']);
    const timestamp = String(headers['webhook-timestamp']);
    const signed = createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
    expect(String(headers['webhook-signature']).split(' ')).toContain(`v1,${signed}`);
    expect(Math.abs(Date.now() / 1000 - Number(timestamp))).toBeLessThan(60);
    const event = JSON.parse(body) as { type: string; id: string; data: Record<string, string> };
    expect(event).toMatchObject({ type: 'webhook.test', id, data: { webhookId: expect.stringMatching(/^wh_/) } });

    // The row's last deliveries show the answer, without a reload.
    const deliveries = row.getByRole('table');
    await expect(deliveries.getByRole('row').nth(1)).toContainText('webhook.test');
    await expect(deliveries.getByRole('row').nth(1)).toContainText('200', { timeout: 15_000 });

    // Turned off and on again, then deleted.
    await row.getByRole('button', { name: `Turn off ${url}` }).click();
    await expect(row).toContainText('Turned off');
    await row.getByRole('button', { name: `Turn on ${url}` }).click();
    await expect(row.getByRole('button', { name: `Turn off ${url}` })).toBeVisible();
    await row.getByRole('button', { name: `Delete ${url}` }).click();
    await page.getByRole('dialog', { name: 'Delete this webhook?' }).getByRole('button', { name: 'Delete' }).click();
    await expect(panel(page).getByText('No webhooks yet.')).toBeVisible();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

/** Whether a request carries the Standard Webhooks signature made with `secret`. */
function signedWith(secret: string, { headers, body }: Received): boolean {
  const signed = createHmac('sha256', Buffer.from(secret.slice('whsec_'.length), 'base64'))
    .update(`${String(headers['webhook-id'])}.${String(headers['webhook-timestamp'])}.${body}`).digest('base64');
  return String(headers['webhook-signature']).split(' ').includes(`v1,${signed}`);
}

test('a failed delivery is sent again with the same webhook-id', async ({ page }) => {
  // The receiver answers 500 to its first request and 200 after.
  const { server, url, received } = await receiver([500]);
  try {
    await signIn(page, 'Hook Again');
    const secret = await addWebhook(page, url);
    const row = panel(page).getByRole('listitem', { name: url });
    await row.getByRole('button', { name: `Send test to ${url}` }).click();
    await expect(row.getByRole('status')).toHaveText('Test sent.');
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(1);
    const delivery = row.getByRole('table').getByRole('row').nth(1);
    await expect(delivery).toContainText('500', { timeout: 15_000 });

    await delivery.getByRole('button', { name: /^Send again: webhook\.test of .+$/ }).click();
    await expect(row.getByRole('status')).toHaveText('Sent again.');
    await expect.poll(() => received.length, { timeout: 20_000 }).toBe(2);
    await expect(delivery).toContainText('200', { timeout: 15_000 });
    await expect(delivery.getByRole('button')).toHaveCount(0);

    const [first, second] = received as [Received, Received];
    expect(second.headers['webhook-id']).toBe(first.headers['webhook-id']);
    expect(Number(second.headers['webhook-timestamp'])).toBeGreaterThanOrEqual(Number(first.headers['webhook-timestamp']));
    expect(signedWith(secret, first)).toBe(true);
    expect(signedWith(secret, second)).toBe(true);
    expect(second.body).toBe(first.body);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test('the panel at 375 px has no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await signIn(page, 'Narrow Screen With A Rather Long Name');
  await createKey(page, 'Make scenario for the narrow screen 0001');
  // A long address, never called: the receiver isn't needed to add it.
  await addWebhook(page, `http://127.0.0.1:9/hooks/${'a-very-long-path-segment-'.repeat(6)}end?with=query&and=more`, 'A review is coming up');
  await panel(page).getByRole('listitem').last().getByText('Last deliveries').click();
  await expect(panel(page)).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
  // The dialogs fit too.
  await panel(page).getByRole('button', { name: 'Create key' }).click();
  await expect(page.getByRole('dialog', { name: 'Create key' })).toBeVisible();
  expect(await noSidewaysScroll(page)).toBe(true);
});

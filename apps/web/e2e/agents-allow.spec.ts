import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { appUrl } from './edition';

// An agent app (an MCP client) connecting through the allow page, as Claude Code does (what the
// clients sent in the live check). Its callback runs on this machine; here the browser's visit to it is answered by the test.
const CALLBACK = 'http://127.0.0.1:5173/callback';
/** What a connector asks for today: all three levels. An app picks fewer by asking for fewer when it opens the page. */
const ALL_SCOPES = 'pd.read pd.change pd.propose offline_access';
const TWO_LEVELS = 'pd.read pd.change offline_access';

/**
 * Registers an app without a session, as agent apps do before anyone signs in. Once per name for the whole file: the
 * provider allows 5 registrations a minute from one address.
 */
const registered = new Map<string, string>();
async function registerApp(request: APIRequestContext, name = 'Claude Code (partner-desk)'): Promise<string> {
  const known = registered.get(name);
  if (known) return known;
  const res = await request.post('/api/auth/oauth2/register', {
    data: {
      client_name: name, redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
      token_endpoint_auth_method: 'none', scope: ALL_SCOPES,
    },
  });
  expect(res.status()).toBe(201);
  const clientId = ((await res.json()) as { client_id: string }).client_id;
  registered.set(name, clientId);
  return clientId;
}

/** The address the app opens in the browser, with a fresh PKCE pair. */
function authorizeUrl(clientId: string, scope = TWO_LEVELS): { url: string; verifier: string } {
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    redirect_uri: CALLBACK, scope, state: 'state-e2e', resource: `${appUrl()}/mcp`, prompt: 'consent',
  });
  return { url: `/api/auth/oauth2/authorize?${params}`, verifier };
}

/** Answers the browser's visit to the app's callback, which nothing serves in the test. */
async function catchCallback(page: Page) {
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Back in the app</p>' }));
}

test('a registered client reaches the allow page, which names where it sends you back; Allow with Read only returns a code to its redirect URI', async ({ page, request }) => {
  const clientId = await registerApp(request);
  await page.goto('/api/test-auth?name=Anna&next=/this-week');
  await catchCallback(page);
  const { url, verifier } = authorizeUrl(clientId);
  const shown = await page.goto(url);

  await expect(page).toHaveURL(/\/oauth\/allow\?/);
  // Never inside another site's frame, never sent on as a referrer, kept out of search engines.
  expect(shown?.headers()).toMatchObject({
    'x-frame-options': 'DENY', 'content-security-policy': "frame-ancestors 'none'", 'referrer-policy': 'no-referrer', 'x-robots-tag': 'noindex, nofollow',
  });
  await expect(page.getByRole('heading', { name: 'Allow Claude Code (partner-desk) to use PartnerStandard Desk?' })).toBeVisible();
  // Where the app sends you back: the host of its return address, never the path.
  await expect(page.getByText('After you allow it, you go back to 127.0.0.1:5173.')).toBeVisible();
  await expect(page.getByText('127.0.0.1:5173', { exact: true })).toBeVisible();
  await expect(page.getByText('/callback')).toHaveCount(0);
  await expect(page.getByText('It acts in your name, Anna, with your access. You can turn it off in Settings at any time.')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Read only/ })).toBeChecked();
  // The app asked for two levels: no third.
  await expect(page.getByRole('radio')).toHaveCount(2);
  await page.getByRole('button', { name: 'Allow' }).click();

  await page.waitForURL((address) => address.href.startsWith(CALLBACK));
  const back = new URL(page.url());
  expect(back.searchParams.get('state')).toBe('state-e2e');
  const code = back.searchParams.get('code');
  expect(code).toBeTruthy();

  // The app swaps the code for its tokens: Read only, with a refresh token.
  const token = await request.post('/api/auth/oauth2/token', {
    form: { grant_type: 'authorization_code', code: code!, code_verifier: verifier, redirect_uri: CALLBACK, client_id: clientId, resource: `${appUrl()}/mcp` },
  });
  expect(token.status()).toBe(200);
  const tokens = (await token.json()) as { access_token?: string; refresh_token?: string; scope: string };
  expect(tokens.scope).toBe('pd.read offline_access');
  expect(tokens.access_token).toBeTruthy();
  expect(tokens.refresh_token).toBeTruthy();
});

/** The propose tools (agent proposals spec 6.1, 6.2): only at "Read, change and propose". */
const PROPOSE_TOOLS = [
  'propose_4c_scores', 'propose_stage', 'propose_close', 'propose_signed', 'propose_partners', 'propose_hypothesis_status',
  'propose_market_status', 'withdraw_proposal',
];

/** tools/list through POST /mcp with the token, from a client with no cookies: the tools' names. */
async function toolNames(request: APIRequestContext, token: string): Promise<string[]> {
  const response = await request.post('/mcp', {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    data: { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
  });
  expect(response.status()).toBe(200);
  const text = await response.text();
  const json = text.startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: ')) ?? 'data: null').slice('data: '.length);
  return (JSON.parse(json) as { result: { tools: Array<{ name: string }> } }).result.tools.map((t) => t.name);
}

test('allow at the third level and the connector lists the propose tools', async ({ page, request }) => {
  const clientId = await registerApp(request);
  await page.goto('/api/test-auth?name=Anna&next=/this-week');
  await catchCallback(page);
  const { url, verifier } = authorizeUrl(clientId, ALL_SCOPES);
  await page.goto(url);

  // Three levels, Read only first and picked: proposing is the person's choice, never the default.
  const radios = page.getByRole('radio');
  await expect(radios).toHaveCount(3);
  await expect(radios.nth(0)).toHaveAccessibleName(/^Read only/);
  await expect(radios.nth(0)).toBeChecked();
  const third = page.getByRole('radio', { name: /^Read, change and propose/ });
  await expect(third).not.toBeChecked();
  await expect(page.getByText('Each proposal waits for you in PartnerStandard Desk. Nothing changes until you accept it.', { exact: false })).toBeVisible();
  await third.check();
  await page.getByRole('button', { name: 'Allow' }).click();

  await page.waitForURL((address) => address.href.startsWith(CALLBACK));
  const code = new URL(page.url()).searchParams.get('code')!;
  const token = await request.post('/api/auth/oauth2/token', {
    form: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CALLBACK, client_id: clientId, resource: `${appUrl()}/mcp` },
  });
  expect(token.status()).toBe(200);
  const tokens = (await token.json()) as { access_token: string; scope: string };
  expect(tokens.scope.split(' ').sort()).toEqual(ALL_SCOPES.split(' ').sort());
  expect(await toolNames(request, tokens.access_token)).toEqual(expect.arrayContaining([...PROPOSE_TOOLS, 'list_proposals', 'log_call']));

  // Settings names the level in words.
  await page.goto('/settings');
  const row = page.getByRole('region', { name: 'Agents and API' }).getByRole('listitem', { name: 'Claude Code (partner-desk)' });
  await expect(row).toContainText('Read, change and propose');
});

test('Cancel returns access_denied', async ({ page, request }) => {
  const clientId = await registerApp(request);
  await page.goto('/api/test-auth?name=Anna&next=/this-week');
  await catchCallback(page);
  await page.goto(authorizeUrl(clientId).url);
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.waitForURL((address) => address.href.startsWith(CALLBACK));
  const back = new URL(page.url());
  expect(back.searchParams.get('error')).toBe('access_denied');
  expect(back.searchParams.get('code')).toBeNull();
});

test('signed out, the app’s request goes through sign-in and back to the allow page', async ({ page, request }) => {
  const clientId = await registerApp(request);
  await page.goto(authorizeUrl(clientId).url);
  await expect(page).toHaveURL(/\/sign-in\?.*client_id=/);
  await page.getByRole('link', { name: 'Continue with a test account' }).click();
  await expect(page).toHaveURL(/\/oauth\/allow\?/);
  await expect(page.getByRole('heading', { name: 'Allow Claude Code (partner-desk) to use PartnerStandard Desk?' })).toBeVisible();
});

test('signed out, Continue with Google on an app’s way asks Google for the same scopes as always (hosted only: a company server signs in by email link, in database-edition.spec.ts)', { tag: '@drive-only' }, async ({ page, request }) => {
  const clientId = await registerApp(request);
  await page.route('https://accounts.google.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Google</p>' }));
  await page.goto(authorizeUrl(clientId).url);
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  await page.waitForURL(/^https:\/\/accounts\.google\.com\//);
  const google = new URL(page.url());
  expect(google.searchParams.get('scope')?.split(' ').sort()).toEqual(['email', 'https://www.googleapis.com/auth/drive.file', 'openid', 'profile']);
  expect(google.searchParams.get('access_type')).toBe('offline');
  expect(google.searchParams.get('prompt')).toBe('select_account consent');
  expect(google.searchParams.get('redirect_uri')).toBe(`${appUrl()}/api/auth/callback/google`);
});

test('a changed request shows that it has run out, and offers nothing to allow', async ({ page, request }) => {
  const clientId = await registerApp(request);
  await page.goto('/api/test-auth?name=Anna&next=/this-week');
  await page.goto(authorizeUrl(clientId).url);
  await expect(page).toHaveURL(/\/oauth\/allow\?/);
  await page.goto(page.url().replace('state=state-e2e', 'state=changed'));
  await expect(page.getByRole('heading', { name: 'This request has run out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Allow' })).toHaveCount(0);
});

test('the page at 375 px has no sideways scroll', async ({ page, request }) => {
  const clientId = await registerApp(request, 'An app with a rather long name that someone typed for their connector');
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/api/test-auth?name=Anna&next=/this-week');
  // All three levels, the third's longer text too.
  await page.goto(authorizeUrl(clientId, ALL_SCOPES).url);
  await expect(page.getByRole('radio')).toHaveCount(3);
  await expect(page.getByRole('button', { name: 'Allow' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

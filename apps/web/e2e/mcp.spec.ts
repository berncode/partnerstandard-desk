import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { appUrl } from './edition';

// An agent that connects with an API key, as n8n or a script does, through POST /mcp (agents spec 4.4, 5). The key
// comes from the test seed: Settings' API keys are Task 10.

/** The sample book's Adatum Advisory (Recruitment, reseller), in /api/test-seed's order. */
const ADATUM = 3;
const KEY_NAME = 'n8n e2e';

/** Signs a new test user in, seeds the sample book, makes an API key, and answers the ids and the key. */
async function signInWithKey(page: Page, level: 'read' | 'change' | 'propose') {
  await page.goto('/api/test-auth?name=Anna&next=/partners');
  await expect(page).toHaveURL(/\/partners/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(seeded.ok()).toBe(true);
  const { accountIds } = (await seeded.json()) as { accountIds: string[] };
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'apiKey', name: KEY_NAME, level } });
  expect(made.ok()).toBe(true);
  return { accountIds, ...((await made.json()) as { keyId: string; key: string }) };
}

interface RpcAnswer { result?: Record<string, unknown>; error?: { code: number; message: string } }

/**
 * One JSON-RPC request to /mcp with the key, from a client with no cookies (the `request` fixture), as an agent's app.
 * The answer comes as JSON or as one server-sent event.
 */
async function rpc(request: APIRequestContext, key: string, method: string, params: Record<string, unknown> = {}, id = 1) {
  const response = await request.post('/mcp', {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18' },
    data: { jsonrpc: '2.0', id, method, params },
  });
  const text = await response.text();
  const json = text.startsWith('{') ? text : (text.split('\n').find((l) => l.startsWith('data: ')) ?? 'data: null').slice('data: '.length);
  return { status: response.status(), headers: response.headers(), body: (response.ok() ? JSON.parse(json) : null) as RpcAnswer | null };
}

/** A tools/call's result, which must not be an error. */
async function callTool(request: APIRequestContext, key: string, name: string, args: Record<string, unknown>) {
  const { status, body } = await rpc(request, key, 'tools/call', { name, arguments: args });
  expect(status).toBe(200);
  const result = body?.result as { isError?: boolean; structuredContent?: Record<string, unknown>; content: Array<{ text: string }> };
  expect(result.isError, result.content?.[0]?.text).toBeFalsy();
  return result.structuredContent!;
}

test('initialize, tools/list, then get_partner and log_call through POST /mcp; the partner page and get_partner name "Desk Agent for Anna" as who logged the call', async ({ page, request }) => {
  const { accountIds, key } = await signInWithKey(page, 'change');
  const accountId = accountIds[ADATUM]!;

  const init = await rpc(request, key, 'initialize', {
    protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1.0.0' },
  });
  expect(init.status).toBe(200);
  expect(init.headers['mcp-session-id']).toBeUndefined();
  expect(init.body?.result).toMatchObject({ serverInfo: { name: 'partner-desk' } });
  expect(String(init.body?.result?.instructions)).toContain('PartnerStandard Desk');

  const list = await rpc(request, key, 'tools/list', {}, 2);
  const names = ((list.body?.result as { tools: Array<{ name: string }> }).tools).map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining(['get_partner', 'log_call', 'list_partners', 'calculate_case']));
  expect(names).not.toContain('move_stage');

  const partner = await callTool(request, key, 'get_partner', { accountId });
  expect(partner).toMatchObject({ account: { id: accountId, company: 'Adatum Advisory' }, calls: [] });

  const logged = await callTool(request, key, 'log_call', {
    accountId, partnerType: 'reseller', date: '2026-10-30', kind: 'discovery',
    notes: 'Revenue Model\nLicenses and support contracts\n\nCustomer Pains: Slow onboarding of new staff',
  });
  expect(logged).toMatchObject({
    topicsFound: true,
    call: { kind: 'discovery', updatedBy: `Desk Agent for Anna`, topics: { revenueModel: 'Licenses and support contracts', customerPains: 'Slow onboarding of new staff' } },
  });

  // The person sees it on the partner page with who logged it, also on a phone, and reading it again names them too.
  await page.goto(`/partners/${accountId}`);
  const calls = page.getByRole('region', { name: 'Calls' });
  await expect(calls.getByTestId('call')).toHaveCount(1);
  await expect(calls.getByTestId('call')).toContainText('Licenses and support contracts');
  await expect(calls.getByTestId('call').getByText(`Last updated by Desk Agent for Anna.`)).toBeVisible();
  await page.setViewportSize({ width: 375, height: 800 });
  await expect(calls.getByTestId('call').getByText(`Last updated by Desk Agent for Anna.`)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const again = await callTool(request, key, 'get_partner', { accountId });
  expect(again.calls).toEqual([expect.objectContaining({ updatedBy: `Desk Agent for Anna` })]);
});

test('a revoked key gets 401 on the next request, with the header that says where to sign in', async ({ page, request }) => {
  const { key, keyId } = await signInWithKey(page, 'read');
  const before = await rpc(request, key, 'tools/list');
  expect(before.status).toBe(200);

  const revoked = await page.request.post('/api/test-seed', { data: { fixture: 'revokeApiKey', keyId } });
  expect(revoked.ok()).toBe(true);

  const after = await rpc(request, key, 'tools/list');
  expect(after.status).toBe(401);
  expect(after.headers['www-authenticate']).toContain('invalid_token');
  expect(after.headers['www-authenticate']).toContain('/.well-known/oauth-protected-resource/mcp');
});

/** The propose tools and withdraw_proposal (agent proposals spec 6.1, 6.2): only at "Read, change and propose". */
const PROPOSE_TOOLS = [
  'propose_4c_scores', 'propose_stage', 'propose_close', 'propose_signed', 'propose_partners', 'propose_hypothesis_status',
  'propose_market_status', 'withdraw_proposal',
];
const CALLBACK = 'http://127.0.0.1:5173/callback';
const ALL_SCOPES = 'pd.read pd.change pd.propose offline_access';

test('a propose-level connector lists the propose tools; a change-level key lists none of them', async ({ page, request }) => {
  await signInWithKey(page, 'read');
  // The connector registers, the person allows "Read, change and propose" on the allow page, and the app gets its token.
  const registered = await request.post('/api/auth/oauth2/register', {
    data: {
      client_name: 'Claude (proposals e2e)', redirect_uris: [CALLBACK], grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'], token_endpoint_auth_method: 'none', scope: ALL_SCOPES,
    },
  });
  expect(registered.status()).toBe(201);
  const clientId = ((await registered.json()) as { client_id: string }).client_id;
  await page.route(`${CALLBACK}**`, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>Back in the app</p>' }));
  const verifier = randomBytes(32).toString('base64url');
  const params = new URLSearchParams({
    response_type: 'code', client_id: clientId, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256',
    redirect_uri: CALLBACK, scope: ALL_SCOPES, state: 'state-e2e', resource: `${appUrl()}/mcp`, prompt: 'consent',
  });
  await page.goto(`/api/auth/oauth2/authorize?${params}`);
  await page.getByRole('radio', { name: /Read, change and propose/ }).check();
  await page.getByRole('button', { name: 'Allow' }).click();
  await page.waitForURL((address) => address.href.startsWith(CALLBACK));
  const code = new URL(page.url()).searchParams.get('code')!;
  const token = await request.post('/api/auth/oauth2/token', {
    form: { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: CALLBACK, client_id: clientId, resource: `${appUrl()}/mcp` },
  });
  expect(token.status()).toBe(200);
  const tokens = (await token.json()) as { access_token: string; scope: string };
  expect(tokens.scope.split(' ').sort()).toEqual(ALL_SCOPES.split(' ').sort());

  const listed = await rpc(request, tokens.access_token, 'tools/list');
  expect(listed.status).toBe(200);
  const tools = (listed.body?.result as { tools: Array<{ name: string; annotations?: Record<string, unknown> }> }).tools;
  const names = tools.map((t) => t.name);
  expect(names).toEqual(expect.arrayContaining([...PROPOSE_TOOLS, 'list_proposals', 'log_call', 'get_partner']));
  expect(tools.find((t) => t.name === 'propose_4c_scores')?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });

  // A change-level key of the same person: list_proposals (a read), none of the propose tools.
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'apiKey', name: 'change e2e', level: 'change' } });
  const { key } = (await made.json()) as { key: string };
  const changer = ((await rpc(request, key, 'tools/list')).body?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
  expect(changer).toContain('list_proposals');
  for (const name of PROPOSE_TOOLS) expect(changer).not.toContain(name);
});

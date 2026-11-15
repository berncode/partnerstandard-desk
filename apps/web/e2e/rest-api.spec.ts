import { expect, test, type Page } from '@playwright/test';

// A script or n8n with an API key, through the REST API under /api/v1 (agents spec 6). The key comes from the test
// seed: Settings' API keys are Task 10.

/** The sample book's Tailspin Solutions (signed, so it can have a MAP), in /api/test-seed's order. */
const TAILSPIN = 5;
/** The sample book's Adatum Advisory (Recruitment, reseller). */
const ADATUM = 3;
const KEY_NAME = 'n8n e2e';

/** Signs a new test user in, seeds the sample book, makes an API key, and answers the ids and the key. */
async function signInWithKey(page: Page, level: 'read' | 'change' | 'propose') {
  await page.goto('/api/test-auth?name=Anna&next=/partners');
  await expect(page).toHaveURL(/\/partners/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(seeded.ok()).toBe(true);
  const { accountIds, partnerIds } = (await seeded.json()) as { accountIds: string[]; partnerIds: string[] };
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'apiKey', name: KEY_NAME, level } });
  expect(made.ok()).toBe(true);
  const { key } = (await made.json()) as { key: string };
  return { accountIds, partnerIds, auth: { authorization: `Bearer ${key}` } };
}

test('GET /api/v1/partners with a key lists the seeded partners', async ({ page, request }) => {
  const { partnerIds, accountIds, auth } = await signInWithKey(page, 'read');
  // `request` sends no cookies: only the key signs it.
  const response = await request.get('/api/v1/partners', { headers: auth });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { items: Array<{ partnerId: string; accountId: string; name: string }>; nextCursor: string | null };
  expect(body.items.map((p) => p.partnerId).sort()).toEqual([...partnerIds].sort());
  expect(body.items.find((p) => p.accountId === accountIds[TAILSPIN])?.name).toBe('Tailspin Solutions');
  expect(body.nextCursor).toBeNull();

  // A page of two, then the next.
  const first = (await (await request.get('/api/v1/partners?limit=2', { headers: auth })).json()) as typeof body;
  expect(first.items).toHaveLength(2);
  const next = (await (await request.get(`/api/v1/partners?limit=2&cursor=${first.nextCursor}`, { headers: auth })).json()) as typeof body;
  expect(next.items[0]?.partnerId).toBe(body.items[2]?.partnerId);
});

test('PATCH an activity, then GET the map shows it, and the MAP page says "Last updated by Desk Agent for Anna"', async ({ page, request }) => {
  const { partnerIds, auth } = await signInWithKey(page, 'change');
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'map', partnerId: partnerIds[TAILSPIN], health: 'on_track' } });
  expect(made.ok()).toBe(true);
  const { mapId } = (await made.json()) as { mapId: string };

  type MapRead = { value: { activities: Array<{ id: string; title: string; status: string; updatedAt: string; updatedBy: string }> } };
  const read = (await (await request.get(`/api/v1/maps/${mapId}`, { headers: auth })).json()) as MapRead;
  const kickoff = read.value.activities.find((a) => a.title === 'Kickoff with both sponsors')!;

  const patched = await request.patch(`/api/v1/maps/${mapId}/activities/${kickoff.id}`, {
    headers: auth, data: { expectedUpdatedAt: kickoff.updatedAt, status: 'in_progress' },
  });
  expect(patched.status()).toBe(200);
  expect(await patched.json()).toMatchObject({ activity: { id: kickoff.id, status: 'in_progress', updatedBy: `Desk Agent for Anna` } });

  // The same change again with the old read is a conflict, as a problem.
  const stale = await request.patch(`/api/v1/maps/${mapId}/activities/${kickoff.id}`, {
    headers: auth, data: { expectedUpdatedAt: kickoff.updatedAt, status: 'done' },
  });
  expect(stale.status()).toBe(409);
  expect(stale.headers()['content-type']).toBe('application/problem+json');
  expect(await stale.json()).toMatchObject({ code: 'conflict', status: 409 });

  const again = (await (await request.get(`/api/v1/maps/${mapId}`, { headers: auth })).json()) as MapRead;
  expect(again.value.activities.find((a) => a.id === kickoff.id)).toMatchObject({ status: 'in_progress', updatedBy: `Desk Agent for Anna` });

  // The person sees it on the MAP page, with who changed it.
  await page.goto(`/plans/${mapId}`);
  const row = page.getByRole('main').getByRole('listitem')
    .filter({ has: page.getByRole('button', { name: 'Activity: Kickoff with both sponsors', exact: true }) });
  await expect(row.getByRole('button', { name: /^Status: In progress/ })).toBeVisible();
  await row.getByRole('button', { name: 'Show details' }).click();
  await expect(row).toContainText(`Last updated by Desk Agent for Anna.`);
});

test('GET /api/v1/partners/{accountId}?include=map,cases answers the MAP and the cases with the partner', async ({ page, request }) => {
  const { accountIds, partnerIds, auth } = await signInWithKey(page, 'read');
  const map = await page.request.post('/api/test-seed', { data: { fixture: 'map', partnerId: partnerIds[TAILSPIN], health: 'on_track' } });
  expect(map.ok()).toBe(true);
  const { mapId } = (await map.json()) as { mapId: string };
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'case', partnerId: partnerIds[TAILSPIN] } });
  expect(made.ok()).toBe(true);
  const { caseId } = (await made.json()) as { caseId: string };

  type Item = { partnerId: string; read: { ok: boolean } };
  type Read = { account: { id: string }; maps?: Array<Item & { mapId: string }>; cases?: Array<Item & { caseId: string }> };
  const response = await request.get(`/api/v1/partners/${accountIds[TAILSPIN]}?include=map,cases`, { headers: auth });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as Read;
  expect(body.account.id).toBe(accountIds[TAILSPIN]);
  expect(body.maps?.[0]).toMatchObject({ partnerId: partnerIds[TAILSPIN], mapId, read: { ok: true } });
  expect(body.cases?.[0]).toMatchObject({ partnerId: partnerIds[TAILSPIN], caseId, read: { ok: true } });

  // Without include, neither is in the answer; a value it doesn't know is refused.
  const plain = (await (await request.get(`/api/v1/partners/${accountIds[TAILSPIN]}`, { headers: auth })).json()) as Read;
  expect(plain.account.id).toBe(accountIds[TAILSPIN]);
  expect(plain).not.toHaveProperty('maps');
  expect(plain).not.toHaveProperty('cases');
  const refused = await request.get(`/api/v1/partners/${accountIds[TAILSPIN]}?include=everything`, { headers: auth });
  expect(refused.status()).toBe(422);
  expect(await refused.json()).toMatchObject({ code: 'invalid' });
});

test('GET /api/v1/openapi.json needs no key; the API without one is a 401 problem', async ({ request }) => {
  const response = await request.get('/api/v1/openapi.json');
  expect(response.status()).toBe(200);
  const doc = (await response.json()) as { openapi: string; servers: Array<{ url: string }>; paths: Record<string, unknown> };
  expect(doc.openapi).toBe('3.1.0');
  expect(doc.servers[0]?.url).toMatch(/\/api\/v1$/);
  expect(Object.keys(doc.paths)).toEqual(expect.arrayContaining(['/partners', '/maps/{mapId}/activities/{activityId}']));

  const refused = await request.get('/api/v1/partners');
  expect(refused.status()).toBe(401);
  expect(refused.headers()['content-type']).toBe('application/problem+json');
  expect(refused.headers()['www-authenticate']).toContain('Bearer');
  expect(await refused.json()).toMatchObject({ code: 'unauthorized', status: 401 });
});

test('a propose-level key proposes 4C scores and the partner’s scores don’t change', async ({ page, request }) => {
  const { accountIds, auth } = await signInWithKey(page, 'propose');
  type Partner = { id: string; updatedAt: string | null; desk: Record<string, number | null> };
  const readPartner = async () => ((await (await request.get(`/api/v1/partners/${accountIds[ADATUM]}`, { headers: auth })).json()) as { partners: Partner[] }).partners[0]!;
  const before = await readPartner();
  const score = before.desk.credibility === 3 ? 1 : 3;

  const made = await request.post('/api/v1/proposals/4c-scores', {
    headers: auth, data: { partnerId: before.id, expectedUpdatedAt: before.updatedAt, letters: { credibility: { score, evidence: 'Known brand in Austria.' } } },
  });
  expect(made.status()).toBe(200);
  const answer = (await made.json()) as { proposalId: string; status: string; message: string };
  expect(answer).toEqual({ proposalId: expect.stringMatching(/^prp_/), status: 'waiting', message: 'Proposed. It waits for Anna in PartnerStandard Desk.' });

  // Nothing changed: the scores are as they were until Anna accepts.
  const after = await readPartner();
  expect(after.desk).toEqual(before.desk);
  expect(after.updatedAt).toBe(before.updatedAt);

  // The key reads its proposal back, and This week counts it.
  const listed = await request.get(`/api/v1/proposals?proposalId=${answer.proposalId}`, { headers: auth });
  expect(listed.status()).toBe(200);
  expect(await listed.json()).toMatchObject({ items: [{ proposalId: answer.proposalId, kind: 'fourC', status: 'waiting', partnerId: before.id }] });
  expect(await (await request.get('/api/v1/this-week', { headers: auth })).json()).toMatchObject({ proposalsWaiting: 1 });

  // Proposing the Exit stage is refused in plain words.
  const exit = await request.post('/api/v1/proposals/stage', {
    headers: auth, data: { partnerId: before.id, expectedUpdatedAt: before.updatedAt, to: 'exit', reason: 'They stopped selling.' },
  });
  expect(exit.status()).toBe(422);
  expect(await exit.json()).toMatchObject({ code: 'invalid', title: 'Only a person moves a partner into Exit.' });
});

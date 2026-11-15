import { expect, test, type Page } from '@playwright/test';
import { actionAnswer } from './saves';

// An agent's proposal on the partner page (agent proposals spec 10): made with a propose-level key through the REST
// API, as rest-api.spec.ts does, and answered by the person on the partner's page.

/** The sample book's Adatum Advisory (Recruitment, reseller), in /api/test-seed's order. */
const ADATUM = 3;
// The key's own name: Settings shows it; every credited line says Desk Agent (owner, 2026-11-14).
const AGENT = 'Claude';
const LETTERS = ['customerBase', 'credibility', 'capability', 'commitment'] as const;

async function signInWithKey(page: Page) {
  await page.goto('/api/test-auth?name=Anna&next=/partners');
  await expect(page).toHaveURL(/\/partners/);
  const seeded = await page.request.post('/api/test-seed', { data: { fixture: 'sample' } });
  expect(seeded.ok()).toBe(true);
  const { accountIds, marketIds } = (await seeded.json()) as { accountIds: string[]; marketIds: string[] };
  const made = await page.request.post('/api/test-seed', { data: { fixture: 'apiKey', name: AGENT, level: 'propose' } });
  expect(made.ok()).toBe(true);
  const { key } = (await made.json()) as { key: string };
  return { accountId: accountIds[ADATUM]!, austria: marketIds[0]!, auth: { authorization: `Bearer ${key}` } };
}

const noSidewaysScroll = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);

test('Claude’s 4C proposal: accept two letters, reject two with a reason; the scores show the proposed-by line and the API lists the reason', async ({ page, request }) => {
  const { accountId, auth } = await signInWithKey(page);
  type Read = {
    partners: Array<{ id: string; updatedAt: string | null; updatedBy: string; desk: Record<string, number | null> }>;
    qualifications: Array<{ partnerId: string; deskNotes: Record<string, string> }>;
  };
  const read = async () => (await (await request.get(`/api/v1/partners/${accountId}`, { headers: auth })).json()) as Read;
  const before = (await read()).partners[0]!;
  const scores = Object.fromEntries(LETTERS.map((c) => [c, before.desk[c] === 3 ? 1 : 3])) as Record<(typeof LETTERS)[number], number>;
  const letters = Object.fromEntries(LETTERS.map((c) => [c, { score: scores[c], evidence: `Evidence for ${c}` }]));
  const made = await request.post('/api/v1/proposals/4c-scores', { headers: auth, data: { partnerId: before.id, expectedUpdatedAt: before.updatedAt, letters } });
  expect(made.status()).toBe(200);
  const { proposalId } = (await made.json()) as { proposalId: string };

  // On a phone: the card sits in the desk check, and nothing scrolls sideways.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/partners/${accountId}`);
  const desk = page.getByRole('region', { name: 'Desk check' });
  const card = desk.getByRole('region', { name: `Desk Agent proposes` });
  await expect(card).toContainText('today');
  await expect(card).toContainText('Credibility (desk check)');
  await expect(card).toContainText('Evidence for credibility');
  expect(await noSidewaysScroll(page)).toBe(true);

  // Accept some: two letters ticked, the two others rejected with a reason.
  await card.getByRole('button', { name: 'Accept some' }).click();
  await card.getByRole('checkbox', { name: 'Credibility (desk check)' }).uncheck();
  await card.getByRole('checkbox', { name: 'Commitment (desk check)' }).uncheck();
  await card.getByLabel('Why not? (optional)').fill('We haven’t heard from them yet.');
  expect(await noSidewaysScroll(page)).toBe(true);
  const saved = actionAnswer(page, proposalId);
  await card.getByRole('button', { name: 'Accept' }).click();
  await expect(card).toContainText('Accepted 2 of 4');
  expect((await saved).ok()).toBe(true);

  // Saved: after a reload the card is one line, and the two scores are the proposed ones, with the evidence as notes.
  await page.reload();
  await expect(desk.getByRole('region', { name: `Desk Agent proposes` })).toHaveText(/Accepted 2 of 4/);
  for (const [c, label] of [['customerBase', 'Customer base'], ['capability', 'Capability']] as const) {
    await expect(desk.getByRole('group', { name: label }).getByRole('button', { name: new RegExp(`^${scores[c]}:`) })).toHaveAttribute('aria-pressed', 'true');
  }
  await expect(desk).toContainText('Evidence for customerBase');
  await expect(desk).not.toContainText('Evidence for credibility');

  // The scores were set by Anna, proposed by the agent; the two left out kept theirs.
  const after = await read();
  const partner = after.partners[0]!;
  expect(partner.updatedBy).toBe(`Anna, proposed by Desk Agent`);
  expect(partner.desk).toEqual({ ...before.desk, customerBase: scores.customerBase, capability: scores.capability });
  expect(after.qualifications.find((q) => q.partnerId === partner.id)?.deskNotes.capability).toContain('Evidence for capability');

  // The agent reads the answer and the reason.
  const listed = await request.get(`/api/v1/proposals?proposalId=${proposalId}`, { headers: auth });
  expect(await listed.json()).toMatchObject({ items: [{ proposalId, status: 'partly_accepted', answerNote: 'We haven’t heard from them yet.' }] });
});

test('Desk Agent proposes 12 companies; the market’s preview marks the duplicates; importing 9 says "Accepted 9 of 12"', async ({ page, request }) => {
  const { austria, auth } = await signInWithKey(page);
  // Northwind and Tailspin are in Austria already; Contoso is a reseller in no market yet; the other nine are new.
  const known = [['Northwind Consulting', 'northwind.example'], ['Tailspin Solutions', 'tailspin.example'], ['Contoso Partners', 'contoso.example']];
  const fresh = ['Alpine', 'Bergwerk', 'Donau', 'Edelweiss', 'Föhn', 'Gletscher', 'Hallstatt', 'Inntal', 'Jauerling']
    .map((name) => [`${name} IT`, `${name.toLowerCase().replace('ö', 'oe')}.example`]);
  const companies = [...known, ...fresh].map(([company, website]) => ({
    company, website, country: 'AT', whyItFits: `${company} sells to mid-size firms`, sourceDetail: `Web search: ${company}`,
  }));
  const made = await request.post('/api/v1/proposals/partners', { headers: auth, data: { marketId: austria, companies, reason: 'Resellers like Tailspin' } });
  expect(made.status()).toBe(200);
  const answer = (await made.json()) as { proposalId: string; alreadyPartners: number[] };
  expect(answer.alreadyPartners).toEqual([0, 1, 2]);

  // This week lists it, with Show and Reject (the import preview is on the market page), and the sidebar counts it.
  await page.goto('/this-week');
  const main = page.getByRole('main');
  const block = main.getByRole('region', { name: 'Proposals' });
  const line = block.getByRole('listitem').filter({ hasText: '12 companies for Austria' });
  await expect(line).toContainText(`Desk Agent proposes · today`);
  await expect(line.getByRole('button')).toHaveText(['Reject']);
  const week = page.getByRole('complementary').getByRole('link', { name: 'This week', exact: true });
  await expect(week).toHaveAccessibleDescription('1 proposal waiting');

  // On a phone: Show opens the market, where the card sits above the pipeline.
  await page.setViewportSize({ width: 375, height: 800 });
  await line.getByRole('link', { name: 'Show' }).click();
  await expect(page).toHaveURL(new RegExp(`/markets/${austria}$`));
  const card = main.getByRole('region', { name: `Desk Agent proposes` });
  await expect(card).toContainText('12 companies for Austria');
  await expect(card).toContainText('Resellers like Tailspin');
  expect(await noSidewaysScroll(page)).toBe(true);

  // The preview runs the duplicate check on the book as it is now.
  await card.getByRole('button', { name: 'Review the companies' }).click();
  const dialog = page.getByRole('dialog', { name: 'Review the companies' });
  const row = (company: string) => dialog.getByRole('row').filter({ has: page.getByRole('checkbox', { name: `Import ${company}` }) });
  await expect(row('Northwind Consulting')).toContainText('already in this market');
  await expect(row('Northwind Consulting').getByRole('checkbox')).toBeDisabled();
  await expect(row('Tailspin Solutions').getByRole('checkbox')).toBeDisabled();
  await expect(row('Contoso Partners').getByRole('checkbox')).toBeChecked();
  await expect(dialog).toContainText('10 of 12 ticked');
  expect(await noSidewaysScroll(page)).toBe(true);
  await row('Jauerling IT').getByRole('checkbox').uncheck();
  const saved = actionAnswer(page, answer.proposalId);
  await dialog.getByRole('button', { name: /^Add / }).click();
  await expect(dialog).toBeHidden();
  await expect(card).toContainText('Accepted 9 of 12');
  expect((await saved).ok()).toBe(true);

  // Saved: after a reload the card is one line and the new partners are in the pipeline.
  await page.reload();
  await expect(main.getByRole('region', { name: `Desk Agent proposes` })).toHaveText(/Accepted 9 of 12/);
  await expect(main.getByText('Alpine IT').first()).toBeVisible();
  await expect(main.getByText('Jauerling IT')).toHaveCount(0);

  // The agent reads the answer: partly accepted.
  const listed = await request.get(`/api/v1/proposals?proposalId=${answer.proposalId}`, { headers: auth });
  expect(await listed.json()).toMatchObject({ items: [{ proposalId: answer.proposalId, status: 'partly_accepted' }] });
});

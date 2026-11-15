import { expect, test, type Page } from '@playwright/test';
import { edition } from './edition';

// A company server's trash (plan 16): what a person deleted stays in it, and an admin brings it back from Settings; its
// old links stay off (owner, 2026-11-08).
test.beforeEach(() => test.skip(edition() !== 'database', 'Only a company server keeps a trash of its own'));

const main = (page: Page) => page.getByRole('main');
const GONE = "This link doesn't work any more. Ask the person who sent it for a new one.";

async function seed<T>(page: Page, data: Record<string, unknown>): Promise<T> {
  const out = await page.request.post('/api/test-seed', { data });
  expect(out.ok()).toBe(true);
  return out.json() as Promise<T>;
}

test('an admin brings a deleted case and MAP back from the trash; the case’s old share link stays off', async ({ page, browser }) => {
  test.setTimeout(60_000);
  await page.goto('/api/test-auth?name=Trash%20Keeper&next=/partners');
  await expect(page).toHaveURL(/\/partners/);
  const { acmePartnerIds } = await seed<{ acmePartnerIds: { reseller: string } }>(page, { fixture: 'sample', twoTypes: true });
  const { caseId } = await seed<{ caseId: string }>(page, { fixture: 'case', partnerId: acmePartnerIds.reseller });
  const { mapId } = await seed<{ mapId: string }>(page, { fixture: 'map', partnerId: acmePartnerIds.reseller });

  // The case gets a share link, then both go.
  await page.goto(`/business-cases/${caseId}/share`);
  await main(page).getByRole('button', { name: 'Share a link with Acme' }).click();
  const linkBox = main(page).getByRole('textbox', { name: 'Link for Acme' });
  await expect(linkBox).toHaveValue(/\/s\/[A-Za-z0-9_-]{43}$/);
  const link = await linkBox.inputValue();
  await page.goto('/business-cases');
  await main(page).getByRole('article').first().getByRole('button', { name: /^Delete Case of/ }).click();
  await page.getByRole('dialog', { name: /^Delete Case of/ }).getByRole('button', { name: 'Delete case' }).click();
  await expect(main(page).getByRole('article')).toHaveCount(0);
  await page.goto(`/plans/${mapId}`);
  await main(page).getByRole('button', { name: 'Delete MAP' }).click();
  await page.getByRole('dialog', { name: /^Delete the MAP with/ }).getByRole('button', { name: 'Delete MAP' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/plans/${mapId}$`));

  // Settings, Trash: both, the latest first; each comes back.
  await page.goto('/settings');
  const trash = page.getByRole('region', { name: 'Trash' });
  const rows = trash.getByRole('listitem');
  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText('Acme as reseller');
  await expect(rows.first()).toContainText(/^Acme as reseller\s*MAP · deleted \d{1,2} [A-Z][a-z]{2} \d{4}/);
  await trash.getByRole('button', { name: 'Restore Acme as reseller' }).click();
  await expect(trash.getByRole('status')).toHaveText('Acme as reseller is back.');
  await trash.getByRole('button', { name: /^Restore Case of/ }).click();
  await expect(trash.getByText('Nothing in the trash.')).toBeVisible();

  // Each opens again, under its own address.
  await page.goto(`/plans/${mapId}`);
  await expect(main(page).getByRole('heading', { level: 1, name: 'Acme as reseller' })).toBeVisible();
  await page.goto('/business-cases');
  await expect(main(page).getByRole('article')).toHaveCount(1);

  // The case's old link still doesn't work: whoever should have it gets a new one.
  const visitor = await browser.newContext();
  const partner = await visitor.newPage();
  await partner.goto(link);
  await expect(partner.getByRole('heading', { level: 1 })).toHaveText(GONE);
  await visitor.close();
});

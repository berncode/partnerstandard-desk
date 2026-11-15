// @vitest-environment jsdom
// The case lives in the owner's store, its link in the share links, its row in the directory.
import { hashToken, newToken, type ShareDeps } from '@partner-desk/commands';
import { createMemoryDirectory, createMemoryReviewLinks, createMemoryShareLinks } from '@partner-desk/commands/testing';
import { EXAMPLES, type BusinessCase as Case, type PartnerBook } from '@partner-desk/core';
import { COPY } from '@partner-desk/copy';
import { createMemoryCaseStore, StoreFailure, type CaseStore } from '@partner-desk/storage';
import { render, screen, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const NOT_FOUND = vi.hoisted(() => new Error('NEXT_NOT_FOUND'));
const state = vi.hoisted(() => ({ deps: null as unknown }));
// jsdom renders no async server component: the footer's served legal links are hosted's, as the server sends them.
vi.mock('@/ui/served-legal-links', async () => {
  const { LegalLinks } = await import('@/ui/legal-links');
  const { legalLinksFor } = await import('@/server/legal');
  return { ServedLegalLinks: () => <LegalLinks links={legalLinksFor('ours')} /> };
});
vi.mock('next/navigation', () => ({ notFound: () => { throw NOT_FOUND; }, usePathname: () => '/s/abc', useRouter: () => ({ push: () => {} }) }));
vi.mock('@/server/runtime', () => ({ shareDeps: () => state.deps }));

const { SharedCase } = await import('./shared-case');
const { default: SharedCaseNotFound } = await import('./not-found');

const OWNER = { userId: 'u_owner', displayName: 'Ada' };
const TOKEN = newToken();
/** Every part of our case, each written to be found nowhere else. */
const MARKERS = {
  recommendation: 'OURS-RECOMMENDATION-4b1e', ask: 'OURS-ASK-9c2d', preparedBy: 'OURS-PREPARED-BY', why: 'OURS-RISK-WHY',
  efficiency: 'OURS-EFFICIENCY-NOTE', churn: 'OURS-CHURN-NOTE', strategic: 'OURS-STRATEGIC-REASON', cost: 'OURS-COST-LINE',
  alone: 'OURS-ALONE-COST',
};
const OUR_AMOUNTS = ['9,191,919', '9191919', '8,181,818', '8181818', '7,171,717', '7171717'];

const sharedCase = (patch: Partial<Case> = {}): Case => {
  const c: Case = { ...structuredClone(EXAMPLES.saas.case), shared: { sharedAt: '2026-10-25T10:00:00.000Z' }, ...patch };
  const o = c.ours;
  o.recommendation = MARKERS.recommendation;
  o.ask = MARKERS.ask;
  o.preparedBy = MARKERS.preparedBy;
  o.risk = { ...o.risk, why: MARKERS.why, amount: 9_191_919 };
  o.efficiency = { ...o.efficiency, on: true, note: MARKERS.efficiency };
  o.churn = { ...o.churn, note: MARKERS.churn };
  o.strategic = [{ id: 'reason_marker', text: MARKERS.strategic, weight: 'high', alone: true }];
  o.costs = [...o.costs, { id: 'cost_marker', name: MARKERS.cost, when: 'yearly', amount: 8_181_818, source: 'finance' }];
  o.alone = { ...o.alone, mode: 'detailed', costs: [{ id: 'cost_alone', name: MARKERS.alone, when: 'start', amount: 7_171_717, source: 'sales' }] };
  return c;
};

let store: CaseStore;
let fileId: string;
let share: ShareDeps;
let links: ReturnType<typeof createMemoryShareLinks>;
let names: Map<string, string>;
/** The owner's Partners as the partner's page reads it, or none (the name stored with the case shows). */
let book: PartnerBook | null;

async function shareCase(c: Case = sharedCase()) {
  const made = await store.create(OWNER, 'co_aaaaaaaaaa', c);
  fileId = made.fileId;
  const directory = createMemoryDirectory();
  await directory.addPartnerBook({ companyId: 'co_aaaaaaaaaa', ownerUserId: OWNER.userId, fileId: 'file_partners' });
  await directory.addBusinessCase({
    caseId: c.id, fileId, ownerUserId: OWNER.userId, companyId: 'co_aaaaaaaaaa', partnerId: 'pt_1', partnerType: 'reseller',
    displayName: c.title, createdAt: c.createdAt,
  });
  links = createMemoryShareLinks();
  await links.create({ id: 'sl_1', ownerUserId: OWNER.userId, caseId: c.id, tokenHash: hashToken(TOKEN), createdAt: c.createdAt });
  share = {
    shareLinks: links, reviewLinks: createMemoryReviewLinks(), directory, log: vi.fn(), mapsFor: async () => null, ownerName: async () => null,
    companies: { nameOf: async (userId) => names.get(userId) ?? null },
    casesFor: async (userId) => (userId === OWNER.userId ? store : null),
    partnerBooksFor: async (userId) => (userId === OWNER.userId && book
      ? { read: async () => ({ ok: true as const, snapshot: { value: book!, issues: [] } }) }
      : null),
  };
  state.deps = share;
}

beforeEach(async () => {
  store = createMemoryCaseStore();
  names = new Map();
  book = null;
  await shareCase();
});

const element = (token: string) => SharedCase({ params: Promise.resolve({ token }) });
const page = async (token: string) => render(await element(token));

describe('the share link page', () => {
  it('shows the partner’s one-pager as the case is now, named as the company is now, and none of the owner’s pages', async () => {
    names.set(OWNER.userId, 'Acme Now');
    await page(TOKEN);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What partnering with Acme Now is worth to Northwind');
    expect(screen.getByRole('group', { name: 'Your profit after costs' })).toHaveTextContent('€479,507');
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Case' })).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'One-pager' })).toBeNull();
    expect(screen.queryByText(/Our case · internal, for your manager/)).toBeNull();
    const hrefs = screen.queryAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs.some((h) => h?.startsWith('/business-cases') || h?.startsWith('/partners') || h?.startsWith('/settings'))).toBe(false);
    expect(document.body.innerHTML).not.toContain('case_saas');
  });

  it('names the partner as the owner’s Partners names it now (owner, 2026-10-30)', async () => {
    book = {
      partners: [{ id: 'pt_1', partnerType: 'reseller', accountId: 'acc_1' }], accounts: [{ id: 'acc_1', company: 'Northwind Now' }],
    } as unknown as PartnerBook;
    await page(TOKEN);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What partnering with Acme is worth to Northwind Now');
  });

  it('speaks to the partner as "you"', async () => {
    const { container } = await page(TOKEN);
    expect(screen.getByRole('img', { name: 'Your revenue per year by source, with your profit so far' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Your customers by year 5' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/Partner profit|Partner revenue|Partner services|\bthe partner\b/);
  });

  it('shows the case as it is now: a change shows on the next visit', async () => {
    await page(TOKEN);
    const read = await store.read({ fileId });
    if (!read.ok) throw new Error('setup');
    const c = read.snapshot.value;
    await store.apply({ fileId }, { kind: 'save', case: { ...c, deals: [6, 7, 11, 15, 19] }, base: c, expectedUpdatedAt: c.updatedAt },
      { now: '2026-10-30T12:00:00.000Z', actor: 'Ada' });
    document.body.innerHTML = '';
    await page(TOKEN);
    expect(screen.getByRole('region', { name: 'The plan' })).toHaveTextContent('New deals per year: 6, 7, 11, 15, 19.');
  });

  it('sends nothing of our case: not in the HTML, not in what the page passes on (the hard rule)', async () => {
    const { container } = await page(TOKEN);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What partnering with Acme is worth to Northwind');
    // The HTML the server sends, rendered from the same element.
    const html = renderToString(await element(TOKEN));
    for (const body of [container.innerHTML, html]) {
      for (const hidden of [...Object.values(MARKERS), ...OUR_AMOUNTS, 'Internal', 'Assumption', 'Gross margin', 'Net value',
        'Present in the Nordics before competitors arrive', 'Partner manager time', 'Finance, 2025']) {
        expect(body, hidden).not.toContain(hidden);
      }
    }
    // What the page gives the one-pager is the partner's side only: no case, no ours, no ids.
    const props = JSON.stringify((await element(TOKEN)).props, (_key, value: unknown) => (typeof value === 'function' ? undefined : value));
    for (const hidden of [...Object.values(MARKERS), ...OUR_AMOUNTS, '"ours"', 'case_saas', fileId, 'u_owner', 'co_aaaaaaaaaa']) {
      expect(props, hidden).not.toContain(hidden);
    }
  });

  it('is not found for a token that isn’t one, a link turned off, and a case no longer shared', async () => {
    await expect(page('not-a-token')).rejects.toBe(NOT_FOUND);
    await links.revokeCases(OWNER.userId, ['case_saas'], '2026-10-30T12:00:00.000Z');
    await expect(page(TOKEN)).rejects.toBe(NOT_FOUND);
  });

  it('is not found once the owner is gone', async () => {
    share.casesFor = async () => null;
    await expect(page(TOKEN)).rejects.toBe(NOT_FOUND);
  });

  it('says the case can’t be shown right now when the owner’s storage fails, and shows no numbers', async () => {
    vi.spyOn(store, 'read').mockRejectedValue(new StoreFailure('auth', COPY.FORBIDDEN));
    await page(TOKEN);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("This case can't be shown right now.");
    expect(screen.queryByText(/Reconnect/)).toBeNull();
    expect(screen.queryByRole('heading', { name: /What partnering with/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
  });

  it('shows the PartnerStandard Desk logo without a link: only the legal pages and the Knowledge Hub are linked (owner, 2026-10-30)', () => {
    render(<SharedCaseNotFound />);
    const banner = screen.getByRole('banner');
    expect(within(banner).getAllByRole('img', { name: 'PartnerStandard' }).length).toBeGreaterThan(0);
    expect(within(banner).queryAllByRole('link')).toEqual([]);
    expect(screen.getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['/privacy', '/terms', '/imprint', 'https://pro.partnerstandard.com']);
  });

  it('says a link that doesn’t work any more should be asked for again', () => {
    render(<SharedCaseNotFound />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("This link doesn't work any more. Ask the person who sent it for a new one.");
  });
});

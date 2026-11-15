// @vitest-environment jsdom
import { buildSearchPrompt, type PartnerBook } from '@partner-desk/core';
import { anAccount, marketLink, partner, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { MarketHypothesisTab } from './market-hypothesis';
import { PartnerHypothesesTab } from './partner-hypotheses';
import { renderMarket } from './test-harness';

/** Gamma is in this market under the hypothesis, past its discovery call; Zeta is in another market. */
function book(): PartnerBook {
  const rows = [
    { id: 'p_3', company: 'Gamma', website: 'gamma.example', partner: partner({ id: 'p_3', accountId: 'a_p_3', step: 'qualification' }) },
    { id: 'p_9', company: 'Zeta', website: 'zeta.example', partner: partner({ id: 'p_9', accountId: 'a_p_9' }) },
  ];
  return sampleBook({
    accounts: rows.map((row) => anAccount({ id: `a_${row.id}`, company: row.company, website: row.website })),
    partners: rows.map((row) => row.partner),
    marketLinks: [marketLink({ id: 'l_3', partnerId: 'p_3', hypothesisId: 'h_1' }), marketLink({ id: 'l_9', partnerId: 'p_9', marketId: 'm_other00000' })],
    calls: [], people: [], qualifications: [],
  });
}

const files = () => ({ market: sampleMarket(), book: book() });
const promptFor = (hypothesisId: string | null) => buildSearchPrompt({ ...files(), companyName: 'Halden', hypothesisId });

let writeText: ReturnType<typeof vi.fn>;
let downloads: Array<{ name: string; text: Promise<string> }>;

beforeEach(() => {
  vi.clearAllMocks();
  writeText = vi.fn(async () => {});
  downloads = [];
  let blob: Blob | null = null;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn((b: Blob) => { blob = b; return 'blob:prompt'; }), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    if (this.href.startsWith('blob:') && blob) downloads.push({ name: this.download, text: blob.text() });
  });
});

/** userEvent brings its own clipboard: ours goes in after it. */
function setup() {
  const user = userEvent.setup();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  return user;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('the search prompt on the Market hypothesis tab', () => {
  it('copies the prompt built from the market hypothesis, leaving out this market’s partners and its exclusions', async () => {
    const user = setup();
    renderMarket(<MarketHypothesisTab />, files());
    const card = screen.getByRole('region', { name: 'Find partners with AI' });
    expect(card.closest('#search-prompt')).not.toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Copy search prompt' }));
    expect(writeText).toHaveBeenCalledWith(promptFor(null));
    const prompt = writeText.mock.calls[0]![0] as string;
    expect(prompt).toContain('Gamma (gamma.example)');
    expect(prompt).toContain('Omega GmbH (omega.example): Existing partner');
    // Every reseller is left out, including one that is only in another market.
    expect(prompt).toContain('Zeta (zeta.example)');
    expect(within(card).getByRole('button', { name: 'Copied' })).toBeInTheDocument();
  });

  it('downloads the same prompt as search-prompt-{market}.md, in the browser', async () => {
    const user = setup();
    renderMarket(<MarketHypothesisTab />, files());
    await user.click(within(screen.getByRole('region', { name: 'Find partners with AI' })).getByRole('button', { name: 'Download' }));
    expect(downloads.map((d) => d.name)).toEqual(['search-prompt-Austria.md']);
    expect(await downloads[0]!.text).toBe(promptFor(null));
  });

  it('shows the prompt to copy by hand when the browser blocks the clipboard', async () => {
    const user = setup();
    writeText.mockRejectedValue(new Error('blocked'));
    renderMarket(<MarketHypothesisTab />, files());
    const card = screen.getByRole('region', { name: 'Find partners with AI' });
    await user.click(within(card).getByRole('button', { name: 'Copy search prompt' }));
    expect(await within(card).findByText('Your browser didn’t let us copy. Select the prompt below and copy it yourself.')).toBeInTheDocument();
    const box = within(card).getByRole('textbox', { name: 'Search prompt' });
    expect(box).toHaveValue(promptFor(null));
    await user.click(within(card).getByRole('button', { name: 'Select all' }));
    expect(box).toHaveFocus();
  });
});

describe('the search prompt on a partner hypothesis card', () => {
  it('says what it finds, and copies and downloads the hypothesis’s prompt with its linked partners as examples', async () => {
    const user = setup();
    renderMarket(<PartnerHypothesesTab />, files());
    const card = screen.getByRole('article', { name: 'Mid-size IT firms' });
    expect(card).toHaveTextContent('Find companies like these with AI. The prompt includes the linked partners as examples.');
    await user.click(within(card).getByRole('button', { name: 'Copy search prompt' }));
    expect(writeText).toHaveBeenCalledWith(promptFor('h_1'));
    expect(promptFor('h_1')).not.toBe(promptFor(null));
    expect(promptFor('h_1')).toContain('Examples of companies we have spoken with:\n  - Gamma (gamma.example)');
    await user.click(within(card).getByRole('button', { name: 'Download' }));
    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(await downloads[0]!.text).toBe(promptFor('h_1'));
  });
});

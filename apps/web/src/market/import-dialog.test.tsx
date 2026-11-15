// @vitest-environment jsdom
import { MAX_BATCH, NO_TABLE, TEXT_MAX, type PartnerBook, type ProposalHead } from '@partner-desk/core';
import { anAccount, marketLink, partner, proposalItem, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import { MAX_FILE_BYTES } from './import-model';
import { Pipeline } from './pipeline';
import { renderMarket, type HarnessOptions } from './test-harness';

const M = 'm_abcdefghij';

/** Alpha is in this market; Beta a reseller in another market; Contoso a managed service partner. */
function book(): PartnerBook {
  const rows = [
    { id: 'p_1', company: 'Alpha', website: 'alpha.example', partner: partner({ id: 'p_1', accountId: 'a_p_1' }) },
    { id: 'p_2', company: 'Beta', website: 'beta.example', partner: partner({ id: 'p_2', accountId: 'a_p_2' }) },
    { id: 'p_3', company: 'Contoso', website: 'contoso.example', partner: partner({ id: 'p_3', accountId: 'a_p_3', partnerType: 'managed' }) },
  ];
  return sampleBook({
    accounts: rows.map((row) => anAccount({ id: `a_${row.id}`, company: row.company, website: row.website, country: 'AT' })),
    partners: rows.map((row) => row.partner),
    marketLinks: [marketLink({ id: 'l_1', partnerId: 'p_1' }), marketLink({ id: 'l_2', partnerId: 'p_2', marketId: 'm_other00000' })],
    calls: [], people: [], qualifications: [],
  });
}

const TABLE = [
  '| Company | Website | Country | Why it fits | Evidence and sources |',
  '|---|---|---|---|---|',
  '| Datum Labs | https://datum.example | AT | =HYPERLINK("https://evil.example") | datum.example/about |',
  '| Alpha | alpha.example | AT | Here already | |',
  '| Beta | beta.example | AT | Elsewhere | |',
  '| Contoso | contoso.example | AT | Other type | |',
  '| Omega GmbH | omega.example | AT | Excluded | |',
  '| Datum Labs | datum.example | AT | Again | |',
  `| Long GmbH | long.example | AT | ${'x'.repeat(TEXT_MAX + 1)} | |`,
  '| Fourth Coffee | javascript:alert(1) | AT | New | |',
  '| | | AT | No name | |',
].join('\n');

function open(options: HarnessOptions = {}) {
  const user = userEvent.setup();
  const rendered = renderMarket(<Pipeline />, { market: sampleMarket(), book: book() }, options);
  return { user, ...rendered };
}

async function startImport(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Import AI results' }));
  return screen.getByRole('dialog', { name: 'Import AI results' });
}

async function paste(user: ReturnType<typeof userEvent.setup>, dialog: HTMLElement, text: string) {
  fireEvent.change(within(dialog).getByRole('textbox', { name: 'Paste the AI’s table' }), { target: { value: text } });
  await user.click(within(dialog).getByRole('button', { name: 'Show preview' }));
}

const row = (dialog: HTMLElement, company: string) =>
  within(within(dialog).getByRole('table', { name: 'Preview' })).getAllByRole('row').find((r) => within(r).queryByRole('checkbox', { name: `Import ${company}` }))!;

beforeEach(() => vi.clearAllMocks());

describe('Import AI results', () => {
  it('sits next to Find partners with AI', () => {
    open();
    expect(screen.getByRole('link', { name: 'Find partners with AI' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Import AI results' })).toBeInTheDocument();
  });

  it('is gone when the page is read-only', () => {
    open({ readOnly: true });
    expect(screen.queryByRole('button', { name: 'Import AI results' })).not.toBeInTheDocument();
  });

  it('says how to fix a paste without a table', async () => {
    const { user, log } = open();
    const dialog = await startImport(user);
    expect(dialog).toHaveTextContent('Paste the table your AI assistant returned for the search prompt, or upload it as a CSV file. You choose what to add.');
    expect(within(dialog).getByRole('button', { name: 'Show preview' })).toBeDisabled();
    await paste(user, dialog, 'Datum Labs and Beta look good.');
    expect(within(dialog).getByRole('alert')).toHaveTextContent(NO_TABLE);
    expect(within(dialog).queryByRole('table')).not.toBeInTheDocument();
    expect(log.partnerBatches).toHaveLength(0);
  });

  it('notes every duplicate kind; ticks new companies and partners the book has; blocks the rest', async () => {
    const { user } = open();
    const dialog = await startImport(user);
    await paste(user, dialog, TABLE);
    expect(within(dialog).getByRole('status')).toHaveTextContent('4 of 8 ticked. 1 row without a company name left out.');
    expect(row(dialog, 'Alpha')).toHaveTextContent('already in this market');
    expect(row(dialog, 'Beta')).toHaveTextContent('already a partner: adds this market');
    expect(row(dialog, 'Contoso')).toHaveTextContent('Contoso is already your managed service provider. This adds Contoso as a reseller.');
    expect(row(dialog, 'Omega GmbH')).toHaveTextContent('excluded: Existing partner');
    expect(within(dialog).getAllByRole('checkbox', { name: 'Import Datum Labs' })[1]!.closest('tr')).toHaveTextContent('already in this table');
    expect(row(dialog, 'Long GmbH')).toHaveTextContent('Too long for a sheet cell');

    const box = (company: string, index = 0) => within(dialog).getAllByRole('checkbox', { name: `Import ${company}` })[index]!;
    for (const company of ['Beta', 'Contoso', 'Fourth Coffee']) expect(box(company)).toBeChecked();
    expect(box('Datum Labs')).toBeChecked();
    for (const blocked of [box('Alpha'), box('Omega GmbH'), box('Datum Labs', 1), box('Long GmbH')]) {
      expect(blocked).not.toBeChecked();
      expect(blocked).toBeDisabled();
    }
    expect(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' })).toBeEnabled();

    await user.click(box('Beta'));
    expect(within(dialog).getByRole('button', { name: 'Add 3 partners' })).toBeEnabled();
    for (const company of ['Datum Labs', 'Contoso', 'Fourth Coffee']) await user.click(box(company));
    const none = within(dialog).getByRole('button', { name: 'Add 0 partners' });
    expect(none).toBeDisabled();
    // The reason sits under the button, not only in the line above it.
    expect(none).toHaveAccessibleDescription('Tick at least one row to add.');
    await user.click(box('Beta'));
    expect(within(dialog).queryByText('Tick at least one row to add.')).not.toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add this market to 1 partner' })).toBeEnabled();
  });

  it('shows imported text as text, and links a website only when it starts with http(s)://', async () => {
    const { user } = open();
    const dialog = await startImport(user);
    await paste(user, dialog, TABLE);
    expect(within(dialog).getByText('=HYPERLINK("https://evil.example")')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('link').map((a) => a.getAttribute('href'))).toEqual(['https://datum.example']);
  });

  it('adds the ticked rows in one batch into this market, for the chosen hypothesis, then closes and says what it did', async () => {
    const { user, log } = open();
    const dialog = await startImport(user);
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Results for' }), 'Mid-size IT firms');
    await paste(user, dialog, TABLE);
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(log.partnerBatches).toHaveLength(1);
    const [{ changes, marketId }] = log.partnerBatches as [typeof log.partnerBatches[number]];
    expect(marketId).toBe(M);
    expect(changes.map((c) => (c.kind === 'add' ? c.entity : c.kind))).toEqual([
      'account', 'partner', 'marketLink', 'qualification', 'marketLink', 'partner', 'marketLink', 'account', 'partner', 'marketLink',
    ]);
    expect(changes[4]).toEqual({ kind: 'add', entity: 'marketLink', values: { partnerId: 'p_2', marketId: M, hypothesisId: 'h_1' } });
    expect(changes[0]).toMatchObject({ kind: 'add', entity: 'account', values: { company: 'Datum Labs' } });
    expect(changes[1]).toMatchObject({
      values: { partnerType: 'reseller', source: 'ai_search', sourceDetail: expect.stringMatching(/^Mid-size IT firms · \d{4}-\d{2}-\d{2}$/) },
    });
    expect(toast).toHaveBeenCalledWith('3 partners added, and this market added to 1 partner');
    const researched = screen.getByRole('region', { name: 'Researched' });
    for (const company of ['Datum Labs', 'Beta', 'Contoso', 'Fourth Coffee']) expect(within(researched).getByText(company)).toBeInTheDocument();
  });

  it('adds nothing when the import is refused: says why and where it stopped, and keeps the preview', async () => {
    const { user, log } = open({ refuseImport: { message: 'Google Sheets isn’t answering.', valid: 4 } });
    const dialog = await startImport(user);
    await paste(user, dialog, TABLE);
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Nothing was added: Beta couldn’t be added.');
    expect(alert).toHaveTextContent('Google Sheets isn’t answering.');
    expect(log.partnerBatches).toHaveLength(1);
    expect(toast).not.toHaveBeenCalled();
    expect(within(dialog).getByRole('table', { name: 'Preview' })).toBeInTheDocument();
    // A clear refusal: nothing is in the file, so Add is offered again.
    expect(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' })).toBeEnabled();
    expect(within(dialog).queryByRole('button', { name: 'Reload' })).not.toBeInTheDocument();
    // Behind the dialog: every row the import showed is gone again.
    expect(within(screen.getByRole('region', { name: 'Researched', hidden: true })).queryByText('Datum Labs')).not.toBeInTheDocument();
  });

  it('offers no Add again when the import’s outcome is unknown, only Reload, until the page reloads', async () => {
    const { user, log } = open({ refuseImport: { message: 'Google Sheets isn’t responding right now. Try again in a moment.', unknown: true } });
    let dialog = await startImport(user);
    await paste(user, dialog, TABLE);
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Some of this import may be in the market. Reload the page and check it before you import again.');
    expect(within(alert).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' })).toBeDisabled();

    // Back, a fresh preview, or the dialog opened again: still no Add.
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    await paste(user, dialog, TABLE);
    expect(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' })).toBeDisabled();
    await user.keyboard('{Escape}');
    dialog = await startImport(user);
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Some of this import may be in the market.');
    await paste(user, dialog, TABLE);
    expect(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' })).toBeDisabled();
    expect(log.partnerBatches).toHaveLength(1);
  });

  it('adds each new company once when Add is pressed again after a refusal', async () => {
    const { user, log, book: current } = open({ refuseImport: { message: 'Google Sheets isn’t answering.', times: 1 } });
    const dialog = await startImport(user);
    await paste(user, dialog, TABLE);
    const add = () => user.click(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' }));
    await add();
    await within(dialog).findByRole('alert');
    await add();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(log.partnerBatches).toHaveLength(2);
    expect(current().accounts.filter((account) => account.company === 'Datum Labs')).toHaveLength(1);
    expect(current().marketLinks.filter((l) => l.partnerId === 'p_2' && l.marketId === M)).toHaveLength(1);
  });

  it('checks the preview again after a refusal: an import the book holds after all is never added twice', async () => {
    const { user, log, book: current } = open({ refuseImport: { message: 'Google Sheets isn’t answering.', times: 1, saved: true } });
    const dialog = await startImport(user);
    await paste(user, dialog, TABLE);
    await user.click(within(dialog).getByRole('button', { name: 'Add 3 partners and add this market to 1' }));
    await within(dialog).findByRole('alert');
    for (const company of ['Datum Labs', 'Beta', 'Fourth Coffee']) expect(row(dialog, company)).toHaveTextContent('already in this market');
    expect(within(dialog).getByRole('status')).toHaveTextContent('0 of 8 ticked.');
    expect(within(dialog).getByRole('button', { name: 'Add 0 partners' })).toBeDisabled();
    expect(log.partnerBatches).toHaveLength(1);
    expect(current().accounts.filter((account) => account.company === 'Datum Labs')).toHaveLength(1);
  });

  it('won’t add more than one import can carry, and says so', async () => {
    const { user, log } = open();
    const dialog = await startImport(user);
    // Each new company with evidence is four changes: the company, the partner, its link and its desk notes.
    const rows = Array.from({ length: Math.floor(MAX_BATCH / 4) + 1 }, (_, i) => `| Company ${i} | c${i}.example | Fits | c${i}.example/about |`);
    await paste(user, dialog, ['| Company | Website | Why it fits | Evidence and sources |', '|---|---|---|---|', ...rows].join('\n'));
    const add = within(dialog).getByRole('button', { name: `Add ${rows.length} partners` });
    expect(add).toBeDisabled();
    expect(within(dialog).getByText('That is more than one import can add. Untick some rows and add these, then import the rest.')).toBeInTheDocument();
    await user.click(within(dialog).getByRole('checkbox', { name: 'Import Company 0' }));
    expect(within(dialog).getByRole('button', { name: `Add ${rows.length - 1} partners` })).toBeEnabled();
    expect(log.partnerBatches).toHaveLength(0);
  });

  it('refuses a file over 2 MB, and previews a CSV file', async () => {
    const { user } = open();
    const dialog = await startImport(user);
    const input = within(dialog).getByLabelText('Or upload a .csv file');
    await user.upload(input, new File(['x'.repeat(MAX_FILE_BYTES + 1)], 'big.csv', { type: 'text/csv' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This file is larger than 2 MB. Upload a smaller file, or paste the table instead.');

    await user.upload(input, new File(['Company;Website\nKappa GmbH;kappa.example\n'], 'ok.csv', { type: 'text/csv' }));
    expect(await within(dialog).findByRole('checkbox', { name: 'Import Kappa GmbH' })).toBeChecked();
    await user.click(within(dialog).getByRole('button', { name: 'Back' }));
    expect(within(dialog).getByRole('textbox', { name: 'Paste the AI’s table' })).toHaveValue('Company;Website\nKappa GmbH;kappa.example\n');
  });
});

describe('an agent’s new partners proposal', () => {
  const PROPOSAL = 'prp_partners1';
  const head: ProposalHead = {
    id: PROPOSAL, kind: 'partners', status: 'waiting', createdAt: '2026-10-27T10:00:00.000Z', answeredAt: null,
    expiresAt: '2026-11-26T10:00:00.000Z', agentName: 'Claude', makerOn: true,
  };
  /** One row per company in the Proposals tab, as `propose_partners` writes them. */
  const companies = (names: string[]) => names.map((name, i) => proposalItem({
    id: `r_c${i}`, proposalId: PROPOSAL, kind: 'partners', accountId: null, partnerId: null, marketId: M, hypothesisId: null,
    about: 'Austria', what: 'company', proposed: name, evidence: 'They sell to banks', targetUpdated: null,
    details: `Website: ${name.toLowerCase().split(' ')[0]}.example\nCountry: AT\nWhy it fits: Banks\nSource detail: Web search for ${name}`,
    expiresOn: head.expiresAt, proposedOn: head.createdAt,
  }));
  /** Alpha is in this market; Omega GmbH on its Exclusions; Beta a reseller elsewhere; Contoso a managed service partner. */
  const TWELVE = ['Alpha', 'Omega GmbH', 'Beta', 'Contoso', 'Northwind', 'Fabrikam', 'Litware', 'Tailspin', 'Wingtip', 'Proseware', 'Adatum', 'Lucerne'];

  function openWith(names: string[], over: (b: PartnerBook) => PartnerBook = (b) => b) {
    const user = userEvent.setup();
    const start = book();
    const files = { market: sampleMarket(), book: over({ ...start, proposalItems: companies(names) }) };
    const rendered = renderMarket(<Pipeline />, files, { proposals: [head] });
    return { user, ...rendered };
  }

  it('the import preview from a proposal marks duplicates on the book as it is now and starts on the preview', async () => {
    // Datum Labs got into this market by hand after Claude proposed it.
    const { user } = openWith([...TWELVE.slice(0, 4), 'Datum Labs'], (b) => ({
      ...b,
      accounts: [...b.accounts, anAccount({ id: 'a_datum', company: 'Datum Labs', website: 'datum.example' })],
      partners: [...b.partners, partner({ id: 'p_datum', accountId: 'a_datum' })],
      marketLinks: [...b.marketLinks, marketLink({ id: 'l_datum', partnerId: 'p_datum' })],
    }));
    const card = screen.getByRole('region', { name: 'Desk Agent proposes' });
    expect(card).toHaveTextContent('5 companies for Austria');
    expect(within(card).queryByText('Not set')).toBeNull();
    await user.click(within(card).getByRole('button', { name: 'Review the companies' }));

    const dialog = screen.getByRole('dialog', { name: 'Review the companies' });
    // Straight on the preview: no table to paste.
    expect(within(dialog).queryByRole('textbox', { name: 'Paste the AI’s table' })).toBeNull();
    expect(within(dialog).getByRole('table', { name: 'Preview' })).toBeInTheDocument();
    expect(row(dialog, 'Alpha')).toHaveTextContent(COPY.ROW_IN_MARKET);
    expect(within(row(dialog, 'Alpha')).getByRole('checkbox')).toBeDisabled();
    expect(row(dialog, 'Datum Labs')).toHaveTextContent(COPY.ROW_IN_MARKET);
    expect(within(row(dialog, 'Datum Labs')).getByRole('checkbox')).toBeDisabled();
    expect(row(dialog, 'Omega GmbH')).toHaveTextContent('Existing partner');
    expect(within(row(dialog, 'Beta')).getByRole('checkbox')).toBeChecked();
    expect(within(row(dialog, 'Contoso')).getByRole('checkbox')).toBeChecked();
    expect(dialog).toHaveTextContent('2 of 5 ticked');

    // Closing changes nothing.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('region', { name: 'Desk Agent proposes' })).toHaveTextContent('Review the companies');
  });

  it('importing 9 of 12 proposed companies marks the proposal "Accepted 9 of 12"', async () => {
    const { user, log, book: now } = openWith(TWELVE);
    await user.click(screen.getByRole('button', { name: 'Review the companies' }));
    const dialog = screen.getByRole('dialog', { name: 'Review the companies' });
    expect(dialog).toHaveTextContent('10 of 12 ticked');
    await user.click(within(row(dialog, 'Lucerne')).getByRole('checkbox'));
    await user.click(within(dialog).getByRole('button', { name: /^Add / }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getByRole('region', { name: 'Desk Agent proposes' })).toHaveTextContent('Accepted 9 of 12');
    const [sent] = log.partnerBatches;
    expect(sent!.batch.accept).toMatchObject({ proposalId: PROPOSAL, ticked: [2, 3, 4, 5, 6, 7, 8, 9, 10] });
    // Each new partner has the source AI search, with the Source detail the agent gave.
    const fabrikam = now().partners.find((p) => now().accounts.find((a) => a.id === p.accountId)?.company === 'Fabrikam');
    expect(fabrikam).toMatchObject({ source: 'ai_search', sourceDetail: 'Web search for Fabrikam' });
    expect(now().proposalItems.filter((i) => i.status === 'rejected').map((i) => i.proposed)).toEqual(['Alpha', 'Omega GmbH', 'Lucerne']);
  });
});

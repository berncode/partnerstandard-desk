// @vitest-environment jsdom
// The Share tab draws both one-pagers from the case on screen (the case's one editor) and shares through `caseShare`.
import { EXAMPLES, type BusinessCase as Case } from '@partner-desk/core';
import type { Snapshot } from '@partner-desk/storage';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RemoteResult } from '@/editor/remote';
import { CaseEditor, PartnerCaseTab } from './case-editor';
import { CasePageProvider } from './case-page';
import { ShareTab, type ShareCase, type UnshareCase } from './share-content';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const URL_A = 'https://desk.test/s/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const STAMPED = '2026-10-30T12:00:00.000Z';
const LATER = '2026-10-30T12:05:00.000Z';
/** Our case's own words, each written to be found nowhere else. */
const RECOMMENDATION = 'Recommend-4b1e: sign Northwind before the spring.';
const ASK = 'Ask-9c2d: a partner manager, half time.';
const OURS_ONLY = [
  RECOMMENDATION, ASK, 'Internal', 'Assumption', 'Finance', 'Gross margin', 'Present in the Nordics before competitors arrive',
  'Northwind’s references with retail customers', 'Partner manager time', 'Finance, 2025: customers with a local partner renew more often',
  'Partnership with Northwind: is it worth it', 'Net value',
];

let ids = 0;
/** Each test its own case id: the links made in a tab are kept by case id. */
const saas = (patch: Partial<Case> = {}): Case => {
  const c = { ...structuredClone(EXAMPLES.saas.case), id: `case_${(ids += 1)}`, ...patch };
  c.ours.recommendation = RECOMMENDATION;
  c.ours.ask = ASK;
  return c;
};
const snapshot = (value: Case) => ({ value, issues: [] }) as unknown as Snapshot<Case>;

type Save = (input: { caseId: string; case: Case; base: Case; expectedUpdatedAt: string | null }) => Promise<RemoteResult<Case>>;

/** The Share tab, and with `editing` the partner case tab beside it, to change the case on screen. */
function show(c: Case, { side = 'partner', sharedAt = null, share, unshare, save, editing = false }: {
  side?: 'partner' | 'ours'; sharedAt?: string | null; share?: ShareCase; unshare?: UnshareCase; save?: Save; editing?: boolean;
} = {}) {
  const saves = vi.fn(save ?? (async ({ case: sent }: Parameters<Save>[0]): Promise<RemoteResult<Case>> =>
    ({ ok: true, snapshot: snapshot({ ...sent, updatedAt: LATER }), entityId: null })));
  const shares = vi.fn(share ?? (async ({ caseId }: { caseId: string }) =>
    ({ ok: true as const, url: URL_A, snapshot: snapshot({ ...c, id: caseId, shared: { sharedAt: STAMPED }, updatedAt: STAMPED }) })));
  const unshares = vi.fn(unshare ?? (async () => ({ ok: true as const, snapshot: snapshot({ ...c, shared: null, updatedAt: LATER }) })));
  const view = render(
    <CaseEditor initial={c} save={saves}>
      <CasePageProvider programs={[]} typeGone={false} shared={sharedAt ? { createdAt: sharedAt } : null}>
        <ShareTab side={side} share={shares} unshare={unshares} />
        {editing && <PartnerCaseTab />}
      </CasePageProvider>
    </CaseEditor>,
  );
  return { ...view, saves, shares, unshares };
}
const switcher = () => screen.getByRole('navigation', { name: 'One-pager' });
const partnerRegion = () => screen.getByRole('region', { name: 'Partner case · for Northwind' });

describe('the Share tab', () => {
  afterEach(() => vi.restoreAllMocks());

  it('opens on the partner case: the switch, the one-pager, Download PDF, the share controls and what the link shows', () => {
    const c = saas();
    show(c);
    const partner = within(switcher()).getByRole('link', { name: 'Partner case · for Northwind' });
    const ours = within(switcher()).getByRole('link', { name: 'Our case · internal, for your manager' });
    expect(partner).toHaveAttribute('aria-current', 'page');
    expect(partner).toHaveAttribute('href', `/business-cases/${c.id}/share`);
    expect(ours).not.toHaveAttribute('aria-current');
    expect(ours).toHaveAttribute('href', `/business-cases/${c.id}/share?show=ours`);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('What partnering with Acme is worth to Northwind');
    expect(screen.getByRole('group', { name: 'Margin from Acme' })).toHaveTextContent('€578,608');
    expect(within(partnerRegion()).getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Share a link with Northwind' })).toBeInTheDocument();
    expect(screen.getByText('The link shows this case as it is now. Changes you make here show up for Northwind.')).toBeInTheDocument();
    expect(screen.queryByText('Internal: download it and send it to your manager. It has no link.')).toBeNull();
  });

  it('shows nothing of our case on the partner side (Review Focus 4)', () => {
    show(saas());
    const panel = partnerRegion().innerHTML;
    for (const hidden of OURS_ONLY) expect(panel, hidden).not.toContain(hidden);
  });

  it('follows the case on screen: a change on another tab shows at once', async () => {
    show(saas(), { editing: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Year 1' }), { target: { value: '6' } });
    await waitFor(() => expect(within(partnerRegion()).getByRole('region', { name: 'The plan' })).toHaveTextContent('New deals per year: 6, 7, 11, 15, 19.'));
  });

  it('saves what is on screen, shares, shows the link with Copy, and the next save goes over the stamped case', async () => {
    const user = userEvent.setup();
    const c = saas();
    const { saves, shares } = show(c, { editing: true });
    fireEvent.change(screen.getByRole('textbox', { name: 'Year 1' }), { target: { value: '5' } });
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    // What was on screen was saved before the link was made, so the link shows it.
    expect(saves).toHaveBeenCalledTimes(1);
    expect(saves.mock.calls[0]![0].case.deals[0]).toBe(5);
    expect(shares).toHaveBeenCalledWith({ caseId: c.id });
    expect(saves.mock.invocationCallOrder[0]).toBeLessThan(shares.mock.invocationCallOrder[0]!);

    expect(await screen.findByText(/^Shared on \d{1,2} [A-Z][a-z]{2} \d{4}\.$/)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Link for Northwind' })).toHaveValue(URL_A);
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeInTheDocument();

    // The share stamped the file: the next save goes over the stamped case, not the one read before.
    fireEvent.change(screen.getByRole('textbox', { name: 'Year 2' }), { target: { value: '8' } });
    await waitFor(() => expect(saves).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(saves.mock.calls[1]![0]).toMatchObject({ expectedUpdatedAt: STAMPED, base: { shared: { sharedAt: STAMPED } } });
  });

  it('doesn’t share while what is on screen can’t be saved, and says why', async () => {
    const user = userEvent.setup();
    const { shares } = show(saas(), {
      save: async () => ({ ok: false, error: 'unavailable', message: 'Google Sheets isn’t responding right now. Try again in a moment.' }),
      editing: true,
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Year 1' }), { target: { value: '5' } });
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google Sheets isn’t responding right now. Try again in a moment.');
    expect(shares).not.toHaveBeenCalled();
  });

  it('a shared case shows when, Make a new link and Stop sharing; Stop sharing turns it off', async () => {
    const user = userEvent.setup();
    const c = saas();
    const { unshares } = show(c, { sharedAt: '2026-10-25T10:00:00.000Z' });
    expect(screen.getByText('Shared on 25 Oct 2026.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make a new link' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Stop sharing' }));
    await user.click(within(screen.getByRole('dialog', { name: 'Stop sharing with Northwind?' })).getByRole('button', { name: 'Stop sharing' }));
    expect(unshares).toHaveBeenCalledWith({ caseId: c.id });
    expect(await screen.findByRole('button', { name: 'Share a link with Northwind' })).toBeInTheDocument();
  });

  it('shows a refusal from sharing', async () => {
    const user = userEvent.setup();
    show(saas(), { share: async () => ({ ok: false, error: 'forbidden', message: 'You can’t do that.' }) });
    await user.click(screen.getByRole('button', { name: 'Share a link with Northwind' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('You can’t do that.');
  });

  it('opens our case with ?show=ours: our one-pager, Download PDF and the note, and no share button', () => {
    show(saas(), { side: 'ours', sharedAt: '2026-10-25T10:00:00.000Z' });
    expect(within(switcher()).getByRole('link', { name: 'Our case · internal, for your manager' })).toHaveAttribute('aria-current', 'page');
    expect(within(switcher()).getByRole('link', { name: 'Partner case · for Northwind' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Partnership with Northwind: is it worth it for Acme?');
    expect(screen.getByRole('region', { name: 'Recommendation' })).toHaveTextContent(RECOMMENDATION);
    expect(screen.getByRole('button', { name: 'Download PDF' })).toBeInTheDocument();
    expect(screen.getByText('Internal: download it and send it to your manager. It has no link.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Share a link/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Stop sharing' })).toBeNull();
    expect(screen.queryByText(/The link shows this case/)).toBeNull();
    expect(screen.queryByText(/What partnering with/)).toBeNull();
  });

  it('opens the print dialog on Download PDF', () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => {});
    show(saas(), { side: 'ours' });
    fireEvent.click(screen.getByRole('button', { name: 'Download PDF' }));
    expect(print).toHaveBeenCalledOnce();
  });

  it('says what to do when the case’s partner type left its offer, on either side, and shows no one-pager', () => {
    for (const side of ['partner', 'ours'] as const) {
      const view = show(saas({ typeId: 'type_gone' }), { side });
      expect(screen.getByText('This case’s partner type is no longer in its offer.')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Open the partner case' })).toHaveAttribute('href', expect.stringMatching(/^\/business-cases\/case_\d+$/));
      expect(screen.queryByRole('button', { name: 'Download PDF' })).toBeNull();
      expect(screen.queryByRole('button', { name: /Share a link/ })).toBeNull();
      expect(screen.queryByRole('article')).toBeNull();
      view.unmount();
    }
  });
});

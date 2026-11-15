// @vitest-environment jsdom
// The whole partner page with its real editor: only the server actions are mocked.
import {
  applyPartnerChange, applyPartnerChanges, deleteSectionChanges, type PartnerBook, type PartnerChange, type ProposalHead, type ProposalItem,
} from '@partner-desk/core';
import { aPartner, EARLIER, person, proposalItem, sampleBook } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { screen, render, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const actions = vi.hoisted(() => ({
  partnerChange: vi.fn(), partnerImport: vi.fn(), partnerRemoveType: vi.fn(), marketRead: vi.fn(), proposalAccept: vi.fn(), proposalReject: vi.fn(),
  caseList: vi.fn(), caseRows: vi.fn(), caseCreate: vi.fn(), mapList: vi.fn(), mapArea: vi.fn(), mapStart: vi.fn(), reviewArea: vi.fn(),
}));
const router = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  useSearchParams: () => new URLSearchParams(),
}));
const sonner = vi.hoisted(() => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));
vi.mock('sonner', () => sonner);
vi.mock('@/app/(signed-in)/actions/partners', () => ({
  partnerChange: actions.partnerChange, partnerImport: actions.partnerImport, partnerRemoveType: actions.partnerRemoveType,
}));
vi.mock('@/app/(signed-in)/actions/proposals', () => ({ proposalAccept: actions.proposalAccept, proposalReject: actions.proposalReject }));
vi.mock('@/app/(signed-in)/actions/markets', () => ({
  marketRead: actions.marketRead, marketChange: vi.fn(), marketExclusionsImport: vi.fn(),
}));
vi.mock('@/app/(signed-in)/actions/cases', () => ({ caseList: actions.caseList, caseRows: actions.caseRows, caseCreate: actions.caseCreate }));
vi.mock('@/app/(signed-in)/actions/maps', () => ({ mapList: actions.mapList, mapArea: actions.mapArea, mapStart: actions.mapStart }));
vi.mock('@/app/(signed-in)/actions/reviews', () => ({ reviewArea: actions.reviewArea }));
vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

import { PartnerPage } from './partner-page';

const none = { customerBase: null, credibility: null, capability: null, commitment: null };
const initial = { value: sampleBook({ partners: [aPartner({ desk: none })], people: [], calls: [], qualifications: [], marketLinks: [] }), issues: [] };

beforeEach(() => {
  vi.clearAllMocks();
  actions.caseList.mockResolvedValue({ ok: true, cases: [] });
  actions.caseRows.mockResolvedValue({ ok: true, rows: [] });
  actions.mapList.mockResolvedValue({ ok: true, maps: [] });
  actions.mapArea.mockResolvedValue({ ok: true, state: { kind: 'none' } });
  actions.reviewArea.mockResolvedValue({ ok: true, state: { kind: 'none' } });
});

describe('the partner page when Google needs reconnecting', () => {
  it('shows the Reconnect banner, rolls the change back and turns the page read-only', async () => {
    actions.partnerChange.mockResolvedValue({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    const user = userEvent.setup();
    render(<PartnerPage initial={initial} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="google" />);
    expect(screen.getByRole('button', { name: 'Log a call' })).toBeEnabled();
    const credibility = () => within(screen.getAllByRole('group', { name: 'Credibility' })[0]!).getByRole('button', { name: /^2:/ });
    await user.click(credibility());
    expect(actions.partnerChange).toHaveBeenCalledTimes(1);

    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Reconnect Google to keep working.');
    expect(banner).toHaveTextContent('Your last change wasn’t saved.');
    expect(within(banner).getByRole('button', { name: 'Reconnect Google' })).toBeInTheDocument();
    // The score went back, and nothing on the page can be changed.
    await waitFor(() => expect(credibility()).toHaveAttribute('aria-pressed', 'false'));
    expect(credibility()).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Log a call' })).toBeNull();
  });
});

/** The server: the change applied to the book it holds now, as changePartner would. */
function serverFor(start: PartnerBook) {
  let book = start;
  const stamp = () => ({ now: '2026-10-30T10:00:00.000Z', actor: 'Anna' });
  actions.partnerChange.mockImplementation(async (change: PartnerChange) => {
    const out = applyPartnerChange(book, change, stamp());
    if (!out.ok) return { ok: false, error: out.error, message: out.message };
    book = out.value;
    return { ok: true, snapshot: { value: book, issues: [] }, entityId: out.entityId };
  });
  actions.partnerRemoveType.mockImplementation(async ({ partnerId, expected }: { partnerId: string; expected: string[] }) => {
    // As the command: only what the screen showed going, else a conflict.
    const changes = deleteSectionChanges(book, partnerId);
    if (JSON.stringify(changes.map((c) => ('id' in c ? c.id : '')).sort()) !== JSON.stringify([...expected].sort())) {
      return { ok: false, error: 'conflict', message: COPY.SAVE_CONFLICT };
    }
    const out = applyPartnerChanges(book, changes, stamp());
    if (!out.ok) return { ok: false, error: out.error, message: out.message };
    book = out.value;
    return { ok: true, snapshot: { value: book, issues: [] }, entityIds: out.entityIds };
  });
  return { book: () => book };
}

/** The Undo button of the last undo toast. */
function clickUndo() {
  const call = [...sonner.toast.mock.calls].reverse().find(([, options]) => (options as { action?: { label: string } })?.action?.label === COPY.UNDO);
  if (!call) throw new Error('no undo toast');
  (call[1] as { action: { onClick: () => void } }).action.onClick();
}

describe('removing a partner type', () => {
  const lastOnly = sampleBook({ partners: [aPartner({ desk: none })], people: [person()], calls: [], qualifications: [], marketLinks: [] });

  it('asks first, saying the company and its contacts go too, then sends one batch; Undo brings back the company, the contact and the type', async () => {
    const server = serverFor(lastOnly);
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: lastOnly, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Acme GmbH as a reseller?' });
    expect(dialog).toHaveTextContent(COPY.REMOVE_LAST_TYPE_TEXT('Acme GmbH'));
    expect(actions.caseList).toHaveBeenCalledWith({ partnerId: 'p_abc123' });
    expect(actions.partnerRemoveType).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(server.book().accounts).toEqual([]));
    expect(actions.partnerRemoveType).toHaveBeenCalledTimes(1);
    expect(actions.partnerRemoveType).toHaveBeenCalledWith({ partnerId: 'p_abc123', expected: ['p_abc123', 'e_abc123', 'a_abc123'] });
    expect(actions.partnerChange).not.toHaveBeenCalled();
    expect(server.book()).toMatchObject({ accounts: [], partners: [], people: [] });
    expect(await screen.findByText(COPY.PARTNER_GONE)).toBeInTheDocument();

    clickUndo();
    await waitFor(() => expect(server.book().partners).toHaveLength(1));
    const sent = actions.partnerChange.mock.calls.map(([change]) => change as PartnerChange);
    expect(sent.map((c) => (c.kind === 'add' ? c.entity : c.kind))).toEqual(['account', 'person', 'partner']);
    expect(server.book().accounts).toMatchObject([{ id: 'a_abc123', company: 'Acme GmbH' }]);
    expect(server.book().people).toMatchObject([{ id: 'e_abc123', accountId: 'a_abc123' }]);
    expect(server.book().partners).toMatchObject([{ id: 'p_abc123', accountId: 'a_abc123', partnerType: 'reseller' }]);
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent('Acme GmbH');
  });

  it('removes nothing when the file has a contact the page didn’t show, and keeps the company on screen', async () => {
    const server = serverFor({ ...lastOnly, people: [...lastOnly.people, person({ id: 'e_new', name: 'Max Neu' })] });
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: lastOnly, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(actions.partnerRemoveType).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(server.book().people).toHaveLength(2);
    expect(server.book().accounts).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme GmbH');
    expect(sonner.toast).toHaveBeenCalledWith(COPY.SAVE_CONFLICT, expect.anything());
  });

  it('keeps the company when it has another type, and sends one batch however often Remove is pressed', async () => {
    const two = { ...lastOnly, partners: [...lastOnly.partners, aPartner({ id: 'p_tech', partnerType: 'technology', desk: none })] };
    let release: () => void = () => {};
    const server = serverFor(two);
    const answer = actions.partnerRemoveType.getMockImplementation()!;
    actions.partnerRemoveType.mockImplementation((input: { partnerId: string; expected: string[] }) => new Promise((resolve) => { release = () => resolve(answer(input)); }));
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: two, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Acme GmbH as a reseller?' });
    expect(dialog).toHaveTextContent(COPY.REMOVE_TYPE_TEXT('Acme GmbH'));
    const confirm = within(dialog).getByRole('button', { name: 'Remove' });
    await user.click(confirm);
    await user.click(confirm).catch(() => {});
    release();
    await waitFor(() => expect(server.book().partners.map((p) => p.id)).toEqual(['p_tech']));
    expect(actions.partnerRemoveType).toHaveBeenCalledTimes(1);
    expect(server.book().accounts).toHaveLength(1);
    expect(server.book().people).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Acme GmbH');
    expect(screen.getByRole('tab', { name: 'Technology Partner' })).toHaveAttribute('aria-selected', 'true');
  });

  it('with business cases says how many and that closing keeps everything, then sends the choice, with no undo', async () => {
    const two = { ...lastOnly, partners: [...lastOnly.partners, aPartner({ id: 'p_tech', partnerType: 'technology', desk: none })] };
    const server = serverFor(two);
    actions.caseList.mockResolvedValue({ ok: true, cases: [{ caseId: 'case_1' }, { caseId: 'case_2' }] });
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: two, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Acme GmbH as a reseller?' });
    expect(dialog).toHaveTextContent('Acme GmbH has 2 business cases as a reseller.');
    expect(dialog).toHaveTextContent(COPY.CLOSE_KEEPS_EVERYTHING);
    expect(dialog).toHaveTextContent('What happens to the cases?');
    expect(within(dialog).queryByRole('button', { name: 'Remove' })).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Move the files to the Drive trash' }));
    await waitFor(() => expect(server.book().partners.map((p) => p.id)).toEqual(['p_tech']));
    expect(actions.partnerRemoveType).toHaveBeenCalledWith({ partnerId: 'p_abc123', expected: ['p_abc123'], items: 'trash' });
    // The cases don't come back with an undo, so none is offered.
    expect(sonner.toast).toHaveBeenCalledWith(COPY.PARTNER_TYPE_REMOVED);
    expect(sonner.toast.mock.calls.some(([, options]) => (options as { action?: unknown } | undefined)?.action)).toBe(false);
  });

  it('keeps the files of the company’s last partner type when asked, saying the company goes too', async () => {
    const server = serverFor(lastOnly);
    actions.caseList.mockResolvedValue({ ok: true, cases: [{ caseId: 'case_1' }] });
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: lastOnly, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Acme GmbH as a reseller?' });
    expect(dialog).toHaveTextContent(COPY.REMOVE_LAST_TYPE_CASES_TEXT('Acme GmbH'));
    expect(dialog).toHaveTextContent('Acme GmbH has 1 business case as a reseller.');
    await user.click(within(dialog).getByRole('button', { name: 'Keep the file in Drive' }));
    await waitFor(() => expect(server.book().accounts).toEqual([]));
    expect(actions.partnerRemoveType).toHaveBeenCalledWith({ partnerId: 'p_abc123', expected: ['p_abc123', 'e_abc123', 'a_abc123'], items: 'keep' });
  });

  it('with a MAP names it with the cases, and sends the choice for both', async () => {
    const server = serverFor(lastOnly);
    actions.caseList.mockResolvedValue({ ok: true, cases: [{ caseId: 'case_1' }] });
    actions.mapList.mockResolvedValue({ ok: true, maps: [{ mapId: 'map_aaaaaaaaaa' }] });
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: lastOnly, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Acme GmbH as a reseller?' });
    expect(actions.mapList).toHaveBeenCalledWith({ partnerId: 'p_abc123' });
    expect(dialog).toHaveTextContent('Acme GmbH has 1 business case and a MAP as a reseller.');
    expect(dialog).toHaveTextContent('What happens to the case and the MAP?');
    expect(dialog).toHaveTextContent('Either way, their links stop working.');
    await user.click(within(dialog).getByRole('button', { name: 'Move the files to the Drive trash' }));
    await waitFor(() => expect(server.book().accounts).toEqual([]));
    expect(actions.partnerRemoveType).toHaveBeenCalledWith({ partnerId: 'p_abc123', expected: ['p_abc123', 'e_abc123', 'a_abc123'], items: 'trash' });
  });

  it('with only a MAP asks about the MAP', async () => {
    serverFor(lastOnly);
    actions.mapList.mockResolvedValue({ ok: true, maps: [{ mapId: 'map_aaaaaaaaaa' }] });
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: lastOnly, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    const dialog = await screen.findByRole('dialog', { name: 'Remove Acme GmbH as a reseller?' });
    expect(dialog).toHaveTextContent('Acme GmbH has a MAP as a reseller.');
    expect(dialog).toHaveTextContent('What happens to the MAP?');
    expect(within(dialog).getByRole('button', { name: 'Move the file to the Drive trash' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Keep the file in Drive' })).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Either way, its links stop working.');
  });

  it('says why and opens nothing when the cases can’t be counted', async () => {
    serverFor(lastOnly);
    actions.caseList.mockResolvedValue({ ok: false, error: 'unavailable', message: 'Not now.' });
    const user = userEvent.setup();
    render(<PartnerPage initial={{ value: lastOnly, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna" today="2026-10-28" storage="memory" />);
    await user.click(screen.getByRole('button', { name: 'Remove Reseller' }));
    await waitFor(() => expect(sonner.toast.error).toHaveBeenCalledWith('Not now.'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(actions.partnerRemoveType).not.toHaveBeenCalled();
  });
});

describe('proposals on the partner page', () => {
  const PROPOSED = '2026-10-27T09:00:00.000Z';
  const head = (over: Partial<ProposalHead> = {}): ProposalHead => ({
    id: 'prp_abc123', kind: 'stage', status: 'waiting', createdAt: PROPOSED, answeredAt: null, expiresAt: '2026-11-26T09:00:00.000Z',
    agentName: 'Claude', makerOn: true, ...over,
  });
  const item = (over: Partial<ProposalItem>) => proposalItem({
    kind: 'stage', what: 'step', proposedOn: PROPOSED, expiresOn: '2026-11-26T09:00:00.000Z', targetUpdated: EARLIER, ...over,
  });
  const bookWith = (partner: Parameters<typeof aPartner>[0], items: ProposalItem[]) =>
    sampleBook({ partners: [aPartner({ desk: none, updatedAt: EARLIER, ...partner })], people: [], calls: [], qualifications: [], marketLinks: [], proposalItems: items });
  /** The page with the open partner type's proposals, read with the page; NOW is the server's time when it was read. */
  const page = (book: PartnerBook, heads: ProposalHead[], storage: 'google' | 'memory' = 'memory') => render(
    <PartnerPage initial={{ value: book, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={[]} levels={{}} actor="Anna"
      today="2026-10-28" storage={storage} proposals={heads} timeZone="Europe/Berlin" now="2026-10-28T10:00:00.000Z" />,
  );
  const card = () => screen.getByRole('region', { name: 'Desk Agent proposes' });
  /** The server's answer to an accept: the book with the proposal's rows answered, as acceptProposal writes it. */
  const accepted = (book: PartnerBook, patch: Partial<PartnerBook['partners'][number]> = {}) => ({
    ok: true, status: 'accepted', entityIds: [],
    snapshot: { value: { ...book, partners: book.partners.map((p) => ({ ...p, ...patch })), proposalItems: book.proposalItems.map((i) => ({ ...i, status: 'accepted', answeredOn: '2026-10-28T10:00:00.000Z' })) }, issues: [] },
  });

  it('a step proposal into Qualification without a hypothesis that holds shows the stepper’s advice; Cancel changes nothing', async () => {
    const book = bookWith({ step: 'discovery_call' }, [item({ proposed: 'Qualification', evidence: 'The call went well' })]);
    const user = userEvent.setup();
    page(book, [head()]);
    expect(card()).toHaveTextContent('Qualification');
    expect(card()).toHaveTextContent('The call went well');
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    const advice = screen.getByRole('alert');
    expect(advice).toHaveTextContent(COPY.HYPOTHESIS_FIRST);
    await user.click(within(advice).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(actions.proposalAccept).not.toHaveBeenCalled();
    expect(actions.partnerChange).not.toHaveBeenCalled();
    expect(within(card()).getByRole('button', { name: 'Accept' })).toBeEnabled();
    expect(within(screen.getByRole('group', { name: 'Recruitment step' })).getByRole('button', { name: 'Discovery call' })).toHaveAttribute('aria-current', 'step');

    // Go ahead anyway accepts it, with the updatedAt the card showed.
    actions.proposalAccept.mockResolvedValue(accepted(book, { step: 'qualification' }));
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Go ahead anyway' }));
    await waitFor(() => expect(actions.proposalAccept).toHaveBeenCalledWith({ proposalId: 'prp_abc123', expectedUpdatedAt: EARLIER }));
    expect(await within(card()).findByText('Accepted')).toBeInTheDocument();
  });

  it('a step proposal without advice accepts in one click', async () => {
    const book = bookWith({ step: 'researched' }, [item({ proposed: 'Discovery call' })]);
    actions.proposalAccept.mockResolvedValue(accepted(book, { step: 'discovery_call' }));
    const user = userEvent.setup();
    page(book, [head()]);
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    expect(screen.queryByRole('alert')).toBeNull();
    // On screen at once: the step moved and the card is one line.
    expect(within(screen.getByRole('group', { name: 'Recruitment step' })).getByRole('button', { name: 'Discovery call' })).toHaveAttribute('aria-current', 'step');
    expect(card()).toHaveTextContent('Accepted');
    await waitFor(() => expect(actions.proposalAccept).toHaveBeenCalledTimes(1));
    expect(actions.proposalAccept).toHaveBeenCalledWith({ proposalId: 'prp_abc123', expectedUpdatedAt: EARLIER });
    expect(actions.partnerChange).not.toHaveBeenCalled();
  });

  it('a signed proposal opens the sign dialog with the date filled in and the MAP question asked', async () => {
    actions.mapArea.mockResolvedValue({ ok: true, state: { kind: 'unread', mapId: 'map_aaaaaaaaaa', displayName: 'Acme GmbH as reseller', plannedStart: '2026-10-01', today: '2026-10-28', health: null, nextMilestone: null, message: 'Not now.', deletable: false } });
    const book = bookWith({ step: 'map', mapFilled: true }, [item({ kind: 'signed', what: 'signedDate', proposed: '2026-10-11', evidence: 'Signed on Friday' })]);
    actions.proposalAccept.mockResolvedValue({ ...accepted(book, { stage: 'onboarding', step: null, signedDate: '2026-10-11' }), mapDates: { moved: true, days: 10 } });
    const user = userEvent.setup();
    page(book, [head({ kind: 'signed' })]);
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark Acme GmbH signed' });
    expect(within(dialog).getByLabelText('Date signed')).toHaveValue('2026-10-11');
    const box = await within(dialog).findByRole('checkbox', {
      name: 'Move the dates of the MAP’s open activities and milestones by 10 days so the agreed schedule keeps its timing',
    });
    expect(box).toBeChecked();
    expect(actions.proposalAccept).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Mark signed' }));
    await waitFor(() => expect(actions.proposalAccept).toHaveBeenCalledWith({
      proposalId: 'prp_abc123', expectedUpdatedAt: EARLIER, signedDate: '2026-10-11', shiftMapDates: true,
    }));
    expect(actions.partnerChange).not.toHaveBeenCalled();
    expect(sonner.toast.error).not.toHaveBeenCalled();
  });

  it('a signed proposal with a program picked in the dialog: the accept first, then the program the partner joins', async () => {
    const book = bookWith({ step: 'map', mapFilled: true }, [item({ kind: 'signed', what: 'signedDate', proposed: '2026-10-20', evidence: 'Signed' })]);
    const signedBook = accepted(book, { stage: 'onboarding', step: null, signedDate: '2026-10-20', updatedAt: '2026-10-28T10:00:00.000Z' });
    actions.proposalAccept.mockResolvedValue(signedBook);
    actions.partnerChange.mockImplementation(async (change: PartnerChange) => {
      const out = applyPartnerChange(signedBook.snapshot.value as PartnerBook, change, { now: '2026-10-28T10:01:00.000Z', actor: 'Anna' });
      return out.ok ? { ok: true, snapshot: { value: out.value, issues: [] }, entityId: out.entityId } : { ok: false, error: out.error, message: out.message };
    });
    const programs = [{ programId: 'pg_reseller1', label: 'Reseller', partnerType: 'reseller' as const, title: 'Reseller' }];
    const user = userEvent.setup();
    render(
      <PartnerPage initial={{ value: book, issues: [] }} accountId="a_abc123" markets={[]} linkedMarkets={{}} programs={programs}
        levels={{ pg_reseller1: { status: 'ready', reg: 'Member', pref: 'Gold', prefOn: true } }} actor="Anna" today="2026-10-28" storage="memory"
        proposals={[head({ kind: 'signed' })]} timeZone="Europe/Berlin" now="2026-10-28T10:00:00.000Z" />,
    );
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('dialog', { name: 'Mark Acme GmbH signed' });
    await user.selectOptions(within(dialog).getByRole('combobox', { name: 'Program' }), 'Reseller');
    await user.click(within(dialog).getByRole('button', { name: 'Mark signed' }));
    await waitFor(() => expect(actions.partnerChange).toHaveBeenCalledTimes(1));
    expect(actions.proposalAccept).toHaveBeenCalledWith({ proposalId: 'prp_abc123', expectedUpdatedAt: EARLIER, signedDate: '2026-10-20' });
    expect(actions.partnerChange.mock.calls[0]![0]).toMatchObject({
      kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: 'pg_reseller1', level: 'reg' },
    });
    expect(actions.proposalAccept.mock.invocationCallOrder[0]).toBeLessThan(actions.partnerChange.mock.invocationCallOrder[0]!);
    expect(sonner.toast.error).not.toHaveBeenCalled();
  });

  it('a close proposal opens the close dialog with its reason', async () => {
    const book = bookWith({ step: 'discovery_call' }, [item({ kind: 'close', what: 'closed', proposed: 'No', evidence: 'They sell a rival product' })]);
    actions.proposalAccept.mockResolvedValue(accepted(book, { closed: 'no', closedReason: 'They sell a rival product, sadly' }));
    const user = userEvent.setup();
    page(book, [head({ kind: 'close' })]);
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    const dialog = await screen.findByRole('dialog', { name: /Close Acme GmbH/ });
    expect(within(dialog).getByRole('radio', { name: 'No' })).toBeChecked();
    const reason = within(dialog).getByLabelText('Reason');
    expect(reason).toHaveValue('They sell a rival product');
    await user.type(reason, ', sadly');
    await user.click(within(dialog).getByRole('button', { name: 'Close partner' }));
    await waitFor(() => expect(actions.proposalAccept).toHaveBeenCalledWith({
      proposalId: 'prp_abc123', expectedUpdatedAt: EARLIER, as: 'no', reason: 'They sell a rival product, sadly',
    }));
    expect(actions.partnerChange).not.toHaveBeenCalled();
  });

  it('an accept answered auth shows the Reconnect Google banner and leaves the proposal waiting', async () => {
    const book = bookWith({ step: 'researched' }, [item({ proposed: 'Discovery call' })]);
    actions.proposalAccept.mockResolvedValue({ ok: false, error: 'auth', message: COPY.AUTH_MESSAGE });
    const user = userEvent.setup();
    page(book, [head()], 'google');
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    const banner = await screen.findByRole('alert');
    expect(banner).toHaveTextContent('Reconnect Google to keep working.');
    expect(within(banner).getByRole('button', { name: 'Reconnect Google' })).toBeInTheDocument();
    // The card waits again, without buttons while the page is read-only; the step is back.
    await waitFor(() => expect(card()).not.toHaveTextContent('Accepted'));
    expect(within(card()).queryByRole('button')).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Recruitment step' })).getByRole('button', { name: 'Researched' })).toHaveAttribute('aria-current', 'step');
  });

  it('a conflict says the partner changed and reads the page again', async () => {
    const book = bookWith({ step: 'researched' }, [item({ proposed: 'Discovery call' })]);
    actions.proposalAccept.mockResolvedValue({ ok: false, error: 'conflict', message: COPY.CONFLICT });
    const user = userEvent.setup();
    page(book, [head()]);
    await user.click(within(card()).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(sonner.toast.error).toHaveBeenCalledWith(COPY.PROPOSAL_PARTNER_CHANGED));
    expect(router.refresh).toHaveBeenCalled();
    await waitFor(() => expect(within(card()).getByRole('button', { name: 'Accept' })).toBeEnabled());
  });

  it('a 4C proposal sits in the desk check; Reject sends the note and the card is one line', async () => {
    const book = bookWith({}, [item({ kind: 'fourC', what: 'desk.credibility', proposed: '3', evidence: 'Known brand' })]);
    actions.proposalReject.mockResolvedValue({
      ok: true, entityId: null,
      snapshot: { value: { ...book, proposalItems: book.proposalItems.map((i) => ({ ...i, status: 'rejected', answerNote: 'Not yet', answeredOn: '2026-10-28T10:00:00.000Z' })) }, issues: [] },
    });
    const user = userEvent.setup();
    page(book, [head({ kind: 'fourC' })]);
    const desk = screen.getByRole('region', { name: COPY.DESK_TITLE });
    const proposal = within(desk).getByRole('region', { name: 'Desk Agent proposes' });
    await user.click(within(proposal).getByRole('button', { name: 'Reject' }));
    await user.type(within(proposal).getByLabelText('Why not? (optional)'), 'Not yet');
    await user.click(within(proposal).getByRole('button', { name: 'Reject' }));
    expect(proposal).toHaveTextContent('Rejected');
    await waitFor(() => expect(actions.proposalReject).toHaveBeenCalledWith({ proposalId: 'prp_abc123', note: 'Not yet' }));
  });

  it('a proposal for a partner type removed since sits at the top of the page, Reject only, with why', async () => {
    // The company is a reseller still; the proposal was for its VAR partner type, removed since.
    const book = bookWith({}, [item({ partnerId: 'p_gone01', proposed: 'Discovery call' })]);
    actions.proposalReject.mockResolvedValue({
      ok: true, entityId: null,
      snapshot: { value: { ...book, proposalItems: book.proposalItems.map((i) => ({ ...i, status: 'rejected', answeredOn: '2026-10-28T10:00:00.000Z' })) }, issues: [] },
    });
    const user = userEvent.setup();
    page(book, [head()]);
    const proposal = card();
    // Above the company's header, not under a partner type's stepper.
    expect(proposal.compareDocumentPosition(screen.getByRole('heading', { level: 1 })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(proposal).toHaveTextContent(COPY.GONE);
    expect(within(proposal).queryByRole('button', { name: 'Accept' })).toBeNull();
    await user.click(within(proposal).getByRole('button', { name: 'Reject' }));
    await user.click(within(proposal).getByRole('button', { name: 'Reject' }));
    expect(card()).toHaveTextContent('Rejected');
    await waitFor(() => expect(actions.proposalReject).toHaveBeenCalledWith({ proposalId: 'prp_abc123' }));
  });
});

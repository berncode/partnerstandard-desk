// @vitest-environment jsdom
import type { PartnerBook, PartnerChange } from '@partner-desk/core';
import { anAccount, marketLink, partner, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));
const actions = vi.hoisted(() => ({ marketRead: vi.fn() }));
vi.mock('@/app/(signed-in)/actions/markets', () => ({ marketRead: actions.marketRead }));

import { AddPartnerDialog } from './add-partner-dialog';
import type { MarketOption } from './partners-model';

const book: PartnerBook = sampleBook({
  partners: [partner({ id: 'p_known', company: 'Acme GmbH', website: 'acme.example', partnerType: 'reseller' })],
  people: [], calls: [], qualifications: [],
  marketLinks: [marketLink({ partnerId: 'p_known', marketId: 'm_a' })],
});
const markets: MarketOption[] = [
  { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
  { marketId: 'm_b', displayName: 'Germany · Reseller', archived: false },
  { marketId: 'm_c', displayName: 'Italy · Managed Service Provider', archived: false },
];

const ok = { ok: true as const, entityId: 'p_server' };
const apply = vi.fn<(change: PartnerChange, options?: unknown) => Promise<typeof ok | { ok: false; unknown?: true }>>();
const applyMany = vi.fn<(changes: PartnerChange[], batch: { marketId?: string }, options?: { label?: string }) => Promise<{ ok: true; entityIds: string[] } | { ok: false; unknown?: true }>>();
const onAdded = vi.fn();
const onOpenChange = vi.fn();

const dialog = (b: PartnerBook) => (
  <AddPartnerDialog open onOpenChange={onOpenChange} book={b} markets={markets} onAdded={onAdded} today="2026-10-28"
    editor={{ apply, applyMany, savedIdFor: (id: string) => id } as never} />
);

function show() {
  render(dialog(book));
  return userEvent.setup();
}

beforeEach(() => {
  vi.clearAllMocks();
  apply.mockResolvedValue(ok);
  applyMany.mockResolvedValue({ ok: true, entityIds: ['a_server', 'p_server', 'l_server'] });
  actions.marketRead.mockResolvedValue({ ok: true, snapshot: { value: { ...sampleMarket(), exclusions: [] }, issues: [] }, entityId: null });
});

describe('Add a partner', () => {
  it('asks for the company', async () => {
    const user = show();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Company is required')).toBeVisible();
    expect(apply).not.toHaveBeenCalled();
  });

  it('adds a partner without a market as one batch: the company and its type, with one undo for both', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), '  Globex  ');
    await user.type(screen.getByLabelText('Country'), 'Austria');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    const [changes, batch, options] = applyMany.mock.calls[0]!;
    expect(batch).toEqual({});
    expect(options).toEqual({ label: 'Partner added' });
    expect(changes).toHaveLength(2);
    const [account, section] = changes;
    expect(account).toMatchObject({ kind: 'add', entity: 'account', values: { company: 'Globex', website: '', country: 'Austria' } });
    expect(section).toMatchObject({ kind: 'add', entity: 'partner', values: { partnerType: 'reseller' } });
    if (account?.kind !== 'add' || section?.kind !== 'add') throw new Error('expected adds');
    expect(section.values.accountId).toBe(account.values.id);
    expect(apply).not.toHaveBeenCalled();
    expect(onAdded).toHaveBeenCalledWith('potential');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('puts the type on a company that is here with no partner type, in one batch, instead of a second company', async () => {
    const hidden = sampleBook({
      accounts: [anAccount({ id: 'a_hidden', company: 'Hidden Co', website: '', country: 'Austria' })],
      partners: [], people: [], calls: [], qualifications: [], marketLinks: [],
    });
    render(dialog(hidden));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Company'), 'Hidden Co');
    expect(screen.queryByRole('status')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    expect(applyMany.mock.calls[0]![0]).toEqual([
      { kind: 'add', entity: 'partner', values: { id: expect.any(String), accountId: 'a_hidden', partnerType: 'reseller' } },
    ]);
  });

  it('offers only the markets of the chosen partner type', async () => {
    const user = show();
    const market = screen.getByLabelText('Market (optional)');
    expect(Array.from(market.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['No market', 'Austria · Reseller', 'Germany · Reseller']);
    await user.selectOptions(screen.getByLabelText('Partner type'), 'managed');
    expect(Array.from(market.querySelectorAll('option')).map((o) => o.textContent)).toEqual(['No market', 'Italy · Managed Service Provider']);
  });

  it('adds a partner with a market as one batch: the partner and its market link', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Globex');
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_b');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    const [changes, batch] = applyMany.mock.calls[0]!;
    expect(batch).toEqual({ marketId: 'm_b' });
    // The editor's labeled toast (with Undo) is the only one; the dialog shows none of its own.
    expect(applyMany.mock.calls[0]![2]).toEqual({ label: 'Partner added' });
    expect(toast).not.toHaveBeenCalled();
    expect(changes).toHaveLength(3);
    expect(changes[0]).toMatchObject({ kind: 'add', entity: 'account', values: { company: 'Globex' } });
    expect(changes[1]).toMatchObject({ kind: 'add', entity: 'partner', values: { partnerType: 'reseller' } });
    expect(changes[2]).toMatchObject({ kind: 'add', entity: 'marketLink', values: { marketId: 'm_b' } });
    const accountAdd = changes[0];
    const partnerAdd = changes[1];
    const linkAdd = changes[2];
    if (accountAdd?.kind !== 'add' || partnerAdd?.kind !== 'add' || linkAdd?.kind !== 'add') throw new Error('expected adds');
    expect(partnerAdd.values.accountId).toBe(accountAdd.values.id);
    expect(linkAdd.values.partnerId).toBe(partnerAdd.values.id);
    expect(apply).not.toHaveBeenCalled();
  });

  it('signs a partner that already works with us: add, then Mark signed and the stages, with the date', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Globex');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'growth');
    await user.clear(screen.getByLabelText('Signed on'));
    await user.type(screen.getByLabelText('Signed on'), '2026-09-01');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith('active'));
    expect(applyMany).toHaveBeenCalledTimes(1);
    expect(applyMany.mock.calls[0]![2]).toBeUndefined();
    await waitFor(() => expect(apply.mock.calls.map(([change]) => change.kind)).toEqual(['markSigned', 'setStage']));
    expect(apply.mock.calls[0]![0]).toEqual({ kind: 'markSigned', partnerId: 'p_server', signedDate: '2026-09-01' });
  });

  it('starts Signed on at the owner’s today, not the browser’s', async () => {
    // The browser's clock says 29 October in Berlin; the server read the owner's today as 28 October.
    vi.useFakeTimers({ toFake: ['Date'] });
    const zone = process.env.TZ;
    process.env.TZ = 'Europe/Berlin';
    vi.setSystemTime(new Date('2026-10-29T00:30:00Z'));
    try {
      const user = show();
      await user.selectOptions(screen.getByLabelText('Where are they now?'), 'onboarding');
      expect(screen.getByLabelText('Signed on')).toHaveValue('2026-10-28');
    } finally {
      vi.useRealTimers();
      process.env.TZ = zone;
    }
  });

  it('wants the signed date', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Globex');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'onboarding');
    await user.clear(screen.getByLabelText('Signed on'));
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('Add the date they signed.')).toBeVisible();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe('the duplicate check', () => {
  it('same type, market not linked yet: offers Add {market} to it and Open it, and no plain add', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'acme');
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_b');
    expect(screen.getByText('Acme GmbH is already a partner as Reseller.')).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/partners/a_abc123?type=reseller');
    expect(screen.queryByRole('button', { name: 'Add' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add Germany · Reseller to it' }));
    expect(apply).toHaveBeenCalledWith(
      { kind: 'add', entity: 'marketLink', values: { partnerId: 'p_known', marketId: 'm_b', hypothesisId: null } },
      { label: 'Added to Germany · Reseller' },
    );
  });

  it('matches on the website too', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Something else');
    await user.type(screen.getByLabelText('Website'), 'https://www.acme.example/team');
    expect(screen.getByText('Acme GmbH is already a partner as Reseller.')).toBeVisible();
  });

  it('same type and already in the chosen market: says so and only offers Open it', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Acme');
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_a');
    expect(screen.getByText('It is already in Austria · Reseller.')).toBeVisible();
    expect(screen.queryByRole('button', { name: /to it$/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Open it' })).toBeVisible();
  });

  it('another type: warns, and Add puts the new type on the same company', async () => {
    const user = show();
    await user.selectOptions(screen.getByLabelText('Partner type'), 'managed');
    await user.type(screen.getByLabelText('Company'), 'Acme');
    expect(screen.getByText('Acme GmbH is already your reseller. This adds Acme GmbH as a managed service provider.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    const changes = applyMany.mock.calls[0]![0];
    expect(changes.some((change) => change.kind === 'add' && change.entity === 'account')).toBe(false);
    expect(changes.at(-1)).toMatchObject({ kind: 'add', entity: 'partner', values: { accountId: 'a_abc123', partnerType: 'managed' } });
  });

  it('another type also sends the empty company facts, then the new type', async () => {
    const bare = sampleBook({
      accounts: [anAccount({ website: '', country: '' })],
      partners: [partner({ id: 'p_known', partnerType: 'reseller' })],
      people: [], calls: [], qualifications: [], marketLinks: [],
    });
    render(dialog(bare));
    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Partner type'), 'managed');
    await user.type(screen.getByLabelText('Company'), 'Acme GmbH');
    await user.type(screen.getByLabelText('Website'), 'https://acme.example');
    await user.type(screen.getByLabelText('Country'), 'Germany');
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_c');
    await user.click(screen.getByRole('button', { name: /^Add$/ }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    const changes = applyMany.mock.calls[0]![0];
    expect(changes[0]).toMatchObject({
      kind: 'update', entity: 'account', id: 'a_abc123',
      patch: { website: 'https://acme.example', country: 'Germany' },
      expectedUpdatedAt: '2026-10-01T09:00:00.000Z',
    });
    expect(changes[1]).toMatchObject({ kind: 'add', entity: 'partner', values: { accountId: 'a_abc123', partnerType: 'managed' } });
    expect(changes[2]).toMatchObject({ kind: 'add', entity: 'marketLink', values: { marketId: 'm_c' } });
    expect(apply).not.toHaveBeenCalled();
  });

  it('a closed partner of this type says how it was closed, with no date, and still offers the market', async () => {
    const closed = sampleBook({
      accounts: [anAccount({ company: 'Acme' })],
      partners: [partner({ id: 'p_known', closed: 'not_now', updatedAt: '2026-03-03T12:00:00.000Z' })],
      people: [], calls: [], qualifications: [], marketLinks: [],
    });
    render(dialog(closed));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Company'), 'Acme');
    expect(screen.getByText('You closed Acme as a reseller (Not now).')).toBeVisible();
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_b');
    expect(screen.getByRole('button', { name: 'Add Germany · Reseller to it' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Open it' })).toHaveAttribute('href', '/partners/a_abc123?type=reseller');
    expect(screen.queryByRole('button', { name: /^Add$/ })).toBeNull();
  });

  it('submitting the form for a company of the same type does not add it again', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'acme');
    fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
    expect(apply).not.toHaveBeenCalled();
    expect(applyMany).not.toHaveBeenCalled();
  });
});

describe('while a partner is being placed', () => {
  it('does not call the new partner a duplicate of itself', async () => {
    let finish: (r: { ok: true; entityIds: string[] }) => void = () => {};
    applyMany.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    const view = render(dialog(book));
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Company'), 'Initech');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'growth');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    // The editor has applied the add: the book now holds the new partner.
    view.rerender(dialog({ ...book, partners: [...book.partners, partner({ id: 'p_new', company: 'Initech', website: '' })] }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    finish({ ok: true, entityIds: ['a_server', 'p_server'] });
  });

  it('does not claim success when a move fails, and shows the view the partner is really in', async () => {
    apply.mockResolvedValueOnce({ ok: false });
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Initech');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'growth');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(apply).toHaveBeenCalledTimes(1);
    expect(apply.mock.calls[0]![0]).toMatchObject({ kind: 'markSigned' });
    expect(onAdded).toHaveBeenCalledWith('potential');
    expect(toast).not.toHaveBeenCalledWith('Partner added');
    expect(toast).toHaveBeenCalledWith('Partner added, but not moved to where you chose. Check where it is.');
  });
});

describe('the Partner added toast', () => {
  it('is the editor’s labeled one and never a second, with or without a market', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Globex');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    expect(applyMany.mock.calls[0]![2]).toEqual({ label: 'Partner added' });
    expect(apply).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('is one plain toast after the moves when the partner is placed, with no label on the add', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Globex');
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_b');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'growth');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(applyMany.mock.calls[0]![2]).toBeUndefined();
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Partner added');
  });
});

describe('a save with no clear answer', () => {
  const unknownText = 'We couldn’t tell if this was saved. Refresh the page and check before you add it again.';

  it('keeps Add off after an add that may be saved, says why, and sends no moves', async () => {
    applyMany.mockResolvedValueOnce({ ok: false, unknown: true });
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Initech');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'growth');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(unknownText)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
    expect(apply).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it('keeps Add off after a batch with a market that may be saved', async () => {
    applyMany.mockResolvedValueOnce({ ok: false, unknown: true });
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Initech');
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_b');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'onboarding');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    expect(await screen.findByText(unknownText)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();
  });

  it('lets a person add again after a clear refusal', async () => {
    applyMany.mockResolvedValueOnce({ ok: false });
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Initech');
    await user.selectOptions(screen.getByLabelText('Where are they now?'), 'growth');
    await user.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add' })).toBeEnabled());
    expect(screen.queryByText(unknownText)).toBeNull();
  });

  it('keeps Add {market} to it off after a link that may be saved', async () => {
    apply.mockResolvedValueOnce({ ok: false, unknown: true });
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'acme');
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_b');
    await user.click(screen.getByRole('button', { name: 'Add Germany · Reseller to it' }));
    expect(await screen.findByText(unknownText)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Add Germany · Reseller to it' })).toBeDisabled();
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

describe('a company on the chosen market’s Exclusions', () => {
  beforeEach(() => {
    actions.marketRead.mockResolvedValue({
      ok: true, snapshot: { value: { ...sampleMarket(), exclusions: [{ id: 'x_g', company: 'Globex', website: 'globex.example', reason: '', updatedAt: null, updatedBy: '' }] }, issues: [] }, entityId: null,
    });
  });

  it('reads the market, warns, and adds only after Add anyway, never on Enter', async () => {
    const user = show();
    await user.selectOptions(screen.getByLabelText('Market (optional)'), 'm_b');
    await waitFor(() => expect(actions.marketRead).toHaveBeenCalledWith('m_b'));
    await user.type(screen.getByLabelText('Company'), 'Globex{Enter}');
    expect(await screen.findByText('Globex is on this market’s Exclusions. Add anyway?')).toBeVisible();
    expect(applyMany).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /^Add$/ })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add anyway' }));
    expect(applyMany).toHaveBeenCalledTimes(1);
    expect(applyMany.mock.calls[0]![1]).toEqual({ marketId: 'm_b' });
  });

  it('says nothing about Exclusions with no market chosen', async () => {
    const user = show();
    await user.type(screen.getByLabelText('Company'), 'Globex');
    expect(screen.queryByText(/Exclusions/)).toBeNull();
    expect(actions.marketRead).not.toHaveBeenCalled();
  });
});

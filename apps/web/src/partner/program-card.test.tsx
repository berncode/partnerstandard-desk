// @vitest-environment jsdom
import type { Market, Partner, PartnerBook } from '@partner-desk/core';
import { aPartner as partner, marketInfo, marketLink, sampleBook, sampleMarket } from '@partner-desk/core/test-builders';
import { COPY } from '@partner-desk/copy';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramLevels } from '@/programs/links';
import type { ProgramOption } from '@/programs/title';

vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { error: vi.fn(), dismiss: vi.fn() }) }));

import type { MarketState } from './partner-model';
import { ProgramCard } from './program-card';
import { SignDialog } from './sign-dialog';
import { renderPartner, type HarnessOptions } from './test-harness';
import { StorageProvider } from '@/storage-context';

const PROGRAMS: ProgramOption[] = [
  { programId: 'pg_reseller1', label: 'Reseller', partnerType: 'reseller', title: 'Reseller' },
  { programId: 'pg_dach00001', label: 'Reseller · DACH', partnerType: 'reseller', title: 'Reseller · DACH' },
  { programId: 'pg_referral1', label: 'Referral', partnerType: 'referral', title: 'Referral' },
];
const LEVELS: Record<string, ProgramLevels> = {
  pg_reseller1: { status: 'ready', reg: 'Member', pref: 'Gold', prefOn: true },
  pg_dach00001: { status: 'ready', reg: 'Registered', pref: 'Preferred', prefOn: false },
};

const book = (over: Partial<Partner> = {}, rest: Partial<PartnerBook> = {}) =>
  sampleBook({ partners: [partner(over)], people: [], calls: [], qualifications: [], marketLinks: [], ...rest });
const show = (ui: React.ReactNode, b: PartnerBook, options: HarnessOptions = {}) =>
  renderPartner(ui, b, { programs: PROGRAMS, levels: LEVELS, ...options });

const program = () => screen.getByRole('combobox', { name: 'Program' });
const level = () => screen.getByRole('combobox', { name: 'Level' });
const card = () => screen.getByRole('region', { name: 'Program' });

beforeEach(() => vi.clearAllMocks());

describe('Program and Level on a partner type', () => {
  it('offers the programs of the partner’s type and puts the partner in one at the starting level', async () => {
    const user = userEvent.setup();
    const { dispatched } = show(<ProgramCard />, book());
    expect(within(program()).getAllByRole('option').map((o) => o.textContent)).toEqual(['No program', 'Reseller', 'Reseller · DACH']);
    expect(screen.queryByRole('combobox', { name: 'Level' })).not.toBeInTheDocument();
    await user.selectOptions(program(), 'Reseller');
    expect(dispatched[0]).toEqual({
      change: { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: 'pg_reseller1', level: 'reg' } },
      options: { label: COPY.PROGRAM_CHANGED },
    });
    // The levels by the program's own names; Preferred is offered when the program has it.
    expect(within(level()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Member', 'Gold']);
    expect(level()).toHaveValue('reg');
    expect(within(card()).getByRole('link', { name: 'Open program' })).toHaveAttribute('href', '/programs/pg_reseller1/why');
  });

  it('moves up at once, and asks before moving down to the starting level', async () => {
    const user = userEvent.setup();
    const { dispatched } = show(<ProgramCard />, book({ programId: 'pg_reseller1', level: null }));
    expect(level()).toHaveValue('reg');
    await user.selectOptions(level(), 'Gold');
    expect(dispatched[0]?.change).toEqual({ kind: 'update', entity: 'partner', id: 'p_abc123', patch: { level: 'pref' } });
    expect(dispatched[0]?.options).toEqual({ label: COPY.LEVEL_CHANGED });

    await user.selectOptions(level(), 'Member');
    const dialog = screen.getByRole('dialog', { name: 'Move Acme GmbH to Member?' });
    expect(dialog).toHaveTextContent('Member is the starting level. The partner no longer gets what Gold partners get.');
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(dispatched).toHaveLength(1);
    expect(level()).toHaveValue('pref');

    await user.selectOptions(level(), 'Member');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Move to Member' }));
    expect(dispatched[1]?.change).toEqual({ kind: 'update', entity: 'partner', id: 'p_abc123', patch: { level: 'reg' } });
    expect(level()).toHaveValue('reg');
  });

  it('asks before taking a partner at Preferred to another program or out of it', async () => {
    const user = userEvent.setup();
    const { dispatched } = show(<ProgramCard />, book({ programId: 'pg_reseller1', level: 'pref' }));
    await user.selectOptions(program(), 'Reseller · DACH');
    const moving = screen.getByRole('dialog', { name: 'Change Acme GmbH’s program?' });
    expect(moving).toHaveTextContent('The partner is at Gold now. In another program it starts again at the starting level.');
    await user.click(within(moving).getByRole('button', { name: 'Cancel' }));
    expect(dispatched).toHaveLength(0);

    await user.selectOptions(program(), 'No program');
    const leaving = screen.getByRole('dialog', { name: 'Change Acme GmbH’s program?' });
    expect(leaving).toHaveTextContent(COPY.PROGRAM_LEAVE_TEXT('Gold'));
    expect(COPY.PROGRAM_LEAVE_TEXT('Gold')).toBe('The partner is at Gold now and leaves the program. If it joins one again, it starts at the starting level.');
    expect(leaving).not.toHaveTextContent('In another program');
    await user.click(within(leaving).getByRole('button', { name: 'Change program' }));
    expect(dispatched[0]?.change).toEqual({ kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: null, level: null } });
  });

  it('shows no Preferred where the program has none, and a partner still there as a level it doesn’t have', () => {
    show(<ProgramCard />, book({ programId: 'pg_dach00001', level: 'pref' }));
    expect(within(level()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Registered', COPY.LEVEL_GONE]);
    expect(level()).toHaveValue('pref');
  });

  it('shows a program that is gone as gone, and its level not at all', () => {
    show(<ProgramCard />, book({ programId: 'pg_deleted001', level: 'pref' }));
    expect(program()).toHaveDisplayValue(COPY.PROGRAM_GONE);
    expect(card()).toHaveTextContent(COPY.PROGRAM_GONE_NOTE);
    expect(screen.queryByRole('combobox', { name: 'Level' })).not.toBeInTheDocument();
  });

  it('treats a listed program whose file is gone as gone, and waits for level names while they load', () => {
    const view = show(<ProgramCard />, book({ programId: 'pg_reseller1' }), { levels: { pg_reseller1: { status: 'gone' } } });
    expect(program()).toHaveDisplayValue(COPY.PROGRAM_GONE);
    view.unmount();
    show(<ProgramCard />, book({ programId: 'pg_reseller1' }), { levels: {} });
    expect(level()).toBeDisabled();
    expect(within(level()).getAllByRole('option').map((o) => o.textContent)).toEqual(['Registered', 'Preferred']);
  });

  it('says to a company server’s viewer that there is no program of the type yet, with no link to add one (owner, 2026-11-14)', () => {
    show(<StorageProvider storage="database" viewer><ProgramCard /></StorageProvider>, book({ partnerType: 'distributor' }), { readOnly: true });
    expect(card()).toHaveTextContent('You have no Distributor program yet.');
    expect(within(card()).queryByRole('link', { name: 'Add a program' })).toBeNull();
  });

  it('says when there is no program of the type yet, and is read-only when the page is', () => {
    const view = show(<ProgramCard />, book({ partnerType: 'distributor' }));
    expect(card()).toHaveTextContent('You have no Distributor program yet.');
    expect(within(card()).getByRole('link', { name: 'Add a program' })).toHaveAttribute('href', '/programs/new');
    view.unmount();
    show(<ProgramCard />, book({ programId: 'pg_reseller1' }), { readOnly: true });
    expect(program()).toBeDisabled();
    expect(level()).toBeDisabled();
  });

  it('shows the stored program as plain unknown, not as deleted, when the list of programs couldn’t be read', () => {
    show(<ProgramCard />, book({ programId: 'pg_reseller1' }), { programs: [], programsListed: false });
    expect(program()).toHaveDisplayValue('pg_reseller1');
    expect(card()).not.toHaveTextContent(COPY.PROGRAM_GONE_NOTE);
    expect(card()).not.toHaveTextContent('You have no Reseller program yet.');
    expect(screen.queryByRole('combobox', { name: 'Level' })).not.toBeInTheDocument();
  });

  it('is left out for a partner type no program covers', () => {
    show(<ProgramCard />, book({ partnerType: 'technology' }));
    expect(screen.queryByRole('region', { name: 'Program' })).not.toBeInTheDocument();
  });
});

describe('the sign dialog', () => {
  const austria = sampleMarket({ info: marketInfo({ marketId: 'm_a', feedsProgramId: 'pg_dach00001' }) });
  const germany = sampleMarket({ info: marketInfo({ marketId: 'm_b', marketName: 'Germany', feedsProgramId: 'pg_referral1' }) });
  const ready = (market: Market): MarketState => ({ status: 'ready', market });
  const linked = (marketIds: string[]) => book({}, { marketLinks: marketIds.map((marketId, i) => marketLink({ id: `l_${i}`, partnerId: 'p_abc123', marketId })) });
  const markets = [
    { marketId: 'm_a', displayName: 'Austria · Reseller', archived: false },
    { marketId: 'm_b', displayName: 'Germany · Reseller', archived: false },
  ];

  async function sign(user: ReturnType<typeof userEvent.setup>) {
    const dialog = screen.getByRole('dialog', { name: 'Mark Acme GmbH signed' });
    await user.click(within(dialog).getByRole('button', { name: 'Mark signed' }));
    // The MAP advice comes first when the MAP isn't agreed.
    const ahead = within(dialog).queryByRole('button', { name: 'Go ahead anyway' });
    if (ahead) await user.click(ahead);
  }

  it('proposes the program fed by the first of the partner’s markets that feeds one of its type, at the starting level', async () => {
    const user = userEvent.setup();
    const { dispatched } = show(<SignDialog open onOpenChange={() => {}} />, linked(['m_b', 'm_a']), {
      markets, marketStates: { m_a: ready(austria), m_b: ready(germany) },
    });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Program' })).toHaveValue('pg_dach00001');
    expect(within(within(dialog).getByRole('combobox', { name: 'Program' })).getAllByRole('option').map((o) => o.textContent))
      .toEqual(['No program', 'Reseller', 'Reseller · DACH']);
    expect(dialog).toHaveTextContent('Proposed because Austria · Reseller feeds it.');
    expect(dialog).toHaveTextContent(COPY.SIGN_PROGRAM_HINT);
    await sign(user);
    expect(dispatched.map((d) => d.change)).toEqual([
      expect.objectContaining({ kind: 'markSigned', partnerId: 'p_abc123' }),
      { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: 'pg_dach00001', level: 'reg' } },
    ]);
  });

  it('can be left empty, or set to another program', async () => {
    const user = userEvent.setup();
    const { dispatched } = show(<SignDialog open onOpenChange={() => {}} />, linked(['m_a']), { markets, marketStates: { m_a: ready(austria) } });
    await user.selectOptions(screen.getByRole('combobox', { name: 'Program' }), 'No program');
    expect(screen.getByRole('dialog')).not.toHaveTextContent('Proposed because');
    await sign(user);
    expect(dispatched.map((d) => d.change.kind)).toEqual(['markSigned']);
  });

  it('proposes nothing when no market feeds a program of the partner’s type, or the one it feeds is gone', () => {
    const gone = sampleMarket({ info: marketInfo({ marketId: 'm_a', feedsProgramId: 'pg_deleted001' }) });
    show(<SignDialog open onOpenChange={() => {}} />, linked(['m_a', 'm_b']), { markets, marketStates: { m_a: ready(gone), m_b: ready(germany) } });
    expect(screen.getByRole('combobox', { name: 'Program' })).toHaveValue('');
  });

  it('keeps a program the partner is in already, with its level, and proposes nothing', async () => {
    const user = userEvent.setup();
    const partnerIn = book({ programId: 'pg_reseller1', level: 'pref' }, { marketLinks: [marketLink({ id: 'l_0', partnerId: 'p_abc123', marketId: 'm_a' })] });
    const { dispatched } = show(<SignDialog open onOpenChange={() => {}} />, partnerIn, { markets, marketStates: { m_a: ready(austria) } });
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByRole('combobox', { name: 'Program' })).toHaveValue('pg_reseller1');
    expect(dialog).not.toHaveTextContent('Proposed because');
    expect(dialog).not.toHaveTextContent(COPY.SIGN_PROGRAM_HINT);
    await sign(user);
    expect(dispatched.map((d) => d.change.kind)).toEqual(['markSigned']);
  });

  it('says a partner at Preferred leaves the program when No program is picked', async () => {
    const user = userEvent.setup();
    show(<SignDialog open onOpenChange={() => {}} />, book({ programId: 'pg_reseller1', level: 'pref' }));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Program' }), 'No program');
    expect(screen.getByRole('dialog', { name: 'Change Acme GmbH’s program?' })).toHaveTextContent(COPY.PROGRAM_LEAVE_TEXT('Gold'));
  });

  it('asks before taking a partner at Preferred to another program, and then joins it at the starting level', async () => {
    const user = userEvent.setup();
    const { dispatched } = show(<SignDialog open onOpenChange={() => {}} />, book({ programId: 'pg_reseller1', level: 'pref' }));
    const field = () => screen.getByRole('combobox', { name: 'Program' });
    await user.selectOptions(field(), 'Reseller · DACH');
    const confirm = screen.getByRole('dialog', { name: 'Change Acme GmbH’s program?' });
    expect(confirm).toHaveTextContent('The partner is at Gold now.');
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    expect(field()).toHaveValue('pg_reseller1');
    await user.selectOptions(field(), 'Reseller · DACH');
    await user.click(within(screen.getByRole('dialog', { name: 'Change Acme GmbH’s program?' })).getByRole('button', { name: 'Change program' }));
    expect(field()).toHaveValue('pg_dach00001');
    expect(screen.getByRole('dialog', { name: 'Mark Acme GmbH signed' })).toHaveTextContent(COPY.SIGN_PROGRAM_HINT);
    await sign(user);
    expect(dispatched.map((d) => d.change)).toEqual([
      expect.objectContaining({ kind: 'markSigned' }),
      { kind: 'update', entity: 'partner', id: 'p_abc123', patch: { programId: 'pg_dach00001', level: 'reg' } },
    ]);
  });

  it('neither proposes nor offers a program the page knows is gone', () => {
    show(<SignDialog open onOpenChange={() => {}} />, linked(['m_a']), {
      markets, marketStates: { m_a: ready(austria) }, levels: { ...LEVELS, pg_dach00001: { status: 'gone' } },
    });
    const field = screen.getByRole('combobox', { name: 'Program' });
    expect(field).toHaveValue('');
    expect(within(field).getAllByRole('option').map((o) => o.textContent)).toEqual(['No program', 'Reseller']);
  });

  it('asks nothing about a program for a partner type no program covers', () => {
    show(<SignDialog open onOpenChange={() => {}} />, book({ partnerType: 'technology' }));
    expect(screen.queryByRole('combobox', { name: 'Program' })).not.toBeInTheDocument();
  });
});

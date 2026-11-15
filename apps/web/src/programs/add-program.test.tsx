// @vitest-environment jsdom
// The type picker, Start from and Add program, with PartnerStandard Desk's types (Other grayed out too), the company's
// programs from the directory, and the server action.
import { GROUPS, OUT, TYPE, TYPE_DESC } from '@partner-desk/core';
import { COPY, PROGRAM_OTHER_REASON } from '@partner-desk/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CreateProgram, MarketsFor } from './add-program';
import type { ProgramOption } from './title';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }) }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { AddProgram } = await import('./add-program');
const { StartFrom } = await import('./start-from');
const { TypePicker } = await import('./type-picker');

const escape = (s: string) => s.replace(/[()/]/g, '\\$&');

describe('TypePicker', () => {
  it('shows the four groups with each type and what it is, then Other', () => {
    render(<TypePicker have={[]} onPick={vi.fn()} />);
    for (const g of GROUPS) {
      const group = screen.getByRole('group', { name: g.name });
      expect(within(group).getAllByRole('button')).toHaveLength(g.types.length);
    }
    const reseller = screen.getByRole('button', { name: /^Reseller/ });
    expect(reseller).toHaveTextContent(TYPE_DESC.reseller);
    expect(reseller).toBeEnabled();
    expect(within(screen.getByRole('group', { name: 'Other' })).getByRole('button')).toBeDisabled();
  });

  it('offers Co-Seller among the Channel Partners and System Integrator among the Service Partners', () => {
    render(<TypePicker have={[]} onPick={vi.fn()} />);
    const coSeller = within(screen.getByRole('group', { name: 'Channel Partner' })).getByRole('button', { name: /^Co-Seller/ });
    expect(coSeller).toBeEnabled();
    expect(coSeller).toHaveTextContent(TYPE_DESC['co-seller']);
    const si = within(screen.getByRole('group', { name: 'Service Partner' })).getByRole('button', { name: new RegExp(`^${escape(TYPE['system-integrator'])}`) });
    expect(si).toBeEnabled();
    expect(si).toHaveTextContent(TYPE_DESC['system-integrator']);
  });

  it('disables the types that have no program and says why', () => {
    render(<TypePicker have={[]} onPick={vi.fn()} />);
    for (const key of ['oem', 'technology', 'data', 'integration'] as const) {
      const button = screen.getByRole('button', { name: new RegExp(`^${escape(TYPE[key])}`) });
      expect(button).toBeDisabled();
      expect(button).toHaveTextContent(OUT[key]);
    }
    expect(screen.getByRole('button', { name: /^Other/ })).toHaveTextContent(PROGRAM_OTHER_REASON);
  });

  it('says You have one already. for a type the company has, and it stays clickable; counts two or more', async () => {
    const onPick = vi.fn();
    render(<TypePicker have={['reseller', 'reseller', 'broker']} onPick={onPick} />);
    expect(screen.getByRole('button', { name: /^Reseller/ })).toHaveTextContent('You have 2 already.');
    expect(screen.getByRole('button', { name: /^Broker/ })).toHaveTextContent('You have one already.');
    expect(screen.getByRole('button', { name: /^Distributor/ })).not.toHaveTextContent('already');
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    expect(onPick).toHaveBeenCalledWith('reseller');
  });
});

const listed: ProgramOption[] = [
  { programId: 'pg_aaaaaaaaaa', label: 'Reseller · DACH', partnerType: 'reseller', title: 'Reseller · DACH' },
  { programId: 'pg_bbbbbbbbbb', label: 'Broker', partnerType: 'broker', title: 'Broker' },
];

describe('StartFrom', () => {
  it('offers Start fresh, one copy per program, and Back', async () => {
    const onStart = vi.fn();
    const onBack = vi.fn();
    render(<StartFrom type="reseller" programs={listed} onStart={onStart} onBack={onBack} />);
    expect(screen.getByRole('heading', { level: 1, name: 'How do you want to start?' })).toBeInTheDocument();
    expect(screen.getByText('New Reseller program')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Start fresh/ })).toHaveTextContent('The usual starting answers for Resellers.');
    await userEvent.click(screen.getByRole('button', { name: /^Start fresh/ }));
    expect(onStart).toHaveBeenLastCalledWith(null);
    await userEvent.click(screen.getByRole('button', { name: /^Copy your Broker program/ }));
    expect(onStart).toHaveBeenLastCalledWith('pg_bbbbbbbbbb');
    expect(screen.getByRole('button', { name: /^Copy your Reseller · DACH program/ })).toHaveTextContent(COPY.PROG_COPY_NOTE);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('tells two programs with the same label apart by their names, as the Programs page does', async () => {
    const onStart = vi.fn();
    const twins: ProgramOption[] = [
      { programId: 'pg_aaaaaaaaaa', label: 'Reseller', partnerType: 'reseller', title: 'Reseller · Northwind Reseller Program' },
      { programId: 'pg_cccccccccc', label: 'Reseller', partnerType: 'reseller', title: 'Reseller · Northwind Reseller Program (copy)' },
    ];
    render(<StartFrom type="reseller" programs={twins} onStart={onStart} onBack={vi.fn()} />);
    const copies = screen.getAllByRole('button', { name: /^Copy your/ });
    expect(copies.map((b) => b.firstChild?.textContent)).toEqual([
      COPY.PROG_COPY_OF_NAMED('Reseller · Northwind Reseller Program'),
      COPY.PROG_COPY_OF_NAMED('Reseller · Northwind Reseller Program (copy)'),
    ]);
    expect(COPY.PROG_COPY_OF_NAMED('Reseller · Northwind Reseller Program')).toBe('Copy your Reseller · Northwind Reseller Program');
    await userEvent.click(copies[1]!);
    expect(onStart).toHaveBeenLastCalledWith('pg_cccccccccc');
  });

  it('disables the choices while one is being made', () => {
    render(<StartFrom type="reseller" programs={listed} busy onStart={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByRole('button', { name: /^Start fresh/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
  });
});

describe('AddProgram', () => {
  const made = () => vi.fn<CreateProgram>(async () => ({ ok: true, programId: 'pg_newnewnewn' }));
  beforeEach(() => {
    nav.push.mockClear();
    nav.refresh.mockClear();
  });

  it('with no program yet, picking a type makes it fresh, reads the pages again and opens step 1', async () => {
    const create = made();
    render(<AddProgram companyName="Northwind Security" programs={[]} create={create} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Add a program' })).toBeInTheDocument();
    expect(screen.getByText('Northwind Security')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/programs/pg_newnewnewn/why'));
    expect(create).toHaveBeenCalledWith({ partnerType: 'reseller', from: 'fresh' });
    expect(nav.refresh).toHaveBeenCalled();
  });

  it('with programs, asks how to start, and a copy names its source', async () => {
    const create = made();
    render(<AddProgram companyName="Northwind Security" programs={listed} create={create} />);
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    expect(screen.getByRole('heading', { level: 1, name: 'How do you want to start?' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Copy your Reseller · DACH program/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ partnerType: 'reseller', from: { copyOf: 'pg_aaaaaaaaaa' } }));
  });

  it('offers only copies of the picked type: with none and no market, it makes the program fresh at once (owner, 2026-10-30)', async () => {
    const create = made();
    render(<AddProgram companyName="Northwind Security" programs={listed} create={create} />);
    await userEvent.click(screen.getByRole('button', { name: /^Distributor/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ partnerType: 'distributor', from: 'fresh' }));
    expect(screen.queryByRole('button', { name: /^Copy your/ })).not.toBeInTheDocument();
  });

  it('says why a program couldn’t be made, and stays', async () => {
    const create = vi.fn<CreateProgram>(async () => ({ ok: false, error: 'unavailable', message: 'Google isn’t responding.' }));
    render(<AddProgram companyName="" programs={[]} create={create} />);
    expect(screen.getByText(COPY.COMPANY_UNNAMED)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Google isn’t responding.');
    expect(nav.push).not.toHaveBeenCalled();
  });
});

describe('Start from a market', () => {
  const austria = { marketId: 'm_austria001', displayName: 'Austria · Reseller' };
  const made = (extra: Record<string, unknown> = {}) => vi.fn<CreateProgram>(async () => ({ ok: true, programId: 'pg_newnewnewn', ...extra }));
  beforeEach(() => {
    nav.push.mockClear();
    toast.mockClear();
    toast.error.mockClear();
  });

  it('with no program yet, a type with a market to start from asks how to start; the market fills the program and feeds it', async () => {
    const create = made();
    const marketsFor = vi.fn<MarketsFor>(async () => ({ ok: true, markets: [austria] }));
    render(<AddProgram companyName="Halden" programs={[]} create={create} marketsFor={marketsFor} />);
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'How do you want to start?' })).toBeInTheDocument();
    expect(marketsFor).toHaveBeenCalledWith('reseller');
    const fromMarket = screen.getByRole('button', { name: /^Start from Austria · Reseller/ });
    expect(fromMarket).toHaveTextContent(COPY.PROG_FROM_MARKET_NOTE);
    await userEvent.click(fromMarket);
    await waitFor(() => expect(create).toHaveBeenCalledWith({ partnerType: 'reseller', from: { marketId: 'm_austria001' } }));
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/programs/pg_newnewnewn/why'));
  });

  it('with programs, shows the copies at once and the markets once they are read', async () => {
    let answer: (value: Awaited<ReturnType<MarketsFor>>) => void = () => {};
    const marketsFor = vi.fn<MarketsFor>(() => new Promise((resolve) => { answer = resolve; }));
    render(<AddProgram companyName="Halden" programs={listed} create={made()} marketsFor={marketsFor} />);
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    expect(screen.getByRole('button', { name: /^Copy your Reseller · DACH program/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Copy your Broker program/ })).not.toBeInTheDocument();
    expect(screen.getByText(COPY.PROG_FROM_MARKET_LOADING)).toBeInTheDocument();
    answer({ ok: true, markets: [austria] });
    expect(await screen.findByRole('button', { name: /^Start from Austria · Reseller/ })).toBeEnabled();
    expect(screen.queryByText(COPY.PROG_FROM_MARKET_LOADING)).not.toBeInTheDocument();
  });

  it('with no program and no market to start from, makes it fresh at once; a market list that can’t be read offers none', async () => {
    const create = made();
    render(<AddProgram companyName="Halden" programs={[]} create={create}
      marketsFor={async () => ({ ok: false, error: 'unavailable', message: 'Google isn’t responding.' })} />);
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    await waitFor(() => expect(create).toHaveBeenCalledWith({ partnerType: 'reseller', from: 'fresh' }));
  });

  it('says when the program is made but the market doesn’t feed it yet', async () => {
    const create = made({ marketLinkMessage: COPY.MARKET_LINK_NOT_MADE });
    render(<AddProgram companyName="Halden" programs={[]} create={create} marketsFor={async () => ({ ok: true, markets: [austria] })} />);
    await userEvent.click(screen.getByRole('button', { name: /^Reseller/ }));
    await userEvent.click(await screen.findByRole('button', { name: /^Start from Austria · Reseller/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(COPY.MARKET_LINK_NOT_MADE));
    expect(nav.push).toHaveBeenCalledWith('/programs/pg_newnewnewn/why');
  });
});

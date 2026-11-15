// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProgramRow } from './links';

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: nav.push, refresh: nav.refresh }) }));
const toast = vi.hoisted(() => Object.assign(vi.fn(), { error: vi.fn() }));
vi.mock('sonner', () => ({ toast }));

const { ProgramCard } = await import('./program-card');
const { StorageProvider } = await import('@/storage-context');

const row: ProgramRow = {
  programId: 'pg_aaaaaaaaaa', title: 'Reseller · DACH', partnerType: 'reseller', gone: false,
  levels: [{ name: 'Registered', count: 6 }, { name: 'Preferred', count: 2 }],
  markets: [{ marketId: 'm_austria001', displayName: 'Austria · Reseller' }],
};
const made = () => vi.fn(async () => ({ ok: true as const, programId: 'pg_newnewnewn' }));
const gone = () => vi.fn(async () => ({ ok: true as const, programId: row.programId }));

describe('ProgramCard', () => {
  beforeEach(() => {
    nav.push.mockClear();
    nav.refresh.mockClear();
    toast.error.mockClear();
  });

  it('names the program, links to it, counts its partners per level and lists the markets that feed it', () => {
    render(<ProgramCard row={row} create={made()} remove={gone()} />);
    const card = screen.getByRole('article', { name: 'Reseller · DACH' });
    expect(within(card).getByRole('link', { name: 'Reseller · DACH' })).toHaveAttribute('href', '/programs/pg_aaaaaaaaaa/why');
    expect(card).toHaveTextContent('Registered: 6 · Preferred: 2');
    expect(within(card).getByRole('link', { name: 'Austria · Reseller' })).toHaveAttribute('href', '/markets/m_austria001');
  });

  it('says when no market feeds it, and when its counts can’t be shown', () => {
    render(<ProgramCard row={{ ...row, levels: null, markets: [] }} create={made()} remove={gone()} />);
    expect(screen.getByText(COPY.PROG_NO_MARKETS)).toBeInTheDocument();
    expect(screen.getByText(COPY.COUNTS_UNAVAILABLE)).toBeInTheDocument();
  });

  it('never says no market feeds it when the markets can’t be read; a program whose file is gone says so', () => {
    render(<ProgramCard row={{ ...row, gone: true, levels: null, markets: null }} create={made()} remove={gone()} />);
    expect(screen.queryByText(COPY.PROG_NO_MARKETS)).not.toBeInTheDocument();
    expect(screen.getByText(COPY.PROG_MARKETS_UNAVAILABLE)).toBeInTheDocument();
    expect(screen.getByText(COPY.PROGRAM_NOT_FOUND)).toBeInTheDocument();
    expect(screen.queryByText(COPY.COUNTS_UNAVAILABLE)).not.toBeInTheDocument();
  });

  it('names its buttons after the program, so a list of cards reads apart', () => {
    render(<ProgramCard row={row} create={made()} remove={gone()} />);
    expect(screen.getByRole('button', { name: COPY.PROG_COPY_NAMED('Reseller · DACH') })).toHaveTextContent(COPY.PROG_COPY);
    expect(screen.getByRole('button', { name: COPY.PROG_DELETE_NAMED('Reseller · DACH') })).toHaveTextContent(COPY.PROG_DELETE);
  });

  it('Copy makes a copy of the same partner type and opens it, once however often it is pressed', async () => {
    const create = made();
    render(<ProgramCard row={row} create={create} remove={gone()} />);
    const copy = screen.getByRole('button', { name: COPY.PROG_COPY_NAMED('Reseller · DACH') });
    await userEvent.click(copy);
    expect(create).toHaveBeenCalledWith({ partnerType: 'reseller', from: { copyOf: 'pg_aaaaaaaaaa' } });
    await waitFor(() => expect(nav.push).toHaveBeenCalledWith('/programs/pg_newnewnewn/why'));
    // The list is read again first, so Back shows the copy too.
    expect(nav.refresh).toHaveBeenCalled();
    // The new page may take a while: the card stays shut meanwhile.
    expect(copy).toBeDisabled();
    await userEvent.click(copy);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('says why a copy couldn’t be made', async () => {
    const create = vi.fn(async () => ({ ok: false as const, error: 'unavailable' as const, message: 'Google isn’t responding.' }));
    render(<ProgramCard row={row} create={create} remove={gone()} />);
    await userEvent.click(screen.getByRole('button', { name: COPY.PROG_COPY_NAMED('Reseller · DACH') }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('Google isn’t responding.'));
    expect(nav.push).not.toHaveBeenCalled();
  });

  it('Delete asks first, by the name on this page, then the card leaves at once and the list is read again', async () => {
    const remove = gone();
    render(<ProgramCard row={row} create={made()} remove={remove} />);
    await userEvent.click(screen.getByRole('button', { name: COPY.PROG_DELETE_NAMED('Reseller · DACH') }));
    const dialog = screen.getByRole('dialog', { name: COPY.PROG_DELETE_TITLE('Reseller · DACH') });
    await userEvent.click(within(dialog).getByRole('button', { name: COPY.PROG_DELETE }));
    expect(remove).toHaveBeenCalledWith({ programId: 'pg_aaaaaaaaaa' });
    await waitFor(() => expect(nav.refresh).toHaveBeenCalled());
    expect(screen.queryByRole('article')).not.toBeInTheDocument();
  });

  it('keeps a program that partners or markets point to, and says why in the dialog', async () => {
    const remove = vi.fn(async () => ({ ok: false as const, error: 'invalid' as const, message: 'This program still has 1 partner.' }));
    render(<ProgramCard row={row} create={made()} remove={remove} />);
    await userEvent.click(screen.getByRole('button', { name: COPY.PROG_DELETE_NAMED('Reseller · DACH') }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: COPY.PROG_DELETE }));
    expect(await screen.findByRole('alert')).toHaveTextContent('This program still has 1 partner.');
    expect(nav.refresh).not.toHaveBeenCalled();
  });
});

describe('ProgramCard for a company server’s viewer (owner, 2026-11-14)', () => {
  it('shows a viewer the program with no Copy and no Delete, and an admin or a partner manager both', () => {
    const view = render(<StorageProvider storage="database" viewer><ProgramCard row={row} create={made()} remove={gone()} /></StorageProvider>);
    const card = screen.getByRole('article', { name: 'Reseller · DACH' });
    expect(within(card).getByRole('link', { name: 'Reseller · DACH' })).toBeInTheDocument();
    expect(within(card).queryByRole('button')).toBeNull();
    view.unmount();
    render(<StorageProvider storage="database"><ProgramCard row={row} create={made()} remove={gone()} /></StorageProvider>);
    expect(screen.getByRole('button', { name: COPY.PROG_COPY_NAMED('Reseller · DACH') })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: COPY.PROG_DELETE_NAMED('Reseller · DACH') })).toBeInTheDocument();
  });
});

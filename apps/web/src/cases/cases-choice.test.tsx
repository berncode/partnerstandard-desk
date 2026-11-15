// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CasesChoice } from './cases-choice';
import { StorageProvider } from '@/storage-context';

const show = (count: number, maps: number) =>
  render(<CasesChoice count={count} maps={maps} busy={false} onChoose={vi.fn()} onCancel={vi.fn()} />);

// The two answers name the file: "the file" for one, "the files" for more (owner, 2026-10-31).
describe('CasesChoice answers', () => {
  it.each([[1, 0], [0, 1]])('say "the file" when one file moves (%i cases, %i MAP)', (count, maps) => {
    show(count, maps);
    expect(screen.getByRole('button', { name: 'Move the file to the Drive trash' })).toBeTruthy();
    expect(screen.getByText('You can restore the file from there.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep the file in Drive' })).toBeTruthy();
    expect(screen.getByText('PartnerStandard Desk no longer shows the file.')).toBeTruthy();
    expect(screen.queryByText(/the files|\bit\b|\bthem\b/)).toBeNull();
  });

  it('says one case’s share link in the singular, several in the plural; with a MAP, its links or their links', () => {
    const { unmount } = show(1, 0);
    expect(screen.getByText('Either way, its share link stops working.')).toBeTruthy();
    unmount();
    const two = show(2, 0);
    expect(screen.getByText('Either way, their share links stop working.')).toBeTruthy();
    two.unmount();
    const map = show(0, 1);
    expect(screen.getByText('Either way, its links stop working.')).toBeTruthy();
    map.unmount();
    show(1, 1);
    expect(screen.getByText('Either way, their links stop working.')).toBeTruthy();
  });

  it.each([[2, 0], [1, 1], [0, 2]])('say "the files" when more than one file moves (%i cases, %i MAP)', (count, maps) => {
    show(count, maps);
    expect(screen.getByRole('button', { name: 'Move the files to the Drive trash' })).toBeTruthy();
    expect(screen.getByText('You can restore the files from there.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep the files in Drive' })).toBeTruthy();
    expect(screen.getByText('PartnerStandard Desk no longer shows the files.')).toBeTruthy();
  });
});

describe('CasesChoice on a company server (plan 13, task 12)', () => {
  it('offers only the trash, in the words of the database: no keep, no Drive', () => {
    render(<StorageProvider storage="database"><CasesChoice count={2} maps={1} busy={false} onChoose={vi.fn()} onCancel={vi.fn()} /></StorageProvider>);
    expect(screen.getByRole('button', { name: 'Move the files to the trash' })).toBeTruthy();
    expect(screen.getByText('They can come back from the trash only with their partner type.')).toBeTruthy();
    // One answer only, so no "either way" (task 12's review).
    expect(screen.getByText('Their links stop working.')).toBeTruthy();
    expect(screen.queryByText(/Either way/)).toBeNull();
    expect(screen.queryByRole('button', { name: /Keep/ })).toBeNull();
    expect(screen.queryByText(/Drive/)).toBeNull();
  });
});

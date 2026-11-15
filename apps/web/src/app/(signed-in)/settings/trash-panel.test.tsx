// @vitest-environment jsdom
import { COPY } from '@partner-desk/copy';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./trash-actions', () => ({ restoreTrashItem: vi.fn() }));

const { TrashPanel } = await import('./trash-panel');
const actions = await import('./trash-actions');

const item = (over: Partial<import('@partner-desk/commands').TrashItem> = {}) => ({
  fileId: 'wf_1', kind: 'map' as const, name: 'Acme as reseller', deletedAt: '2026-11-09T10:00:00.000Z', blocked: null, ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Settings, Trash (plan 16, task 3)', () => {
  it('says so when the trash is empty', () => {
    render(<TrashPanel initial={[]} timeZone="Europe/Berlin" />);
    expect(screen.getByText(COPY.TRASH_NONE)).toBeTruthy();
  });

  it('lists each item with its kind and day, and restores one', async () => {
    vi.mocked(actions.restoreTrashItem).mockResolvedValue({ ok: true, items: [], message: COPY.TRASH_RESTORED('Acme as reseller') });
    render(<TrashPanel initial={[item()]} timeZone="Europe/Berlin" />);
    expect(screen.getByText('MAP · deleted 9 Nov 2026')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Restore Acme as reseller' }));
    expect(actions.restoreTrashItem).toHaveBeenCalledWith('wf_1');
    expect((await screen.findByRole('status')).textContent).toBe('Acme as reseller is back.');
    await waitFor(() => expect(screen.getByText(COPY.TRASH_NONE)).toBeTruthy());
  });

  it('shows why an item can’t come back, with no Restore', () => {
    render(<TrashPanel initial={[item({ blocked: COPY.MAP_ALREADY })]} timeZone="Europe/Berlin" />);
    expect(screen.getByText(`MAP · deleted 9 Nov 2026 · ${COPY.MAP_ALREADY}`)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
  });

  it('says why a restore was refused, and shows the trash as it is now', async () => {
    vi.mocked(actions.restoreTrashItem).mockResolvedValue({ ok: false, items: [item({ blocked: COPY.MAP_ALREADY })], message: COPY.MAP_ALREADY });
    render(<TrashPanel initial={[item()]} timeZone="Europe/Berlin" />);
    await userEvent.click(screen.getByRole('button', { name: 'Restore Acme as reseller' }));
    expect((await screen.findByRole('alert')).textContent).toBe(COPY.MAP_ALREADY);
    // The list as it is now: the row says why, and offers no Restore.
    expect(screen.getByText('Acme as reseller')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Restore/ })).toBeNull();
  });
});

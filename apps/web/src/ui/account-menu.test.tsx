// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ signOut: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock('./auth-client', () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock('next/navigation', async (importOriginal) => ({
  ...(await importOriginal<typeof import('next/navigation')>()),
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}));

import { AccountMenu } from './account-menu';

const FAILED = 'Couldn’t sign you out. Check your connection and try again.';

async function openMenu() {
  const notify = { error: vi.fn() };
  const user = userEvent.setup();
  render(<AccountMenu name="Anna Keller" email="anna@example.com" notify={notify} />);
  await user.click(screen.getByRole('button', { name: 'Account: Anna Keller' }));
  return { user, notify };
}

beforeEach(() => { vi.clearAllMocks(); });

describe('AccountMenu', () => {
  it('links to the settings page', async () => {
    await openMenu();
    expect(screen.getByRole('menuitem', { name: 'Settings' })).toHaveAttribute('href', '/settings');
  });

  it('offers the theme choice and remembers it', async () => {
    const { user } = await openMenu();
    expect(screen.getByRole('menuitemradio', { name: 'Light' })).toHaveAttribute('aria-checked', 'true');
    await user.click(screen.getByRole('menuitemradio', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    localStorage.clear();
    delete document.documentElement.dataset.theme;
  });

  it('signs out and goes to the landing page', async () => {
    mocks.signOut.mockResolvedValue({ data: { success: true }, error: null });
    const { user, notify } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/'));
    expect(mocks.refresh).toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('says so and stays put when the server answers with an error', async () => {
    mocks.signOut.mockResolvedValue({ data: null, error: { status: 500, statusText: 'Internal Server Error' } });
    const { user, notify } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(FAILED));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('says so and stays put when the server can’t be reached', async () => {
    mocks.signOut.mockRejectedValue(new TypeError('Failed to fetch'));
    const { user, notify } = await openMenu();
    await user.click(screen.getByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledWith(FAILED));
    expect(mocks.push).not.toHaveBeenCalled();
  });
});

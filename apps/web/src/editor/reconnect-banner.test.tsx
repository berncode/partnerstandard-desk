// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));

import { ReconnectBanner } from './reconnect-banner';

describe('ReconnectBanner', () => {
  it('says the page is read-only and the last change wasn’t saved, and offers Reconnect Google back to this page', () => {
    render(<ReconnectBanner next="/partners/p_1" storage="google" />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Reconnect Google to keep working. This page is read-only until you do. Your last change wasn’t saved.');
    expect(screen.getByRole('button', { name: 'Reconnect Google' })).toHaveAttribute('type', 'submit');
    expect(alert.querySelector('input[name="next"]')).toHaveValue('/partners/p_1');
  });

  it('offers no button to a test user, whose files are in memory', () => {
    render(<ReconnectBanner next="/partners" storage="memory" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('asks a company server’s user to sign in again, with no Google button (plan 13, task 12’s review)', () => {
    render(<ReconnectBanner next="/partners" storage="database" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Sign in again to keep working. This page is read-only until you do. Your last change wasn’t saved.');
    expect(screen.getByRole('alert')).not.toHaveTextContent(/Google/);
    expect(screen.queryByRole('button')).toBeNull();
    // Plan 14: the way back in is the sign-in page, which comes back here.
    expect(screen.getByRole('link', { name: 'Sign in again' })).toHaveAttribute('href', '/sign-in?next=%2Fpartners');
  });
});

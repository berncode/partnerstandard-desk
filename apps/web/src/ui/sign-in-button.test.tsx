// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const social = vi.fn(async () => ({ data: null, error: null }));
vi.mock('./auth-client', () => ({ authClient: { signIn: { social } } }));

const { SignInButton } = await import('./sign-in-button');

describe('SignInButton', () => {
  it.each(['google'] as const)('starts %s sign-in with the callback URLs and shows progress', async (provider) => {
    render(<SignInButton provider={provider} callbackURL="/dashboard" newUserCallbackURL="/new">Start</SignInButton>);
    await userEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(social).toHaveBeenLastCalledWith({ provider, callbackURL: '/dashboard', newUserCallbackURL: '/new' });
    expect(screen.getByRole('button')).toHaveAttribute('aria-busy', 'true');
  });
});

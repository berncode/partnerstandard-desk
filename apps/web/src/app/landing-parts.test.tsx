// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ signIn: 'google' as 'google' | 'email', test: false }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error('redirect'), { to }); } }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@/server/edition', () => ({ servedSignIn: () => env.signIn }));
vi.mock('@/server/runtime', () => ({ currentOwner: async () => null }));
vi.mock('./sign-in/actions', () => ({ continueWithGoogle: vi.fn() }));
vi.mock('./google-connections', () => ({ GoogleConnectionsLine: () => <a href="https://myaccount.google.com/connections">Google&apos;s Third-party connections page</a> }));
vi.mock('@partner-desk/platform', async (orig) => ({ ...(await orig<typeof import('@partner-desk/platform')>()), testSignInEnabled: () => env.test }));

const { AccountNotice, HeroActions, HostedOnly } = await import('./landing-parts');

describe('the landing page’s parts (plan 14, task 4)', () => {
  beforeEach(() => Object.assign(env, { signIn: 'google', test: false }));

  it('hosted: Sign in with Google, the Drive line and the notice with its Google link, as before', async () => {
    render(<>{await HeroActions()}{await HostedOnly({ children: <p>Hosted words</p> })}{await AccountNotice({ searchParams: Promise.resolve({ account: 'deleted' }) })}</>);
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
    expect(screen.getByText('Hosted words')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Your account is deleted. Your files are still in your Google Drive.');
    expect(screen.getByRole('link', { name: /Third-party connections/ })).toBeInTheDocument();
  });

  it('a company server: Sign in to the email form, none of hosted’s parts, and no Google anywhere', async () => {
    env.signIn = 'email';
    const { container } = render(<>{await HeroActions()}{await HostedOnly({ children: <p>Hosted words</p> })}{await AccountNotice({ searchParams: Promise.resolve({ account: 'deleted' }) })}</>);
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/sign-in');
    expect(screen.queryByText('Hosted words')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Your account is deleted. Your company’s partner work is still in its database.');
    expect(container.textContent).not.toMatch(/Google|Drive/);
  });
});

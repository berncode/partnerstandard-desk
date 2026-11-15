// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ signIn: 'google' as 'google' | 'email', admin: true, mail: true, google: true, test: false }));
vi.mock('next/navigation', () => ({ redirect: (to: string) => { throw Object.assign(new Error('redirect'), { to }); } }));
vi.mock('@/server/edition', () => ({ servedSignIn: () => env.signIn, emailSignInReady: () => ({ admin: env.admin }) }));
vi.mock('@/server/runtime', () => ({ currentOwner: async () => null, getAuth: () => ({}), googleSignInEnabled: () => env.google, mailConfigured: () => env.mail }));
vi.mock('@/server/legal', () => ({ builtLegalLinks: () => null, legalLinks: () => [], signInAgreementFrom: () => null }));
vi.mock('./actions', () => ({ continueWithGoogle: vi.fn(), emailSignInLink: vi.fn() }));
vi.mock('@partner-desk/platform', async (orig) => ({ ...(await orig<typeof import('@partner-desk/platform')>()), testSignInEnabled: () => env.test }));

const { Options } = await import('./sign-in-options');
const show = async (params: Record<string, string> = {}) => render(<>{await Options({ searchParams: Promise.resolve(params) })}</>);

describe('the sign-in page (plan 14, task 4)', () => {
  beforeEach(() => Object.assign(env, { signIn: 'google', admin: true, mail: true, google: true, test: false }));

  it('hosted: Continue with Google and hosted’s words, as before, and no email form', async () => {
    await show();
    expect(screen.getByRole('button', { name: 'Continue with Google' })).toBeInTheDocument();
    expect(screen.getByText('Your partner work lives in your own Google Drive. We never store it.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Your email')).toBeNull();
  });

  it('a company server: the email form and its words, and no Google', async () => {
    env.signIn = 'email';
    await show({ next: '/partners' });
    expect(screen.getByLabelText('Your email')).toHaveAttribute('type', 'email');
    expect(screen.getByRole('button', { name: 'Email me a link' })).toBeInTheDocument();
    expect(document.querySelector('input[name="next"]')).toHaveValue('/partners');
    expect(screen.getByText('Your partner work lives in your company’s own database, on its own server.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Google/ })).toBeNull();
  });

  it('says what happened to the last link, and ties an address problem to the field', async () => {
    env.signIn = 'email';
    const sent = await show({ link: 'sent' });
    expect(screen.getByRole('status')).toHaveTextContent('Check your email.');
    expect(screen.getByLabelText('Your email')).not.toHaveAttribute('aria-invalid');
    sent.unmount();
    await show({ link: 'bad_email' });
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Enter one email address.');
    expect(screen.getByLabelText('Your email')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Your email')).toHaveAttribute('aria-describedby', alert.id);
  });

  it('says which setting is missing instead of a form that can’t work', async () => {
    env.signIn = 'email';
    env.admin = false;
    const first = await show();
    expect(screen.getByRole('alert')).toHaveTextContent('ADMIN_EMAIL');
    expect(screen.queryByLabelText('Your email')).toBeNull();
    first.unmount();
    env.admin = true;
    env.mail = false;
    await show();
    expect(screen.getByRole('alert')).toHaveTextContent('RESEND_API_KEY');
    expect(screen.queryByLabelText('Your email')).toBeNull();
  });
});

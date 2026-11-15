// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ signIn: 'email' as 'google' | 'email', owner: null as unknown, stored: 'anna@acme.example' as string | null, looked: [] as string[] }));
const NOT_FOUND = new Error('not found');
vi.mock('next/navigation', () => ({ notFound: () => { throw NOT_FOUND; }, redirect: (to: string) => { throw Object.assign(new Error('redirect'), { to }); } }));
vi.mock('@/server/edition', () => ({ servedSignIn: () => env.signIn }));
vi.mock('@/server/runtime', () => ({ currentOwner: async () => env.owner, getAuth: () => ({}) }));
vi.mock('../actions', () => ({ confirmSignIn: vi.fn() }));
vi.mock('@partner-desk/platform', async (orig) => ({
  ...(await orig<typeof import('@partner-desk/platform')>()),
  signInLinkEmail: async (_auth: unknown, token: string) => { env.looked.push(token); return env.stored; },
}));

const { Confirm } = await import('./confirm-sign-in');
const confirm = (params: Record<string, string>) => Confirm({ searchParams: Promise.resolve(params) });

describe('the confirm page (plan 14, task 4)', () => {
  beforeEach(() => Object.assign(env, { signIn: 'email', owner: null, stored: 'anna@acme.example', looked: [] }));

  it('asks with the address of the stored link, never one from the address bar, and posts the token on', async () => {
    render(<>{await confirm({ token: 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf', email: 'mallory@elsewhere.example', next: '/partners' })}</>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Sign in to PartnerStandard Desk as anna@acme.example?');
    expect(document.body).not.toHaveTextContent('mallory');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(document.querySelector('input[name="token"]')).toHaveValue('AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf');
    expect(document.querySelector('input[name="next"]')).toHaveValue('/partners');
  });

  it('holds `next` to this app', async () => {
    render(<>{await confirm({ token: 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf', next: 'https://evil.example/' })}</>);
    expect(document.querySelector('input[name="next"]')).toHaveValue('/this-week');
  });

  it('a used or old link says so and offers a new one, with no button to sign in', async () => {
    env.stored = null;
    render(<>{await confirm({ token: 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf', next: '/partners' })}</>);
    expect(screen.getByRole('alert')).toHaveTextContent('This link was used already or is too old. Ask for a new one.');
    expect(screen.getByRole('link', { name: 'Get a new link' })).toHaveAttribute('href', '/sign-in?next=%2Fpartners');
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('signed in already, it goes on; on hosted there is no such page', async () => {
    env.owner = { owner: { userId: 'u1' } };
    await expect(confirm({ token: 'x', next: '/partners' })).rejects.toMatchObject({ to: '/partners' });
    env.owner = null;
    env.signIn = 'google';
    await expect(confirm({ token: 'x' })).rejects.toBe(NOT_FOUND);
    expect(env.looked).toEqual([]);
  });
});

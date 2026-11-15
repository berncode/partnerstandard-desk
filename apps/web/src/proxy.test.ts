import { NextRequest } from 'next/server';
import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ legal: 'ours' as unknown, vercel: false, reads: 0, signIn: 'google' as 'google' | 'email' }));
vi.mock('@partner-desk/platform/env', () => ({
  serverEnv: () => { env.reads += 1; return {}; }, editionFlags: () => ({ legal: env.legal, signIn: env.signIn }), onVercel: () => env.vercel,
}));

const { config, proxy } = await import('./proxy');
/** The address no page answers, which the app serves as its "not found" page. */
const NO_PAGE = '/_self-hosted/no-page';

describe('the legal pages on a company server (plan 13, task 12)', () => {
  it('runs only on the three legal pages and the email sign-in’s confirm page', () => {
    expect(config.matcher).toEqual(['/privacy', '/terms', '/imprint', '/sign-in/confirm']);
  });

  it('on Vercel, always hosted, passes the static page on without reading the settings (final review)', () => {
    env.vercel = true;
    env.reads = 0;
    const answer = proxy(new NextRequest('https://desk.test/privacy'));
    expect(answer.headers.get('x-middleware-next')).toBe('1');
    expect(env.reads).toBe(0);
    env.vercel = false;
  });

  it('lets hosted show PartnerStandard’s pages', () => {
    env.legal = 'ours';
    const answer = proxy(new NextRequest('https://desk.test/privacy'));
    expect(answer.headers.get('x-middleware-rewrite')).toBeNull();
    expect(answer.headers.get('x-middleware-next')).toBe('1');
  });

  it('answers "not found" on a company server, whether or not it set its own pages', () => {
    for (const legal of [{ privacy: null, terms: null, imprint: null }, { privacy: 'https://acme.example/p', terms: 'https://acme.example/t', imprint: null }]) {
      env.legal = legal;
      for (const path of ['/privacy', '/terms', '/imprint']) {
        expect(proxy(new NextRequest(`https://desk.test${path}`)).headers.get('x-middleware-rewrite')).toBe(`https://desk.test${NO_PAGE}`);
      }
    }
  });

  it('answers "not found" for the confirm page on hosted, and lets a company server show it (plan 14)', () => {
    env.signIn = 'google';
    env.vercel = true;
    expect(proxy(new NextRequest('https://desk.test/sign-in/confirm?token=x')).headers.get('x-middleware-rewrite')).toBe(`https://desk.test${NO_PAGE}`);
    env.vercel = false;
    expect(proxy(new NextRequest('https://desk.test/sign-in/confirm?token=x')).headers.get('x-middleware-rewrite')).toBe(`https://desk.test${NO_PAGE}`);
    env.signIn = 'email';
    expect(proxy(new NextRequest('https://desk.test/sign-in/confirm?token=x')).headers.get('x-middleware-next')).toBe('1');
  });
});

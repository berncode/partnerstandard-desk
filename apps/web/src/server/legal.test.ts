import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ legal: 'ours' as unknown, vercel: false }));
vi.mock('@partner-desk/platform/env', () => ({ serverEnv: () => ({}), editionFlags: () => ({ legal: env.legal }), onVercel: () => env.vercel }));

const { builtLegalLinks, legalLinks, legalLinksFor, signInAgreementFrom } = await import('./legal');

describe('the legal links (plan 13, task 12)', () => {
  it('hosted: PartnerStandard’s three pages, in the app', () => {
    expect(legalLinksFor('ours').map((l) => [l.kind, l.href, l.external])).toEqual([['privacy', '/privacy', false], ['terms', '/terms', false], ['imprint', '/imprint', false]]);
  });

  it('self-hosted: only the company’s pages that are set, on its site', () => {
    expect(legalLinksFor({ privacy: null, terms: 'https://acme.example/terms', imprint: null }))
      .toEqual([{ kind: 'terms', label: 'Terms of Service', href: 'https://acme.example/terms', external: true }]);
    expect(legalLinksFor({ privacy: null, terms: null, imprint: null })).toEqual([]);
  });

  it('are known as the page is built only in a Vercel build, which is always hosted', () => {
    env.vercel = true;
    expect(builtLegalLinks()).toEqual(legalLinksFor('ours'));
    env.vercel = false;
    expect(builtLegalLinks()).toBeNull();
  });

  it('the sign-in line names the terms and the privacy policy, found by kind, and is left out without both', () => {
    expect(signInAgreementFrom(legalLinksFor('ours'))).toEqual({
      terms: { kind: 'terms', label: 'Terms', href: '/terms', external: false },
      privacy: { kind: 'privacy', label: 'Privacy Policy', href: '/privacy', external: false },
    });
    env.legal = { privacy: 'https://acme.example/privacy', terms: null, imprint: 'https://acme.example/imprint' };
    expect(signInAgreementFrom(legalLinks())).toBeNull();
    env.legal = { privacy: 'https://acme.example/privacy', terms: 'https://acme.example/terms', imprint: null };
    expect(signInAgreementFrom(legalLinks())?.terms).toEqual({ kind: 'terms', label: 'Terms', href: 'https://acme.example/terms', external: true });
  });
});

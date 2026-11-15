// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({ legal: 'ours' as unknown, vercel: false }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('@partner-desk/platform/env', () => ({ serverEnv: () => ({}), editionFlags: () => ({ legal: env.legal }), onVercel: () => env.vercel }));

const { SiteFooter } = await import('./site-footer');
const { ServedLegalLinks } = await import('./served-legal-links');

const linksOf = (footer: HTMLElement) =>
  within(footer).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target')]);

describe('SiteFooter', () => {
  it('names the app and links the legal pages, and the Knowledge Hub (Decision 28)', () => {
    render(<SiteFooter legal="ours" />);
    const footer = screen.getByRole('contentinfo');
    expect(footer).toHaveTextContent('© PartnerStandard Desk');
    expect(within(footer).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy');
    expect(within(footer).getByRole('link', { name: 'Terms of Service' })).toHaveAttribute('href', '/terms');
    expect(within(footer).getByRole('link', { name: 'Imprint' })).toHaveAttribute('href', '/imprint');
    expect(within(footer).getByRole('link', { name: 'Knowledge Hub' })).toHaveAttribute('href', 'https://pro.partnerstandard.com');
  });

  it('on a Community Edition build says PartnerStandard doesn’t run it (owner, 2026-11-15)', () => {
    vi.stubEnv('NEXT_PUBLIC_PD_BRAND', '');
    try {
      render(<SiteFooter legal="ours" />);
      const footer = screen.getByRole('contentinfo');
      expect(footer).toHaveTextContent('PartnerStandard Desk Community Edition. Not run by PartnerStandard.');
      expect(footer).not.toHaveTextContent('© PartnerStandard Desk');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('holds PartnerStandard’s links as the page is built on Vercel, always hosted, for a crawler without JavaScript', () => {
    env.vercel = true;
    render(<SiteFooter />);
    expect(linksOf(screen.getByRole('contentinfo')).map(([, href]) => href)).toEqual(['/privacy', '/terms', '/imprint', 'https://pro.partnerstandard.com']);
    env.vercel = false;
  });

  it('off Vercel holds no legal link as built: they come as the page is served, so a company server never shows ours', () => {
    env.vercel = false;
    env.legal = { privacy: null, terms: null, imprint: null };
    render(<SiteFooter />);
    expect(linksOf(screen.getByRole('contentinfo')).map(([, href]) => href)).toEqual(['https://pro.partnerstandard.com']);
  });
});

describe('the legal links as served (plan 13, task 12)', () => {
  it('are PartnerStandard’s own pages on hosted', async () => {
    env.legal = 'ours';
    const { container } = render(<footer>{await ServedLegalLinks()}</footer>);
    expect(linksOf(container)).toEqual([['Privacy Policy', '/privacy', null], ['Terms of Service', '/terms', null], ['Imprint', '/imprint', null]]);
  });

  it('are a company server’s own, in a new tab, each left out when not set', async () => {
    env.legal = { privacy: 'https://acme.example/privacy', terms: null, imprint: 'https://acme.example/imprint' };
    const { container } = render(<footer>{await ServedLegalLinks()}</footer>);
    expect(linksOf(container)).toEqual([['Privacy Policy', 'https://acme.example/privacy', '_blank'], ['Imprint', 'https://acme.example/imprint', '_blank']]);
  });

  it('are none on a company server that set none: never PartnerStandard’s', async () => {
    env.legal = { privacy: null, terms: null, imprint: null };
    const { container } = render(<footer>{await ServedLegalLinks()}</footer>);
    expect(within(container).queryAllByRole('link')).toEqual([]);
  });
});

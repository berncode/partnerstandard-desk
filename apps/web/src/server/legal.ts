// Where the legal links go (plan 13, task 12): PartnerStandard's own pages on hosted, the company's own on a company
// server, each left out when not set. A company server's are read at request time: one image serves every company.
import { COPY } from '@partner-desk/copy';
import { editionFlags, onVercel, serverEnv, type LegalPages } from '@partner-desk/platform/env';

export interface LegalLink {
  kind: 'privacy' | 'terms' | 'imprint';
  label: string;
  href: string;
  /** A company's own page, on its own site: opens in a new tab. */
  external: boolean;
}

/** The privacy, terms and imprint links, in that order. */
export function legalLinksFor(legal: LegalPages): LegalLink[] {
  if (legal === 'ours') {
    return [
      { kind: 'privacy', label: COPY.FOOTER_PRIVACY, href: '/privacy', external: false },
      { kind: 'terms', label: COPY.FOOTER_TERMS, href: '/terms', external: false },
      { kind: 'imprint', label: COPY.FOOTER_IMPRINT, href: '/imprint', external: false },
    ];
  }
  const links = [
    { kind: 'privacy', label: COPY.FOOTER_PRIVACY, href: legal.privacy },
    { kind: 'terms', label: COPY.FOOTER_TERMS, href: legal.terms },
    { kind: 'imprint', label: COPY.FOOTER_IMPRINT, href: legal.imprint },
  ] as const;
  return links.flatMap(({ href, ...link }) => (href === null ? [] : [{ ...link, href, external: true }]));
}

/** This deployment's legal links, from its settings: call it only at request time. */
export const legalLinks = (): LegalLink[] => legalLinksFor(editionFlags(serverEnv()).legal);

/**
 * PartnerStandard's links, known when the page is built: a Vercel build is always hosted. Null anywhere else, where the
 * links are read when the page is served.
 */
export const builtLegalLinks = (): LegalLink[] | null => (onVercel() ? legalLinksFor('ours') : null);

/** The terms and the privacy policy the sign-in line names, or null when either is missing (a company server's). */
export function signInAgreementFrom(links: LegalLink[]): { terms: LegalLink; privacy: LegalLink } | null {
  const terms = links.find((l) => l.kind === 'terms');
  const privacy = links.find((l) => l.kind === 'privacy');
  return terms && privacy ? { terms: { ...terms, label: COPY.SIGN_IN_TERMS_LINK }, privacy } : null;
}

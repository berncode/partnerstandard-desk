import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import type { LegalLink } from '@/server/legal';

/**
 * The legal links as the footer shows them: ours in the app, a company's own on its site, in a new tab. Ours are never
 * prefetched: every page shows them, and on hosted each prefetch would run the legal pages' proxy (task 12's review).
 */
export function LegalLinks({ links, className = 'hover:text-ink' }: { links: LegalLink[]; className?: string }) {
  return links.map((link) => (link.external
    ? <a key={link.kind} href={link.href} target="_blank" rel="noreferrer" className={className}>{link.label}</a>
    : <Link key={link.kind} href={link.href} prefetch={false} className={className}>{link.label}</Link>));
}

/** The sign-in page's line: "By continuing you agree to the Terms and acknowledge the Privacy Policy." */
export function SignInAgreement({ terms, privacy, className }: { terms: LegalLink; privacy: LegalLink; className: string }) {
  return (
    <p className="mt-6 text-xs text-ink-3">
      {COPY.SIGN_IN_AGREE_BEFORE}<LegalLinks links={[terms]} className={className} />{COPY.SIGN_IN_AGREE_MIDDLE}<LegalLinks links={[privacy]} className={className} />.
    </p>
  );
}

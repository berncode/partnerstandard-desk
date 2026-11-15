import { COPY } from '@partner-desk/copy';
import { Suspense } from 'react';
import { builtLegalLinks, legalLinksFor } from '@/server/legal';
import { shownBrand } from './brand';
import { LegalLinks } from './legal-links';
import { ServedLegalLinks } from './served-legal-links';

const ITEM = 'hover:text-ink';

/**
 * Every public page's footer: the legal pages and the Knowledge Hub. It names the app exactly as Google's consent
 * screen does (brand verification). Off Vercel the legal links are read when the page is served (plan 13,
 * task 12): a company server links to its own pages, or to none, and one image serves every company. `legal="ours"` is
 * for the legal pages themselves, which stay static: they exist only on hosted.
 */
export function SiteFooter({ legal }: { legal?: 'ours' }) {
  // Known when the page is built: on the legal pages, and in a Vercel build, always hosted. Then the static HTML holds
  // them, as a crawler without JavaScript reads it (Google's brand check; task 12's review).
  const built = legal === 'ours' ? legalLinksFor('ours') : builtLegalLinks();
  return (
    <footer className="border-t border-line print:hidden">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-6 text-sm text-ink-3">
        {/* The Community Edition says PartnerStandard doesn't run it (brand.ts). */}
        <span>{shownBrand() === 'partnerstandard' ? COPY.FOOTER_NAME : COPY.COMMUNITY_FOOTER}</span>
        {built ? <LegalLinks links={built} /> : (
          <Suspense fallback={null}>
            <ServedLegalLinks />
          </Suspense>
        )}
        <a href="https://pro.partnerstandard.com" target="_blank" rel="noreferrer" className={ITEM}>{COPY.FOOTER_HUB}</a>
      </div>
    </footer>
  );
}

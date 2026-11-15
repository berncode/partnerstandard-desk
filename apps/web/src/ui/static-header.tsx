import { COPY } from '@partner-desk/copy';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { shownBrand } from './brand';
import { BADGE_COMMUNITY, BADGE_PARTNERSTANDARD, CommunityLogo, Logo } from './logo';
import { ThemeToggle } from './theme-toggle';

/**
 * The top bar for pages outside the app frame (landing, sign-in, legal pages, the partner's page). The badge says Desk;
 * with the logo it reads as the name. It reads no session, so static pages can use it. The product name sits next to
 * the logo; below sm only the logo shows, so it fits a phone.
 * `home={false}`: the logo is not a link (the partner's page, where nothing leads into PartnerStandard Desk; owner, 2026-10-30).
 */
export function StaticHeader({ account, home = true }: { account?: ReactNode; home?: boolean }) {
  // The Community Edition shows its own mark and badge, never the PartnerStandard logo (brand.ts).
  const brand = shownBrand() === 'partnerstandard' ? (
    <>
      <Logo className="h-8 w-auto" />
      <span className={`hidden text-xs sm:inline ${BADGE_PARTNERSTANDARD}`}>{COPY.APP_BADGE}</span>
    </>
  ) : (
    <>
      <CommunityLogo />
      <span className={`hidden text-xs sm:inline ${BADGE_COMMUNITY}`}>{COPY.COMMUNITY_BADGE}</span>
    </>
  );
  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur print:hidden">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-1.5 px-3 sm:gap-2 sm:px-4">
        {home
          ? <Link href="/" className="flex shrink-0 items-center gap-2 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand">{brand}</Link>
          : <div className="flex shrink-0 items-center gap-2">{brand}</div>}
        <div className="ml-auto flex items-center gap-1">
          {account}
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

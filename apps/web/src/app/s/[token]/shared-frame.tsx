// The shared pages' frame, with PartnerStandard Desk's header and footer for pages outside the app frame.
import type { ReactNode } from 'react';
import { SiteFooter } from '@/ui/site-footer';
import { StaticHeader } from '@/ui/static-header';

/**
 * The page around what a share link shows (spec 6): no session is read, so no account, no sidebar and no owner's pages.
 * The logo is not a link: nothing here leads into PartnerStandard Desk; the footer keeps its legal links (owner, 2026-10-30).
 */
export function SharedFrame({ children }: { children: ReactNode }) {
  return (
    <>
      <StaticHeader home={false} />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 print:max-w-none print:p-0">{children}</main>
      <SiteFooter />
    </>
  );
}

/** Why the link shows no case, in one sentence. */
export function SharedMessage({ children }: { children: string }) {
  return (
    <section className="mx-auto mt-12 max-w-xl rounded-xl border border-line bg-surface p-5 text-center">
      <h1 className="text-lg font-semibold text-ink">{children}</h1>
    </section>
  );
}
